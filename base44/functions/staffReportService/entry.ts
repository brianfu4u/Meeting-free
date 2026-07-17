import { createClientFromRequest } from "npm:@base44/sdk@0.8.38";

/**
 * Clinic OS V9 — StaffReportService（员工汇报子服务 / sub-agent）
 * 职责：记录、存档、附件（照片/文件/语音）语意解析（LLM + Whisper 转写）、发送汇报。
 * 统一处理三类汇报：new_event / progress / completion。
 * 附件协议：attachments: [{ type: "image"|"file"|"voice", url, name, transcript? }]
 * 宪法①：强制 clinic_id 隔离；宪法③：所有产出留痕 AuditLog。
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "未登录" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { report_type, task_id, text, file_url, staff_id, attachments } = body || {};
    if (!staff_id || !report_type) {
      return Response.json({ error: "参数缺失：staff_id / report_type 必填" }, { status: 400 });
    }
    if (!["new_event", "progress", "completion"].includes(report_type)) {
      return Response.json({ error: "report_type 必须为 new_event/progress/completion" }, { status: 400 });
    }

    const svc = base44.asServiceRole;

    // 1. 校验员工绑定与 clinic_id（宪法①隔离）
    let staff;
    try {
      staff = await svc.entities.Staff.get(staff_id);
    } catch (e) {
      return Response.json({ error: "员工记录不存在" }, { status: 404 });
    }
    if (!staff || staff.user_id !== user.id) {
      return Response.json({ error: "宪法违规：终端未绑定该员工账号" }, { status: 403 });
    }
    const clinic_id = staff.clinic_id;

    // 归一化附件（兼容旧 file_url 单图）
    const atts = Array.isArray(attachments)
      ? attachments
      : (file_url ? [{ type: "image", url: file_url }] : []);

    // 2. LLM 语意解析（文本 + 语音转写合并）
    const transcripts = atts.filter((a) => a.transcript).map((a) => a.transcript).join("\n");
    const llmText = [text, transcripts].filter(Boolean).join("\n").trim();
    let parsed = {};
    try {
      const llmRes = await svc.integrations.Core.InvokeLLM({
        prompt: `你是视光诊所运营助理。请解析以下员工工作汇报并输出结构化结果。\n\n汇报类型：${report_type}\n汇报内容：${llmText || "（仅附件）"}\n\n请输出 JSON：{"category":"任务进度|异常事件|资源需求|人员协作|其他","urgency":"yellow|red","summary":"一句话摘要","suggested_action":"建议处置"}`,
        response_json_schema: {
          type: "object",
          properties: {
            category: { type: "string" },
            urgency: { type: "string", enum: ["yellow", "red"] },
            summary: { type: "string" },
            suggested_action: { type: "string" },
          },
        },
      });
      parsed = llmRes || {};
    } catch (e) {
      parsed = { summary: "LLM 解析失败，已原文存档", suggested_action: "" };
    }

    const now = new Date().toISOString();
    const event_id = `rpt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const archived = {};
    const attachLines = atts
      .map((a) => `[${a.type}] ${a.name || ""} ${a.url}${a.transcript ? "  语音转写：" + a.transcript : ""}`)
      .join("\n");
    const fullDescription = [text, attachLines].filter(Boolean).join("\n");

    // 3. 按类型归档
    if (report_type === "new_event") {
      // 员工自主发起的工作 → 进入「我」的工作清单，待核销归档
      let workDesc = [text, transcripts ? "[语音转写] " + transcripts : ""].filter(Boolean).join("\n");
      if (!workDesc) workDesc = atts.length ? `（${atts.length}个附件汇报）` : "（新事件）";
      if (parsed.summary) workDesc += "\n[AI] " + parsed.summary;
      const priority = parsed.urgency === "red" ? "P2" : "P3";
      const task = await svc.entities.OperationalTask.create({
        clinic_id,
        priority,
        dispatched_by: "staff_self",
        assignee_staff_id: staff_id,
        description: workDesc,
        status: "in_progress",
        report_attachments: atts,
        ai_parsed: parsed,
      });
      archived.task_id = task.id;

      // 同时生成管理层可见的申请单（资源/异常需经理介入时）
      const reqType = parsed.category === "资源需求" ? "procurement" : "support";
      const desc = `${fullDescription || ""}${fullDescription ? "\n" : ""}[AI摘要] ${parsed.summary || ""}${parsed.suggested_action ? "｜建议：" + parsed.suggested_action : ""}`;
      const sr = await svc.entities.StaffRequest.create({
        clinic_id,
        request_type: reqType,
        requester_id: staff_id,
        description: desc,
        urgency: parsed.urgency || "yellow",
        status: "pending_approval",
        created_at: now,
      });
      archived.staff_request_id = sr.id;
    } else if (report_type === "progress" && task_id) {
      const task = await svc.entities.OperationalTask.get(task_id).catch(() => null);
      if (task && task.clinic_id === clinic_id) {
        if (["pending_approval", "assigned"].includes(task.status)) {
          await svc.entities.OperationalTask.update(task_id, { status: "in_progress" });
          archived.task_advanced = true;
        }
        archived.task_status = task.status;
      }
    } else if (report_type === "completion" && task_id) {
      const task = await svc.entities.OperationalTask.get(task_id).catch(() => null);
      if (task && task.clinic_id === clinic_id) {
        if (task.dispatched_by === "staff_self") {
          // 员工自主工作：完成即核销归档，从工作清单消失
          await svc.entities.OperationalTask.update(task_id, { status: "completed" });
          archived.task_completed = true;
        } else {
          // 管理层派发任务：完成需补证据待核销（现有流程）
          const img = atts.find((a) => a.type === "image");
          if (img) {
            const ev = await svc.entities.EvidenceItem.create({
              clinic_id,
              task_id,
              version_id: task.current_version_id || `v1-${task_id}`,
              submission_count: 1,
              evidence_type: "image",
              file_url: img.url,
              submitted_at: now,
              submitted_by: staff_id,
              eval_result: "pending",
            });
            archived.evidence_id = ev.id;
          }
          await svc.entities.OperationalTask.update(task_id, { status: "pending_evidence" });
          archived.task_completed_submit = true;
        }
      }
    }

    // 4. 留痕 AuditLog（发送汇报至中央看板的因果链记录）
    await svc.entities.AuditLog.create({
      clinic_id,
      event_id,
      timestamp: now,
      source_agent: "StaffReportService",
      trigger_type: "STAFF_REPORT_SUBMITTED",
      payload: { report_type, task_id, staff_id, staff_name: staff.staff_name, text, attachments: atts, parsed, archived },
    });

    return Response.json({ ok: true, parsed, archived, event_id });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});