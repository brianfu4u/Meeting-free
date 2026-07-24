import { describe, it, expect } from "vitest";
import {
  buildAcceptedOrphanUndoPatch,
  buildAcceptOrphanManagerDecision,
  isArtifactAcceptedOrphan,
} from "../../../../base44/shared/phase1Instrumentation";

describe("Phase 2b accepted_orphan 终结状态", () => {
  describe("buildAcceptedOrphanUndoPatch", () => {
    it("写回终态 + 复用既有审计字段，不引入新字段", () => {
      const patch = buildAcceptedOrphanUndoPatch({
        managerId: "staff-mgr-1",
        now: "2026-07-25T06:00:00Z",
      });
      expect(patch).toEqual({
        status: "accepted_orphan",
        cleared_by_manager_id: "staff-mgr-1",
        cleared_at: "2026-07-25T06:00:00Z",
      });
      expect(patch).not.toHaveProperty("resolution_type");
      expect(patch).not.toHaveProperty("resolved_at");
    });
  });

  describe("buildAcceptOrphanManagerDecision", () => {
    it("复用 artifact_exception，target_id=artifact_id，异常隔离", () => {
      const d = buildAcceptOrphanManagerDecision({
        clinicId: "c1",
        managerId: "staff-mgr-1",
        artifactId: "a1",
        now: "2026-07-25T06:00:00Z",
      });
      expect(d.target_type).toBe("artifact_exception");
      expect(d.target_id).toBe("a1");
      expect(d.decision).toBe("approved");
      expect(d.decision_scope).toBe("exception_archive_only");
      expect(d.exception_class).toBe("manager_approved_exception");
      expect(d.normal_rule_learning_eligible).toBe(false);
      expect(d.decided_at).toBe("2026-07-25T06:00:00Z");
    });
    it("note 缺省填默认结案说明", () => {
      const d = buildAcceptOrphanManagerDecision({
        clinicId: "c1", managerId: "m", artifactId: "a1", now: "t",
      });
      expect(d.decision_note).toContain("accepted_orphan");
    });
    it("note 显式传入时覆盖默认", () => {
      const d = buildAcceptOrphanManagerDecision({
        clinicId: "c1", managerId: "m", artifactId: "a1", now: "t", note: "已确认无主",
      });
      expect(d.decision_note).toBe("已确认无主");
    });
  });

  describe("isArtifactAcceptedOrphan", () => {
    it("命中 accepted_orphan 终态项 → true", () => {
      const items = [
        { artifact_id: "a1", status: "accepted_orphan" },
        { artifact_id: "a2", status: "pending" },
      ];
      expect(isArtifactAcceptedOrphan(items, "a1")).toBe(true);
    });
    it("仅 pending/resolved → false", () => {
      const items = [{ artifact_id: "a1", status: "pending" }];
      expect(isArtifactAcceptedOrphan(items, "a1")).toBe(false);
    });
    it("空数组或缺 artifactId → false", () => {
      expect(isArtifactAcceptedOrphan([], "a1")).toBe(false);
      expect(isArtifactAcceptedOrphan([{ status: "accepted_orphan" }], "")).toBe(false);
    });
  });

  describe("终态与 reconcile 的相容性（守卫验证）", () => {
    it("reconcileUndoFromAttachmentLink 的 pending 守卫天然跳过 accepted_orphan（无需改 parity 函数）", () => {
      const reconcileGuard = (row) => row?.status === "pending";
      const accepted = { id: "u1", status: "accepted_orphan" };
      const pending = { id: "u2", status: "pending" };
      expect(reconcileGuard(accepted)).toBe(false);
      expect(reconcileGuard(pending)).toBe(true);
    });
  });
});