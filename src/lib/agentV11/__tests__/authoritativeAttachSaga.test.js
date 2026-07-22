import { describe, expect, it, vi } from "vitest";
import { executeAuthoritativeAttachSaga } from "../authoritativeAttachSaga";

function ops() {
  return {
    createOrGetAttachmentLink: vi.fn(async descriptor => ({ id: "link1", ...descriptor })),
    reconcileUndoFromAttachmentLink: vi.fn(async () => ({ resolved: 1 })),
  };
}

const base = {
  clinicId: "c1", workflowId: "wf1", artifactIds: ["a1"], runId: "run1",
  hypothesisId: "h1", snapshotId: "s2", snapshotVersion: 2,
};

describe("Agent v1.1 authoritativeAttachSaga decision audit", () => {
  it("records an Agent autonomous decision without inventing a manager", async () => {
    const injected = ops();
    const result = await executeAuthoritativeAttachSaga({
      attachment: { ...base, decisionSource: "agent_autonomous", decisionActorId: "run1" },
      ops: injected, now: "2026-07-22T02:00:00.000Z",
    });
    expect(result.decision_source).toBe("agent_autonomous");
    expect(result.links[0]).toMatchObject({
      decision_source: "agent_autonomous", decision_actor_id: "run1",
    });
  });

  it("records a manager correction with the real ManagerDecision ID", async () => {
    const injected = ops();
    const result = await executeAuthoritativeAttachSaga({
      attachment: { ...base, decisionSource: "manager_manual", decisionActorId: "md-77" },
      ops: injected, now: "2026-07-22T02:00:00.000Z",
    });
    expect(result.links[0]).toMatchObject({
      decision_source: "manager_manual", decision_actor_id: "md-77",
    });
  });

  it("rejects an unknown decision source before persistence", async () => {
    const injected = ops();
    await expect(executeAuthoritativeAttachSaga({
      attachment: { ...base, decisionSource: "system", decisionActorId: "x" },
      ops: injected, now: "2026-07-22T02:00:00.000Z",
    })).rejects.toThrow("decision_source_invalid");
    expect(injected.createOrGetAttachmentLink).not.toHaveBeenCalled();
  });
});
