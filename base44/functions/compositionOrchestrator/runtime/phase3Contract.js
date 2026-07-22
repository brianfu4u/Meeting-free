// GENERATED_PHASE3_MIRROR source=src/lib/phase3/contract.js blob=e9b901be89c170d34ac02b55a7e432a3d1509c58
// Do not edit manually; parity test pins the canonical source blob.
/**
 * Clinic OS Phase 3 — 契约与状态机（纯逻辑，前后端通用，不依赖 base44 SDK）
 *
 * 本模块为 Phase 3 新增的权威契约源：状态机、不变量、关系约束。
 * 禁止修改 Phase 2 契约（base44/functions/guessPolicyService/contract.ts、
 * src/lib/composition/*、src/lib/tenant/*）。Phase 3 复用 Phase 2 幂等键构造器。
 *
 * 设计依据（用户 Batch 1 决策 A–E）：
 *  A. 不可变快照：提交创建 snapshot_version+1 的新 Snapshot，CAS 更新 Workflow 指针。
 *  B. 无跨 Entity 事务 → Saga/WorkflowCommitIntent + reconciliation。
 *  C. 不重复存储可查询关系：WorkflowHypothesis.composition_run_id 为关系宿主，
 *     CompositionRun 不反向存 hypothesis_ids；AttentionItem 仅存 selected_hypothesis_id。
 *  D. 权限：clinic_id 来自 user.id→Staff/ClinicConfig 授权关系，admin 才能 commit。
 *  E. pipelineEngine legacy 不动；compositionOrchestrator 为唯一生产入口（Batch 2+）。
 */

import {
  computeRunIdempotencyKey,
  computeProposalIdempotencyKey,
  computeManagerExecutionIdempotencyKey,
} from "./tenantContext.js";

// ─────────────────────────────────────────────────────────────────────────
// 契约版本
// ─────────────────────────────────────────────────────────────────────────
export const PHASE3_CONTRACT_VERSION = 1;

// ─────────────────────────────────────────────────────────────────────────
// 状态机定义
// ─────────────────────────────────────────────────────────────────────────

/** Workflow 权威状态机（驱动来自店长审核提交，AI 不得直接流转） */
export const WORKFLOW_STATUSES = ["active", "stalled", "pending_manager_closure", "closed"];
export const WORKFLOW_TRANSITIONS = {
  active: ["stalled", "pending_manager_closure", "closed"],
  stalled: ["active", "pending_manager_closure", "closed"],
  pending_manager_closure: ["closed", "active"],
  closed: [], // 终态
};

/** WorkflowHypothesis 状态机 */
export const HYPOTHESIS_STATUSES = [
  "pending_review", "selected", "dispatched", "committed", "stale", "rejected", "ignored",
];
export const HYPOTHESIS_TRANSITIONS = {
  pending_review: ["selected", "stale", "rejected", "ignored"],
  selected: ["dispatched", "stale", "rejected", "ignored"],
  dispatched: ["committed", "stale"],
  committed: [], // 终态
  stale: [], // 终态
  rejected: [], // 终态
  ignored: [], // 终态
};

/** WorkflowCommitIntent Saga 状态机（替代跨 Entity 事务声明） */
export const COMMIT_INTENT_STATUSES = [
  "pending", "committing", "committed", "stale", "compensation_failed",
];
export const COMMIT_INTENT_TRANSITIONS = {
  pending: ["committing", "stale"],
  committing: ["committed", "stale", "compensation_failed"],
  committed: [], // 终态
  stale: [], // 终态
  compensation_failed: ["pending"], // 允许幂等重放补偿
};

/** AttentionItem 提交结果 */
export const COMMIT_OUTCOMES = ["committed", "stale", "failed"];

/** ManagerDecision.target_type 扩展集 */
export const MANAGER_TARGET_TYPES = ["task", "alert", "staff_request", "hypothesis", "proposal", "artifact_exception"];

/** 主体识别质量（subject_conflict 硬护栏仅 high 参与） */
export const SUBJECT_QUALITIES = ["high", "medium", "low", "uncertain"];

/** 编组类型 */
export const COMPOSITION_TYPES = ["attach", "new_train", "orphan"];

// ─────────────────────────────────────────────────────────────────────────
// 状态机校验（纯函数）
// ─────────────────────────────────────────────────────────────────────────
export function validateTransition(machine, from, to) {
  const allowed = machine[from];
  if (!Array.isArray(allowed)) {
    throw new Error(`validateTransition: 未知源状态 ${from}`);
  }
  if (!allowed.includes(to)) {
    throw new Error(`非法状态流转：${from} → ${to}`);
  }
  return true;
}

export const transitionMachines = {
  workflow: WORKFLOW_TRANSITIONS,
  hypothesis: HYPOTHESIS_TRANSITIONS,
  commit_intent: COMMIT_INTENT_TRANSITIONS,
};

// ─────────────────────────────────────────────────────────────────────────
// 幂等键（复用 Phase 2 tenantContext，禁止重复实现）
// ─────────────────────────────────────────────────────────────────────────
export {
  computeRunIdempotencyKey,
  computeProposalIdempotencyKey,
  computeManagerExecutionIdempotencyKey,
};

// ─────────────────────────────────────────────────────────────────────────
// 关系不变量（纯校验，供后端编排与测试复用）
// ─────────────────────────────────────────────────────────────────────────

/**
 * 不可变快照提交不变量：提交时 expected 必须同时匹配 Workflow 指针。
 * @returns {{ ok: boolean, reason?: string }}
 */
export function assertSnapshotPointerMatch(workflow, expectedSnapshotId, expectedSnapshotVersion) {
  if (!workflow) return { ok: false, reason: "workflow 缺失" };
  if (workflow.current_snapshot_id !== expectedSnapshotId) {
    return { ok: false, reason: "stale_proposal_snapshot_id_mismatch" };
  }
  if (workflow.current_snapshot_version !== expectedSnapshotVersion) {
    return { ok: false, reason: "stale_proposal_version_mismatch" };
  }
  return { ok: true };
}

/**
 * attach 假设不变量：attach 必须同时携带 target_workflow_id/target_snapshot_id/target_snapshot_version。
 */
export function assertAttachCompleteness(hypothesis) {
  if (!hypothesis) return { ok: false, reason: "hypothesis 缺失" };
  if (hypothesis.composition_type !== "attach") return { ok: true };
  if (!hypothesis.target_workflow_id) return { ok: false, reason: "attach_without_target" };
  if (!hypothesis.target_snapshot_id) return { ok: false, reason: "attach_without_snapshot" };
  if (hypothesis.target_snapshot_version == null) return { ok: false, reason: "attach_without_snapshot_version" };
  return { ok: true };
}

/**
 * 租户一致性不变量：提交链路所有对象 clinic_id 必须与授权 clinic 一致。
 */
export function assertCommitTenantScope(clinicId, workflow, snapshot, hypothesis, intent) {
  const objs = { workflow, snapshot, hypothesis, intent };
  for (const [k, o] of Object.entries(objs)) {
    if (!o) continue;
    if (!o.clinic_id) return { ok: false, reason: `${k}_missing_tenant` };
    if (o.clinic_id !== clinicId) return { ok: false, reason: `${k}_cross_tenant` };
  }
  return { ok: true };
}

/**
 * 关系一致性：snapshot.workflow_id 必须等于 workflow.id（提交时校验）。
 */
export function assertSnapshotBelongsToWorkflow(snapshot, workflow) {
  if (!snapshot || !workflow) return { ok: false, reason: "缺失 snapshot 或 workflow" };
  if (snapshot.workflow_id !== workflow.id) {
    return { ok: false, reason: "snapshot_workflow_mismatch" };
  }
  return { ok: true };
}

/**
 * 关系一致性：intent.selected_hypothesis_id 必须等于 hypothesis.workflow_hypothesis_id。
 */
export function assertIntentHypothesisLink(intent, hypothesis) {
  if (!intent || !hypothesis) return { ok: false, reason: "缺失 intent 或 hypothesis" };
  if (intent.selected_hypothesis_id !== hypothesis.workflow_hypothesis_id) {
    return { ok: false, reason: "intent_hypothesis_link_mismatch" };
  }
  return { ok: true };
}

/**
 * 不重复存储约束（设计 C）：CompositionRun 不得反向存 hypothesis_ids（关系宿主为 WorkflowHypothesis.composition_run_id）。
 * 本函数供 schema 测试与编排器自检使用。
 */
export function assertNoReverseHypothesisArray(compositionRunSchema) {
  if (!compositionRunSchema || !compositionRunSchema.properties) return { ok: true };
  if ("hypothesis_ids" in compositionRunSchema.properties) {
    return { ok: false, reason: "CompositionRun 不得存 hypothesis_ids（关系宿主为 WorkflowHypothesis）" };
  }
  return { ok: true };
}

/**
 * 人工审核边界（决策 2）：禁止 auto ManagerDecision。
 * 编排器提交时 manager_id 必须为真实 user.id，不得为 "auto" / "system"。
 */
export function assertNoAutoManager(managerId) {
  if (!managerId) return { ok: false, reason: "manager_id 缺失" };
  if (managerId === "auto" || managerId === "system") {
    return { ok: false, reason: "禁止 auto/system ManagerDecision（Phase 3 一律人工审核）" };
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────
// 权限矩阵（决策 D）
// ─────────────────────────────────────────────────────────────────────────
export const ACTION_PERMISSIONS = {
  interpret: ["staff", "admin"],
  run: ["staff", "admin"],
  query: ["staff", "admin"],
  listRuns: ["staff", "admin"],
  review: ["admin"], // 仅店长可做人工审核决定
  commit: ["admin"], // 仅店长
};

export function canPerform(action, role) {
  const allowed = ACTION_PERMISSIONS[action];
  if (!allowed) return false;
  return allowed.includes(role);
}