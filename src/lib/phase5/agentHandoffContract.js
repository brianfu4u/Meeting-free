// Phase 5 parser → Composition Agent handoff contract.
// Pure functions only; no Base44 runtime dependency.

export const HANDOFF_VERSION = "phase5.handoff.v2";

// Human-readable trace label only. It is deliberately deterministic and does
// not contain staff identity or a mutable per-day counter.
export const EVENT_GENE_CODE_FORMAT =
  "{clinic_id}/{business_date}/{department}/{fragment_type}/{artifact_short_id}";

export const EVENT_GENE_CODE_USAGE_POLICY = Object.freeze({
  allowed: ["display", "log_search", "human_traceability"],
  forbidden: ["grouping_decision", "tenant_authorization", "idempotency_key", "business_logic_parse"],
  rule: "Grouping and authorization must use structured fields; never parse event_gene_code.",
});

function cleanSegment(value, fallback = "unknown") {
  if (typeof value !== "string" || value.trim() === "") return fallback;
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

export function artifactShortId(artifactId) {
  const clean = cleanSegment(artifactId, "unknown");
  return clean === "unknown" ? clean : clean.slice(-8);
}

export function formatEventGeneCode(parts = {}) {
  return [
    cleanSegment(parts.clinic_id),
    typeof parts.business_date === "string" ? parts.business_date : "unknown",
    cleanSegment(parts.department),
    cleanSegment(parts.fragment_type),
    artifactShortId(parts.artifact_id),
  ].join("/");
}

export const GENE_CODE_REGEX =
  /^[a-z0-9_-]+\/\d{4}-\d{2}-\d{2}\/[a-z0-9_-]+\/(image|document|audio|text)\/[a-z0-9_-]{1,8}$/;

export const AGENT_PICKUP_FILTER_FIELDS = Object.freeze([
  "clinic_id",
  "assembly_eligible",
  "alignment_status",
  "ingestion_seq",
]);

export const PICKUP_REQUIRED_ALIGNMENT = "aligned";
export const EXCLUDED_ALIGNMENT_STATUSES = Object.freeze([
  "needs_clarification",
  "failed",
  "rejected",
]);

export function isPickupEligible(input = {}) {
  const { factCard, artifact, clinicId, cutoffEventSeq, completedArtifactIds } = input;
  if (!factCard || !artifact) return false;
  if (factCard.clinic_id !== clinicId || artifact.clinic_id !== clinicId) return false;
  if (factCard.artifact_id && String(factCard.artifact_id) !== String(artifact.id)) return false;
  if (factCard.assembly_eligible !== true) return false;
  if (factCard.alignment_status !== PICKUP_REQUIRED_ALIGNMENT) return false;

  const seq = Number(artifact.ingestion_seq);
  const cutoff = Number(cutoffEventSeq);
  if (!Number.isFinite(seq) || !Number.isFinite(cutoff) || seq > cutoff) return false;

  const completed = new Set((completedArtifactIds || []).map(String));
  return !completed.has(String(artifact.id));
}

export const RUN_IDEMPOTENCY_RULES = Object.freeze({
  completed: "processed_no_repeat",
  running: "same_key_existing_run",
  pending: "same_key_existing_run",
  failed: "safe_retry",
});

export function classifyRunForIdempotency(runStatus) {
  return RUN_IDEMPOTENCY_RULES[runStatus] || null;
}

export const EVENT_ID_SEMANTICS = Object.freeze({
  source_event_id: {
    meaning: "real upstream business event",
    nullable: true,
  },
  ingestion_event_id: {
    meaning: "upload/ingestion audit event",
    nullable: true,
  },
  grouping_key: false,
});

export function isEventIdAGroupingKey() {
  return false;
}

export const CONSUMPTION_MARKER = Object.freeze({
  allowed: "CompositionRun.artifact_ids_processed + cutoff_event_seq + policy_version + idempotency_key",
  forbidden: "EvidenceFactCard.assembly_eligible=false",
});
