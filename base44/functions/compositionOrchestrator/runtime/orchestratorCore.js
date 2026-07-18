// GENERATED_PHASE3_MIRROR source=src/lib/phase3/orchestratorCore.js blob=878e1b844d09f57dc5dd5376d8998f6e17e99cf2
// Do not edit manually; parity test pins the canonical source blob.
/**
 * Clinic OS Phase 3 — Composition Orchestrator Core
 *
 * Pure descriptors only: no Base44 SDK, no data writes, no commit action.
 * Phase 2 remains the source of truth for assembly and guardrail semantics.
 */

import {
  PHASE3_CONTRACT_VERSION,
  assertAttachCompleteness,
  canPerform,
  computeRunIdempotencyKey,
} from "./phase3Contract.js";

const RUN_ERROR_CODES = new Set([
  "authorization_failed",
  "tenant_scope_violation",
  "invalid_input",
  "interpret_failed",
  "composition_failed",
  "persistence_failed",
  "unknown_failure",
]);

function fail(code, message) {
  const error = new Error(message || code);
  error.code = code;
  throw error;
}

function requireString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("invalid_input", `${name} required`);
  }
  return value;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(value) {
  return [...new Set(asArray(value).filter((item) => typeof item === "string" && item))];
}

export function authorizeAction({ action, role, clinicId }) {
  requireString(action, "action");
  requireString(role, "role");
  requireString(clinicId, "clinicId");
  if (!canPerform(action, role)) fail("authorization_failed", "action_not_allowed");
  return true;
}

export function assertTenantScope(clinicId, ...objects) {
  requireString(clinicId, "clinicId");
  objects.forEach((object, index) => {
    if (object == null) return;
    if (typeof object !== "object" || Array.isArray(object)) {
      fail("tenant_scope_violation", `arg[${index}]_invalid_type`);
    }
    if (typeof object.clinic_id !== "string" || !object.clinic_id) {
      fail("tenant_scope_violation", `arg[${index}]_missing_tenant`);
    }
    if (object.clinic_id !== clinicId) {
      fail("tenant_scope_violation", `arg[${index}]_cross_tenant`);
    }
  });
  return true;
}

export function buildRunDescriptor({
  clinicId,
  businessDate,
  slot,
  policyVersion,
  cutoffEventSeq,
  cutoffIngestedAt = null,
  triggerType = "manual",
  promptVersion = null,
  modelVersion = null,
  contractVersion = PHASE3_CONTRACT_VERSION,
  artifactIds = [],
}) {
  requireString(clinicId, "clinicId");
  requireString(businessDate, "businessDate");
  requireString(slot, "slot");
  if (policyVersion == null || cutoffEventSeq == null) fail("invalid_input", "run_watermark_required");
  if (!["manual", "scheduled"].includes(triggerType)) fail("invalid_input", "trigger_type_invalid");

  return {
    clinic_id: clinicId,
    business_date: businessDate,
    slot,
    policy_version: policyVersion,
    cutoff_event_seq: cutoffEventSeq,
    cutoff_ingested_at: cutoffIngestedAt,
    status: "pending",
    idempotency_key: computeRunIdempotencyKey({
      clinicId,
      businessDate,
      slot,
      policyVersion,
      cutoffEventSeq,
    }),
    proposals_generated: 0,
    artifact_ids_processed: uniqueStrings(artifactIds),
    trigger_type: triggerType,
    prompt_version: promptVersion,
    model_version: modelVersion,
    contract_version: contractVersion,
  };
}

function checkedBlocksByHypothesis(guardrailResult) {
  const map = new Map();
  for (const item of asArray(guardrailResult?.checked)) {
    const id = item?.hypothesis?.workflow_hypothesis_id;
    if (typeof id === "string" && id) map.set(id, asArray(item.blocks));
  }
  return map;
}

function attachBlock(hypothesis) {
  const result = assertAttachCompleteness(hypothesis);
  return result.ok ? [] : [{ rule_code: result.reason }];
}

export function buildHypothesisDescriptors({
  clinicId,
  compositionRunId,
  hypotheses,
  guardrailResult = {},
}) {
  requireString(clinicId, "clinicId");
  requireString(compositionRunId, "compositionRunId");
  if (!Array.isArray(hypotheses)) fail("invalid_input", "hypotheses_array_required");

  const blocksById = checkedBlocksByHypothesis(guardrailResult);
  const rankById = new Map(
    asArray(guardrailResult?.ranked).map((h, rank) => [h?.workflow_hypothesis_id, rank])
  );

  return hypotheses.map((hypothesis) => {
    if (!hypothesis || typeof hypothesis !== "object" || Array.isArray(hypothesis)) {
      fail("invalid_input", "hypothesis_invalid_type");
    }
    const sourceProposalId = requireString(hypothesis.source_proposal_id, "source_proposal_id");
    const hypothesisId = requireString(
      hypothesis.workflow_hypothesis_id,
      "workflow_hypothesis_id"
    );
    const compositionType = requireString(hypothesis.composition_type, "composition_type");
    if (!["attach", "new_train", "orphan"].includes(compositionType)) {
      fail("invalid_input", "composition_type_invalid");
    }

    const validationBlocks = [
      ...blocksById.get(hypothesisId) || [],
      ...attachBlock(hypothesis),
    ];

    return {
      clinic_id: clinicId,
      composition_run_id: compositionRunId,
      source_proposal_id: sourceProposalId,
      workflow_hypothesis_id: hypothesisId,
      composition_type: compositionType,
      workflow_family: hypothesis.workflow_family || null,
      target_workflow_id: hypothesis.target_workflow_id || null,
      target_snapshot_id: hypothesis.target_snapshot_id || null,
      target_snapshot_version: hypothesis.target_snapshot_version ?? null,
      ordered_artifact_ids: uniqueStrings(hypothesis.ordered_artifact_ids),
      reasoning_tracks:
        hypothesis.reasoning_tracks && typeof hypothesis.reasoning_tracks === "object"
          ? hypothesis.reasoning_tracks
          : {},
      unsupported_assumptions: asArray(hypothesis.unsupported_assumptions),
      contradictions: asArray(hypothesis.contradictions),
      unexplained_artifact_ids: uniqueStrings(hypothesis.unexplained_artifact_ids),
      validation_blocks: validationBlocks,
      rank: rankById.has(hypothesisId) ? rankById.get(hypothesisId) : null,
      alternative_group: hypothesis.alternative_group || null,
      status: "pending_review",
    };
  });
}

export function deriveDispatchDecision({ guardrailResult = {}, validationIssues = [] }) {
  if (asArray(validationIssues).length > 0) {
    return { needsManagerDispatch: true, bestHypothesisId: null };
  }
  return {
    needsManagerDispatch: Boolean(guardrailResult.needsManagerDispatch),
    bestHypothesisId: guardrailResult.needsManagerDispatch
      ? null
      : guardrailResult.bestHypothesisId || null,
  };
}

export function buildAttentionDescriptor({
  clinicId,
  compositionRunId,
  artifactIds = [],
  evidenceFactCardIds = [],
  generatedAt,
  urgency = "medium",
}) {
  requireString(clinicId, "clinicId");
  requireString(compositionRunId, "compositionRunId");
  requireString(generatedAt, "generatedAt");
  return {
    clinic_id: clinicId,
    attention_type: "exception",
    urgency,
    title: "编组候选待审核",
    recommendation: "请店长审核编组候选",
    status: "open",
    generated_at: generatedAt,
    composition_run_id: compositionRunId,
    selected_hypothesis_id: null,
    artifact_ids: uniqueStrings(artifactIds),
    evidence_fact_card_ids: uniqueStrings(evidenceFactCardIds),
  };
}

export function buildRunFailure(error) {
  const candidate = typeof error?.code === "string" ? error.code : "unknown_failure";
  const errorCode = RUN_ERROR_CODES.has(candidate) ? candidate : "unknown_failure";
  return {
    status: "failed",
    error_message: "composition_run_failed",
    error_code: errorCode,
  };
}
