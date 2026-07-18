/**
 * Clinic OS V10 — GuessPolicy 结构化规则工具（修订版 R2.2）
 *
 * R2.2：
 * - 发布时校验 hard_guardrails：仅允许已知 rule_code；
 * - 旧数据迁移：字符串/未知结构 → { rule_code: "legacy_text", original }；
 * - 未知 rule_code 不得静默忽略（发布拒绝 / 运行阻断）。
 */

export const KNOWN_RULE_CODES = [
  "subject_conflict",
  "time_impossible",
  "attach_to_closed_workflow",
  "legacy_text",
];

/**
 * 发布时校验 GuessPolicy.hard_guardrails 结构。
 * 返回 { valid, errors }。
 */
export function validateGuessPolicy(policy) {
  const errors = [];
  if (!policy || typeof policy !== "object") {
    return { valid: false, errors: ["policy must be object"] };
  }
  const guardrails = policy.hard_guardrails;
  if (guardrails == null) {
    return { valid: true, errors: [] };
  }
  if (!Array.isArray(guardrails)) {
    return { valid: false, errors: ["hard_guardrails must be array"] };
  }
  guardrails.forEach((g, i) => {
    if (!g || typeof g !== "object" || Array.isArray(g)) {
      errors.push(`hard_guardrails[${i}] must be object`);
      return;
    }
    if (!g.rule_code || typeof g.rule_code !== "string") {
      errors.push(`hard_guardrails[${i}].rule_code missing`);
      return;
    }
    if (!KNOWN_RULE_CODES.includes(g.rule_code)) {
      errors.push(`hard_guardrails[${i}].rule_code unknown: ${g.rule_code}`);
    }
  });
  return { valid: errors.length === 0, errors };
}

/**
 * 旧数据迁移：把历史 hard_guardrails 规范化为结构化对象。
 * - 字符串 → { rule_code: "legacy_text", original: str }
 * - 已知 rule_code 对象 → 保留
 * - 未知 rule_code 对象 → { rule_code: "legacy_text", original: JSON.stringify(g) }
 */
export function migrateHardGuardrails(guardrails) {
  if (!Array.isArray(guardrails)) return [];
  return guardrails.map((g) => {
    if (typeof g === "string") {
      return { rule_code: "legacy_text", original: g };
    }
    if (g && typeof g === "object" && !Array.isArray(g)) {
      if (g.rule_code && KNOWN_RULE_CODES.includes(g.rule_code)) return g;
      return { rule_code: "legacy_text", original: JSON.stringify(g) };
    }
    return { rule_code: "legacy_text", original: String(g) };
  });
}