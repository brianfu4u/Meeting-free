/**
 * Phase 4 pilot-readiness and rollback contract.
 *
 * Pure logic only. This module never reads environment variables directly and
 * never writes entities. Operators must supply explicit deployment evidence.
 */

const ROLLOUT_STATES = new Set(["pilot", "active"]);

function uniqueClinicIds(value) {
  return [
    ...new Set(
      String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  ].slice(0, 10);
}

function hasValidTimezone(timezone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function hasValidSlot(slots) {
  return (
    Array.isArray(slots) &&
    slots.length > 0 &&
    slots.every((slot) => /^([01]\d|2[0-3]):[0-5]\d$/.test(slot))
  );
}

export function evaluatePilotReadiness({
  clinicId,
  config,
  schedulerEnabled,
  schedulerClinicAllowlist,
  automationActive,
  primaryClinicApproved = false,
  now = new Date(),
}) {
  const blockers = [];
  const allowlist = uniqueClinicIds(schedulerClinicAllowlist);

  if (!clinicId) blockers.push("clinic_id_missing");
  if (!config || config.clinic_id !== clinicId) blockers.push("clinic_config_missing");
  if (clinicId === "clinic-001" && primaryClinicApproved !== true) {
    blockers.push("primary_clinic_approval_missing");
  }
  if (schedulerEnabled !== true) blockers.push("scheduler_environment_disabled");
  if (!allowlist.includes(clinicId)) blockers.push("clinic_not_allowlisted");
  if (automationActive !== true) blockers.push("automation_inactive");

  if (config) {
    if (config.activation_status !== "active") blockers.push("clinic_inactive");
    if (config.composition_schedule_enabled !== true) blockers.push("clinic_schedule_disabled");
    if (!ROLLOUT_STATES.has(config.composition_rollout_status)) {
      blockers.push("pilot_rollout_not_enabled");
    }
    if (!Number.isInteger(config.active_policy_version) || config.active_policy_version < 1) {
      blockers.push("active_policy_version_missing");
    }
    if (!hasValidTimezone(config.timezone)) blockers.push("timezone_invalid");
    if (!hasValidSlot(config.schedule_times)) blockers.push("schedule_times_invalid");

    const expires = config.composition_run_lock_expires_at
      ? new Date(config.composition_run_lock_expires_at).getTime()
      : null;
    const nowMs = new Date(now).getTime();
    if (
      config.composition_run_lock_owner_id &&
      Number.isFinite(expires) &&
      Number.isFinite(nowMs) &&
      expires <= nowMs
    ) {
      blockers.push("stale_run_lock");
    }
  }

  return {
    ready: blockers.length === 0,
    clinicId: clinicId || null,
    allowlist,
    blockers: [...new Set(blockers)],
  };
}

export function buildPilotRollbackPatch() {
  return {
    composition_schedule_enabled: false,
    composition_rollout_status: "disabled",
  };
}

export function buildPilotActivationPatch() {
  return {
    composition_schedule_enabled: true,
    composition_rollout_status: "pilot",
  };
}
