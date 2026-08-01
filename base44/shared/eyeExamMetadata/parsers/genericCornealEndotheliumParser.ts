import { createEyeExamMetadata, EYE_EXAM_PARSE_STATUS } from "../model.ts";
import {
  countKeys,
  detectVendorModel,
  extractMeasuredAt,
  firstLabeledNumber,
  normalizeExamText,
  splitEyeSections,
} from "../common.ts";

export const genericCornealEndotheliumParser = {
  id: "generic_corneal_endothelium_parser",
  version: "phase1.v1",
  detect(rawText: unknown) {
    const text = normalizeExamText(rawText).toUpperCase();
    let score = 0;
    if (/CORNEAL ENDOTHEL|SPECULAR MICRO|角膜内皮/.test(text)) score += 0.65;
    if (/\bCD\b|CELL DENSITY|\bCCT\b|\bHEX\b|\bCV\b/.test(text)) score += 0.35;
    return Math.min(1, score);
  },
  parse(rawText: unknown, context: Record<string, unknown> = {}) {
    const text = normalizeExamText(rawText);
    const sides = splitEyeSections(text);
    const device = detectVendorModel(text, context.device_vendor, context.device_model);

    const parseSide = (sideText: string) => {
      const keyValues: Record<string, unknown> = {};
      const cd = firstLabeledNumber(sideText, ["CD", "CELL DENSITY", "细胞密度"]);
      const avg = firstLabeledNumber(sideText, ["AVG", "AVERAGE CELL AREA", "平均细胞面积"]);
      const cct = firstLabeledNumber(sideText, ["CCT", "CORNEAL THICKNESS", "角膜厚度"], "(?:UM|µM|ΜM)?");
      const cv = firstLabeledNumber(sideText, ["CV", "COEFFICIENT OF VARIATION", "变异系数"]);
      const hex = firstLabeledNumber(sideText, ["HEX", "HEXAGONALITY", "六边形细胞"]);
      if (cd != null) keyValues.cell_density_cells_mm2 = cd;
      if (avg != null) keyValues.average_cell_area_um2 = avg;
      if (cct != null) keyValues.cct_um = cct;
      if (cv != null) keyValues.cv = cv;
      if (hex != null) keyValues.hex_percent = hex;
      return { raw_text: sideText, key_values: keyValues };
    };

    const right = parseSide(sides.right);
    const left = parseSide(sides.left);
    const keyCount = countKeys(right.key_values) + countKeys(left.key_values);

    return createEyeExamMetadata({
      ...context,
      exam_type: "角膜内皮细胞检查",
      exam_item_name: "角膜内皮细胞检测",
      ...device,
      measured_at: extractMeasuredAt(text, context.measured_at_hint),
      eye_side_results: { right, left },
      parser_id: genericCornealEndotheliumParser.id,
      parser_version: genericCornealEndotheliumParser.version,
      parse_status: keyCount > 0 ? EYE_EXAM_PARSE_STATUS.parsed : EYE_EXAM_PARSE_STATUS.partial,
      parse_confidence: keyCount > 0 ? 0.88 : 0.64,
      warnings: keyCount > 0 ? [] : ["endothelium_key_values_not_fully_detected"],
      raw_text_excerpt: text,
    });
  },
};
