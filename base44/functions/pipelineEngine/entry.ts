import { createClientFromRequest } from "npm:@base44/sdk@0.8.38";

/**
 * Clinic OS V10 — Pipeline Engine（列车编组 + 事件流核销引擎）
 *
 * 两种 trigger 模式：
 *
 * ① 会话锚点压缩（trigger != "compose"，原有逻辑）
 *    - 接收 ScanEvent / StaffReport / 手动触发，对单条 PatientSession 旅程做语义压缩
 *    - 输出：更新 WorkflowSnapshot + 可选 AttentionItem
 *
 * ② 语义编组（trigger === "compose"，V10 新增）
 *    - 处理「游离事件」：未明确归属患者流的碎片（游离车厢）
 *    - 读取全店 SPEC 编组规则摘要（来自 SystemSpec）作为 LLM 上下文
 *    - 读取当前所有活跃工作流（火车）列表
 *    - LLM 判断：挂载到既有火车 / 独立成车厢待手动调度 / 开启新工作流
 *    - 高置信度（≥0.7）自动挂载（仅元数据组织，非运营决策）
 *    - 低置信度/孤立 → 生成 AttentionItem，建议店长在手动调度站处理
 *
 * V10 宪法：
 * - 编组挂载属于元数据组织（pipeline 本职），非运营状态变更，可自动执行
 * - 仍不创建 OperationalTask / 不修改 clinic 运行状态
 * - 孤立/冲突时仅产出 AttentionItem 建议
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // ── 观察期探针（2026-07-24 起，30 天观察窗口至 2026-08-23）────────────
    // 无条件记录每次 HTTP 命中，在鉴权前执行；仅观测，不改任何业务逻辑，不碰 arrival_time 回退 bug。
    // 配合 AuditLog 实体自动化 → pipelineEngineCallAlert 通知函数，实现"被调用即告警"。
    try {
      await base44.asServiceRole.entities.AuditLog.create({
        clinic_id: "__pipeline_engine_probe__",
        event_id: `pipeline-engine/probe/${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        source_agent: "PipelineEngine_PROBE",
        trigger_type: "PIPELINE_PROBE",
        payload: { method: req.method, url: req.url, note: "观察期探针：endpoint 被命中（鉴权前无条件记录）" },
      });
    } catch { /* 探针失败不得阻断主流程 */ }
    // ────────────────────────────────────────────────────────────────────

    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "未登录" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { session_id, trigger, clinic_id: bodyClinicId, staff_report_text, event_id, raw_event } = body || {};

    const svc = base44.asServiceRole;
    const now = new Date().toISOString();

    // ════════════════════════════════════════════════════════════════════
    // ② 语义编组模式：游离事件 → 火车挂载决策
    // ════════════════════════════════════════════════════════════════════
    if (trigger === "compose") {
      if (!bodyClinicId) return Response.json({ error: "compose 模式需 clinic_id" }, { status: 400 });
      const clinic_id = bodyClinicId;

      // ── 取待编组游离事件：优先 event_id 查 AuditLog，否则用 raw_event ──────
      let composeEvent: Record<string, unknown> | null = null;
      let composeEventId = "";
      if (event_id) {
        const logs = await svc.entities.AuditLog.filter({ clinic_id, event_id }, "-timestamp", 1);
        composeEvent = logs[0] || null;
        composeEventId = event_id;
      } else if (raw_event) {
        composeEventId = `${clinic_id}/compose/raw_${Date.now()}`;
        composeEvent = {
          event_id: composeEventId,
          timestamp: (raw_event as Record<string, unknown>).timestamp || now,
          source_agent: (raw_event as Record<string, unknown>).source_agent || "Unknown",
          trigger_type: (raw_event as Record<string, unknown>).trigger_type || "UNKNOWN",
          payload: (raw_event as Record<string, unknown>).payload || {},
        };
      } else {
        return Response.json({ error: "compose 模式需 event_id 或 raw_event" }, { status: 400 });
      }

      // ── 归档编组触发本身 ─────────────────────────────────────────────────
      const pipelineEventId = `${clinic_id}/pipeline-engine/compose/${composeEventId}/${Date.now()}`;
      await svc.entities.AuditLog.create({
        clinic_id,
        event_id: pipelineEventId,
        timestamp: now,
        source_agent: "PipelineEngine_V10",
        trigger_type: "PIPELINE_COMPOSE",
        payload: { compose_event_id: composeEventId, mode: "composition" },
      });

      // ── 加载 SPEC 编组规则摘要（列车连接规则） ─────────────────────────────
      const specs = await svc.entities.SystemSpec.filter({ clinic_id }, "department", 100);
      const specContext = specs
        .map((s) => s.sop_digest || `[${s.department_name} 暂无摘要]`)
        .join("\n\n");

      // ── 加载活跃火车（active/stalled 工作流） ─────────────────────────────
      const allSnapshots = await svc.entities.WorkflowSnapshot.filter({ clinic_id }, "-generated_at", 50);
      const activeTrains = allSnapshots.filter((t) => t.status === "active" || t.status === "stalled");
      const trainContext = activeTrains.map((t, i) => ({
        index: i + 1,
        snapshot_id: t.id,
        patient_name: t.patient_name || "未知",
        business_line: t.business_line,
        current_node: t.current_node || null,
        nodes_completed: (t.nodes_completed || []).join("→"),
        llm_summary: t.llm_summary || "",
        total_elapsed_minutes: t.total_elapsed_minutes || 0,
      }));

      // ── LLM 编组决策（列车编组代理） ──────────────────────────────────────
      let composeDecision: Record<string, unknown> = {};
      try {
        composeDecision = await svc.integrations.Core.InvokeLLM({
          prompt: `你是 Clinic OS V10 的「列车编组代理」。

任务：判断一个"游离事件"（未明确归属患者流的碎片/游离车厢）应该挂载到哪列"火车"（活跃工作流），还是作为独立车厢等待店长手动调度。

判断依据（按优先级）：
1. SPEC 编组规则：该类事件按手册应处于哪条流的哪个节点
2. 时空重合：事件时间戳与某活跃火车的当前节点时间接近
3. 角色逻辑：事件来源员工所属部门与某火车的业务线匹配

【全店编组规则摘要（SPEC）】
${specContext || "（暂无 SPEC，请提示店长加载）"}

【当前活跃火车】
${trainContext.length === 0 ? "（无活跃工作流）" : JSON.stringify(trainContext, null, 2)}

【待编组游离事件】
事件ID: ${composeEventId}
来源Agent: ${composeEvent.source_agent}
事件类型: ${composeEvent.trigger_type}
时间: ${composeEvent.timestamp}
负载: ${JSON.stringify(composeEvent.payload || {}).slice(0, 600)}

请输出 JSON：
{
  "target_snapshot_id": "应挂载的 snapshot_id（无匹配则为空字符串）",
  "target_train_index": 匹配的火车序号（无则0）,
  "suggested_node": "该事件在工作流中对应的节点名",
  "confidence": 0~1 的置信度,
  "composition_type": "attach（挂载到既有火车）| orphan（独立成车厢，待店长手动调度）| new_train（建议开启新工作流）",
  "reasoning": "编组推理过程（依据 SPEC 规则与时空重合，≤80字）",
  "needs_manager_dispatch": true或false（低置信度或孤立时建议店长手动调度）
}`,
          response_json_schema: {
            type: "object",
            properties: {
              target_snapshot_id: { type: "string" },
              target_train_index: { type: "number" },
              suggested_node: { type: "string" },
              confidence: { type: "number" },
              composition_type: { type: "string" },
              reasoning: { type: "string" },
              needs_manager_dispatch: { type: "boolean" },
            },
          },
        });
      } catch {
        composeDecision = {
          composition_type: "orphan",
          confidence: 0,
          needs_manager_dispatch: true,
          reasoning: "编组 LLM 调用失败，降级为孤立车厢待手动调度",
          target_snapshot_id: "",
        };
      }

      const confidence = Number(composeDecision.confidence) || 0;
      const AUTO_ATTACH_THRESHOLD = 0.7;
      let attached = false;
      let attentionItemId: string | null = null;

      // ── 高置信度且明确目标 → 自动挂载（元数据组织，非运营决策） ─────────────
      if (
        composeDecision.composition_type === "attach" &&
        composeDecision.target_snapshot_id &&
        confidence >= AUTO_ATTACH_THRESHOLD
      ) {
        const target = activeTrains.find((t) => t.id === composeDecision.target_snapshot_id);
        if (target) {
          await svc.entities.WorkflowSnapshot.update(target.id, {
            audit_log_ids: [...(target.audit_log_ids || []), composeEventId, pipelineEventId],
          });
          attached = true;
        }
      }

      // ── 孤立 / 低置信度 → 生成 AttentionItem，建议店长手动调度 ──────────────
      if (!attached) {
        const attn = await svc.entities.AttentionItem.create({
          clinic_id,
          session_id: null,
          attention_type: "journey_gap",
          urgency: confidence < 0.4 ? "red" : "yellow",
          title: `游离事件待调度:${String(composeEvent.trigger_type || "").slice(0, 14)}`,
          reasoning: (composeDecision.reasoning as string) || "",
          evidence_ids: [],
          event_ids: [composeEventId, pipelineEventId],
          recommendation:
            composeDecision.composition_type === "new_train"
              ? "建议店长确认是否开启新工作流"
              : "建议店长在手动调度站将该事件拖至对应工作流",
          status: "open",
          generated_at: now,
        });
        attentionItemId = attn.id;
      }

      return Response.json({
        ok: true,
        mode: "compose",
        compose_event_id: composeEventId,
        composition_type: composeDecision.composition_type,
        confidence,
        suggested_node: composeDecision.suggested_node || null,
        target_snapshot_id: attached ? composeDecision.target_snapshot_id : null,
        attached,
        attention_item_id: attentionItemId,
        reasoning: composeDecision.reasoning,
        pipeline_event_id: pipelineEventId,
        active_trains_count: activeTrains.length,
        v10_note: attached
          ? "高置信度自动挂载（元数据组织，非运营决策）"
          : "低置信度/孤立，已生成 AttentionItem 建议店长手动调度",
      });
    }

    // ════════════════════════════════════════════════════════════════════
    // ① 会话锚点压缩模式（原有逻辑）
    // ════════════════════════════════════════════════════════════════════
    if (!session_id) {
      return Response.json({ error: "session_id 必填（PatientSession 锚点），或使用 trigger=compose" }, { status: 400 });
    }

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