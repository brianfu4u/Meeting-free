/**
 * Clinic OS V10 — GuessPolicy 发布编排器（pure，无 Deno/SDK 依赖）
 *
 * 被后端 entry.ts（Deno，注入真实 Base44 SDK ops）与 vitest（Node，注入 mock ops）
 * 共同复用。所有副作用通过 PublishOps 注入；编排器本身只做纯逻辑 + 补偿。
 *
 * 并发模型（R3 阻断修复）：
 * - 真正原子互斥通过 ClinicConfig 单文档 CAS 锁（acquireLock/releaseLock）实现，
 *   不再依赖 created_date earliest 这种乐观启发。MongoDB 单文档 updateMany 原子，
 *   `{clinic_id, publish_lock_request_id: null} → $set:{publish_lock_request_id: key}`
 *   保证同 clinic 同时只有一个请求进入发布临界区。
 * - 幂等命中按 Policy 状态分类（classifyHit）：published=幂等成功 / draft·reviewed=
 *   publish_in_progress(409) / retired=idempotent_retired(409) / 多条=integrity_conflict(409)。
 * - post-create 去重仅作安全网，且不再把 rival draft 当作成功结果。
 *
 * 顺序：idempotency_key 必填 → 预查幂等（快路径，无锁）→ 获取 CAS 锁 →
 * 锁内重查幂等 → 计算 next_version → 版本校验 → 校验候选 → 创建暂存 →
 * post-create 去重（安全网）→ 退役旧 → 更新 config → 标记 published。
 * 任一步失败触发 compensate；补偿不完整则返回 compensation_failed。
 */
import { migrateHardGuardrails, validatePolicyForPublish } from "./contract.ts";

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
  acquireLock(clinic_id: string, key: string): Promise<{ acquired: boolean }>;
  releaseLock(clinic_id: string, key: string): Promise<void>;
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

/**
 * 幂等命中分类：按记录状态返回明确结果，绝不把 draft/retired 当作当前发布成功。
 * 多条同 key → integrity_conflict，输出记录 ID，不静默选 earliest。
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

  // 2. 预查幂等（快路径，无锁）：已 published → 幂等成功；draft → 进行中；retired → 已退役
  const preExisting = await ops.findByIdempotencyKey(clinic_id, key);
  const preHit = classifyHit(preExisting);
  if (preHit) return preHit;

  // 3. 获取 CAS 锁（ClinicConfig 单文档原子互斥）
  const lock = await ops.acquireLock(clinic_id, key);
  if (!lock.acquired) {
    return {
      ok: false,
      status: "publish_lock_busy",
      http_status: 409,
      error: "另一发布进行中，请重试（相同幂等键重试将命中幂等）",
    };
  }
  try {
    return await publishUnderLock(input, ops, key);
  } finally {
    await ops.releaseLock(clinic_id, key).catch(() => {});
  }
}

async function publishUnderLock(input: PublishInput, ops: PublishOps, key: string): Promise<PublishResult> {
  const { clinic_id, user_id } = input;

  // 4. 锁内权威重查幂等（并发窗口内另一请求可能已完成）
  const existing = await ops.findByIdempotencyKey(clinic_id, key);
  const hit = classifyHit(existing);
  if (hit) return hit;

  // 5. 计算 next_version（服务端单调，不信任前端）
  const all = await ops.findAllPolicies(clinic_id);
  const versions = all.map((r: any) => Number(r.policy_version) || 0);
  const maxV = versions.length ? Math.max(...versions) : 0;
  const nextV = maxV + 1;

  // 6. 版本校验
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

  // 7. 候选校验（迁移 + 发布校验，逻辑来自 contract.ts 唯一源）
  const migrated = migrateHardGuardrails(input.hard_guardrails || []);
  const candidate = { hard_guardrails: migrated, tracks: input.tracks, decision_rules: input.decision_rules };
  const { valid, errors } = validatePolicyForPublish(candidate);
  if (!valid) {
    return { ok: false, status: "validation_failed", http_status: 400, errors, next_version: nextV };
  }

  const now = new Date().toISOString();

  // 8. 创建暂存（draft）
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

  // 9. post-create 去重（安全网；锁内本不应触发。命中 rival 按 classify 分类，draft 不当成功）
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

  // 10. 快照旧 published + config active（供补偿恢复）
  const oldPublished = await ops.findPublished(clinic_id);
  const oldSnap = oldPublished.map((o: any) => ({ id: o.id, retired_at: o.retired_at ?? null }));
  const cfg = await ops.findConfig(clinic_id);
  const originalActive = cfg?.active_policy_version ?? null;

  // 11. 退役旧 published
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

  // 12. config 必须存在
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

  // 13. 更新 config.active_policy_version
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

  // 14. 标记暂存为 published（最后一步）
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

  // 恢复本次实际被退役的旧 published
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

  // 恢复 config：仅当本次确实更新过 config。originalActive 可能为 null，必须显式恢复为 null。
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
    // config 本次未被更新 → 仍处于正确状态，无需恢复
    report.config_restored = true;
  }

  // 删除暂存
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