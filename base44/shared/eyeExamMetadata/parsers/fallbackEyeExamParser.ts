import { createEyeExamMetadata, EYE_EXAM_PARSE_STATUS } from "../model.ts";
import {
  detectVendorModel,
  extractMeasuredAt,
  firstMeaningfulLine,
  normalizeExamText,
  splitEyeSections,
} from "../common.ts";

export const fallbackEyeExamParser = {
  id: "fallback_eye_exam_parser",
  version: "phase1.v1",
  detect() {
    return 0.1;
  },
  parse(rawText: unknown, context: Record<string, unknown> = {}) {
    const text = normalizeExamText(rawText);
    const sides = splitEyeSections(text);
    const device = detectVendorModel(text, context.device_vendor, context.device_model);
    const title = firstMeaningfulLine(text);

    return createEyeExamMetadata({
      ...context,
      exam_type: "未识别眼科检查报告",
      exam_item_name: title,
      ...device,
      measured_at: extractMeasuredAt(text, context.measured_at_hint),
      eye_side_results: {
        right: { raw_text: sides.right, key_values: {} },
        left: { raw_text: sides.left, key_values: {} },
      },
      parser_id: fallbackEyeExamParser.id,
      parser_version: fallbackEyeExamParser.version,
      parse_status: EYE_EXAM_PARSE_STATUS.fallback,
      parse_confidence: 0.35,
      warnings: ["format_not_fully_adapted"],
      raw_text_excerpt: text,
    });
  },
};
