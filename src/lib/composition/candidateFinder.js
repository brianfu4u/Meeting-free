/**
 * Clinic OS V10 — Candidate Finder
 *
 * 职责：为一条 Artifact / EvidenceFactCard 寻找其归属的 PatientSession 候选。
 * 优先顺序（宪法）：明确ID匹配 → 确定性时空匹配 → LLM候选匹配 → 保留 unlinked。
 *
 * 输出：有序候选列表 [{ session_id, method, score, reason }]
 *   method: explicit_id | spatiotemporal | llm | unlinked
 *   score: 0..1，用于聚类排序
 *
 * 确定性阶段为纯函数；LLM 阶段异步，可注入 invokeLLM（无命中时才触发）。
 */

import { PROMPT_VERSIONS } from "./prompts";

const SPATIOTEMPORAL_WINDOW_MIN = 120; // 同 session 同区域 ±120 分钟视为时空命中

/**
 * 确定性候选匹配（explicit + spatiotemporal）。
 * 不触发 LLM，可独立单测。
 */
export function deterministicCandidates({ artifact, factCard, sessions, snapshots = [] }) {
  const source = artifact || factCard;
  if (!source) throw new Error("deterministicCandidates: source required");
  if (!Array.isArray(sessions)) return [];

  const candidates = [];

  // 1. 明确 ID 匹配
  const explicitId = artifact?.source_session_id || factCard?.session_id;
  if (explicitId) {
    const hit = sessions.find((s) => s.id === explicitId);
    if (hit) {
      candidates.push({ session_id: hit.id, method: "explicit_id", score: 1.0, reason: "artifact 显式绑定 source_session_id" });
      return candidates; // 明确命中即终止，不再时空匹配
    }
  }

  // 2. 确定性时空匹配
  const capturedAt = artifact?.captured_at || factCard?.extracted_at;
  const region = artifact?.source_region || factCard?.source_region;
  if (capturedAt) {
    const ts = new Date(capturedAt).getTime();
    for (const s of sessions) {
      const nodeTimes = s.node_scan_timestamps || {};
      const scanPoints = Object.values(nodeTimes)
        .filter(Boolean)
        .map((t) => new Date(t).getTime())
        .filter((t) => !Number.isNaN(t));
      if (scanPoints.length === 0 && s.arrival_time) {
        scanPoints.push(new Date(s.arrival_time).getTime());
      }
      const within = scanPoints.some(
        (pt) => Math.abs(pt - ts) <= SPATIOTEMPORAL_WINDOW_MIN * 60 * 1000
      );
      if (within) {
        candidates.push({
          session_id: s.id,
          method: "spatiotemporal",
          score: 0.6,
          reason: `±${SPATIOTEMPORAL_WINDOW_MIN}分钟内存在节点扫码记录`,
        });
      }
    }
  }

  return candidates;
}

/**
 * LLM 候选匹配：确定性阶段无命中时调用。
 * 传入候选 session 摘要列表与 factCard 字段，由 LLM 输出最可能归属及置信度。
 */
export async function llmCandidateMatch({ factCard, sessions, invokeLLM }) {
  if (!invokeLLM) throw new Error("llmCandidateMatch: invokeLLM required");
  if (!Array.isArray(sessions) || sessions.length === 0) return [];

  const prompt = [
    "你是视光诊所患者旅程归属判定器。判断证据事实卡片最可能归属哪个 PatientSession。",
    "约束：仅输出 link proposal（带信心度与理由），禁止直接修改系统状态；",
    "若无足够依据，confidence 不得高于 0.5。",
    "",
    "证据字段:",
    JSON.stringify(factCard.fields?.map((f) => ({ field_name: f.field_name, value: f.value })) || []),
    "",
    "候选 Session:",
    JSON.stringify(sessions.map((s) => ({ id: s.id, patient_name: s.patient_name, current_node: s.current_node }))),
  ].join("\n");

  const result = await invokeLLM({
    prompt,
    response_json_schema: {
      type: "object",
      properties: {
        best_session_id: { type: "string" },
        confidence: { type: "number" },
        reason_codes: { type: "array", items: { type: "string" } },
      },
      required: ["best_session_id", "confidence"],
    },
    model: "automatic",
  });

  if (!result?.best_session_id) return [];
  return [
    {
      session_id: result.best_session_id,
      method: "llm",
      score: Math.min(result.confidence ?? 0, 1),
      reason: (result.reason_codes || []).join("; ") || "LLM 候选匹配",
    },
  ];
}

/**
 * 编排：确定性优先，无命中则 LLM，仍无则 unlinked。
 * 返回 { candidates, linkedSessionId, method, needsManagerReview }
 */
export async function resolveSessionLink({
  artifact,
  factCard,
  sessions,
  snapshots,
  invokeLLM,
  llmThreshold = 0.5,
}) {
  const det = deterministicCandidates({ artifact, factCard, sessions, snapshots });
  if (det.length > 0) {
    const top = det[0];
    return { candidates: det, linkedSessionId: top.session_id, method: top.method, needsManagerReview: false };
  }

  if (invokeLLM && factCard) {
    const llm = await llmCandidateMatch({ factCard, sessions, invokeLLM });
    if (llm.length > 0 && llm[0].score >= llmThreshold) {
      return { candidates: llm, linkedSessionId: llm[0].session_id, method: "llm", needsManagerReview: llm[0].score < 0.7 };
    }
    if (llm.length > 0) {
      return { candidates: llm, linkedSessionId: null, method: "unlinked", needsManagerReview: true };
    }
  }

  return { candidates: [], linkedSessionId: null, method: "unlinked", needsManagerReview: true };
}