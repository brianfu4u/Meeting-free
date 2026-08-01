import { normalizeExamText } from "./common.ts";

export type EyeExamFormatTemplate = {
  id: string;
  version: string;
  parser_id: string;
  exam_type: string;
  default_exam_item_name: string;
  device_vendors: string[];
  title_patterns: string[];
  structure_patterns: string[];
  required_output_fields: string[];
  units: string[];
  layout_guidance: string[];
  representative_examples: string[];
};

/**
 * Format templates describe a device/report family rather than one receipt.
 * Values, dates and patient context are deliberately absent so a template can
 * generalize across future reports with the same field vocabulary/layout.
 */
export const EYE_EXAM_FORMAT_TEMPLATES: ReadonlyArray<EyeExamFormatTemplate> = Object.freeze([
  {
    id: "topcon_tono_data_v1",
    version: "phase2.v1",
    parser_id: "topcon_tono_parser",
    exam_type: "眼压检查",
    default_exam_item_name: "Tono Data",
    device_vendors: ["TOPCON"],
    title_patterns: ["\\bTONO\\s*DATA\\b", "\\bIOP\\b", "眼压"],
    structure_patterns: [
      "(?:OD|OS|<\\s*[RL]\\s*>|右眼|左眼)",
      "\\bAVG\\b|AVERAGE|平均",
      "MMHG",
    ],
    required_output_fields: [
      "eye_side_results.right.key_values.average_iop_mmhg",
      "eye_side_results.left.key_values.average_iop_mmhg",
    ],
    units: ["mmHg"],
    layout_guidance: [
      "先按 OD/OS、R/L 或右眼/左眼分段。",
      "优先读取 AVG/AVERAGE/平均行；若只有重复测量值，保留全部值并仅在规则允许时计算代表值。",
      "不要解释眼压是否正常。",
    ],
    representative_examples: [
      "TOPCON CT-800 | TONO DATA | OD AVG 19 mmHg | OS AVG 17 mmHg",
      "<R> 18 19 19 AVG 19 mmHg | <L> 16 17 18 AVG 17 mmHg",
    ],
  },
  {
    id: "topcon_ref_data_v1",
    version: "phase2.v1",
    parser_id: "topcon_refraction_parser",
    exam_type: "屈光验光",
    default_exam_item_name: "自动验光 / Ref Data",
    device_vendors: ["TOPCON"],
    title_patterns: ["REF\\s*\\.?\\s*DATA", "AUTO\\s*REF", "REFRACT", "自动验光"],
    structure_patterns: [
      "(?:<\\s*[RL]\\s*>|OD|OS)\\s*S\\s+C\\s+A|\\bSPH\\b.*\\bCYL\\b.*\\bAXIS\\b",
      "S\\s*\\.\\s*E\\s*\\.",
      "\\bPD\\s*[:=：]",
      "\\bVD\\s*[:=：]",
    ],
    required_output_fields: [
      "eye_side_results.right.key_values.sphere_d",
      "eye_side_results.right.key_values.cylinder_d",
      "eye_side_results.right.key_values.axis_deg",
      "eye_side_results.left.key_values.sphere_d",
      "eye_side_results.left.key_values.cylinder_d",
      "eye_side_results.left.key_values.axis_deg",
    ],
    units: ["D", "degree", "mm"],
    layout_guidance: [
      "按 R/L 或 OD/OS 分段后逐行识别 S/C/A 三列，允许负号与数值之间存在 OCR 空格。",
      "保留所有重复测量行；代表值由解析器策略决定，不由模型自由猜测。",
      "S.E.、PD、VD 是报告级明确字段；轴位必须限制在 0–180。",
      "无法可靠判断 OCR 缺位时保留原值并标记 warning，不生成配镜建议。",
    ],
    representative_examples: [
      "REF. DATA | VD 12.00 | <R> S C A | -2.25 -1.00 163 | S.E. -2.75 | <L> ... | PD 61.5",
      "OD SPH -2.50 CYL -0.75 AXIS 90 | OS SPH -3.00 CYL -0.50 AXIS 85",
    ],
  },
  {
    id: "zeiss_cirrus_oct_v1",
    version: "phase2.v1",
    parser_id: "zeiss_oct_parser",
    exam_type: "OCT",
    default_exam_item_name: "ZEISS Cirrus OCT",
    device_vendors: ["ZEISS", "CARL ZEISS"],
    title_patterns: ["CIRRUS", "MACULAR\\s+CUBE", "OPTIC\\s+DISC\\s+CUBE", "RNFL", "\\bOCT\\b"],
    structure_patterns: [
      "(?:OD|OS|RIGHT|LEFT)",
      "THICKNESS|厚度",
      "SIGNAL\\s+STRENGTH|信号强度",
      "(?:UM|ΜM|MICRON)",
    ],
    required_output_fields: [
      "exam_item_name",
      "eye_side_results.right.key_values",
      "eye_side_results.left.key_values",
    ],
    units: ["μm", "signal strength"],
    layout_guidance: [
      "先识别扫描协议标题，如 Macular Cube 512x128、Optic Disc Cube 或 RNFL。",
      "按 OD/OS 区分数值表，厚度字段保留报告原始命名映射。",
      "只提取数值和扫描元数据，不解释颜色图、概率图或病变。",
    ],
    representative_examples: [
      "ZEISS CIRRUS HD-OCT 5000 | Macular Cube 512x128 | OD Central Subfield Thickness 248 um | OS 251 um",
      "Optic Disc Cube 200x200 | RNFL Average OD 91 um OS 89 um | Signal Strength 8/10",
    ],
  },
  {
    id: "generic_fundus_photo_v1",
    version: "phase2.v1",
    parser_id: "generic_fundus_photo_parser",
    exam_type: "眼底照相",
    default_exam_item_name: "眼底照相",
    device_vendors: ["TOPCON", "CANON", "KOWA", "NIDEK", "ZEISS"],
    title_patterns: ["FUNDUS", "RETINAL?\\s+PHOTO", "眼底照相", "眼底摄影"],
    structure_patterns: ["(?:OD|OS|RIGHT|LEFT|右眼|左眼)", "PHOTO|IMAGE|照片|图像"],
    required_output_fields: ["exam_type", "device_vendor"],
    units: [],
    layout_guidance: [
      "记录拍摄眼别、设备、日期和报告标题。",
      "Phase 2 不分析图像病灶，不从颜色或形态生成医学结论。",
    ],
    representative_examples: [
      "CANON CR-2 | Color Fundus Photography | OD image captured | OS image captured",
    ],
  },
  {
    id: "generic_corneal_endothelium_v1",
    version: "phase2.v1",
    parser_id: "generic_corneal_endothelium_parser",
    exam_type: "角膜内皮细胞检查",
    default_exam_item_name: "角膜内皮细胞检测",
    device_vendors: ["TOPCON", "TOMEY", "NIDEK"],
    title_patterns: ["ENDOTHEL", "SPECULAR", "角膜内皮", "内皮细胞"],
    structure_patterns: ["\\bCD\\b", "\\bAVG\\b|AVERAGE", "\\bCCT\\b", "\\bCV\\b", "\\bHEX\\b"],
    required_output_fields: [
      "eye_side_results.right.key_values",
      "eye_side_results.left.key_values",
    ],
    units: ["cells/mm2", "μm", "%"],
    layout_guidance: [
      "按眼别提取 CD、AVG、CCT、CV、HEX 等明确字段。",
      "字段缺失时保持为空，不推断角膜健康状态。",
    ],
    representative_examples: [
      "Corneal Endothelial Cell Analysis | OD CD 2780 CCT 532 CV 31 HEX 56 | OS CD 2690 CCT 528 CV 33 HEX 54",
    ],
  },
  {
    id: "generic_ocular_ultrasound_v1",
    version: "phase2.v1",
    parser_id: "generic_ocular_ultrasound_parser",
    exam_type: "眼科超声",
    default_exam_item_name: "眼科 A/B 型超声",
    device_vendors: ["NIDEK", "TOMEY", "ZEISS", "TOPCON"],
    title_patterns: ["OCULAR\\s+ULTRASOUND", "A\\s*[/+]\\s*B\\s*SCAN", "B[- ]?SCAN", "眼科.*超声", "A型.*B型"],
    structure_patterns: ["AXIAL\\s+LENGTH|\\bAL\\b|眼轴", "\\bACD\\b|前房", "LENS\\s+THICKNESS|晶状体", "MM"],
    required_output_fields: [
      "eye_side_results.right.key_values",
      "eye_side_results.left.key_values",
    ],
    units: ["mm"],
    layout_guidance: [
      "按 OD/OS 提取眼轴、前房深度、晶状体厚度和玻璃体腔长度等明确测量值。",
      "不解释回声、形态或疾病风险。",
    ],
    representative_examples: [
      "Ocular Ultrasound A/B Scan | OD Axial Length 24.12 mm ACD 3.21 mm | OS Axial Length 23.98 mm",
    ],
  },
]);

function compilePattern(source: string): RegExp | null {
  try {
    return new RegExp(source, "i");
  } catch {
    return null;
  }
}

function matchesAny(text: string, patterns: string[]): boolean {
  return patterns.some((source) => compilePattern(source)?.test(text) === true);
}

export function scoreEyeExamFormatTemplate(rawText: unknown, template: EyeExamFormatTemplate): number {
  const text = normalizeExamText(rawText).toUpperCase();
  if (!text) return 0;
  const vendorHit = template.device_vendors.some((vendor) => text.includes(vendor.toUpperCase()));
  const titleHit = matchesAny(text, template.title_patterns);
  const structureHits = template.structure_patterns.filter((source) => compilePattern(source)?.test(text) === true).length;
  const structureRatio = template.structure_patterns.length > 0
    ? structureHits / template.structure_patterns.length
    : 0;
  const score = (vendorHit ? 0.2 : 0)
    + (titleHit ? 0.35 : 0)
    + Math.min(0.45, structureRatio * 0.45);
  return Math.round(Math.min(1, score) * 1000) / 1000;
}

export function matchEyeExamFormatTemplates(rawText: unknown, parserId?: string | null) {
  return EYE_EXAM_FORMAT_TEMPLATES
    .filter((template) => !parserId || template.parser_id === parserId)
    .map((template) => ({ template, score: scoreEyeExamFormatTemplate(rawText, template) }))
    .sort((a, b) => b.score - a.score || a.template.id.localeCompare(b.template.id));
}

export function selectEyeExamFormatTemplate(rawText: unknown, parserId?: string | null) {
  const [best] = matchEyeExamFormatTemplates(rawText, parserId);
  return best && best.score >= 0.45 ? best : null;
}

export function formatTemplateForLlm(template: EyeExamFormatTemplate | null | undefined) {
  if (!template) return null;
  return {
    template_id: template.id,
    template_version: template.version,
    parser_id: template.parser_id,
    exam_type: template.exam_type,
    default_exam_item_name: template.default_exam_item_name,
    required_output_fields: template.required_output_fields,
    units: template.units,
    layout_guidance: template.layout_guidance,
    representative_examples: template.representative_examples,
  };
}
