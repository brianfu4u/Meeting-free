// Phase 5 解析站 → Agent 报到契约（两段式异步）
// 纯数据 + 纯函数模块，供契约测试与 Agent 工程师共享。
// 不依赖任何服务端运行时；不修改 Phase 1–4 推理规则。
//
// 权威来源：docs/PHASE5_INGESTION_AGENT_HANDOFF.md

export const HANDOFF_VERSION = "phase5.handoff.v1";

// ── event_gene_code ────────────────────────────────────────────
export const EVENT_GENE_CODE_FORMAT = "{clinic_id}/{business_date}/{department}/{staff_short_id}/{fragment_type}/{seq}";

// 硬性使用策略：仅展示/日志/追溯；不得解析作为业务判断依据。
export const EVENT_GENE_CODE_USAGE_POLICY = Object.freeze({
  allowed: ["display", "log_search", "human_traceability"],
  forbidden: ["grouping_decision", "business_logic_parse"],
  rule: "Agent 编组判断必须使用结构化字段，不得解析 event_gene_code 字符串作为业务判断依据。",
});

function padSeq(seq) {
  const n = Number(seq);
  if (!Number.isInteger(n) || n < 0) return "0000";
  return String(n).padStart(4, "0");
}

function shortStaffId(staffId) {
  if (typeof staffId !== "string" || !staffId) return "unknown";
  return staffId.replace(/[^a-zA-Z0-9]/g, "").slice(-6).toLowerCase() || "unknown";
}

export function formatEventGeneCode(parts) {
  const p = parts || {};
  const clinic = typeof p.clinic_id === "string" && p.clinic_id ? p.clinic_id : "unknown";
  const date = typeof p.business_date === "string" && p.business_date ? p.business_date : "unknown";
  const dept = typeof p.department === "string" && p.department ? p.department : "unknown";
  const staff = shortStaffId(p.staff_id);
  const ftype = typeof p.fragment_type === "string" && p.fragment_type ? p.fragment_type : "unknown";
  return `${clinic}/${date}/${dept}/${staff}/${ftype}/${padSeq(p.seq)}`;
}

export const GENE_CODE_REGEX = /^[a-zA-Z0-9_-]+\/\d{4}-\d{2}-\d{2}\/[a-z_]+\/[a-z0-9]{1,6}\/(image|document|audio|text)\/\d{4}$/;

// ── 取货范围（约束 2）────────────────────────────────────────────
export const AGENT_PICKUP_FILTER_FIELDS = Object.freeze([
  "clinic_id",
  "assembly_eligible",
  "alignment_status",
  "ingestion_seq",
]);

export const PICKUP_REQUIRED_ALIGNMENT = "aligned";

// 不进入编组池的对齐状态（约束 4）
export const EXCLUDED_ALIGNMENT_STATUSES = Object.freeze([
  "needs_clarification",
  "failed",
  "rejected",
]);

/**
 * 判定一张 FactCard 是否进入本轮 Agent 取货集合。
 * 必须同时满足约束 2 全部条件。
 *
 * @param {object} input
 * @param {object} input.factCard   EvidenceFactCard 记录
 * @param {object} input.artifact  关联 Artifact 记录（提供 ingestion_seq）
 * @param {string} input.clinicId  本轮诊所
 * @param {number} input.cutoffEventSeq 本轮 cutoff 水位
 * @param {string[]} input.completedArtifactIds 已成功完成 run 的处理集合
 * @returns {boolean}
 */
export function isPickupEligible(input) {
  const { factCard, artifact, clinicId, cutoffEventSeq, completedArtifactIds } = input || {};
  if (!factCard || typeof factCard !== "object") return false;
  // 1. 租户隔离
  if (factCard.clinic_id !== clinicId) return false;
  // 2. 取货资格
  if (factCard.assembly_eligible !== true) return false;
  // 3. 对齐状态门槛
  if (factCard.alignment_status !== PICKUP_REQUIRED_ALIGNMENT) return false;
  // 4. cutoff 水位（Artifact.ingestion_seq <= run.cutoff_event_seq）
  const seq = Number(artifact?.ingestion_seq);
  if (!Number.isFinite(seq)) return false;
  if (Number.isFinite(Number(cutoffEventSeq)) && seq > Number(cutoffEventSeq)) return false;
  // 5. 不属于已完成 run 的处理集合
  const artifactId = artifact?.id || factCard.artifact_id;
  const completed = Array.isArray(completedArtifactIds) ? completedArtifactIds : [];
  if (artifactId && completed.includes(String(artifactId))) return false;
  return true;
}

// ── 防重规则（约束 3）────────────────────────────────────────────
export const RUN_IDEMPOTENCY_RULES = Object.freeze({
  completed: "processed_no_repeat",
  running: "same_key_existing_run",
  pending: "same_key_existing_run",
  failed: "safe_retry",
});

/**
 * 按 run 结果分类防重行为。
 * @param {string} runStatus  CompositionRun.status
 * @returns {string|null} 防重策略码
 */
export function classifyRunForIdempotency(runStatus) {
  return RUN_IDEMPOTENCY_RULES[runStatus] || null;
}

// ── 溯源事件 ID 语义分离（约束 6）─────────────────────────────────
export const EVENT_ID_SEMANTICS = Object.freeze({
  source_event_id: {
    meaning: "真实上游业务事件",
    nullable: true,
    usage: "回溯到业务发生时刻上下文",
  },
  ingestion_event_id: {
    meaning: "本次上传/采集审计事件",
    nullable: false,
    usage: "追溯本次入站操作",
  },
  grouping_key: false, // 两者均不得作为编组唯一依据
});

export function isEventIdAGroupingKey() {
  return false;
}

// ── 消费标记约束（约束 5）─────────────────────────────────────────
export const CONSUMPTION_MARKER = Object.freeze({
  allowed: "CompositionRun.artifact_ids_processed + cutoff + policy_version + idempotency_key",
  forbidden: "EvidenceFactCard.assembly_eligible=false",
});