/**
 * Clinic OS V10 — Candidate Finder（修订版）
 *
 * 修订要点：
 * - 移除 PatientSession 硬编码，改为通用 Workflow 模型（workflow_id）；
 * - 影子模式：LLM 输出一律不得自动挂接，confidence 仅记录；
 * - 删除 llmThreshold 与 confidence≥0.5/0.7 自动 linked 逻辑；
 * - 时间接近只产生候选，不自动选择第一个 Workflow。
 *
 * 优先顺序：明确ID匹配（可自动挂接） → 时空候选（仅候选） → LLM候选（仅记录） → unlinked。
 */

import { PROMPT_VERSIONS } from "./prompts";

const SPATIOTEMPORAL_WINDOW_MIN = 120;

/**
 * 确定性候选匹配（explicit + spatiotemporal）。不触发 LLM。
 * 返回候选列表 [{ workflow_id, method, score, reason }]。
 */
export function deterministicCandidates({ artifact, factCard, workflows }) {
  const source = artifact || factCard;
  if (!source) throw new Error("deterministicCandidates: source required");
  if (!Array.isArray(workflows)) return [];
  const candidates = [];

  // 1. 明确 ID 匹配（显式绑定，确定性，可自动挂接）
  const explicitId = artifact?.source_workflow_id || factCard?.workflow_id;
  if (explicitId) {
    const hit = workflows.find((w) => w.id === explicitId);
    if (hit) {
      candidates.push({ workflow_id: hit.id, method: "explicit_id", score: 1.0, reason: "显式绑定 source_workflow_id" });
      return candidates; // 明确命中即终止
    }
  }

  // 2. 时空匹配：仅产生候选，不自动挂接（时间接近不能单独确定身份）
  const capturedAt = artifact?.captured_at || factCard?.extracted_at;
  if (capturedAt) {
    const ts = new Date(capturedAt).getTime();
    for (const w of workflows) {
      const nodeTimes = w.node_scan_timestamps || {};
      const scanPoints = Object.values(nodeTimes)
        .filter(Boolean)
        .map((t) => new Date(t).getTime())
        .filter((t) => !Number.isNaN(t));
      if (scanPoints.length === 0 && w.arrival_time) {
        scanPoints.push(new Date(w.arrival_time).getTime());
      }
      const within = scanPoints.some(
        (pt) => Math.abs(pt - ts) <= SPATIOTEMPORAL_WINDOW_MIN * 60 * 1000
      );
      if (within) {
        candidates.push({
          workflow_id: w.id,
          method: "spatiotemporal",
          score: 0.6,
          reason: `±${SPATIOTEMPORAL_WINDOW_MIN}分钟内存在节点记录（仅候选，不自动挂接）`,
        });
      }
    }
  }

  return candidates;
}

/**
 * LLM 候选匹配：影子模式下仅记录候选，绝不决定挂接。
 * confidence 写入候选对象供审计，但 linkedWorkflowId 永远不由 LLM 决定。
 */
export async function llmCandidateMatch({ factCard, workflows, invokeLLM }) {
  if (!invokeLLM) throw new Error("llmCandidateMatch: invokeLLM required");
  if (!Array.isArray(workflows) || workflows.length === 0) return [];

  const prompt = [
    "你是视光诊所工作流归属判定器。判断证据事实卡片最可能归属哪个 Workflow。",
    "约束（影子模式）：仅输出候选建议（带信心度与理由），禁止直接修改系统状态；",
    "confidence 仅记录，不决定自动挂接。",
    "",
    "证据字段:",
    JSON.stringify((factCard.fields || []).map((f) => ({ field_name: f.field_name, value: f.value }))),
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
      confidence: result.confidence ?? null, // 仅记录
      reason: (result.reason_codes || []).join("; ") || "LLM 候选（仅记录）",
    },
  ];
}

/**
 * 影子模式编排。
 * - explicit_id：可自动挂接（显式绑定，非推断）；
 * - spatiotemporal / llm：一律仅候选，linkedWorkflowId=null，needsManagerReview=true。
 * 不存在 llmThreshold 参数，confidence 永不决定挂接。
 */
export async function resolveWorkflowLink({ artifact, factCard, workflows, invokeLLM }) {
  const det = deterministicCandidates({ artifact, factCard, workflows });
  const explicit = det.find((c) => c.method === "explicit_id");
  if (explicit) {
    return { candidates: det, linkedWorkflowId: explicit.workflow_id, method: "explicit_id", needsManagerReview: false };
  }

  let candidates = det.filter((c) => c.method === "spatiotemporal");
  if (invokeLLM && factCard) {
    const llm = await llmCandidateMatch({ factCard, workflows, invokeLLM });
    candidates = [...candidates, ...llm];
  }

  // 影子模式：时空 / LLM 候选一律不自动挂接
  return { candidates, linkedWorkflowId: null, method: "candidate_only", needsManagerReview: true };
}