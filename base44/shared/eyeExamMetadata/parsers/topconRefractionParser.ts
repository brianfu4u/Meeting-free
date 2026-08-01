import { createEyeExamMetadata, EYE_EXAM_PARSE_STATUS } from "../model.ts";
import {
  countKeys,
  detectVendorModel,
  extractMeasuredAt,
  firstLabeledNumber,
  normalizeExamText,
  parseRefractionValues,
  splitEyeSections,
} from "../common.ts";

export const topconRefractionParser = {
  id: "topcon_refraction_parser",
  version: "phase1.v1",
  detect(rawText: unknown) {
    const text = normalizeExamText(rawText).toUpperCase();
    let score = 0;
    if (/\bTOPCON\b/.test(text)) score += 0.3;
    if (/REF\s*DATA|AUTO\s*REF|REFRACT|验光|屈光/.test(text)) score += 0.4;
    if (/\bSPH\b|\bCYL\b|\bAXIS\b|\bS\s*[+-]?\d/.test(text)) score += 0.25;
    if (/\bKR[- ]?\d{3,4}\b|KERATO/.test(text)) score += 0.1;
    return Math.min(1, score);
  },
  parse(rawText: unknown, context: Record<string, unknown> = {}) {
    const text = normalizeExamText(rawText);
    const sides = splitEyeSections(text);
    const device = detectVendorModel(text, "TOPCON", context.device_model);

    const parseSide = (sideText: string) => {
      const refraction = parseRefractionValues(sideText);
      const keratometry = {
        k1_d: firstLabeledNumber(sideText, ["K1", "R1"]),
        k2_d: firstLabeledNumber(sideText, ["K2", "R2"]),
      };
      const keyValues: Record<string, unknown> = { ...refraction };
      if (keratometry.k1_d != null) keyValues.k1_d = keratometry.k1_d;
      if (keratometry.k2_d != null) keyValues.k2_d = keratometry.k2_d;
      return { raw_text: sideText, key_values: keyValues };
    };

    const right = parseSide(sides.right);
    const left = parseSide(sides.left);
    const keyCount = countKeys(right.key_values) + countKeys(left.key_values);

    return createEyeExamMetadata({
      ...context,
      exam_type: "屈光验光",
      exam_item_name: /REF\s*DATA/i.test(text) ? "Ref Data" : "自动验光",
      ...device,
      measured_at: extractMeasuredAt(text, context.measured_at_hint),
      eye_side_results: { right, left },
      parser_id: topconRefractionParser.id,
      parser_version: topconRefractionParser.version,
      parse_status: keyCount >= 4 ? EYE_EXAM_PARSE_STATUS.parsed : EYE_EXAM_PARSE_STATUS.partial,
      parse_confidence: keyCount >= 4 ? 0.9 : 0.66,
      warnings: keyCount >= 4 ? [] : ["refraction_values_not_fully_detected"],
      raw_text_excerpt: text,
    });
  },
};
