/**
 * Phase 4 rollout/scheduling policy. Pure logic only: it never calls entities,
 * backend functions, timers, or production services.
 */
export const COMPOSITION_ROLLOUT_STATUSES = ["disabled", "shadow", "pilot", "active"];

const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function validateCompositionRolloutConfig(config = {}) {
  const errors = [];
  const status = config.composition_rollout_status ?? "disabled";
  if (!COMPOSITION_ROLLOUT_STATUSES.includes(status)) {
    errors.push("composition_rollout_status_invalid");
  }
  if (!Array.isArray(config.schedule_times)) {
    errors.push("schedule_times_required");
  } else {
    if (config.schedule_times.length > 12) errors.push("schedule_times_too_many");
    if (new Set(config.schedule_times).size !== config.schedule_times.length) {
      errors.push("schedule_times_duplicate");
    }
    if (config.schedule_times.some((time) => !HHMM.test(time))) {
      errors.push("schedule_time_invalid");
    }
  }
  if (!config.timezone || typeof config.timezone !== "string") {
    errors.push("timezone_required");
  }
  if (status !== "disabled" && config.composition_schedule_enabled === true) {
    if (!Number.isInteger(config.active_policy_version) || config.active_policy_version < 1) {
      errors.push("active_policy_version_required");
    }
  }
  const grace = Number(config.composition_schedule_grace_minutes ?? 10);
  if (!Number.isInteger(grace) || grace < 1 || grace > 30) {
    errors.push("composition_schedule_grace_minutes_invalid");
  }
  return { valid: errors.length === 0, errors };
}

export function scheduledCompositionEligible(config = {}) {
  const check = validateCompositionRolloutConfig(config);
  if (!check.valid) return { eligible: false, reason: "config_invalid", errors: check.errors };
  if (config.activation_status !== "active") {
    return { eligible: false, reason: "clinic_inactive", errors: [] };
  }
  if (config.composition_schedule_enabled !== true) {
    return { eligible: false, reason: "schedule_disabled", errors: [] };
  }
  if ((config.composition_rollout_status ?? "disabled") === "disabled") {
    return { eligible: false, reason: "rollout_disabled", errors: [] };
  }
  return { eligible: true, reason: "eligible", errors: [] };
}

export function scheduleSlotDue({ config, localHHMM, minutesSinceSlot = 0 }) {
  const eligibility = scheduledCompositionEligible(config);
  if (!eligibility.eligible) return { ...eligibility, slot: null };
  const grace = Number(config.composition_schedule_grace_minutes ?? 10);
  const slot = (config.schedule_times || []).find((time) => time === localHHMM) || null;
  if (!slot) return { eligible: false, reason: "slot_not_due", errors: [], slot: null };
  if (minutesSinceSlot < 0 || minutesSinceSlot > grace) {
    return { eligible: false, reason: "outside_grace_window", errors: [], slot };
  }
  return { eligible: true, reason: "slot_due", errors: [], slot };
}
