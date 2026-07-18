import { describe, it, expect } from "vitest";
import {
  CONTRACT_VERSION,
  KNOWN_RULE_CODES,
  PUBLISHABLE_RULE_CODES,
  TRACK_IDS,
  RULE_DESCRIPTORS,
  TRACK_DESCRIPTORS,
  UPDATABLE_STATUSES,
  canUpdatePolicy,
  isAuthorizedForClinicPure,
  migrateHardGuardrails,
  validatePolicyTracks,
  validateGuessPolicy,
  validatePolicyForPublish,
  buildContract,
} from "../../../../base44/functions/guessPolicyService/contract";
import { TRACK_IDS as PROMPT_TRACK_IDS, REASONING_TRACKS } from "../prompts";

/**
 * 契约一致性测试：后端 contract.ts 是 GuessPolicy 校验/迁移的唯一权威源。
 * - TRACK_IDS 必须与编组引擎 prompts.js 的七轨道完全一致（跨运行时 parity）；
 * - 迁移/发布校验逻辑在此测试，前端不再复制。
 */
describe("contract — 契约元数据", () => {
  it("buildContract 返回 contract_version 与规则/轨道清单", () => {
    const c = buildContract();
    expect(c.contract_version).toBe(CONTRACT_VERSION);
    expect(c.known_rule_codes).toEqual(KNOWN_RULE_CODES);
    expect(c.publishable_rule_codes).toEqual(PUBLISHABLE_RULE_CODES);
    expect(c.track_ids).toEqual(TRACK_IDS);
  });
  it("KNOWN 含 legacy_text；PUBLISHABLE 不含 legacy_text", () => {
    expect(KNOWN_RULE_CODES).toContain("legacy_text");
    expect(PUBLISHABLE_RULE_CODES).not.toContain("legacy_text");
    expect(PUBLISHABLE_RULE_CODES).toContain("subject_conflict");
  });
});

describe("contract — parity：后端 TRACK_IDS 与编组引擎 prompts.js 一致", () => {
  it("TRACK_IDS 与 prompts.js TRACK_IDS 逐项一致", () => {
    expect(TRACK_IDS).toEqual(PROMPT_TRACK_IDS);
  });
  it("TRACK_IDS 与 prompts.js REASONING_TRACKS 派生一致", () => {
    expect(TRACK_IDS).toEqual(REASONING_TRACKS.map((t) => t.track_id));
  });
  it("七条轨道固定", () => {
    expect(TRACK_IDS).toHaveLength(7);
    expect(new Set(TRACK_IDS).size).toBe(7);
  });
});

describe("contract — migrateHardGuardrails 迁移", () => {
  it("字符串 → legacy_text", () => {
    expect(migrateHardGuardrails(["旧规则"])[0]).toEqual({ rule_code: "legacy_text", original: "旧规则" });
  });
  it("已知 rule_code 保留", () => {
    expect(migrateHardGuardrails([{ rule_code: "subject_conflict" }])[0]).toEqual({ rule_code: "subject_conflict" });
  });
  it("未知 rule_code → legacy_text", () => {
    const m = migrateHardGuardrails([{ rule_code: "ghost" }]);
    expect(m[0].rule_code).toBe("legacy_text");
    expect(m[0].original).toContain("ghost");
  });
  it("幂等：两次迁移相等", () => {
    const once = migrateHardGuardrails(["旧A", "旧B"]);
    expect(migrateHardGuardrails(once)).toEqual(once);
  });
  it("非数组返回空数组", () => {
    expect(migrateHardGuardrails(null)).toEqual([]);
  });
});

describe("contract — validatePolicyTracks 固定七轨道", () => {
  it("已知轨道通过", () => {
    expect(validatePolicyTracks({ tracks: [{ track_id: "causal_chain" }] }).valid).toBe(true);
  });
  it("未知轨道拒绝", () => {
    const r = validatePolicyTracks({ tracks: [{ track_id: "ghost" }] });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/unknown/);
  });
  it("重复轨道拒绝", () => {
    expect(validatePolicyTracks({ tracks: [{ track_id: "causal_chain" }, { track_id: "causal_chain" }] }).valid).toBe(false);
  });
  it("缺省通过", () => {
    expect(validatePolicyTracks({}).valid).toBe(true);
  });
});

describe("contract — validatePolicyForPublish 发布校验", () => {
  it("可发布规则通过", () => {
    expect(validatePolicyForPublish({ hard_guardrails: [{ rule_code: "subject_conflict" }] }).valid).toBe(true);
  });
  it("legacy_text 不可发布", () => {
    const r = validatePolicyForPublish({ hard_guardrails: [{ rule_code: "legacy_text", original: "x" }] });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/not publishable/);
  });
  it("未知 rule_code 不可发布", () => {
    expect(validatePolicyForPublish({ hard_guardrails: [{ rule_code: "ghost" }] }).valid).toBe(false);
  });
  it("同时校验 tracks", () => {
    const r = validatePolicyForPublish({ hard_guardrails: [{ rule_code: "subject_conflict" }], tracks: [{ track_id: "ghost" }] });
    expect(r.valid).toBe(false);
  });
});

describe("contract — validateGuessPolicy 运行期校验", () => {
  it("已知规则通过", () => {
    expect(validateGuessPolicy({ hard_guardrails: [{ rule_code: "legacy_text", original: "x" }] }).valid).toBe(true);
  });
  it("未知规则拒绝", () => {
    expect(validateGuessPolicy({ hard_guardrails: [{ rule_code: "ghost" }] }).valid).toBe(false);
  });
  it("缺省视为通过", () => {
    expect(validateGuessPolicy({}).valid).toBe(true);
  });
});

describe("contract — 描述符与授权纯函数 parity", () => {
  it("buildContract 含 rule_descriptors / track_descriptors / updatable_statuses", () => {
    const c = buildContract();
    expect(c.rule_descriptors).toEqual(RULE_DESCRIPTORS);
    expect(c.track_descriptors).toEqual(TRACK_DESCRIPTORS);
    expect(c.updatable_statuses).toEqual(UPDATABLE_STATUSES);
  });
  it("RULE_DESCRIPTORS codes 与 PUBLISHABLE_RULE_CODES 一致", () => {
    expect(RULE_DESCRIPTORS.map((d) => d.rule_code)).toEqual(PUBLISHABLE_RULE_CODES);
  });
  it("TRACK_DESCRIPTORS track_ids 与 TRACK_IDS 一致", () => {
    expect(TRACK_DESCRIPTORS.map((d) => d.track_id)).toEqual(TRACK_IDS);
  });
  it("canUpdatePolicy: draft/reviewed 允许，published/retired 拒绝", () => {
    expect(canUpdatePolicy("draft")).toBe(true);
    expect(canUpdatePolicy("reviewed")).toBe(true);
    expect(canUpdatePolicy("published")).toBe(false);
    expect(canUpdatePolicy("retired")).toBe(false);
  });
  it("isAuthorizedForClinicPure: 创建人/manager 绑定员工授权，否则拒绝", () => {
    expect(isAuthorizedForClinicPure({ id: "u1" }, [{ created_by_id: "u1" }], new Map())).toBe(true);
    expect(isAuthorizedForClinicPure({ id: "u1" }, [{ manager_id: "s1" }], new Map([["s1", { user_id: "u1" }]]))).toBe(true);
    expect(isAuthorizedForClinicPure({ id: "u2" }, [{ manager_id: "s1" }], new Map([["s1", { user_id: "u1" }]]))).toBe(false);
    expect(isAuthorizedForClinicPure({ id: "u1" }, [], new Map())).toBe(false);
  });
});