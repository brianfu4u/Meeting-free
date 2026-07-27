/**
 * Clinic OS — 经营报告中心时间范围工具
 * 所有口径按北京时间（Asia/Shanghai）计算，支持日/周/月/季四种预设。
 */

const TZ = "Asia/Shanghai";

export const RANGE_PRESETS = [
  { id: "day", label: "今日", days: 1 },
  { id: "week", label: "本周", days: 7 },
  { id: "month", label: "本月", days: 30 },
  { id: "quarter", label: "本季", days: 90 },
];

const ymd = (d) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export function computeRange(preset) {
  const days = preset === "day" ? 1 : preset === "week" ? 7 : preset === "month" ? 30 : 90;
  const now = new Date();
  const end = ymd(now);
  const startD = new Date(now);
  startD.setDate(startD.getDate() - (days - 1));
  const start = ymd(startD);
  return { preset, days, start, end };
}

// 按 business_date（YYYY-MM-DD 字符串）过滤
export function inRangeDate(dateStr, range) {
  if (!dateStr) return false;
  return dateStr >= range.start && dateStr <= range.end;
}

// 按 ISO 时间戳过滤（转北京时间日期后比对）
export function inRangeISO(iso, range) {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const ds = ymd(d);
  return ds >= range.start && ds <= range.end;
}