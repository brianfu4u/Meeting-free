import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  TEST_TERMINAL_SIGNUP_CLINICS,
  TEST_TERMINAL_STAFF_DEPARTMENT_ID,
  TEST_TERMINAL_STAFF_ROLE,
  TEST_TERMINAL_STAFF_ROLE_GROUP,
  buildStaffBindingPayload,
  canUseTerminalPunch,
  isTerminalPunchTestClinic,
} from "../terminalPunchTesting.js";

describe("terminal punch test-clinic signup", () => {
  it("scopes the simplified flow to clinic-001 only", () => {
    expect(TEST_TERMINAL_SIGNUP_CLINICS).toEqual(["clinic-001"]);
    expect(isTerminalPunchTestClinic("clinic-001")).toBe(true);
    expect(isTerminalPunchTestClinic("clinic-002")).toBe(false);
    expect(isTerminalPunchTestClinic("phase5-it-e2e-test")).toBe(false);
  });

  it("creates a bound, punch-ready generic staff record for clinic-001", () => {
    const payload = buildStaffBindingPayload({
      clinicId: "clinic-001",
      user: { id: "user-001" },
      name: " 测试员工 ",
      selectedRole: "doctor",
      zone: " 终端A ",
    });

    expect(payload).toEqual({
      clinic_id: "clinic-001",
      staff_name: "测试员工",
      role: TEST_TERMINAL_STAFF_ROLE,
      role_group: TEST_TERMINAL_STAFF_ROLE_GROUP,
      department_id: TEST_TERMINAL_STAFF_DEPARTMENT_ID,
      status: "off_duty",
      pad_online: true,
      user_id: "user-001",
      assigned_zone: "终端A",
    });
    expect(canUseTerminalPunch({ staff: { id: "staff-001", ...payload }, clinicId: "clinic-001" })).toBe(true);
  });

  it("preserves the existing role-selection behavior for other clinics", () => {
    const payload = buildStaffBindingPayload({
      clinicId: "clinic-002",
      user: { id: "user-002" },
      name: "正式诊所医生",
      selectedRole: "doctor",
      zone: "诊室1",
    });

    expect(payload.role).toBe("doctor");
    expect(payload.role_group).toBe("clinical");
    expect(payload.department_id).toBe("outpatient");
  });

  it("requires only a valid bound Staff identity in the active clinic", () => {
    const valid = {
      id: "staff-001",
      clinic_id: "clinic-001",
      user_id: "user-001",
      role: "reception",
    };

    expect(canUseTerminalPunch({ staff: valid, clinicId: "clinic-001" })).toBe(true);
    expect(canUseTerminalPunch({ staff: { ...valid, user_id: "" }, clinicId: "clinic-001" })).toBe(false);
    expect(canUseTerminalPunch({ staff: valid, clinicId: "clinic-002" })).toBe(false);
    expect(canUseTerminalPunch({ staff: { ...valid, role: "STAFF" }, clinicId: "clinic-001" })).toBe(false);
  });

  it("wires the policy into both registration and punch components", () => {
    const bindingSource = readFileSync(
      new URL("../../../components/staffPad/BindingScreen.jsx", import.meta.url),
      "utf8",
    );
    const clockSource = readFileSync(
      new URL("../../../components/staffPad/ClockBar.jsx", import.meta.url),
      "utf8",
    );

    expect(bindingSource).toContain("buildStaffBindingPayload");
    expect(bindingSource).toContain("fixed-test-staff-role");
    expect(clockSource).toContain("canUseTerminalPunch");
    expect(clockSource).toContain("disabled={busy || !punchEligible}");
  });
});
