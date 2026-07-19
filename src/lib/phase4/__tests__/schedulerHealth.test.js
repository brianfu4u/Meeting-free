import { describe, expect, it } from "vitest";
import {
  buildSchedulerHealthPatch,
  deriveSchedulerHealth,
  sanitizeSchedulerErrorCode,
} from "../schedulerHealth";

const active = {
  composition_schedule_enabled: true,
  composition_rollout_status: "shadow",
};

describe("Phase 4 scheduler health", () => {
  it("fails closed for unknown error codes", () => {
    expect(sanitizeSchedulerErrorCode("raw-provider-message")).toBe("scheduler_failed");
  });

  it("reports disabled without implying failure", () => {
    expect(deriveSchedulerHealth({
      config: { composition_schedule_enabled: false, composition_rollout_status: "disabled" },
      now: "2026-07-19T10:00:00Z",
    })).toMatchObject({ state: "disabled", severity: "neutral", errorCode: null });
  });

  it("reports a recent success as healthy", () => {
    expect(deriveSchedulerHealth({
      config: { ...active, composition_last_schedule_status: "success", composition_last_schedule_success_at: "2026-07-19T09:50:00Z" },
      now: "2026-07-19T10:00:00Z",
    })).toMatchObject({ state: "healthy", lagMinutes: 10 });
  });

  it("reports delayed success without exposing an error", () => {
    expect(deriveSchedulerHealth({
      config: { ...active, composition_last_schedule_status: "success", composition_last_schedule_success_at: "2026-07-19T08:00:00Z" },
      now: "2026-07-19T10:00:00Z",
    })).toMatchObject({ state: "delayed", severity: "warning", lagMinutes: 120 });
  });

  it("detects an expired run lease", () => {
    expect(deriveSchedulerHealth({
      config: { ...active, composition_run_lock_owner_id: "owner", composition_run_lock_expires_at: "2026-07-19T09:59:00Z" },
      now: "2026-07-19T10:00:00Z",
    })).toMatchObject({ state: "stale_lock", staleLock: true, errorCode: "run_lock_busy" });
  });

  it("sanitizes persisted failure detail", () => {
    expect(buildSchedulerHealthPatch({
      now: "2026-07-19T10:00:00Z",
      outcome: { ok: false, error_code: "provider secret: abc" },
      slot: "12:30",
    })).toEqual(expect.objectContaining({
      composition_last_schedule_status: "failed",
      composition_last_schedule_error_code: "scheduler_failed",
      composition_last_schedule_failure_at: "2026-07-19T10:00:00.000Z",
    }));
  });

  it("records successful idempotent runs without raw detail", () => {
    expect(buildSchedulerHealthPatch({
      now: "2026-07-19T10:00:00Z",
      outcome: { ok: true, idempotent: true, run: { id: "run-1" } },
      slot: "12:30",
    })).toEqual(expect.objectContaining({
      composition_last_schedule_status: "idempotent",
      composition_last_schedule_error_code: null,
      composition_last_schedule_run_id: "run-1",
      composition_last_schedule_success_at: "2026-07-19T10:00:00.000Z",
    }));
  });
});
