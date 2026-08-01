// GENERATED_PHASE2_MIRROR source=src/lib/composition/prompts.js blob=a328371620b8eaeb6da623e3167bbd88522aa614
// Do not edit manually; parity test pins the canonical source blob.
/**
 * Clinic OS V10 — Composition 编组逻辑层 Prompt 版本与模板（修订版 R2）
 *
 * R2 修订：
 * - 统一通用 Workflow 契约：explicit_workflow_id / workflow_family_hint /
 *   subject_type / subject_fingerprint；时间用 occurred_at/captured_at；
 * - Assembly Schema 支持 null，关键输出字段 required；
 * - 增加 target_snapshot_id / target_snapshot_version。
 */

export const PROMPT_VERSIONS = {
  EVIDENCE_INTERPRETER: "evidence-interp-v2",
  CANDIDATE_MATCH: "candidate-match-v2",
  WORKFLOW_ASSEMBLY: "workflow-assembly-v3",
  ORPHAN_CLUSTER: "orphan-cluster-v1",
};

/** 通用 Workflow 族（替代 PatientSession 硬编码） */
export const WORKFLOW_FAMILIES = [
  "patient_visit",
  "procurement",
  "human_resources",
  "marketing",
  "logistics",
  "equipment_maintenance",
];

export const COMPOSITION_TYPES = ["attach", "new_train", "orphan"];

/**
 * 七条推断轨道（推理协议，非加权打分）。
 */
export const REASONING_TRACKS = [
  { track_id: "subject_fingerprint", name: "主体指纹线", description: "姓名片段、年龄、性别、眼别、医生、日期、病历号、检查号、处方参数等组合线索；低可信 OCR 不得直接成为硬冲突" },
  { track_id: "causal_chain", name: "临床/业务因果线", description: "请求/医嘱 → 执行动作 → 结果 → 复核/决策 → 下一步；非医疗流程同理" },
  { track_id: "temporal_continuity", name: "时间连续线", description: "实际发生时间、上传时间、前后顺序、合理间隔、迟到乱序、跨日；时间不得单独确定身份" },
  { track_id: "department_handoff", name: "部门接力线", description: "部门间交接方向；允许跳步、重复、分支、暂停、回流" },
  { track_id: "actor_device_location", name: "人员/设备/地点连续线", description: "上传员工、执行医生、部门、设备、诊室、地点" },
  { track_id: "document_lineage", name: "文档血缘线", description: "资料中重复或延续的姓名、眼别、医生、检查类型、报告编号、时间、处方参数；必须说明具体重复线索" },
  { track_id: "open_loop_closure", name: "开放环节闭合线", description: "新碎片能否闭合现有 Workflow 的开放环节" },
];

export const TRACK_IDS = REASONING_TRACKS.map((t) => t.track_id);

export function buildInterpreterPrompt({ artifact, sopDigest, businessLine }) {
  return [
    "你是视光诊所证据解读引擎。从以下原始证物中抽取结构化字段与主体指纹，供后续编组使用。",
    "约束：",
    "- 仅抽取证物中可直接佐证的事实，不得臆测；",
    "- 每个字段独立标注来源与抽取质量；",
    "- 抽取质量四档：high/medium/low/uncertain；无依据字段不得输出；",
    "- subject_fingerprint 仅记录高可信主体线索（姓名/病历号等），低可信不得写入；",
    "- occurred_at 为业务发生时间（若可从证物识别），否则留空由调用方以 captured_at 兜底；",
    "- 所有字段值（value）与主体名称（subject_fingerprint.name）必须用中文输出；若证物含英文医学术语或缩写，翻译为中文后填写；",
    "- 输出严格符合给定 JSON Schema。",
    "",
    `业务线: ${businessLine || "unknown"}`,
    `证物类型: ${artifact.artifact_type}`,
    `来源区域: ${artifact.source_region || "unknown"}`,
    "SOP 摘要:",
    sopDigest || "(无)",
  ].join("\n");
}

export function buildOrphanClusterPrompt({ orphanCards }) {
  return [
    "你是视光诊所工作流编组引擎的「孤立碎片聚类」子工序。",
    "以下多张 EvidenceFactCard 均未归属到任何已有 Workflow。请判断哪些碎片可能属于同一条新 Workflow（new_train）。",
    "约束：",
    "- 仅基于真实存在的线索推断，不得虚构身份或事件；",
    "- 最多产出 3 个候选簇，每簇至少 2 张碎片；无法成簇的碎片放入 unclustered；",
    "- fact_card_ids 必须来自输入列表，不得发明；",
    "- confidence 仅记录用，不决定自动挂接；",
    "- 输出严格符合 JSON Schema。",
    "",
    "孤立碎片（fact_card_id + 关键字段 + 主体指纹）:",
    JSON.stringify(
      orphanCards.map((c) => ({
        fact_card_id: c.id,
        artifact_id: c.artifact_id,
        subject_type: c.subject_type || null,
        subject_fingerprint: c.subject_fingerprint || null,
        occurred_at: c.occurred_at || null,
        fields: (c.fields || []).map((f) => ({ field_name: f.field_name, value: f.value })),
      })),
      null,
      0
    ),
  ].join("\n");
}

export function buildAssemblyPrompt({ factCards, candidateWorkflows = [], compositionContext = {}, sopDigest, policyTracks }) {
  // R2.3 项6：固定七轨道不允许被 GuessPolicy.tracks 替换；Policy 仅可对固定轨道追加 guardrails 提示。
  const known = new Set(TRACK_IDS);
  const policyHintsByTrack = new Map();
  if (Array.isArray(policyTracks)) {
    for (const t of policyTracks) {
      if (t && t.track_id && known.has(t.track_id) && Array.isArray(t.guardrails) && t.guardrails.length) {
        policyHintsByTrack.set(t.track_id, t.guardrails);
      }
    }
  }
  const trackList = REASONING_TRACKS.map((t) => {
    const extra = policyHintsByTrack.get(t.track_id);
    const base = `- ${t.track_id}（${t.name}）: ${t.description}`;
    return extra && extra.length ? `${base}\n  追加规则: ${extra.join("; ")}` : base;
  }).join("\n");
  return [
    "你是视光诊所工作流编组引擎。基于以下证据事实卡片与候选 Workflow，产出 1~3 个 Workflow 假设，供护栏校验与店长决策。",
    "约束：",
    "- 仅提供建议，不直接修改系统状态（影子模式）；",
    "- 必须为七条推断轨道分别输出证据线索；未使用轨道保持空数组，不得编造理由；",
    "- 每个假设须标注 composition_type（attach / new_train / orphan）；",
    "- attach 须给出 target_workflow_id；new_train 的 target_workflow_id 必须为 null；",
    "- ordered_artifact_ids 为该假设下碎片的合理先后顺序；",
    "- 必须给出 unsupported_assumptions 与 contradictions；",
    "- 不得为拼出完整流程而虚构 Event 或身份；",
    "- 选择总准绳：解释最多真实碎片、违反最少边界、需要最少无依据假设。",
    "",
    "七条推断轨道：",
    trackList,
    "",
    "编组上下文:",
    `composition_type 提示: ${compositionContext.compositionType || "auto"}`,
    compositionContext.workflow
      ? `目标 Workflow: ${JSON.stringify({ id: compositionContext.workflow.id, workflow_family: compositionContext.workflow.workflow_family, open_loops: compositionContext.workflow.open_loops })}`
      : "(无指定目标，可提议 new_train)",
    compositionContext.snapshot
      ? `目标快照: ${JSON.stringify({ id: compositionContext.snapshot.id, snapshot_version: compositionContext.snapshot.snapshot_version })}`
      : "(无目标快照)",
    "",
    "候选 Workflow（仅限少量最相关）:",
    JSON.stringify(
      candidateWorkflows.map((w) => ({ id: w.id, workflow_family: w.workflow_family, subject_type: w.subject_type, open_loops: w.open_loops })),
      null,
      0
    ),
    "",
    "证据事实卡片:",
    JSON.stringify(
      factCards.map((c) => ({
        artifact_id: c.artifact_id,
        subject_type: c.subject_type || null,
        subject_fingerprint: c.subject_fingerprint || null,
        occurred_at: c.occurred_at || null,
        fields: (c.fields || []).map((f) => ({ field_name: f.field_name, value: f.value })),
      })),
      null,
      0
    ),
    "",
    "眼科诊所场景常识参考:",
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
    subject_type: { type: "string", description: "patient | supplier | employee | campaign | equipment | null" },
    subject_fingerprint: {
      type: "object",
      properties: {
        name: { type: "string" },
        external_id: { type: "string" },
      },
      additionalProperties: true,
    },
    subject_quality: { type: "string", enum: ["high", "medium", "low", "uncertain"] },
    workflow_family_hint: { type: "string" },
    occurred_at: { type: "string", format: "date-time" },
  },
  required: ["fields"],
};

export const ORPHAN_CLUSTER_JSON_SCHEMA = {
  type: "object",
  properties: {
    clusters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          fact_card_ids: { type: "array", items: { type: "string" } },
          workflow_family_hint: { type: "string" },
          confidence: { type: "number" },
          reason: { type: "string" },
        },
        required: ["fact_card_ids"],
      },
    },
    unclustered: { type: "array", items: { type: "string" } },
  },
  required: ["clusters"],
};

export const ASSEMBLY_JSON_SCHEMA = {
  type: "object",
  properties: {
    hypotheses: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          workflow_hypothesis_id: { type: "string" },
          workflow_family: { type: "string", enum: WORKFLOW_FAMILIES },
          composition_type: { type: "string", enum: COMPOSITION_TYPES },
          target_workflow_id: { type: ["string", "null"] },
          target_snapshot_id: { type: ["string", "null"] },
          target_snapshot_version: { type: ["number", "null"] },
          ordered_artifact_ids: { type: "array", items: { type: "string" } },
          reasoning_tracks: {
            type: "object",
            properties: Object.fromEntries(
              TRACK_IDS.map((id) => [id, { type: "array", items: { type: "string" } }])
            ),
          },
          unsupported_assumptions: { type: "array", items: { type: "string" } },
          contradictions: { type: "array", items: { type: "string" } },
          unexplained_artifact_ids: { type: "array", items: { type: "string" } },
        },
        required: [
          "workflow_hypothesis_id",
          "workflow_family",
          "composition_type",
          "target_workflow_id",
          "target_snapshot_id",
          "target_snapshot_version",
          "ordered_artifact_ids",
          "reasoning_tracks",
          "unsupported_assumptions",
          "contradictions",
          "unexplained_artifact_ids",
        ],
      },
    },
    unexplained_artifact_ids: { type: "array", items: { type: "string" } },
  },
  required: ["hypotheses"],
};