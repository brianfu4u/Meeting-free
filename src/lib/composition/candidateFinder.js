/**
 * Clinic OS V10 — Candidate Finder（修订版 R2.2）
 *
 * R2.2：
 * - 通用时间契约：temporal_anchors / started_at / last_event_at（替代 arrival_time/node_scan_timestamps）；
 * - 强制 clinic_id 隔离：仅在同一门店内寻找候选；
 * - 限制候选数（MAX_CANDIDATES），避免候选爆炸；
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

export function deterministicCandidates({ artifact, factCard, workflows, clinicId }) {
  const source = artifact || factCard;
  if (!source) throw new Error("deterministicCandidates: source required");
  if (!Array.isArray(workflows)) return [];

  // 强制 clinic_id 隔离
  const scoped = clinicId ? workflows.filter((w) => w.clinic_id === clinicId) : workflows;
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
      // 限制候选数
      if (candidates.length > MAX_CANDIDATES) candidates.length = MAX_CANDIDATES;
    }
  }

  return candidates;
}

export async function llmCandidateMatch({ factCard, workflows, invokeLLM }) {
  if (!invokeLLM) throw new Error("llmCandidateMatch: invokeLLM required");
  if (!Array.isArray(workflows) || workflows.length === 0) return [];

  const prompt = [
    "你是视光诊所工作流归属判定器。判断证据事实卡片最可能归属哪个 Workflow。",
    "约束（影子模式）：仅输出候选建议（带信心度与理由），禁止直接修改系统状态；",
    "confidence 仅记录，不决定自动挂接。",
    "",
    "证据主体:",
    JSON.stringify({
      subject_type: factCard.subject_type || null,
      subject_fingerprint: factCard.subject_fingerprint || null,
      fields: (factCard.fields || []).map((f) => ({ field_name: f.field_name, value: f.value })),
    }),
    "",
    "候选 Workflow:",
    JSON.stringify(workflows.map((w) => ({ id: w.id, workflow_family: w.workflow_family, subject_type: w.subject_type }))),
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

  if (!result?.best_workflow_id) return [];
  return [
    {
      workflow_id: result.best_workflow_id,
      method: "llm",
      score: Math.min(result.confidence ?? 0, 1),
      confidence: result.confidence ?? null,
      reason: (result.reason_codes || []).join("; ") || "LLM 候选（仅记录）",
    },
  ];
}

export async function resolveWorkflowLink({ artifact, factCard, workflows, invokeLLM, clinicId }) {
  const scoped = clinicId ? (workflows || []).filter((w) => w.clinic_id === clinicId) : workflows || [];
  const det = deterministicCandidates({ artifact, factCard, workflows: scoped, clinicId });
  const explicit = det.find((c) => c.method === "explicit_id");
  if (explicit) {
    return { candidates: det, linkedWorkflowId: explicit.workflow_id, method: "explicit_id", needsManagerReview: false };
  }

  let candidates = det.filter((c) => c.method === "spatiotemporal");
  if (invokeLLM && factCard) {
    const llm = await llmCandidateMatch({ factCard, workflows: scoped, invokeLLM });
    candidates = [...candidates, ...llm].slice(0, MAX_CANDIDATES);
  }

  return { candidates, linkedWorkflowId: null, method: "candidate_only", needsManagerReview: true };
}