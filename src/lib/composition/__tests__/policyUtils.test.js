import { describe, it, expect } from "vitest";
import {
  validateGuessPolicy,
  migrateHardGuardrails,
  KNOWN_RULE_CODES,
  PUBLISHABLE_RULE_CODES,
  validatePolicyTracks,
  validatePolicyForPublish,
  publishGuessPolicy,
  updateGuessPolicy,
} from "../policyUtils";
import { TRACK_IDS } from "../prompts";

describe("policyUtils — KNOWN_RULE_CODES", () => {
  it("含 subject_conflict / time_impossible / attach_to_closed_workflow / legacy_text", () => {
    expect(KNOWN_RULE_CODES).toContain("subject_conflict");
    expect(KNOWN_RULE_CODES).toContain("time_impossible");
    expect(KNOWN_RULE_CODES).toContain("attach_to_closed_workflow");
    expect(KNOWN_RULE_CODES).toContain("legacy_text");
  });
});

describe("policyUtils — validateGuessPolicy 发布校验", () => {
  it("已知 rule_code 通过", () => {
    const { valid, errors } = validateGuessPolicy({ hard_guardrails: [{ rule_code: "subject_conflict" }, { rule_code: "time_impossible", max_gap_minutes: 1440 }] });
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
  });
  it("未知 rule_code 拒绝", () => {
    const { valid, errors } = validateGuessPolicy({ hard_guardrails: [{ rule_code: "no_such_rule" }] });
    expect(valid).toBe(false);
    expect(errors[0]).toMatch(/unknown/);
  });
  it("缺 rule_code 拒绝", () => {
    const { valid } = validateGuessPolicy({ hard_guardrails: [{ max_gap_minutes: 10 }] });
    expect(valid).toBe(false);
  });
  it("非对象元素拒绝", () => {
    const { valid } = validateGuessPolicy({ hard_guardrails: ["字符串旧规则"] });
    expect(valid).toBe(false);
  });
  it("hard_guardrails 缺省视为通过（无规则）", () => {
    expect(validateGuessPolicy({}).valid).toBe(true);
  });
  it("hard_guardrails 非数组拒绝", () => {
    expect(validateGuessPolicy({ hard_guardrails: "x" }).valid).toBe(false);
  });
});

describe("policyUtils — migrateHardGuardrails 旧数据迁移", () => {
  it("字符串 → legacy_text", () => {
    const migrated = migrateHardGuardrails(["旧自然语言规则"]);
    expect(migrated[0]).toEqual({ rule_code: "legacy_text", original: "旧自然语言规则" });
  });
  it("已知 rule_code 对象保留", () => {
    const migrated = migrateHardGuardrails([{ rule_code: "subject_conflict" }]);
    expect(migrated[0]).toEqual({ rule_code: "subject_conflict" });
  });
  it("未知 rule_code 对象 → legacy_text", () => {
    const migrated = migrateHardGuardrails([{ rule_code: "ghost_rule", x: 1 }]);
    expect(migrated[0].rule_code).toBe("legacy_text");
    expect(migrated[0].original).toContain("ghost_rule");
  });
  it("非数组返回空数组", () => {
    expect(migrateHardGuardrails(null)).toEqual([]);
  });
  it("迁移后可通过 validateGuessPolicy", () => {
    const migrated = migrateHardGuardrails(["旧规则", { rule_code: "subject_conflict" }]);
    expect(validateGuessPolicy({ hard_guardrails: migrated }).valid).toBe(true);
  });
});

describe("policyUtils — 项6：validatePolicyTracks 固定七轨道不可替换", () => {
  it("仅追加已知轨道 guardrails 通过", () => {
    const { valid, errors } = validatePolicyTracks({
      tracks: [{ track_id: "subject_fingerprint", guardrails: ["姓名需高可信"] }],
    });
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
  });
  it("新增未知 track_id 拒绝", () => {
    const { valid, errors } = validatePolicyTracks({
      tracks: [{ track_id: "eighth_mystery_track", guardrails: [] }],
    });
    expect(valid).toBe(false);
    expect(errors[0]).toMatch(/unknown/);
  });
  it("重复 track_id 拒绝", () => {
    const { valid, errors } = validatePolicyTracks({
      tracks: [{ track_id: "causal_chain" }, { track_id: "causal_chain" }],
    });
    expect(valid).toBe(false);
    expect(errors[0]).toMatch(/duplicate/);
  });
  it("tracks 非数组拒绝", () => {
    expect(validatePolicyTracks({ tracks: "x" }).valid).toBe(false);
  });
  it("tracks 缺省通过", () => {
    expect(validatePolicyTracks({}).valid).toBe(true);
  });
});

describe("policyUtils — 项5：发布校验拒绝 legacy_text", () => {
  it("PUBLISHABLE_RULE_CODES 不含 legacy_text", () => {
    expect(PUBLISHABLE_RULE_CODES).not.toContain("legacy_text");
    expect(PUBLISHABLE_RULE_CODES).toContain("subject_conflict");
  });
  it("validatePolicyForPublish 接受可发布规则", () => {
    const { valid, errors } = validatePolicyForPublish({
      hard_guardrails: [{ rule_code: "subject_conflict" }, { rule_code: "time_impossible", max_gap_minutes: 1440 }],
    });
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
  });
  it("validatePolicyForPublish 拒绝 legacy_text（不可作为正常发布规则）", () => {
    const { valid, errors } = validatePolicyForPublish({
      hard_guardrails: [{ rule_code: "legacy_text", original: "旧规则" }],
    });
    expect(valid).toBe(false);
    expect(errors[0]).toMatch(/not publishable/);
  });
  it("validatePolicyForPublish 拒绝未知 rule_code", () => {
    const { valid } = validatePolicyForPublish({ hard_guardrails: [{ rule_code: "ghost" }] });
    expect(valid).toBe(false);
  });
  it("validatePolicyForPublish 同时校验 tracks（拒绝未知轨道）", () => {
    const { valid, errors } = validatePolicyForPublish({
      hard_guardrails: [{ rule_code: "subject_conflict" }],
      tracks: [{ track_id: "ghost_track" }],
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.match(/unknown/))).toBe(true);
  });
});

describe("policyUtils — 项5：publishGuessPolicy / updateGuessPolicy 迁移 + 校验入口", () => {
  it("旧字符串规则经迁移后被发布入口拒绝（推动重写）", () => {
    const res = publishGuessPolicy({ hard_guardrails: ["旧自然语言规则"] });
    expect(res.valid).toBe(false);
    expect(res.policy).toBeNull();
    // 迁移确实执行了（内部含 legacy_text）
    expect(res.errors.some((e) => e.match(/not publishable/))).toBe(true);
  });
  it("结构化规则通过发布入口并返回迁移后 policy", () => {
    const res = publishGuessPolicy({ hard_guardrails: [{ rule_code: "subject_conflict" }], tracks: [{ track_id: "causal_chain", guardrails: ["x"] }] });
    expect(res.valid).toBe(true);
    expect(res.policy).toBeTruthy();
    expect(res.policy.hard_guardrails[0]).toEqual({ rule_code: "subject_conflict" });
  });
  it("updateGuessPolicy 同样执行迁移与校验", () => {
    const res = updateGuessPolicy({ hard_guardrails: ["旧规则", { rule_code: "time_impossible", max_gap_minutes: 60 }] });
    expect(res.valid).toBe(false); // legacy_text 迁移后被拒
    expect(res.policy).toBeNull();
  });
  it("全结构化 policy 经 update 入口通过", () => {
    const res = updateGuessPolicy({ hard_guardrails: [{ rule_code: "attach_to_closed_workflow" }] });
    expect(res.valid).toBe(true);
    expect(res.policy).toBeTruthy();
  });
});