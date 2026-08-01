import { createEyeExamMetadata, EYE_EXAM_PARSE_STATUS } from "../model.ts";
import {
  countKeys,
  detectVendorModel,
  extractMeasuredAt,
  firstLabeledNumber,
  normalizeExamText,
  splitEyeSections,
} from "../common.ts";

export const zeissOctParser = {
  id: "zeiss_oct_parser",
  version: "phase1.v1",
  detect(rawText: unknown) {
    const text = normalizeExamText(rawText).toUpperCase();
    let score = 0;
    if (/\bZEISS\b|CARL ZEISS/.test(text)) score += 0.35;
    if (/\bCIRRUS\b|HD[- ]?OCT/.test(text)) score += 0.3;
    if (/MACULAR CUBE|OPTIC DISC CUBE|RNFL|OCT|光学相干断层/.test(text)) score += 0.35;
    return Math.min(1, score);
  },
  parse(rawText: unknown, context: Record<string, unknown> = {}) {
    const text = normalizeExamText(rawText);
    const sides = splitEyeSections(text);
    const device = detectVendorModel(text, "ZEISS", context.device_model);

    const parseSide = (sideText: string) => {
      const keyValues: Record<string, unknown> = {};
      const cst = firstLabeledNumber(sideText, ["CENTRAL SUBFIELD THICKNESS", "CST", "CENTRAL THICKNESS", "中心凹厚度"], "(?:UM|µM|ΜM)?");
      const avg = firstLabeledNumber(sideText, ["AVERAGE THICKNESS", "AVG THICKNESS", "平均厚度"], "(?:UM|µM|ΜM)?");
      const rnfl = firstLabeledNumber(sideText, ["RNFL AVERAGE", "AVERAGE RNFL", "RNFL AVG"], "(?:UM|µM|ΜM)?");
      const signal = firstLabeledNumber(sideText, ["SIGNAL STRENGTH", "信号强度"]);
      if (cst != null) keyValues.central_subfield_thickness_um = cst;
      if (avg != null) keyValues.average_thickness_um = avg;
      if (rnfl != null) keyValues.rnfl_average_um = rnfl;
      if (signal != null) keyValues.signal_strength = signal;
      return { raw_text: sideText, key_values: keyValues };
    };

    const right = parseSide(sides.right);
    const left = parseSide(sides.left);
    const keyCount = countKeys(right.key_values) + countKeys(left.key_values);
    const itemMatch = text.match(/(MACULAR CUBE\s*\d+\s*[x×]\s*\d+|OPTIC DISC CUBE\s*\d+\s*[x×]\s*\d+|RNFL(?:\s+AND\s+ONH)?)/i);

    return createEyeExamMetadata({
      ...context,
      exam_type: "OCT",
      exam_item_name: itemMatch ? itemMatch[1].replace(/×/g, "x") : "ZEISS Cirrus OCT",
      ...device,
      measured_at: extractMeasuredAt(text, context.measured_at_hint),
      eye_side_results: { right, left },
      parser_id: zeissOctParser.id,
      parser_version: zeissOctParser.version,
      parse_status: keyCount > 0 ? EYE_EXAM_PARSE_STATUS.parsed : EYE_EXAM_PARSE_STATUS.partial,
      parse_confidence: keyCount > 0 ? 0.9 : 0.7,
      warnings: keyCount > 0 ? [] : ["oct_key_values_not_fully_detected"],
      raw_text_excerpt: text,
    });
  },
};
