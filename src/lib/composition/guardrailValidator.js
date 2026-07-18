/**
 * Clinic OS V10 — Guardrail Validator
 *
 * 职责：对编组 LLM 产出的提案（AttentionItem 草案）执行硬护栏与决策规则校验。
 * 不否决提案（影子模式只读），仅标注违反数与无依据假设数，供候选假设打分排序。
 *
 * 纯函数，可独立单测。
 */

/**
 * 校验单条提案。
 * 输入：proposal（workflowAssembly 产出）, guessPolicy（含 hard_guardrails / tracks[].guardrails / decision_rules）
 * 输出：{ valid, violations[], guardrail_violations, unsupported_assumptions_count, bestHypothesisId, scoredHypotheses[] }
 */
export function validateProposal(proposal, guessPolicy = {}) {
  const violations = [];
  if (!proposal) return { valid: false, violations: ["empty_proposal"], guardrail_violations: 1, unsupported_assumptions_count: 0, bestHypothesisId: null, scoredHypotheses: [] };

  // 1. 基础完备性
  if (!proposal.recommendation || !proposal.title) violations.push("missing_recommendation_or_title");
  if (!Array.isArray(proposal.reasoning_tracks) || proposal.reasoning_tracks.length === 0) {
    violations.push("no_reasoning_tracks");
  }

  // 2. 七条轨道：每条不得全空（无支持/反对/缺口 = 无推理痕迹）
  const trackGuardrails = new Map((guessPolicy.tracks || []).map((t) => [t.track_id, t.guardrails || []]));
  for (const track of proposal.reasoning_tracks || []) {
    const empty =
      (track.supporting_evidence || []).length === 0 &&
      (track.opposing_evidence || []).length === 0 &&
      (track.information_gaps || []).length === 0;
    if (empty) violations.push(`track_${track.track_id}_empty`);
    // 该轨道的硬护栏：若 proposal 的 proposed_workflow_status 触发该轨道 guardrail 关键字则记违反
    const guards = trackGuardrails.get(track.track_id) || [];
    for (const g of guards) {
      if (g.includes("禁止直接closed") && proposal.proposed_workflow_status === "closed" && !proposal.terminal_signal_detected) {
        violations.push(`track_${track.track_id}_guardrail_no_terminal`);
      }
    }
  }

  // 3. 全局硬护栏
  for (const g of guessPolicy.hard_guardrails || []) {
    if (g.includes("closed需终止信号") && proposal.proposed_workflow_status === "closed" && !proposal.terminal_signal_detected) {
      violations.push("global_no_terminal_for_closure");
    }
    if (g.includes("handoff需证据") && proposal.proposed_handoff_department && (proposal.handoff_evidence_ids || []).length === 0) {
      violations.push("global_handoff_without_evidence");
    }
  }

  // 4. 候选假设打分（决策规则：解释最多/违反最少/无依据最少）
  const rules = guessPolicy.decision_rules || {};
  const wViol = rules.guardrail_violation_weight ?? 3;
  const wUnsupp = rules.unsupported_assumption_weight ?? 1;
  const scored = (proposal.alternative_hypotheses || []).map((h) => ({
    hypothesis_id: h.hypothesis_id,
    score:
      (h.fragments_explained || 0) -
      (h.guardrail_violations || 0) * wViol -
      (h.unsupported_assumptions_count || 0) * wUnsupp,
    raw: h,
  }));
  scored.sort((a, b) => b.score - a.score);

  const guardrailViolations = violations.length;
  const unsupportedCount = (proposal.unsupported_assumptions || []).length;
  const valid = guardrailViolations === 0 && scored.length > 0;

  return {
    valid,
    violations,
    guardrail_violations: guardrailViolations,
    unsupported_assumptions_count: unsupportedCount,
    bestHypothesisId: scored[0]?.hypothesis_id || null,
    scoredHypotheses: scored,
  };
}