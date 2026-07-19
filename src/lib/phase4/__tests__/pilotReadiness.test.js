import { describe, expect, it } from "vitest";
import {
  buildPilotActivationPatch,
  buildPilotRollbackPatch,
  evaluatePilotReadiness,
} from "../pilotReadiness";

const config = {
  clinic_id: "phase4-it-123",
  activation_status: "active",
  composition_schedule_enabled: true,
  composition_rollout_status: "pilot",
  active_policy_version: 1,
  timezone: "Asia/Tokyo",
  schedule_times: ["12:30"],
};

describe("Phase 4 pilot readiness", () => {
  it("remains blocked while the automation is inactive", () => {
    expect(evaluatePilotReadiness({
      clinicId: config.clinic_id,
      config,
      schedulerEnabled: true,
      schedulerClinicAllowlist: config.clinic_id,
      automationActive: false,
    })).toMatchObject({ ready: false, blockers: ["automation_inactive"] });
  });

  it("requires every explicit gate before a pilot is ready", () => {
    expect(evaluatePilotReadiness({
      clinicId: config.clinic_id,
      config,
      schedulerEnabled: true,
      schedulerClinicAllowlist: config.clinic_id,
      automationActive: true,
    })).toMatchObject({ ready: true, blockers: [] });
  });

  it("does not permit clinic-001 without a separate approval", () => {
    const primary = { ...config, clinic_id: "clinic-001" };
    const result = evaluatePilotReadiness({
      clinicId: "clinic-001",
      config: primary,
      schedulerEnabled: true,
      schedulerClinicAllowlist: "clinic-001",
      automationActive: true,
    });
    expect(result.ready).toBe(false);
    expect(result.blockers).toContain("primary_clinic_approval_missing");
  });

  it("accepts clinic-001 only when the separate approval is explicit", () => {
    const primary = { ...config, clinic_id: "clinic-001" };
    expect(evaluatePilotReadiness({
      clinicId: "clinic-001",
      config: primary,
      schedulerEnabled: true,
      schedulerClinicAllowlist: "clinic-001",
      automationActive: true,
      primaryClinicApproved: true,
    }).ready).toBe(true);
  });

  it("blocks stale locks and invalid configuration", () => {
    const result = evaluatePilotReadiness({
      clinicId: config.clinic_id,
      config: {
        ...config,
        timezone: "Mars/Olympus",
        schedule_times: ["99:99"],
        composition_run_lock_owner_id: "owner",
        composition_run_lock_expires_at: "2026-07-19T09:00:00Z",
      },
      schedulerEnabled: true,
      schedulerClinicAllowlist: config.clinic_id,
      automationActive: true,
      now: "2026-07-19T10:00:00Z",
    });
    expect(result.blockers).toEqual(expect.arrayContaining([
      "timezone_invalid",
      "schedule_times_invalid",
      "stale_run_lock",
    ]));
  });

  it("rollback only disables scheduling and never deletes data", () => {
    expect(buildPilotRollbackPatch()).toEqual({
      composition_schedule_enabled: false,
      composition_rollout_status: "disabled",
    });
    expect(JSON.stringify(buildPilotRollbackPatch())).not.toMatch(/delete|remove/i);
  });

  it("activation patch is explicit and minimal", () => {
    expect(buildPilotActivationPatch()).toEqual({
      composition_schedule_enabled: true,
      composition_rollout_status: "pilot",
    });
  });
});
