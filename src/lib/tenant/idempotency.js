/**
 * Clinic OS V10 — 原子幂等占位工具
 *
 * 宪法要求：幂等与唯一性必须在数据层/原子操作层保障，不得仅依赖"先查询后创建"。
 *
 * 实现策略：以幂等键作为记录 id 进行 create（主键唯一）。
 *  - 成功 → 本次占位，返回 { created: true, record };
 *  - 冲突 → 已有记录，返回 { created: false, record }（幂等返回）。
 *
 * 说明：base44 entity create 若支持指定 id，则主键冲突天然原子；若不支持，
 * 由调用方传入的 entityApi 决定行为，本工具仅保证"创建或返回已存在"语义。
 */

import { TenantScopeError, assertSameTenant } from "./tenantContext";

export async function atomicClaim(entityApi, entity, idempotencyKey, payload = {}) {
  if (!entityApi) throw new TenantScopeError("atomicClaim requires entityApi");
  if (!idempotencyKey) throw new TenantScopeError("atomicClaim requires idempotencyKey");
  assertSameTenant(payload.clinic_id, payload, `atomicClaim ${entity}`);

  try {
    const created = await entityApi[entity].create({ ...payload, id: idempotencyKey });
    return { created: true, record: created };
  } catch (err) {
    // 主键冲突 / 已存在 → 幂等返回
    const existing = await entityApi[entity].get(idempotencyKey);
    if (existing) return { created: false, record: existing };
    throw err;
  }
}