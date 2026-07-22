/**
 * Agent v1.1 Layer-2 policy evaluator.
 *
 * This module is deliberately shadow-only. It records what a configured policy
 * would do, but never attaches an Artifact, resolves an UndoListItem, dispatches
 * a manager notification, or changes Workflow closure state.
 */

export const HEURISTIC_POLICY_SCHEMA_VERSION = "agent-v1.1-policy-v1";
export const MAX_CANDIDATES = 5;

const TIME_SOURCES = ["document", "system_business", "captured_at", "received_at"];
const HARD_BLOCKS = new Set([
  "cross_tenant",
  "workflow_closed",
  "subject_conflict",
  "document_number_conflict",
]);

function finite01(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

export function validateHeuristicPolicy(policy = {}) {
  const errors = [];
  if (policy.schema_version !== HEURISTIC_POLICY_SCHEMA_VERSION) errors.push("schema_version_invalid");
  if (!policy.policy_version || typeof policy.policy_version !== "string") errors.push("policy_version_required");
  if (policy.execution_mode !== "shadow") errors.push("execution_mode_must_be_shadow");

  const cutoff = policy.candidate_cutoff || {};
  if (!finite01(cutoff.minimum_score)) errors.push("candidate_minimum_score_invalid");
  if (!Number.isInteger(cutoff.maximum_count) || cutoff.maximum_count < 1 || cutoff.maximum_count > MAX_CANDIDATES) {
    errors.push("candidate_maximum_count_invalid");
  }

  const temporal = policy.temporal_evidence || {};
  const precedence = asArray(temporal.precedence);
  if (precedence.length !== TIME_SOURCES.length || new Set(precedence).size !== TIME_SOURCES.length ||
      TIME_SOURCES.some((source) => !precedence.includes(source))) {
    errors.push("temporal_precedence_invalid");
  }
  if (temporal.evaluate_delay_as_fault !== false) errors.push("temporal_fault_judgment_forbidden");

  if (policy.missing_segments?.semantics !== "descriptive") errors.push("missing_segments_must_be_descriptive");
  if (policy.missing_segments?.triggers_manager_dispatch !== false) errors.push("missing_segments_dispatch_forbidden");
  if (policy.missing_segments?.triggers_exception !== false) errors.push("missing_segments_exception_forbidden");

  const reverse = policy.finance_reverse_inference || {};
  if (reverse.output_status !== "expected_missing") errors.push("reverse_inference_status_invalid");
  if (reverse.create_virtual_artifact !== false) errors.push("reverse_inference_virtual_artifact_forbidden");
  if (reverse.counts_as_closure_evidence !== false) errors.push("reverse_inference_closure_evidence_forbidden");

  for (const rule of asArray(policy.department_handoff_rules)) {
    if (!rule.rule_code || !rule.from_department || !rule.to_department || !finite01(rule.score_adjustment)) {
      errors.push("department_handoff_rule_invalid");
      break;
    }
  }
  for (const rule of asArray(policy.proxy_rules)) {
    if (!rule.rule_code || !rule.uploader_role || !Array.isArray(rule.allowed_on_behalf_of_roles)) {
      errors.push("proxy_rule_invalid");
      break;
    }
  }
  for (const rule of asArray(reverse.rules)) {
    if (!rule.rule_code || !rule.payment_category || !rule.expected_artifact_type || !finite01(rule.confidence)) {
      errors.push("finance_reverse_rule_invalid");
      break;
    }
  }
  return { valid: errors.length === 0, errors };
}

export function selectEffectiveEventTime(evidence = {}, policy = {}) {
  for (const source of policy.temporal_evidence.precedence) {
    const value = evidence.event_times?.[source];
    if (value) return { effective_event_time: value, event_time_source: source, time_uncertain: source !== "document" };
  }
  return { effective_event_time: null, event_time_source: null, time_uncertain: true };
}

export function evaluateProxyContext(context = {}, policy = {}) {
  const rule = asArray(policy.proxy_rules).find((item) => item.uploader_role === context.uploader_role);
  if (!rule) return { allowed: true, rule_codes: [] };
  if (context.is_proxy === true && context.on_behalf_of_role &&
      rule.allowed_on_behalf_of_roles.includes(context.on_behalf_of_role)) {
    return { allowed: true, rule_codes: [rule.rule_code, "DECLARED_PROXY_ALLOWED"] };
  }
  if (context.content_role && context.content_role !== context.uploader_role) {
    return { allowed: false, rule_codes: [rule.rule_code, "UNDECLARED_SOURCE_ROLE_CONFLICT"] };
  }
  return { allowed: true, rule_codes: [] };
}

export function inferExpectedMissing(evidence = {}, policy = {}) {
  if (evidence.business_domain !== "FINANCE" || !evidence.payment_category) return [];
  return asArray(policy.finance_reverse_inference.rules)
    .filter((rule) => rule.payment_category === evidence.payment_category)
    .map((rule) => ({
      artifact_type: rule.expected_artifact_type,
      status: "expected_missing",
      confidence: rule.confidence,
      rule_code: rule.rule_code,
      creates_fact: false,
      closure_evidence: false,
    }));
}

function hardBlockCodes(evidence, candidate) {
  const codes = [];
  if (!evidence.clinic_id || evidence.clinic_id !== candidate.clinic_id) codes.push("cross_tenant");
  if (["closed", "archived"].includes(candidate.workflow_status)) codes.push("workflow_closed");
  if (candidate.subject_conflict === true) codes.push("subject_conflict");
  if (candidate.document_number_conflict === true) codes.push("document_number_conflict");
  return codes.filter((code) => HARD_BLOCKS.has(code));
}

export function evaluateHeuristicPolicyShadow({ policy, evidence, candidates = [] }) {
  const check = validateHeuristicPolicy(policy);
  if (!check.valid) return { ok: false, errors: check.errors, authoritative: false, execution_mode: "shadow" };

  const proxy = evaluateProxyContext(evidence, policy);
  const eventTime = selectEffectiveEventTime(evidence, policy);
  const scored = [];
  const blocked = [];

  for (const candidate of candidates) {
    const hardBlocks = hardBlockCodes(evidence, candidate);
    if (!proxy.allowed) hardBlocks.push(...proxy.rule_codes);
    if (hardBlocks.length > 0) {
      blocked.push({ workflow_id: candidate.workflow_id, rule_codes: [...new Set(hardBlocks)] });
      continue;
    }
    if (!finite01(candidate.base_score)) {
      blocked.push({ workflow_id: candidate.workflow_id, rule_codes: ["candidate_base_score_missing"] });
      continue;
    }
    let score = candidate.base_score;
    const matched = [...proxy.rule_codes];
    for (const rule of asArray(policy.department_handoff_rules)) {
      if (rule.from_department === evidence.department && rule.to_department === candidate.department) {
        score += rule.score_adjustment;
        matched.push(rule.rule_code);
      }
    }
    scored.push({
      workflow_id: candidate.workflow_id,
      candidate_score: clamp01(score),
      matched_rule_codes: matched,
      event_time_source: eventTime.event_time_source,
      time_uncertain: eventTime.time_uncertain,
    });
  }

  scored.sort((a, b) => b.candidate_score - a.candidate_score || a.workflow_id.localeCompare(b.workflow_id));
  const retained = scored
    .filter((candidate) => candidate.candidate_score >= policy.candidate_cutoff.minimum_score)
    .slice(0, policy.candidate_cutoff.maximum_count);

  return {
    ok: true,
    authoritative: false,
    execution_mode: "shadow",
    policy_version: policy.policy_version,
    effective_event_time: eventTime,
    proposed_candidates: retained,
    blocked_candidates: blocked,
    expected_missing: inferExpectedMissing(evidence, policy),
    missing_segments_semantics: "descriptive",
    needs_manager_dispatch: false,
    creates_exception: false,
    creates_virtual_artifact: false,
    contributes_to_closure: false,
  };
}
