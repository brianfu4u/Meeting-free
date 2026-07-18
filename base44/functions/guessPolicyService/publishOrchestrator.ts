/**
 * Clinic OS V10 — GuessPolicy 发布编排器（pure，无 Deno/SDK 依赖）
 *
 * 被后端 entry.ts（Deno，注入真实 Base44 SDK ops）与 vitest（Node，注入 mock ops）
 * 共同复用。所有副作用通过 PublishOps 注入；编排器本身只做纯逻辑 + 补偿。
 *
 * 并发模型（R3→R4 加固）：
 * - lock_owner_id（每请求 UUID，crypto.randomUUID）与业务 idempotency_key 严格分离；
 *   idempotency_key 只用于发布幂等，绝不作为锁持有者标识。
 * - CAS 锁基于 ClinicConfig 单文档 updateMany：过滤 publish_lock_owner_id=null
 *   → $set owner/acquired_at/expires_at，由 updateMany 返回的 updated===1 唯一判定成功
 *   （不通过"重读字段等于业务 key"判断持锁）。
 * - 短租约（LOCK_LEASE_MS=30s）+ 过期接管：锁过期后新请求可用精确值 CAS 接管，
 *   保证函数崩溃不会永久锁死门店。
 * - releaseLock 用 clinic_id + lock_owner_id 条件释放，返回 updated；失败不静默，
 *   成功发布但锁未被自己释放时在结果中输出 lock_release_warning（reconciliation）。
 *
 * 顺序：idempotency_key 必填 → 预查幂等（快路径，无锁）→ 生成 lock_owner_id →
 * 获取 CAS 锁 → 锁内重查幂等 → 计算 next_version → 版本校验 → 校验候选 →
 * 创建暂存 → post-create 去重 → 退役旧 → 更新 config → 标记 published → 释放锁。
 */
import { migrateHardGuardrails, validatePolicyForPublish } from "./contract.ts";

export const LOCK_LEASE_MS = 30_000;

export interface CompensationReport {
  attempted: boolean;
  succeeded: boolean;
  reason: string;
  failed_stage: string | null;
  restored_retired_ids: string[];
  failed_restore_retired_ids: string[];
  config_restored: boolean;
  config_restore_failed: boolean;
  staging_deleted: boolean;
  staging_delete_failed: boolean;
  reconciliation: { stage: string; detail: string }[];
}

export interface PublishResult {
  ok: boolean;
  status:
    | "published"
    | "idempotent"
    | "version_conflict"
    | "validation_failed"
    | "missing_idempotency_key"
    | "publish_failed"
    | "compensation_failed"
    | "publish_in_progress"
    | "integrity_conflict"
    | "idempotent_retired"
    | "publish_lock_busy";
  http_status: number;
  policy?: any;
  policy_id?: string;
  next_version?: number;
  provided?: number;
  idempotent?: boolean;
  error?: string;
  errors?: string[];
  record_ids?: string[];
  compensation?: CompensationReport;
  lock_owner_id?: string;
  lock_release_status?: "released" | "lock_release_failed" | "lock_taken_over";
  lock_release_warning?: string;
}

export interface PublishOps {
  findByIdempotencyKey(clinic_id: string, key: string): Promise<any[]>;
  findAllPolicies(clinic_id: string): Promise<any[]>;
  findPublished(clinic_id: string): Promise<any[]>;
  findConfig(clinic_id: string): Promise<any | null>;
  createStaging(input: any): Promise<any>;
  recheckByIdempotencyKey(clinic_id: string, key: string): Promise<any[]>;
  recheckByVersion(clinic_id: string, version: number): Promise<any[]>;
  retirePolicy(id: string, now: string, index: number): Promise<void>;
  restoreRetired(id: string, retired_at: any): Promise<void>;
  updateConfigActive(configId: string, version: number): Promise<void>;
  restoreConfigActive(configId: string, originalActive: number | null): Promise<void>;
  markPublished(id: string, now: string, userId: string): Promise<any>;
  deleteStaging(id: string): Promise<void>;
  // CAS 锁：owner-scoped。acquireLock 由 updateMany 的 updated===1 判定成功。
  acquireLock(
    clinic_id: string,
    lock_owner_id: string,
    nowISO: string,
    expiresISO: string
  ): Promise<{ acquired: boolean; reason?: string }>;
  // 释放锁：仅 clinic_id + lock_owner_id 条件；返回 updated（1=已释放，0=不再持有）。
  releaseLock(clinic_id: string, lock_owner_id: string): Promise<{ updated: number; error?: string }>;
}

export interface PublishInput {
  clinic_id: string;
  idempotency_key?: string;
  policy_version?: number;
  hard_guardrails?: any[];
  tracks?: any[];
  decision_rules?: any;
  user_id: string;
}

function ts(d: any): number {
  if (!d) return 0;
  const t = new Date(d).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function newLockOwner(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * 幂等命中分类：按记录状态返回明确结果，绝不把 draft/retired 当作当前发布成功。
 */
function classifyHit(records: any[]): PublishResult | null {
  if (!records || records.length === 0) return null;
  if (records.length > 1) {
    return {
      ok: false,
      status: "integrity_conflict",
      http_status: 409,
      error: "幂等键命中多条记录（数据完整性冲突）",
      record_ids: records.map((r) => r.id),
    };
  }
  const rec = records[0];
  if (rec.status === "published") {
    return { ok: true, status: "idempotent", http_status: 200, policy: rec, policy_id: rec.id, idempotent: true };
  }
  if (rec.status === "draft" || rec.status === "reviewed") {
    return { ok: false, status: "publish_in_progress", http_status: 409, error: "该幂等键对应的发布仍在进行中", policy_id: rec.id };
  }
  if (rec.status === "retired") {
    return {
      ok: false,
      status: "idempotent_retired",
      http_status: 409,
      error: "该幂等键对应的发布已被退役（被更新版本取代），请使用新 key 重新发布",
      policy_id: rec.id,
    };
  }
  return { ok: false, status: "integrity_conflict", http_status: 409, error: "未知策略状态: " + rec.status, policy_id: rec.id };
}

export async function orchestratePublish(input: PublishInput, ops: PublishOps): Promise<PublishResult> {
  const { clinic_id } = input;
  const key = input.idempotency_key;

  // 1. 幂等键必填
  if (!key || typeof key !== "string") {
    return { ok: false, status: "missing_idempotency_key", http_status: 400, error: "idempotency_key 必填" };
  }

  // 2. 预查幂等（快路径，无锁）
  const preExisting = await ops.findByIdempotencyKey(clinic_id, key);
  const preHit = classifyHit(preExisting);
  if (preHit) return preHit;

  // 3. 生成 lock_owner_id（UUID，每请求唯一，与 idempotency_key 分离）
  const lockOwner = newLockOwner();
  const nowD = new Date();
  const nowISO = nowD.toISOString();
  const expiresISO = new Date(nowD.getTime() + LOCK_LEASE_MS).toISOString();

  // 4. 获取 CAS 锁（updateMany updated===1 判定）
  const lock = await ops.acquireLock(clinic_id, lockOwner, nowISO, expiresISO);
  if (!lock.acquired) {
    return {
      ok: false,
      status: "publish_lock_busy",
      http_status: 409,
      error: "另一发布进行中或锁未释放，请重试（相同幂等键重试将命中幂等）",
      lock_owner_id: lockOwner,
    };
  }

  let result: PublishResult;
  try {
    result = await publishUnderLock(input, ops, key);
  } catch (e: any) {
    result = {
      ok: false,
      status: "publish_failed",
      http_status: 500,
      error: "publishUnderLock 异常：" + (e?.message || String(e)),
      lock_owner_id: lockOwner,
    };
  }

  // 5. 释放锁（owner-scoped CAS）；失败不静默，输出 reconciliation
  let releaseRes: { updated: number; error?: string };
  try {
    releaseRes = await ops.releaseLock(clinic_id, lockOwner);
  } catch (e: any) {
    releaseRes = { updated: 0, error: e?.message || String(e) };
  }
  if (releaseRes.updated === 1) {
    if (result && typeof result === "object") result.lock_release_status = "released";
  } else if (releaseRes.error) {
    if (result && typeof result === "object") {
      result.lock_release_status = "lock_release_failed";
      result.lock_release_warning = `lock_release_failed: ${releaseRes.error}（锁将在租约过期后自动恢复）`;
    }
  } else {
    // updated===0 且无异常：锁已不再属于本 owner（被租约过期接管）
    if (result && typeof result === "object") {
      result.lock_release_status = "lock_taken_over";
      result.lock_release_warning = "lock_not_owned_at_release: 锁可能已被租约过期接管（publish 已成功，租约到期自动恢复）";
    }
  }
  return result;
}

async function publishUnderLock(input: PublishInput, ops: PublishOps, key: string): Promise<PublishResult> {
  const { clinic_id, user_id } = input;

  // 6. 锁内权威重查幂等
  const existing = await ops.findByIdempotencyKey(clinic_id, key);
  const hit = classifyHit(existing);
  if (hit) return hit;

  // 7. 计算 next_version（服务端单调）
  const all = await ops.findAllPolicies(clinic_id);
  const versions = all.map((r: any) => Number(r.policy_version) || 0);
  const maxV = versions.length ? Math.max(...versions) : 0;
  const nextV = maxV + 1;

  // 8. 版本校验
  if (input.policy_version != null && Number(input.policy_version) !== nextV) {
    return {
      ok: false,
      status: "version_conflict",
      http_status: 409,
      error: "版本冲突：必须等于服务端 next_version",
      next_version: nextV,
      provided: Number(input.policy_version),
    };
  }

  // 9. 候选校验
  const migrated = migrateHardGuardrails(input.hard_guardrails || []);
  const candidate = { hard_guardrails: migrated, tracks: input.tracks, decision_rules: input.decision_rules };
  const { valid, errors } = validatePolicyForPublish(candidate);
  if (!valid) {
    return { ok: false, status: "validation_failed", http_status: 400, errors, next_version: nextV };
  }

  const now = new Date().toISOString();

  // 10. 创建暂存（draft）
  let staging: any;
  try {
    staging = await ops.createStaging({
      clinic_id,
      policy_version: nextV,
      status: "draft",
      hard_guardrails: migrated,
      tracks: input.tracks || [],
      decision_rules: input.decision_rules || {},
      publish_idempotency_key: key,
    });
  } catch (e: any) {
    return { ok: false, status: "publish_failed", http_status: 500, error: "暂存创建失败：" + e.message, next_version: nextV };
  }

  // 11. post-create 去重（安全网）
  try {
    const byKey = await ops.recheckByIdempotencyKey(clinic_id, key);
    const rivals = byKey.filter((r: any) => r.id !== staging.id && ts(r.created_date) < ts(staging.created_date));
    if (rivals.length > 0) {
      await ops.deleteStaging(staging.id);
      return classifyHit(rivals);
    }
  } catch (e: any) {
    await ops.deleteStaging(staging.id).catch(() => {});
    return { ok: false, status: "publish_failed", http_status: 500, error: "幂等去重检查失败：" + e.message, next_version: nextV };
  }
  try {
    const byVer = await ops.recheckByVersion(clinic_id, nextV);
    const rival = byVer.find((r: any) => r.id !== staging.id);
    if (rival) {
      await ops.deleteStaging(staging.id);
      return {
        ok: false,
        status: "version_conflict",
        http_status: 409,
        error: "并发版本冲突：另一请求已创建该版本",
        next_version: nextV,
        policy_id: rival.id,
      };
    }
  } catch (e: any) {
    await ops.deleteStaging(staging.id).catch(() => {});
    return { ok: false, status: "publish_failed", http_status: 500, error: "版本去重检查失败：" + e.message, next_version: nextV };
  }

  // 12. 快照旧 published + config active
  const oldPublished = await ops.findPublished(clinic_id);
  const oldSnap = oldPublished.map((o: any) => ({ id: o.id, retired_at: o.retired_at ?? null }));
  const cfg = await ops.findConfig(clinic_id);
  const originalActive = cfg?.active_policy_version ?? null;

  // 13. 退役旧 published
  const retiredIds: string[] = [];
  for (let i = 0; i < oldPublished.length; i++) {
    const o = oldPublished[i];
    try {
      await ops.retirePolicy(o.id, now, i);
      retiredIds.push(o.id);
    } catch (e: any) {
      const comp = await compensate(ops, {
        oldSnap,
        retiredIdsAlready: retiredIds,
        cfgId: cfg?.id ?? null,
        originalActive,
        configWasUpdated: false,
        stagingId: staging.id,
        failedStage: "retire@" + i,
        reason: "退役第 " + i + " 条失败：" + e.message,
      });
      return finishFailure(comp, "退役旧版本失败：" + e.message, nextV);
    }
  }

  // 14. config 必须存在
  if (!cfg) {
    const comp = await compensate(ops, {
      oldSnap,
      retiredIdsAlready: retiredIds,
      cfgId: null,
      originalActive,
      configWasUpdated: false,
      stagingId: staging.id,
      failedStage: "config_missing",
      reason: "ClinicConfig 不存在",
    });
    return finishFailure(comp, "ClinicConfig 不存在", nextV);
  }

  // 15. 更新 config.active_policy_version
  try {
    await ops.updateConfigActive(cfg.id, nextV);
  } catch (e: any) {
    const comp = await compensate(ops, {
      oldSnap,
      retiredIdsAlready: retiredIds,
      cfgId: cfg.id,
      originalActive,
      configWasUpdated: true,
      stagingId: staging.id,
      failedStage: "config_update",
      reason: "ClinicConfig 更新失败：" + e.message,
    });
    return finishFailure(comp, "ClinicConfig 更新失败：" + e.message, nextV);
  }

  // 16. 标记暂存为 published
  let published: any;
  try {
    published = await ops.markPublished(staging.id, now, user_id);
  } catch (e: any) {
    const comp = await compensate(ops, {
      oldSnap,
      retiredIdsAlready: retiredIds,
      cfgId: cfg.id,
      originalActive,
      configWasUpdated: true,
      stagingId: staging.id,
      failedStage: "publish_mark",
      reason: "发布标记失败：" + e.message,
    });
    return finishFailure(comp, "发布标记失败：" + e.message, nextV);
  }

  return {
    ok: true,
    status: "published",
    http_status: 200,
    policy: published,
    policy_id: published.id,
    next_version: nextV,
  };
}

async function compensate(
  ops: PublishOps,
  args: {
    oldSnap: { id: string; retired_at: any }[];
    retiredIdsAlready: string[];
    cfgId: string | null;
    originalActive: number | null;
    configWasUpdated: boolean;
    stagingId: string;
    failedStage: string;
    reason: string;
  }
): Promise<CompensationReport> {
  const report: CompensationReport = {
    attempted: true,
    succeeded: true,
    reason: args.reason,
    failed_stage: args.failedStage,
    restored_retired_ids: [],
    failed_restore_retired_ids: [],
    config_restored: false,
    config_restore_failed: false,
    staging_deleted: false,
    staging_delete_failed: false,
    reconciliation: [],
  };

  for (const id of args.retiredIdsAlready) {
    const snap = args.oldSnap.find((s) => s.id === id);
    try {
      await ops.restoreRetired(id, snap?.retired_at ?? null);
      report.restored_retired_ids.push(id);
    } catch (e: any) {
      report.failed_restore_retired_ids.push(id);
      report.reconciliation.push({ stage: "restore_retired", detail: id + ": " + e.message });
      report.succeeded = false;
    }
  }

  if (args.cfgId && args.configWasUpdated) {
    try {
      await ops.restoreConfigActive(args.cfgId, args.originalActive);
      report.config_restored = true;
    } catch (e: any) {
      report.config_restore_failed = true;
      report.reconciliation.push({ stage: "restore_config", detail: e.message });
      report.succeeded = false;
    }
  } else if (args.cfgId) {
    report.config_restored = true;
  }

  try {
    await ops.deleteStaging(args.stagingId);
    report.staging_deleted = true;
  } catch (e: any) {
    report.staging_delete_failed = true;
    report.reconciliation.push({ stage: "delete_staging", detail: args.stagingId + ": " + e.message });
    report.succeeded = false;
  }

  return report;
}

function finishFailure(comp: CompensationReport, error: string, nextV: number): PublishResult {
  if (comp.succeeded) {
    return {
      ok: false,
      status: "publish_failed",
      http_status: 500,
      error: error + "（已完整回滚）",
      next_version: nextV,
      compensation: comp,
    };
  }
  return {
    ok: false,
    status: "compensation_failed",
    http_status: 500,
    error: error + "（补偿未完整成功，需人工处理）",
    next_version: nextV,
    compensation: comp,
  };
}