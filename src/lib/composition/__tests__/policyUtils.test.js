import { describe, it, expect } from "vitest";
import { validateGuessPolicy, migrateHardGuardrails, KNOWN_RULE_CODES } from "../policyUtils";

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