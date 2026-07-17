import { createClientFromRequest } from "npm:@base44/sdk@0.8.38";

/**
 * Clinic OS V9 — StaffReportService（员工汇报子服务 / sub-agent）
 * 职责：记录、存档、上传资料的语意解析（LLM）、发送汇报。
 * 统一处理三类汇报：new_event（发起新事件）/ progress（进度汇报）/ completion（完成提交）。
 * 宪法①：强制 clinic_id 隔离；宪法③：所有产出留痕 AuditLog。
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "未登录" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { report_type, task_id, text, file_url, staff_id } = body || {};
    if (!staff_id || !report_type || (text === undefined || text === null)) {
      return Response.json({ error: "参数缺失：staff_id / report_type / text 必填" }, { status: 400 });
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

    // 2. LLM 语意解析
    let parsed = {};
    try {
      const llmRes = await svc.integrations.Core.InvokeLLM({
        prompt: `你是视光诊所运营助理。请解析以下员工工作汇报并输出结构化结果。

汇报类型：${report_type}
汇报内容：${text || "（仅图片证据）"}

请输出 JSON：{"category":"任务进度|异常事件|资源需求|人员协作|其他","urgency":"yellow|red","summary":"一句话摘要","suggested_action":"建议处置"}`,
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

    // 3. 按类型归档
    if (report_type === "new_event") {
      const reqType = parsed.category === "资源需求" ? "procurement" : "support";
      const sr = await svc.entities.StaffRequest.create({
        clinic_id,
        request_type: reqType,
        requester_id: staff_id,
        description: `${text || ""}${text ? "\n" : ""}[AI摘要] ${parsed.summary || ""}${parsed.suggested_action ? "｜建议：" + parsed.suggested_action : ""}`,
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
        if (file_url) {
          const ev = await svc.entities.EvidenceItem.create({
            clinic_id,
            task_id,
            version_id: task.current_version_id || `v1-${task_id}`,
            submission_count: 1,
            evidence_type: "image",
            file_url,
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

    // 4. 留痕 AuditLog（发送汇报至中央看板的因果链记录）
    await svc.entities.AuditLog.create({
      clinic_id,
      event_id,
      timestamp: now,
      source_agent: "StaffReportService",
      trigger_type: "STAFF_REPORT_SUBMITTED",
      payload: { report_type, task_id, staff_id, staff_name: staff.staff_name, file_url, text, parsed, archived },
    });

    return Response.json({ ok: true, parsed, archived, event_id });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});