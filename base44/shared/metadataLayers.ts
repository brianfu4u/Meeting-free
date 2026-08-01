export const METADATA_LAYER_CONTRACT_VERSION = "metadata-layer-contract.v1";

export const ROUTING_STATUS = Object.freeze({
  ready: "routing_ready",
  partial: "routing_partial",
  blocked: "routing_blocked",
});

export const VALUE_ADD_STATUS = Object.freeze({
  complete: "value_add_complete",
  partial: "value_add_partial",
  unavailable: "value_add_unavailable",
});

export const CORE_ROUTING_FACT_FIELD_PREFIX = "routing.";

export const CORE_ROUTING_FACT_FIELD_NAMES = Object.freeze([
  "routing.metadata_domain",
  "routing.exam_type",
  "routing.exam_item_name",
  "routing.event_type",
  "routing.event_title",
  "routing.clinic_id",
  "routing.patient_id",
  "routing.department",
  "routing.role",
  "routing.occurred_at",
  "routing.reported_at",
  "routing.basic_summary",
  "routing.item_tag",
  "routing.priority_hint",
  "routing.sla_target_minutes",
  "routing.routing_status",
  "routing.value_add_status",
  "routing.requires_reupload",
]);

const CORE_ROUTING_FACT_FIELD_SET = new Set(CORE_ROUTING_FACT_FIELD_NAMES);

function cleanString(value: unknown, max = 256): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sanitizeJsonValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return null;
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return cleanString(value, 2000);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeJsonValue(item, depth + 1));
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
      const key = cleanString(rawKey, 100);
      if (key) output[key] = sanitizeJsonValue(rawValue, depth + 1);
    }
    return output;
  }
  return null;
}

export function normalizeCoreRoutingFields(input: Record<string, unknown> = {}) {
  const metadataDomain = cleanString(input.metadata_domain, 80) || "unknown";
  const examType = cleanString(input.exam_type, 120);
  const examItemName = cleanString(input.exam_item_name, 180);
  const eventType = cleanString(input.event_type, 120);
  const eventTitle = cleanString(input.event_title, 180);
  const occurredAt = cleanString(input.occurred_at, 64);
  const reportedAt = cleanString(input.reported_at, 64) || occurredAt;
  const fallbackName = examItemName || eventTitle || examType || eventType || "未识别记录";
  const basicSummary = cleanString(input.basic_summary, 300)
    || `${metadataDomain === "eye_exam" ? "眼科检查" : "运营事件"}：${fallbackName}`;
  const sla = finiteNumber(input.sla_target_minutes);

  return {
    metadata_domain: metadataDomain,
    exam_type: examType,
    exam_item_name: examItemName,
    event_type: eventType,
    event_title: eventTitle,
    clinic_id: cleanString(input.clinic_id, 128),
    patient_id: cleanString(input.patient_id, 128),
    department: cleanString(input.department, 120),
    role: cleanString(input.role, 120),
    occurred_at: occurredAt,
    reported_at: reportedAt,
    basic_summary: basicSummary,
    item_tag: cleanString(input.item_tag, 80),
    priority_hint: cleanString(input.priority_hint, 16),
    sla_target_minutes: sla == null ? null : Math.max(0, Math.round(sla)),
    requires_reupload: input.requires_reupload === true,
  };
}

export function normalizeValueAddFields(input: unknown) {
  const normalized = sanitizeJsonValue(input);
  return normalized && typeof normalized === "object" && !Array.isArray(normalized)
    ? normalized as Record<string, unknown>
    : {};
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value == null || value === "") return false;
  if (Array.isArray(value)) return value.some(hasMeaningfulValue);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).some(hasMeaningfulValue);
  return true;
}

export function assessMetadataLayerReadiness({
  core_routing_fields,
  value_add_fields,
  routing_required_fields = ["clinic_id", "occurred_at", "basic_summary"],
  value_add_expected_fields = [],
}: {
  core_routing_fields: Record<string, unknown>;
  value_add_fields: Record<string, unknown>;
  routing_required_fields?: string[];
  value_add_expected_fields?: string[];
}) {
  const missingRoutingFields = routing_required_fields.filter(
    (key) => !hasMeaningfulValue(core_routing_fields?.[key]),
  );
  const routingStatus = missingRoutingFields.length === 0
    ? ROUTING_STATUS.ready
    : missingRoutingFields.length < routing_required_fields.length
      ? ROUTING_STATUS.partial
      : ROUTING_STATUS.blocked;

  const valueKeys = value_add_expected_fields.length > 0
    ? value_add_expected_fields
    : Object.keys(value_add_fields || {});
  const presentValueKeys = valueKeys.filter((key) => hasMeaningfulValue(value_add_fields?.[key]));
  const valueAddStatus = presentValueKeys.length === 0
    ? VALUE_ADD_STATUS.unavailable
    : valueKeys.length > 0 && presentValueKeys.length === valueKeys.length
      ? VALUE_ADD_STATUS.complete
      : VALUE_ADD_STATUS.partial;

  return {
    routing_status: routingStatus,
    value_add_status: valueAddStatus,
    routing_ready: routingStatus === ROUTING_STATUS.ready,
    missing_routing_fields: missingRoutingFields,
    missing_value_add_fields: valueKeys.filter((key) => !presentValueKeys.includes(key)),
  };
}

export function buildMetadataLayers({
  core_routing_fields,
  value_add_fields,
  routing_required_fields,
  value_add_expected_fields,
}: {
  core_routing_fields: Record<string, unknown>;
  value_add_fields?: unknown;
  routing_required_fields?: string[];
  value_add_expected_fields?: string[];
}) {
  const core = normalizeCoreRoutingFields(core_routing_fields);
  const valueAdd = normalizeValueAddFields(value_add_fields || {});
  const readiness = assessMetadataLayerReadiness({
    core_routing_fields: core,
    value_add_fields: valueAdd,
    routing_required_fields,
    value_add_expected_fields,
  });
  return {
    layer_contract_version: METADATA_LAYER_CONTRACT_VERSION,
    core_routing_fields: core,
    value_add_fields: valueAdd,
    ...readiness,
  };
}

export function isCoreRoutingFactField(fieldName: unknown): boolean {
  return typeof fieldName === "string"
    && (fieldName.startsWith(CORE_ROUTING_FACT_FIELD_PREFIX) || CORE_ROUTING_FACT_FIELD_SET.has(fieldName));
}

export function coreRoutingToFactCardFields({
  core_routing_fields,
  routing_status,
  value_add_status,
  artifact_id,
  source_quote = "",
  extraction_method = "metadata_core_projection",
}: {
  core_routing_fields: Record<string, unknown>;
  routing_status: string;
  value_add_status: string;
  artifact_id: string;
  source_quote?: string;
  extraction_method?: string;
}) {
  const core = normalizeCoreRoutingFields(core_routing_fields);
  const mapping: Record<string, unknown> = {
    "routing.metadata_domain": core.metadata_domain,
    "routing.exam_type": core.exam_type,
    "routing.exam_item_name": core.exam_item_name,
    "routing.event_type": core.event_type,
    "routing.event_title": core.event_title,
    "routing.clinic_id": core.clinic_id,
    "routing.patient_id": core.patient_id,
    "routing.department": core.department,
    "routing.role": core.role,
    "routing.occurred_at": core.occurred_at,
    "routing.reported_at": core.reported_at,
    "routing.basic_summary": core.basic_summary,
    "routing.item_tag": core.item_tag,
    "routing.priority_hint": core.priority_hint,
    "routing.sla_target_minutes": core.sla_target_minutes,
    "routing.routing_status": routing_status,
    "routing.value_add_status": value_add_status,
    "routing.requires_reupload": core.requires_reupload,
  };

  return Object.entries(mapping)
    .filter(([, value]) => value != null && value !== "")
    .map(([fieldName, value]) => ({
      field_name: fieldName,
      value: typeof value === "string" ? value : JSON.stringify(value),
      source_artifact_id: artifact_id,
      source_region: "core_routing_fields",
      source_quote,
      extraction_quality: routing_status === ROUTING_STATUS.ready ? "high" : "uncertain",
      extraction_method,
    }));
}

export function getValueAddAccessResult(metadata: any, featureEnabled = true) {
  if (!featureEnabled) {
    return {
      available: false,
      reason_code: "value_add_feature_not_enabled",
      message: "当前套餐未启用增值详细数据服务。",
      value_add_fields: null,
    };
  }
  const status = metadata?.value_add_status || VALUE_ADD_STATUS.unavailable;
  const fields = normalizeValueAddFields(metadata?.value_add_fields || {});
  if (status === VALUE_ADD_STATUS.unavailable || !hasMeaningfulValue(fields)) {
    return {
      available: false,
      reason_code: "value_add_fields_unavailable",
      message: "此记录目前仅存储为基础记录，未解析详细数值。",
      value_add_fields: null,
    };
  }
  return {
    available: true,
    reason_code: status === VALUE_ADD_STATUS.partial ? "value_add_fields_partial" : null,
    message: status === VALUE_ADD_STATUS.partial ? "详细数据仅部分可用。" : null,
    value_add_fields: fields,
  };
}
