import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SINGLE_CLINIC_UPLOAD_TEST_ID,
  canRelaxDefaultClinicOnDutyGate,
  resolveClinicActor,
} from "../../../../base44/shared/clinicActor.ts";

function makeSvc({ staffRows = [], clinicConfigs = [] } = {}) {
  return {
    entities: {
      Staff: {
        filter: vi.fn(async () => staffRows),
      },
      ClinicConfig: {
        filter: vi.fn(async () => clinicConfigs),
      },
    },
  };
}

describe("clinic actor tenant isolation", () => {
  it("allows an off-duty, same-clinic bound staff member to upload in clinic-001", async () => {
    const user = { id: "user-001", role: "user" };
    const staff = {
      id: "staff-001",
      user_id: user.id,
      clinic_id: DEFAULT_SINGLE_CLINIC_UPLOAD_TEST_ID,
      status: "off_duty",
    };
    const svc = makeSvc({ staffRows: [staff] });

    expect(canRelaxDefaultClinicOnDutyGate({
      clinicId: DEFAULT_SINGLE_CLINIC_UPLOAD_TEST_ID,
      staff,
      requireOnDuty: true,
    })).toBe(true);

    await expect(resolveClinicActor(
      svc,
      user,
      DEFAULT_SINGLE_CLINIC_UPLOAD_TEST_ID,
      { requireOnDuty: true, staffRole: "admin" },
    )).resolves.toEqual({
      user_id: user.id,
      clinic_id: DEFAULT_SINGLE_CLINIC_UPLOAD_TEST_ID,
      staff_id: staff.id,
      role: "admin",
    });
  });

  it("keeps a genuinely cross-clinic request blocked", async () => {
    const user = { id: "user-001", role: "user" };
    const svc = makeSvc({
      staffRows: [{
        id: "staff-001",
        user_id: user.id,
        clinic_id: "clinic-001",
        status: "off_duty",
      }],
    });

    await expect(resolveClinicActor(
      svc,
      user,
      "clinic-002",
      { requireOnDuty: true, staffRole: "admin" },
    )).resolves.toBeNull();
  });

  it("does not relax off-duty uploads for another clinic", async () => {
    const user = { id: "user-002", role: "user" };
    const staff = {
      id: "staff-002",
      user_id: user.id,
      clinic_id: "clinic-002",
      status: "off_duty",
    };
    const svc = makeSvc({ staffRows: [staff] });

    expect(canRelaxDefaultClinicOnDutyGate({
      clinicId: "clinic-002",
      staff,
      requireOnDuty: true,
    })).toBe(false);

    await expect(resolveClinicActor(
      svc,
      user,
      "clinic-002",
      { requireOnDuty: true, staffRole: "admin" },
    )).resolves.toBeNull();
  });

  it("preserves the existing on-duty same-clinic behavior", async () => {
    const user = { id: "user-003", role: "user" };
    const staff = {
      id: "staff-003",
      user_id: user.id,
      clinic_id: "clinic-001",
      status: "on_duty",
    };
    const svc = makeSvc({ staffRows: [staff] });

    await expect(resolveClinicActor(
      svc,
      user,
      "clinic-001",
      { requireOnDuty: true, staffRole: "admin" },
    )).resolves.toEqual({
      user_id: user.id,
      clinic_id: "clinic-001",
      staff_id: staff.id,
      role: "admin",
    });
  });

  it("still rejects an unbound non-admin user", async () => {
    const user = { id: "user-unbound", role: "user" };
    const svc = makeSvc();

    await expect(resolveClinicActor(
      svc,
      user,
      "clinic-001",
      { requireOnDuty: true, staffRole: "admin" },
    )).resolves.toBeNull();
  });
});
