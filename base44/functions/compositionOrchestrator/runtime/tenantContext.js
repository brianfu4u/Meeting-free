// GENERATED_PHASE2_MIRROR source=src/lib/tenant/tenantContext.js blob=b7504dcf1c9fb86ff2ec30bc4f0b9a439cf4a82c
// Do not edit manually; parity test pins the canonical source blob.
/**
 * Clinic OS V10 — Tenant 逻辑隔离上下文（严格 Tenant 逻辑隔离）
 *
 * 宪法级约束：
 *  - clinic_id 必须来自服务端认证上下文，禁止客户端自行决定 Tenant；
 *  - 所有读/写/缓存/文件存储/Prompt Context 必须经 Tenant Scope 校验；
 *  - 跨 Tenant 注入（payload 内嵌对象 clinic_id 不一致）一律抛 TenantScopeError。
 *
 * 本模块为纯函数，前后端通用，不依赖 base44 SDK，便于单元测试。
 */

export class TenantScopeError extends Error {
  constructor(message) {
    super(message);
    this.name = "TenantScopeError";
    this.code = "TENANT_SCOPE_VIOLATION";
  }
}

/**
 * 校验单个对象 clinic_id 与授权 Tenant 一致。
 * 对象未声明 clinic_id 视为待补全（由 ScopedQuery 注入），不报错。
 */
export function assertSameTenant(clinicId, obj, label = "object") {
  if (!clinicId) throw new TenantScopeError(`assertSameTenant: clinicId required`);
  if (obj == null || typeof obj !== "object") return;
  if (obj.clinic_id !== undefined && obj.clinic_id !== null && obj.clinic_id !== clinicId) {
    throw new TenantScopeError(
      `Tenant mismatch on ${label}: expected "${clinicId}", got "${obj.clinic_id}"`
    );
  }
}

/**
 * 校验多个对象（含嵌套 Artifact/FactCard/Snapshot 列表）clinic_id 一致。
 * 用于 Agent 输入契约的深度 Tenant 校验，防御跨 Tenant 注入攻击。
 */
export function assertTenantScope(clinicId, ...objects) {
  if (!clinicId) throw new TenantScopeError("assertTenantScope: clinicId required");
  objects.forEach((o, i) => assertSameTenant(clinicId, o, `arg[${i}]`));
}

/**
 * 校验集合内每个元素 clinic_id 一致。
 */
export function assertCollectionTenant(clinicId, collection, label = "collection") {
  if (!Array.isArray(collection)) return;
  collection.forEach((o, i) => assertSameTenant(clinicId, o, `${label}[${i}]`));
}

/**
 * 深度校验：遍历 payload 内常见嵌套数组字段（artifacts/fact_cards/snapshots）。
 * 防 Agent 输入被注入跨 Tenant 数据。
 */
export function assertDeepTenantScope(clinicId, payload) {
  if (!clinicId) throw new TenantScopeError("assertDeepTenantScope: clinicId required");
  if (!payload || typeof payload !== "object") return;
  assertSameTenant(clinicId, payload, "payload");
  const nestedKeys = ["artifacts", "fact_cards", "evidence_fact_cards", "snapshots", "items", "candidates"];
  nestedKeys.forEach((k) => {
    if (Array.isArray(payload[k])) assertCollectionTenant(clinicId, payload[k], `payload.${k}`);
  });
}

/**
 * 构造 Tenant 命名空间的缓存 Key / 文件存储 Key。
 * 防止跨 Tenant 数据串读。
 */
export function buildScopeKey(clinicId, key) {
  if (!clinicId) throw new TenantScopeError("buildScopeKey: clinicId required");
  return `tenant:${clinicId}:${key}`;
}

/**
 * CompositionRun 幂等键：clinic_id+business_date+slot+policy_version+cutoff_event_seq
 */
export function computeRunIdempotencyKey({ clinicId, businessDate, slot, policyVersion, cutoffEventSeq }) {
  if (!clinicId || !businessDate || !slot || policyVersion == null || cutoffEventSeq == null) {
    throw new TenantScopeError("computeRunIdempotencyKey: missing required fields");
  }
  return [clinicId, businessDate, slot, `pv${policyVersion}`, `seq${cutoffEventSeq}`].join("::");
}

/**
 * Proposal 幂等键：clinic_id+sorted_artifact_ids_hash+policy_version
 * 注意 artifact_ids 排序后再哈希，保证顺序无关。
 */
export function computeProposalIdempotencyKey({ clinicId, sortedArtifactIds, policyVersion }) {
  if (!clinicId || !Array.isArray(sortedArtifactIds) || policyVersion == null) {
    throw new TenantScopeError("computeProposalIdempotencyKey: missing required fields");
  }
  const sorted = [...sortedArtifactIds].sort().join(",");
  return [clinicId, `art:${sorted}`, `pv${policyVersion}`].join("::");
}

/**
 * Manager 执行幂等键：manager_decision_id+proposal_id
 */
export function computeManagerExecutionIdempotencyKey({ managerDecisionId, proposalId }) {
  if (!managerDecisionId || !proposalId) {
    throw new TenantScopeError("computeManagerExecutionIdempotencyKey: missing required fields");
  }
  return `exec::${managerDecisionId}::${proposalId}`;
}