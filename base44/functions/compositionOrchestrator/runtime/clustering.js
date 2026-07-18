// GENERATED_PHASE2_MIRROR source=src/lib/composition/clustering.js blob=bcdf4db155bd85d493106236531f3300216a1770
// Do not edit manually; parity test pins the canonical source blob.
/**
 * Clinic OS V10 — Clustering（修订版 R2.2）
 *
 * R2.2：
 * - Orphan Cluster 整簇校验：任一不存在 ID 或重复 ID → 整簇作废（不过滤/去重后继续接受）；
 * - Clustering 不再输出 manager_required，仅输出 validation_issues；
 * - 最终 needs_manager_dispatch 由 Guardrail 统一计算。
 */

import { buildOrphanClusterPrompt, ORPHAN_CLUSTER_JSON_SCHEMA } from "./prompts.js";

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
 * Orphan-to-Orphan 聚类 + 整簇校验。
 * 校验规则（整簇作废，不修复）：
 * - 任一 fact_card_id 不存在 → 整簇作废；
 * - 簇内存在重复 ID → 整簇作废；
 * - 每簇 <2 → 作废；
 * - 跨簇重叠 → 同一 alternative_group，并记入 validation_issues。
 * 输出 validation_issues，不输出 manager_required（由 Guardrail 统一决定）。
 */
export async function clusterOrphans({ orphanCards, invokeLLM, maxClusters = 3 }) {
  if (!Array.isArray(orphanCards) || orphanCards.length === 0) {
    return { clusters: [], unclustered: [], validation_issues: [], alternative_groups: [] };
  }
  if (!invokeLLM) {
    return {
      clusters: [],
      unclustered: orphanCards.map((c) => ({ fact_card_id: c.id, artifact_id: c.artifact_id })),
      validation_issues: [],
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
  const validation_issues = [];

  for (let i = 0; i < rawClusters.length; i++) {
    const raw = rawClusters[i];
    const ids = raw?.fact_card_ids || [];

    // 整簇校验：任一不存在或重复 → 整簇作废
    const hasNonexistent = ids.some((id) => !orphanIds.has(id));
    const hasDup = new Set(ids).size !== ids.length;
    if (hasNonexistent || hasDup) {
      validation_issues.push({
        type: "orphan_cluster_illegal",
        cluster_index: i,
        fact_card_ids: ids,
        reason: hasNonexistent ? "nonexistent_id" : "duplicate_id",
      });
      continue;
    }
    if (ids.length < 2) {
      validation_issues.push({ type: "orphan_cluster_too_small", cluster_index: i, fact_card_ids: ids });
      continue;
    }
    valid.push({
      fact_card_ids: ids,
      workflow_family_hint: raw.workflow_family_hint || null,
      confidence: raw.confidence ?? null,
      reason: raw.reason || "",
    });
  }

  // 跨簇重叠 → alternative_group
  const groups = assignAlternativeGroups(valid);
  const groupCount = new Map();
  groups.forEach((g) => groupCount.set(g, (groupCount.get(g) || 0) + 1));
  const hasOverlap = [...groupCount.values()].some((c) => c > 1);
  if (hasOverlap) validation_issues.push({ type: "orphan_cluster_overlap" });

  const clusters = valid.map((cl, idx) => ({
    cluster_id: `new_train-${idx + 1}`,
    fact_card_ids: cl.fact_card_ids,
    artifact_ids: cl.fact_card_ids.map((id) => cardById.get(id)?.artifact_id).filter(Boolean),
    workflow_family_hint: cl.workflow_family_hint,
    confidence: cl.confidence,
    reason: cl.reason,
    composition_type: "new_train",
    alternative_group: groups[idx],
  }));

  const clusteredIds = new Set(clusters.flatMap((c) => c.fact_card_ids));
  const unclustered = orphanCards
    .filter((c) => !clusteredIds.has(c.id))
    .map((c) => ({ fact_card_id: c.id, artifact_id: c.artifact_id }));

  return {
    clusters,
    unclustered,
    validation_issues,
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

  const { clusters: newTrainCandidates, unclustered, validation_issues, alternative_groups } =
    await clusterOrphans({ orphanCards, invokeLLM });

  // 不输出 manager_required；仅输出 validation_issues，由 Guardrail 统一计算最终 needs_manager_dispatch
  return {
    attachTrains: trains,
    newTrainCandidates,
    remainingOrphans: unclustered,
    validation_issues,
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