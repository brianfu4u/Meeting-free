// GENERATED_PHASE3_RUNTIME
// sources:
// src/lib/phase3/commitPlanner.js blob=de527c61941b640cdd83fd83f6b6f8926c461999
// src/lib/phase3/commitSaga.js blob=deab30392a2aa683ace60801e300c0d9d6ac1005
// Keep behavior aligned through src/lib/phase3/__tests__/commitRuntimeParity.test.js.
import { executeAuthoritativeAttachSaga } from "./authoritativeAttachSaga.js";

class CommitRuntimeError extends Error {
  constructor(code) {
    super(code);
    this.name = "CommitRuntimeError";
    this.code = code;
  }
}
const fail = code => { throw new CommitRuntimeError(code); };
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const need = (value, code) => {
  if (value === undefined || value === null || value === "") fail(code);
  return value;
};

function sameTenant(clinicId, named) {
  for (const [name, value] of Object.entries(named)) {
    if (!value?.clinic_id) fail(`${name}_missing_tenant`);
    if (value.clinic_id !== clinicId) fail(`${name}_cross_tenant`);
  }
}

export function planAttachCommitRuntime({
  clinicId, managerDecision, attentionItem, hypothesis, workflow, currentSnapshot, now,
}) {
  need(clinicId, "clinic_id_required");
  need(now, "now_required");
  if (!hypothesis) fail("hypothesis_missing");
  if (hypothesis.composition_type !== "attach") {
    fail(hypothesis.composition_type === "new_train"
      ? "commit_new_train_not_supported"
      : "commit_composition_type_not_supported");
  }
  if (hypothesis.status !== "selected") fail("hypothesis_not_selected");
  if (!hypothesis.target_workflow_id) fail("attach_without_target");
  if (!hypothesis.target_snapshot_id) fail("attach_without_snapshot");
  if (hypothesis.target_snapshot_version == null) fail("attach_without_snapshot_version");
  if (!managerDecision) fail("manager_decision_missing");
  if (managerDecision.decision !== "approved") fail("manager_decision_not_approved");
  if (!managerDecision.manager_id || ["auto", "system"].includes(managerDecision.manager_id)) {
    fail("manager_decision_not_human");
  }
  if (managerDecision.target_type !== "hypothesis") fail("manager_decision_target_type_mismatch");
  if (managerDecision.target_id !== hypothesis.workflow_hypothesis_id) {
    fail("manager_decision_hypothesis_mismatch");
  }
  if (!attentionItem?.id) fail("attention_item_missing");
  if (
    attentionItem.selected_hypothesis_id &&
    attentionItem.selected_hypothesis_id !== hypothesis.workflow_hypothesis_id
  ) fail("attention_hypothesis_link_mismatch");

  sameTenant(clinicId, {
    workflow, snapshot: currentSnapshot, hypothesis,
    intent: { clinic_id: managerDecision.clinic_id },
  });
  if (!workflow?.id) fail("workflow_missing");
  if (workflow.id !== hypothesis.target_workflow_id) fail("target_workflow_mismatch");
  if (currentSnapshot.workflow_id !== workflow.id) fail("snapshot_workflow_mismatch");
  if (currentSnapshot.id !== hypothesis.target_snapshot_id) fail("target_snapshot_mismatch");
  if (currentSnapshot.snapshot_version !== hypothesis.target_snapshot_version) {
    fail("target_snapshot_version_mismatch");
  }
  if (workflow.current_snapshot_id !== hypothesis.target_snapshot_id) {
    fail("stale_proposal_snapshot_id_mismatch");
  }
  if (workflow.current_snapshot_version !== hypothesis.target_snapshot_version) {
    fail("stale_proposal_version_mismatch");
  }
  need(hypothesis.source_proposal_id, "source_proposal_id_required");
  need(managerDecision.id, "manager_decision_id_required");

  const key = `exec::${managerDecision.id}::${hypothesis.source_proposal_id}`;
  const nextVersion = hypothesis.target_snapshot_version + 1;
  const snapshot = clone(currentSnapshot);
  for (const field of ["id", "created_date", "updated_date", "created_by"]) delete snapshot[field];
  Object.assign(snapshot, {
    clinic_id: clinicId,
    workflow_id: workflow.id,
    snapshot_version: nextVersion,
    projection_version: (currentSnapshot.projection_version ?? hypothesis.target_snapshot_version) + 1,
    generated_at: now,
    source_proposal_id: hypothesis.source_proposal_id,
    artifact_ids: clone(hypothesis.ordered_artifact_ids || []),
    manager_decision_id: managerDecision.id,
    composition_run_id: hypothesis.composition_run_id || null,
    status: workflow.status,
  });

  return {
    plan_version: 1,
    composition_type: "attach",
    manager_execution_idempotency_key: key,
    intent_descriptor: {
      clinic_id: clinicId,
      manager_execution_idempotency_key: key,
      manager_decision_id: managerDecision.id,
      attention_item_id: attentionItem.id,
      selected_hypothesis_id: hypothesis.workflow_hypothesis_id,
      target_workflow_id: workflow.id,
      expected_snapshot_id: currentSnapshot.id,
      expected_snapshot_version: hypothesis.target_snapshot_version,
      new_snapshot_version: nextVersion,
      status: "pending",
      reconciliation: {
        last_step: "planned", executed_steps: [], pending_compensation: [],
      },
      created_at: now,
    },
    snapshot_descriptor: snapshot,
    workflow_cas_filter: {
      id: workflow.id,
      clinic_id: clinicId,
      current_snapshot_id: currentSnapshot.id,
      current_snapshot_version: hypothesis.target_snapshot_version,
    },
  };
}

const pointerPatch = (plan, newId) => ({
  current_snapshot_id: need(newId, "new_snapshot_id_required"),
  current_snapshot_version: plan.snapshot_descriptor.snapshot_version,
});
const casResult = result => result?.updated === 1;
const safeError = error => {
  const allowed = new Set([
    "snapshot_create_failed", "workflow_pointer_update_failed",
    "projection_update_failed", "commit_failed",
  ]);
  const candidate = typeof error === "string" ? error : error?.code;
  return allowed.has(candidate) ? candidate : "commit_failed";
};
const pointerMatches = (workflow, intent) => Boolean(
  workflow && intent?.new_snapshot_id &&
  workflow.current_snapshot_id === intent.new_snapshot_id &&
  workflow.current_snapshot_version === intent.new_snapshot_version
);

async function projectCommitted(ops, plan, intent, now) {
  const workflowId = plan.intent_descriptor.target_workflow_id;
  await executeAuthoritativeAttachSaga({
    attachment: {
      clinicId: plan.intent_descriptor.clinic_id, workflowId,
      artifactIds: plan.snapshot_descriptor.artifact_ids || [],
      runId: plan.snapshot_descriptor.composition_run_id,
      hypothesisId: plan.intent_descriptor.selected_hypothesis_id,
      snapshotId: intent.new_snapshot_id, snapshotVersion: intent.new_snapshot_version,
      policyVersion: plan.snapshot_descriptor.policy_version ?? null,
      decisionSource: "manager_manual",
      decisionActorId: plan.intent_descriptor.manager_decision_id,
    },
    ops,
    now,
  });
  await ops.updateHypothesis(plan.intent_descriptor.selected_hypothesis_id, { status: "committed" });
  await ops.updateAttention(plan.intent_descriptor.attention_item_id, {
    committed_workflow_id: workflowId,
    commit_outcome: "committed",
  });
  await ops.updateManagerDecision(plan.intent_descriptor.manager_decision_id, {
    commit_intent_id: intent.id,
  });
  return ops.updateIntent(intent.id, {
    status: "committed",
    new_snapshot_id: intent.new_snapshot_id,
    new_snapshot_version: intent.new_snapshot_version,
    finalized_at: now,
    reconciliation: {
      last_step: "projections_committed",
      executed_steps: [
        "intent_created", "snapshot_created",
        "workflow_pointer_cas", "projections_committed",
      ],
      pending_compensation: [],
    },
  });
}

async function projectStale(ops, plan, intent, now) {
  const stale = await ops.updateIntent(intent.id, {
    status: "stale",
    finalized_at: now,
    reconciliation: {
      last_step: "workflow_pointer_cas",
      executed_steps: ["intent_created", "snapshot_created"],
      pending_compensation: ["discard_unreferenced_snapshot"],
      error: "stale_proposal",
    },
  });
  await ops.updateHypothesis(plan.intent_descriptor.selected_hypothesis_id, { status: "stale" });
  await ops.updateAttention(plan.intent_descriptor.attention_item_id, { commit_outcome: "stale" });
  await ops.updateManagerDecision(plan.intent_descriptor.manager_decision_id, {
    commit_intent_id: intent.id,
  });
  return stale;
}

export async function executeAttachCommitSagaRuntime({ plan, ops, now }) {
  let intent = await ops.findIntentByKey(plan.manager_execution_idempotency_key);
  if (intent?.status === "committed") {
    await projectCommitted(ops, plan, intent, now);
    return { outcome: "committed", idempotent: true, intent };
  }
  if (intent?.status === "stale") return { outcome: "stale", idempotent: true, intent };

  if (intent?.new_snapshot_id) {
    const workflow = await ops.getWorkflow(plan.intent_descriptor.target_workflow_id);
    if (pointerMatches(workflow, intent)) {
      const repaired = await projectCommitted(ops, plan, intent, now);
      return { outcome: "committed", idempotent: true, repaired: true, intent: repaired };
    }
  }

  if (!intent) intent = await ops.createIntent(plan.intent_descriptor);
  intent = await ops.updateIntent(intent.id, {
    status: "committing",
    reconciliation: {
      last_step: "intent_created",
      executed_steps: ["intent_created"],
      pending_compensation: [],
    },
  });

  try {
    const snapshot = await ops.createSnapshot(plan.snapshot_descriptor);
    if (!snapshot?.id) fail("snapshot_create_failed");
    intent = await ops.updateIntent(intent.id, {
      new_snapshot_id: snapshot.id,
      new_snapshot_version: plan.snapshot_descriptor.snapshot_version,
      reconciliation: {
        last_step: "snapshot_created",
        executed_steps: ["intent_created", "snapshot_created"],
        pending_compensation: [],
      },
    });
    const cas = await ops.casWorkflowPointer(
      plan.workflow_cas_filter,
      pointerPatch(plan, snapshot.id)
    );
    if (!casResult(cas)) {
      const stale = await projectStale(ops, plan, intent, now);
      return { outcome: "stale", idempotent: false, intent: stale };
    }
    const committed = await projectCommitted(ops, plan, intent, now);
    return { outcome: "committed", idempotent: false, intent: committed, snapshot };
  } catch (error) {
    const workflow = intent?.new_snapshot_id
      ? await ops.getWorkflow(plan.intent_descriptor.target_workflow_id).catch(() => null)
      : null;
    const afterCas = pointerMatches(workflow, intent);
    if (intent?.id) {
      await ops.updateIntent(intent.id, {
        status: "compensation_failed",
        finalized_at: now,
        reconciliation: {
          last_step: intent.new_snapshot_id ? "post_snapshot_write" : "snapshot_create",
          executed_steps: intent.new_snapshot_id
            ? ["intent_created", "snapshot_created"] : ["intent_created"],
          pending_compensation: afterCas
            ? ["repair_commit_projections"] : ["reconcile_commit_intent"],
          error: safeError(error),
        },
      }).catch(() => undefined);
    }
    fail("commit_saga_failed");
  }
}
