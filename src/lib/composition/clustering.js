/**
 * Clinic OS V10 — Clustering
 *
 * 职责：将已解读的 EvidenceFactCard 按归属 session_id 聚类为「编组列车」。
 * 采用列车编组模型：同一 session 的车厢归为同一列车；未匹配车厢归入 unlinked 编组，
 * 触发店长预警。
 *
 * 纯函数，无 LLM 依赖，可独立单测。
 */

/**
 * 输入：factCards[]，每张卡需带 resolvedSessionId（由 Candidate Finder 注入）与 method。
 * 输出：{ trains: [{session_id, fact_card_ids, artifact_ids, methods}], unlinked: [{fact_card_id, artifact_id, reason}] }
 */
export function clusterFactCards(factCards) {
  if (!Array.isArray(factCards)) return { trains: [], unlinked: [] };
  const trainMap = new Map(); // session_id -> train
  const unlinked = [];

  for (const card of factCards) {
    const sid = card._resolvedSessionId || card.session_id;
    const method = card._linkMethod || (sid ? "explicit_id" : "unlinked");
    if (!sid) {
      unlinked.push({ fact_card_id: card.id, artifact_id: card.artifact_id, reason: "无归属 session" });
      continue;
    }
    if (!trainMap.has(sid)) {
      trainMap.set(sid, {
        session_id: sid,
        fact_card_ids: [],
        artifact_ids: [],
        methods: new Set(),
      });
    }
    const train = trainMap.get(sid);
    train.fact_card_ids.push(card.id);
    if (card.artifact_id) train.artifact_ids.push(card.artifact_id);
    train.methods.add(method);
  }

  const trains = [...trainMap.values()].map((t) => ({
    session_id: t.session_id,
    fact_card_ids: t.fact_card_ids,
    artifact_ids: t.artifact_ids,
    methods: [...t.methods],
  }));

  return { trains, unlinked };
}

/**
 * 按 business_line 二次分桶（不同业务线不混编）。
 */
export function clusterByBusinessLine(factCards, sessions) {
  const base = clusterFactCards(factCards);
  const sessionLine = new Map((sessions || []).map((s) => [s.id, s.business_line]));
  const byLine = new Map();
  for (const train of base.trains) {
    const line = sessionLine.get(train.session_id) || "unknown";
    if (!byLine.has(line)) byLine.set(line, []);
    byLine.get(line).push(train);
  }
  return { trainsByLine: [...byLine.entries()].map(([line, trains]) => ({ business_line: line, trains })), unlinked: base.unlinked };
}