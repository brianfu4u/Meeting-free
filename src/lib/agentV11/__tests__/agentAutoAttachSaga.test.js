import { describe, expect, it, vi } from "vitest";
import { executeAgentAutoAttachSaga } from "../agentAutoAttachSaga";

function fixture({ competingArtifact = null } = {}) {
  let intent = null;
  let workflow = { id: "wf1", clinic_id: "c1", current_snapshot_id: "s1", current_snapshot_version: 1 };
  const snapshots = {
    s1: { id: "s1", clinic_id: "c1", workflow_id: "wf1", snapshot_version: 1, projection_version: 1, artifact_ids: [] },
    concurrent: { id: "concurrent", clinic_id: "c1", workflow_id: "wf1", snapshot_version: 2, projection_version: 2, artifact_ids: [competingArtifact || "other"] },
  };
  let snapshotSeq = 1;
  const links = new Map();
  let firstCas = true;
  const ops = {
    findIntent: vi.fn(async () => intent),
    createIntent: vi.fn(async row => (intent = { id: "intent1", ...row })),
    updateIntent: vi.fn(async (_id, patch) => (intent = { ...intent, ...patch })),
    getWorkflow: vi.fn(async () => workflow),
    getSnapshot: vi.fn(async id => snapshots[id]),
    createSnapshot: vi.fn(async row => {
      const saved = { id: `new${snapshotSeq++}`, ...row };
      snapshots[saved.id] = saved;
      return saved;
    }),
    casWorkflowPointer: vi.fn(async (_filter, patch) => {
      if (firstCas) {
        firstCas = false;
        workflow = { ...workflow, current_snapshot_id: "concurrent", current_snapshot_version: 2 };
        if (competingArtifact) links.set(`c1::wf1::${competingArtifact}`, {
          id: "competing-link", clinic_id: "c1", workflow_id: "wf1",
          artifact_id: competingArtifact, idempotency_key: `c1::wf1::${competingArtifact}`,
          status: "attached", snapshot_id: "concurrent",
          decision_source: "agent_autonomous", decision_actor_id: "run-other",
        });
        return { updated: 0 };
      }
      workflow = { ...workflow, ...patch };
      return { updated: 1 };
    }),
    createOrGetAttachmentLink: vi.fn(async descriptor => {
      if (!links.has(descriptor.idempotency_key)) {
        links.set(descriptor.idempotency_key, { id: "link1", ...descriptor });
      }
      return links.get(descriptor.idempotency_key);
    }),
    reconcileUndoFromAttachmentLink: vi.fn(async () => ({ resolved: 1 })),
    updateHypothesis: vi.fn(async () => ({})),
    state: () => ({ intent, workflow, snapshots, links }),
  };
  return ops;
}

const request = {
  clinicId: "c1", runId: "run1", hypothesisId: "h1", sourceProposalId: "p1",
  workflowId: "wf1", artifactIds: ["a1"], policyVersion: 1,
};

describe("Agent autonomous attach CAS replay", () => {
  it("repairs Link and Undo projection after a crash between pointer CAS and projection", async () => {
    const ops = fixture();
    // Let the first pointer CAS succeed, then simulate process death before
    // the authoritative Link can be persisted.
    let workflow = ops.state().workflow;
    ops.casWorkflowPointer.mockImplementation(async (_filter, patch) => {
      workflow = { ...workflow, ...patch };
      const state = ops.state();
      Object.assign(state.workflow, patch);
      return { updated: 1 };
    });
    ops.createOrGetAttachmentLink.mockRejectedValueOnce(new Error("process_interrupted"));

    await expect(executeAgentAutoAttachSaga({
      request, ops, now: "2026-07-22T02:00:00.000Z",
    })).rejects.toThrow("process_interrupted");
    expect(ops.state().intent.status).toBe("attaching");
    expect(ops.reconcileUndoFromAttachmentLink).not.toHaveBeenCalled();

    const replay = await executeAgentAutoAttachSaga({
      request: { ...request, runId: "run-after-process-restart" }, ops,
      now: "2026-07-22T02:01:00.000Z",
    });
    expect(replay).toMatchObject({
      outcome: "committed", idempotent: true, repaired: true,
    });
    expect(ops.createIntent).toHaveBeenCalledTimes(1);
    expect(ops.createSnapshot).toHaveBeenCalledTimes(1);
    expect(ops.createOrGetAttachmentLink).toHaveBeenCalledTimes(2);
    expect(ops.reconcileUndoFromAttachmentLink).toHaveBeenCalledTimes(1);
    expect(ops.state().intent.status).toBe("committed");
  });

  it("converges Snapshot, pointer and Link after CAS conflict without duplicate Undo projection", async () => {
    const ops = fixture();
    const first = await executeAgentAutoAttachSaga({ request, ops, now: "2026-07-22T03:00:00.000Z" });
    expect(first).toMatchObject({ outcome: "cas_retryable", retryable: true });
    expect(ops.createOrGetAttachmentLink).not.toHaveBeenCalled();
    expect(ops.reconcileUndoFromAttachmentLink).not.toHaveBeenCalled();

    const restartedRequest = { ...request, runId: "run-after-restart" };
    const replay = await executeAgentAutoAttachSaga({ request: restartedRequest, ops, now: "2026-07-22T03:01:00.000Z" });
    expect(replay).toMatchObject({ outcome: "committed", idempotent: false });
    const state = ops.state();
    expect(state.intent.status).toBe("committed");
    expect(state.intent.retry_count).toBe(1);
    expect(state.workflow.current_snapshot_id).toBe(state.intent.new_snapshot_id);
    expect(state.workflow.current_snapshot_version).toBe(state.intent.new_snapshot_version);
    expect(state.snapshots[state.workflow.current_snapshot_id].artifact_ids).toEqual(["other", "a1"]);
    expect([...state.links.values()]).toHaveLength(1);
    expect([...state.links.values()][0]).toMatchObject({
      status: "attached", snapshot_id: state.workflow.current_snapshot_id,
      decision_source: "agent_autonomous", decision_actor_id: "run1",
    });
    expect(ops.createIntent).toHaveBeenCalledTimes(1);
    expect(ops.reconcileUndoFromAttachmentLink).toHaveBeenCalledTimes(1);

    const third = await executeAgentAutoAttachSaga({ request, ops, now: "2026-07-22T03:02:00.000Z" });
    expect(third).toMatchObject({ outcome: "committed", idempotent: true });
    expect(ops.createSnapshot).toHaveBeenCalledTimes(2);
    expect(ops.reconcileUndoFromAttachmentLink).toHaveBeenCalledTimes(1);
  });

  it("preserves another Run's Artifact and Link when the loser rebases after CAS conflict", async () => {
    const ops = fixture({ competingArtifact: "a-other" });
    const first = await executeAgentAutoAttachSaga({ request, ops, now: "2026-07-22T04:00:00.000Z" });
    expect(first.outcome).toBe("cas_retryable");
    const replay = await executeAgentAutoAttachSaga({
      request: { ...request, runId: "run-restarted" }, ops,
      now: "2026-07-22T04:01:00.000Z",
    });
    expect(replay.outcome).toBe("committed");
    const state = ops.state();
    expect(state.snapshots[state.workflow.current_snapshot_id].artifact_ids).toEqual(["a-other", "a1"]);
    expect([...state.links.values()].map(item => item.artifact_id).sort()).toEqual(["a-other", "a1"]);
    expect(ops.reconcileUndoFromAttachmentLink).toHaveBeenCalledTimes(1);
  });
});
