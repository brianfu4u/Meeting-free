/**
 * Clinic OS V10 — GuessPolicy 发布编排器（pure，无 Deno/SDK 依赖）
 *
 * 被后端 entry.ts（Deno，注入真实 Base44 SDK ops）与 vitest（Node，注入 mock ops）
 * 共同复用。所有副作用通过 PublishOps 注入；编排器本身只做纯逻辑 + 补偿。
 *
 * 顺序：idempotency_key 必填 → 按 key 查既有命中直接返回 → 计算 next_version →
 * 版本校验 → 校验候选 → 创建暂存 → post-create 去重 → 退役旧 → 更新 config →
 * 标记 published。任一步失败触发 compensate；补偿不完整则返回 compensation_failed。
 *
 * Base44 Entity 不支持复合唯一索引，故 post-create 乐观去重为平台能力上限：
 * 创建后立即 recheck，若发现更早的同 key / 同版本竞态记录，本请求认负删除自身并返回 winner。
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
    | "compensation_failed";
  http_status: number;
  policy?: any;
  policy_id?: string;
  next_version?: number;
  provided?: number;
  idempotent?: boolean;
  error?: string;
  errors?: string[];
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

function earliest(records: any[]): any {
  if (!records || records.length === 0) return null;
  return [...records].sort((a, b) => ts(a.created_date) - ts(b.created_date))[0];
}

export async function orchestratePublish(input: PublishInput, ops: PublishOps): Promise<PublishResult> {
  const { clinic_id, user_id } = input;
  const key = input.idempotency_key;

  // 1. 幂等键必填
  if (!key || typeof key !== "string") {
    return { ok: false, status: "missing_idempotency_key", http_status: 400, error: "idempotency_key 必填" };
  }

  // 2. 先按 key 查既有；命中直接返回（在任何版本校验之前）—— 保证重试幂等
  const existing = await ops.findByIdempotencyKey(clinic_id, key);
  if (existing && existing.length > 0) {
    const winner = earliest(existing);
    return { ok: true, status: "idempotent", http_status: 200, policy: winner, policy_id: winner.id, idempotent: true };
  }

  // 3. 计算 next_version（服务端单调，不信任前端）
  const all = await ops.findAllPolicies(clinic_id);
  const versions = all.map((r: any) => Number(r.policy_version) || 0);
  const maxV = versions.length ? Math.max(...versions) : 0;
  const nextV = maxV + 1;

  // 4. 版本校验：若调用方传版本，必须等于 nextV
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

  // 5. 候选校验（迁移 + 发布校验，逻辑来自 contract.ts 唯一源）
  const migrated = migrateHardGuardrails(input.hard_guardrails || []);
  const candidate = { hard_guardrails: migrated, tracks: input.tracks, decision_rules: input.decision_rules };
  const { valid, errors } = validatePolicyForPublish(candidate);
  if (!valid) {
    return { ok: false, status: "validation_failed", http_status: 400, errors, next_version: nextV };
  }

  const now = new Date().toISOString();

  // 6. 创建暂存（draft）
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

  // 7. post-create 乐观去重（平台无复合唯一索引的并发兜底）
  // 7a. 同 key 并发：存在更早的同 key 记录 → 本请求认负，删除自身，返回 winner
  try {
    const byKey = await ops.recheckByIdempotencyKey(clinic_id, key);
    const rival = byKey.find((r: any) => r.id !== staging.id && ts(r.created_date) < ts(staging.created_date));
    if (rival) {
      await ops.deleteStaging(staging.id);
      return { ok: true, status: "idempotent", http_status: 200, policy: rival, policy_id: rival.id, idempotent: true };
    }
  } catch (e: any) {
    await ops.deleteStaging(staging.id).catch(() => {});
    return { ok: false, status: "publish_failed", http_status: 500, error: "幂等去重检查失败：" + e.message, next_version: nextV };
  }
  // 7b. 同版本并发：存在更早的同版本记录 → 认负，删除自身，返回 version_conflict + winner
  try {
    const byVer = await ops.recheckByVersion(clinic_id, nextV);
    const rival = byVer.find((r: any) => r.id !== staging.id && ts(r.created_date) < ts(staging.created_date));
    if (rival) {
      await ops.deleteStaging(staging.id);
      return {
        ok: false,
        status: "version_conflict",
        http_status: 409,
        error: "并发版本冲突：另一请求已创建该版本",
        next_version: nextV,
        policy: rival,
        policy_id: rival.id,
      };
    }
  } catch (e: any) {
    await ops.deleteStaging(staging.id).catch(() => {});
    return { ok: false, status: "publish_failed", http_status: 500, error: "版本去重检查失败：" + e.message, next_version: nextV };
  }

  // 8. 快照旧 published + config active（供补偿恢复）
  const oldPublished = await ops.findPublished(clinic_id);
  const oldSnap = oldPublished.map((o: any) => ({ id: o.id, retired_at: o.retired_at ?? null }));
  const cfg = await ops.findConfig(clinic_id);
  const originalActive = cfg?.active_policy_version ?? null;

  // 9. 退役旧 published（逐条；中途失败触发补偿，仅恢复本次实际被修改的记录）
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
        stagingId: staging.id,
        failedStage: "retire@" + i,
        reason: "退役第 " + i + " 条失败：" + e.message,
      });
      return finishFailure(comp, "退役旧版本失败：" + e.message, nextV);
    }
  }

  // 10. config 必须存在
  if (!cfg) {
    const comp = await compensate(ops, {
      oldSnap,
      retiredIdsAlready: retiredIds,
      cfgId: null,
      originalActive,
      stagingId: staging.id,
      failedStage: "config_missing",
      reason: "ClinicConfig 不存在",
    });
    return finishFailure(comp, "ClinicConfig 不存在", nextV);
  }

  // 11. 更新 config.active_policy_version
  try {
    await ops.updateConfigActive(cfg.id, nextV);
  } catch (e: any) {
    const comp = await compensate(ops, {
      oldSnap,
      retiredIdsAlready: retiredIds,
      cfgId: cfg.id,
      originalActive,
      stagingId: staging.id,
      failedStage: "config_update",
      reason: "ClinicConfig 更新失败：" + e.message,
    });
    return finishFailure(comp, "ClinicConfig 更新失败：" + e.message, nextV);
  }

  // 12. 标记暂存为 published（最后一步，全部成功后）
  let published: any;
  try {
    published = await ops.markPublished(staging.id, now, user_id);
  } catch (e: any) {
    const comp = await compensate(ops, {
      oldSnap,
      retiredIdsAlready: retiredIds,
      cfgId: cfg.id,
      originalActive,
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

  // 恢复本次实际被退役的旧 published（逐条；任一失败记录到 reconciliation）
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

  // 恢复 config（若本次已更新过）
  if (args.cfgId && args.originalActive !== undefined && args.originalActive !== null) {
    try {
      await ops.restoreConfigActive(args.cfgId, args.originalActive);
      report.config_restored = true;
    } catch (e: any) {
      report.config_restore_failed = true;
      report.reconciliation.push({ stage: "restore_config", detail: e.message });
      report.succeeded = false;
    }
  } else if (args.cfgId) {
    // config 未被本次更新（如 retire 失败时），无需恢复
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