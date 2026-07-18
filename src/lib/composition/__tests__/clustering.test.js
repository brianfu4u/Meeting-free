import { describe, it, expect, vi } from "vitest";
import { clusterFactCards, clusterOrphans, buildCompositionClusters } from "../clustering";

const cards = [
  { id: "f1", artifact_id: "a1", explicit_workflow_id: "wf-1", _resolvedWorkflowId: "wf-1", _linkMethod: "explicit_id" },
  { id: "f2", artifact_id: "a2", explicit_workflow_id: "wf-1", _resolvedWorkflowId: "wf-1", _linkMethod: "spatiotemporal" },
  { id: "f3", artifact_id: "a3" },
  { id: "f4", artifact_id: "a4" },
  { id: "f5", artifact_id: "a5" },
];

describe("clustering — clusterFactCards 列车编组", () => {
  it("同 workflow 归为同一列车，无主归 unlinked", () => {
    const { trains, unlinked } = clusterFactCards(cards);
    expect(trains.find((t) => t.workflow_id === "wf-1").fact_card_ids).toEqual(["f1", "f2"]);
    expect(unlinked.map((u) => u.fact_card_id)).toEqual(["f3", "f4", "f5"]);
  });
});

describe("clustering — 三个无主碎片生成 new_train", () => {
  const orphanCards = cards.filter((c) => !c._resolvedWorkflowId);
  it("LLM 聚为一个 new_train", async () => {
    const invokeLLM = vi.fn(async () => ({ clusters: [{ fact_card_ids: ["f3", "f4", "f5"], workflow_family_hint: "procurement", confidence: 0.8, reason: "PO-77" }], unclustered: [] }));
    const { clusters, unclustered, validation_issues } = await clusterOrphans({ orphanCards, invokeLLM });
    expect(clusters).toHaveLength(1);
    expect(clusters[0].composition_type).toBe("new_train");
    expect(clusters[0].fact_card_ids).toEqual(["f3", "f4", "f5"]);
    expect(unclustered).toHaveLength(0);
    expect(validation_issues).toHaveLength(0);
  });
});

describe("clustering — Orphan Cluster 整簇校验（非法/重复整簇作废）", () => {
  const orphanCards = cards.filter((c) => !c._resolvedWorkflowId);

  it("包含不存在 ID → 整簇作废，进入 validation_issues", async () => {
    const invokeLLM = vi.fn(async () => ({ clusters: [{ fact_card_ids: ["f3", "GHOST"] }], unclustered: [] }));
    const { clusters, validation_issues } = await clusterOrphans({ orphanCards, invokeLLM });
    expect(clusters).toHaveLength(0);
    expect(validation_issues.some((v) => v.type === "orphan_cluster_illegal" && v.reason === "nonexistent_id")).toBe(true);
  });

  it("簇内重复 ID → 整簇作废（不过滤去重后继续接受）", async () => {
    const invokeLLM = vi.fn(async () => ({ clusters: [{ fact_card_ids: ["f3", "f3", "f4"] }], unclustered: [] }));
    const { clusters, validation_issues } = await clusterOrphans({ orphanCards, invokeLLM });
    expect(clusters).toHaveLength(0);
    expect(validation_issues.some((v) => v.type === "orphan_cluster_illegal" && v.reason === "duplicate_id")).toBe(true);
  });

  it("簇不足 2 → 整簇作废", async () => {
    const invokeLLM = vi.fn(async () => ({ clusters: [{ fact_card_ids: ["f3"] }], unclustered: [] }));
    const { clusters, validation_issues } = await clusterOrphans({ orphanCards, invokeLLM });
    expect(clusters).toHaveLength(0);
    expect(validation_issues.some((v) => v.type === "orphan_cluster_too_small")).toBe(true);
  });

  it("重叠簇标记同一 alternative_group 并记入 validation_issues", async () => {
    const invokeLLM = vi.fn(async () => ({ clusters: [{ fact_card_ids: ["f3", "f4"] }, { fact_card_ids: ["f4", "f5"] }], unclustered: [] }));
    const { clusters, validation_issues, alternative_groups } = await clusterOrphans({ orphanCards, invokeLLM });
    expect(clusters[0].alternative_group).toBe(clusters[1].alternative_group);
    expect(alternative_groups).toHaveLength(1);
    expect(validation_issues.some((v) => v.type === "orphan_cluster_overlap")).toBe(true);
  });

  it("不重叠簇属于不同 alternative_group，无 overlap issue", async () => {
    const more = [...orphanCards, { id: "f6", artifact_id: "a6" }, { id: "f7", artifact_id: "a7" }];
    const invokeLLM = vi.fn(async () => ({ clusters: [{ fact_card_ids: ["f3", "f4"] }, { fact_card_ids: ["f6", "f7"] }], unclustered: [] }));
    const { clusters, validation_issues, alternative_groups } = await clusterOrphans({ orphanCards: more, invokeLLM });
    expect(clusters[0].alternative_group).not.toBe(clusters[1].alternative_group);
    expect(alternative_groups).toHaveLength(2);
    expect(validation_issues).toHaveLength(0);
  });
});

describe("clustering — 不输出 manager_required，仅 validation_issues", () => {
  it("buildCompositionClusters 无 manager_required/orphan_manager_required 字段", async () => {
    const invokeLLM = vi.fn(async () => ({ clusters: [{ fact_card_ids: ["f3", "f4", "f5"], workflow_family_hint: "procurement" }], unclustered: [] }));
    const res = await buildCompositionClusters({ factCards: cards, workflows: [], invokeLLM });
    expect(res).not.toHaveProperty("manager_required");
    expect(res).not.toHaveProperty("orphan_manager_required");
    expect(res).toHaveProperty("validation_issues");
  });

  it("非法聚类时 validation_issues 非空，供 Guardrail 决策", async () => {
    const invokeLLM = vi.fn(async () => ({ clusters: [{ fact_card_ids: ["f3", "GHOST"] }], unclustered: [] }));
    const res = await buildCompositionClusters({ factCards: cards, workflows: [], invokeLLM });
    expect(res.validation_issues.length).toBeGreaterThan(0);
  });
});