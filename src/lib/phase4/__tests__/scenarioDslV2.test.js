import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const converter = path.join(root, "scripts/agent-v11-scenario-dsl-v2.mjs");
const source = fs.readFileSync(converter, "utf8");

function run(csv) {
  const input = path.join(root, `.agent-v11-dsl-${process.pid}.csv`);
  fs.writeFileSync(input, csv);
  try { return JSON.parse(execFileSync(process.execPath, [converter, input], { encoding: "utf8" })); }
  finally { fs.unlinkSync(input); }
}

const header = "scenario_id,department,business_family,description,candidates_count,has_guardrail_dispatch,has_validation_block,expected_eligible,notes";

describe("Agent v1.1 Scenario DSL v2", () => {
  it("separates physical fixtures from the expected-result oracle", () => {
    const output = run(`${header}\nS009,财务收款,patient_care,OCT收费,1,FALSE,FALSE,TRUE,倒推\n`);
    const scenario = output.scenarios[0];
    expect(output.schema_version).toBe("agent-v11-scenario-dsl-v2");
    expect(output.runner_compatibility).toBe("requires_v2_fixture_adapter");
    expect(scenario.fixture.fragments[0].finance_expected_missing).toEqual(["ophthalmic_imaging"]);
    expect(scenario.execution_support).toEqual({ level: "supported", reason: null });
    expect(scenario.fixture).not.toHaveProperty("expected_eligible");
    expect(scenario.oracle.expected_eligible).toBe(true);
  });

  it("promotes verified hard gates while keeping approximate evidence separate", () => {
    const roleConflict = run(`${header}\nS003,后勤→医生处方,patient_care,role,1,FALSE,TRUE,FALSE,role\n`).scenarios[0];
    const businessConflict = run(`${header}\nS004,验光→采购,procurement,family,1,FALSE,TRUE,FALSE,family\n`).scenarios[0];
    const deviceConflict = run(`${header}\nS014,设备维护,inventory,device,1,FALSE,TRUE,FALSE,device\n`).scenarios[0];
    const approximate = run(`${header}\nS010,跨诊所,patient_care,cross,1,TRUE,TRUE,FALSE,cross\n`).scenarios[0];
    for (const scenario of [roleConflict, businessConflict, deviceConflict]) {
      expect(scenario.execution_support).toEqual({ level: "supported", reason: null });
      expect(scenario.fixture).not.toHaveProperty("expected_eligible");
    }
    expect(approximate.execution_support.level).toBe("approximate");
  });

  it("represents multi-candidate ambiguity as two real workflows", () => {
    const output = run(`${header}\nS005,前台→验光,patient_care,多候选,2,FALSE,FALSE,FALSE,歧义\n`);
    expect(output.scenarios[0].fixture.workflows).toHaveLength(2);
    expect(output.scenarios[0].fixture.fragments[0].targeting.mode).toBe("none");
  });

  it("represents closed and cross-tenant conditions in fixture state", () => {
    const closed = run(`${header}\nS012,补传,patient_care,closed,1,TRUE,TRUE,FALSE,closed\n`).scenarios[0];
    const cross = run(`${header}\nS010,跨诊所,patient_care,cross,1,TRUE,TRUE,FALSE,cross\n`).scenarios[0];
    expect(closed.fixture.workflows[0].status).toBe("closed_archived");
    expect(cross.fixture.workflows[0].clinic_scope).toBe("foreign");
  });

  it("models role/proxy, device conflicts and descriptive missing segments", () => {
    const proxy = run(`${header}\nS015,经理特批,patient_care,proxy,1,TRUE,TRUE,FALSE,exception\n`).scenarios[0];
    const device = run(`${header}\nS014,设备维护,inventory,device,1,TRUE,TRUE,FALSE,device\n`).scenarios[0];
    const missing = run(`${header}\nS007,验光→医生,patient_care,missing,1,FALSE,FALSE,TRUE,missing\n`).scenarios[0];
    expect(proxy.fixture.fragments[0]).toMatchObject({ is_proxy: true, exception_class: "manager_approved_exception", normal_rule_learning_eligible: false });
    expect(proxy.execution_support).toEqual({ level: "supported", reason: null });
    expect(device.fixture.workflows[0].device_serial).not.toBe(device.fixture.fragments[0].device_serial);
    expect(missing.fixture.fragments[0].missing_segments).toContain("patient_registration");
  });

  it("never mutates secrets, requests commit, or names clinic-001 fixtures", () => {
    expect(source).not.toMatch(/secrets\.(set|delete)|AGENT_AUTO_ATTACH_MODE|auto_attach_mode\s*:\s*["']commit/);
    expect(source).not.toContain("clinic-001");
  });
});
