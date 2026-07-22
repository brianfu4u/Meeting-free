import { describe, expect, it, vi } from "vitest";
import { planAttachCommit } from "../commitPlanner";
import { CommitSagaError, executeAttachCommitSaga } from "../commitSaga";

function fixture() {
  const plan = planAttachCommit({
    clinicId: "c1",
    now: "2026-07-19T01:00:00.000Z",
    managerDecision: {
      id: "md1", clinic_id: "c1", manager_id: "manager1",
      target_type: "hypothesis", target_id: "p1#h0", decision: "approved",
    },
    attentionItem: {
      id: "att1", clinic_id: "c1", selected_hypothesis_id: "p1#h0",
    },
    hypothesis: {
      clinic_id: "c1", composition_run_id: "run1", source_proposal_id: "p1",
      workflow_hypothesis_id: "p1#h0", composition_type: "attach", status: "selected",
      target_workflow_id: "wf1", target_snapshot_id: "snap3",
      target_snapshot_version: 3, ordered_artifact_ids: ["a1"],
    },
    workflow: {
      id: "wf1", clinic_id: "c1", status: "active",
      current_snapshot_id: "snap3", current_snapshot_version: 3,
    },
    currentSnapshot: {
      id: "snap3", clinic_id: "c1", workflow_id: "wf1", session_id: "s1",
      business_line: "optometry", start_time: "2026-07-19T00:00:00.000Z",
      generated_at: "2026-07-19T00:10:00.000Z", status: "active",
      snapshot_version: 3, projection_version: 3,
    },
  });
  return plan;
}

function makeOps(overrides = {}) {
  let intent = null;
  let workflow = {
    id: "wf1", clinic_id: "c1",
    current_snapshot_id: "snap3", current_snapshot_version: 3,
  };
  return {
    findIntentByKey: vi.fn(async () => intent),
    createIntent: vi.fn(async descriptor => {
      intent = { id: "intent1", ...descriptor };
      return intent;
    }),
    updateIntent: vi.fn(async (_id, patch) => {
      intent = { ...intent, ...patch };
      return intent;
    }),
    createSnapshot: vi.fn(async descriptor => ({ id: "snap4", ...descriptor })),
    getWorkflow: vi.fn(async () => workflow),
    casWorkflowPointer: vi.fn(async (_filter, patch) => {
      workflow = { ...workflow, ...patch };
      return { success: true, updated: 1, has_more: false };
    }),
    updateHypothesis: vi.fn(async (_id, patch) => patch),
    updateAttention: vi.fn(async (_id, patch) => patch),
    updateManagerDecision: vi.fn(async (_id, patch) => patch),
    createOrGetAttachmentLink: vi.fn(async input => ({
      id: `link-${input.artifact_id}`, status: "attached",
      clinic_id: input.clinic_id, workflow_id: input.workflow_id,
      artifact_id: input.artifact_id,
    })),
    reconcileUndoFromAttachmentLink: vi.fn(async () => ({ resolved: 1 })),
    _setIntent(value) { intent = value; },
    _setWorkflow(value) { workflow = value; },
    ...overrides,
  };
}

describe("Phase 3 attach commit Saga", () => {
  it("creates intent, immutable snapshot, CAS pointer, then final projections", async () => {
    const plan = fixture();
    const ops = makeOps();
    const result = await executeAttachCommitSaga({
      plan, ops, now: "2026-07-19T01:01:00.000Z",
    });

    expect(result).toMatchObject({ outcome: "committed", idempotent: false });
    expect(ops.createIntent).toHaveBeenCalledTimes(1);
    expect(ops.createSnapshot).toHaveBeenCalledWith(plan.snapshot_descriptor);
    expect(ops.casWorkflowPointer).toHaveBeenCalledWith(
      plan.workflow_cas_filter,
      { current_snapshot_id: "snap4", current_snapshot_version: 4 }
    );
    expect(ops.updateHypothesis).toHaveBeenCalledWith("p1#h0", { status: "committed" });
    expect(ops.updateAttention).toHaveBeenCalledWith("att1", {
      committed_workflow_id: "wf1", commit_outcome: "committed",
    });
    expect(ops.createOrGetAttachmentLink).toHaveBeenCalledTimes(1);
    expect(ops.reconcileUndoFromAttachmentLink).toHaveBeenCalledWith(
      expect.objectContaining({ id: "link-a1", status: "attached" }),
      "2026-07-19T01:01:00.000Z"
    );
    expect(result.intent.status).toBe("committed");
  });

  it("marks stale when exact pointer CAS updates zero rows", async () => {
    const ops = makeOps({
      casWorkflowPointer: vi.fn(async () => ({ success: true, updated: 0, has_more: false })),
    });
    const result = await executeAttachCommitSaga({
      plan: fixture(), ops, now: "2026-07-19T01:01:00.000Z",
    });
    expect(result).toMatchObject({ outcome: "stale", idempotent: false });
    expect(result.intent.status).toBe("stale");
    expect(ops.updateHypothesis).toHaveBeenCalledWith("p1#h0", { status: "stale" });
    expect(ops.updateAttention).toHaveBeenCalledWith("att1", { commit_outcome: "stale" });
  });

  it("returns an existing stale intent without writing", async () => {
    const ops = makeOps();
    ops._setIntent({ id: "intent1", status: "stale" });
    const result = await executeAttachCommitSaga({
      plan: fixture(), ops, now: "2026-07-19T01:01:00.000Z",
    });
    expect(result).toMatchObject({ outcome: "stale", idempotent: true });
    expect(ops.createSnapshot).not.toHaveBeenCalled();
    expect(ops.casWorkflowPointer).not.toHaveBeenCalled();
  });

  it("replays committed intent idempotently and repairs projections", async () => {
    const ops = makeOps();
    ops._setIntent({
      id: "intent1", status: "committed",
      new_snapshot_id: "snap4", new_snapshot_version: 4,
    });
    const result = await executeAttachCommitSaga({
      plan: fixture(), ops, now: "2026-07-19T01:01:00.000Z",
    });
    expect(result).toMatchObject({ outcome: "committed", idempotent: true });
    expect(ops.createSnapshot).not.toHaveBeenCalled();
    expect(ops.updateHypothesis).toHaveBeenCalledTimes(1);
    expect(ops.updateAttention).toHaveBeenCalledTimes(1);
  });

  it("repairs a prior post-CAS failure without creating another snapshot", async () => {
    const ops = makeOps();
    ops._setIntent({
      id: "intent1", status: "compensation_failed",
      new_snapshot_id: "snap4", new_snapshot_version: 4,
    });
    ops._setWorkflow({
      id: "wf1", clinic_id: "c1",
      current_snapshot_id: "snap4", current_snapshot_version: 4,
    });
    const result = await executeAttachCommitSaga({
      plan: fixture(), ops, now: "2026-07-19T01:02:00.000Z",
    });
    expect(result).toMatchObject({
      outcome: "committed", idempotent: true, repaired: true,
    });
    expect(ops.createSnapshot).not.toHaveBeenCalled();
    expect(ops.casWorkflowPointer).not.toHaveBeenCalled();
  });

  it("persists a sanitized repair marker when projection fails after CAS", async () => {
    const ops = makeOps({
      updateHypothesis: vi.fn(async () => {
        const error = new Error("Bearer secret-token");
        error.code = "DB_INTERNAL";
        throw error;
      }),
    });
    await expect(executeAttachCommitSaga({
      plan: fixture(), ops, now: "2026-07-19T01:03:00.000Z",
    })).rejects.toMatchObject({ code: "commit_saga_failed" });

    const calls = ops.updateIntent.mock.calls;
    const failure = calls[calls.length - 1][1];
    expect(failure.status).toBe("compensation_failed");
    expect(failure.reconciliation.pending_compensation).toEqual([
      "repair_commit_projections",
    ]);
    expect(JSON.stringify(failure)).not.toContain("secret-token");
    expect(JSON.stringify(failure)).not.toContain("Bearer");
  });

  it("does not claim pointer success from success=true without updated=1", async () => {
    const ops = makeOps({
      casWorkflowPointer: vi.fn(async () => ({ success: true })),
    });
    const result = await executeAttachCommitSaga({
      plan: fixture(), ops, now: "2026-07-19T01:04:00.000Z",
    });
    expect(result.outcome).toBe("stale");
  });

  it("rejects incomplete injected operation sets before any write", async () => {
    const ops = makeOps();
    delete ops.casWorkflowPointer;
    await expect(executeAttachCommitSaga({
      plan: fixture(), ops, now: "2026-07-19T01:05:00.000Z",
    })).rejects.toEqual(expect.objectContaining({
      name: "CommitSagaError",
      code: "commit_ops_missing_casWorkflowPointer",
    }));
    expect(ops.createIntent).not.toHaveBeenCalled();
  });
});
