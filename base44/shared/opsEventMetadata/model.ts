import {
  buildMetadataLayers,
  coreRoutingToFactCardFields,
  getValueAddAccessResult,
} from "../metadataLayers.ts";

export const OPS_EVENT_METADATA_SCHEMA_VERSION = "ops-event-metadata.v1";
export const OPS_EVENT_DISCLAIMER = "仅为诊所运营事件记录与业务分类，不构成医疗诊断、治疗建议或自动管理决定。";

export const OPS_EVENT_TYPES = Object.freeze([
  "complaint",
  "training",
  "equipment_failure",
  "resource_request",
  "progress_update",
  "completion",
  "staff_coordination",
  "other",
]);

function cleanString(value: unknown, max = 256): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringArray(value: unknown, maxItems = 30, maxLength = 160): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanString(item, maxLength)).filter(Boolean) as string[])]
    .slice(0, maxItems);
}

function normalizeEventType(value: unknown): string {
  const normalized = cleanString(value, 120)?.toLowerCase().replace(/[\s-]+/g, "_");
  return normalized && OPS_EVENT_TYPES.includes(normalized) ? normalized : "other";
}

function expectedValueAddFields(eventType: string): string[] {
  if (eventType === "training") return ["training_duration_minutes", "participant_count"];
  if (eventType === "complaint") return ["complaint_severity_score", "involved_process_nodes"];
  if (eventType === "equipment_failure") return ["equipment_failure_count", "downtime_minutes"];
  return [];
}

export function createOpsEventMetadata(input: Record<string, any> = {}) {
  const existingCore = input.core_routing_fields || {};
  const existingValueAdd = input.value_add_fields || {};
  const eventType = normalizeEventType(input.event_type || existingCore.event_type);
  const eventTitle = cleanString(input.event_title || existingCore.event_title, 180)
    || cleanString(input.basic_summary || existingCore.basic_summary, 180)
    || "未命名运营事件";
  const occurredAt = cleanString(input.occurred_at || existingCore.occurred_at, 64)
    || cleanString(input.reported_at || existingCore.reported_at, 64);
  const reportedAt = cleanString(input.reported_at || existingCore.reported_at, 64) || occurredAt;

  const valueAddFields = {
    training_duration_minutes: finiteNumber(input.training_duration_minutes ?? existingValueAdd.training_duration_minutes),
    participant_count: finiteNumber(input.participant_count ?? existingValueAdd.participant_count),
    complaint_severity_score: finiteNumber(input.complaint_severity_score ?? existingValueAdd.complaint_severity_score),
    involved_process_nodes: stringArray(input.involved_process_nodes ?? existingValueAdd.involved_process_nodes),
    equipment_failure_count: finiteNumber(input.equipment_failure_count ?? existingValueAdd.equipment_failure_count),
    downtime_minutes: finiteNumber(input.downtime_minutes ?? existingValueAdd.downtime_minutes),
    equipment_id: cleanString(input.equipment_id ?? existingValueAdd.equipment_id, 128),
    training_topic: cleanString(input.training_topic ?? existingValueAdd.training_topic, 240),
    complaint_channel: cleanString(input.complaint_channel ?? existingValueAdd.complaint_channel, 120),
    additional_metrics: existingValueAdd.additional_metrics && typeof existingValueAdd.additional_metrics === "object"
      ? existingValueAdd.additional_metrics
      : (input.additional_metrics && typeof input.additional_metrics === "object" ? input.additional_metrics : {}),
  };

  const layers = buildMetadataLayers({
    core_routing_fields: {
      metadata_domain: "ops_event",
      event_type: eventType,
      event_title: eventTitle,
      clinic_id: input.clinic_id || existingCore.clinic_id,
      patient_id: input.patient_id || existingCore.patient_id,
      department: input.department || existingCore.department,
      role: input.role || existingCore.role,
      occurred_at: occurredAt,
      reported_at: reportedAt,
      basic_summary: input.basic_summary || existingCore.basic_summary || eventTitle,
      item_tag: input.event_manual_tag || existingCore.item_tag || eventType,
      priority_hint: input.priority_hint || existingCore.priority_hint,
      sla_target_minutes: input.sla_target_minutes ?? existingCore.sla_target_minutes,
      requires_reupload: false,
    },
    value_add_fields: valueAddFields,
    routing_required_fields: ["clinic_id", "event_type", "event_title", "occurred_at", "basic_summary"],
    value_add_expected_fields: expectedValueAddFields(eventType),
  });

  return {
    schema_version: OPS_EVENT_METADATA_SCHEMA_VERSION,
    record_kind: "ops_event_record",
    ...layers,
    source_event_id: cleanString(input.source_event_id, 180),
    source_artifact_id: cleanString(input.source_artifact_id, 128),
    origin_evidence_item_ids: stringArray(input.origin_evidence_item_ids, 50, 128),
    evidence_fact_card_ids: stringArray(input.evidence_fact_card_ids, 50, 128),
    parser_id: cleanString(input.parser_id, 120) || "ops_event_phase1_parser",
    parser_version: cleanString(input.parser_version, 64) || "phase1.v1",
    parse_confidence: Math.max(0, Math.min(1, finiteNumber(input.parse_confidence) ?? 0.5)),
    warnings: stringArray(input.warnings, 20, 160),
    raw_text_excerpt: cleanString(input.raw_text_excerpt, 4000),
    disclaimer: OPS_EVENT_DISCLAIMER,

    // Compatibility mirrors. New routing code must read core_routing_fields;
    // value-add consumers must read value_add_fields.
    event_type: layers.core_routing_fields.event_type,
    event_title: layers.core_routing_fields.event_title,
    clinic_id: layers.core_routing_fields.clinic_id,
    patient_id: layers.core_routing_fields.patient_id,
    department: layers.core_routing_fields.department,
    role: layers.core_routing_fields.role,
    occurred_at: layers.core_routing_fields.occurred_at,
    reported_at: layers.core_routing_fields.reported_at,
    basic_summary: layers.core_routing_fields.basic_summary,
  };
}

export function opsEventMetadataToFactCardFields(metadata: any, artifactId: string) {
  if (!metadata?.core_routing_fields) return [];
  return coreRoutingToFactCardFields({
    core_routing_fields: metadata.core_routing_fields,
    routing_status: metadata.routing_status,
    value_add_status: metadata.value_add_status,
    artifact_id: artifactId,
    source_quote: metadata.raw_text_excerpt || "",
    extraction_method: "ops_event_core_projection",
  });
}

export function getOpsEventValueAddAccess(metadata: any, featureEnabled = true) {
  return getValueAddAccessResult(metadata, featureEnabled);
}
