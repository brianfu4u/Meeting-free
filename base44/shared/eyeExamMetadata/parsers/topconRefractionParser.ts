import { createEyeExamMetadata, EYE_EXAM_PARSE_STATUS } from "../model.ts";
import {
  detectVendorModel,
  extractMeasuredAt,
  firstLabeledNumber,
  normalizeExamText,
  parseRefractionValues,
} from "../common.ts";

type MeasurementRow = {
  sphere_d: number;
  cylinder_d: number;
  axis_raw_deg: number;
  axis_deg: number;
  source_line: string;
};

const NUMBER_TOKEN = "[+-]?\\s*\\d+(?:\\.\\d+)?";
const MEASUREMENT_ROW = new RegExp(`^\\s*(${NUMBER_TOKEN})\\s+(${NUMBER_TOKEN})\\s+(\\d{1,3})\\s*$`);

function parseNumberToken(value: string): number | null {
  const number = Number(String(value || "").replace(/\s+/g, ""));
  return Number.isFinite(number) ? number : null;
}

function splitTopconEyeSections(rawText: string) {
  const lines = rawText.split("\n").map((line) => line.trim()).filter(Boolean);
  const right: string[] = [];
  const left: string[] = [];
  let current: "right" | "left" | null = null;

  for (const line of lines) {
    const rightMarker = /^(?:<\s*(?:R|OD)\s*>|(?:OD|RIGHT|R)\b)/i.test(line);
    const leftMarker = /^(?:<\s*(?:L|OS)\s*>|(?:OS|LEFT|L)\b)/i.test(line);
    if (rightMarker && !leftMarker) current = "right";
    else if (leftMarker && !rightMarker) current = "left";
    else if (/^(?:PD|TOPCON|NAME|NO\.|SN\s*:)/i.test(line)) current = null;

    if (current === "right") right.push(line);
    if (current === "left") left.push(line);
  }

  return { right: right.join("\n"), left: left.join("\n") };
}

function parseMeasurementRows(sideText: string): MeasurementRow[] {
  const rows: MeasurementRow[] = [];
  for (const originalLine of sideText.split("\n")) {
    const line = originalLine.trim().replace(/^[*·•]+\s*/, "");
    const match = line.match(MEASUREMENT_ROW);
    if (!match) continue;
    const sphere = parseNumberToken(match[1]);
    const cylinder = parseNumberToken(match[2]);
    const axis = Number(match[3]);
    if (sphere == null || cylinder == null || !Number.isFinite(axis) || axis < 0 || axis > 180) continue;
    rows.push({
      sphere_d: sphere,
      cylinder_d: cylinder,
      axis_raw_deg: axis,
      axis_deg: axis,
      source_line: originalLine.trim(),
    });
  }
  return rows;
}

function representativeByModeThenLast(rows: MeasurementRow[], key: keyof MeasurementRow): number | null {
  const values = rows.map((row) => row[key]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  for (const value of values) {
    const normalized = Number(value).toFixed(4);
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }
  const maxCount = Math.max(...counts.values());
  const candidates = new Set([...counts.entries()].filter(([, count]) => count === maxCount).map(([value]) => value));
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (candidates.has(Number(values[index]).toFixed(4))) return Number(values[index]);
  }
  return Number(values[values.length - 1]);
}

function extractSphericalEquivalent(sideText: string): number | null {
  const match = sideText.match(/S\s*\.\s*E\s*\.\s*[:=：]?\s*([+-]?\s*\d+(?:\.\d+)?)/i);
  return match ? parseNumberToken(match[1]) : null;
}

function extractTopconMeasuredAt(text: string, hint?: unknown): string | null {
  const match = text.match(/\b(20\d{2})[_\/.\-](\d{1,2})[_\/.\-](\d{1,2})\s*(?:(AM|PM)\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?/i);
  if (!match) return extractMeasuredAt(text, hint);
  const [, year, month, day, meridiem, rawHour, minute, second] = match;
  let hour = Number(rawHour);
  if (meridiem?.toUpperCase() === "AM" && hour === 12) hour = 0;
  if (meridiem?.toUpperCase() === "PM" && hour < 12) hour += 12;
  const pad2 = (value: string | number) => String(value).padStart(2, "0");
  return `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:${pad2(second || 0)}`;
}

/**
 * Conservative TOPCON OCR repair for a dropped trailing zero in the axis column.
 *
 * It is only applied when at least three repeated S/C/A rows all contain the
 * same two-digit axis between 10 and 18. The corrected candidate (x10) must be
 * within 100-180 degrees. The original token remains in axis_original_ocr_deg
 * and every raw_measurements row for audit. Other low axes are left unchanged.
 */
function recoverRepeatedAxis(rows: MeasurementRow[], representativeAxis: number | null) {
  if (representativeAxis == null || rows.length < 3) {
    return { axis_deg: representativeAxis, corrected: false, raw_axis_deg: representativeAxis };
  }
  const axes = rows.map((row) => row.axis_raw_deg);
  const allIdentical = axes.every((value) => value === axes[0]);
  const corrected = representativeAxis * 10;
  const canRecover = allIdentical
    && Number.isInteger(representativeAxis)
    && representativeAxis >= 10
    && representativeAxis <= 18
    && corrected >= 100
    && corrected <= 180;
  return {
    axis_deg: canRecover ? corrected : representativeAxis,
    corrected: canRecover,
    raw_axis_deg: representativeAxis,
  };
}

function parseSide(sideText: string) {
  const rows = parseMeasurementRows(sideText);
  const inline = parseRefractionValues(sideText);
  const sphericalEquivalent = extractSphericalEquivalent(sideText)
    ?? (typeof inline.spherical_equivalent_d === "number" ? inline.spherical_equivalent_d : null);
  const representativeSphere = sphericalEquivalent
    ?? representativeByModeThenLast(rows, "sphere_d")
    ?? (typeof inline.sphere_d === "number" ? inline.sphere_d : null);
  const representativeCylinder = representativeByModeThenLast(rows, "cylinder_d")
    ?? (typeof inline.cylinder_d === "number" ? inline.cylinder_d : null);
  const rawAxis = representativeByModeThenLast(rows, "axis_raw_deg")
    ?? (typeof inline.axis_deg === "number" ? inline.axis_deg : null);
  const axis = recoverRepeatedAxis(rows, rawAxis);

  const keyValues: Record<string, unknown> = {};
  if (representativeSphere != null) keyValues.sphere_d = representativeSphere;
  if (representativeCylinder != null) keyValues.cylinder_d = representativeCylinder;
  if (axis.axis_deg != null) keyValues.axis_deg = axis.axis_deg;
  if (sphericalEquivalent != null) keyValues.spherical_equivalent_d = sphericalEquivalent;
  if (axis.corrected) {
    keyValues.axis_original_ocr_deg = axis.raw_axis_deg;
    keyValues.axis_correction_applied = true;
  }

  const rawMeasurements = rows.map((row) => ({
    ...row,
    axis_deg: axis.corrected ? Number(row.axis_raw_deg) * 10 : row.axis_raw_deg,
  }));

  return {
    raw_text: sideText,
    key_values: keyValues,
    raw_measurements: rawMeasurements,
    axis_corrected: axis.corrected,
  };
}

function hasCompleteSca(side: ReturnType<typeof parseSide>) {
  const values = side.key_values;
  return [values.sphere_d, values.cylinder_d, values.axis_deg]
    .every((value) => typeof value === "number" && Number.isFinite(value));
}

export const topconRefractionParser = {
  id: "topcon_refraction_parser",
  version: "phase1.1.v1",
  detect(rawText: unknown) {
    const text = normalizeExamText(rawText).toUpperCase();
    let score = 0;
    if (/\bTOPCON\b/.test(text)) score += 0.3;
    if (/REF\s*DATA|AUTO\s*REF|REFRACT|验光|屈光/.test(text)) score += 0.4;
    if (/\bSPH\b|\bCYL\b|\bAXIS\b|<\s*[RL]\s*>\s*S\s+C\s+A|\bS\s+C\s+A\b/.test(text)) score += 0.25;
    if (/\bKR[- ]?\d{3,4}\b|KERATO/.test(text)) score += 0.1;
    return Math.min(1, score);
  },
  parse(rawText: unknown, context: Record<string, unknown> = {}) {
    const text = normalizeExamText(rawText);
    const sides = splitTopconEyeSections(text);
    const device = detectVendorModel(text, "TOPCON", context.device_model);
    const right = parseSide(sides.right);
    const left = parseSide(sides.left);
    const pd = firstLabeledNumber(text, ["PD"], "(?:MM)?");
    const vd = firstLabeledNumber(text, ["VD"], "(?:MM)?");
    const measuredAt = extractTopconMeasuredAt(text, context.measured_at_hint);

    // Representative strategy:
    // 1. sphere_d uses the receipt's printed S.E. when available, exactly as
    //    requested by the workflow contract; raw S rows remain auditable.
    // 2. cylinder and axis use the statistical mode across rows; if tied, the
    //    last printed row wins, matching the device receipt's final-row habit.
    const reportKeyValues: Record<string, unknown> = {};
    if (pd != null) reportKeyValues.pd_mm = pd;
    if (vd != null) reportKeyValues.vd_mm = vd;

    const pdExpected = /\bPD\s*[:=：]/i.test(text);
    const vdExpected = /\bVD\s*[:=：]/i.test(text);
    const dateExpected = /\b20\d{2}[_\/.\-]\d{1,2}[_\/.\-]\d{1,2}/.test(text);
    const complete = hasCompleteSca(right)
      && hasCompleteSca(left)
      && (!pdExpected || pd != null)
      && (!vdExpected || vd != null)
      && (!dateExpected || measuredAt != null);

    const warnings: string[] = [];
    if (right.axis_corrected) warnings.push("right_axis_trailing_zero_ocr_recovered");
    if (left.axis_corrected) warnings.push("left_axis_trailing_zero_ocr_recovered");
    if (!complete) warnings.push("refraction_values_not_fully_detected");

    return createEyeExamMetadata({
      ...context,
      exam_type: "屈光验光",
      exam_item_name: /REF\s*DATA/i.test(text) ? "自动验光 / Ref Data" : "自动验光",
      ...device,
      measured_at: measuredAt,
      report_key_values: reportKeyValues,
      eye_side_results: {
        right: {
          raw_text: right.raw_text,
          key_values: right.key_values,
          raw_measurements: right.raw_measurements,
        },
        left: {
          raw_text: left.raw_text,
          key_values: left.key_values,
          raw_measurements: left.raw_measurements,
        },
      },
      parser_id: topconRefractionParser.id,
      parser_version: topconRefractionParser.version,
      parse_status: complete ? EYE_EXAM_PARSE_STATUS.parsed : EYE_EXAM_PARSE_STATUS.partial,
      parse_confidence: complete ? (warnings.length > 0 ? 0.92 : 0.96) : 0.68,
      warnings,
      raw_text_excerpt: text,
    });
  },
};
