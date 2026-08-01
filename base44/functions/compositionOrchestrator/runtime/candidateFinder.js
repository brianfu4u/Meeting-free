// GENERATED_PHASE2_MIRROR source=src/lib/composition/candidateFinder.js blob=c65cece42692e7fc8b02853680e0d34c06f6c2c0
// Do not edit manually; parity test pins the canonical source blob.
/**
 * Clinic OS V10 — Candidate Finder（修订版 R2.5）
 *
 * R2.5：
 * - 眼科 FactCard 存在人工确认项目时，将 eye_exam.exam_item_manual_tag
 *   作为项目匹配的第一依据；自动识别项目仅作为辅助参考；
 * - 人工项目标签只调整候选排序/LLM 上下文，不绕过显式 ID、租户隔离、
 *   候选白名单、经理复核或自动挂接门槛。
 *
 * R2.4：
 * - clinicId、Artifact/FactCard 的 clinic_id 必须存在且完全一致；缺失或不一致均抛错；
 * - 时空候选按 min_delta_ms ASC, workflow_id ASC 稳定排序后取前 5；
 * - LLM 返回白名单内 ID 时合并/标注既有候选，禁止追加重复项；
 * - 已有 5 个候选时 LLM 选中项必须保留，不得被 slice 丢弃；
 * - 白名单外 ID 输出 invalid_candidate，不加入候选或自动挂接。
 */

import { PROMPT_VERSIONS } from "./prompts.js";

const SPATIOTEMPORAL_WINDOW_MIN = 120;
const MAX_CANDIDATES = 5;

function collectWorkflowTimes(w) {
  const times = [];
  if (Array.isArray(w.temporal_anchors)) times.push(...w.temporal_anchors);
  if (w.started_at) times.push(w.started_at);
  if (w.last_event_at) times.push(w.last_event_at);
  return times
    .filter(Boolean)
    .map((t) => new Date(t).getTime())
    .filter((t) => !Number.isNaN(t));
}

function assertClinicId(clinicId) {
  if (!clinicId) {
    throw new Error("CandidateFinder: clinicId required（租户隔离强制）");
  }
}

function assertSourceClinicMatch(source, clinicId) {
  if (!source) return;
  const srcClinic = source.clinic_id;
  if (!srcClinic) {
    throw new Error("CandidateFinder: source clinic_id 缺失（租户隔离强制）");
  }
  if (srcClinic !== clinicId) {
    throw new Error(
      `CandidateFinder: source clinic_id 不一致（source=${srcClinic}, scope=${clinicId}）`
    );
  }
}

function normalizeTag(value) {
  return String(value || "").trim().toLowerCase();
}

function factCardFieldValue(factCard, fieldName) {
  const fields = Array.isArray(factCard?.fields) ? factCard.fields : [];
  const field = fields.find((item) => item?.field_name === fieldName);
  return field?.value ?? null;
}

export function getEyeExamMatchingContext(factCard) {
  const manualTag = factCardFieldValue(factCard, "eye_exam.exam_item_manual_tag");
  const manualLabel = factCardFieldValue(factCard, "eye_exam.exam_item_manual_label");
  const suggestedTag = factCardFieldValue(factCard, "eye_exam.exam_item_suggested_tag");
  const autoName = factCardFieldValue(factCard, "eye_exam.exam_item_name");
  const matchItem = factCardFieldValue(factCard, "eye_exam.match_exam_item");
  return {
    manual_tag: manualTag || null,
    manual_label: manualLabel || null,
    suggested_tag: suggestedTag || null,
    automatic_exam_item_name: autoName || null,
    effective_match_item: manualTag || matchItem || suggestedTag || autoName || null,
    source: manualTag ? "user_confirmed" : (matchItem || suggestedTag || autoName ? "automatic" : null),
  };
}

function collectWorkflowExamItemTags(workflow) {
  const directValues = [
    workflow?.expected_exam_item_tag,
    workflow?.exam_item_tag,
    workflow?.exam_item_manual_tag,
    workflow?.task_exam_item_tag,
    workflow?.task_type,
  ];
  const listValues = [
    ...(Array.isArray(workflow?.expected_exam_item_tags) ? workflow.expected_exam_item_tags : []),
    ...(Array.isArray(workflow?.exam_item_tags) ? workflow.exam_item_tags : []),
  ];
  return new Set([...directValues, ...listValues].map(normalizeTag).filter(Boolean));
}

function workflowMatchesEyeExamItem(workflow, matchingContext) {
  const effective = normalizeTag(matchingContext?.effective_match_item);
  if (!effective) return false;
  return collectWorkflowExamItemTags(workflow).has(effective);
}

export function deterministicCandidates({ artifact, factCard, workflows, clinicId }) {
  assertClinicId(clinicId);
  const source = artifact || factCard;
  if (!source) throw new Error("deterministicCandidates: source required");
  assertSourceClinicMatch(source, clinicId);
  if (!Array.isArray(workflows)) return [];

  const scoped = workflows.filter((w) => w.clinic_id === clinicId);
  const candidates = [];

  // 1. 明确 ID 匹配（确定性，可自动挂接）
  const explicitId = artifact?.source_workflow_id || factCard?.explicit_workflow_id;
  if (explicitId) {
    const hit = scoped.find((w) => w.id === explicitId);
    if (hit) {
      candidates.push({
        workflow_id: hit.id,
        method: "explicit_id",
        score: 1.0,
        min_delta_ms: 0,
        reason: "显式绑定 explicit_workflow_id",
      });
      return candidates;
    }
  }

  // 2. 时空匹配；人工确认的眼科项目仅提高同类候选排序，不单独创造候选。
  const capturedAt = artifact?.captured_at || factCard?.occurred_at;
  const eyeExamContext = getEyeExamMatchingContext(factCard);
  if (capturedAt) {
    const ts = new Date(capturedAt).getTime();
    if (!Number.isNaN(ts)) {
      const windowMs = SPATIOTEMPORAL_WINDOW_MIN * 60 * 1000;
      for (const w of scoped) {
        const times = collectWorkflowTimes(w);
        if (times.length === 0) continue;
        const deltas = times.map((pt) => Math.abs(pt - ts));
        const minDelta = Math.min(...deltas);
        if (minDelta <= windowMs) {
          const manualItemMatch = eyeExamContext.source === "user_confirmed"
            && workflowMatchesEyeExamItem(w, eyeExamContext);
          const automaticItemMatch = eyeExamContext.source !== "user_confirmed"
            && workflowMatchesEyeExamItem(w, eyeExamContext);
          candidates.push({
            workflow_id: w.id,
            method: "spatiotemporal",
            score: manualItemMatch ? 0.82 : automaticItemMatch ? 0.68 : 0.6,
            min_delta_ms: minDelta,
            eye_exam_item_match: manualItemMatch ? "manual" : automaticItemMatch ? "automatic" : null,
            reason: manualItemMatch
              ? `人工确认检查项目 ${eyeExamContext.manual_tag} 与 Workflow 匹配；最小时间差 ${Math.round(minDelta / 1000)}s`
              : automaticItemMatch
                ? `自动识别检查项目 ${eyeExamContext.effective_match_item} 与 Workflow 匹配；最小时间差 ${Math.round(minDelta / 1000)}s`
                : `最小时间差 ${Math.round(minDelta / 1000)}s（±${SPATIOTEMPORAL_WINDOW_MIN}分钟内，仅候选，不自动挂接）`,
          });
        }
      }
      // 人工项目匹配优先，其次自动项目匹配，再按时间差和 workflow_id 稳定排序。
      const itemRank = { manual: 0, automatic: 1 };
      candidates.sort((a, b) => {
        const aRank = itemRank[a.eye_exam_item_match] ?? 2;
        const bRank = itemRank[b.eye_exam_item_match] ?? 2;
        if (aRank !== bRank) return aRank - bRank;
        if (a.min_delta_ms !== b.min_delta_ms) return a.min_delta_ms - b.min_delta_ms;
        return a.workflow_id < b.workflow_id ? -1 : a.workflow_id > b.workflow_id ? 1 : 0;
      });
      if (candidates.length > MAX_CANDIDATES) candidates.length = MAX_CANDIDATES;
    }
  }

  return candidates;
}

/**
 * LLM 候选匹配：仅在服务端候选白名单（≤5）内选择。
 * 返回 { candidates, invalid }：若 LLM 返回的 workflow_id 不在白名单 → invalid_candidate。
 */
export async function llmCandidateMatch({ factCard, candidateWorkflows, invokeLLM }) {
  if (!invokeLLM) throw new Error("llmCandidateMatch: invokeLLM required");
  if (!Array.isArray(candidateWorkflows) || candidateWorkflows.length === 0) {
    return { candidates: [], invalid: [] };
  }

  const whitelist = candidateWorkflows.map((w) => w.id);
  const eyeExamMatchingContext = getEyeExamMatchingContext(factCard);
  const orderedFields = (factCard.fields || []).slice().sort((a, b) => {
    const priority = (field) => field?.field_name === "eye_exam.exam_item_manual_tag" ? 0
      : field?.field_name === "eye_exam.match_exam_item" ? 1
        : field?.field_name === "eye_exam.exam_item_name" ? 2 : 3;
    return priority(a) - priority(b);
  });

  const prompt = [
    "你是视光诊所工作流归属判定器。在给定的候选 Workflow 白名单内选择最可能归属项。",
    "约束（影子模式）：仅输出候选建议（带信心度与理由），禁止直接修改系统状态；",
    "best_workflow_id 必须来自候选白名单，不得发明；confidence 仅记录，不决定自动挂接。",
    "眼科检查项目规则：存在 manual_tag 时，它是上传人员确认的业务分类，优先于 automatic_exam_item_name；自动识别仅作辅助。",
    "",
    "眼科项目匹配上下文:",
    JSON.stringify(eyeExamMatchingContext),
    "",
    "证据主体:",
    JSON.stringify({
      subject_type: factCard.subject_type || null,
      subject_fingerprint: factCard.subject_fingerprint || null,
      fields: orderedFields.map((f) => ({ field_name: f.field_name, value: f.value })),
    }),
    "",
    "候选 Workflow 白名单（≤5）:",
    JSON.stringify(candidateWorkflows.map((w) => ({
      id: w.id,
      workflow_family: w.workflow_family,
      subject_type: w.subject_type,
      expected_exam_item_tag: w.expected_exam_item_tag || w.exam_item_tag || null,
      expected_exam_item_tags: w.expected_exam_item_tags || w.exam_item_tags || [],
    }))),
  ].join("\n");

  const result = await invokeLLM({
    prompt,
    response_json_schema: {
      type: "object",
      properties: {
        best_workflow_id: { type: "string" },
        confidence: { type: "number" },
        reason_codes: { type: "array", items: { type: "string" } },
      },
      required: ["best_workflow_id", "confidence"],
    },
    model: "automatic",
  });

  const returnedId = result?.best_workflow_id;
  if (!returnedId) return { candidates: [], invalid: [] };

  if (!whitelist.includes(returnedId)) {
    return {
      candidates: [],
      invalid: [
        { type: "invalid_candidate", workflow_id: returnedId, reason: "llm_returned_id_not_in_whitelist" },
      ],
    };
  }

  return {
    candidates: [
      {
        workflow_id: returnedId,
        method: "llm",
        score: Math.min(result.confidence ?? 0, 1),
        confidence: result.confidence ?? null,
        reason: (result.reason_codes || []).join("; ") || "LLM 候选（仅记录）",
      },
    ],
    invalid: [],
  };
}

export async function resolveWorkflowLink({ artifact, factCard, workflows, invokeLLM, clinicId }) {
  assertClinicId(clinicId);
  const source = artifact || factCard;
  if (source) assertSourceClinicMatch(source, clinicId);

  const scoped = (workflows || []).filter((w) => w.clinic_id === clinicId);
  const det = deterministicCandidates({ artifact, factCard, workflows: scoped, clinicId });
  const explicit = det.find((c) => c.method === "explicit_id");
  if (explicit) {
    return {
      candidates: det,
      linkedWorkflowId: explicit.workflow_id,
      method: "explicit_id",
      needsManagerReview: false,
      invalid_candidates: [],
    };
  }

  const candidates = det.filter((c) => c.method === "spatiotemporal");
  const invalid_candidates = [];

  if (invokeLLM && factCard && candidates.length > 0) {
    const whitelistWorkflows = scoped.filter((w) =>
      candidates.some((c) => c.workflow_id === w.id)
    );
    const { candidates: llmCands, invalid } = await llmCandidateMatch({
      factCard,
      candidateWorkflows: whitelistWorkflows,
      invokeLLM,
    });
    invalid_candidates.push(...invalid);

    const byId = new Map(candidates.map((c) => [c.workflow_id, c]));
    for (const llm of llmCands) {
      const existing = byId.get(llm.workflow_id);
      if (existing) {
        existing.llm = { confidence: llm.confidence ?? null, reason: llm.reason };
        existing.methods = Array.from(
          new Set([...(existing.methods || [existing.method]), "llm"])
        );
      } else {
        byId.set(llm.workflow_id, llm);
        candidates.push(llm);
      }
    }
  }

  return {
    candidates,
    linkedWorkflowId: null,
    method: "candidate_only",
    needsManagerReview: true,
    invalid_candidates,
  };
}
