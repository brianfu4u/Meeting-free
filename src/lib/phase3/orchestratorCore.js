/**
 * Clinic OS Phase 3 — Composition Runtime Orchestrator Core (Batch 2A)
 *
 * 纯函数 + 依赖注入，禁止调用 base44 SDK / Entity / LLM / 任何 I/O。
 * 本模块仅生成可持久化的 descriptor 与结构化判定结果，不执行任何副作用，
 * 不修改任何现有文件语义，不创建后端函数。
 *
 * 设计依据：
 *  - 复用 Phase 3 contract.canPerform / assertAttachCompleteness / 幂等键构造器；
 *  - 不向 CompositionRun 反向写 hypothesis_ids（关系宿主为 WorkflowHypothesis.composition_run_id）；
 *  - AI 仅生成假设，不自动选择/提交/关闭/修改 Workflow 权威状态；
 *  - manager dispatch 仅生成 AttentionItem descriptor，不产生 ManagerDecision / CommitIntent / Snapshot 写入。
 */

import {
  canPerform,
  assertAttachCompleteness,
  computeRunIdempotencyKey,
  PHASE3_CONTRACT_VERSION,
} from "./contract";

// ─────────────────────────────────────────────────────────────────────────
// 1. 权限判定
// ─────────────────────────────────────────────────────────────────────────
/**
 * 授权判定：复用 Phase 3 canPerform。
 * clinicId 缺失立即拒绝（租户隔离前置条件）。
 * staff 允许 interpret/run/query/listRuns，禁止 commit。
 * @returns {{ ok: boolean, reason?: string, action?: string, role?: string, clinicId?: string }}
 */
export function authorizeAction({ action, role, clinicId } = {}) {
  if (!clinicId) return { ok: false, reason: "missing_clinic_id" };
  if (!action) return { ok: false, reason: "missing_action" };
  if (!role) return { ok: false, reason: "missing_role" };
  if (!canPerform(action, role)) {
    return { ok: false, reason: "action_not_permitted", action, role };
  }
  return { ok: true, action, role, clinicId };
}

// ─────────────────────────────────────────────────────────────────────────
// 2. 租户作用域校验
// ─────────────────────────────────────────────────────────────────────────
/**
 * 校验所有传入对象的 clinic_id 与授权 clinicId 一致。
 * 任一对象缺失 clinic_id 或跨租户 → 立即返回结构化阻断。
 * 空对象跳过（允许 undefined 占位）。
 * @returns {{ ok: boolean, reason?: string, offendingIndex?: number }}
 */
export function assertTenantScope(clinicId, ...objects) {
  if (!clinicId) return { ok: false, reason: "missing_clinic_id" };
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i];
    if (o == null) continue;
    if (typeof o !== "object") continue;
    if (o.clinic_id == null || o.clinic_id === "") {
      return { ok: false, reason: "object_missing_tenant", offendingIndex: i };
    }
    if (o.clinic_id !== clinicId) {
      return { ok: false, reason: "object_cross_tenant", offendingIndex: i };
    }
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────
// 3. CompositionRun descriptor
// ─────────────────────────────────────────────────────────────────────────
/**
 * 构造 CompositionRun 持久化 descriptor。
 * 必须包含 clinic、trigger、cutoff、policy/contract/prompt/model version、run 幂等键。
 * 禁止包含 hypothesis_ids（关系宿主为 WorkflowHypothesis.composition_run_id）。
 *
 * @param {object} input
 *   clinicId, businessDate, slot, triggerType, cutoffEventSeq,
 *   policyVersion, promptVersion, modelVersion,
 *   [contractVersion], [generatedAt]
 * @returns {object} CompositionRun descriptor
 */
export function buildRunDescriptor(input) {
  if (!input || typeof input !== "object") {
    throw new Error("buildRunDescriptor: input required");
  }
  const {
    clinicId,
    businessDate,
    slot,
    triggerType,
    cutoffEventSeq,
    policyVersion,
    promptVersion,
    modelVersion,
    contractVersion,
    generatedAt,
  } = input;

  if (!clinicId) throw new Error("buildRunDescriptor: clinicId required");
  if (!businessDate) throw new Error("buildRunDescriptor: businessDate required");
  if (!slot) throw new Error("buildRunDescriptor: slot required");
  if (!triggerType) throw new Error("buildRunDescriptor: triggerType required");
  if (cutoffEventSeq == null) throw new Error("buildRunDescriptor: cutoffEventSeq required");
  if (policyVersion == null) throw new Error("buildRunDescriptor: policyVersion required");
  if (!promptVersion) throw new Error("buildRunDescriptor: promptVersion required");
  if (!modelVersion) throw new Error("buildRunDescriptor: modelVersion required");

  const idempotency_key = computeRunIdempotencyKey({
    clinicId,
    businessDate,
    slot,
    policyVersion,
    cutoffEventSeq,
  });

  return {
    clinic_id: clinicId,
    business_date: businessDate,
    slot,
    trigger_type: triggerType,
    cutoff_event_seq: cutoffEventSeq,
    cutoff_ingested_at: null,
    policy_version: policyVersion,
    prompt_version: promptVersion,
    model_version: modelVersion,
    contract_version: contractVersion ?? PHASE3_CONTRACT_VERSION,
    run_started_at: generatedAt ?? null,
    run_finished_at: null,
    status: "pending",
    idempotency_key,
    proposals_generated: 0,
    artifact_ids_processed: [],
    error_message: null,
    // 显式不包含 hypothesis_ids
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 4. WorkflowHypothesis descriptors
// ─────────────────────────────────────────────────────────────────────────
/**
 * 将 Assembly/Guardrail 输出的每条候选假设转换为独立 WorkflowHypothesis descriptor。
 * - 每条携带 composition_run_id（关系宿主）；
 * - attach 必须通过 assertAttachCompleteness，否则记录 validation_block 并置 rejected；
 * - 保存 snapshot id/version、阻断原因、排序依据(rank)、状态。
 *
 * @param {object} input
 *   compositionRunId, clinicId, policyVersion,
 *   promptVersion, modelVersion,
 *   hypotheses: Array<{ workflow_hypothesis_id, composition_type, workflow_family,
 *     target_workflow_id, target_snapshot_id, target_snapshot_version,
 *     ordered_artifact_ids, reasoning_tracks, unsupported_assumptions,
 *     contradictions, unexplained_artifact_ids, source_proposal_id, rank }>,
 *   guardrailBlocks?: Array<{ rule_code }>  // 来自 guardrailValidator 的阻断项
 * @returns {Array<object>} hypothesis descriptors
 */
export function buildHypothesisDescriptors(input) {
  if (!input || typeof input !== "object") {
    throw new Error("buildHypothesisDescriptors: input required");
  }
  const {
    compositionRunId,
    clinicId,
    policyVersion,
    promptVersion,
    modelVersion,
    hypotheses,
    guardrailBlocks,
  } = input;

  if (!compositionRunId) throw new Error("buildHypothesisDescriptors: compositionRunId required");
  if (!clinicId) throw new Error("buildHypothesisDescriptors: clinicId required");
  if (!Array.isArray(hypotheses)) throw new Error("buildHypothesisDescriptors: hypotheses required");

  const baseBlocks = Array.isArray(guardrailBlocks) ? guardrailBlocks : [];

  return hypotheses.map((h) => {
    if (!h || typeof h !== "object") {
      throw new Error("buildHypothesisDescriptors: hypothesis must be object");
    }

    const attachCheck = assertAttachCompleteness(h);
    const validation_blocks = [...baseBlocks];
    let status = "pending_review";

    if (!attachCheck.ok) {
      validation_blocks.push({ rule_code: attachCheck.reason });
      status = "rejected";
    }

    return {
      clinic_id: clinicId,
      composition_run_id: compositionRunId,
      source_proposal_id: h.source_proposal_id || null,
      workflow_hypothesis_id: h.workflow_hypothesis_id,
      composition_type: h.composition_type || null,
      workflow_family: h.workflow_family || null,
      target_workflow_id: h.target_workflow_id || null,
      target_snapshot_id: h.target_snapshot_id || null,
      target_snapshot_version: h.target_snapshot_version ?? null,
      ordered_artifact_ids: Array.isArray(h.ordered_artifact_ids) ? [...h.ordered_artifact_ids] : [],
      reasoning_tracks: h.reasoning_tracks || {},
      unsupported_assumptions: Array.isArray(h.unsupported_assumptions) ? [...h.unsupported_assumptions] : [],
      contradictions: Array.isArray(h.contradictions) ? [...h.contradictions] : [],
      unexplained_artifact_ids: Array.isArray(h.unexplained_artifact_ids) ? [...h.unexplained_artifact_ids] : [],
      validation_blocks,
      rank: typeof h.rank === "number" ? h.rank : null,
      alternative_group: h.alternative_group || null,
      status,
      policy_version: policyVersion ?? null,
      prompt_version: promptVersion || null,
      model_version: modelVersion || null,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────
// 5. 派发判定（人工审核边界）
// ─────────────────────────────────────────────────────────────────────────
/**
 * 从 Guardrail 结果推导是否需要店长派发。
 * validationIssues 非空时：
 *   - needsManagerDispatch = true
 *   - bestHypothesisId = null（禁止自动 best）
 * 禁止产生任何 ManagerDecision descriptor。
 * @returns {{ needsManagerDispatch: boolean, bestHypothesisId: string|null }}
 */
export function deriveDispatchDecision(guardrailResult) {
  const issues = guardrailResult?.validationIssues;
  const hasIssues = Array.isArray(issues) && issues.length > 0;

  if (hasIssues) {
    return { needsManagerDispatch: true, bestHypothesisId: null };
  }

  return {
    needsManagerDispatch: Boolean(guardrailResult?.needsManagerDispatch),
    bestHypothesisId: guardrailResult?.bestHypothesisId ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 6. AttentionItem descriptor（manager dispatch）
// ─────────────────────────────────────────────────────────────────────────
/**
 * 仅在 needsManagerDispatch=true 时生成 AttentionItem descriptor。
 * 只保存 run / hypothesis / artifact / fact-card 引用。
 * 不生成 Workflow、Snapshot、ManagerDecision、CommitIntent 写入。
 *
 * @param {object} input
 *   needsManagerDispatch (boolean) — 必须为 true 才生成
 *   clinicId, compositionRunId, policyVersion,
 *   promptVersion, modelVersion,
 *   hypothesisIds: string[],        // 所有候选
 *   bestHypothesisId: string|null,
 *   artifactIds: string[],
 *   evidenceFactCardIds: string[],
 *   attentionType?: string,         // 默认 evidence_missing
 *   urgency?: string,               // 默认 yellow
 *   generatedAt?: string
 * @returns {object|null} AttentionItem descriptor，或 null（dispatch 不需要时）
 */
export function buildAttentionDescriptor(input) {
  if (!input || typeof input !== "object") {
    throw new Error("buildAttentionDescriptor: input required");
  }
  if (!input.needsManagerDispatch) return null;

  const {
    clinicId,
    compositionRunId,
    policyVersion,
    promptVersion,
    modelVersion,
    hypothesisIds,
    bestHypothesisId,
    artifactIds,
    evidenceFactCardIds,
    attentionType,
    urgency,
    generatedAt,
  } = input;

  if (!clinicId) throw new Error("buildAttentionDescriptor: clinicId required");
  if (!compositionRunId) throw new Error("buildAttentionDescriptor: compositionRunId required");

  return {
    clinic_id: clinicId,
    attention_type: attentionType || "evidence_missing",
    urgency: urgency || "yellow",
    title: null, // 由上层填充（≤20 字）
    reasoning: null,
    evidence_fact_card_ids: Array.isArray(evidenceFactCardIds) ? [...evidenceFactCardIds] : [],
    artifact_ids: Array.isArray(artifactIds) ? [...artifactIds] : [],
    audit_event_ids: [],
    recommendation: null,
    status: "open",
    manager_action: null,
    manager_note: null,
    task_id_created: null,
    decided_at: null,
    generated_at: generatedAt || null,
    reasoning_tracks: [],
    unsupported_assumptions: [],
    alternative_hypotheses: [],
    target_snapshot_id: null,
    policy_version: policyVersion ?? null,
    model_version: modelVersion || null,
    prompt_version: promptVersion || null,
    terminal_signal_detected: false,
    proposed_workflow_status: null,
    proposed_handoff_department: null,
    proposed_handoff_role: null,
    handoff_evidence_ids: [],
    source_proposal_id: null,
    shadow_mode_snapshot: true,
    composition_run_id: compositionRunId,
    selected_hypothesis_id: bestHypothesisId || null,
    committed_workflow_id: null,
    commit_outcome: null,
    hypothesis_ids: Array.isArray(hypothesisIds) ? [...hypothesisIds] : [],
    // 显式不包含任何 workflow / snapshot / manager_decision / commit_intent 写入字段
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 7. 运行失败 descriptor
// ─────────────────────────────────────────────────────────────────────────
/**
 * 构造稳定、可序列化、无敏感信息（stack/内部路径/凭证）的失败 descriptor。
 * @param {Error|{message:string,reason?:string}} error
 * @returns {{ status: "failed", error: { message: string, reason: string } }}
 */
export function buildRunFailure(error) {
  if (!error) {
    return { status: "failed", error: { message: "unknown_error", reason: "unknown" } };
  }
  const message =
    typeof error === "string"
      ? error
      : typeof error.message === "string"
        ? error.message
        : "unknown_error";
  const reason =
    (typeof error === "object" && error.reason) ||
    (typeof error === "object" && error.code) ||
    "runtime_error";
  return {
    status: "failed",
    error: {
      message: String(message),
      reason: String(reason),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 重新导出复用契约，便于编排层单一入口
// ─────────────────────────────────────────────────────────────────────────
export { canPerform, assertAttachCompleteness, computeRunIdempotencyKey, PHASE3_CONTRACT_VERSION };