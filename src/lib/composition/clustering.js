/**
 * Clinic OS V10 — Clustering（修订版 R2）
 *
 * R2：
 * - 通用 workflow_id 契约（explicit_workflow_id）；
 * - clusterOrphans 程序校验：ID 真实、每簇≥2 不同碎片、拒绝重复、重叠簇标记 alternative_group、
 *   非法 LLM 输出进入 orphan/manager_required。
 */

import { buildOrphanClusterPrompt, ORPHAN_CLUSTER_JSON_SCHEMA } from "./prompts";

export function clusterFactCards(factCards) {
  if (!Array.isArray(factCards)) return { trains: [], unlinked: [] };
  const trainMap = new Map();
  const unlinked = [];

  for (const card of factCards) {
    const wid = card._resolvedWorkflowId || card.explicit_workflow_id;
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
 * Orphan-to-Orphan 聚类 + 程序校验。
 * 校验规则：
 * - fact_card_id 必须真实存在于 orphanCards；
 * - 簇内去重；
 * - 每簇 ≥2 不同碎片，否则丢弃为非法；
 * - 跨簇重叠（共享 fact_card_id）→ 同一 alternative_group，不可同时成立；
 * - 非法/重叠 → manager_required=true。
 */
export async function clusterOrphans({ orphanCards, invokeLLM, maxClusters = 3 }) {
  if (!Array.isArray(orphanCards) || orphanCards.length === 0) {
    return { clusters: [], unclustered: [], manager_required: false, alternative_groups: [] };
  }
  if (!invokeLLM) {
    return {
      clusters: [],
      unclustered: orphanCards.map((c) => ({ fact_card_id: c.id, artifact_id: c.artifact_id })),
      manager_required: false,
      alternative_groups: [],
    };
  }

  const orphanIds = new Set(orphanCards.map((c) => c.id));
  const cardById = new Map(orphanCards.map((c) => [c.id, c]));

  const prompt = buildOrphanClusterPrompt({ orphanCards });
  const result = await invokeLLM({
    prompt,
    response_json_schema: ORPHAN_CLUSTER_JSON_SCHEMA,
    model: "automatic",
  });

  const rawClusters = (result?.clusters || []).slice(0, maxClusters);
  const valid = [];
  let invalidDropped = 0;

  for (const raw of rawClusters) {
    const rawIds = raw?.fact_card_ids || [];
    // 1. 真实性：仅保留存在的 id
    const realIds = rawIds.filter((id) => orphanIds.has(id));
    if (realIds.length !== rawIds.length) invalidDropped++;
    // 2. 簇内去重
    const distinctIds = [...new Set(realIds)];
    if (distinctIds.length !== realIds.length) invalidDropped++;
    // 3. 每簇 ≥2 不同碎片
    if (distinctIds.length < 2) {
      invalidDropped++;
      continue;
    }
    valid.push({
      fact_card_ids: distinctIds,
      workflow_family_hint: raw.workflow_family_hint || null,
      confidence: raw.confidence ?? null,
      reason: raw.reason || "",
    });
  }

  // 4. 跨簇重叠 → alternative_group
  const groups = assignAlternativeGroups(valid);
  const groupCount = new Map();
  groups.forEach((g) => groupCount.set(g, (groupCount.get(g) || 0) + 1));
  const hasOverlap = [...groupCount.values()].some((c) => c > 1);

  const clusters = valid.map((cl, i) => ({
    cluster_id: `new_train-${i + 1}`,
    fact_card_ids: cl.fact_card_ids,
    artifact_ids: cl.fact_card_ids.map((id) => cardById.get(id)?.artifact_id).filter(Boolean),
    workflow_family_hint: cl.workflow_family_hint,
    confidence: cl.confidence,
    reason: cl.reason,
    composition_type: "new_train",
    alternative_group: groups[i],
  }));

  const clusteredIds = new Set(clusters.flatMap((c) => c.fact_card_ids));
  const unclustered = orphanCards
    .filter((c) => !clusteredIds.has(c.id))
    .map((c) => ({ fact_card_id: c.id, artifact_id: c.artifact_id }));

  const manager_required = invalidDropped > 0 || hasOverlap;

  return {
    clusters,
    unclustered,
    manager_required,
    alternative_groups: [...new Set(groups)],
  };
}

function assignAlternativeGroups(clusters) {
  const n = clusters.length;
  if (n === 0) return [];
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x) {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a, b) {
    parent[find(a)] = find(b);
  }
  const idToIdx = new Map();
  clusters.forEach((cl, i) => {
    for (const id of cl.fact_card_ids) {
      if (idToIdx.has(id)) union(i, idToIdx.get(id));
      else idToIdx.set(id, i);
    }
  });
  const roots = parent.map(find);
  const rootRank = new Map();
  let r = 0;
  return roots.map((root) => {
    if (!rootRank.has(root)) rootRank.set(root, `alt-${++r}`);
    return rootRank.get(root);
  });
}

export async function buildCompositionClusters({ factCards, workflows, invokeLLM }) {
  const { trains, unlinked } = clusterFactCards(factCards);
  const orphanCards = unlinked
    .map((u) => factCards.find((c) => c.id === u.fact_card_id))
    .filter(Boolean);

  const { clusters: newTrainCandidates, unclustered, manager_required, alternative_groups } =
    await clusterOrphans({ orphanCards, invokeLLM });

  return {
    attachTrains: trains,
    newTrainCandidates,
    remainingOrphans: unclustered,
    orphan_manager_required: manager_required,
    alternative_groups,
  };
}

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