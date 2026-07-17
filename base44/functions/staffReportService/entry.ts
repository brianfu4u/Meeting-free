import { createClientFromRequest } from "npm:@base44/sdk@0.8.38";

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
    // V10 Event Bus 命名规范：{clinic_id}/{terminal_type}/{staff_id}/{event_type}
    const eventTypeMap = {
      new_event: "report_submitted",
      progress: "progress_reported",
      completion: "completion_reported",
    };
    const event_id = `${clinic_id}/staff-pad/${staff_id}/${eventTypeMap[report_type]}_${Date.now()}`;

    // ── 2. 采集层：归一化附件，不做推理 ──────────────────────────────────────
    const atts = Array.isArray(attachments) ? attachments : [];

    // ── 3. 证据存档：每个附件创建 EvidenceItem（不可变，不做推理）───────────
    const evidenceIds: string[] = [];
    for (const att of atts) {
      if (att.url) {
        const ev = await svc.entities.EvidenceItem.create({
          clinic_id,
          task_id: task_id || null,
          version_id: `v-${event_id}`,
          submission_count: 1,
          evidence_type: att.type === "voice" ? "voice" : att.type === "file" ? "file" : "image",
          file_url: att.url,
          submitted_at: now,
          submitted_by: staff_id,
          eval_result: "pending",
          eval_notes: att.transcript ? `语音转写：${att.transcript}` : null,
        });
        evidenceIds.push(ev.id);
      }
    }

    // ── 4. 结构化 Event：将汇报转化为 AuditLog 条目（系统语言） ─────────────
    const transcripts = atts.filter((a) => a.transcript).map((a) => a.transcript).join("\n");
    const combinedText = [text, transcripts].filter(Boolean).join("\n").trim();

    const auditEntry = await svc.entities.AuditLog.create({
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

    // ── 5. 若有关联 Task，更新其 report_log（仅追加日志，不改变状态） ───────
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
          // 员工自主工作（staff_self）完成：可以自核销，因为原本就无需店长批准
          if (task.dispatched_by === "staff_self") {
            await svc.entities.OperationalTask.update(task_id, {
              status: "completed",
              report_log: newLog,
            });
          } else {
            // 管理层派发的任务完成汇报：只更新日志，状态变更等待店长确认
            // 同时生成 AttentionItem 提醒店长来核销
            await svc.entities.OperationalTask.update(task_id, {
              report_log: newLog,
            });
          }
        } else {
          // progress / new_event：只追加日志
          await svc.entities.OperationalTask.update(task_id, {
            report_log: newLog,
          });
        }
      }
    }

    // ── 6. 推理层：LLM 分析（仅生成建议，不产生任何 clinic state 变更） ─────
    let aiParsed: Record<string, unknown> = {};
    let attentionItemId: string | null = null;

    if (combinedText || atts.length > 0) {
      try {
        const llmRes = await svc.integrations.Core.InvokeLLM({
          prompt: `你是视光诊所运营助理（Clinic OS V10）。

宪法约束：你的输出只是建议，不产生任何实际系统变更。所有决策由店长人工确认后才执行。

请分析以下员工工作汇报，判断是否需要引起店长注意：

汇报类型：${report_type}
汇报内容：${combinedText || "（仅附件，无文字）"}
员工：${staff.staff_name}（${staff.role}）
附件数量：${atts.length}

输出 JSON：
{
  "category": "任务进度|异常事件|资源需求|人员协作|其他",
  "urgency": "yellow|red",
  "summary": "一句话摘要（≤30字）",
  "needs_manager_attention": true或false,
  "attention_title": "需要店长注意时的标题（≤20字）",
  "recommendation": "建议店长采取的行动（≤50字）",
  "reasoning": "为什么需要或不需要店长关注的推理过程"
}`,
          response_json_schema: {
            type: "object",
            properties: {
              category: { type: "string" },
              urgency: { type: "string", enum: ["yellow", "red"] },
              summary: { type: "string" },
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

      // ── 7. 若 LLM 判断需要店长关注 → 创建 AttentionItem（仅建议，不执行）──
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

    // ── 8. 若是 new_event 且员工自主发起 → 创建 staff_self Task ─────────────
    // （员工自主工作不需要店长批准即可开始，但不是 AI 决策，是系统设计规则）
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
        status: "in_progress",
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
      ai_parsed: aiParsed,
      attention_item_id: attentionItemId,
      self_task_id: selfTaskId,
      v10_note: "AI 仅生成建议（AttentionItem），所有 clinic state 变更需店长确认后执行",
    });

  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
});