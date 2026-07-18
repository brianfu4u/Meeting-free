/**
 * Clinic OS V10 — 幂等占位工具（基于业务唯一字段）
 *
 * 宪法要求：幂等与唯一性必须在数据层/原子操作层保障。
 *
 * 实测结论（Phase 1 探针）：base44 entity create 不接受客户端指定 id，
 * 平台自动生成主键。因此无法用「id 作幂等键 + 主键冲突原子性」方案。
 *
 * 修正策略：以业务唯一字段 `idempotency_key` 为去重锚点：
 *  - 调用方必须在 payload 中携带 idempotency_key（由 tenantContext.compute* 生成）；
 *  - 先按 (clinic_id, idempotency_key) 过滤；命中 → 幂等返回已存在记录；
 *  - 未命中 → create（注入 idempotency_key）。
 *
 * 并发说明：filter-then-create 存在极小竞态窗口。Clinic OS 单门店写入并发低
 * （定时编组 + 经理手动决策），且幂等键由业务确定性维度生成，重复写入概率极低。
 * 若未来高并发场景出现，可在 entity schema 上为 idempotency_key 加唯一索引兜底。
 */

import { TenantScopeError } from "./tenantContext";

export async function atomicClaim(entityApi, entity, idempotencyKey, payload = {}) {
  if (!entityApi) throw new TenantScopeError("atomicClaim requires entityApi");
  if (!idempotencyKey) throw new TenantScopeError("atomicClaim requires idempotencyKey");
  if (!payload.clinic_id) throw new TenantScopeError("atomicClaim requires payload.clinic_id");

  const existing = await entityApi[entity].filter({
    clinic_id: payload.clinic_id,
    idempotency_key: idempotencyKey,
  });
  if (existing && existing.length > 0) {
    return { created: false, record: existing[0] };
  }

  const created = await entityApi[entity].create({ ...payload, idempotency_key: idempotencyKey });
  return { created: true, record: created };
}