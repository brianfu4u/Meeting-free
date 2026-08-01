import { createEyeExamMetadata, EYE_EXAM_PARSE_STATUS } from "../model.ts";
import {
  countKeys,
  detectVendorModel,
  extractMeasuredAt,
  firstLabeledNumber,
  normalizeExamText,
  splitEyeSections,
} from "../common.ts";

export const genericOcularUltrasoundParser = {
  id: "generic_ocular_ultrasound_parser",
  version: "phase1.v1",
  detect(rawText: unknown) {
    const text = normalizeExamText(rawText).toUpperCase();
    let score = 0;
    if (/OCULAR ULTRASOUND|OPHTHALMIC ULTRASOUND|眼科.*超声|眼球.*超声|A\/B.*SCAN|AB.*超声/.test(text)) score += 0.65;
    if (/\bA[- ]?SCAN\b|\bB[- ]?SCAN\b|AXIAL LENGTH|\bAL\b|ACD|LENS THICKNESS|VITREOUS/.test(text)) score += 0.35;
    return Math.min(1, score);
  },
  parse(rawText: unknown, context: Record<string, unknown> = {}) {
    const text = normalizeExamText(rawText);
    const sides = splitEyeSections(text);
    const device = detectVendorModel(text, context.device_vendor, context.device_model);

    const parseSide = (sideText: string) => {
      const keyValues: Record<string, unknown> = {};
      const axialLength = firstLabeledNumber(sideText, ["AXIAL LENGTH", "AL", "眼轴长度"], "(?:MM)?");
      const acd = firstLabeledNumber(sideText, ["ACD", "ANTERIOR CHAMBER DEPTH", "前房深度"], "(?:MM)?");
      const lens = firstLabeledNumber(sideText, ["LENS THICKNESS", "LT", "晶状体厚度"], "(?:MM)?");
      const vitreous = firstLabeledNumber(sideText, ["VITREOUS LENGTH", "VIT", "玻璃体腔长度"], "(?:MM)?");
      if (axialLength != null) keyValues.axial_length_mm = axialLength;
      if (acd != null) keyValues.anterior_chamber_depth_mm = acd;
      if (lens != null) keyValues.lens_thickness_mm = lens;
      if (vitreous != null) keyValues.vitreous_length_mm = vitreous;
      return { raw_text: sideText, key_values: keyValues };
    };

    const right = parseSide(sides.right);
    const left = parseSide(sides.left);
    const keyCount = countKeys(right.key_values) + countKeys(left.key_values);
    const itemMatch = text.match(/(A\/B\s*(?:SCAN|超声)|A[- ]?SCAN|B[- ]?SCAN|眼科\s*AB型超声)/i);

    return createEyeExamMetadata({
      ...context,
      exam_type: "眼科超声",
      exam_item_name: itemMatch ? itemMatch[1].replace(/\s+/g, " ") : "眼科 A/B 型超声",
      ...device,
      measured_at: extractMeasuredAt(text, context.measured_at_hint),
      eye_side_results: { right, left },
      parser_id: genericOcularUltrasoundParser.id,
      parser_version: genericOcularUltrasoundParser.version,
      parse_status: keyCount > 0 ? EYE_EXAM_PARSE_STATUS.parsed : EYE_EXAM_PARSE_STATUS.partial,
      parse_confidence: keyCount > 0 ? 0.86 : 0.63,
      warnings: keyCount > 0 ? [] : ["ultrasound_key_values_not_fully_detected"],
      raw_text_excerpt: text,
    });
  },
};
