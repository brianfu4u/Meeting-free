/**
 * Clinic OS Phase 3 — replayable attach commit Saga.
 *
 * Pure coordinator over injected persistence operations. It has no Base44 SDK
 * dependency and assumes the caller serializes the same idempotency key.
 */
import {
  buildCommitFailureReconciliation,
  buildStaleReconciliation,
  buildWorkflowPointerPatch,
  evaluatePointerCasResult,
} from "./commitPlanner";
import { executeAuthoritativeAttachSaga } from "../agentV11/authoritativeAttachSaga";

export class CommitSagaError extends Error {
  constructor(code) {
    super(code);
    this.name = "CommitSagaError";
    this.code = code;
  }
}

function fail(code) {
  throw new CommitSagaError(code);
}

function requiredOps(ops) {
  for (const name of [
    "findIntentByKey",
    "createIntent",
    "updateIntent",
    "createSnapshot",
    "getWorkflow",
    "casWorkflowPointer",
    "updateHypothesis",
    "updateAttention",
    "updateManagerDecision",
    "createOrGetAttachmentLink",
    "reconcileUndoFromAttachmentLink",
  ]) {
    if (typeof ops?.[name] !== "function") fail(`commit_ops_missing_${name}`);
  }
}

function pointerMatches(workflow, intent) {
  return Boolean(
    workflow &&
    intent?.new_snapshot_id &&
    workflow.current_snapshot_id === intent.new_snapshot_id &&
    workflow.current_snapshot_version === intent.new_snapshot_version
  );
}

async function projectCommitted({ ops, plan, intent, now }) {
  const workflowId = plan.intent_descriptor.target_workflow_id;
  await executeAuthoritativeAttachSaga({
    attachment: {
      clinicId: plan.intent_descriptor.clinic_id,
      workflowId,
      artifactIds: plan.snapshot_descriptor.artifact_ids || [],
      runId: plan.snapshot_descriptor.composition_run_id,
      hypothesisId: plan.intent_descriptor.selected_hypothesis_id,
      snapshotId: intent.new_snapshot_id,
      snapshotVersion: intent.new_snapshot_version,
      policyVersion: plan.snapshot_descriptor.policy_version ?? null,
      decisionSource: "manager_manual",
      decisionActorId: plan.intent_descriptor.manager_decision_id,
    },
    ops,
    now,
  });
  await ops.updateHypothesis(plan.intent_descriptor.selected_hypothesis_id, {
    status: "committed",
  });
  await ops.updateAttention(plan.intent_descriptor.attention_item_id, {
    committed_workflow_id: workflowId,
    commit_outcome: "committed",
  });
  await ops.updateManagerDecision(plan.intent_descriptor.manager_decision_id, {
    commit_intent_id: intent.id,
  });
  const committed = await ops.updateIntent(intent.id, {
    status: "committed",
    new_snapshot_id: intent.new_snapshot_id,
    new_snapshot_version: intent.new_snapshot_version,
    finalized_at: now,
    reconciliation: {
      last_step: "projections_committed",
      executed_steps: [
        "intent_created",
        "snapshot_created",
        "workflow_pointer_cas",
        "projections_committed",
      ],
      pending_compensation: [],
    },
  });
  return committed;
}

async function projectStale({ ops, plan, intent, now }) {
  const patch = buildStaleReconciliation({
    now,
    executedSteps: ["intent_created", "snapshot_created"],
  });
  const stale = await ops.updateIntent(intent.id, patch);
  await ops.updateHypothesis(plan.intent_descriptor.selected_hypothesis_id, {
    status: "stale",
  });
  await ops.updateAttention(plan.intent_descriptor.attention_item_id, {
    commit_outcome: "stale",
  });
  await ops.updateManagerDecision(plan.intent_descriptor.manager_decision_id, {
    commit_intent_id: intent.id,
  });
  return stale;
}

/**
 * Execute or replay a serialized attach commit.
 *
 * The adapter must hold a short lease for plan.manager_execution_idempotency_key.
 * A retry repairs projections when the Workflow pointer already references the
 * Saga's new immutable snapshot.
 */
export async function executeAttachCommitSaga({ plan, ops, now }) {
  if (!plan?.manager_execution_idempotency_key || !plan.intent_descriptor) {
    fail("commit_plan_missing");
  }
  if (!now) fail("now_required");
  requiredOps(ops);

  let intent = await ops.findIntentByKey(plan.manager_execution_idempotency_key);
  if (intent?.status === "committed") {
    await projectCommitted({ ops, plan, intent, now });
    return { outcome: "committed", idempotent: true, intent };
  }
  if (intent?.status === "stale") {
    return { outcome: "stale", idempotent: true, intent };
  }

  // Recovery after pointer CAS succeeded but projections/finalization failed.
  if (intent?.new_snapshot_id) {
    const workflow = await ops.getWorkflow(plan.intent_descriptor.target_workflow_id);
    if (pointerMatches(workflow, intent)) {
      const repaired = await projectCommitted({ ops, plan, intent, now });
      return { outcome: "committed", idempotent: true, repaired: true, intent: repaired };
    }
  }

  if (!intent) {
    intent = await ops.createIntent(plan.intent_descriptor);
  }
  intent = await ops.updateIntent(intent.id, {
    status: "committing",
    reconciliation: {
      last_step: "intent_created",
      executed_steps: ["intent_created"],
      pending_compensation: [],
    },
  });

  let snapshot;
  try {
    snapshot = await ops.createSnapshot(plan.snapshot_descriptor);
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
      buildWorkflowPointerPatch(plan, snapshot.id)
    );
    const evaluated = evaluatePointerCasResult(cas);
    if (!evaluated.ok) {
      const stale = await projectStale({ ops, plan, intent, now });
      return { outcome: "stale", idempotent: false, intent: stale };
    }

    const committed = await projectCommitted({ ops, plan, intent, now });
    return {
      outcome: "committed",
      idempotent: false,
      intent: committed,
      snapshot,
    };
  } catch (error) {
    // If CAS already moved the pointer, never roll it back: persist a safe
    // repair marker so the next replay can finalize projections.
    const workflow = intent?.new_snapshot_id
      ? await ops.getWorkflow(plan.intent_descriptor.target_workflow_id).catch(() => null)
      : null;
    const pending = pointerMatches(workflow, intent)
      ? ["repair_commit_projections"]
      : ["reconcile_commit_intent"];
    const patch = buildCommitFailureReconciliation({
      now,
      lastStep: intent?.new_snapshot_id ? "post_snapshot_write" : "snapshot_create",
      executedSteps: intent?.new_snapshot_id
        ? ["intent_created", "snapshot_created"]
        : ["intent_created"],
      error,
    });
    patch.reconciliation.pending_compensation = pending;
    if (intent?.id) await ops.updateIntent(intent.id, patch).catch(() => undefined);
    throw new CommitSagaError("commit_saga_failed");
  }
}
