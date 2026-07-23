/**
 * Clinic OS V11 — FactCardCluster（多页证据聚合）
 *
 * 职责：在 candidateFinder 之后、Assembly 之前，将同一 patient_session_id_hint +
 * business_date 下的多个 FactCard 识别为"同一事件"并合并判断，实现 Skill 与 Agent
 * 的无缝对接。
 *
 * 合并规则（已拍板）：
 * - alignment_status：一票否决制，任一 FactCard 非 aligned → 整体 needs_clarification
 * - confidence：取聚合内所有 FactCard confidence 的最小值（保守）
 * - 数据结构：纯内存态，不改 FactCard 实体，不动 DB schema
 *
 * 零回归保证：无 session_hint 或单卡片组不触发聚合，走原流程。
 *
 * 聚合键来源：Artifact.original_metadata.patient_session_id_hint（由调用方在
 * resolvedCards 上注入 _session_hint 临时字段）+ FactCard.business_date。
 * 解析站 fragmentIngestionService 不做任何改动。
 */

const ALIGNED = "aligned";

function sessionHintOf(card) {
  if (!card) return null;
  const v = card._session_hint;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function businessDateOf(card) {
  if (!card) return null;
  const v = card.business_date;
  return typeof v === "string" && v ? v : null;
}

function alignmentStatusOf(card) {
  if (card && typeof card.alignment_status === "string" && card.alignment_status) {
    return card.alignment_status;
  }
  // 兜底：assembly_eligible=true 视作 aligned，否则 needs_clarification
  return card && card.assembly_eligible === true ? ALIGNED : "needs_clarification";
}

function confidenceOf(card) {
  const v = card && card.confidence;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function factCardIdOf(card) {
  return card && typeof card.id === "string" ? card.id : null;
}

/**
 * 按聚合键分组。聚合键 = patient_session_id_hint + business_date。
 * 仅当两者都存在时才参与聚合；否则归入 singletons（零回归）。
 *
 * @param {Array} resolvedCards 已经过 candidateFinder 的卡片（需含 _session_hint）
 * @returns {{ clusters: Array, singletons: Array }}
 */
export function clusterMultiPage(resolvedCards) {
  const groups = new Map();
  const singletons = [];
  for (const card of resolvedCards || []) {
    const sessionHint = sessionHintOf(card);
    const date = businessDateOf(card);
    if (!sessionHint || !date) {
      singletons.push({ fact_card_id: factCardIdOf(card), multipage_group_id: null });
      continue;
    }
    const key = `${sessionHint}::${date}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(card);
  }

  const clusters = [];
  for (const [key, cards] of groups) {
    if (cards.length < 2) {
      singletons.push({ fact_card_id: factCardIdOf(cards[0]), multipage_group_id: null });
      continue;
    }
    const statuses = cards.map(alignmentStatusOf);
    const hasNonAligned = statuses.some((s) => s !== ALIGNED);
    const mergedStatus = hasNonAligned ? "needs_clarification" : ALIGNED;
    const confs = cards.map(confidenceOf).filter((v) => v !== null);
    const mergedConfidence = confs.length > 0 ? Math.min(...confs) : null;
    const vetoReasons = cards
      .map((c, i) => ({ fact_card_id: factCardIdOf(c), alignment_status: statuses[i] }))
      .filter((r) => r.alignment_status !== ALIGNED && r.fact_card_id);
    clusters.push({
      multipage_group_id: `mpg::${key}`,
      session_hint: cards[0]._session_hint,
      business_date: cards[0].business_date,
      fact_card_ids: cards.map(factCardIdOf).filter(Boolean),
      artifact_ids: cards.map((c) => c.artifact_id).filter(Boolean),
      merged_alignment_status: mergedStatus,
      merged_confidence: mergedConfidence,
      veto_reasons: vetoReasons,
      member_count: cards.length,
    });
  }
  return { clusters, singletons };
}

/**
 * 在 multipage group 内传播已解析的 workflow_id：
 * 任一成员解析到 workflow（explicit_id 或 spatiotemporal）→ 全组成员继承，
 * 使既有 clusterFactCards 自然将同组卡片归入同一 attach train。
 *
 * 零回归：无 multipage cluster 时原样返回。
 */
export function propagateGroupResolution(resolvedCards, multipageClusters) {
  if (!multipageClusters || multipageClusters.length === 0) return resolvedCards || [];
  const idToGroup = new Map();
  for (const cl of multipageClusters) {
    for (const fcId of cl.fact_card_ids) idToGroup.set(fcId, cl);
  }
  // 每组收集首个已解析 workflow（优先 explicit_id）
  const groupResolved = new Map();
  for (const cl of multipageClusters) {
    const members = (resolvedCards || []).filter((c) => cl.fact_card_ids.includes(c.id));
    const explicit = members.find((c) => c._linkMethod === "explicit_id" && c._resolvedWorkflowId);
    const any = members.find((c) => c._resolvedWorkflowId);
    if (explicit) groupResolved.set(cl.multipage_group_id, explicit._resolvedWorkflowId);
    else if (any) groupResolved.set(cl.multipage_group_id, any._resolvedWorkflowId);
  }
  return (resolvedCards || []).map((card) => {
    const cl = idToGroup.get(card.id);
    if (!cl) return card;
    const inherited = groupResolved.get(cl.multipage_group_id);
    if (inherited && !card._resolvedWorkflowId) {
      return {
        ...card,
        _resolvedWorkflowId: inherited,
        _linkMethod: card._linkMethod || "multipage_inherited",
      };
    }
    return card;
  });
}

/**
 * 构造多页否决校验问题（供 Guardrail 拦截自动挂接，保持 observe 模式）。
 * 仅当聚合后 merged_alignment_status 非 aligned 时产出。
 */
export function buildMultipageVetoIssue(multipageClusters) {
  const issues = [];
  for (const cl of multipageClusters || []) {
    if (cl.merged_alignment_status === ALIGNED) continue;
    issues.push({
      type: "multipage_clarification_required",
      semantic_class: "multipage_veto",
      multipage_group_id: cl.multipage_group_id,
      fact_card_ids: cl.fact_card_ids,
      artifact_ids: cl.artifact_ids,
      veto_reasons: cl.veto_reasons,
    });
  }
  return issues;
}