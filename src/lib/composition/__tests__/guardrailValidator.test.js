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
    { id: "a1", clinic_id: "c1" },
    { id: "a2", clinic_id: "c1" },
    { id: "a3", clinic_id: "c1" },
  ],
  workflows: [{ id: "wf-1", open_loops: ["exam"] }],
  clinicId: "c1",
  ...over,
});

describe("guardrailValidator — 加权分数已彻底删除", () => {
  it("返回结构不含 score 字段", () => {
    const res = validateHypotheses([baseHyp()], ctx());
    expect(res.ranked[0]).not.toHaveProperty("score");
    expect(res.checked[0]).not.toHaveProperty("score");
  });
  it("compareHypotheses 仅做顺序比较，无权重乘法", () => {
    const a = baseHyp({ ordered_artifact_ids: ["a1", "a2"], unsupported_assumptions: [], contradictions: [] });
    const b = baseHyp({ ordered_artifact_ids: ["a1", "a2"], unsupported_assumptions: [], contradictions: [] });
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
  });

  it("attach 目标 Workflow 不存在被阻断", () => {
    const res = validateHypotheses(
      [baseHyp({ target_workflow_id: "wf-ghost" })],
      ctx({ workflows: [] })
    );
    expect(res.checked[0].blocked).toBe(true);
  });

  it("new_train 不得带 target_workflow_id", () => {
    const res = validateHypotheses(
      [baseHyp({ composition_type: "new_train", target_workflow_id: "wf-1" })],
      ctx()
    );
    expect(res.checked[0].blocked).toBe(true);
  });

  it("重复证据被阻断", () => {
    const res = validateHypotheses(
      [baseHyp()],
      ctx({ committedArtifactIds: ["a1"] })
    );
    expect(res.checked[0].blocked).toBe(true);
  });

  it("不信任 LLM 自报：即使假设自带低 violations 数，仍按真实数据阻断", () => {
    // 假设没有自报字段，仅真实跨租户 → 必须阻断
    const h = baseHyp();
    delete h.guardrail_violations;
    const res = validateHypotheses(
      [h],
      ctx({ artifacts: [{ id: "a1", clinic_id: "c-evil" }, { id: "a2", clinic_id: "c1" }] })
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

describe("guardrailValidator — 多候选无法区分进入经理判断", () => {
  it("三项指标完全相同 → needsManagerDispatch", () => {
    const h1 = baseHyp({ workflow_hypothesis_id: "h1" });
    const h2 = baseHyp({ workflow_hypothesis_id: "h2" });
    const res = validateHypotheses([h1, h2], ctx());
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