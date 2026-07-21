/**
 * Phase 5 弹窗人工标签 → 结构化 meta 负载（modal-v2 契约）
 * 纯函数模块，供 MetaTaggingModal 与后端 fragmentIngestionService 共享。
 *
 * 产出物 user_interactive_meta 会被注入 Artifact.original_metadata，
 * 供 Agent 编组层（evidenceInterpreter / candidateFinder）读取，提升火车编组准确度。
 *
 * 契约要点：
 * - is_manual_tag=true 表示人工干预，Agent 应优先信任此 category_id
 * - category_id 对应 modalChips.js 中的 chip id
 * - captured_at 为弹窗提交时刻（ISO），与 captured_at（采集时刻）语义分离
 */

export const META_PAYLOAD_VERSION = "modal-v2.v1";

/**
 * 组装 user_interactive_meta。
 * @param {object} input
 * @param {string} input.role_id        员工岗位 ID
 * @param {string} input.dept_id        员工部门 ID
 * @param {string} input.category_id    选中的 chip ID
 * @param {string} input.category_label 选中的 chip 中文标签
 * @param {string} [input.note]         补充说明文本
 * @param {number} [input.capture_latency_ms] 弹窗打开到提交耗时
 * @param {boolean} [input.was_prefill] 是否使用了预填默认值
 * @returns {object} user_interactive_meta
 */
export function buildUserInteractiveMeta(input) {
  const i = input || {};
  return {
    schema_version: META_PAYLOAD_VERSION,
    role_id: str(i.role_id),
    dept_id: str(i.dept_id),
    category_id: str(i.category_id),
    category_label: str(i.category_label),
    is_manual_tag: true,
    note: i.note ? String(i.note).slice(0, 2000) : null,
    captured_at: new Date().toISOString(),
    capture_latency_ms: num(i.capture_latency_ms),
    was_prefill: i.was_prefill === true,
    source: "staff_pad_modal",
  };
}

/**
 * 校验 user_interactive_meta 是否完整可送入 Agent。
 * @param {object} meta
 * @returns {{ok:boolean, reason?:string}}
 */
export function validateUserInteractiveMeta(meta) {
  if (!meta || typeof meta !== "object") return { ok: false, reason: "meta_required" };
  if (!meta.category_id) return { ok: false, reason: "category_id_required" };
  if (!meta.dept_id) return { ok: false, reason: "dept_id_required" };
  if (!meta.role_id) return { ok: false, reason: "role_id_required" };
  return { ok: true };
}

function str(v) {
  return typeof v === "string" && v ? v.slice(0, 128) : null;
}
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}