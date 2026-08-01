import { createClientFromRequest } from "npm:@base44/sdk@0.8.38";
import { bridgeEvidenceItemsRealtime } from "../../shared/evidenceArtifactBridge.ts";
import {
  buildOpsMetadataFromStaffReport,
  persistOpsMetadataAndProjectRouting,
} from "../../shared/opsEventMetadata/staffReportProjection.ts";

/**
 * Clinic OS V10 — StaffReportService（采集层 Collection Layer）
 *
 * V10 宪法合规说明：
 * - AI 职责严格限定为：观察证据 → 转化为结构化 Event → 生成 AttentionItem 建议
 * - AI 不再直接创建 OperationalTask 或 StaffRequest（违反 Human Authority 原则）
 * - AI 不再直接修改任何 clinic state
 * - 每条建议（AttentionItem）必须携带 evidence_ids + event_ids（Explainability 原则）
 * - 推理层不直接操作原始文件/图片（Evidence First 原则）
 *
 * 数据流：
 * 原始汇报 → EvidenceItem（证据存档）→ AuditLog（结构化 Event）
 * → LLM 分析 → OpsEventMetadata（core routing + value add）
 * → AttentionItem（建议卡片，仅供店长决策）
 * → 店长 execute 后 → Task 才被创建（由前端/Manager 动作触发，非本服务）
 */

type Attachment = { type?: string; url?: string; transcript?: string; name?: string };

function normalizeAttachments(raw: unknown): Attachment[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (a): a is Attachment => !!a && typeof a === "object" && !!(a as Attachment).url,
  );
}

function classifyEvidenceType(att: Attachment): "image" | "screenshot" | "voice" | "file" {
  if (att.type === "voice") return "voice";
  if (att.type === "file") return "file";
  if (att.type === "screenshot") return "screenshot";
  return "image";
}

async function archiveEvidence(
  svc: any,
  clinic_id: string,
  task_id: string | null,
  event_id: string,
  atts: Attachment[],
  staff_id: string,
  now: string,
): Promise<string[]> {
  const ids: string[] = [];
  for (const att of atts) {
    const ev = await svc.entities.EvidenceItem.create({
      clinic_id,
      ...(task_id ? { task_id } : {}),
      version_id: `v-${event_id}`,
      submission_count: 1,
      evidence_type: classifyEvidenceType(att),
      file_url: att.url as string,
      submitted_at: now,
      submitted_by: staff_id,
      eval_result: "pending",
      bridge_status: "pending",
      attempt_count: 0,
      ...(att.transcript ? { eval_notes: `语音转写：${att.transcript}` } : {}),
    });
    ids.push(ev.id);
  }
  return ids;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "未登录" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { report_type, task_id, text, staff_id, attachments } = body || {};

    if (!staff_id || !report_type) {
      return Response.json({ error: "参数缺失：staff_id / report_type 必填" }, { status: 400 });
    }
    if (!["new_event", "progress", "completion"].includes(report_type)) {
      return Response.json({ error: "report_type 必须为 new_event/progress/completion" }, { status: 400 });
    }

    const svc = base44.asServiceRole;

    let staff;
    try {
      staff = await svc.entities.Staff.get(staff_id);
    } catch {
      return Response.json({ error: "员工记录不存在" }, { status: 404 });
    }
    if (!staff || staff.user_id !== user.id) {
      return Response.json({ error: "宪法违规：终端未绑定该员工账号" }, { status: 403 });
    }
    const clinic_id = staff.clinic_id;
    const now = new Date().toISOString();
    const DEPT_CODE = { medical_core: "MED", front_sales: "FRT", back_support: "BCK" };
    const deptCode = DEPT_CODE[staff.role_group] || "GEN";
    const ymd = now.slice(0, 10).replace(/-/g, "");
    const eventTypeMap = {
      new_event: "report_submitted",
      progress: "progress_reported",
      completion: "completion_reported",
    };
    const event_id = `${ymd}/${clinic_id}/${deptCode}/${staff_id}/${eventTypeMap[report_type]}_${Date.now()}`;

    const atts = normalizeAttachments(attachments);
    const evidenceIds = await archiveEvidence(svc, clinic_id, task_id || null, event_id, atts, staff_id, now);

    const transcripts = atts.filter((a) => a.transcript).map((a) => a.transcript).join("\n");
    const combinedText = [text, transcripts].filter(Boolean).join("\n").trim();

    await svc.entities.AuditLog.create({
      clinic_id,
      event_id,
      timestamp: now,
      source_agent: "StaffReportService_V10",
      trigger_type: report_type === "new_event"
        ? "STAFF_REPORT_NEW_EVENT"
        : report_type === "progress"
        ? "STAFF_REPORT_PROGRESS"
        : "STAFF_REPORT_COMPLETION",
      payload: {
        report_type,
        task_id: task_id || null,
        staff_id,
        staff_name: staff.staff_name,
        text: combinedText,
        evidence_ids: evidenceIds,
        attachment_count: atts.length,
      },
    });

    let bridgeResults: unknown[] = [];
    try {
      const evidenceItems = await Promise.all(
        evidenceIds.map((id) => svc.entities.EvidenceItem.get(id)),
      );
      bridgeResults = await bridgeEvidenceItemsRealtime({
        svc,
        evidenceItems,
        sourceEventId: event_id,
        staff,
        now,
      });
    } catch {
      await svc.entities.AuditLog.create({
        clinic_id,
        event_id: `${event_id}/evidence-bridge/fatal`,
        timestamp: new Date().toISOString(),
        source_agent: "StaffReportService_V10",
        trigger_type: "EVIDENCE_ARTIFACT_BRIDGE_DISPATCH_FAILED",
        payload: {
          source_event_id: event_id,
          evidence_ids: evidenceIds,
          last_error_code: "internal_error",
          employee_report_preserved: true,
        },
      }).catch(() => undefined);
      bridgeResults = evidenceIds.map((id) => ({
        origin_evidence_item_id: id,
        bridge_status: "failed",
        last_error_code: "internal_error",
        employee_report_preserved: true,
      }));
    }

    const logEntry = {
      type: report_type,
      text: combinedText,
      attachments: atts,
      evidence_ids: evidenceIds,
      timestamp: now,
      staff_name: staff.staff_name,
    };

    if (task_id) {
      const task = await svc.entities.OperationalTask.get(task_id).catch(() => null);
      if (task && task.clinic_id === clinic_id) {
        const newLog = [...(Array.isArray(task.report_log) ? task.report_log : []), logEntry];

        if (report_type === "completion") {
          if (task.dispatched_by === "staff_self") {
            await svc.entities.OperationalTask.update(task_id, {
              status: "completed",
              report_log: newLog,
            });
          } else {
            await svc.entities.OperationalTask.update(task_id, { report_log: newLog });
          }
        } else {
          await svc.entities.OperationalTask.update(task_id, { report_log: newLog });
        }
      }
    }

    let aiParsed: Record<string, any> = {};
    let attentionItemId: string | null = null;

    const visionUrls: string[] = atts
      .filter((a) => a.type !== "voice")
      .map((a) => a.url)
      .filter((u): u is string => !!u);

    let structuredContext = "";
    const structuredAtts = atts.filter(
      (a) => a.type === "file" && /\.(csv|xlsx|xls|json|html)$/i.test(`${a.name || ""} ${a.url || ""}`),
    );
    for (const sa of structuredAtts.slice(0, 2)) {
      try {
        const extracted = await svc.integrations.Core.ExtractDataFromUploadedFile({
          file_url: sa.url as string,
          json_schema: {
            type: "object",
            properties: {
              rows: { type: "array", items: { type: "object", additionalProperties: true } },
            },
          },
        });
        if (extracted && extracted.status === "success" && extracted.output) {
          const compact = JSON.stringify(extracted.output).slice(0, 1200);
          structuredContext += `\n[结构化文件 ${sa.name || ""} 抽取行数据]\n${compact}`;
        }
      } catch {
        // 抽取失败则降级，仅靠视觉模型识图
      }
    }

    if (combinedText || atts.length > 0) {
      try {
        const llmRes = await svc.integrations.Core.InvokeLLM({
          file_urls: visionUrls.length > 0 ? visionUrls : undefined,
          prompt: `你是视光诊所运营助理（Clinic OS V10）。

宪法约束：你的输出只是结构化记录和建议，不产生任何实际系统变更。所有决策由店长人工确认后才执行。

请把结果分成两层：
1. 基础编组信息：event_type、event_title、summary、priority_hint、sla_target_minutes；
2. 增值详细信息：仅在原始证据明确出现时填写 value_add_fields。禁止猜测培训时长、人数、投诉评分、流程节点、故障次数或停机时长。

你可能收到附带的图片/截图/PDF（file_urls）及结构化表格抽取结果，请结合视觉与文本一并研判。

汇报类型：${report_type}
汇报内容：${combinedText || "（仅附件，无文字）"}
员工：${staff.staff_name}（${staff.role}）
部门代号：${deptCode}（${staff.assigned_zone || staff.role_group || "未分配"}）
附件数量：${atts.length}

输出 JSON：
{
  "event_type": "complaint|training|equipment_failure|resource_request|progress_update|completion|staff_coordination|other",
  "event_title": "事件标题（≤30字）",
  "category": "任务进度|异常事件|资源需求|人员协作|其他",
  "urgency": "yellow|red",
  "priority_hint": "P0|P1|P2|P3",
  "sla_target_minutes": 数字或null,
  "summary": "一句话基础摘要（≤30字，不含诊疗结论）",
  "marquee_label": "供走马灯播放的事件概括，须涵盖时间/地点/人物/动作，≤24字",
  "needs_manager_attention": true或false,
  "attention_title": "需要店长注意时的标题（≤20字）",
  "recommendation": "建议店长采取的行动（≤50字）",
  "reasoning": "为什么需要或不需要店长关注的推理过程",
  "value_add_fields": {
    "training_duration_minutes": 数字或null,
    "participant_count": 数字或null,
    "complaint_severity_score": 数字或null,
    "involved_process_nodes": ["明确出现的流程节点"],
    "equipment_failure_count": 数字或null,
    "downtime_minutes": 数字或null,
    "equipment_id": "明确出现的设备编号或null",
    "training_topic": "明确出现的培训主题或null",
    "complaint_channel": "明确出现的投诉渠道或null",
    "additional_metrics": {}
  }
}${structuredContext ? "\n\n[结构化附件抽取]\n" + structuredContext : ""}`,
          response_json_schema: {
            type: "object",
            properties: {
              event_type: { type: "string", enum: ["complaint", "training", "equipment_failure", "resource_request", "progress_update", "completion", "staff_coordination", "other"] },
              event_title: { type: "string" },
              category: { type: "string" },
              urgency: { type: "string", enum: ["yellow", "red"] },
              priority_hint: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
              sla_target_minutes: { type: "number" },
              summary: { type: "string" },
              marquee_label: { type: "string" },
              needs_manager_attention: { type: "boolean" },
              attention_title: { type: "string" },
              recommendation: { type: "string" },
              reasoning: { type: "string" },
              value_add_fields: {
                type: "object",
                properties: {
                  training_duration_minutes: { type: "number" },
                  participant_count: { type: "number" },
                  complaint_severity_score: { type: "number" },
                  involved_process_nodes: { type: "array", items: { type: "string" } },
                  equipment_failure_count: { type: "number" },
                  downtime_minutes: { type: "number" },
                  equipment_id: { type: "string" },
                  training_topic: { type: "string" },
                  complaint_channel: { type: "string" },
                  additional_metrics: { type: "object", additionalProperties: true },
                },
              },
            },
          },
        });
        aiParsed = llmRes || {};
      } catch {
        aiParsed = { summary: "LLM 解析失败，已原文存档", needs_manager_attention: false };
      }

      if (aiParsed.needs_manager_attention) {
        const attnType = report_type === "completion" ? "evidence_missing" : "journey_gap";
        const created = await svc.entities.AttentionItem.create({
          clinic_id,
          session_id: null,
          attention_type: attnType,
          urgency: aiParsed.urgency || "yellow",
          title: aiParsed.attention_title || aiParsed.summary || "员工汇报需关注",
          reasoning: aiParsed.reasoning || "",
          evidence_ids: evidenceIds,
          event_ids: [event_id],
          recommendation: aiParsed.recommendation || "",
          status: "open",
          generated_at: now,
        });
        attentionItemId = created.id;
      }
    }

    // OpsEventMetadata is persisted for every staff report, even when the LLM
    // failed or no value-add metrics were found. Core routing remains usable;
    // detailed metrics can be partial/unavailable without blocking assembly.
    let opsEventMetadataRecord: any = null;
    let opsRoutingFactCardIds: string[] = [];
    try {
      const opsMetadata = buildOpsMetadataFromStaffReport({
        clinic_id,
        event_id,
        report_type,
        combined_text: combinedText,
        staff,
        ai_parsed: aiParsed,
        evidence_ids: evidenceIds,
        bridge_results: bridgeResults,
        now,
      });
      const persisted = await persistOpsMetadataAndProjectRouting({
        svc,
        metadata: opsMetadata,
        bridge_results: bridgeResults,
        created_at: now,
      });
      opsEventMetadataRecord = persisted.record;
      opsRoutingFactCardIds = persisted.projected_fact_card_ids;
    } catch (error) {
      await svc.entities.AuditLog.create({
        clinic_id,
        event_id: `${event_id}/ops-metadata/failure`,
        timestamp: new Date().toISOString(),
        source_agent: "StaffReportService_V10",
        trigger_type: "OPS_EVENT_METADATA_PERSIST_FAILED",
        payload: {
          source_event_id: event_id,
          error_code: "ops_event_metadata_persist_failed",
          employee_report_preserved: true,
        },
      }).catch(() => undefined);
    }

    let selfTaskId: string | null = null;
    if (report_type === "new_event" && !task_id) {
      const workDesc = combinedText || `（${atts.length}个附件汇报）`;
      const selfTask = await svc.entities.OperationalTask.create({
        clinic_id,
        attention_item_id: attentionItemId || null,
        priority: aiParsed.urgency === "red" ? "P2" : "P3",
        dispatched_by: "staff_self",
        assignee_staff_id: staff_id,
        description: workDesc + (aiParsed.summary ? `\n[AI摘要] ${aiParsed.summary}` : ""),
        status: "completed",
        report_attachments: atts,
        ai_parsed: aiParsed,
        report_log: [logEntry],
      });
      selfTaskId = selfTask.id;
    }

    return Response.json({
      ok: true,
      event_id,
      evidence_ids: evidenceIds,
      evidence_bridge: bridgeResults,
      ai_parsed: aiParsed,
      ops_event_metadata_id: opsEventMetadataRecord?.id || null,
      ops_event_routing_status: opsEventMetadataRecord?.routing_status || null,
      ops_event_value_add_status: opsEventMetadataRecord?.value_add_status || null,
      ops_routing_fact_card_ids: opsRoutingFactCardIds,
      attention_item_id: attentionItemId,
      self_task_id: selfTaskId,
      v10_note: "AI 仅生成结构化记录与建议；所有 clinic state 变更需店长确认后执行",
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
});
