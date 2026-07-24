import { describe, it, expect } from "vitest";
import {
  buildAttachDecisionLog,
  buildTrackScores,
  deriveResult,
  buildCorrectionCapture,
  buildNegativeConstraint,
  negativeConstraintIdempotencyKey,
  isSuppressed,
  filterByNegativeConstraints,
  buildHardLinkLedgerRow,
  computeHardLinkShare,
  buildPreAttachConflictAttention,
} from "../../../../base44/shared/phase1Instrumentation";

describe("Phase 1 埋点纯逻辑", () => {
  describe("deriveResult", () => {
    it("blocked 当不通过自动挂接门", () => {
      expect(deriveResult({ bestCompositionType: "attach", canAutoAttach: false, llmAuditRequired: false })).toBe("blocked");
    });
    it("blocked 当进入预审队列", () => {
      expect(deriveResult({ bestCompositionType: "attach", canAutoAttach: true, llmAuditRequired: true })).toBe("blocked");
    });
    it("blocked 当存在拦截原因码", () => {
      expect(deriveResult({ bestCompositionType: "attach", canAutoAttach: true, llmAuditRequired: false, autoAttachGateReasons: ["unique_best_missing"] })).toBe("blocked");
    });
    it("attach/new_train/orphan 按最佳假设类型", () => {
      expect(deriveResult({ bestCompositionType: "attach", canAutoAttach: true, llmAuditRequired: false })).toBe("attach");
      expect(deriveResult({ bestCompositionType: "new_train", canAutoAttach: true, llmAuditRequired: false })).toBe("new_train");
      expect(deriveResult({ bestCompositionType: "orphan", canAutoAttach: true, llmAuditRequired: false })).toBe("orphan");
    });
    it("未知类型 → blocked", () => {
      expect(deriveResult({ bestCompositionType: null, canAutoAttach: true, llmAuditRequired: false })).toBe("blocked");
    });
  });

  describe("buildTrackScores", () => {
    it("按 track_id 聚合 supporting/opposing/net", () => {
      const hypotheses = [
        { reasoning_tracks: { t1: { supporting_evidence: ["a", "b"], opposing_evidence: ["x"] } } },
        { reasoning_tracks: { t1: { supporting_evidence: ["c"], opposing_evidence: [] } } },
        { reasoning_tracks: { t2: { supporting_evidence: ["d"], opposing_evidence: ["y", "z"] } } },
      ];
      const scores = buildTrackScores(hypotheses);
      expect(scores.t1).toEqual({ supporting: 3, opposing: 1, net: 2 });
      expect(scores.t2).toEqual({ supporting: 1, opposing: 2, net: -1 });
    });
    it("空/缺 reasoning_tracks 返回空对象", () => {
      expect(buildTrackScores([])).toEqual({});
      expect(buildTrackScores([{ foo: 1 }])).toEqual({});
    });
  });

  describe("buildAttachDecisionLog", () => {
    it("产出完整决策日志记录，缺省字段填充", () => {
      const log = buildAttachDecisionLog({
        clinicId: "c1", compositionRunId: "r1", businessDate: "2026-07-24",
        result: "attach", timestamp: "2026-07-24T10:00:00Z",
      });
      expect(log.clinic_id).toBe("c1");
      expect(log.composition_run_id).toBe("r1");
      expect(log.result).toBe("attach");
      expect(log.aggregate_score).toBeNull();
      expect(log.threshold).toBeNull();
      expect(log.margin).toBeNull();
      expect(log.track_scores).toEqual({});
      expect(log.auto_attach_eligible).toBe(false);
    });
  });

  describe("buildCorrectionCapture / buildNegativeConstraint", () => {
    it("correction 默认 label='误挂接'", () => {
      const c = buildCorrectionCapture({
        clinicId: "c1", linkId: "l1", workflowId: "w1", artifactId: "a1", capturedAt: "t",
      });
      expect(c.label).toBe("误挂接");
      expect(c.manager_id).toBeNull();
    });
    it("negative constraint 幂等键 = clinic::workflow::artifact", () => {
      const nc = buildNegativeConstraint({
        clinicId: "c1", workflowId: "w1", artifactId: "a1", sourceLinkId: "l1", createdAt: "t",
      });
      expect(nc.idempotency_key).toBe("c1::w1::a1");
      expect(nc.active).toBe(true);
      expect(negativeConstraintIdempotencyKey("c1", "w1", "a1")).toBe("c1::w1::a1");
    });
  });

  describe("负约束抑制（un-attach 黏性）", () => {
    const ncs = [
      { clinic_id: "c1", workflow_id: "w1", artifact_id: "a2", active: true },
    ];
    it("命中 (target_workflow, ordered_artifact) 的 attach 假设被抑制", () => {
      const h = { composition_type: "attach", target_workflow_id: "w1", ordered_artifact_ids: ["a1", "a2"] };
      expect(isSuppressed(h, ncs)).toBe(true);
    });
    it("非 attach 假设不被抑制", () => {
      const h = { composition_type: "new_train", target_workflow_id: "w1", ordered_artifact_ids: ["a2"] };
      expect(isSuppressed(h, ncs)).toBe(false);
    });
    it("未命中的组合不被抑制", () => {
      const h = { composition_type: "attach", target_workflow_id: "w9", ordered_artifact_ids: ["a9"] };
      expect(isSuppressed(h, ncs)).toBe(false);
    });
    it("active=false 的约束不抑制", () => {
      const h = { composition_type: "attach", target_workflow_id: "w1", ordered_artifact_ids: ["a2"] };
      expect(isSuppressed(h, [{ ...ncs[0], active: false }])).toBe(false);
    });
    it("filterByNegativeConstraints 移除命中项，保留其余", () => {
      const hyps = [
        { composition_type: "attach", target_workflow_id: "w1", ordered_artifact_ids: ["a2"] },
        { composition_type: "attach", target_workflow_id: "w3", ordered_artifact_ids: ["a3"] },
        { composition_type: "orphan", target_workflow_id: null, ordered_artifact_ids: ["a4"] },
      ];
      const filtered = filterByNegativeConstraints(hyps, ncs);
      expect(filtered.length).toBe(2);
      expect(filtered[0].target_workflow_id).toBe("w3");
    });
    it("无约束时原样返回", () => {
      const hyps = [{ composition_type: "attach", target_workflow_id: "w1", ordered_artifact_ids: ["a2"] }];
      expect(filterByNegativeConstraints(hyps, [])).toEqual(hyps);
    });
  });

  describe("computeHardLinkShare", () => {
    it("按 7 天窗口聚合 hard/soft 占比，并按 branch|domain 分组", () => {
      const now = new Date("2026-07-24T12:00:00Z");
      const rows = [
        buildHardLinkLedgerRow({ clinicId: "c1", linkId: "l1", businessDate: "2026-07-23", branch: "optometry", domain: "reception", kind: "hard", createdAt: "2026-07-23T10:00:00Z" }),
        buildHardLinkLedgerRow({ clinicId: "c1", linkId: "l2", businessDate: "2026-07-23", branch: "optometry", domain: "reception", kind: "soft", createdAt: "2026-07-23T11:00:00Z" }),
        buildHardLinkLedgerRow({ clinicId: "c1", linkId: "l3", businessDate: "2026-07-20", branch: "medical", domain: "optometry", kind: "soft", createdAt: "2026-07-20T10:00:00Z" }),
        buildHardLinkLedgerRow({ clinicId: "c1", linkId: "l4", businessDate: "2026-07-10", branch: "optometry", domain: "reception", kind: "hard", createdAt: "2026-07-10T10:00:00Z" }), // 超出 7 天
      ];
      const share = computeHardLinkShare(rows, 7, now);
      expect(share.hard).toBe(1);
      expect(share.soft).toBe(2);
      expect(share.total).toBe(3);
      expect(share.share).toBeCloseTo(1 / 3, 5);
      expect(share.byBranchDomain["optometry|reception"]).toEqual({ hard: 1, soft: 1, total: 2, share: 0.5 });
      expect(share.byBranchDomain["medical|optometry"]).toEqual({ hard: 0, soft: 1, total: 1, share: 0 });
    });
    it("空数据 share=null", () => {
      const share = computeHardLinkShare([], 7, new Date());
      expect(share.share).toBeNull();
      expect(share.total).toBe(0);
    });
  });

  describe("buildPreAttachConflictAttention", () => {
    it("attention_type=pre_attach_conflict, urgency=yellow（无 SLA 分级）", () => {
      const a = buildPreAttachConflictAttention({
        clinicId: "c1", compositionRunId: "r1", generatedAt: "t",
        reasonCodes: ["ambiguous_candidates"], autoAttachGateReasons: ["llm_audit_required"],
      });
      expect(a.attention_type).toBe("pre_attach_conflict");
      expect(a.urgency).toBe("yellow");
      expect(a.status).toBe("open");
      expect(a.composition_run_id).toBe("r1");
      expect(a.reasoning).toContain("r1");
    });
  });
});