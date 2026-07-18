/**
 * Clinic OS V10 — ScopedQuery：严格 Tenant 逻辑隔离的实体访问包装器
 *
 * 用法：
 *   前端：createScopedQuery(clinicId, base44.entities)
 *   后端：createScopedQuery(clinicId, base44.asServiceRole.entities)  // clinicId 必须来自服务端认证上下文
 *
 * 保证：
 *  - filter/updateMany/deleteMany 强制注入 clinic_id，空 query 不会跨 Tenant 操作；
 *  - create/bulkCreate 强制注入 clinic_id，并拒绝 payload 自带不一致 clinic_id；
 *  - get/update/delete 先校验记录归属再操作；
 *  - 任何环节 clinic_id 不一致抛 TenantScopeError。
 */

import {
  TenantScopeError,
  assertSameTenant,
  assertCollectionTenant,
} from "./tenantContext";

export function createScopedQuery(clinicId, entityApi) {
  if (!clinicId) throw new TenantScopeError("createScopedQuery requires clinicId");
  if (!entityApi) throw new TenantScopeError("createScopedQuery requires entityApi");

  const scopeFilter = (query = {}) => ({ ...query, clinic_id: clinicId });

  return {
    clinicId,

    list(entity, sort, limit) {
      return entityApi[entity].list(sort, limit);
    },

    filter(entity, query = {}, sort, limit) {
      return entityApi[entity].filter(scopeFilter(query), sort, limit);
    },

    async get(entity, id) {
      const record = await entityApi[entity].get(id);
      if (record && record.clinic_id && record.clinic_id !== clinicId) {
        throw new TenantScopeError(`get ${entity}(${id}): tenant mismatch`);
      }
      return record;
    },

    create(entity, data = {}) {
      assertSameTenant(clinicId, data, `create ${entity}`);
      return entityApi[entity].create({ ...data, clinic_id: clinicId });
    },

    bulkCreate(entity, items = []) {
      assertCollectionTenant(clinicId, items, `bulkCreate ${entity}`);
      return entityApi[entity].bulkCreate(
        items.map((d) => ({ ...d, clinic_id: clinicId }))
      );
    },

    async update(entity, id, patch = {}) {
      const record = await entityApi[entity].get(id);
      if (!record) throw new TenantScopeError(`update ${entity}(${id}): not found`);
      if (record.clinic_id !== clinicId) {
        throw new TenantScopeError(`update ${entity}(${id}): tenant mismatch`);
      }
      if (patch.clinic_id && patch.clinic_id !== clinicId) {
        throw new TenantScopeError(`update ${entity}(${id}): patch tenant mismatch`);
      }
      return entityApi[entity].update(id, { ...patch, clinic_id: clinicId });
    },

    async delete(entity, id) {
      const record = await entityApi[entity].get(id);
      if (!record) throw new TenantScopeError(`delete ${entity}(${id}): not found`);
      if (record.clinic_id !== clinicId) {
        throw new TenantScopeError(`delete ${entity}(${id}): tenant mismatch`);
      }
      return entityApi[entity].delete(id);
    },

    updateMany(entity, query = {}, update) {
      return entityApi[entity].updateMany(scopeFilter(query), update);
    },

    deleteMany(entity, query = {}) {
      return entityApi[entity].deleteMany(scopeFilter(query));
    },
  };
}