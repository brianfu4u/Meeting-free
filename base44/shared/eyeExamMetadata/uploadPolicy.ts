import { createEyeExamMetadata } from "./model.ts";
import { inferEyeExamItemTag } from "./examItemCatalog.ts";
import { LOW_QUALITY_REUPLOAD_CODE, type OcrQualityAssessment } from "./ocrQuality.ts";

export function buildLowQualityEyeExamMetadata({
  context = {},
  rawText = "",
  quality,
}: {
  context?: Record<string, unknown>;
  rawText?: unknown;
  quality: OcrQualityAssessment;
}) {
  return createEyeExamMetadata({
    ...context,
    exam_type: "眼科检查报告（待重新上传）",
    exam_item_name: null,
    parser_id: "low_quality_eye_exam_gate",
    parser_version: "upload-quality.v1",
    parse_status: "partial",
    parse_confidence: 0,
    ocr_quality_score: quality.score,
    ocr_quality_flag: quality.flag,
    ocr_quality_reasons: quality.reasons,
    requires_reupload: true,
    requires_exam_item_confirmation: false,
    warnings: [LOW_QUALITY_REUPLOAD_CODE, ...quality.reasons],
    raw_text_excerpt: String(rawText || "").slice(0, 4000),
  });
}

export function finalizeParsedEyeExamMetadata({
  parsedMetadata,
  quality,
}: {
  parsedMetadata: Record<string, unknown>;
  quality: OcrQualityAssessment;
}) {
  const suggestedTag = inferEyeExamItemTag(parsedMetadata);
  return createEyeExamMetadata({
    ...parsedMetadata,
    ocr_quality_score: quality.score,
    ocr_quality_flag: quality.flag,
    ocr_quality_reasons: quality.reasons,
    requires_reupload: false,
    exam_item_suggested_tag: suggestedTag,
    requires_exam_item_confirmation: true,
  });
}

export function buildEyeExamUploadResponse(metadata: Record<string, any>) {
  const needsConfirmation = metadata.requires_exam_item_confirmation === true;
  return {
    warning_code: metadata.requires_reupload === true ? LOW_QUALITY_REUPLOAD_CODE : null,
    requires_reupload: metadata.requires_reupload === true,
    requires_exam_item_confirmation: needsConfirmation,
    exam_item_suggested_tag: metadata.exam_item_suggested_tag || null,
  };
}
