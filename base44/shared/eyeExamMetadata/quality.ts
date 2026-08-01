export const EYE_EXAM_QUALITY_STATUS = Object.freeze({
  success: "success",
  needsClarification: "needs_clarification",
  fallback: "fallback",
});

const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_LIMIT = 10;

function cleanString(value: unknown, fallback = "unknown", max = 180): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return (text || fallback).slice(0, max);
}

function finiteNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const number = Math.trunc(finiteNumber(value, fallback));
  return Math.max(min, Math.min(max, number));
}

export function mapParseStatusToQualityStatus(parseStatus: unknown): string {
  const normalized = cleanString(parseStatus, "").toLowerCase();
  if (["parsed", "parsed_success", "success"].includes(normalized)) {
    return EYE_EXAM_QUALITY_STATUS.success;
  }
  if (normalized === "fallback") return EYE_EXAM_QUALITY_STATUS.fallback;
  return EYE_EXAM_QUALITY_STATUS.needsClarification;
}

/**
 * Build the privacy-minimized event persisted by eyeExamMetadataService.
 * OCR text, patient identifiers, names and diagnostic content are deliberately
 * excluded. raw_artifact_id is retained only as the idempotency anchor.
 */
export function buildParsingQualityEvent(
  metadata: Record<string, any>,
  context: Record<string, unknown> = {},
) {
  const parseStatus = cleanString(metadata?.parse_status, "partial", 64);
  const warnings = Array.isArray(metadata?.warnings)
    ? [...new Set(metadata.warnings.map((item: unknown) => cleanString(item, "", 160)).filter(Boolean))].slice(0, 20)
    : [];

  return {
    clinic_id: cleanString(context.clinic_id || metadata?.clinic_id, "", 128),
    raw_artifact_id: cleanString(context.raw_artifact_id || metadata?.raw_artifact_id, "", 128),
    recorded_at: cleanString(context.recorded_at, new Date().toISOString(), 64),
    exam_type: cleanString(metadata?.exam_type, "未识别眼科检查报告", 120),
    exam_item_name: cleanString(metadata?.exam_item_name, "未识别项目", 180),
    device_vendor: cleanString(metadata?.device_vendor, "UNKNOWN", 120),
    device_model: cleanString(metadata?.device_model, "UNKNOWN", 160),
    parser_id: cleanString(metadata?.parser_id, "fallback_eye_exam_parser", 120),
    parser_version: cleanString(metadata?.parser_version, "unknown", 64),
    template_id: cleanString(metadata?.template_id, "unmatched", 120),
    template_version: cleanString(metadata?.template_version, "unknown", 64),
    metadata_parse_status: parseStatus,
    quality_status: mapParseStatusToQualityStatus(parseStatus),
    parse_confidence: Math.max(0, Math.min(1, finiteNumber(metadata?.parse_confidence, 0))),
    warning_codes: warnings,
    llm_completion_used: warnings.includes("llm_completion_applied"),
  };
}

type QualityGroup = {
  examTypes: Map<string, number>;
  deviceModels: Set<string>;
  parserIds: Set<string>;
  templateIds: Set<string>;
  device_vendor: string;
  exam_item_name: string;
  total_count: number;
  success_count: number;
  needs_clarification_count: number;
  fallback_count: number;
  llm_completion_count: number;
  confidence_total: number;
};

function modeOf(counts: Map<string, number>, fallback: string): string {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || fallback;
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function recommendationFor(group: any): string {
  if (group.coverage_state === "stable") return "已稳定覆盖；继续监控，无需逐张提供样本。";
  if (group.fallback_count > 0) return "优先提供该设备/项目 1–2 份代表样本，新增或增强格式模板。";
  return "检查缺失字段和版式变化，增强现有模板规则或格式级 LLM 提示。";
}

export function aggregateParsingQuality(
  events: Array<Record<string, any>>,
  options: Record<string, unknown> = {},
) {
  const days = clampInteger(options.days, 1, 90, DEFAULT_WINDOW_DAYS);
  const limit = clampInteger(options.limit, 1, 50, DEFAULT_LIMIT);
  const now = options.now ? new Date(String(options.now)) : new Date();
  const safeNow = Number.isNaN(now.getTime()) ? new Date() : now;
  const since = new Date(safeNow.getTime() - days * 24 * 60 * 60 * 1000);
  const groups = new Map<string, QualityGroup>();
  const totals = { success: 0, needs_clarification: 0, fallback: 0 };

  for (const event of Array.isArray(events) ? events : []) {
    const recordedAt = new Date(String(event?.recorded_at || ""));
    if (Number.isNaN(recordedAt.getTime()) || recordedAt < since || recordedAt > safeNow) continue;

    const vendor = cleanString(event.device_vendor, "UNKNOWN", 120).toUpperCase();
    const item = cleanString(event.exam_item_name, "未识别项目", 180);
    const key = `${vendor}::${item.toLocaleLowerCase()}`;
    const status = mapParseStatusToQualityStatus(event.quality_status || event.metadata_parse_status);
    const group = groups.get(key) || {
      examTypes: new Map<string, number>(),
      deviceModels: new Set<string>(),
      parserIds: new Set<string>(),
      templateIds: new Set<string>(),
      device_vendor: vendor,
      exam_item_name: item,
      total_count: 0,
      success_count: 0,
      needs_clarification_count: 0,
      fallback_count: 0,
      llm_completion_count: 0,
      confidence_total: 0,
    };

    const examType = cleanString(event.exam_type, "未识别眼科检查报告", 120);
    group.examTypes.set(examType, (group.examTypes.get(examType) || 0) + 1);
    group.deviceModels.add(cleanString(event.device_model, "UNKNOWN", 160));
    group.parserIds.add(cleanString(event.parser_id, "unknown", 120));
    group.templateIds.add(cleanString(event.template_id, "unmatched", 120));
    group.total_count += 1;
    group.confidence_total += Math.max(0, Math.min(1, finiteNumber(event.parse_confidence, 0)));

    if (status === EYE_EXAM_QUALITY_STATUS.success) {
      group.success_count += 1;
      totals.success += 1;
    } else if (status === EYE_EXAM_QUALITY_STATUS.fallback) {
      group.fallback_count += 1;
      totals.fallback += 1;
    } else {
      group.needs_clarification_count += 1;
      totals.needs_clarification += 1;
    }
    if (event.llm_completion_used === true) group.llm_completion_count += 1;
    groups.set(key, group);
  }

  const rows = [...groups.values()].map((group) => {
    const successRate = group.total_count > 0 ? group.success_count / group.total_count : 0;
    const clarificationRate = group.total_count > 0
      ? group.needs_clarification_count / group.total_count
      : 0;
    const fallbackRate = group.total_count > 0 ? group.fallback_count / group.total_count : 0;
    const stable = group.total_count >= 3 && successRate >= 0.9 && group.fallback_count === 0;
    const coverageState = stable
      ? "stable"
      : (group.fallback_count > 0 || clarificationRate >= 0.25 ? "optimize" : "watch");
    const priorityScore = round(
      group.fallback_count * 4
        + group.needs_clarification_count * 2
        + (1 - successRate) * group.total_count,
    );
    const row = {
      exam_type: modeOf(group.examTypes, "未识别眼科检查报告"),
      exam_item_name: group.exam_item_name,
      device_vendor: group.device_vendor,
      device_models: [...group.deviceModels].sort(),
      parser_ids: [...group.parserIds].sort(),
      template_ids: [...group.templateIds].sort(),
      total_count: group.total_count,
      success_count: group.success_count,
      needs_clarification_count: group.needs_clarification_count,
      fallback_count: group.fallback_count,
      llm_completion_count: group.llm_completion_count,
      success_rate: round(successRate),
      needs_clarification_rate: round(clarificationRate),
      fallback_rate: round(fallbackRate),
      average_parse_confidence: round(group.confidence_total / group.total_count),
      coverage_state: coverageState,
      optimization_priority_score: priorityScore,
      recommendation: "",
    };
    row.recommendation = recommendationFor(row);
    return row;
  });

  const optimizationCandidates = rows
    .filter((row) => row.coverage_state !== "stable")
    .sort((a, b) => b.optimization_priority_score - a.optimization_priority_score
      || b.total_count - a.total_count
      || a.device_vendor.localeCompare(b.device_vendor)
      || a.exam_item_name.localeCompare(b.exam_item_name))
    .slice(0, limit);
  const stableCoverage = rows
    .filter((row) => row.coverage_state === "stable")
    .sort((a, b) => b.total_count - a.total_count
      || a.device_vendor.localeCompare(b.device_vendor)
      || a.exam_item_name.localeCompare(b.exam_item_name));
  const totalEvents = totals.success + totals.needs_clarification + totals.fallback;

  return {
    generated_at: safeNow.toISOString(),
    window_days: days,
    window_start: since.toISOString(),
    window_end: safeNow.toISOString(),
    total_events: totalEvents,
    totals,
    overall_success_rate: totalEvents > 0 ? round(totals.success / totalEvents) : 0,
    stable_coverage: stableCoverage,
    optimization_candidates: optimizationCandidates,
  };
}
