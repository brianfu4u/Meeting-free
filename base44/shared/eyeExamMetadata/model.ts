export const EYE_EXAM_METADATA_SCHEMA_VERSION = "eye-exam-report-metadata.v1";
export const EYE_EXAM_DISCLAIMER = "仅为检查数据记录，不构成医学诊断或治疗建议。";

export const EYE_EXAM_PARSE_STATUS = Object.freeze({
  parsed: "parsed",
  partial: "partial",
  fallback: "fallback",
});

const MAX_RAW_TEXT = 4000;
const MAX_KEY_VALUES = 40;

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

function normalizeEyeSide(value: unknown) {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    raw_text: cleanString(input.raw_text, 2000) || "",
    key_values: sanitizeKeyValues(input.key_values),
  };
}

function uniqueWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanString(item, 160)).filter(Boolean) as string[])].slice(0, 20);
}

export function createEyeExamMetadata(input: Record<string, unknown> = {}) {
  const confidence = finiteNumber(input.parse_confidence);
  const status = Object.values(EYE_EXAM_PARSE_STATUS).includes(input.parse_status as string)
    ? input.parse_status
    : EYE_EXAM_PARSE_STATUS.partial;
  const eyeSides = input.eye_side_results && typeof input.eye_side_results === "object"
    ? input.eye_side_results as Record<string, unknown>
    : {};

  return {
    schema_version: EYE_EXAM_METADATA_SCHEMA_VERSION,
    record_kind: "exam_data_record",
    exam_type: cleanString(input.exam_type, 120) || "未识别眼科检查报告",
    exam_item_name: cleanString(input.exam_item_name, 180),
    device_vendor: cleanString(input.device_vendor, 120),
    device_model: cleanString(input.device_model, 160),
    measured_at: cleanString(input.measured_at, 64),
    clinic_id: cleanString(input.clinic_id, 128),
    patient_id: cleanString(input.patient_id, 128),
    raw_artifact_id: cleanString(input.raw_artifact_id, 128),
    origin_evidence_item_id: cleanString(input.origin_evidence_item_id, 128),
    evidence_fact_card_id: cleanString(input.evidence_fact_card_id, 128),
    eye_side_results: {
      right: normalizeEyeSide(eyeSides.right),
      left: normalizeEyeSide(eyeSides.left),
    },
    parser_id: cleanString(input.parser_id, 120) || "fallback_eye_exam_parser",
    parser_version: cleanString(input.parser_version, 64) || "phase1.v1",
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
    eye_side_results: {
      right: {
        raw_text: llmMetadata.eye_side_results?.right?.raw_text || ruleMetadata.eye_side_results?.right?.raw_text,
        key_values: {
          ...(ruleMetadata.eye_side_results?.right?.key_values || {}),
          ...(llmMetadata.eye_side_results?.right?.key_values || {}),
        },
      },
      left: {
        raw_text: llmMetadata.eye_side_results?.left?.raw_text || ruleMetadata.eye_side_results?.left?.raw_text,
        key_values: {
          ...(ruleMetadata.eye_side_results?.left?.key_values || {}),
          ...(llmMetadata.eye_side_results?.left?.key_values || {}),
        },
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

  // Context and provenance are always controlled by the rule/dispatch layer.
  return {
    ...merged,
    clinic_id: ruleMetadata.clinic_id || null,
    patient_id: ruleMetadata.patient_id || null,
    raw_artifact_id: ruleMetadata.raw_artifact_id || null,
    origin_evidence_item_id: ruleMetadata.origin_evidence_item_id || null,
    evidence_fact_card_id: ruleMetadata.evidence_fact_card_id || null,
    parser_id: ruleMetadata.parser_id,
    parser_version: ruleMetadata.parser_version,
    raw_text_excerpt: ruleMetadata.raw_text_excerpt || null,
    disclaimer: EYE_EXAM_DISCLAIMER,
  };
}

export function metadataToFactCardFields(metadata: any, artifactId: string) {
  if (!metadata) return [];
  const fields: any[] = [];
  const push = (fieldName: string, value: unknown, quality = "high") => {
    if (value == null || value === "") return;
    fields.push({
      field_name: fieldName,
      value: typeof value === "string" ? value : JSON.stringify(value),
      source_artifact_id: artifactId,
      source_region: "eye_exam_report_metadata",
      source_quote: metadata.raw_text_excerpt || "",
      extraction_quality: quality,
      extraction_method: metadata.warnings?.includes("llm_completion_applied") ? "rule_plus_llm" : "rule_parser",
    });
  };

  push("eye_exam.exam_type", metadata.exam_type);
  push("eye_exam.exam_item_name", metadata.exam_item_name, metadata.exam_item_name ? "high" : "uncertain");
  push("eye_exam.device_vendor", metadata.device_vendor, metadata.device_vendor ? "high" : "uncertain");
  push("eye_exam.device_model", metadata.device_model, metadata.device_model ? "medium" : "uncertain");
  push("eye_exam.measured_at", metadata.measured_at, metadata.measured_at ? "medium" : "uncertain");
  push("eye_exam.parse_status", metadata.parse_status);

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
