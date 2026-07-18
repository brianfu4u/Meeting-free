import { describe, it, expect } from "vitest";
import { validateHypotheses, compareHypotheses } from "../guardrailValidator";

const baseHyp = (over = {}) => ({
  workflow_hypothesis_id: "h1",
  workflow_family: "patient_visit",
  composition_type: "attach",
  target_workflow_id: "wf-1",
  ordered_artifact_ids: ["a1", "a2"],
  reasoning_tracks: {},
  unsupported_assumptions: [],
  contradictions: [],
  unexplained_artifact_ids: [],
  ...over,
});

const ctx = (over = {}) => ({
  artifacts: [
    { id: "a1", clinic_id: "c1", captured_at: "2026-07-18T09:10:00Z" },
    { id: "a2", clinic_id: "c1", captured_at: "2026-07-18T09:20:00Z" },
    { id: "a3", clinic_id: "c1", captured_at: "2026-07-18T09:30:00Z" },
  ],
  workflows: [{ id: "wf-1", clinic_id: "c1", arrival_time: "2026-07-18T09:00:00Z", open_loops: ["exam"] }],
  clinicId: "c1",
  now: new Date("2026-07-18T16:00:00Z").getTime(),
  ...over,
});

describe("guardrailValidator — 加权分数已彻底删除", () => {
  it("返回结构不含 score 字段", () => {
    const res = validateHypotheses([baseHyp()], ctx());
    expect(res.ranked[0]).not.toHaveProperty("score");
    expect(res.checked[0]).not.toHaveProperty("score");
  });
  it("compareHypotheses 仅顺序比较，无权重", () => {
    const a = baseHyp();
    const b = baseHyp();
    expect(compareHypotheses(a, b)).toBe(0);
  });
});

describe("guardrailValidator — 硬护栏独立阻断", () => {
  it("跨租户 Artifact 被阻断", () => {
    const res = validateHypotheses(
      [baseHyp()],
      ctx({ artifacts: [{ id: "a1", clinic_id: "c-evil" }, { id: "a2", clinic_id: "c1" }] })
    );
    expect(res.checked[0].blocked).toBe(true);
    expect(res.allBlocked).toBe(true);
    expect(res.needsManagerDispatch).toBe(true);
    expect(res.bestHypothesisId).toBeNull();
  });

  it("跨租户 Workflow 被阻断", () => {
    const res = validateHypotheses(
      [baseHyp()],
      ctx({ workflows: [{ id: "wf-1", clinic_id: "c-evil", arrival_time: "2026-07-18T09:00:00Z", open_loops: ["exam"] }] })
    );
    expect(res.checked[0].blocked).toBe(true);
    expect(res.checked[0].blocks.some((b) => b.rule_code === "cross_tenant_workflow")).toBe(true);
  });

  it("attach 目标 Workflow 不存在被阻断", () => {
    const res = validateHypotheses([baseHyp({ target_workflow_id: "wf-ghost" })], ctx({ workflows: [] }));
    expect(res.checked[0].blocked).toBe(true);
  });

  it("new_train 不得带 target_workflow_id", () => {
    const res = validateHypotheses([baseHyp({ composition_type: "new_train", target_workflow_id: "wf-1" })], ctx());
    expect(res.checked[0].blocked).toBe(true);
  });

  it("簇内 Artifact ID 重复被阻断", () => {
    const res = validateHypotheses([baseHyp({ ordered_artifact_ids: ["a1", "a1"] })], ctx());
    expect(res.checked[0].blocked).toBe(true);
    expect(res.checked[0].blocks.some((b) => b.rule_code === "duplicate_artifact_id")).toBe(true);
  });

  it("重复证据被阻断", () => {
    const res = validateHypotheses([baseHyp()], ctx({ committedArtifactIds: ["a1"] }));
    expect(res.checked[0].blocked).toBe(true);
  });
});

describe("guardrailValidator — 主体硬冲突阻断（结构化 rule_code）", () => {
  it("两个高可信不同主体 → subject_conflict 阻断", () => {
    const res = validateHypotheses(
      [baseHyp({ ordered_artifact_ids: ["a1", "a2"] })],
      ctx({
        artifacts: [
          { id: "a1", clinic_id: "c1", captured_at: "2026-07-18T09:10:00Z", subject_quality: "high", subject_fingerprint: { name: "张三" } },
          { id: "a2", clinic_id: "c1", captured_at: "2026-07-18T09:20:00Z", subject_quality: "high", subject_fingerprint: { name: "李四" } },
        ],
        guessPolicy: { hard_guardrails: [{ rule_code: "subject_conflict" }] },
      })
    );
    expect(res.checked[0].blocked).toBe(true);
    expect(res.checked[0].blocks.some((b) => b.rule_code === "subject_conflict")).toBe(true);
  });

  it("低可信主体不构成硬冲突（不阻断）", () => {
    const res = validateHypotheses(
      [baseHyp({ ordered_artifact_ids: ["a1", "a2"] })],
      ctx({
        artifacts: [
          { id: "a1", clinic_id: "c1", captured_at: "2026-07-18T09:10:00Z", subject_quality: "low", subject_fingerprint: { name: "张三" } },
          { id: "a2", clinic_id: "c1", captured_at: "2026-07-18T09:20:00Z", subject_quality: "low", subject_fingerprint: { name: "李四" } },
        ],
        guessPolicy: { hard_guardrails: [{ rule_code: "subject_conflict" }] },
      })
    );
    expect(res.checked[0].blocked).toBe(false);
  });
});

describe("guardrailValidator — 物理时间冲突阻断（结构化 rule_code）", () => {
  it("Artifact 时间在未来 → time_impossible 阻断", () => {
    const future = new Date("2026-07-18T16:00:00Z").getTime() + 2 * 24 * 60 * 60 * 1000;
    const res = validateHypotheses(
      [baseHyp({ ordered_artifact_ids: ["a1", "a2"] })],
      ctx({
        artifacts: [
          { id: "a1", clinic_id: "c1", captured_at: new Date(future).toISOString() },
          { id: "a2", clinic_id: "c1", captured_at: "2026-07-18T09:20:00Z" },
        ],
        guessPolicy: { hard_guardrails: [{ rule_code: "time_impossible", max_gap_minutes: 1440 }] },
      })
    );
    expect(res.checked[0].blocked).toBe(true);
    expect(res.checked[0].blocks.some((b) => b.rule_code === "time_impossible")).toBe(true);
  });

  it("Artifact 早于 Workflow 开始超过阈值 → time_impossible 阻断", () => {
    const res = validateHypotheses(
      [baseHyp({ ordered_artifact_ids: ["a1", "a2"] })],
      ctx({
        artifacts: [
          { id: "a1", clinic_id: "c1", captured_at: "2026-07-17T00:00:00Z" },
          { id: "a2", clinic_id: "c1", captured_at: "2026-07-18T09:20:00Z" },
        ],
        guessPolicy: { hard_guardrails: [{ rule_code: "time_impossible", max_gap_minutes: 1440 }] },
      })
    );
    expect(res.checked[0].blocked).toBe(true);
  });
});

describe("guardrailValidator — 顺序比较选择最佳假设", () => {
  it("解释碎片多者优先", () => {
    const h1 = baseHyp({ workflow_hypothesis_id: "h1", ordered_artifact_ids: ["a1", "a2"] });
    const h2 = baseHyp({ workflow_hypothesis_id: "h2", ordered_artifact_ids: ["a1", "a2", "a3"] });
    const res = validateHypotheses([h1, h2], ctx());
    expect(res.bestHypothesisId).toBe("h2");
    expect(res.needsManagerDispatch).toBe(false);
  });

  it("碎片数相同，无依据假设少者优先", () => {
    const h1 = baseHyp({ workflow_hypothesis_id: "h1", unsupported_assumptions: ["guess"] });
    const h2 = baseHyp({ workflow_hypothesis_id: "h2", unsupported_assumptions: [] });
    const res = validateHypotheses([h1, h2], ctx());
    expect(res.bestHypothesisId).toBe("h2");
  });

  it("前两项相同，矛盾少者优先", () => {
    const h1 = baseHyp({ workflow_hypothesis_id: "h1", contradictions: ["c1", "c2"] });
    const h2 = baseHyp({ workflow_hypothesis_id: "h2", contradictions: [] });
    const res = validateHypotheses([h1, h2], ctx());
    expect(res.bestHypothesisId).toBe("h2");
  });
});

describe("guardrailValidator — Tie 时 bestHypothesisId 必须为 null", () => {
  it("三项指标完全相同 → bestHypothesisId=null, needsManagerDispatch=true", () => {
    const h1 = baseHyp({ workflow_hypothesis_id: "h1" });
    const h2 = baseHyp({ workflow_hypothesis_id: "h2" });
    const res = validateHypotheses([h1, h2], ctx());
    expect(res.bestHypothesisId).toBeNull();
    expect(res.needsManagerDispatch).toBe(true);
  });
});

describe("guardrailValidator — 未使用轨道空数组不判违规", () => {
  it("全部轨道为空仍可通过", () => {
    const res = validateHypotheses([baseHyp({ reasoning_tracks: {} })], ctx());
    expect(res.checked[0].blocked).toBe(false);
    expect(res.checked[0].blocks).toEqual([]);
  });
});

describe("guardrailValidator — guardrail 是 needs_manager_dispatch 唯一来源", () => {
  it("单假设通过 → needsManagerDispatch=false", () => {
    const res = validateHypotheses([baseHyp()], ctx());
    expect(res.needsManagerDispatch).toBe(false);
    expect(res.bestHypothesisId).toBe("h1");
  });
});