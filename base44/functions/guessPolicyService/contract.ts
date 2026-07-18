/**
 * Clinic OS V10 — GuessPolicy 共享契约（唯一权威源，pure TS，无运行时依赖）
 *
 * 本文件是 GuessPolicy 校验/迁移逻辑的单一事实来源：
 * - 后端 entry.ts 通过 `import ... from "./contract.ts"` 复用；
 * - 前端 vitest 通过相对路径导入做契约一致性（parity）测试；
 * - 任何规则码/轨道定义变更必须在此修改，并通过 contract.parity.test.js
 *   断言与 src/lib/composition/prompts.js 的 TRACK_IDS 一致。
 *
 * 禁止在其它任何位置复制 KNOWN/PUBLISHABLE_RULE_CODES、TRACK_IDS、
 * migrateHardGuardrails、validatePolicyForPublish 等定义。
 */

export const CONTRACT_VERSION = "policy-contract-v1";

export const KNOWN_RULE_CODES = [
  "subject_conflict",
  "time_impossible",
  "attach_to_closed_workflow",
  "legacy_text",
];

/** 可正常发布的 rule_code（legacy_text 仅作运行期阻断标记，不可发布） */
export const PUBLISHABLE_RULE_CODES = [
  "subject_conflict",
  "time_impossible",
  "attach_to_closed_workflow",
];

/**
 * 七条推断轨道。此处的 TRACK_IDS 是 GuessPolicy 校验的权威定义。
 * src/lib/composition/prompts.js 中的 TRACK_IDS 是编组引擎 Schema 的权威定义。
 * 二者必须一致，由 contract.parity.test.js 强制断言。
 */
export const TRACK_IDS = [
  "subject_fingerprint",
  "causal_chain",
  "temporal_continuity",
  "department_handoff",
  "actor_device_location",
  "document_lineage",
  "open_loop_closure",
];

/**
 * 规则描述符：前端发布面板按描述符渲染与构造提交体，不得识别具体 rule_code。
 * 每个描述符含 rule_code、中文 label、description、参数 schema（含 default）。
 */
export const RULE_DESCRIPTORS: {
  rule_code: string;
  label: string;
  description: string;
  params: { name: string; type: "number" | "string" | "boolean"; required: boolean; default?: any }[];
}[] = [
  { rule_code: "subject_conflict", label: "主体冲突", description: "同一编组内出现不同高可信主体指纹即阻断", params: [] },
  {
    rule_code: "time_impossible",
    label: "时间不可能",
    description: "证物发生时间超出工作流起点最大间隔或为未来即阻断",
    params: [{ name: "max_gap_minutes", type: "number", required: false, default: 1440 }],
  },
  { rule_code: "attach_to_closed_workflow", label: "挂接到已关闭工作流", description: "目标工作流无开放环节时禁止挂接", params: [] },
];

/**
 * 轨道描述符：前端按描述符渲染轨道，name/description 来自契约，不硬编码。
 */
export const TRACK_DESCRIPTORS: { track_id: string; name: string; description: string }[] = [
  { track_id: "subject_fingerprint", name: "主体指纹线", description: "姓名片段、年龄、性别、眼别、医生、日期、病历号等组合线索" },
  { track_id: "causal_chain", name: "临床/业务因果线", description: "请求→执行→结果→复核→下一步" },
  { track_id: "temporal_continuity", name: "时间连续线", description: "发生时间、顺序、合理间隔、跨日" },
  { track_id: "department_handoff", name: "部门接力线", description: "部门间交接方向，允许跳步/回流" },
  { track_id: "actor_device_location", name: "人员/设备/地点连续线", description: "上传员工、执行医生、设备、诊室" },
  { track_id: "document_lineage", name: "文档血缘线", description: "资料中重复或延续的姓名、眼别、报告编号" },
  { track_id: "open_loop_closure", name: "开放环节闭合线", description: "新碎片能否闭合现有 Workflow 开放环节" },
];

/** 允许原地 update 的状态：仅 draft/reviewed；published/retired 必须通过 publish 新版本 */
export const UPDATABLE_STATUSES = ["draft", "reviewed"];

export function canUpdatePolicy(status: string | undefined | null): boolean {
  return !!status && UPDATABLE_STATUSES.includes(status);
}

/**
 * 纯函数租户授权：店长为 ClinicConfig.created_by_id，或 manager_id 绑定的 Staff.user_id 等于当前用户。
 * entry.ts 负责拉取 configs + staff 后注入；本函数可被 vitest 直接测试。
 */
export function isAuthorizedForClinicPure(
  user: { id: string } | null | undefined,
  clinicConfigs: any[],
  staffByManagerId: Map<string, any>
): boolean {
  if (!user?.id) return false;
  if (!clinicConfigs || clinicConfigs.length === 0) return false;
  if (clinicConfigs.some((c: any) => c.created_by_id === user.id)) return true;
  for (const c of clinicConfigs) {
    if (!c.manager_id) continue;
    const staff = staffByManagerId.get(c.manager_id);
    if (staff && staff.user_id === user.id) return true;
  }
  return false;
}

export function migrateHardGuardrails(guardrails: any[]): any[] {
  if (!Array.isArray(guardrails)) return [];
  return guardrails.map((g) => {
    if (typeof g === "string") {
      return { rule_code: "legacy_text", original: g };
    }
    if (g && typeof g === "object" && !Array.isArray(g)) {
      if (g.rule_code && KNOWN_RULE_CODES.includes(g.rule_code)) return g;
      return { rule_code: "legacy_text", original: JSON.stringify(g) };
    }
    return { rule_code: "legacy_text", original: String(g) };
  });
}

export function validatePolicyTracks(policy: any) {
  const errors: string[] = [];
  const tracks = policy?.tracks;
  if (tracks == null) return { valid: true, errors };
  if (!Array.isArray(tracks)) return { valid: false, errors: ["tracks must be array"] };
  const known = new Set(TRACK_IDS);
  const seen = new Set<string>();
  tracks.forEach((t: any, i: number) => {
    if (!t || typeof t !== "object" || Array.isArray(t)) {
      errors.push(`tracks[${i}] must be object`);
      return;
    }
    if (!t.track_id || typeof t.track_id !== "string") {
      errors.push(`tracks[${i}].track_id missing`);
      return;
    }
    if (!known.has(t.track_id)) {
      errors.push(`tracks[${i}].track_id unknown: ${t.track_id}（固定七轨道不可替换/新增）`);
    }
    if (seen.has(t.track_id)) {
      errors.push(`tracks[${i}].track_id duplicate: ${t.track_id}`);
    }
    seen.add(t.track_id);
  });
  return { valid: errors.length === 0, errors };
}

export function validateGuessPolicy(policy: any) {
  const errors: string[] = [];
  if (!policy || typeof policy !== "object") {
    return { valid: false, errors: ["policy must be object"] };
  }
  const guardrails = policy.hard_guardrails;
  if (guardrails == null) return { valid: true, errors };
  if (!Array.isArray(guardrails)) {
    return { valid: false, errors: ["hard_guardrails must be array"] };
  }
  guardrails.forEach((g: any, i: number) => {
    if (!g || typeof g !== "object" || Array.isArray(g)) {
      errors.push(`hard_guardrails[${i}] must be object`);
      return;
    }
    if (!g.rule_code || typeof g.rule_code !== "string") {
      errors.push(`hard_guardrails[${i}].rule_code missing`);
      return;
    }
    if (!KNOWN_RULE_CODES.includes(g.rule_code)) {
      errors.push(`hard_guardrails[${i}].rule_code unknown: ${g.rule_code}`);
    }
  });
  return { valid: errors.length === 0, errors };
}

export function validatePolicyForPublish(policy: any) {
  const errors: string[] = [];
  if (!policy || typeof policy !== "object") {
    return { valid: false, errors: ["policy must be object"] };
  }
  const guardrails = policy.hard_guardrails;
  if (guardrails != null) {
    if (!Array.isArray(guardrails)) {
      return { valid: false, errors: ["hard_guardrails must be array"] };
    }
    guardrails.forEach((g: any, i: number) => {
      if (!g || typeof g !== "object" || Array.isArray(g)) {
        errors.push(`hard_guardrails[${i}] must be object`);
        return;
      }
      if (!g.rule_code || typeof g.rule_code !== "string") {
        errors.push(`hard_guardrails[${i}].rule_code missing`);
        return;
      }
      if (!PUBLISHABLE_RULE_CODES.includes(g.rule_code)) {
        errors.push(`hard_guardrails[${i}].rule_code not publishable: ${g.rule_code}`);
      }
    });
  }
  const tc = validatePolicyTracks(policy);
  return { valid: errors.length === 0 && tc.valid, errors: [...errors, ...tc.errors] };
}

export function buildContract() {
  return {
    contract_version: CONTRACT_VERSION,
    known_rule_codes: KNOWN_RULE_CODES,
    publishable_rule_codes: PUBLISHABLE_RULE_CODES,
    rule_descriptors: RULE_DESCRIPTORS,
    track_ids: TRACK_IDS,
    track_descriptors: TRACK_DESCRIPTORS,
    updatable_statuses: UPDATABLE_STATUSES,
  };
}