/**
 * Clinic OS — 诊所当日边界工具
 *
 * "今天"按诊所当地日期计算。当前以浏览器本地时区作为诊所当地时间
 * （未来在 ClinicConfig 增加 timezone 字段后，可切换为指定时区）。
 *
 * 仅用于前端"今日看板/今日待办"展示过滤，不修改任何原始数据。
 */

export function isToday(ts) {
  if (!ts) return false;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export function isBeforeToday(ts) {
  if (!ts) return false;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return false;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return d.getTime() < start.getTime();
}