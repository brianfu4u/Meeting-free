/**
 * Clinic OS V10 — Candidate Finder（修订版 R2.3）
 *
 * R2.3：
 * - 强制 clinicId：缺失直接抛错；并校验 Artifact/FactCard 的 clinic_id 与当前 clinic 一致；
 * - 进入 LLM Prompt 前候选缩到 ≤5；LLM 返回的 workflow_id 必须属于服务端候选白名单，否则记 invalid_candidate；
 * - 影子模式：LLM/时空候选一律不自动挂接。
 */

import { PROMPT_VERSIONS } from "./prompts";

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
  if (srcClinic && srcClinic !== clinicId) {
    throw new Error(
      `CandidateFinder: source clinic_id 不一致（source=${srcClinic}, scope=${clinicId}）`
    );
  }
}

export function deterministicCandidates({ artifact, factCard, workflows, clinicId }) {
  assertClinicId(clinicId);
  const source = artifact || factCard;
  if (!source) throw new Error("deterministicCandidates: source required");
  assertSourceClinicMatch(source, clinicId);
  if (!Array.isArray(workflows)) return [];

  // 强制 clinic_id 隔离：仅在同一门店内寻找候选
  const scoped = workflows.filter((w) => w.clinic_id === clinicId);
  const candidates = [];

  // 1. 明确 ID 匹配（确定性，可自动挂接）
  const explicitId = artifact?.source_workflow_id || factCard?.explicit_workflow_id;
  if (explicitId) {
    const hit = scoped.find((w) => w.id === explicitId);
    if (hit) {
      candidates.push({ workflow_id: hit.id, method: "explicit_id", score: 1.0, reason: "显式绑定 explicit_workflow_id" });
      return candidates;
    }
  }

  // 2. 时空匹配：通用时间锚点；仅候选，不自动挂接
  const capturedAt = artifact?.captured_at || factCard?.occurred_at;
  if (capturedAt) {
    const ts = new Date(capturedAt).getTime();
    if (!Number.isNaN(ts)) {
      for (const w of scoped) {
        const times = collectWorkflowTimes(w);
        const within = times.some((pt) => Math.abs(pt - ts) <= SPATIOTEMPORAL_WINDOW_MIN * 60 * 1000);
        if (within) {
          candidates.push({
            workflow_id: w.id,
            method: "spatiotemporal",
            score: 0.6,
            reason: `±${SPATIOTEMPORAL_WINDOW_MIN}分钟内存在时间锚点（仅候选，不自动挂接）`,
          });
        }
      }
      // 进入 LLM 前先把候选缩到 ≤5
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

  const prompt = [
    "你是视光诊所工作流归属判定器。在给定的候选 Workflow 白名单内选择最可能归属项。",
    "约束（影子模式）：仅输出候选建议（带信心度与理由），禁止直接修改系统状态；",
    "best_workflow_id 必须来自候选白名单，不得发明；confidence 仅记录，不决定自动挂接。",
    "",
    "证据主体:",
    JSON.stringify({
      subject_type: factCard.subject_type || null,
      subject_fingerprint: factCard.subject_fingerprint || null,
      fields: (factCard.fields || []).map((f) => ({ field_name: f.field_name, value: f.value })),
    }),
    "",
    "候选 Workflow 白名单（≤5）:",
    JSON.stringify(candidateWorkflows.map((w) => ({ id: w.id, workflow_family: w.workflow_family, subject_type: w.subject_type }))),
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

  // 时空候选进入 LLM 前已缩到 ≤5（deterministicCandidates 内部截断）
  let candidates = det.filter((c) => c.method === "spatiotemporal").slice(0, MAX_CANDIDATES);
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
    candidates = [...candidates, ...llmCands].slice(0, MAX_CANDIDATES);
    invalid_candidates.push(...invalid);
  }

  return {
    candidates,
    linkedWorkflowId: null,
    method: "candidate_only",
    needsManagerReview: true,
    invalid_candidates,
  };
}