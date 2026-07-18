import { describe, it, expect, vi } from "vitest";
import { clusterFactCards, clusterOrphans, buildCompositionClusters } from "../clustering";

const cards = [
  { id: "f1", artifact_id: "a1", _resolvedWorkflowId: "wf-1", _linkMethod: "explicit_id" },
  { id: "f2", artifact_id: "a2", _resolvedWorkflowId: "wf-1", _linkMethod: "spatiotemporal" },
  { id: "f3", artifact_id: "a3" }, // orphan
  { id: "f4", artifact_id: "a4" }, // orphan
  { id: "f5", artifact_id: "a5" }, // orphan
];

describe("clustering — clusterFactCards 列车编组（通用 workflow_id）", () => {
  it("同 workflow 归为同一列车，无主归 unlinked", () => {
    const { trains, unlinked } = clusterFactCards(cards);
    const t1 = trains.find((t) => t.workflow_id === "wf-1");
    expect(t1.fact_card_ids).toEqual(["f1", "f2"]);
    expect(t1.artifact_ids).toEqual(["a1", "a2"]);
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
    const { clusters, unclustered } = await clusterOrphans({ orphanCards, invokeLLM });
    expect(clusters).toHaveLength(1);
    expect(clusters[0].composition_type).toBe("new_train");
    expect(clusters[0].fact_card_ids).toEqual(["f3", "f4", "f5"]);
    expect(clusters[0].artifact_ids).toEqual(["a3", "a4", "a5"]);
    expect(clusters[0].workflow_family_hint).toBe("procurement");
    expect(clusters[0].confidence).toBe(0.8); // 仅记录
    expect(unclustered).toHaveLength(0);
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

  it("仅 1 张碎片无法成簇（每簇≥2），全部保留为 unclustered", async () => {
    const invokeLLM = vi.fn(async () => ({ clusters: [{ fact_card_ids: ["f3"] }], unclustered: ["f3", "f4", "f5"] }));
    const { clusters, unclustered } = await clusterOrphans({ orphanCards: [cards[2]], invokeLLM });
    expect(clusters).toHaveLength(0);
    expect(unclustered).toHaveLength(1);
  });

  it("无 invokeLLM 时全部保留为 unclustered，不臆测", async () => {
    const { clusters, unclustered } = await clusterOrphans({ orphanCards });
    expect(clusters).toHaveLength(0);
    expect(unclustered).toHaveLength(3);
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
    expect(res.attachTrains[0].composition_type).toBe("attach");
    expect(res.newTrainCandidates[0].composition_type).toBe("new_train");
    expect(res.remainingOrphans).toHaveLength(0);
  });
});