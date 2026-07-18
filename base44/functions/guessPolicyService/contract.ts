/**
 * Clinic OS V10 — GuessPolicy 共享契约（唯一权威源，pure TS，无运行时依赖）
 *
 * 本文件是 GuessPolicy 校验/迁移逻辑的单一事实来源：
 * - 后端 entry.ts 通过 `import ... from "./contract.ts"` 复用；
 * - 前端 vitest 通过相对路径导入做契约一致性（parity）测试；
 * - 任何规则码/轨道定义变更必须在此修改，并通过 contract.parity.test.js
 *   断言与 src/lib/composition/prompts.js 的 TRACK_IDS 一致。
 *
 * 禁止在其它任何位置复制 KNOWN/PUBLISHABLE_RULE_CODES、TRACK_IDS、
 * migrateHardGuardrails、validatePolicyForPublish 等定义。
 */

export const CONTRACT_VERSION = "policy-contract-v1";

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
 * 七条推断轨道。此处的 TRACK_IDS 是 GuessPolicy 校验的权威定义。
 * src/lib/composition/prompts.js 中的 TRACK_IDS 是编组引擎 Schema 的权威定义。
 * 二者必须一致，由 contract.parity.test.js 强制断言。
 */
export const TRACK_IDS = [
  "subject_fingerprint",
  "causal_chain",
  "temporal_continuity",
  "department_handoff",
  "actor_device_location",
  "document_lineage",
  "open_loop_closure",
];

export function migrateHardGuardrails(guardrails: any[]): any[] {
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

export function validatePolicyTracks(policy: any) {
  const errors: string[] = [];
  const tracks = policy?.tracks;
  if (tracks == null) return { valid: true, errors };
  if (!Array.isArray(tracks)) return { valid: false, errors: ["tracks must be array"] };
  const known = new Set(TRACK_IDS);
  const seen = new Set<string>();
  tracks.forEach((t: any, i: number) => {
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

export function validateGuessPolicy(policy: any) {
  const errors: string[] = [];
  if (!policy || typeof policy !== "object") {
    return { valid: false, errors: ["policy must be object"] };
  }
  const guardrails = policy.hard_guardrails;
  if (guardrails == null) return { valid: true, errors };
  if (!Array.isArray(guardrails)) {
    return { valid: false, errors: ["hard_guardrails must be array"] };
  }
  guardrails.forEach((g: any, i: number) => {
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

export function validatePolicyForPublish(policy: any) {
  const errors: string[] = [];
  if (!policy || typeof policy !== "object") {
    return { valid: false, errors: ["policy must be object"] };
  }
  const guardrails = policy.hard_guardrails;
  if (guardrails != null) {
    if (!Array.isArray(guardrails)) {
      return { valid: false, errors: ["hard_guardrails must be array"] };
    }
    guardrails.forEach((g: any, i: number) => {
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
  const tc = validatePolicyTracks(policy);
  return { valid: errors.length === 0 && tc.valid, errors: [...errors, ...tc.errors] };
}

export function buildContract() {
  return {
    contract_version: CONTRACT_VERSION,
    known_rule_codes: KNOWN_RULE_CODES,
    publishable_rule_codes: PUBLISHABLE_RULE_CODES,
    track_ids: TRACK_IDS,
  };
}