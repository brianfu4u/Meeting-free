// GENERATED_PHASE2_MIRROR source=src/lib/composition/candidateFinder.js blob=f09de528bd2e0948f74e844ef5e29cffdbb7b330
// Do not edit manually; parity test pins the canonical source blob.
/**
 * Clinic OS V10 — Candidate Finder（修订版 R2.6）
 *
 * R2.6：
 * - 编组 Agent 只读取 FactCard 中的 routing.* 基础层字段；
 * - 旧记录仅允许从眼科 legacy core aliases 回退，不读取左右眼数值、设备参数或运营指标；
 * - department / role / priority_hint / SLA 作为路由提示进入候选与 LLM 上下文；
 * - value_add_fields 不投影到编组总线，详细解析不完整不得阻断基础编组。
 *
 * R2.5：人工确认眼科项目优先于自动项目，但只调整候选排序/上下文。
 * R2.4：租户隔离、候选白名单、稳定排序与 invalid_candidate 护栏保持不变。
 */

import { PROMPT_VERSIONS } from "./prompts.js";

const SPATIOTEMPORAL_WINDOW_MIN = 120;
const MAX_CANDIDATES = 5;

const CORE_ROUTING_FIELD_NAMES = new Set([
  "routing.metadata_domain",
  "routing.exam_type",
  "routing.exam_item_name",
  "routing.event_type",
  "routing.event_title",
  "routing.clinic_id",
  "routing.patient_id",
  "routing.department",
  "routing.role",
  "routing.occurred_at",
  "routing.reported_at",
  "routing.basic_summary",
  "routing.item_tag",
  "routing.priority_hint",
  "routing.sla_target_minutes",
  "routing.routing_status",
  "routing.value_add_status",
  "routing.requires_reupload",
]);

const LEGACY_CORE_FIELD_NAMES = new Set([
  "eye_exam.exam_type",
  "eye_exam.exam_item_name",
  "eye_exam.exam_item_suggested_tag",
  "eye_exam.exam_item_manual_tag",
  "eye_exam.exam_item_manual_label",
  "eye_exam.match_exam_item",
  "eye_exam.measured_at",
  "eye_exam.routing_status",
  "eye_exam.value_add_status",
]);

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
  if (!clinicId) throw new Error("CandidateFinder: clinicId required（租户隔离强制）");
}

function assertSourceClinicMatch(source, clinicId) {
  if (!source) return;
  const srcClinic = source.clinic_id;
  if (!srcClinic) throw new Error("CandidateFinder: source clinic_id 缺失（租户隔离强制）");
  if (srcClinic !== clinicId) {
    throw new Error(`CandidateFinder: source clinic_id 不一致（source=${srcClinic}, scope=${clinicId}）`);
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

export function getCoreRoutingContext(factCard) {
  const manualTag = factCardFieldValue(factCard, "eye_exam.exam_item_manual_tag");
  const manualLabel = factCardFieldValue(factCard, "eye_exam.exam_item_manual_label");
  const suggestedTag = factCardFieldValue(factCard, "eye_exam.exam_item_suggested_tag");
  const legacyItemName = factCardFieldValue(factCard, "eye_exam.exam_item_name");
  const legacyMatchItem = factCardFieldValue(factCard, "eye_exam.match_exam_item");
  const routingItemTag = factCardFieldValue(factCard, "routing.item_tag");
  const routingDomain = factCardFieldValue(factCard, "routing.metadata_domain");
  const automaticItem = factCardFieldValue(factCard, "routing.exam_item_name") || legacyItemName;

  return {
    metadata_domain: routingDomain || (factCardFieldValue(factCard, "eye_exam.exam_type") ? "eye_exam" : null),
    exam_type: factCardFieldValue(factCard, "routing.exam_type") || factCardFieldValue(factCard, "eye_exam.exam_type") || null,
    exam_item_name: automaticItem || null,
    event_type: factCardFieldValue(factCard, "routing.event_type") || null,
    event_title: factCardFieldValue(factCard, "routing.event_title") || null,
    clinic_id: factCardFieldValue(factCard, "routing.clinic_id") || factCard?.clinic_id || null,
    patient_id: factCardFieldValue(factCard, "routing.patient_id") || factCard?.session_id || null,
    department: factCardFieldValue(factCard, "routing.department") || null,
    role: factCardFieldValue(factCard, "routing.role") || null,
    occurred_at: factCardFieldValue(factCard, "routing.occurred_at") || factCard?.occurred_at || null,
    reported_at: factCardFieldValue(factCard, "routing.reported_at") || null,
    basic_summary: factCardFieldValue(factCard, "routing.basic_summary") || null,
    item_tag: routingItemTag || manualTag || legacyMatchItem || suggestedTag || automaticItem || null,
    item_tag_source: manualTag ? "user_confirmed" : (routingItemTag || legacyMatchItem || suggestedTag || automaticItem ? "automatic" : null),
    manual_item_label: manualLabel || null,
    priority_hint: factCardFieldValue(factCard, "routing.priority_hint") || null,
    sla_target_minutes: factCardFieldValue(factCard, "routing.sla_target_minutes") || null,
    routing_status: factCardFieldValue(factCard, "routing.routing_status")
      || factCardFieldValue(factCard, "eye_exam.routing_status")
      || null,
    value_add_status: factCardFieldValue(factCard, "routing.value_add_status")
      || factCardFieldValue(factCard, "eye_exam.value_add_status")
      || null,
    requires_reupload: factCardFieldValue(factCard, "routing.requires_reupload") || null,
  };
}

export function getEyeExamMatchingContext(factCard) {
  const core = getCoreRoutingContext(factCard);
  return {
    manual_tag: core.item_tag_source === "user_confirmed" ? core.item_tag : null,
    manual_label: core.manual_item_label,
    suggested_tag: core.item_tag_source === "automatic" ? core.item_tag : null,
    automatic_exam_item_name: core.exam_item_name,
    effective_match_item: core.item_tag || core.exam_item_name || null,
    source: core.item_tag_source,
  };
}

export function coreRoutingFieldsForLlm(factCard) {
  return (factCard?.fields || [])
    .filter((field) => CORE_ROUTING_FIELD_NAMES.has(field?.field_name) || LEGACY_CORE_FIELD_NAMES.has(field?.field_name))
    .map((field) => ({ field_name: field.field_name, value: field.value }));
}

function collectWorkflowRoutingTags(workflow) {
  const directValues = [
    workflow?.expected_exam_item_tag,
    workflow?.exam_item_tag,
    workflow?.exam_item_manual_tag,
    workflow?.task_exam_item_tag,
    workflow?.expected_event_type,
    workflow?.event_type,
    workflow?.task_type,
  ];
  const listValues = [
    ...(Array.isArray(workflow?.expected_exam_item_tags) ? workflow.expected_exam_item_tags : []),
    ...(Array.isArray(workflow?.exam_item_tags) ? workflow.exam_item_tags : []),
    ...(Array.isArray(workflow?.expected_event_types) ? workflow.expected_event_types : []),
  ];
  return new Set([...directValues, ...listValues].map(normalizeTag).filter(Boolean));
}

function workflowMatchesItem(workflow, routingContext) {
  const effective = normalizeTag(routingContext?.item_tag || routingContext?.event_type || routingContext?.exam_item_name);
  return effective ? collectWorkflowRoutingTags(workflow).has(effective) : false;
}

function workflowMatchesDepartment(workflow, routingContext) {
  const expected = normalizeTag(routingContext?.department);
  if (!expected) return false;
  return [workflow?.department, workflow?.owning_department, workflow?.department_code]
    .map(normalizeTag)
    .filter(Boolean)
    .includes(expected);
}

function workflowMatchesRole(workflow, routingContext) {
  const expected = normalizeTag(routingContext?.role);
  if (!expected) return false;
  const roles = [
    workflow?.assignee_role,
    workflow?.expected_role,
    workflow?.owner_role,
    ...(Array.isArray(workflow?.eligible_roles) ? workflow.eligible_roles : []),
  ].map(normalizeTag).filter(Boolean);
  return roles.includes(expected);
}

function buildRoutingHints(routingContext) {
  return {
    assignment_role_hint: routingContext?.role || null,
    department_hint: routingContext?.department || null,
    priority_hint: routingContext?.priority_hint || null,
    sla_target_minutes: routingContext?.sla_target_minutes == null
      ? null
      : Number(routingContext.sla_target_minutes),
  };
}

export function deterministicCandidates({ artifact, factCard, workflows, clinicId }) {
  assertClinicId(clinicId);
  const source = artifact || factCard;
  if (!source) throw new Error("deterministicCandidates: source required");
  assertSourceClinicMatch(source, clinicId);
  if (!Array.isArray(workflows)) return [];

  const scoped = workflows.filter((w) => w.clinic_id === clinicId);
  const candidates = [];

  const explicitId = artifact?.source_workflow_id || factCard?.explicit_workflow_id;
  if (explicitId) {
    const hit = scoped.find((w) => w.id === explicitId);
    if (hit) {
      return [{
        workflow_id: hit.id,
        method: "explicit_id",
        score: 1.0,
        min_delta_ms: 0,
        reason: "显式绑定 explicit_workflow_id",
      }];
    }
  }

  const routingContext = getCoreRoutingContext(factCard);
  const capturedAt = routingContext.occurred_at || artifact?.captured_at || factCard?.occurred_at;
  if (capturedAt) {
    const ts = new Date(capturedAt).getTime();
    if (!Number.isNaN(ts)) {
      const windowMs = SPATIOTEMPORAL_WINDOW_MIN * 60 * 1000;
      for (const w of scoped) {
        const times = collectWorkflowTimes(w);
        if (times.length === 0) continue;
        const minDelta = Math.min(...times.map((pt) => Math.abs(pt - ts)));
        if (minDelta > windowMs) continue;

        const itemMatch = workflowMatchesItem(w, routingContext);
        const departmentMatch = workflowMatchesDepartment(w, routingContext);
        const roleMatch = workflowMatchesRole(w, routingContext);
        const coreMatchCount = [itemMatch, departmentMatch, roleMatch].filter(Boolean).length;
        const manualItemMatch = itemMatch && routingContext.item_tag_source === "user_confirmed";
        const score = Math.min(0.6 + (manualItemMatch ? 0.22 : itemMatch ? 0.08 : 0)
          + (departmentMatch ? 0.05 : 0) + (roleMatch ? 0.05 : 0), 0.92);
        const matched = [
          manualItemMatch ? "人工项目" : itemMatch ? "项目" : null,
          departmentMatch ? "部门" : null,
          roleMatch ? "岗位" : null,
        ].filter(Boolean);

        candidates.push({
          workflow_id: w.id,
          method: "spatiotemporal",
          score,
          min_delta_ms: minDelta,
          core_match_count: coreMatchCount,
          item_match_source: manualItemMatch ? "manual" : itemMatch ? "automatic" : null,
          routing_hints: buildRoutingHints(routingContext),
          reason: matched.length > 0
            ? `${matched.join("+")}基础路由字段匹配；最小时间差 ${Math.round(minDelta / 1000)}s`
            : `最小时间差 ${Math.round(minDelta / 1000)}s（仅候选，不自动挂接）`,
        });
      }
      candidates.sort((a, b) => {
        const aManual = a.item_match_source === "manual" ? 1 : 0;
        const bManual = b.item_match_source === "manual" ? 1 : 0;
        if (aManual !== bManual) return bManual - aManual;
        if (a.core_match_count !== b.core_match_count) return b.core_match_count - a.core_match_count;
        if (a.min_delta_ms !== b.min_delta_ms) return a.min_delta_ms - b.min_delta_ms;
        return a.workflow_id < b.workflow_id ? -1 : a.workflow_id > b.workflow_id ? 1 : 0;
      });
      if (candidates.length > MAX_CANDIDATES) candidates.length = MAX_CANDIDATES;
    }
  }

  return candidates;
}

export async function llmCandidateMatch({ factCard, candidateWorkflows, invokeLLM }) {
  if (!invokeLLM) throw new Error("llmCandidateMatch: invokeLLM required");
  if (!Array.isArray(candidateWorkflows) || candidateWorkflows.length === 0) {
    return { candidates: [], invalid: [] };
  }

  const whitelist = candidateWorkflows.map((w) => w.id);
  const routingContext = getCoreRoutingContext(factCard);
  const prompt = [
    "你是视光诊所工作流归属判定器。在给定候选 Workflow 白名单内选择最可能归属项。",
    "你只能使用 core_routing_fields 对应的 routing.* 字段。禁止使用左右眼数值、设备参数、投诉评分、培训指标、故障统计或其他 value_add_fields。",
    "详细解析缺失不得影响基础编组。best_workflow_id 必须来自白名单；输出仅为候选建议，不直接修改系统状态。",
    "人工确认的 item_tag 优先于自动项目名称。department、role、priority_hint 与 SLA 只作为路由/分配提示。",
    "",
    "基础路由上下文:",
    JSON.stringify(routingContext),
    "",
    "允许读取的 FactCard core 字段:",
    JSON.stringify(coreRoutingFieldsForLlm(factCard)),
    "",
    "候选 Workflow 白名单（≤5）:",
    JSON.stringify(candidateWorkflows.map((w) => ({
      id: w.id,
      workflow_family: w.workflow_family,
      subject_type: w.subject_type,
      expected_exam_item_tag: w.expected_exam_item_tag || w.exam_item_tag || null,
      expected_exam_item_tags: w.expected_exam_item_tags || w.exam_item_tags || [],
      expected_event_type: w.expected_event_type || w.event_type || null,
      department: w.department || w.owning_department || null,
      assignee_role: w.assignee_role || w.expected_role || null,
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
      invalid: [{ type: "invalid_candidate", workflow_id: returnedId, reason: "llm_returned_id_not_in_whitelist" }],
    };
  }

  return {
    candidates: [{
      workflow_id: returnedId,
      method: "llm",
      score: Math.min(result.confidence ?? 0, 1),
      confidence: result.confidence ?? null,
      reason: (result.reason_codes || []).join("; ") || "LLM 候选（仅记录）",
      routing_hints: buildRoutingHints(routingContext),
    }],
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
    const whitelistWorkflows = scoped.filter((w) => candidates.some((c) => c.workflow_id === w.id));
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
        existing.methods = Array.from(new Set([...(existing.methods || [existing.method]), "llm"]));
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
