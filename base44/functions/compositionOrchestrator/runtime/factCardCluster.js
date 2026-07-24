// SYNC with src/lib/composition/factCardCluster.js — Clinic OS V11 多页证据聚合
// Pure runtime mirror; no DB writes, no Deno-specific APIs. Safe for the function runtime.
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
  return card && card.assembly_eligible === true ? ALIGNED : "needs_clarification";
}

function confidenceOf(card) {
  const v = card && card.confidence;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function factCardIdOf(card) {
  return card && typeof card.id === "string" ? card.id : null;
}

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

export function propagateGroupResolution(resolvedCards, multipageClusters) {
  if (!multipageClusters || multipageClusters.length === 0) return resolvedCards || [];
  const idToGroup = new Map();
  for (const cl of multipageClusters) {
    for (const fcId of cl.fact_card_ids) idToGroup.set(fcId, cl);
  }
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
        _linkMethod: "multipage_inherited",
      };
    }
    return card;
  });
}

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