/**
 * Clinic OS V10 — GuessPolicy 结构化规则工具（修订版 R2.3）
 *
 * R2.3：
 * - 发布时校验 hard_guardrails：仅允许已知 rule_code；
 * - 旧数据迁移：字符串/未知结构 → { rule_code: "legacy_text", original }；
 * - 未知 rule_code 不得静默忽略（发布拒绝 / 运行阻断）；
 * - 项5：publishGuessPolicy/updateGuessPolicy 真实发布/更新入口，迁移后校验；legacy_text 不得作为可正常发布规则；
 * - 项6：validatePolicyTracks 校验固定七轨道不可被 tracks 替换，仅可追加规则。
 */

import { TRACK_IDS } from "./prompts";

export const KNOWN_RULE_CODES = [
  "subject_conflict",
  "time_impossible",
  "attach_to_closed_workflow",
  "legacy_text",
];

/** 可正常发布的 rule_code（legacy_text 仅作运行期阻断标记，不可发布） */
export const PUBLISHABLE_RULE_CODES = [
  "subject_conflict",
  "time_impossible",
  "attach_to_closed_workflow",
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

/**
 * 项6：校验 GuessPolicy.tracks 不得替换固定七轨道。
 * Policy 只能给固定轨道追加规则（guardrails），不得新增/删除/替换 track_id。
 */
export function validatePolicyTracks(policy) {
  const errors = [];
  const tracks = policy?.tracks;
  if (tracks == null) return { valid: true, errors: [] };
  if (!Array.isArray(tracks)) return { valid: false, errors: ["tracks must be array"] };
  const known = new Set(TRACK_IDS);
  const seen = new Set();
  tracks.forEach((t, i) => {
    if (!t || typeof t !== "object" || Array.isArray(t)) {
      errors.push(`tracks[${i}] must be object`);
      return;
    }
    if (!t.track_id || typeof t.track_id !== "string") {
      errors.push(`tracks[${i}].track_id missing`);
      return;
    }
    if (!known.has(t.track_id)) {
      errors.push(`tracks[${i}].track_id unknown: ${t.track_id}（固定七轨道不可替换/新增）`);
    }
    if (seen.has(t.track_id)) {
      errors.push(`tracks[${i}].track_id duplicate: ${t.track_id}`);
    }
    seen.add(t.track_id);
  });
  return { valid: errors.length === 0, errors };
}

/**
 * 项5：发布校验（比运行期更严）。
 * - hard_guardrails 仅允许 PUBLISHABLE_RULE_CODES（legacy_text 不得作为可正常发布的规则）；
 * - tracks 必须通过 validatePolicyTracks。
 */
export function validatePolicyForPublish(policy) {
  const errors = [];
  if (!policy || typeof policy !== "object") {
    return { valid: false, errors: ["policy must be object"] };
  }
  const guardrails = policy.hard_guardrails;
  if (guardrails != null) {
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
      if (!PUBLISHABLE_RULE_CODES.includes(g.rule_code)) {
        errors.push(`hard_guardrails[${i}].rule_code not publishable: ${g.rule_code}`);
      }
    });
  }
  const trackCheck = validatePolicyTracks(policy);
  return { valid: errors.length === 0 && trackCheck.valid, errors: [...errors, ...trackCheck.errors] };
}

/**
 * 项5：真实 publish/update 入口。先迁移旧 Policy 数据，再发布校验。
 * legacy_text 迁移结果会被发布校验拒绝（推动重新编写为结构化规则）。
 * 返回 { valid, errors, policy }；valid=false 时 policy=null。
 */
export function preparePolicyForPublish(policy) {
  const migrated = {
    ...(policy || {}),
    hard_guardrails: migrateHardGuardrails(policy?.hard_guardrails || []),
  };
  const { valid, errors } = validatePolicyForPublish(migrated);
  return { valid, errors, policy: valid ? migrated : null };
}

export function publishGuessPolicy(policy) {
  return preparePolicyForPublish(policy);
}

export function updateGuessPolicy(policy) {
  return preparePolicyForPublish(policy);
}