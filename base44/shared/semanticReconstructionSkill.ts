// SemanticReconstructionSkill — Clinic OS V11 解析站 Skill
//
// 职责：接收非结构化 Artifact（车厢），执行语义重构，产出双通道 Payload：
//   通道 A（走马灯 / 快通道）：marquee_payload → 前端 EventStream 即时播放
//   通道 B（Agent 编组 / 慢通道）：agent_payload → assembly_eligible 触发定时取货
//
// 契约：车厢 ID（artifact_id）进站与出站保持不变，仅内容被解析填充。
// 纯数据 + 纯函数模块，不依赖服务端运行时；供 fragmentIngestionService 与契约测试共享。
// 不修改 Phase 1–4 推理规则。

export const SKILL_VERSION = "v11.skill.reconstruction.v1";

// ── 输入 ────────────────────────────────────────────────────────
// reconstruct({ artifact, aligned, extraction }) → ReconstructionResult
//   artifact: Artifact 记录（车厢本体，ID 不变）
//   aligned: alignment.ts 产出的对齐结果（fields / subject / workflow_family_hint / occurred_at ...）
//   extraction: adapter 产出的归一化文本/转写/证据片段
//
// ── 输出 ReconstructionResult ──────────────────────────────────
// {
//   status: "aligned" | "needs_clarification" | "rejected",
//   artifact_id: 不变,
//   marquee_payload: { label, urgency, timestamp, staff_hint, dept_hint, family_hint } | null,
//   agent_payload: { assembly_eligible, workflow_family_hint, subject_type, occurred_at, fact_card_descriptor } | null
// }

export const URGENCY_LEVELS = Object.freeze(["green", "yellow", "red"]);

const FAMILY_LABEL = {
  optometry: "验光",
  medical: "眼科诊疗",
  vision_training: "视觉训练",
  supplier: "供应商",
};

const DEPT_LABEL_FALLBACK = {
  outpatient: "门诊",
  refraction: "专科",
  diagnostics: "检查",
  surgery: "手术",
  nursing: "护理",
  front_desk: "前台",
  marketing: "营销",
  finance: "财务",
  logistics: "后勤",
  admin: "行政",
  supplemental: "兜底",
};

const MAX_LABEL_LEN = 32;

function truncate(s, n) {
  if (typeof s !== "string") return "";
  const t = s.trim();
  if (t.length <= n) return t;
  return t.slice(0, n - 1) + "…";
}

function firstFieldValue(fields) {
  if (!Array.isArray(fields) || fields.length === 0) return null;
  const f = fields.find((x) => x && typeof x.value === "string" && x.value.trim());
  return f ? f.value : null;
}

function deriveFamilyLabel(hint) {
  if (typeof hint !== "string") return "证据";
  return FAMILY_LABEL[hint] || hint;
}

function deriveDeptLabel(deptId) {
  if (typeof deptId !== "string") return "";
  return DEPT_LABEL_FALLBACK[deptId] || deptId;
}

/**
 * 推断走马灯紧急度。
 * - subject_quality=low / contradictions 非空 / time_uncertain → yellow
 * - 其余 aligned → green（走马灯默认低噪音；红警由 AttentionQueue 承担）
 */
function deriveUrgency(aligned) {
  if (!aligned) return "yellow";
  if (Array.isArray(aligned.contradictions) && aligned.contradictions.length > 0) return "yellow";
  if (aligned.subject_quality === "low" || aligned.subject_quality === "uncertain") return "yellow";
  return "green";
}

/**
 * 构造走马灯展示文本（事件概括）。
 * 形态：{地点}·{人物}·{干了什么}（超长截断）
 * 时间由走马灯车厢时间戳单独呈现，此处聚焦「地点+人物+动作」三要素。
 */
function buildMarqueeLabel(artifact, aligned, extraction) {
  const dept = deriveDeptLabel(artifact.source_region);        // 地点
  const subjectName = aligned?.subject_fingerprint?.name || ""; // 人物
  const fv = firstFieldValue(aligned?.fields);                  // 干了什么
  const parts = [];
  if (dept) parts.push(dept);
  if (subjectName) parts.push(subjectName);
  if (fv) parts.push(truncate(fv, 14));
  let label = parts.filter(Boolean).join("·");
  if (!label) {
    // 兜底：业务族 + 归一化文本前缀
    const family = deriveFamilyLabel(aligned?.workflow_family_hint);
    const text = (extraction?.normalized_text || "").trim();
    label = truncate(text, MAX_LABEL_LEN) || (family ? `${family}·新证据` : "新证据已归档");
  }
  return truncate(label, MAX_LABEL_LEN);
}

/**
 * 语义重构 Skill 主函数。
 * 纯函数：不触碰数据库，不触发副作用；由调用方负责落库与事件分发。
 *
 * @param {object} input
 * @param {object} input.artifact  Artifact 记录
 * @param {object} input.aligned   alignment 产出的对齐结果
 * @param {object} input.extraction adapter 产出的归一化提取
 * @returns {object} ReconstructionResult
 */
export function reconstruct(input) {
  const { artifact, aligned, extraction } = input || {};
  if (!artifact || !artifact.id) {
    return { status: "rejected", artifact_id: null, marquee_payload: null, agent_payload: null };
  }

  const alignmentStatus = aligned?.alignment_status || "needs_clarification";

  // 通道 A：走马灯（仅 aligned 时产出，needs_clarification 不污染走马灯）
  let marqueePayload = null;
  if (alignmentStatus === "aligned") {
    marqueePayload = {
      label: buildMarqueeLabel(artifact, aligned, extraction),
      urgency: deriveUrgency(aligned),
      timestamp: aligned?.occurred_at || artifact.captured_at || new Date().toISOString(),
      staff_hint: artifact.source_staff_id || null,
      dept_hint: deriveDeptLabel(artifact.source_region),
      family_hint: aligned?.workflow_family_hint || null,
    };
  }

  // 通道 B：Agent 编组（assembly_eligible 由 alignment gate 决定）
  let agentPayload = null;
  if (alignmentStatus === "aligned") {
    agentPayload = {
      assembly_eligible: true,
      workflow_family_hint: aligned?.workflow_family_hint || null,
      subject_type: aligned?.subject_type || "unknown",
      occurred_at: aligned?.occurred_at || null,
      fact_card_descriptor: {
        fields: Array.isArray(aligned?.fields) ? aligned.fields : [],
        subject_fingerprint: aligned?.subject_fingerprint || null,
        subject_quality: aligned?.subject_quality || "uncertain",
        confidence: typeof aligned?.confidence === "number" ? aligned.confidence : null,
        evidence_spans: Array.isArray(aligned?.evidence_spans) ? aligned.evidence_spans : [],
        contradictions: Array.isArray(aligned?.contradictions) ? aligned.contradictions : [],
        unsupported_assumptions: Array.isArray(aligned?.unsupported_assumptions) ? aligned.unsupported_assumptions : [],
        time_uncertain: aligned?.time_uncertain === true,
      },
    };
  }

  return {
    status: alignmentStatus,
    artifact_id: artifact.id,
    skill_version: SKILL_VERSION,
    marquee_payload: marqueePayload,
    agent_payload: agentPayload,
  };
}

/**
 * 校验 ReconstructionResult 结构（供契约测试与调用方断言）。
 */
export function validateReconstructionResult(r) {
  if (!r || typeof r !== "object") return { ok: false, reason: "result_required" };
  if (typeof r.artifact_id !== "string") return { ok: false, reason: "artifact_id_required" };
  if (!["aligned", "needs_clarification", "rejected"].includes(r.status)) {
    return { ok: false, reason: "status_invalid" };
  }
  if (r.status === "aligned") {
    if (!r.marquee_payload || typeof r.marquee_payload.label !== "string") {
      return { ok: false, reason: "marquee_label_required_for_aligned" };
    }
    if (!URGENCY_LEVELS.includes(r.marquee_payload.urgency)) {
      return { ok: false, reason: "urgency_invalid" };
    }
    if (!r.agent_payload || r.agent_payload.assembly_eligible !== true) {
      return { ok: false, reason: "agent_payload_required_for_aligned" };
    }
  }
  return { ok: true };
}