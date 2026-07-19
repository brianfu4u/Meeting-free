/**
 * Phase 4 scheduler operations health.
 *
 * Pure logic: safe status persistence and read-only health derivation.
 * Raw exception messages must never be persisted or returned.
 */

export const SAFE_SCHEDULER_ERROR_CODES = Object.freeze([
  "active_policy_version_missing",
  "clinic_inactive",
  "composition_run_failed",
  "config_missing",
  "grace_invalid",
  "no_artifacts",
  "rollout_disabled",
  "run_lock_busy",
  "schedule_disabled",
  "scheduler_failed",
  "slot_not_due",
  "timezone_invalid",
]);

const SAFE_CODES = new Set(SAFE_SCHEDULER_ERROR_CODES);

export function sanitizeSchedulerErrorCode(code) {
  return typeof code === "string" && SAFE_CODES.has(code)
    ? code
    : "scheduler_failed";
}

export function buildSchedulerHealthPatch({
  now = new Date(),
  outcome = null,
  status = null,
  reason = null,
  slot = null,
}) {
  const at = new Date(now);
  if (Number.isNaN(at.getTime())) throw new Error("scheduler_health_time_invalid");
  const iso = at.toISOString();
  const runId = outcome?.run?.id || outcome?.run_id || null;

  if (status === "skipped") {
    return {
      composition_last_scheduled_at: iso,
      composition_last_schedule_status: "skipped",
      composition_last_schedule_error_code: sanitizeSchedulerErrorCode(reason),
      composition_last_schedule_run_id: null,
      composition_last_schedule_slot: slot || null,
    };
  }

  if (outcome?.ok === true) {
    return {
      composition_last_scheduled_at: iso,
      composition_last_schedule_status: outcome.idempotent === true ? "idempotent" : "success",
      composition_last_schedule_error_code: null,
      composition_last_schedule_run_id: runId,
      composition_last_schedule_slot: slot || null,
      composition_last_schedule_success_at: iso,
    };
  }

  return {
    composition_last_scheduled_at: iso,
    composition_last_schedule_status: "failed",
    composition_last_schedule_error_code: sanitizeSchedulerErrorCode(
      outcome?.error_code || reason
    ),
    composition_last_schedule_run_id: runId,
    composition_last_schedule_slot: slot || null,
    composition_last_schedule_failure_at: iso,
  };
}

function timestamp(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function deriveSchedulerHealth({
  config,
  now = new Date(),
  lagThresholdMinutes = 30,
}) {
  if (!config) {
    return {
      state: "not_configured",
      severity: "neutral",
      errorCode: "config_missing",
      lagMinutes: null,
      staleLock: false,
      guidance: "尚未读取到门店调度配置。",
    };
  }

  const nowMs = timestamp(now);
  const expiresMs = timestamp(config.composition_run_lock_expires_at);
  const staleLock = Boolean(
    config.composition_run_lock_owner_id &&
    expiresMs != null &&
    nowMs != null &&
    expiresMs <= nowMs
  );
  if (staleLock) {
    return {
      state: "stale_lock",
      severity: "critical",
      errorCode: "run_lock_busy",
      lagMinutes: null,
      staleLock: true,
      guidance: "运行锁已过期；请先刷新，仍未恢复时由管理员检查租约接管。",
    };
  }

  if (
    config.composition_schedule_enabled !== true ||
    config.composition_rollout_status === "disabled"
  ) {
    return {
      state: "disabled",
      severity: "neutral",
      errorCode: null,
      lagMinutes: null,
      staleLock: false,
      guidance: "定时编组当前关闭；启用必须经过独立的门店灰度审批。",
    };
  }

  const lastAt = timestamp(
    config.composition_last_schedule_success_at ||
      config.composition_last_scheduled_at
  );
  const lagMinutes =
    lastAt != null && nowMs != null
      ? Math.max(0, Math.floor((nowMs - lastAt) / 60000))
      : null;
  const status = config.composition_last_schedule_status || "never";

  if (status === "failed") {
    const errorCode = sanitizeSchedulerErrorCode(
      config.composition_last_schedule_error_code
    );
    return {
      state: "degraded",
      severity: "critical",
      errorCode,
      lagMinutes,
      staleLock: false,
      guidance:
        errorCode === "run_lock_busy"
          ? "另一轮编组仍持有有效租约，请等待后刷新。"
          : "查看对应运行记录；修复配置或数据后等待下一时段，勿直接提交假设。",
    };
  }

  if (lastAt == null) {
    return {
      state: "waiting",
      severity: "warning",
      errorCode: null,
      lagMinutes: null,
      staleLock: false,
      guidance: "尚无调度结果；请核对时区、时段、策略版本和白名单。",
    };
  }

  if (lagMinutes > lagThresholdMinutes) {
    return {
      state: "delayed",
      severity: "warning",
      errorCode: null,
      lagMinutes,
      staleLock: false,
      guidance: "最近成功运行已延迟；请刷新并核对下一时段是否产生运行记录。",
    };
  }

  return {
    state: "healthy",
    severity: "healthy",
    errorCode: null,
    lagMinutes,
    staleLock: false,
    guidance: "调度健康；所有假设仍须经理审核后才能提交。",
  };
}
