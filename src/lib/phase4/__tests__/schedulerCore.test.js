import { describe, expect, it } from "vitest";
import { buildScheduledRunRequest, selectScheduledSlot } from "../schedulerCore";

const enabled = {
  clinic_id: "c1",
  activation_status: "active",
  composition_schedule_enabled: true,
  composition_rollout_status: "shadow",
  composition_schedule_grace_minutes: 10,
  active_policy_version: 3,
  timezone: "Asia/Tokyo",
  schedule_times: ["12:30", "15:30"],
};

describe("Phase 4 scheduler core", () => {
  it("keeps all rollout switches fail-closed", () => {
    expect(selectScheduledSlot({ config: { ...enabled, composition_schedule_enabled: false }, now: "2026-07-19T03:30:00Z" }).reason).toBe("schedule_disabled");
    expect(selectScheduledSlot({ config: { ...enabled, composition_rollout_status: "disabled" }, now: "2026-07-19T03:30:00Z" }).reason).toBe("rollout_disabled");
    expect(selectScheduledSlot({ config: { ...enabled, activation_status: "inactive" }, now: "2026-07-19T03:30:00Z" }).reason).toBe("clinic_inactive");
  });

  it("selects the most recent configured slot inside the grace window", () => {
    expect(selectScheduledSlot({ config: enabled, now: "2026-07-19T03:37:00Z" })).toMatchObject({
      eligible: true, slot: "12:30", businessDate: "2026-07-19", minutesSinceSlot: 7,
    });
  });

  it("rejects calls outside the configured grace window", () => {
    expect(selectScheduledSlot({ config: enabled, now: "2026-07-19T03:41:00Z" })).toMatchObject({
      eligible: false, reason: "slot_not_due",
    });
  });

  it("rejects invalid timezone and policy configuration", () => {
    expect(selectScheduledSlot({ config: { ...enabled, timezone: "Mars/Olympus" }, now: "2026-07-19T03:30:00Z" }).reason).toBe("timezone_invalid");
    expect(selectScheduledSlot({ config: { ...enabled, active_policy_version: null }, now: "2026-07-19T03:30:00Z" }).reason).toBe("active_policy_version_missing");
  });

  it("builds a deterministic scheduled run watermark", () => {
    const due = selectScheduledSlot({ config: enabled, now: "2026-07-19T03:35:00Z" });
    expect(buildScheduledRunRequest({
      config: enabled,
      due,
      artifacts: [
        { ingestion_seq: 4, ingested_at: "2026-07-19T03:02:00Z" },
        { ingestion_seq: 9, ingested_at: "2026-07-19T03:10:00Z" },
      ],
    })).toEqual({
      ok: true,
      request: {
        action: "run", clinic_id: "c1", business_date: "2026-07-19",
        slot: "12:30", trigger_type: "scheduled", cutoff_event_seq: 9,
        cutoff_ingested_at: "2026-07-19T03:10:00Z", policy_version: 3,
      },
    });
  });

  it("does not schedule an empty artifact set", () => {
    expect(buildScheduledRunRequest({
      config: enabled,
      due: { eligible: true, slot: "12:30", businessDate: "2026-07-19" },
      artifacts: [],
    })).toEqual({ ok: false, reason: "no_artifacts" });
  });
});
