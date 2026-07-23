/**
 * Clinic OS — 北京时间统一展示工具
 * 所有前端时间呈现统一按 Asia/Shanghai（北京时间）。
 * 仅用于展示层，不改变后端 business_date 的存储口径。
 */

const TZ = "Asia/Shanghai";

export function formatBeijingTime(d = new Date()) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(d);
}

export function formatBeijingTimeShort(d = new Date()) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
}

export function formatBeijingDate(d = new Date()) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: TZ, year: "numeric", month: "long", day: "numeric", weekday: "short",
  }).format(d);
}

export function todayBeijingDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

export function beijingYMD(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function beijingHour(d = new Date()) {
  const h = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, hour: "2-digit", hour12: false,
  }).format(d);
  const n = Number(h);
  return n === 24 ? 0 : n;
}

/**
 * 按北京时间推断当前班次（仅展示）。
 */
export function beijingShift(d = new Date()) {
  const hour = beijingHour(d);
  if (hour >= 8 && hour < 13) return { label: "上午班", range: "08:00 – 13:00", color: "#16A34A" };
  if (hour >= 13 && hour < 18) return { label: "下午班", range: "13:00 – 18:00", color: "#00C7D9" };
  if (hour >= 18 && hour < 22) return { label: "晚班", range: "18:00 – 22:00", color: "#A78BFA" };
  return { label: "非营业", range: "休诊时段", color: "#64748B" };
}