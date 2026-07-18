import { describe, it, expect } from "vitest";
import { validateHypotheses, compareHypotheses } from "../guardrailValidator";

const baseHyp = (over = {}) => ({
  workflow_hypothesis_id: "h1",
  workflow_family: "patient_visit",
  composition_type: "attach",
  target_workflow_id: "wf-1",
  target_snapshot_id: "snap-1",
  target_snapshot_version: 3,
  ordered_artifact_ids: ["a1", "a2"],
  reasoning_tracks: {},
  unsupported_assumptions: [],
  contradictions: [],
  unexplained_artifact_ids: [],
  ...over,
});

const ctx = (over = {}) => ({
  artifacts: [
    { id: "a1", clinic_id: "c1" },
    { id: "a2", clinic_id: "c1" },
    { id: "a3", clinic_id: "c1" },
  ],
  workflows: [{ id: "wf-1", clinic_id: "c1", started_at: "2026-07-18T09:00:00Z", open_loops: ["exam"] }],
  snapshots: [{ id: "snap-1", clinic_id: "c1", workflow_id: "wf-1", snapshot_version: 3 }],
  factCards: [
    { artifact_id: "a1", subject_quality: "high", subject_fingerprint: { name: "张三" }, occurred_at: "2026-07-18T09:10:00Z" },
    { artifact_id: "a2", subject_quality: "high", subject_fingerprint: { name: "张三" }, occurred_at: "2026-07-18T09:20:00Z" },
  ],
  clinicId: "c1",
  now: new Date("2026-07-18T16:00:00Z").getTime(),
  ...over,
});

describe("guardrailValidator — 无 score 字段", () => {
  it("返回结构不含 score", () => {
    const res = validateHypotheses([baseHyp()], ctx());
    expect(res.ranked[0]).not.toHaveProperty("score");
  });
});

describe("guardrailValidator — 硬护栏独立阻断", () => {
  it("跨租户 Artifact 阻断", () => {
    const res = validateHypotheses([baseHyp()], ctx({ artifacts: [{ id: "a1", clinic_id: "c-evil" }, { id: "a2", clinic_id: "c1" }] }));
    expect(res.allBlocked).toBe(true);
    expect(res.bestHypothesisId).toBeNull();
  });
  it("跨租户 Workflow 阻断", () => {
    const res = validateHypotheses([baseHyp()], ctx({ workflows: [{ id: "wf-1", clinic_id: "c-evil", started_at: "2026-07-18T09:00:00Z", open_loops: ["exam"] }] }));
    expect(res.checked[0].blocks.some((b) => b.rule_code === "cross_tenant_workflow")).toBe(true);
  });
  it("目标 Workflow 不存在阻断", () => {
    const res = validateHypotheses([baseHyp({ target_workflow_id: "wf-ghost" })], ctx({ workflows: [] }));
    expect(res.checked[0].blocked).toBe(true);
  });
  it("new_train 不得带 target_workflow_id", () => {
    const res = validateHypotheses([baseHyp({ composition_type: "new_train", target_workflow_id: "wf-1", target_snapshot_id: null, target_snapshot_version: null })], ctx());
    expect(res.checked[0].blocked).toBe(true);
  });
  it("簇内 Artifact ID 重复阻断", () => {
    const res = validateHypotheses([baseHyp({ ordered_artifact_ids: ["a1", "a1"] })], ctx());
    expect(res.checked[0].blocks.some((b) => b.rule_code === "duplicate_artifact_id")).toBe(true);
  });
});

describe("guardrailValidator — Snapshot 校验", () => {
  it("Snapshot 不存在阻断", () => {
    const res = validateHypotheses([baseHyp({ target_snapshot_id: "snap-ghost" })], ctx());
    expect(res.checked[0].blocks.some((b) => b.rule_code === "target_snapshot_not_found")).toBe(true);
  });
  it("跨租户 Snapshot 阻断", () => {
    const res = validateHypotheses([baseHyp()], ctx({ snapshots: [{ id: "snap-1", clinic_id: "c-evil", snapshot_version: 3 }] }));
    expect(res.checked[0].blocks.some((b) => b.rule_code === "cross_tenant_snapshot")).toBe(true);
  });
  it("snapshot_version 不一致 → stale_proposal 阻断", () => {
    const res = validateHypotheses([baseHyp({ target_snapshot_version: 4 })], ctx());
    expect(res.checked[0].blocks.some((b) => b.rule_code === "stale_proposal")).toBe(true);
  });
});

describe("guardrailValidator — 主体冲突读取 EvidenceFactCard", () => {
  it("两个高可信不同主体（FactCard）→ subject_conflict 阻断", () => {
    const res = validateHypotheses(
      [baseHyp()],
      ctx({
        factCards: [
          { artifact_id: "a1", subject_quality: "high", subject_fingerprint: { name: "张三" } },
          { artifact_id: "a2", subject_quality: "high", subject_fingerprint: { name: "李四" } },
        ],
        guessPolicy: { hard_guardrails: [{ rule_code: "subject_conflict" }] },
      })
    );
    expect(res.checked[0].blocks.some((b) => b.rule_code === "subject_conflict")).toBe(true);
  });
  it("低可信主体不构成硬冲突", () => {
    const res = validateHypotheses(
      [baseHyp()],
      ctx({
        factCards: [
          { artifact_id: "a1", subject_quality: "low", subject_fingerprint: { name: "张三" } },
          { artifact_id: "a2", subject_quality: "low", subject_fingerprint: { name: "李四" } },
        ],
        guessPolicy: { hard_guardrails: [{ rule_code: "subject_conflict" }] },
      })
    );
    expect(res.checked[0].blocked).toBe(false);
  });
});

describe("guardrailValidator — 物理时间冲突（读取 FactCard.occurred_at）", () => {
  it("时间在未来阻断", () => {
    const future = new Date("2026-07-18T16:00:00Z").getTime() + 2 * 86400000;
    const res = validateHypotheses(
      [baseHyp()],
      ctx({
        factCards: [
          { artifact_id: "a1", subject_quality: "high", subject_fingerprint: { name: "张三" }, occurred_at: new Date(future).toISOString() },
          { artifact_id: "a2", subject_quality: "high", subject_fingerprint: { name: "张三" }, occurred_at: "2026-07-18T09:20:00Z" },
        ],
        guessPolicy: { hard_guardrails: [{ rule_code: "time_impossible", max_gap_minutes: 1440 }] },
      })
    );
    expect(res.checked[0].blocks.some((b) => b.rule_code === "time_impossible")).toBe(true);
  });
  it("早于 Workflow 开始超过阈值阻断", () => {
    const res = validateHypotheses(
      [baseHyp()],
      ctx({
        factCards: [
          { artifact_id: "a1", subject_quality: "high", subject_fingerprint: { name: "张三" }, occurred_at: "2026-07-17T00:00:00Z" },
          { artifact_id: "a2", subject_quality: "high", subject_fingerprint: { name: "张三" }, occurred_at: "2026-07-18T09:20:00Z" },
        ],
        guessPolicy: { hard_guardrails: [{ rule_code: "time_impossible", max_gap_minutes: 1440 }] },
      })
    );
    expect(res.checked[0].blocks.some((b) => b.rule_code === "time_impossible")).toBe(true);
  });
});

describe("guardrailValidator — legacy_text / 未知 rule_code 不静默忽略", () => {
  it("legacy_text 规则阻断（推动迁移）", () => {
    const res = validateHypotheses([baseHyp()], ctx({ guessPolicy: { hard_guardrails: [{ rule_code: "legacy_text", original: "旧规则" }] } }));
    expect(res.checked[0].blocks.some((b) => b.rule_code === "legacy_text")).toBe(true);
  });
  it("未知 rule_code 阻断", () => {
    const res = validateHypotheses([baseHyp()], ctx({ guessPolicy: { hard_guardrails: [{ rule_code: "totally_unknown" }] } }));
    expect(res.checked[0].blocks.some((b) => b.rule_code === "unknown_rule")).toBe(true);
  });
});

describe("guardrailValidator — 顺序比较选择最佳", () => {
  it("解释碎片多者优先", () => {
    const h1 = baseHyp({ workflow_hypothesis_id: "h1", ordered_artifact_ids: ["a1", "a2"] });
    const h2 = baseHyp({ workflow_hypothesis_id: "h2", ordered_artifact_ids: ["a1", "a2", "a3"] });
    const res = validateHypotheses([h1, h2], ctx());
    expect(res.bestHypothesisId).toBe("h2");
    expect(res.needsManagerDispatch).toBe(false);
  });
  it("无依据假设少者优先", () => {
    const h1 = baseHyp({ workflow_hypothesis_id: "h1", unsupported_assumptions: ["g"] });
    const h2 = baseHyp({ workflow_hypothesis_id: "h2", unsupported_assumptions: [] });
    const res = validateHypotheses([h1, h2], ctx());
    expect(res.bestHypothesisId).toBe("h2");
  });
});

describe("guardrailValidator — Tie → bestHypothesisId=null", () => {
  it("三项相同 → null + needsManagerDispatch=true", () => {
    const res = validateHypotheses([baseHyp({ workflow_hypothesis_id: "h1" }), baseHyp({ workflow_hypothesis_id: "h2" })], ctx());
    expect(res.bestHypothesisId).toBeNull();
    expect(res.needsManagerDispatch).toBe(true);
  });
});

describe("guardrailValidator — validation_issues 汇入 needs_manager_dispatch（唯一来源）", () => {
  it("假设通过但 clustering 有 validation_issues → needsManagerDispatch=true", () => {
    const res = validateHypotheses([baseHyp()], ctx({ validationIssues: [{ type: "orphan_cluster_overlap" }] }));
    expect(res.needsManagerDispatch).toBe(true);
    expect(res.validationIssues).toHaveLength(1);
  });
  it("单假设通过且无 issues → needsManagerDispatch=false", () => {
    const res = validateHypotheses([baseHyp()], ctx());
    expect(res.needsManagerDispatch).toBe(false);
    expect(res.bestHypothesisId).toBe("h1");
  });
});

describe("guardrailValidator — 未使用轨道空数组不判违规", () => {
  it("全部轨道为空仍可通过", () => {
    const res = validateHypotheses([baseHyp({ reasoning_tracks: {} })], ctx());
    expect(res.checked[0].blocks).toEqual([]);
  });
});

describe("guardrailValidator — 项3：attach 必须携带 snapshot + workflow_id 一致 + 版本缺失阻断", () => {
  it("attach 缺 target_snapshot_id 阻断", () => {
    const res = validateHypotheses([baseHyp({ target_snapshot_id: null, target_snapshot_version: null })], ctx());
    expect(res.checked[0].blocks.some((b) => b.rule_code === "attach_without_snapshot")).toBe(true);
  });
  it("attach 缺 target_snapshot_version 阻断", () => {
    const res = validateHypotheses([baseHyp({ target_snapshot_version: null })], ctx());
    expect(res.checked[0].blocks.some((b) => b.rule_code === "attach_without_snapshot_version")).toBe(true);
  });
  it("snapshot.workflow_id !== target_workflow_id 阻断", () => {
    const res = validateHypotheses([baseHyp()], ctx({ snapshots: [{ id: "snap-1", clinic_id: "c1", workflow_id: "wf-other", snapshot_version: 3 }] }));
    expect(res.checked[0].blocks.some((b) => b.rule_code === "snapshot_workflow_mismatch")).toBe(true);
  });
  it("snapshot 实际版本缺失（null）阻断为 stale_proposal", () => {
    const res = validateHypotheses([baseHyp()], ctx({ snapshots: [{ id: "snap-1", clinic_id: "c1", workflow_id: "wf-1", snapshot_version: null }] }));
    expect(res.checked[0].blocks.some((b) => b.rule_code === "stale_proposal")).toBe(true);
  });
  it("attach 全部一致则通过", () => {
    const res = validateHypotheses([baseHyp()], ctx());
    expect(res.checked[0].blocked).toBe(false);
    expect(res.bestHypothesisId).toBe("h1");
  });
});

describe("guardrailValidator — 项4：validationIssues 非空 → bestHypothesisId=null", () => {
  it("有明确最佳但 validationIssues 非空 → bestHypothesisId=null 且 needsManagerDispatch=true", () => {
    const h1 = baseHyp({ workflow_hypothesis_id: "h1", ordered_artifact_ids: ["a1", "a2"] });
    const h2 = baseHyp({ workflow_hypothesis_id: "h2", ordered_artifact_ids: ["a1", "a2", "a3"] });
    const res = validateHypotheses([h1, h2], ctx({ validationIssues: [{ type: "orphan_cluster_overlap" }] }));
    expect(res.needsManagerDispatch).toBe(true);
    expect(res.bestHypothesisId).toBeNull();
  });
});

describe("guardrailValidator — R2.4：Guardrail 自身要求 clinicId", () => {
  it("缺 clinicId 抛错", () => {
    expect(() => validateHypotheses([baseHyp()], { artifacts: [], workflows: [], snapshots: [] })).toThrow(/clinicId required/);
  });
});

describe("guardrailValidator — R2.4：Artifact/Workflow/Snapshot 缺 clinic_id 阻断", () => {
  it("Artifact 缺 clinic_id → missing_tenant_artifact", () => {
    const res = validateHypotheses([baseHyp()], ctx({ artifacts: [{ id: "a1", clinic_id: "c1" }, { id: "a2" }] }));
    expect(res.checked[0].blocks.some((b) => b.rule_code === "missing_tenant_artifact" && b.artifact_id === "a2")).toBe(true);
  });
  it("Workflow 缺 clinic_id → missing_tenant_workflow", () => {
    const res = validateHypotheses([baseHyp()], ctx({ workflows: [{ id: "wf-1", started_at: "2026-07-18T09:00:00Z", open_loops: ["exam"] }] }));
    expect(res.checked[0].blocks.some((b) => b.rule_code === "missing_tenant_workflow")).toBe(true);
  });
  it("Snapshot 缺 clinic_id → missing_tenant_snapshot", () => {
    const res = validateHypotheses([baseHyp()], ctx({ snapshots: [{ id: "snap-1", workflow_id: "wf-1", snapshot_version: 3 }] }));
    expect(res.checked[0].blocks.some((b) => b.rule_code === "missing_tenant_snapshot")).toBe(true);
  });
});

describe("guardrailValidator — R2.4：Snapshot 缺 workflow_id 阻断", () => {
  it("snapshot.workflow_id 缺失 → snapshot_workflow_mismatch", () => {
    const res = validateHypotheses([baseHyp()], ctx({ snapshots: [{ id: "snap-1", clinic_id: "c1", snapshot_version: 3 }] }));
    expect(res.checked[0].blocks.some((b) => b.rule_code === "snapshot_workflow_mismatch")).toBe(true);
  });
  it("snapshot.workflow_id 不等于 target → snapshot_workflow_mismatch", () => {
    const res = validateHypotheses([baseHyp()], ctx({ snapshots: [{ id: "snap-1", clinic_id: "c1", workflow_id: "wf-other", snapshot_version: 3 }] }));
    expect(res.checked[0].blocks.some((b) => b.rule_code === "snapshot_workflow_mismatch")).toBe(true);
  });
});