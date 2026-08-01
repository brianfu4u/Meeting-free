import { createEyeExamMetadata, EYE_EXAM_PARSE_STATUS } from "../model.ts";
import {
  detectVendorModel,
  extractMeasuredAt,
  normalizeExamText,
  splitEyeSections,
} from "../common.ts";

export const genericFundusPhotoParser = {
  id: "generic_fundus_photo_parser",
  version: "phase1.v1",
  detect(rawText: unknown) {
    const text = normalizeExamText(rawText).toUpperCase();
    let score = 0;
    if (/FUNDUS|RETINAL PHOTO|RETINA CAMERA|眼底照相|眼底摄影|眼底彩照/.test(text)) score += 0.7;
    if (/OD\b|OS\b|RIGHT EYE|LEFT EYE|右眼|左眼/.test(text)) score += 0.15;
    if (/CANON|KOWA|TOPCON|NIDEK|ZEISS/.test(text)) score += 0.15;
    return Math.min(1, score);
  },
  parse(rawText: unknown, context: Record<string, unknown> = {}) {
    const text = normalizeExamText(rawText);
    const sides = splitEyeSections(text);
    const device = detectVendorModel(text, context.device_vendor, context.device_model);
    const itemMatch = text.match(/(COLOR FUNDUS PHOTOGRAPHY|FUNDUS PHOTO(?:GRAPHY)?|RETINAL PHOTO(?:GRAPHY)?|眼底(?:照相|摄影|彩照))/i);

    return createEyeExamMetadata({
      ...context,
      exam_type: "眼底照相",
      exam_item_name: itemMatch ? itemMatch[1] : "眼底照相",
      ...device,
      measured_at: extractMeasuredAt(text, context.measured_at_hint),
      eye_side_results: {
        right: { raw_text: sides.right, key_values: {} },
        left: { raw_text: sides.left, key_values: {} },
      },
      parser_id: genericFundusPhotoParser.id,
      parser_version: genericFundusPhotoParser.version,
      parse_status: EYE_EXAM_PARSE_STATUS.parsed,
      parse_confidence: 0.82,
      warnings: ["image_findings_are_not_interpreted_in_phase1"],
      raw_text_excerpt: text,
    });
  },
};
