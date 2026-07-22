import { executeAuthoritativeAttachSaga } from "./authoritativeAttachSaga";

const uniq = values => [...new Set((values || []).filter(Boolean))];
const pointerMatches = (workflow, intent) => Boolean(
  intent?.new_snapshot_id && workflow?.current_snapshot_id === intent.new_snapshot_id &&
  workflow?.current_snapshot_version === intent.new_snapshot_version
);

function assertOps(ops) {
  for (const name of [
    "findIntent", "createIntent", "updateIntent", "getWorkflow", "getSnapshot",
    "createSnapshot", "casWorkflowPointer", "createOrGetAttachmentLink",
    "reconcileUndoFromAttachmentLink", "updateHypothesis",
  ]) if (typeof ops?.[name] !== "function") throw new Error(`agent_attach_op_missing_${name}`);
}

function snapshotDescriptor(snapshot, request, now) {
  const next = structuredClone(snapshot);
  for (const key of ["id", "created_date", "updated_date", "created_by", "created_by_id"]) delete next[key];
  return Object.assign(next, {
    clinic_id: request.clinicId,
    workflow_id: request.workflowId,
    snapshot_version: Number(snapshot.snapshot_version) + 1,
    projection_version: Number(snapshot.projection_version ?? snapshot.snapshot_version) + 1,
    generated_at: now,
    source_proposal_id: request.sourceProposalId,
    artifact_ids: uniq([...(snapshot.artifact_ids || []), ...request.artifactIds]),
    composition_run_id: request.runId,
  });
}

async function projectLinks({ request, intent, ops, now }) {
  const projected = await executeAuthoritativeAttachSaga({
    attachment: {
      clinicId: request.clinicId, workflowId: request.workflowId,
      artifactIds: request.artifactIds, runId: intent.composition_run_id,
      hypothesisId: request.hypothesisId, snapshotId: intent.new_snapshot_id,
      snapshotVersion: intent.new_snapshot_version, policyVersion: request.policyVersion,
      decisionSource: "agent_autonomous", decisionActorId: intent.composition_run_id,
    }, ops, now,
  });
  await ops.updateHypothesis(request.hypothesisId, { status: "committed" });
  const committed = await ops.updateIntent(intent.id, {
    status: "committed", finalized_at: now,
    reconciliation: { last_step: "links_projected", pending_compensation: [] },
  });
  return { outcome: "committed", intent: committed, links: projected.links };
}

export async function executeAgentAutoAttachSaga({ request, ops, now }) {
  assertOps(ops);
  if (!request?.clinicId || !request?.runId || !request?.hypothesisId ||
      !request?.workflowId || !request?.artifactIds?.length) throw new Error("agent_attach_request_invalid");
  // Hypothesis IDs are deterministic across a restarted/new CompositionRun.
  // The intent therefore survives process death and is never duplicated merely
  // because the recovery scanner has a different run ID.
  const key = `${request.clinicId}::${request.hypothesisId}`;
  let intent = await ops.findIntent(request.clinicId, key);
  if (!intent) intent = await ops.createIntent({
    clinic_id: request.clinicId, idempotency_key: key,
    composition_run_id: request.runId, workflow_hypothesis_id: request.hypothesisId,
    target_workflow_id: request.workflowId, artifact_ids: uniq(request.artifactIds),
    status: "pending", decision_source: "agent_autonomous", retry_count: 0, created_at: now,
  });

  const workflow = await ops.getWorkflow(request.workflowId);
  if (!workflow || workflow.clinic_id !== request.clinicId) throw new Error("agent_attach_tenant_violation");
  if (intent.status === "committed") return { outcome: "committed", idempotent: true, intent };
  if (pointerMatches(workflow, intent)) {
    const repaired = await projectLinks({ request, intent, ops, now });
    return { ...repaired, idempotent: true, repaired: true };
  }

  const current = await ops.getSnapshot(workflow.current_snapshot_id);
  if (!current || current.clinic_id !== request.clinicId || current.workflow_id !== workflow.id) {
    throw new Error("agent_attach_snapshot_invalid");
  }
  const descriptor = snapshotDescriptor(current, request, now);
  intent = await ops.updateIntent(intent.id, {
    status: "attaching", expected_snapshot_id: current.id,
    expected_snapshot_version: current.snapshot_version,
    retry_count: Number(intent.retry_count || 0) + (intent.status === "cas_retryable" ? 1 : 0),
  });
  const snapshot = await ops.createSnapshot(descriptor);
  intent = await ops.updateIntent(intent.id, {
    new_snapshot_id: snapshot.id, new_snapshot_version: descriptor.snapshot_version,
    reconciliation: { last_step: "snapshot_created", pending_compensation: [] },
  });
  const cas = await ops.casWorkflowPointer({
    id: workflow.id, clinic_id: request.clinicId,
    current_snapshot_id: current.id, current_snapshot_version: current.snapshot_version,
  }, { current_snapshot_id: snapshot.id, current_snapshot_version: descriptor.snapshot_version });
  if (cas?.updated !== 1) {
    const retryable = await ops.updateIntent(intent.id, {
      status: "cas_retryable",
      reconciliation: { last_step: "workflow_pointer_cas", pending_compensation: ["retry_from_latest_pointer"] },
    });
    return { outcome: "cas_retryable", idempotent: false, retryable: true, intent: retryable };
  }
  const committed = await projectLinks({ request, intent, ops, now });
  return { ...committed, idempotent: false, snapshot };
}
