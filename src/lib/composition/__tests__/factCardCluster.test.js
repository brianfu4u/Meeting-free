/**
 * Clinic OS V11 — FactCardCluster 单元测试
 *
 * 覆盖场景：
 *  1. aligned + aligned → 合并 aligned，confidence 取最小
 *  2. aligned + needs_clarification → 一票否决 needs_clarification，产出 veto issue
 *  3. 3 页以上单据 → member_count 正确，confidence 取三者最小
 *  4. 跨天上传（不同 business_date）→ 不同组（单页则归 singletons）
 *  5. 单页/无 session_hint → 零回归，走 singletons
 *  6. propagateGroupResolution：组内一员解析到 workflow → 全组继承
 *  7. buildMultipageVetoIssue：仅非 aligned 组产出 issue
 */
import { describe, it, expect } from "vitest";
import {
  clusterMultiPage,
  propagateGroupResolution,
  buildMultipageVetoIssue,
} from "../factCardCluster";

function card({ id, session, date, status, confidence, artifact_id, assembly_eligible = true }) {
  return {
    id,
    artifact_id: artifact_id || `${id}-art`,
    business_date: date,
    alignment_status: status,
    assembly_eligible: assembly_eligible,
    confidence,
    _session_hint: session,
    _resolvedWorkflowId: null,
    _linkMethod: null,
  };
}

describe("clusterMultiPage", () => {
  it("aligned + aligned → 合并 aligned，confidence 取最小", () => {
    const cards = [
      card({ id: "c1", session: "sess-001", date: "2026-07-23", status: "aligned", confidence: 0.95 }),
      card({ id: "c2", session: "sess-001", date: "2026-07-23", status: "aligned", confidence: 0.80 }),
    ];
    const { clusters, singletons } = clusterMultiPage(cards);
    expect(clusters).toHaveLength(1);
    expect(singletons).toHaveLength(0);
    expect(clusters[0].merged_alignment_status).toBe("aligned");
    expect(clusters[0].merged_confidence).toBe(0.80);
    expect(clusters[0].member_count).toBe(2);
    expect(clusters[0].fact_card_ids).toEqual(["c1", "c2"]);
    expect(clusters[0].veto_reasons).toEqual([]);
  });

  it("aligned + needs_clarification → 一票否决 needs_clarification", () => {
    const cards = [
      card({ id: "c1", session: "sess-001", date: "2026-07-23", status: "aligned", confidence: 0.95 }),
      card({ id: "c2", session: "sess-001", date: "2026-07-23", status: "needs_clarification", confidence: 0.50, assembly_eligible: false }),
    ];
    const { clusters } = clusterMultiPage(cards);
    expect(clusters[0].merged_alignment_status).toBe("needs_clarification");
    expect(clusters[0].merged_confidence).toBe(0.50);
    expect(clusters[0].veto_reasons).toHaveLength(1);
    expect(clusters[0].veto_reasons[0].fact_card_id).toBe("c2");
  });

  it("3 页以上单据 → member_count=3，confidence 取三者最小", () => {
    const cards = [
      card({ id: "c1", session: "sess-001", date: "2026-07-23", status: "aligned", confidence: 0.90 }),
      card({ id: "c2", session: "sess-001", date: "2026-07-23", status: "aligned", confidence: 0.72 }),
      card({ id: "c3", session: "sess-001", date: "2026-07-23", status: "aligned", confidence: 0.85 }),
    ];
    const { clusters } = clusterMultiPage(cards);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].member_count).toBe(3);
    expect(clusters[0].merged_confidence).toBe(0.72);
    expect(clusters[0].merged_alignment_status).toBe("aligned");
  });

  it("跨天上传（不同 business_date）→ 不同组", () => {
    const cards = [
      card({ id: "c1", session: "sess-001", date: "2026-07-23", status: "aligned", confidence: 0.9 }),
      card({ id: "c2", session: "sess-001", date: "2026-07-24", status: "aligned", confidence: 0.9 }),
    ];
    const { clusters, singletons } = clusterMultiPage(cards);
    // 不同天 → 每组只有 1 张 → 都归 singletons，不聚合
    expect(clusters).toHaveLength(0);
    expect(singletons).toHaveLength(2);
    expect(singletons.every((s) => s.multipage_group_id === null)).toBe(true);
  });

  it("同天但不同 session → 不同组（单页则 singletons）", () => {
    const cards = [
      card({ id: "c1", session: "sess-A", date: "2026-07-23", status: "aligned", confidence: 0.9 }),
      card({ id: "c2", session: "sess-B", date: "2026-07-23", status: "aligned", confidence: 0.9 }),
    ];
    const { clusters, singletons } = clusterMultiPage(cards);
    expect(clusters).toHaveLength(0);
    expect(singletons).toHaveLength(2);
  });

  it("无 session_hint → 零回归，归 singletons", () => {
    const cards = [
      card({ id: "c1", session: null, date: "2026-07-23", status: "aligned", confidence: 0.9 }),
      card({ id: "c2", session: "", date: "2026-07-23", status: "aligned", confidence: 0.9 }),
    ];
    const { clusters, singletons } = clusterMultiPage(cards);
    expect(clusters).toHaveLength(0);
    expect(singletons).toHaveLength(2);
  });

  it("空输入 → 空结果", () => {
    expect(clusterMultiPage([])).toEqual({ clusters: [], singletons: [] });
    expect(clusterMultiPage(null)).toEqual({ clusters: [], singletons: [] });
  });
});

describe("propagateGroupResolution", () => {
  it("组内一员 explicit_id 解析到 workflow → 全组继承", () => {
    const cards = [
      { ...card({ id: "c1", session: "s1", date: "d1", status: "aligned", confidence: 0.9 }), _resolvedWorkflowId: "wf-99", _linkMethod: "explicit_id" },
      { ...card({ id: "c2", session: "s1", date: "d1", status: "aligned", confidence: 0.9 }), _resolvedWorkflowId: null, _linkMethod: "unlinked" },
    ];
    const { clusters } = clusterMultiPage(cards);
    const propagated = propagateGroupResolution(cards, clusters);
    expect(propagated[0]._resolvedWorkflowId).toBe("wf-99");
    expect(propagated[1]._resolvedWorkflowId).toBe("wf-99");
    expect(propagated[1]._linkMethod).toBe("multipage_inherited");
  });

  it("无 multipage cluster → 原样返回（零回归）", () => {
    const cards = [card({ id: "c1", session: null, date: "d1", status: "aligned", confidence: 0.9 })];
    expect(propagateGroupResolution(cards, [])).toBe(cards);
  });

  it("组内无任何解析 → 不变", () => {
    const cards = [
      card({ id: "c1", session: "s1", date: "d1", status: "aligned", confidence: 0.9 }),
      card({ id: "c2", session: "s1", date: "d1", status: "aligned", confidence: 0.9 }),
    ];
    const { clusters } = clusterMultiPage(cards);
    const propagated = propagateGroupResolution(cards, clusters);
    expect(propagated.every((c) => c._resolvedWorkflowId === null)).toBe(true);
  });
});

describe("buildMultipageVetoIssue", () => {
  it("仅非 aligned 组产出 issue（Guardrail 拦截自动挂接）", () => {
    const clusters = [
      { multipage_group_id: "mpg::ok", merged_alignment_status: "aligned", fact_card_ids: ["c1"], artifact_ids: ["a1"], veto_reasons: [] },
      { multipage_group_id: "mpg::bad", merged_alignment_status: "needs_clarification", fact_card_ids: ["c2", "c3"], artifact_ids: ["a2", "a3"], veto_reasons: [{ fact_card_id: "c3", alignment_status: "needs_clarification" }] },
    ];
    const issues = buildMultipageVetoIssue(clusters);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("multipage_clarification_required");
    expect(issues[0].semantic_class).toBe("multipage_veto");
    expect(issues[0].multipage_group_id).toBe("mpg::bad");
    expect(issues[0].fact_card_ids).toEqual(["c2", "c3"]);
  });

  it("全 aligned → 无 issue", () => {
    const clusters = [
      { multipage_group_id: "mpg::ok", merged_alignment_status: "aligned", fact_card_ids: ["c1"], artifact_ids: ["a1"], veto_reasons: [] },
    ];
    expect(buildMultipageVetoIssue(clusters)).toEqual([]);
  });

  it("空输入 → 无 issue", () => {
    expect(buildMultipageVetoIssue([])).toEqual([]);
    expect(buildMultipageVetoIssue(null)).toEqual([]);
  });
});