/**
 * Phase 4 scheduled-composition core.
 *
 * Pure logic only. It never writes entities and never approves or commits a
 * hypothesis. The backend adapter supplies the clock, configuration and
 * artifact watermark.
 */

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ENABLED_STATES = new Set(["shadow", "pilot", "active"]);

function localParts(now, timezone) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
      businessDate: `${value.year}-${value.month}-${value.day}`,
      localHHMM: `${value.hour}:${value.minute}`,
      minuteOfDay: Number(value.hour) * 60 + Number(value.minute),
    };
  } catch {
    return null;
  }
}

function slotMinute(slot) {
  const match = HHMM.exec(slot);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function selectScheduledSlot({ config, now = new Date() }) {
  if (!config || typeof config !== "object") return { eligible: false, reason: "config_missing" };
  if (config.activation_status !== "active") return { eligible: false, reason: "clinic_inactive" };
  if (config.composition_schedule_enabled !== true) return { eligible: false, reason: "schedule_disabled" };
  if (!ENABLED_STATES.has(config.composition_rollout_status)) {
    return { eligible: false, reason: "rollout_disabled" };
  }
  if (!Number.isInteger(config.active_policy_version) || config.active_policy_version < 1) {
    return { eligible: false, reason: "active_policy_version_missing" };
  }
  const grace = Number(config.composition_schedule_grace_minutes ?? 10);
  if (!Number.isInteger(grace) || grace < 1 || grace > 30) {
    return { eligible: false, reason: "grace_invalid" };
  }
  const parts = localParts(now, config.timezone);
  if (!parts) return { eligible: false, reason: "timezone_invalid" };
  const slots = [...new Set(Array.isArray(config.schedule_times) ? config.schedule_times : [])]
    .map((slot) => ({ slot, minute: slotMinute(slot) }))
    .filter((item) => item.minute != null && item.minute <= parts.minuteOfDay)
    .sort((a, b) => b.minute - a.minute);
  const due = slots.find((item) => parts.minuteOfDay - item.minute <= grace);
  if (!due) return { eligible: false, reason: "slot_not_due", ...parts };
  return {
    eligible: true,
    reason: "slot_due",
    slot: due.slot,
    businessDate: parts.businessDate,
    localHHMM: parts.localHHMM,
    minutesSinceSlot: parts.minuteOfDay - due.minute,
  };
}

export function buildScheduledRunRequest({ config, due, artifacts }) {
  if (!due?.eligible || !due.slot || !due.businessDate) {
    return { ok: false, reason: "slot_not_due" };
  }
  const rows = Array.isArray(artifacts) ? artifacts : [];
  const watermarkRows = rows
    .map((item) => ({
      seq: Number(item?.ingestion_seq),
      ingestedAt: item?.ingested_at || item?.captured_at || item?.created_date || null,
    }))
    .filter((item) => Number.isFinite(item.seq));
  if (!watermarkRows.length) return { ok: false, reason: "no_artifacts" };
  const cutoffEventSeq = Math.max(...watermarkRows.map((item) => item.seq));
  const cutoffIngestedAt = watermarkRows
    .map((item) => item.ingestedAt)
    .filter((value) => typeof value === "string" && value)
    .sort()
    .at(-1) || null;
  return {
    ok: true,
    request: {
      action: "run",
      clinic_id: config.clinic_id,
      business_date: due.businessDate,
      slot: due.slot,
      trigger_type: "scheduled",
      cutoff_event_seq: cutoffEventSeq,
      cutoff_ingested_at: cutoffIngestedAt,
      policy_version: config.active_policy_version,
    },
  };
}
