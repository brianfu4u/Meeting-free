// FragmentIngestionService Quality Gate — Clinic OS Phase 5
// Pure function. No Deno deps, safe for vitest.
import { ALIGNMENT_STATUS } from "./contract.ts";

// Returns { status, assembly_eligible, issues }
// status ∈ aligned | needs_clarification | rejected
// - rejected: structural failure (missing required fields)
// - needs_clarification: structurally valid but subject/time/confidence weak
// - aligned: structurally valid AND subject identified AND time determined AND confidence high
export function evaluateFactCard(card) {
  if (!card) {
    return { status: ALIGNMENT_STATUS.rejected, assembly_eligible: false, issues: ["fact_card_missing"] };
  }
  const issues = [];
  if (!card.artifact_id) issues.push("artifact_id_missing");
  if (!card.subject_type) issues.push("subject_type_missing");
  if (!card.occurred_at && card.time_uncertain !== true) {
    issues.push("time_indeterminate");
  }
  if (card.confidence == null || typeof card.confidence !== "number") {
    issues.push("confidence_missing");
  }
  if (!Array.isArray(card.evidence_spans)) issues.push("evidence_spans_missing");
  if (!Array.isArray(card.contradictions)) issues.push("contradictions_missing");
  if (!Array.isArray(card.unsupported_assumptions)) {
    issues.push("unsupported_assumptions_missing");
  }
  if (!card.interpreter_version) issues.push("interpreter_version_missing");
  if (!card.prompt_version) issues.push("prompt_version_missing");
  if (!Array.isArray(card.fields)) issues.push("fields_missing");

  if (issues.length > 0) {
    return { status: ALIGNMENT_STATUS.rejected, assembly_eligible: false, issues };
  }

  const clarification = [];
  if (card.subject_type === "unknown") clarification.push("subject_unknown");
  if (card.time_uncertain === true || !card.occurred_at) {
    clarification.push("time_uncertain");
  }
  if (card.subject_quality === "uncertain" || card.subject_quality === "low") {
    clarification.push("subject_low_quality");
  }
  if (typeof card.confidence === "number" && card.confidence < 0.7) {
    clarification.push("confidence_low");
  }
  if (card.subject_type !== "unknown" && !card.subject_fingerprint?.name) {
    clarification.push("subject_fingerprint_missing");
  }

  if (clarification.length > 0) {
    return {
      status: ALIGNMENT_STATUS.needs_clarification,
      assembly_eligible: false,
      issues: clarification,
    };
  }

  return {
    status: ALIGNMENT_STATUS.aligned,
    assembly_eligible: true,
    issues: [],
  };
}