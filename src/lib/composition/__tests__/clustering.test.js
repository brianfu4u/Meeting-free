import { describe, it, expect, vi } from "vitest";
import { clusterFactCards, clusterOrphans, buildCompositionClusters } from "../clustering";

const cards = [
  { id: "f1", artifact_id: "a1", explicit_workflow_id: "wf-1", _resolvedWorkflowId: "wf-1", _linkMethod: "explicit_id" },
  { id: "f2", artifact_id: "a2", explicit_workflow_id: "wf-1", _resolvedWorkflowId: "wf-1", _linkMethod: "spatiotemporal" },
  { id: "f3", artifact_id: "a3" }, // orphan
  { id: "f4", artifact_id: "a4" }, // orphan
  { id: "f5", artifact_id: "a5" }, // orphan
];

describe("clustering — clusterFactCards 列车编组（通用 workflow_id）", () => {
  it("同 workflow 归为同一列车，无主归 unlinked", () => {
    const { trains, unlinked } = clusterFactCards(cards);
    const t1 = trains.find((t) => t.workflow_id === "wf-1");
    expect(t1.fact_card_ids).toEqual(["f1", "f2"]);
    expect(t1.composition_type).toBe("attach");
    expect(unlinked.map((u) => u.fact_card_id)).toEqual(["f3", "f4", "f5"]);
  });
  it("空输入返回空结构", () => {
    expect(clusterFactCards([])).toEqual({ trains: [], unlinked: [] });
    expect(clusterFactCards(null)).toEqual({ trains: [], unlinked: [] });
  });
});

describe("clustering — 三个无主碎片共同生成 new_train", () => {
  const orphanCards = cards.filter((c) => !c._resolvedWorkflowId);

  it("LLM 将三个 orphan 聚为一个 new_train 候选", async () => {
    const invokeLLM = vi.fn(async () => ({
      clusters: [{ fact_card_ids: ["f3", "f4", "f5"], workflow_family_hint: "procurement", confidence: 0.8, reason: "同一采购单号 PO-77" }],
      unclustered: [],
    }));
    const { clusters, unclustered, manager_required } = await clusterOrphans({ orphanCards, invokeLLM });
    expect(clusters).toHaveLength(1);
    expect(clusters[0].composition_type).toBe("new_train");
    expect(clusters[0].fact_card_ids).toEqual(["f3", "f4", "f5"]);
    expect(clusters[0].artifact_ids).toEqual(["a3", "a4", "a5"]);
    expect(clusters[0].workflow_family_hint).toBe("procurement");
    expect(clusters[0].confidence).toBe(0.8);
    expect(unclustered).toHaveLength(0);
    expect(manager_required).toBe(false);
  });

  it("最多 3 个候选簇", async () => {
    const invokeLLM = vi.fn(async () => ({
      clusters: [
        { fact_card_ids: ["f3", "f4"] },
        { fact_card_ids: ["f4", "f5"] },
        { fact_card_ids: ["f3", "f5"] },
        { fact_card_ids: ["f3", "f4", "f5"] },
      ],
      unclustered: [],
    }));
    const { clusters } = await clusterOrphans({ orphanCards, invokeLLM });
    expect(clusters.length).toBeLessThanOrEqual(3);
  });

  it("无 invokeLLM 时全部保留为 unclustered，不臆测", async () => {
    const { clusters, unclustered, manager_required } = await clusterOrphans({ orphanCards });
    expect(clusters).toHaveLength(0);
    expect(unclustered).toHaveLength(3);
    expect(manager_required).toBe(false);
  });
});

describe("clustering — Orphan Cluster 程序校验（非法/重复/重叠）", () => {
  const orphanCards = cards.filter((c) => !c._resolvedWorkflowId);

  it("拒绝不存在的 fact_card_id，非法输出进入 manager_required", async () => {
    const invokeLLM = vi.fn(async () => ({
      clusters: [{ fact_card_ids: ["f3", "GHOST"] }],
      unclustered: [],
    }));
    const { clusters, manager_required } = await clusterOrphans({ orphanCards, invokeLLM });
    expect(clusters).toHaveLength(0);
    expect(manager_required).toBe(true);
  });

  it("簇内重复 ID 去重后不足 2 → 丢弃并 manager_required", async () => {
    const invokeLLM = vi.fn(async () => ({ clusters: [{ fact_card_ids: ["f3", "f3", "f3"] }], unclustered: [] }));
    const { clusters, manager_required } = await clusterOrphans({ orphanCards, invokeLLM });
    expect(clusters).toHaveLength(0);
    expect(manager_required).toBe(true);
  });

  it("重叠簇标记为同一 alternative_group，不可同时成立，且 manager_required", async () => {
    const invokeLLM = vi.fn(async () => ({
      clusters: [
        { fact_card_ids: ["f3", "f4"] },
        { fact_card_ids: ["f4", "f5"] },
      ],
      unclustered: [],
    }));
    const { clusters, manager_required, alternative_groups } = await clusterOrphans({ orphanCards, invokeLLM });
    expect(clusters).toHaveLength(2);
    expect(clusters[0].alternative_group).toBe(clusters[1].alternative_group);
    expect(alternative_groups).toHaveLength(1);
    expect(manager_required).toBe(true);
  });

  it("不重叠簇属于不同 alternative_group", async () => {
    const more = [
      ...orphanCards,
      { id: "f6", artifact_id: "a6" },
      { id: "f7", artifact_id: "a7" },
    ];
    const invokeLLM = vi.fn(async () => ({
      clusters: [
        { fact_card_ids: ["f3", "f4"] },
        { fact_card_ids: ["f6", "f7"] },
      ],
      unclustered: [],
    }));
    const { clusters, alternative_groups } = await clusterOrphans({ orphanCards: more, invokeLLM });
    expect(clusters[0].alternative_group).not.toBe(clusters[1].alternative_group);
    expect(alternative_groups).toHaveLength(2);
  });
});

describe("clustering — buildCompositionClusters 整合", () => {
  it("产出 attachTrains + newTrainCandidates + remainingOrphans", async () => {
    const invokeLLM = vi.fn(async () => ({
      clusters: [{ fact_card_ids: ["f3", "f4", "f5"], workflow_family_hint: "procurement", confidence: 0.7 }],
      unclustered: [],
    }));
    const res = await buildCompositionClusters({ factCards: cards, workflows: [], invokeLLM });
    expect(res.attachTrains).toHaveLength(1);
    expect(res.newTrainCandidates[0].composition_type).toBe("new_train");
    expect(res.remainingOrphans).toHaveLength(0);
    expect(res.orphan_manager_required).toBe(false);
  });
});