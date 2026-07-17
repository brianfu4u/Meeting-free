import { createClientFromRequest } from "npm:@base44/sdk@0.8.38";

/**
 * Clinic OS V10 — Pipeline Engine（Clinic Pipeline 引擎）
 *
 * V10 宪法合规说明：
 * - 本函数是「事件流核销 Pipeline」的核心执行器（战术层）
 * - 职责：接收 ScanEvent / StaffReport / 手动触发，判断是否达到压缩触发条件
 * - 压缩触发条件（基于 PatientSession 锚点，避免对非关键流浪费 LLM 积分）：
 *   1. session_stalled：患者在某节点停留超过 stall_timeout_minutes
 *   2. node_completed：关键节点完成（非打卡等简单动作）
 *   3. staff_report：员工汇报触发（含 session_id 锚点时）
 *   4. manual：店长手动触发
 * - 输出：更新 WorkflowSnapshot + 可选生成 AttentionItem（仅建议，不执行）
 * - Sub-Agent 隔离：只处理传入的 session_id，不横向查询其他 session
 * - 无状态处理：每次调用独立，不持有跨请求状态
 *
 * Pipeline 六步检查点：
 * ① 解析（Parse）→ ② 校验（Validate）→ ③ 归档（Persist AuditLog）
 * → ④ 关联（Connect to PatientSession）→ ⑤ 告警判断（Detect）→ ⑥ 自动反馈（Notify）
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "未登录" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { session_id, trigger, clinic_id: bodyClinicId, staff_report_text } = body || {};

    if (!session_id) {
      return Response.json({ error: "session_id 必填（PatientSession 锚点）" }, { status: 400 });
    }

    const svc = base44.asServiceRole;
    const now = new Date().toISOString();

    // ── ① 解析（Parse）：获取 PatientSession 锚点 ──────────────────────────
    let session;
    try {
      const sessions = await svc.entities.PatientSession.filter({ id: session_id });
      session = sessions[0];
    } catch {
      return Response.json({ error: "PatientSession 不存在" }, { status: 404 });
    }
    if (!session) return Response.json({ error: "PatientSession 不存在" }, { status: 404 });

    // ── ② 校验（Validate）：clinic_id 物理隔离 ────────────────────────────────
    const clinic_id = session.clinic_id;
    if (bodyClinicId && bodyClinicId !== clinic_id) {
      return Response.json({ error: "宪法违规：clinic_id 不匹配" }, { status: 403 });
    }

    // ── ③ 归档（Persist）：写入 AuditLog（Event Bus 命名规范）────────────────
    const triggerType = trigger || "manual";
    const eventId = `${clinic_id}/pipeline-engine/${session_id}/${triggerType}_${Date.now()}`;
    await svc.entities.AuditLog.create({
      clinic_id,
      event_id: eventId,
      timestamp: now,
      source_agent: "PipelineEngine_V10",
      trigger_type: `PIPELINE_${triggerType.toUpperCase()}`,
      payload: { session_id, trigger: triggerType, staff_report_text: staff_report_text || null },
    });

    // ── ④ 关联（Connect）：获取 session 的 ScanEvent 历史 + 已有快照 ──────────
    const scanEvents = await svc.entities.ScanEvent.filter({ clinic_id, session_id }, "-scan_time", 20);
    const existingSnapshots = await svc.entities.WorkflowSnapshot.filter({ clinic_id, session_id }, "-generated_at", 1);
    const existingSnapshot = existingSnapshots[0] || null;

    // 计算各节点耗时
    const stageDurations: Record<string, number> = {};
    const nodeTimestamps = session.node_scan_timestamps || {};
    const nodeNames = Object.keys(nodeTimestamps).sort((a, b) => new Date(nodeTimestamps[a]).getTime() - new Date(nodeTimestamps[b]).getTime());
    for (let i = 0; i < nodeNames.length - 1; i++) {
      const from = new Date(nodeTimestamps[nodeNames[i]]).getTime();
      const to = new Date(nodeTimestamps[nodeNames[i + 1]]).getTime();
      stageDurations[nodeNames[i]] = Math.round((to - from) / 60000);
    }
    const arrivalTime = session.arrival_time ? new Date(session.arrival_time).getTime() : Date.now();
    const totalElapsedMinutes = Math.round((Date.now() - arrivalTime) / 60000);

    // ── ⑤ 告警判断（Detect）：LLM 语义压缩，判断是否需要 AttentionItem ─────
    // 只有含 PatientSession 锚点的关键流才进入压缩 Pipeline（节约 LLM 积分）
    const scanSummary = scanEvents.slice(0, 8).map((e) => `[${e.node_name}] ${new Date(e.scan_time).toLocaleTimeString("zh-CN", { hour12: false })} gate:${e.gate_result}`).join("\n");
    const stageSummary = Object.entries(stageDurations).map(([n, m]) => `${n}: ${m}分钟`).join("、");
    const clinicConfigList = await svc.entities.ClinicConfig.filter({ clinic_id }, "-updated_date", 1);
    const stallTimeout = clinicConfigList[0]?.stall_timeout_minutes || 60;
    const isStalled = totalElapsedMinutes > stallTimeout && session.status !== "completed";

    let llmResult: Record<string, unknown> = {};
    try {
      llmResult = await svc.integrations.Core.InvokeLLM({
        prompt: `你是视光诊所运营 Pipeline 引擎（Clinic OS V10）。

宪法约束：输出只是建议，不产生任何实际系统变更。所有决策由店长人工确认后才执行。

请对以下患者旅程数据进行「工作流快照压缩」，聚焦业务语义而非原始日志：

患者：${session.patient_name || "未知"}
业务线：${session.business_line}
到达时间：${session.arrival_time || "未知"}
当前节点：${session.current_node || "未知"}
已完成节点：${(session.nodes_completed || []).join(" → ") || "暂无"}
各阶段耗时：${stageSummary || "暂无数据"}
总耗时：${totalElapsedMinutes} 分钟
最近扫码记录（最多8条）：
${scanSummary || "无扫码记录"}
员工补充汇报：${staff_report_text || "无"}
是否已超时（阈值${stallTimeout}分钟）：${isStalled ? "是" : "否"}

请输出 JSON：
{
  "llm_summary": "业务语义视角的一句话状态摘要（≤40字，面向店长，忽略琐碎日志）",
  "bottleneck_node": "当前最长耗时节点名（无则为null）",
  "llm_recommendation": "针对阻塞点的具体干预建议（≤50字）",
  "estimated_completion_minutes": 预估剩余完成时间分钟数,
  "needs_attention": true或false（是否需要生成AttentionItem提醒店长）,
  "attention_title": "需要店长关注时的标题（≤20字）",
  "attention_urgency": "yellow或red",
  "attention_type": "journey_gap或wait_timeout或resource_risk",
  "reasoning": "为什么需要/不需要店长关注的推理过程"
}`,
        response_json_schema: {
          type: "object",
          properties: {
            llm_summary: { type: "string" },
            bottleneck_node: { type: "string" },
            llm_recommendation: { type: "string" },
            estimated_completion_minutes: { type: "number" },
            needs_attention: { type: "boolean" },
            attention_title: { type: "string" },
            attention_urgency: { type: "string" },
            attention_type: { type: "string" },
            reasoning: { type: "string" },
          },
        },
      });
    } catch {
      llmResult = { llm_summary: "压缩解析失败，原始数据已归档", needs_attention: isStalled };
    }

    // 生成或更新 WorkflowSnapshot
    const snapshotStatus = isStalled ? "stalled" : session.status === "completed" ? "pending_manager_closure" : "active";
    const snapshotData = {
      clinic_id,
      session_id,
      patient_name: session.patient_name || null,
      business_line: session.business_line,
      start_time: session.arrival_time || now,
      current_node: session.current_node || null,
      nodes_completed: session.nodes_completed || nodeNames,
      stage_durations: stageDurations,
      bottleneck_node: (llmResult.bottleneck_node as string) || null,
      llm_summary: (llmResult.llm_summary as string) || "",
      llm_recommendation: (llmResult.llm_recommendation as string) || "",
      estimated_completion_minutes: (llmResult.estimated_completion_minutes as number) || null,
      total_elapsed_minutes: totalElapsedMinutes,
      status: snapshotStatus,
      pipeline_trigger: triggerType,
      audit_log_ids: [eventId],
      generated_at: now,
    };

    let snapshot;
    if (existingSnapshot) {
      snapshot = await svc.entities.WorkflowSnapshot.update(existingSnapshot.id, {
        ...snapshotData,
        audit_log_ids: [...(existingSnapshot.audit_log_ids || []), eventId],
      });
    } else {
      snapshot = await svc.entities.WorkflowSnapshot.create(snapshotData);
    }

    // 若 LLM 判断需要店长关注 → 创建 AttentionItem（仅建议）
    let attentionItemId: string | null = null;
    if (llmResult.needs_attention) {
      const attn = await svc.entities.AttentionItem.create({
        clinic_id,
        session_id,
        attention_type: (llmResult.attention_type as string) || "journey_gap",
        urgency: (llmResult.attention_urgency as string) || "yellow",
        title: (llmResult.attention_title as string) || (llmResult.llm_summary as string) || "患者旅程需关注",
        reasoning: (llmResult.reasoning as string) || "",
        evidence_ids: [],
        event_ids: [eventId],
        recommendation: (llmResult.llm_recommendation as string) || "",
        status: "open",
        generated_at: now,
      });
      attentionItemId = attn.id;
      await svc.entities.WorkflowSnapshot.update(snapshot.id, { attention_item_id: attentionItemId });
    }

    // ── ⑥ 自动反馈（Notify）：向调用方返回确认回执 ─────────────────────────
    return Response.json({
      ok: true,
      snapshot_id: snapshot.id,
      snapshot_status: snapshotStatus,
      llm_summary: llmResult.llm_summary,
      llm_recommendation: llmResult.llm_recommendation,
      attention_item_id: attentionItemId,
      total_elapsed_minutes: totalElapsedMinutes,
      is_stalled: isStalled,
      pipeline_event_id: eventId,
      v10_note: "Pipeline 已完成六步检查点，WorkflowSnapshot 已更新，AI 仅生成建议",
    });

  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
});