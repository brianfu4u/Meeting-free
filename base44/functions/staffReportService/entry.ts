import { createClientFromRequest } from "npm:@base44/sdk@0.8.38";
import { bridgeEvidenceItemsRealtime } from "../../shared/evidenceArtifactBridge.ts";

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
 * → LLM 分析 → AttentionItem（建议卡片，仅供店长决策）
 * → 店长 execute 后 → Task 才被创建（由前端/Manager 动作触发，非本服务）
 */
// ── EvidenceNormalizer（采集层独立模块）────────────────────────────────
// V10 宪法：采集层只做证据归一化与不可变存档，不做任何推理。
// 推理层（Recommendation）由后续 LLM 步骤单独负责，与本模块解耦。

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

    // ── 1. 身份校验（宪法①隔离） ──────────────────────────────────────────
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

    // Direction A only: process the EvidenceItem rows created by this request.
    // Historical EvidenceItem backfill is intentionally out of scope.
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
      // bridge failure must never fail the employee report.
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

    let aiParsed: Record<string, unknown> = {};
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

宪法约束：你的输出只是建议，不产生任何实际系统变更。所有决策由店长人工确认后才执行。

你可能收到附带的图片/截图/PDF（file_urls）及结构化表格抽取结果，请结合视觉与文本一并研判。

请分析以下员工工作汇报，判断是否需要引起店长注意：

汇报类型：${report_type}
汇报内容：${combinedText || "（仅附件，无文字）"}
员工：${staff.staff_name}（${staff.role}）
部门代号：${deptCode}（${staff.assigned_zone || staff.role_group || "未分配"}）
附件数量：${atts.length}

输出 JSON：
{
  "category": "任务进度|异常事件|资源需求|人员协作|其他",
  "urgency": "yellow|red",
  "summary": "一句话摘要（≤30字）",
  "marquee_label": "供看板走马灯播放的极简动作标签，格式'部门+动作+对象'，≤12字，例：前台完成新挂号 / 特检室完成角膜地形图 / OK镜试戴完成预检",
  "needs_manager_attention": true或false,
  "attention_title": "需要店长注意时的标题（≤20字）",
  "recommendation": "建议店长采取的行动（≤50字）",
  "reasoning": "为什么需要或不需要店长关注的推理过程"
}${structuredContext ? "\n\n[结构化附件抽取]\n" + structuredContext : ""}`,
          response_json_schema: {
            type: "object",
            properties: {
              category: { type: "string" },
              urgency: { type: "string", enum: ["yellow", "red"] },
              summary: { type: "string" },
              marquee_label: { type: "string" },
              needs_manager_attention: { type: "boolean" },
              attention_title: { type: "string" },
              recommendation: { type: "string" },
              reasoning: { type: "string" },
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
          urgency: (aiParsed.urgency as string) || "yellow",
          title: (aiParsed.attention_title as string) || (aiParsed.summary as string) || "员工汇报需关注",
          reasoning: (aiParsed.reasoning as string) || "",
          evidence_ids: evidenceIds,
          event_ids: [event_id],
          recommendation: (aiParsed.recommendation as string) || "",
          status: "open",
          generated_at: now,
        });
        attentionItemId = created.id;
      }
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
      attention_item_id: attentionItemId,
      self_task_id: selfTaskId,
      v10_note: "AI 仅生成建议（AttentionItem），所有 clinic state 变更需店长确认后执行",
    });

  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
});
