/**
 * Clinic OS V10 — Composition 编组逻辑层 Prompt 版本与模板
 *
 * 设计原则：Prompt 与逻辑分离，版本号随迭代单调递增，写入 EvidenceFactCard / AttentionItem
 * 的 prompt_version 字段，便于回溯与 A/B。
 */

export const PROMPT_VERSIONS = {
  EVIDENCE_INTERPRETER: "evidence-interp-v1",
  CANDIDATE_MATCH: "candidate-match-v1",
  WORKFLOW_ASSEMBLY: "workflow-assembly-v1",
};

/**
 * 七条推断轨道（推理协议，非加权打分）。
 * 编组 LLM 必须为每条轨道独立标注支持/反对证据与信息缺口。
 */
export const REASONING_TRACKS = [
  { track_id: "T1", name: "患者旅程一致性", description: "证据是否与该 PatientSession 已完成节点连贯" },
  { track_id: "T2", name: "时间窗口合理性", description: "事件发生时间是否落在业务线合理区间" },
  { track_id: "T3", name: "证物来源归属", description: "Artifact 来源区域/员工是否与该 session 当前负责岗匹配" },
  { track_id: "T4", name: "SOP 执行完整度", description: "SystemSpec 要求的 expected_evidence 是否齐备" },
  { track_id: "T5", name: "瓶颈/卡滞信号", description: "是否存在节点超时、等待超时或资源风险" },
  { track_id: "T6", name: "终止信号", description: "是否检出可收尾的业务闭环信号" },
  { track_id: "T7", name: "交接必要性", description: "是否需要跨部门/岗位交接及交接目标" },
];

export function buildInterpreterPrompt({ artifact, sopDigest, businessLine }) {
  return [
    "你是视光诊所证据解读引擎。从以下原始证物中抽取结构化字段，供后续编组使用。",
    "约束：",
    "- 仅抽取证物中可直接佐证的事实，不得臆测；",
    "- 每个字段独立标注来源（source_region 或 source_quote）与抽取质量；",
    "- 抽取质量四档：high/medium/low/uncertain；无依据字段不得输出；",
    "- 输出严格符合给定 JSON Schema。",
    "",
    `业务线: ${businessLine || "unknown"}`,
    `证物类型: ${artifact.artifact_type}`,
    `来源区域: ${artifact.source_region || "unknown"}`,
    "SOP 摘要:",
    sopDigest || "(无)",
  ].join("\n");
}

export function buildAssemblyPrompt({ factCards, snapshot, sopDigest, policyTracks }) {
  const trackList = policyTracks
    .map((t) => `- ${t.track_id} ${t.name}: ${t.description}`)
    .join("\n");
  return [
    "你是视光诊所工作流编组引擎。基于以下证据事实卡片与当前工作流快照，",
    "产出一份「提案」（AttentionItem 草案），供店长三选一决策。约束：",
    "- 仅提供建议，不直接修改系统状态；",
    "- 必须为七条推断轨道分别标注支持证据/反对证据/信息缺口；",
    "- 必须给出 ≥1 个候选假设，并标注其解释碎片数、护栏违反数、无依据假设数；",
    "- 若提议 closed/handoff，需明确 terminal_signal_detected 与所需交接证据；",
    "- recommendation ≤50 字；title ≤20 字。",
    "",
    "七条推断轨道：",
    trackList,
    "",
    "当前快照摘要:",
    snapshot?.llm_summary || "(无)",
    `当前节点: ${snapshot?.current_node || "未知"}  累计耗时: ${snapshot?.total_elapsed_minutes ?? 0} 分钟`,
    "",
    "证据事实卡片:",
    JSON.stringify(
      factCards.map((c) => ({
        artifact_id: c.artifact_id,
        session_id: c.session_id,
        fields: c.fields,
      })),
      null,
      0
    ),
    "",
    "SOP 摘要:",
    sopDigest || "(无)",
  ].join("\n");
}

export const INTERPRETER_JSON_SCHEMA = {
  type: "object",
  properties: {
    fields: {
      type: "array",
      items: {
        type: "object",
        properties: {
          field_name: { type: "string" },
          value: { type: "string" },
          source_region: { type: "string" },
          source_quote: { type: "string" },
          extraction_quality: { type: "string", enum: ["high", "medium", "low", "uncertain"] },
          extraction_method: { type: "string" },
        },
        required: ["field_name", "value", "extraction_quality", "extraction_method"],
      },
    },
    session_hint: { type: "string", description: "若证物中显式出现患者/病历号，标注以便候选匹配" },
  },
  required: ["fields"],
};

export const ASSEMBLY_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    urgency: { type: "string", enum: ["yellow", "red"] },
    attention_type: {
      type: "string",
      enum: ["journey_gap", "evidence_missing", "contradiction", "resource_risk", "wait_timeout", "staff_unresponsive"],
    },
    recommendation: { type: "string" },
    reasoning: { type: "string" },
    reasoning_tracks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          track_id: { type: "string" },
          supporting_evidence: { type: "array", items: { type: "string" } },
          opposing_evidence: { type: "array", items: { type: "string" } },
          information_gaps: { type: "array", items: { type: "string" } },
        },
        required: ["track_id"],
      },
    },
    alternative_hypotheses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          hypothesis_id: { type: "string" },
          description: { type: "string" },
          fragments_explained: { type: "number" },
          guardrail_violations: { type: "number" },
          unsupported_assumptions_count: { type: "number" },
        },
        required: ["hypothesis_id", "description"],
      },
    },
    terminal_signal_detected: { type: "boolean" },
    proposed_workflow_status: { type: "string" },
    proposed_handoff_department: { type: "string" },
    proposed_handoff_role: { type: "string" },
    handoff_evidence_ids: { type: "array", items: { type: "string" } },
    unsupported_assumptions: { type: "array", items: { type: "string" } },
  },
  required: ["title", "urgency", "attention_type", "recommendation", "reasoning_tracks", "alternative_hypotheses"],
};