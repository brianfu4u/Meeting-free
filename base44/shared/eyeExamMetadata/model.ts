export const EYE_EXAM_METADATA_SCHEMA_VERSION = "eye-exam-report-metadata.v1.2";
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

export function createEyeExamMetadata(input: Record<string, unknown> = {}) {
  const confidence = finiteNumber(input.parse_confidence);
  const templateMatchScore = finiteNumber(input.template_match_score);
  const ocrQualityScore = finiteNumber(input.ocr_quality_score);
  const status = Object.values(EYE_EXAM_PARSE_STATUS).includes(input.parse_status as string)
    ? input.parse_status
    : EYE_EXAM_PARSE_STATUS.partial;
  const eyeSides = input.eye_side_results && typeof input.eye_side_results === "object"
    ? input.eye_side_results as Record<string, unknown>
    : {};
  const ocrQualityFlag = EYE_EXAM_OCR_QUALITY_FLAGS.includes(input.ocr_quality_flag as string)
    ? input.ocr_quality_flag
    : null;

  return {
    schema_version: EYE_EXAM_METADATA_SCHEMA_VERSION,
    record_kind: "exam_data_record",
    exam_type: cleanString(input.exam_type, 120) || "未识别眼科检查报告",
    exam_item_name: cleanString(input.exam_item_name, 180),
    exam_item_suggested_tag: cleanString(input.exam_item_suggested_tag, 80),
    exam_item_manual_tag: cleanString(input.exam_item_manual_tag, 80),
    exam_item_manual_label: cleanString(input.exam_item_manual_label, 120),
    exam_item_manual_note: cleanString(input.exam_item_manual_note, 240),
    exam_item_confirmed_at: cleanString(input.exam_item_confirmed_at, 64),
    exam_item_confirmed_by_staff_id: cleanString(input.exam_item_confirmed_by_staff_id, 128),
    requires_exam_item_confirmation: input.requires_exam_item_confirmation === true,
    device_vendor: cleanString(input.device_vendor, 120),
    device_model: cleanString(input.device_model, 160),
    measured_at: cleanString(input.measured_at, 64),
    clinic_id: cleanString(input.clinic_id, 128),
    patient_id: cleanString(input.patient_id, 128),
    raw_artifact_id: cleanString(input.raw_artifact_id, 128),
    origin_evidence_item_id: cleanString(input.origin_evidence_item_id, 128),
    evidence_fact_card_id: cleanString(input.evidence_fact_card_id, 128),
    report_key_values: sanitizeKeyValues(input.report_key_values),
    eye_side_results: {
      right: normalizeEyeSide(eyeSides.right),
      left: normalizeEyeSide(eyeSides.left),
    },
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
    requires_reupload: input.requires_reupload === true,
    parse_status: status,
    parse_confidence: confidence == null ? 0.4 : Math.max(0, Math.min(1, confidence)),
    warnings: uniqueWarnings(input.warnings),
    raw_text_excerpt: cleanString(input.raw_text_excerpt, MAX_RAW_TEXT),
    disclaimer: EYE_EXAM_DISCLAIMER,
  };
}

export function hasEyeSideKeyValues(metadata: any): boolean {
  const right = metadata?.eye_side_results?.right?.key_values || {};
  const left = metadata?.eye_side_results?.left?.key_values || {};
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

  // Tenant, provenance, upload quality and user-confirmation identity are
  // controlled by deterministic/server layers. LLM output cannot replace them.
  return {
    ...merged,
    clinic_id: ruleMetadata.clinic_id || null,
    patient_id: ruleMetadata.patient_id || null,
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
    disclaimer: EYE_EXAM_DISCLAIMER,
  };
}

export function metadataToFactCardFields(metadata: any, artifactId: string) {
  if (!metadata) return [];
  const fields: any[] = [];
  const push = (fieldName: string, value: unknown, quality = "high", method?: string) => {
    if (value == null || value === "") return;
    fields.push({
      field_name: fieldName,
      value: typeof value === "string" ? value : JSON.stringify(value),
      source_artifact_id: artifactId,
      source_region: "eye_exam_report_metadata",
      source_quote: metadata.raw_text_excerpt || "",
      extraction_quality: quality,
      extraction_method: method || (metadata.warnings?.includes("llm_completion_applied") ? "rule_plus_llm" : "rule_parser"),
    });
  };

  push("eye_exam.exam_type", metadata.exam_type);
  push("eye_exam.exam_item_name", metadata.exam_item_name, metadata.exam_item_name ? "high" : "uncertain");
  push("eye_exam.exam_item_suggested_tag", metadata.exam_item_suggested_tag, "medium");
  push("eye_exam.device_vendor", metadata.device_vendor, metadata.device_vendor ? "high" : "uncertain");
  push("eye_exam.device_model", metadata.device_model, metadata.device_model ? "medium" : "uncertain");
  push("eye_exam.measured_at", metadata.measured_at, metadata.measured_at ? "medium" : "uncertain");
  push("eye_exam.parse_status", metadata.parse_status);
  push("eye_exam.ocr_quality_score", metadata.ocr_quality_score, metadata.ocr_quality_flag === "poor" ? "uncertain" : "high");
  push("eye_exam.ocr_quality_flag", metadata.ocr_quality_flag, metadata.ocr_quality_flag === "poor" ? "uncertain" : "high");
  push("eye_exam.requires_reupload", metadata.requires_reupload === true);
  push("eye_exam.requires_exam_item_confirmation", metadata.requires_exam_item_confirmation === true);

  if (metadata.exam_item_manual_tag) {
    push("eye_exam.exam_item_manual_tag", metadata.exam_item_manual_tag, "confirmed", "user_confirmed");
    push("eye_exam.exam_item_manual_label", metadata.exam_item_manual_label, "confirmed", "user_confirmed");
    push("eye_exam.exam_item_manual_note", metadata.exam_item_manual_note, "confirmed", "user_confirmed");
    push("eye_exam.match_exam_item", metadata.exam_item_manual_tag, "confirmed", "user_confirmed");
  } else if (!metadata.requires_reupload) {
    push("eye_exam.match_exam_item", metadata.exam_item_suggested_tag || metadata.exam_item_name, "medium");
  }

  for (const [key, value] of Object.entries(metadata.report_key_values || {}).slice(0, 20)) {
    push(`eye_exam.${key}`, value, "high");
  }
  for (const side of ["right", "left"]) {
    const values = metadata.eye_side_results?.[side]?.key_values || {};
    for (const [key, value] of Object.entries(values).slice(0, 20)) {
      push(`eye_exam.${side}.${key}`, value, "medium");
    }
  }
  return fields;
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
