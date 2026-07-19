/**
 * Clinic OS Phase 3 — immutable attach commit planner.
 *
 * Pure logic only: no SDK calls, entity writes, clocks, randomness, or deployed
 * commit action. Persistence is deliberately left to the Saga adapter.
 */
import {
  assertAttachCompleteness,
  assertCommitTenantScope,
  assertNoAutoManager,
  assertSnapshotBelongsToWorkflow,
  assertSnapshotPointerMatch,
  computeManagerExecutionIdempotencyKey,
} from "./contract";

export class CommitPlanError extends Error {
  constructor(code) {
    super(code);
    this.name = "CommitPlanError";
    this.code = code;
  }
}

function fail(code) {
  throw new CommitPlanError(code);
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function requireValue(value, code) {
  if (value === undefined || value === null || value === "") fail(code);
  return value;
}

function assertApprovedHumanDecision(managerDecision, hypothesis) {
  if (!managerDecision) fail("manager_decision_missing");
  if (managerDecision.decision !== "approved") fail("manager_decision_not_approved");
  const human = assertNoAutoManager(managerDecision.manager_id);
  if (!human.ok) fail("manager_decision_not_human");
  if (managerDecision.target_type !== "hypothesis") fail("manager_decision_target_type_mismatch");
  if (managerDecision.target_id !== hypothesis.workflow_hypothesis_id) {
    fail("manager_decision_hypothesis_mismatch");
  }
}

function assertAttentionLink(attentionItem, hypothesis) {
  if (!attentionItem?.id) fail("attention_item_missing");
  if (
    attentionItem.selected_hypothesis_id &&
    attentionItem.selected_hypothesis_id !== hypothesis.workflow_hypothesis_id
  ) {
    fail("attention_hypothesis_link_mismatch");
  }
}

function assertAttachReady({ clinicId, managerDecision, attentionItem, hypothesis, workflow, currentSnapshot }) {
  requireValue(clinicId, "clinic_id_required");
  if (!hypothesis) fail("hypothesis_missing");
  if (hypothesis.composition_type !== "attach") {
    fail(hypothesis.composition_type === "new_train"
      ? "commit_new_train_not_supported"
      : "commit_composition_type_not_supported");
  }
  if (hypothesis.status !== "selected") fail("hypothesis_not_selected");

  const complete = assertAttachCompleteness(hypothesis);
  if (!complete.ok) fail(complete.reason);
  assertApprovedHumanDecision(managerDecision, hypothesis);
  assertAttentionLink(attentionItem, hypothesis);

  const tenant = assertCommitTenantScope(
    clinicId,
    workflow,
    currentSnapshot,
    hypothesis,
    { clinic_id: managerDecision.clinic_id }
  );
  if (!tenant.ok) fail(tenant.reason);

  if (!workflow?.id) fail("workflow_missing");
  if (workflow.id !== hypothesis.target_workflow_id) fail("target_workflow_mismatch");

  const belongs = assertSnapshotBelongsToWorkflow(currentSnapshot, workflow);
  if (!belongs.ok) fail(belongs.reason);
  if (currentSnapshot.id !== hypothesis.target_snapshot_id) fail("target_snapshot_mismatch");
  if (currentSnapshot.snapshot_version !== hypothesis.target_snapshot_version) {
    fail("target_snapshot_version_mismatch");
  }

  const pointer = assertSnapshotPointerMatch(
    workflow,
    hypothesis.target_snapshot_id,
    hypothesis.target_snapshot_version
  );
  if (!pointer.ok) fail(pointer.reason);

  requireValue(hypothesis.source_proposal_id, "source_proposal_id_required");
  requireValue(managerDecision.id, "manager_decision_id_required");
}

/**
 * Builds the deterministic, serializable plan for an attach commit.
 * The returned descriptors are safe to persist only after the adapter repeats
 * tenant/pointer checks and obtains its own commit lease.
 */
export function planAttachCommit({
  clinicId,
  managerDecision,
  attentionItem,
  hypothesis,
  workflow,
  currentSnapshot,
  now,
}) {
  assertAttachReady({
    clinicId,
    managerDecision,
    attentionItem,
    hypothesis,
    workflow,
    currentSnapshot,
  });
  requireValue(now, "now_required");

  const managerExecutionIdempotencyKey = computeManagerExecutionIdempotencyKey({
    managerDecisionId: managerDecision.id,
    proposalId: hypothesis.source_proposal_id,
  });
  const expectedVersion = hypothesis.target_snapshot_version;
  const nextVersion = expectedVersion + 1;

  const snapshotDescriptor = clone(currentSnapshot);
  for (const key of ["id", "created_date", "updated_date", "created_by"]) {
    delete snapshotDescriptor[key];
  }
  Object.assign(snapshotDescriptor, {
    clinic_id: clinicId,
    workflow_id: workflow.id,
    snapshot_version: nextVersion,
    projection_version: (currentSnapshot.projection_version ?? expectedVersion) + 1,
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
    manager_execution_idempotency_key: managerExecutionIdempotencyKey,
    intent_descriptor: {
      clinic_id: clinicId,
      manager_execution_idempotency_key: managerExecutionIdempotencyKey,
      manager_decision_id: managerDecision.id,
      attention_item_id: attentionItem.id,
      selected_hypothesis_id: hypothesis.workflow_hypothesis_id,
      target_workflow_id: workflow.id,
      expected_snapshot_id: currentSnapshot.id,
      expected_snapshot_version: expectedVersion,
      new_snapshot_version: nextVersion,
      status: "pending",
      reconciliation: {
        last_step: "planned",
        executed_steps: [],
        pending_compensation: [],
      },
      created_at: now,
    },
    snapshot_descriptor: snapshotDescriptor,
    workflow_cas_filter: {
      id: workflow.id,
      clinic_id: clinicId,
      current_snapshot_id: currentSnapshot.id,
      current_snapshot_version: expectedVersion,
    },
  };
}

/** Build the pointer patch only after persistence returns the new snapshot ID. */
export function buildWorkflowPointerPatch(plan, newSnapshotId) {
  requireValue(newSnapshotId, "new_snapshot_id_required");
  if (!plan?.snapshot_descriptor || !plan?.intent_descriptor) fail("commit_plan_missing");
  return {
    current_snapshot_id: newSnapshotId,
    current_snapshot_version: plan.snapshot_descriptor.snapshot_version,
  };
}

/** Base44 updateMany CAS contract: exactly one update means success. */
export function evaluatePointerCasResult(result) {
  return result?.updated === 1
    ? { ok: true, outcome: "committed" }
    : { ok: false, outcome: "stale", error_code: "stale_proposal" };
}

export function buildStaleReconciliation({ now, executedSteps = [] } = {}) {
  return {
    status: "stale",
    finalized_at: now || null,
    reconciliation: {
      last_step: "workflow_pointer_cas",
      executed_steps: clone(executedSteps),
      pending_compensation: ["discard_unreferenced_snapshot"],
      error: "stale_proposal",
    },
  };
}

const SAFE_ERROR_CODES = new Set([
  "snapshot_create_failed",
  "workflow_pointer_update_failed",
  "projection_update_failed",
  "commit_failed",
]);

export function sanitizeCommitError(error) {
  const candidate = typeof error === "string" ? error : error?.code;
  return SAFE_ERROR_CODES.has(candidate) ? candidate : "commit_failed";
}

export function buildCommitFailureReconciliation({ now, lastStep, executedSteps = [], error } = {}) {
  return {
    status: "compensation_failed",
    finalized_at: now || null,
    reconciliation: {
      last_step: lastStep || "unknown",
      executed_steps: clone(executedSteps),
      pending_compensation: ["reconcile_commit_intent"],
      error: sanitizeCommitError(error),
    },
  };
}
