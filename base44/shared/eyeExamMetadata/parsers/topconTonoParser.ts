import { createEyeExamMetadata, EYE_EXAM_PARSE_STATUS } from "../model.ts";
import {
  countKeys,
  detectVendorModel,
  extractMeasuredAt,
  firstLabeledNumber,
  normalizeExamText,
  numbersWithUnit,
  splitEyeSections,
} from "../common.ts";

export const topconTonoParser = {
  id: "topcon_tono_parser",
  version: "phase1.v1",
  detect(rawText: unknown) {
    const text = normalizeExamText(rawText).toUpperCase();
    let score = 0;
    if (/\bTOPCON\b/.test(text)) score += 0.35;
    if (/TONO\s*DATA|TONOMET|眼压/.test(text)) score += 0.4;
    if (/MMHG|\bIOP\b/.test(text)) score += 0.25;
    return Math.min(1, score);
  },
  parse(rawText: unknown, context: Record<string, unknown> = {}) {
    const text = normalizeExamText(rawText);
    const sides = splitEyeSections(text);
    const device = detectVendorModel(text, "TOPCON", context.device_model);

    const parseSide = (sideText: string) => {
      const measurements = numbersWithUnit(sideText, /([0-9]{1,2}(?:\.[0-9]+)?)\s*mmhg/i);
      const average = firstLabeledNumber(sideText, ["AVG", "AVERAGE", "平均"], "(?:MMHG)?")
        ?? (measurements.length > 0 ? measurements[measurements.length - 1] : null);
      const keyValues: Record<string, unknown> = {};
      if (average != null) keyValues.average_iop_mmhg = average;
      if (measurements.length > 1) keyValues.measurements_mmhg = measurements.join(", ");
      return { raw_text: sideText, key_values: keyValues };
    };

    const right = parseSide(sides.right);
    const left = parseSide(sides.left);
    const hasValues = countKeys(right.key_values) + countKeys(left.key_values) > 0;

    return createEyeExamMetadata({
      ...context,
      exam_type: "眼压检查",
      exam_item_name: /TONO\s*DATA/i.test(text) ? "Tono Data" : "眼压测量",
      ...device,
      measured_at: extractMeasuredAt(text, context.measured_at_hint),
      eye_side_results: { right, left },
      parser_id: topconTonoParser.id,
      parser_version: topconTonoParser.version,
      parse_status: hasValues ? EYE_EXAM_PARSE_STATUS.parsed : EYE_EXAM_PARSE_STATUS.partial,
      parse_confidence: hasValues ? 0.92 : 0.68,
      warnings: hasValues ? [] : ["iop_values_not_fully_detected"],
      raw_text_excerpt: text,
    });
  },
};
