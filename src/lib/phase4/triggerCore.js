/** Agent v1.1 unified run-trigger contract (pure, no writes). */
export const CANONICAL_TRIGGER_TYPES = Object.freeze([
  "scheduled",
  "manager_manual",
  "cutoff_reconciliation",
]);

export function normalizeTriggerType(value) {
  if (value === "manual") return "manager_manual";
  return CANONICAL_TRIGGER_TYPES.includes(value) ? value : null;
}

export function buildUnifiedRunRequest({
  clinicId,
  businessDate,
  slot,
  policyVersion,
  triggerType,
  artifacts,
}) {
  const canonicalTrigger = normalizeTriggerType(triggerType);
  if (!canonicalTrigger) return { ok: false, reason: "trigger_type_invalid" };
  if (!clinicId || !businessDate || !slot || !Number.isInteger(policyVersion) || policyVersion < 1) {
    return { ok: false, reason: "run_context_invalid" };
  }
  const watermarkRows = (Array.isArray(artifacts) ? artifacts : [])
    .map((item) => ({
      seq: Number(item?.ingestion_seq),
      ingestedAt: item?.ingested_at || item?.captured_at || item?.created_date || null,
    }))
    .filter((item) => Number.isFinite(item.seq));
  if (!watermarkRows.length) return { ok: false, reason: "no_artifacts" };
  return {
    ok: true,
    request: {
      action: "run",
      clinic_id: clinicId,
      business_date: businessDate,
      slot,
      trigger_type: canonicalTrigger,
      cutoff_event_seq: Math.max(...watermarkRows.map((item) => item.seq)),
      cutoff_ingested_at: watermarkRows
        .map((item) => item.ingestedAt)
        .filter((value) => typeof value === "string" && value)
        .sort()
        .at(-1) || null,
      policy_version: policyVersion,
    },
  };
}
