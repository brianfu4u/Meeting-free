/**
 * Clinic OS V10 — 智能中枢（Intelligence Hub）
 *
 * V10 宪法合规（相比 V9 的根本修正）：
 * - TaskDraftSkill：不再直接创建 OperationalTask，改为生成 AttentionItem（journey_gap/resource_risk）
 *   店长在 Dashboard AttentionQueue 点击「执行」后，系统才创建 Task（唯一合法路径）
 * - PatrolSkill：不再直接创建 Alert，改为生成 AttentionItem
 * - EvidenceEvalSkill：eval_result 是证据评估本职结论，保留写入（属推理层存档非 state 变更）
 *   但对 insufficient/unqualified 额外生成 AttentionItem 提醒店长复核
 * - 全部技能携带 evidence_ids + event_ids（Explainability 原则）
 * - 不再使用已废弃的 dispatched_by:"llm_agent"
 */

import { base44 } from "@/api/base44Client";
import { publish, TRIGGER_TYPES } from "@/lib/eventBus";

const CLINIC_ID = "clinic-001";

// ─── Skill 1: 调度建议生成 ─────────────────────────────────────
// 扫描卡滞患者 + 空闲员工，LLM 生成建议，写入 AttentionItem（不创建 Task）
export async function runTaskDraftSkill() {
  const sessions = await base44.entities.PatientSession.filter({ clinic_id: CLINIC_ID }, "-arrival_time", 30);
  const staff = await base44.entities.Staff.filter({ clinic_id: CLINIC_ID }, "-checked_in_at", 30);

  const stalled = sessions.filter((s) => s.status === "stalled" || s.status === "seated");
  if (stalled.length === 0) {
    return { skill: "TaskDraftSkill", status: "idle", message: "无卡滞/候诊会话，无需生成调度建议", created: [] };
  }

  const idleStaff = staff.filter((s) => s.status === "on_duty");
  const busyStaff = staff.filter((s) => s.status === "busy");

  const prompt = `你是视光诊所运营调度助手（Clinic OS V10）。
宪法约束：你的输出只是建议，不产生任何实际系统变更。所有调度动作由店长人工确认后才执行。

当前门店 ${CLINIC_ID} 态势：
需要干预的患者会话（${stalled.length}条）：
${stalled.map((s) => `- 会话${s.id} | 患者:${s.patient_name || "未登记"} | 业务线:${s.business_line} | 状态:${s.status} | 节点:${s.current_node || "—"}`).join("\n")}
可用员工（空闲，${idleStaff.length}人）：
${idleStaff.map((s) => `- 员工${s.id} | ${s.staff_name} | 角色:${s.role} | 区域:${s.assigned_zone || "—"}`).join("\n")}
忙碌员工（${busyStaff.length}人）：
${busyStaff.map((s) => `- 员工${s.id} | ${s.staff_name} | 角色:${s.role}`).join("\n")}

请生成最多3条调度建议，每条包含：
- session_id：需要干预的会话ID
- attention_title：一句话标题（≤20字）
- urgency：yellow或red
- recommendation：建议调度动作（≤50字，需指明目标员工）
- reasoning：推理过程（为什么这个会话需要这个员工）

仅输出JSON：{"recommendations":[{"session_id":"","attention_title":"","urgency":"yellow","recommendation":"","reasoning":""}]}`;

  const res = await base44.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: "object",
      properties: {
        recommendations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              session_id: { type: "string" },
              attention_title: { type: "string" },
              urgency: { type: "string", enum: ["yellow", "red"] },
              recommendation: { type: "string" },
              reasoning: { type: "string" },
            },
          },
        },
      },
    },
  });

  const recs = res.recommendations || [];
  const created = [];
  const now = new Date().toISOString();
  for (const rec of recs.slice(0, 3)) {
    const event_id = `${CLINIC_ID}/m3-hub/system/task_draft_${Date.now()}_${created.length}`;
    const attn = await base44.entities.AttentionItem.create({
      clinic_id: CLINIC_ID,
      session_id: rec.session_id || null,
      attention_type: "journey_gap",
      urgency: rec.urgency || "yellow",
      title: rec.attention_title || "调度建议",
      reasoning: rec.reasoning || "",
      evidence_ids: [],
      event_ids: [event_id],
      recommendation: rec.recommendation || "",
      status: "open",
      generated_at: now,
    });
    created.push(attn);
    await publish("TaskDraftSkill_V10", TRIGGER_TYPES.ATTENTION_GENERATED || "ATTENTION_GENERATED", {
      clinic_id: CLINIC_ID,
      attention_item_id: attn.id,
      session_id: rec.session_id,
    });
  }

  return { skill: "TaskDraftSkill", status: "executed", message: `生成 ${created.length} 条调度建议，待店长在注意力队列决策`, created };
}

// ─── Skill 2: 全岗巡检 ─────────────────────────────────────
// 扫描全部实体，LLM 识别异常，写入 AttentionItem（不创建 Alert）
export async function runPatrolSkill() {
  const sessions = await base44.entities.PatientSession.filter({ clinic_id: CLINIC_ID }, "-arrival_time", 30);
  const staff = await base44.entities.Staff.filter({ clinic_id: CLINIC_ID }, "-checked_in_at", 30);
  const inventory = await base44.entities.InventoryItem.filter({ clinic_id: CLINIC_ID }, "-updated_date", 30);
  const openAttentions = await base44.entities.AttentionItem.filter({ clinic_id: CLINIC_ID, status: "open" }, "-generated_at", 20);

  const prompt = `你是视光诊所运营巡检助手（Clinic OS V10）。
宪法约束：你的输出只是建议，不产生任何实际系统变更。

患者会话（${sessions.length}条）：
${sessions.slice(0, 15).map((s) => `- ${s.id} | ${s.patient_name || "?"} | ${s.business_line} | 状态:${s.status} | 节点:${s.current_node || "?"}`).join("\n")}
员工状态（${staff.length}人）：
${staff.slice(0, 15).map((s) => `- ${s.staff_name} | ${s.role} | 状态:${s.status} | 区域:${s.assigned_zone || "?"}`).join("\n")}
库存（${inventory.length}项）：
${inventory.slice(0, 15).map((i) => `- ${i.item_name} | 数量:${i.quantity} | 阈值:${i.threshold} | ${i.below_threshold ? "⚠️低于阈值" : "正常"}`).join("\n")}
已有待处理建议（${openAttentions.length}条，避免重复）：
${openAttentions.map((a) => `- ${a.attention_type}: ${a.title}`).join("\n")}

请识别最多3个新异常，每个包含：
- attention_type：journey_gap/evidence_missing/contradiction/resource_risk/wait_timeout/staff_unresponsive
- urgency：yellow或red
- attention_title：标题（≤20字）
- recommendation：建议店长采取的行动（≤50字）
- reasoning：推理过程

仅输出JSON：{"findings":[{"attention_type":"resource_risk","urgency":"yellow","attention_title":"","recommendation":"","reasoning":""}]}`;

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
              attention_type: { type: "string" },
              urgency: { type: "string", enum: ["yellow", "red"] },
              attention_title: { type: "string" },
              recommendation: { type: "string" },
              reasoning: { type: "string" },
            },
          },
        },
      },
    },
  });

  const findings = res.findings || [];
  const created = [];
  const now = new Date().toISOString();
  for (const f of findings.slice(0, 3)) {
    const event_id = `${CLINIC_ID}/m3-hub/system/patrol_${Date.now()}_${created.length}`;
    const attn = await base44.entities.AttentionItem.create({
      clinic_id: CLINIC_ID,
      session_id: null,
      attention_type: f.attention_type || "resource_risk",
      urgency: f.urgency || "yellow",
      title: f.attention_title || "巡检发现异常",
      reasoning: f.reasoning || "",
      evidence_ids: [],
      event_ids: [event_id],
      recommendation: f.recommendation || "",
      status: "open",
      generated_at: now,
    });
    created.push(attn);
    await publish("PatrolSkill_V10", TRIGGER_TYPES.ATTENTION_GENERATED || "ATTENTION_GENERATED", {
      clinic_id: CLINIC_ID,
      attention_item_id: attn.id,
    });
  }

  return { skill: "PatrolSkill", status: "executed", message: `巡检完成，发现 ${created.length} 个新异常建议`, created };
}

// ─── Skill 3: 证据评估 ─────────────────────────────────────
// eval_result 是评估结论存档（保留写入，属推理层本职）
// 对不足/不合格证据额外生成 AttentionItem 提醒店长复核
export async function runEvidenceEvalSkill() {
  const evidence = await base44.entities.EvidenceItem.filter({ clinic_id: CLINIC_ID, eval_result: "pending" }, "-submitted_at", 10);

  if (evidence.length === 0) {
    return { skill: "EvidenceEvalSkill", status: "idle", message: "无待评估证据", created: [] };
  }

  const prompt = `你是视光诊所证据链审核助手（Clinic OS V10）。
宪法约束：你的评估结论是建议，不直接驳回员工提交。

待预审证据：
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
  const created = [];
  const now = new Date().toISOString();
  for (const ev of evaluations) {
    const match = evidence.find((e) => e.id === ev.evidence_id);
    if (!match) continue;
    const updated_item = await base44.entities.EvidenceItem.update(match.id, {
      eval_result: ev.eval_result,
      eval_notes: ev.eval_notes || "",
    });
    updated.push(updated_item);
    await publish("EvidenceEvalSkill_V10", TRIGGER_TYPES.EVIDENCE_EVALUATED, {
      clinic_id: CLINIC_ID,
      evidence_id: match.id,
      task_id: match.task_id,
      result: ev.eval_result,
    });

    // 不足/不合格 → 生成 AttentionItem 提醒店长复核
    if (ev.eval_result !== "qualified") {
      const event_id = `${CLINIC_ID}/m3-hub/system/evidence_eval_${Date.now()}_${created.length}`;
      const attn = await base44.entities.AttentionItem.create({
        clinic_id: CLINIC_ID,
        session_id: null,
        attention_type: "evidence_missing",
        urgency: "yellow",
        title: `证据${match.id.slice(-6)}预审${ev.eval_result === "insufficient" ? "不足" : "不合格"}`,
        reasoning: `LLM 评估说明：${ev.eval_notes || "无"}`,
        evidence_ids: [match.id],
        event_ids: [event_id],
        recommendation: `建议复核证据并决定是否要求员工补交（任务 ${match.task_id || "无"}）`,
        status: "open",
        generated_at: now,
      });
      created.push(attn);
    }
  }

  return { skill: "EvidenceEvalSkill", status: "executed", message: `完成 ${updated.length} 条证据预审，${created.length} 条触发店长复核建议`, created };
}