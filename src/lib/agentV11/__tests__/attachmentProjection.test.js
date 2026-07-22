import { describe, expect, it, vi } from "vitest";
import { buildAttachmentLinkDescriptor, reconcileUndoFromAttachmentLink } from "../attachmentProjection";

describe("Agent v1.1 authoritative attachment projection", () => {
  it("builds a deterministic authoritative link", () => {
    expect(buildAttachmentLinkDescriptor({
      clinicId: "c1", workflowId: "wf1", artifactId: "a1",
      attachedAt: "2026-07-22T01:00:00.000Z", attachedByRunId: "run1",
      sourceHypothesisId: "h1", snapshotId: "s2", snapshotVersion: 2,
      decisionSource: "agent_autonomous", decisionActorId: "run1",
    })).toMatchObject({
      idempotency_key: "c1::wf1::a1", status: "attached",
      decision_source: "agent_autonomous", decision_actor_id: "run1",
    });
  });

  it("resolves pending Undo through an attached persisted link without deletion", async () => {
    const updateUndo = vi.fn(async () => ({}));
    const findPendingUndo = vi.fn(async () => [
      { id: "u1", status: "pending" }, { id: "u2", status: "manager_cleared" },
    ]);
    const result = await reconcileUndoFromAttachmentLink({
      link: { id: "l1", status: "attached", clinic_id: "c1", artifact_id: "a1", workflow_id: "wf1" },
      findPendingUndo, updateUndo, now: "2026-07-22T01:00:00.000Z",
    });
    expect(result).toEqual({ resolved: 1 });
    expect(updateUndo).toHaveBeenCalledWith("u1", {
      status: "resolved", resolved_at: "2026-07-22T01:00:00.000Z",
      resolved_into_workflow_id: "wf1", resolved_by_link_id: "l1",
    });
    expect(updateUndo).not.toHaveBeenCalledWith("u2", expect.anything());
  });

  it("cannot resolve Undo from a non-attached link", async () => {
    const updateUndo = vi.fn();
    const findPendingUndo = vi.fn();
    expect(await reconcileUndoFromAttachmentLink({
      link: { id: "l1", status: "superseded" }, findPendingUndo, updateUndo,
      now: "2026-07-22T01:00:00.000Z",
    })).toEqual({ resolved: 0 });
    expect(findPendingUndo).not.toHaveBeenCalled();
    expect(updateUndo).not.toHaveBeenCalled();
  });
});
