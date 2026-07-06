/**
 * Clinic OS V9 M3 — 智能中枢（Intelligence Hub）
 * 三大 LLM 技能，业务逻辑与 UI 解耦，可独立迁移至私有云。
 *
 * 宪法锚点：
 *  - TaskDraftSkill  → A3 系统逻辑触发（拥堵/卡滞自动生成调度草案）
 *  - PatrolSkill     → A3 系统逻辑触发（全岗巡检异常发现）
 *  - EvidenceEvalSkill → A1 交叉验证（证据链预审）
 *
 * 所有技能强制携带 clinic_id，产出写入对应实体并经 Event Bus 记录。
 */

import { base44 } from "@/api/base44Client";
import { publish, TRIGGER_TYPES } from "@/lib/eventBus";

const CLINIC_ID = "clinic-001";

// ─── Skill 1: 任务草案生成 ─────────────────────────────────────
// 扫描卡滞患者 + 忙碌员工，LLM 生成调度建议，写入 OperationalTask
export async function runTaskDraftSkill() {
  const sessions = await base44.entities.PatientSession.filter({ clinic_id: CLINIC_ID }, "-arrival_time", 30);
  const staff = await base44.entities.Staff.filter({ clinic_id: CLINIC_ID }, "-checked_in_at", 30);

  // 筛选需要干预的会话：卡滞或候诊超时
  const stalled = sessions.filter((s) => s.status === "stalled" || s.status === "seated");
  if (stalled.length === 0) {
    return { skill: "TaskDraftSkill", status: "idle", message: "无卡滞/候诊会话，无需生成调度草案", created: [] };
  }

  const idleStaff = staff.filter((s) => s.status === "on_duty");
  const busyStaff = staff.filter((s) => s.status === "busy");

  const prompt = `你是视光诊所运营调度AI。当前门店 ${CLINIC_ID} 有以下态势：

需要干预的患者会话（${stalled.length}条）：
${stalled.map((s) => `- 会话${s.id} | 患者:${s.patient_name || "未登记"} | 业务线:${s.business_line} | 状态:${s.status} | 当前节点:${s.current_node || "—"}`).join("\n")}

可用员工（空闲，${idleStaff.length}人）：
${idleStaff.map((s) => `- 员工${s.id} | ${s.staff_name} | 角色:${s.role} | 区域:${s.assigned_zone || "—"}`).join("\n")}

忙碌员工（${busyStaff.length}人）：
${busyStaff.map((s) => `- 员工${s.id} | ${s.staff_name} | 角色:${s.role}`).join("\n")}

请生成最多3条调度任务草案，每条包含：assignee_staff_id（从空闲员工中选）、description（任务描述）、priority（P1-P4）、patient_session_id。
仅输出JSON，格式：{"drafts":[{"assignee_staff_id":"","description":"","priority":"P2","patient_session_id":""}]}`;

  const res = await base44.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: "object",
      properties: {
        drafts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              assignee_staff_id: { type: "string" },
              description: { type: "string" },
              priority: { type: "string", enum: ["P1", "P2", "P3", "P4"] },
              patient_session_id: { type: "string" },
            },
          },
        },
      },
    },
  });

  const drafts = res.drafts || [];
  const created = [];
  for (const draft of drafts.slice(0, 3)) {
    const task = await base44.entities.OperationalTask.create({
      clinic_id: CLINIC_ID,
      priority: draft.priority || "P3",
      dispatched_by: "llm_agent",
      assignee_staff_id: draft.assignee_staff_id || "",
      description: draft.description || "LLM调度草案",
      patient_session_id: draft.patient_session_id || "",
      status: "pending_approval",
    });
    created.push(task);
    await publish("TaskDraftSkill", TRIGGER_TYPES.TASK_DRAFTED, {
      clinic_id: CLINIC_ID,
      task_id: task.id,
      description: task.description,
      priority: task.priority,
    });
  }

  return { skill: "TaskDraftSkill", status: "executed", message: `生成 ${created.length} 条调度草案，待店长审批`, created };
}

// ─── Skill 2: 全岗巡检 ─────────────────────────────────────
// 扫描全部实体，LLM 识别异常，写入 Alert
export async function runPatrolSkill() {
  const sessions = await base44.entities.PatientSession.filter({ clinic_id: CLINIC_ID }, "-arrival_time", 30);
  const staff = await base44.entities.Staff.filter({ clinic_id: CLINIC_ID }, "-checked_in_at", 30);
  const inventory = await base44.entities.InventoryItem.filter({ clinic_id: CLINIC_ID }, "-updated_date", 30);
  const existingAlerts = await base44.entities.Alert.filter({ clinic_id: CLINIC_ID, status: "triggered" }, "-created_at", 20);

  const prompt = `你是视光诊所运营巡检AI。请分析以下全岗态势，识别需要店长关注的异常：

患者会话（${sessions.length}条）：
${sessions.slice(0, 15).map((s) => `- ${s.id} | ${s.patient_name || "?"} | ${s.business_line} | 状态:${s.status} | 节点:${s.current_node || "?"}`).join("\n")}

员工状态（${staff.length}人）：
${staff.slice(0, 15).map((s) => `- ${s.staff_name} | ${s.role} | 状态:${s.status} | 区域:${s.assigned_zone || "?"}`).join("\n")}

库存（${inventory.length}项）：
${inventory.slice(0, 15).map((i) => `- ${i.item_name} | 数量:${i.quantity} | 阈值:${i.threshold} | ${i.below_threshold ? "⚠️低于阈值" : "正常"}`).join("\n")}

已有活跃告警（${existingAlerts.length}条，避免重复）：
${existingAlerts.map((a) => `- ${a.alert_type}: ${a.message}`).join("\n")}

请识别最多3个新异常，每个包含：alert_type、urgency（yellow/red）、message（中文描述）、llm_suggestion（处置建议）。
仅输出JSON：{"findings":[{"alert_type":"","urgency":"yellow","message":"","llm_suggestion":""}]}`;

  const res = await base44.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: "object",
      properties: {
        findings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              alert_type: { type: "string" },
              urgency: { type: "string", enum: ["yellow", "red"] },
              message: { type: "string" },
              llm_suggestion: { type: "string" },
            },
          },
        },
      },
    },
  });

  const findings = res.findings || [];
  const created = [];
  for (const f of findings.slice(0, 3)) {
    const alert = await base44.entities.Alert.create({
      clinic_id: CLINIC_ID,
      alert_type: f.alert_type || "patrol_finding",
      urgency: f.urgency || "yellow",
      message: f.message || "巡检发现异常",
      llm_suggestion: f.llm_suggestion || "",
      status: "triggered",
      created_at: new Date().toISOString(),
    });
    created.push(alert);
    await publish("PatrolSkill", TRIGGER_TYPES.ALERT_TRIGGERED, {
      clinic_id: CLINIC_ID,
      alert_id: alert.id,
      alert_type: alert.alert_type,
      urgency: alert.urgency,
    });
  }

  return { skill: "PatrolSkill", status: "executed", message: `巡检完成，发现 ${created.length} 个新异常`, created };
}

// ─── Skill 3: 证据评估 ─────────────────────────────────────
// 读取待评估证据，LLM 预审，更新 EvidenceItem.eval_result
export async function runEvidenceEvalSkill() {
  const evidence = await base44.entities.EvidenceItem.filter({ clinic_id: CLINIC_ID, eval_result: "pending" }, "-submitted_at", 10);

  if (evidence.length === 0) {
    return { skill: "EvidenceEvalSkill", status: "idle", message: "无待评估证据", created: [] };
  }

  const prompt = `你是视光诊所证据链审核AI。以下证据待预审：

${evidence.map((e) => `- 证据${e.id} | 任务:${e.task_id} | 类型:${e.evidence_type} | 版本:${e.version_id} | 提交次数:${e.submission_count}`).join("\n")}

请对每条证据给出预审结论：qualified（合格）/ insufficient（不足）/ unqualified（不合格），并附简要说明。
仅输出JSON：{"evaluations":[{"evidence_id":"","eval_result":"qualified","eval_notes":""}]}`;

  const res = await base44.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: "object",
      properties: {
        evaluations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              evidence_id: { type: "string" },
              eval_result: { type: "string", enum: ["qualified", "insufficient", "unqualified"] },
              eval_notes: { type: "string" },
            },
          },
        },
      },
    },
  });

  const evaluations = res.evaluations || [];
  const updated = [];
  for (const ev of evaluations) {
    const match = evidence.find((e) => e.id === ev.evidence_id);
    if (!match) continue;
    const updated_item = await base44.entities.EvidenceItem.update(match.id, {
      eval_result: ev.eval_result,
      eval_notes: ev.eval_notes || "",
    });
    updated.push(updated_item);
    await publish("EvidenceEvalSkill", TRIGGER_TYPES.EVIDENCE_EVALUATED, {
      clinic_id: CLINIC_ID,
      evidence_id: match.id,
      task_id: match.task_id,
      result: ev.eval_result,
    });
  }

  return { skill: "EvidenceEvalSkill", status: "executed", message: `完成 ${updated.length} 条证据预审`, created: updated };
}