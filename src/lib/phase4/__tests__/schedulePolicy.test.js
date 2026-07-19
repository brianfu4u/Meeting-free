import { describe, expect, it } from "vitest";
import {
  scheduleSlotDue,
  scheduledCompositionEligible,
  validateCompositionRolloutConfig,
} from "../schedulePolicy";

const enabled = {
  activation_status: "active",
  composition_rollout_status: "shadow",
  composition_schedule_enabled: true,
  composition_schedule_grace_minutes: 10,
  schedule_times: ["12:30", "15:30", "17:30"],
  timezone: "Asia/Tokyo",
  active_policy_version: 1,
};

describe("Phase 4 rollout contract", () => {
  it("keeps scheduling disabled by default", () => {
    expect(scheduledCompositionEligible({
      activation_status: "active",
      schedule_times: ["12:30"],
      timezone: "Asia/Tokyo",
    })).toMatchObject({ eligible: false, reason: "schedule_disabled" });
  });

  it("requires an explicit non-disabled rollout state", () => {
    expect(scheduledCompositionEligible({
      ...enabled,
      composition_rollout_status: "disabled",
    })).toMatchObject({ eligible: false, reason: "rollout_disabled" });
  });

  it("requires a published policy before scheduling", () => {
    const result = validateCompositionRolloutConfig({
      ...enabled,
      active_policy_version: null,
    });
    expect(result.errors).toContain("active_policy_version_required");
  });

  it("rejects malformed or duplicate schedule slots", () => {
    const result = validateCompositionRolloutConfig({
      ...enabled,
      schedule_times: ["25:00", "12:30", "12:30"],
    });
    expect(result.errors).toContain("schedule_time_invalid");
    expect(result.errors).toContain("schedule_times_duplicate");
  });

  it("allows only an active clinic with explicit scheduling", () => {
    expect(scheduledCompositionEligible(enabled)).toEqual({
      eligible: true, reason: "eligible", errors: [],
    });
    expect(scheduledCompositionEligible({
      ...enabled, activation_status: "inactive",
    })).toMatchObject({ eligible: false, reason: "clinic_inactive" });
  });

  it("emits only an exact configured slot inside its grace window", () => {
    expect(scheduleSlotDue({ config: enabled, localHHMM: "12:30", minutesSinceSlot: 0 }))
      .toMatchObject({ eligible: true, reason: "slot_due", slot: "12:30" });
    expect(scheduleSlotDue({ config: enabled, localHHMM: "12:31", minutesSinceSlot: 1 }))
      .toMatchObject({ eligible: false, reason: "slot_not_due" });
    expect(scheduleSlotDue({ config: enabled, localHHMM: "12:30", minutesSinceSlot: 11 }))
      .toMatchObject({ eligible: false, reason: "outside_grace_window" });
  });

  it("caps the grace window to 30 minutes", () => {
    expect(validateCompositionRolloutConfig({
      ...enabled, composition_schedule_grace_minutes: 31,
    }).errors).toContain("composition_schedule_grace_minutes_invalid");
  });
});
