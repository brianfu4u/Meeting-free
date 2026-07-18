/**
 * Clinic OS V10 — Clustering（修订版）
 *
 * 修订要点：
 * - 新增 Orphan-to-Orphan 多碎片编组：多个无 workflow_id 的 FactCard 可相互建立候选关联，
 *   形成 1~3 个候选 new_train 簇；
 * - 列车编组改用通用 workflow_id（替代 session_id）；
 * - 孤立碎片聚类由 LLM 推断（可注入 mock），confidence 仅记录不决定状态。
 */

import { buildOrphanClusterPrompt, ORPHAN_CLUSTER_JSON_SCHEMA } from "./prompts";

/**
 * 将已归属的 FactCard 按 workflow_id 聚类为「编组列车」；无主碎片归 unlinked。
 * 输入 factCards 需带 _resolvedWorkflowId 与 _linkMethod（由 Candidate Finder 注入）。
 */
export function clusterFactCards(factCards) {
  if (!Array.isArray(factCards)) return { trains: [], unlinked: [] };
  const trainMap = new Map();
  const unlinked = [];

  for (const card of factCards) {
    const wid = card._resolvedWorkflowId || card.workflow_id;
    const method = card._linkMethod || (wid ? "explicit_id" : "unlinked");
    if (!wid) {
      unlinked.push({ fact_card_id: card.id, artifact_id: card.artifact_id, reason: "无归属 workflow" });
      continue;
    }
    if (!trainMap.has(wid)) {
      trainMap.set(wid, { workflow_id: wid, fact_card_ids: [], artifact_ids: [], methods: new Set() });
    }
    const train = trainMap.get(wid);
    train.fact_card_ids.push(card.id);
    if (card.artifact_id) train.artifact_ids.push(card.artifact_id);
    train.methods.add(method);
  }

  const trains = [...trainMap.values()].map((t) => ({
    workflow_id: t.workflow_id,
    fact_card_ids: t.fact_card_ids,
    artifact_ids: t.artifact_ids,
    methods: [...t.methods],
    composition_type: "attach",
  }));

  return { trains, unlinked };
}

/**
 * Orphan-to-Orphan 聚类：将多个无主碎片由 LLM 推断是否可共同形成 new_train。
 * 输出候选簇列表（最多 maxClusters 个），每簇至少 2 张碎片；无法成簇的保留为 unclustered。
 * confidence 仅记录，不决定自动挂接。
 */
export async function clusterOrphans({ orphanCards, invokeLLM, maxClusters = 3 }) {
  if (!Array.isArray(orphanCards) || orphanCards.length === 0) {
    return { clusters: [], unclustered: [] };
  }
  if (!invokeLLM) {
    // 无 LLM 无法推断 orphan 间关联，全部保留，不臆测
    return {
      clusters: [],
      unclustered: orphanCards.map((c) => ({ fact_card_id: c.id, artifact_id: c.artifact_id })),
    };
  }

  const prompt = buildOrphanClusterPrompt({ orphanCards });
  const result = await invokeLLM({
    prompt,
    response_json_schema: ORPHAN_CLUSTER_JSON_SCHEMA,
    model: "automatic",
  });

  const rawClusters = (result?.clusters || [])
    .filter((cl) => (cl.fact_card_ids || []).length >= 2)
    .slice(0, maxClusters);

  const clusters = rawClusters.map((cl, i) => {
    const ids = cl.fact_card_ids || [];
    const cardsInCluster = orphanCards.filter((c) => ids.includes(c.id));
    return {
      cluster_id: `new_train-${i + 1}`,
      fact_card_ids: ids,
      artifact_ids: cardsInCluster.map((c) => c.artifact_id).filter(Boolean),
      workflow_family_hint: cl.workflow_family_hint || null,
      confidence: cl.confidence ?? null, // 仅记录
      reason: cl.reason || "",
      composition_type: "new_train",
    };
  });

  const clusteredIds = new Set(clusters.flatMap((c) => c.fact_card_ids));
  const unclustered = orphanCards
    .filter((c) => !clusteredIds.has(c.id))
    .map((c) => ({ fact_card_id: c.id, artifact_id: c.artifact_id }));

  return { clusters, unclustered };
}

/**
 * 整合：产出 attach 列车 + new_train 候选 + 剩余孤立碎片。
 */
export async function buildCompositionClusters({ factCards, workflows, invokeLLM }) {
  const { trains, unlinked } = clusterFactCards(factCards);
  const orphanCards = unlinked
    .map((u) => factCards.find((c) => c.id === u.fact_card_id))
    .filter(Boolean);

  const { clusters: newTrainCandidates, unclustered } = await clusterOrphans({ orphanCards, invokeLLM });

  return {
    attachTrains: trains,
    newTrainCandidates,
    remainingOrphans: unclustered,
  };
}

/**
 * 按 workflow_family 二次分桶（不同业务线不混编）。
 */
export function clusterByBusinessLine(factCards, workflows) {
  const base = clusterFactCards(factCards);
  const wfLine = new Map((workflows || []).map((w) => [w.id, w.workflow_family]));
  const byLine = new Map();
  for (const train of base.trains) {
    const line = wfLine.get(train.workflow_id) || "unknown";
    if (!byLine.has(line)) byLine.set(line, []);
    byLine.get(line).push(train);
  }
  return {
    trainsByLine: [...byLine.entries()].map(([line, trains]) => ({ workflow_family: line, trains })),
    unlinked: base.unlinked,
  };
}