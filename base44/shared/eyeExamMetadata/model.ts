import {
  buildMetadataLayers,
  coreRoutingToFactCardFields,
  getValueAddAccessResult,
} from "../metadataLayers.ts";

export const EYE_EXAM_METADATA_SCHEMA_VERSION = "eye-exam-report-metadata.v1.3";
export const EYE_EXAM_DISCLAIMER = "仅为检查数据记录，不构成医学诊断或治疗建议。";

export const EYE_EXAM_PARSE_STATUS = Object.freeze({
  parsed: "parsed",
  partial: "partial",
  fallback: "fallback",
});

export const EYE_EXAM_OCR_QUALITY_FLAGS = Object.freeze(["good", "borderline", "poor"]);

const MAX_RAW_TEXT = 4000;
const MAX_KEY_VALUES = 40;
const MAX_RAW_MEASUREMENTS = 20;

function cleanString(value: unknown, max = 256): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function finiteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sanitizeKeyValues(value: unknown): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_KEY_VALUES);
  const output: Record<string, string | number | boolean | null> = {};
  for (const [rawKey, rawValue] of entries) {
    const key = cleanString(rawKey, 80);
    if (!key) continue;
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) output[key] = rawValue;
    else if (typeof rawValue === "boolean") output[key] = rawValue;
    else if (rawValue == null) output[key] = null;
    else {
      const text = cleanString(String(rawValue), 500);
      if (text != null) output[key] = text;
    }
  }
  return output;
}

function sanitizeRawMeasurements(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_RAW_MEASUREMENTS).map((item) => {
    const row = item && typeof item === "object" && !Array.isArray(item)
      ? item as Record<string, unknown>
      : {};
    const output: Record<string, string | number> = {};
    for (const key of ["sphere_d", "cylinder_d", "axis_raw_deg", "axis_deg"]) {
      const number = finiteNumber(row[key]);
      if (number != null) output[key] = number;
    }
    const sourceLine = cleanString(row.source_line, 240);
    if (sourceLine) output.source_line = sourceLine;
    return output;
  }).filter((row) => Object.keys(row).length > 0);
}

function normalizeEyeSide(value: unknown) {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    raw_text: cleanString(input.raw_text, 2000) || "",
    key_values: sanitizeKeyValues(input.key_values),
    raw_measurements: sanitizeRawMeasurements(input.raw_measurements),
  };
}

function uniqueWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanString(item, 160)).filter(Boolean) as string[])].slice(0, 20);
}

function buildBasicSummary({ examType, examItemName, manualLabel, requiresReupload }: any) {
  if (requiresReupload) return `${examType}；原图质量不足，等待重新上传`;
  const item = manualLabel || examItemName || examType;
  return `${examType}：${item}`.slice(0, 300);
}

export function createEyeExamMetadata(input: Record<string, any> = {}) {
  const existingCore = input.core_routing_fields || {};
  const existingValueAdd = input.value_add_fields || {};
  const confidence = finiteNumber(input.parse_confidence);
  const templateMatchScore = finiteNumber(input.template_match_score);
  const ocrQualityScore = finiteNumber(input.ocr_quality_score);
  const status = Object.values(EYE_EXAM_PARSE_STATUS).includes(input.parse_status as string)
    ? input.parse_status
    : EYE_EXAM_PARSE_STATUS.partial;
  const eyeSidesInput = input.eye_side_results || existingValueAdd.eye_side_results;
  const eyeSides = eyeSidesInput && typeof eyeSidesInput === "object"
    ? eyeSidesInput as Record<string, unknown>
    : {};
  const normalizedEyeSides = {
    right: normalizeEyeSide(eyeSides.right),
    left: normalizeEyeSide(eyeSides.left),
  };
  const ocrQualityFlag = EYE_EXAM_OCR_QUALITY_FLAGS.includes(input.ocr_quality_flag as string)
    ? input.ocr_quality_flag
    : null;
  const examType = cleanString(input.exam_type || existingCore.exam_type, 120)
    || "未识别眼科检查报告";
  const examItemName = cleanString(input.exam_item_name || existingCore.exam_item_name, 180)
    || examType;
  const manualTag = cleanString(input.exam_item_manual_tag, 80);
  const manualLabel = cleanString(input.exam_item_manual_label, 120);
  const suggestedTag = cleanString(input.exam_item_suggested_tag, 80);

  // measured_at remains the actual examination timestamp. It must never be
  // silently replaced by upload/report time. Routing can separately fall back
  // to occurred_at/reported_at without corrupting the detailed record.
  const measuredAt = cleanString(input.measured_at, 64)
    || cleanString(input.measured_at_hint, 64);
  const reportedAt = cleanString(input.reported_at, 64)
    || cleanString(existingCore.reported_at, 64);
  const routingOccurredAt = cleanString(input.occurred_at, 64)
    || measuredAt
    || cleanString(existingCore.occurred_at, 64)
    || reportedAt;

  const reportKeyValues = sanitizeKeyValues(input.report_key_values || existingValueAdd.report_key_values);
  const deviceVendor = cleanString(input.device_vendor || existingValueAdd.device_context?.device_vendor, 120);
  const deviceModel = cleanString(input.device_model || existingValueAdd.device_context?.device_model, 160);
  const requiresReupload = input.requires_reupload === true;
  const effectiveItemTag = manualTag
    || suggestedTag
    || cleanString(existingCore.item_tag, 80)
    || examItemName;

  const layers = buildMetadataLayers({
    core_routing_fields: {
      metadata_domain: "eye_exam",
      exam_type: examType,
      exam_item_name: examItemName,
      clinic_id: input.clinic_id || existingCore.clinic_id,
      patient_id: input.patient_id || existingCore.patient_id,
      department: input.department || existingCore.department,
      role: input.role || existingCore.role,
      occurred_at: routingOccurredAt,
      reported_at: reportedAt,
      basic_summary: input.basic_summary
        || existingCore.basic_summary
        || buildBasicSummary({ examType, examItemName, manualLabel, requiresReupload }),
      item_tag: effectiveItemTag,
      priority_hint: input.priority_hint || existingCore.priority_hint || (requiresReupload ? "P2" : "P3"),
      sla_target_minutes: input.sla_target_minutes ?? existingCore.sla_target_minutes,
      requires_reupload: requiresReupload,
    },
    value_add_fields: {
      device_context: {
        device_vendor: deviceVendor,
        device_model: deviceModel,
      },
      report_key_values: reportKeyValues,
      eye_side_results: normalizedEyeSides,
    },
    routing_required_fields: ["clinic_id", "exam_type", "exam_item_name", "occurred_at", "basic_summary"],
    value_add_expected_fields: ["device_context", "report_key_values", "eye_side_results"],
  });

  return {
    schema_version: EYE_EXAM_METADATA_SCHEMA_VERSION,
    record_kind: "exam_data_record",
    ...layers,

    // Flat fields are compatibility mirrors for existing Phase 1/2 parsers and UI.
    // New routing code must read core_routing_fields; value-add services must read
    // value_add_fields so the two product layers cannot be mixed accidentally.
    exam_type: layers.core_routing_fields.exam_type,
    exam_item_name: layers.core_routing_fields.exam_item_name,
    exam_item_suggested_tag: suggestedTag,
    exam_item_manual_tag: manualTag,
    exam_item_manual_label: manualLabel,
    exam_item_manual_note: cleanString(input.exam_item_manual_note, 240),
    exam_item_confirmed_at: cleanString(input.exam_item_confirmed_at, 64),
    exam_item_confirmed_by_staff_id: cleanString(input.exam_item_confirmed_by_staff_id, 128),
    requires_exam_item_confirmation: input.requires_exam_item_confirmation === true,
    device_vendor: deviceVendor,
    device_model: deviceModel,
    measured_at: measuredAt,
    clinic_id: layers.core_routing_fields.clinic_id,
    patient_id: layers.core_routing_fields.patient_id,
    department: layers.core_routing_fields.department,
    role: layers.core_routing_fields.role,
    occurred_at: layers.core_routing_fields.occurred_at,
    reported_at: layers.core_routing_fields.reported_at,
    basic_summary: layers.core_routing_fields.basic_summary,
    raw_artifact_id: cleanString(input.raw_artifact_id, 128),
    origin_evidence_item_id: cleanString(input.origin_evidence_item_id, 128),
    evidence_fact_card_id: cleanString(input.evidence_fact_card_id, 128),
    report_key_values: reportKeyValues,
    eye_side_results: normalizedEyeSides,
    parser_id: cleanString(input.parser_id, 120) || "fallback_eye_exam_parser",
    parser_version: cleanString(input.parser_version, 64) || "phase1.v1",
    template_id: cleanString(input.template_id, 120),
    template_version: cleanString(input.template_version, 64),
    template_match_score: templateMatchScore == null
      ? null
      : Math.max(0, Math.min(1, templateMatchScore)),
    ocr_quality_score: ocrQualityScore == null
      ? null
      : Math.round(Math.max(0, Math.min(100, ocrQualityScore))),
    ocr_quality_flag: ocrQualityFlag,
    ocr_quality_reasons: uniqueWarnings(input.ocr_quality_reasons),
    requires_reupload: requiresReupload,
    parse_status: status,
    parse_confidence: confidence == null ? 0.4 : Math.max(0, Math.min(1, confidence)),
    warnings: uniqueWarnings(input.warnings),
    raw_text_excerpt: cleanString(input.raw_text_excerpt, MAX_RAW_TEXT),
    disclaimer: EYE_EXAM_DISCLAIMER,
  };
}

export function hasEyeSideKeyValues(metadata: any): boolean {
  const right = metadata?.value_add_fields?.eye_side_results?.right?.key_values
    || metadata?.eye_side_results?.right?.key_values
    || {};
  const left = metadata?.value_add_fields?.eye_side_results?.left?.key_values
    || metadata?.eye_side_results?.left?.key_values
    || {};
  return Object.keys(right).length > 0 || Object.keys(left).length > 0;
}

export function mergeRuleAndLlmMetadata(ruleMetadata: any, llmMetadata: any) {
  if (!llmMetadata || typeof llmMetadata !== "object") return createEyeExamMetadata(ruleMetadata);
  const merged = createEyeExamMetadata({
    ...ruleMetadata,
    exam_type: llmMetadata.exam_type || ruleMetadata.exam_type,
    exam_item_name: llmMetadata.exam_item_name || ruleMetadata.exam_item_name,
    device_vendor: llmMetadata.device_vendor || ruleMetadata.device_vendor,
    device_model: llmMetadata.device_model || ruleMetadata.device_model,
    measured_at: llmMetadata.measured_at || ruleMetadata.measured_at,
    report_key_values: {
      ...(ruleMetadata.report_key_values || {}),
      ...(llmMetadata.report_key_values || {}),
    },
    eye_side_results: {
      right: {
        raw_text: llmMetadata.eye_side_results?.right?.raw_text || ruleMetadata.eye_side_results?.right?.raw_text,
        key_values: {
          ...(ruleMetadata.eye_side_results?.right?.key_values || {}),
          ...(llmMetadata.eye_side_results?.right?.key_values || {}),
        },
        raw_measurements: ruleMetadata.eye_side_results?.right?.raw_measurements || [],
      },
      left: {
        raw_text: llmMetadata.eye_side_results?.left?.raw_text || ruleMetadata.eye_side_results?.left?.raw_text,
        key_values: {
          ...(ruleMetadata.eye_side_results?.left?.key_values || {}),
          ...(llmMetadata.eye_side_results?.left?.key_values || {}),
        },
        raw_measurements: ruleMetadata.eye_side_results?.left?.raw_measurements || [],
      },
    },
    parse_status: llmMetadata.parse_status || ruleMetadata.parse_status,
    parse_confidence: Math.max(
      Number(ruleMetadata.parse_confidence || 0),
      Number(llmMetadata.parse_confidence || 0),
    ),
    warnings: [
      ...(ruleMetadata.warnings || []),
      ...(llmMetadata.warnings || []),
      "llm_completion_applied",
    ],
  });

  // Tenant, provenance, layer routing identity, upload quality and user
  // confirmation are controlled by deterministic/server layers. LLM output
  // cannot replace them.
  return createEyeExamMetadata({
    ...merged,
    clinic_id: ruleMetadata.clinic_id || null,
    patient_id: ruleMetadata.patient_id || null,
    department: ruleMetadata.department || null,
    role: ruleMetadata.role || null,
    occurred_at: ruleMetadata.occurred_at || ruleMetadata.measured_at || ruleMetadata.reported_at || null,
    reported_at: ruleMetadata.reported_at || null,
    raw_artifact_id: ruleMetadata.raw_artifact_id || null,
    origin_evidence_item_id: ruleMetadata.origin_evidence_item_id || null,
    evidence_fact_card_id: ruleMetadata.evidence_fact_card_id || null,
    parser_id: ruleMetadata.parser_id,
    parser_version: ruleMetadata.parser_version,
    template_id: ruleMetadata.template_id || null,
    template_version: ruleMetadata.template_version || null,
    template_match_score: ruleMetadata.template_match_score ?? null,
    ocr_quality_score: ruleMetadata.ocr_quality_score ?? null,
    ocr_quality_flag: ruleMetadata.ocr_quality_flag || null,
    ocr_quality_reasons: ruleMetadata.ocr_quality_reasons || [],
    requires_reupload: ruleMetadata.requires_reupload === true,
    exam_item_suggested_tag: ruleMetadata.exam_item_suggested_tag || null,
    exam_item_manual_tag: ruleMetadata.exam_item_manual_tag || null,
    exam_item_manual_label: ruleMetadata.exam_item_manual_label || null,
    exam_item_manual_note: ruleMetadata.exam_item_manual_note || null,
    exam_item_confirmed_at: ruleMetadata.exam_item_confirmed_at || null,
    exam_item_confirmed_by_staff_id: ruleMetadata.exam_item_confirmed_by_staff_id || null,
    requires_exam_item_confirmation: ruleMetadata.requires_exam_item_confirmation === true,
    raw_text_excerpt: ruleMetadata.raw_text_excerpt || null,
  });
}

function legacyCoreAliases(metadata: any, artifactId: string) {
  const fields: any[] = [];
  const push = (fieldName: string, value: unknown, quality = "high", method = "eye_exam_core_projection") => {
    if (value == null || value === "") return;
    fields.push({
      field_name: fieldName,
      value: typeof value === "string" ? value : JSON.stringify(value),
      source_artifact_id: artifactId,
      source_region: "core_routing_fields",
      source_quote: metadata.raw_text_excerpt || "",
      extraction_quality: quality,
      extraction_method: method,
    });
  };
  push("eye_exam.exam_type", metadata.core_routing_fields?.exam_type);
  push("eye_exam.exam_item_name", metadata.core_routing_fields?.exam_item_name);
  push("eye_exam.exam_item_suggested_tag", metadata.exam_item_suggested_tag, "medium");
  push("eye_exam.exam_item_manual_tag", metadata.exam_item_manual_tag, "high", "user_confirmed");
  push("eye_exam.exam_item_manual_label", metadata.exam_item_manual_label, "high", "user_confirmed");
  push(
    "eye_exam.match_exam_item",
    metadata.core_routing_fields?.item_tag,
    metadata.exam_item_manual_tag ? "high" : "medium",
    metadata.exam_item_manual_tag ? "user_confirmed" : "eye_exam_core_projection",
  );
  push("eye_exam.measured_at", metadata.measured_at || metadata.core_routing_fields?.occurred_at, "medium");
  push("eye_exam.routing_status", metadata.routing_status);
  push("eye_exam.value_add_status", metadata.value_add_status);
  return fields;
}

export function metadataToFactCardFields(metadata: any, artifactId: string) {
  if (!metadata?.core_routing_fields) return [];
  return [
    ...coreRoutingToFactCardFields({
      core_routing_fields: metadata.core_routing_fields,
      routing_status: metadata.routing_status,
      value_add_status: metadata.value_add_status,
      artifact_id: artifactId,
      source_quote: metadata.raw_text_excerpt || "",
      extraction_method: "eye_exam_core_projection",
    }),
    ...legacyCoreAliases(metadata, artifactId),
  ];
}

export function getEyeExamValueAddAccess(metadata: any, featureEnabled = true) {
  return getValueAddAccessResult(metadata, featureEnabled);
}

export const EYE_EXAM_LLM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    exam_type: { type: "string" },
    exam_item_name: { type: "string" },
    device_vendor: { type: "string" },
    device_model: { type: "string" },
    measured_at: { type: "string" },
    report_key_values: { type: "object", additionalProperties: true },
    eye_side_results: {
      type: "object",
      additionalProperties: false,
      properties: {
        right: {
          type: "object",
          additionalProperties: false,
          properties: {
            raw_text: { type: "string" },
            key_values: { type: "object", additionalProperties: true },
          },
        },
        left: {
          type: "object",
          additionalProperties: false,
          properties: {
            raw_text: { type: "string" },
            key_values: { type: "object", additionalProperties: true },
          },
        },
      },
    },
    parse_status: { type: "string", enum: ["parsed", "partial", "fallback"] },
    parse_confidence: { type: "number", minimum: 0, maximum: 1 },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["exam_type", "eye_side_results", "parse_status", "parse_confidence", "warnings"],
};
