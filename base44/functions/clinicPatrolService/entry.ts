import { createClientFromRequest } from "npm:@base44/sdk@0.8.39";

/**
 * Clinic OS V10 — 门店巡检服务（Clinic Patrol Service）
 *
 * 由定时 Workflow 每30分钟触发，是后端版 PatrolSkill。
 *
 * V10 宪法合规：
 * - 仅读取态势数据 + LLM 生成建议 + 写入 AttentionItem / WorkflowSnapshot / AuditLog
 * - 绝不创建 OperationalTask、StaffRequest、Alert，不修改任何 clinic state
 * - 每条 AttentionItem 携带 event_ids（溯源）
 *
 * 产出：
 * 1. 对 stalled / 长时间候诊 session 生成或更新 WorkflowSnapshot
 * 2. LLM 综合巡检生成最多3条 AttentionItem（去重已有 open 项）
 * 3. 写入一条 AuditLog 巡检事件
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "未登录" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const clinic_id = body.clinic_id || "clinic-001";
    const svc = base44.asServiceRole;
    const now = new Date().toISOString();

    // ── 1. 态势采集 ─────────────────────────────────────
    const [sessions, staff, inventory, tasks, openAttentions, flows] = await Promise.all([
      svc.entities.PatientSession.filter({ clinic_id }, "-arrival_time", 50),
      svc.entities.Staff.filter({ clinic_id }, "-checked_in_at", 50),
      svc.entities.InventoryItem.filter({ clinic_id }, "-updated_date", 50),
      svc.entities.OperationalTask.filter({ clinic_id }, "-created_date", 30),
      svc.entities.AttentionItem.filter({ clinic_id, status: "open" }, "-generated_at", 30),
      svc.entities.BusinessLineFlow.filter({ clinic_id, active: true }, "-created_date", 10),
    ]);

    const activeSessions = sessions.filter((s) => s.status !== "completed");
    const stalled = sessions.filter((s) => s.status === "stalled");
    const longWaiting = sessions.filter((s) => {
      if (s.status !== "seated" && s.status !== "arrived") return false;
      if (!s.seated_time && !s.arrival_time) return false;
      const ref = s.seated_time || s.arrival_time;
      return (Date.now() - new Date(ref).getTime()) > 15 * 60 * 1000;
    });
    const lowInv = inventory.filter((i) => i.below_threshold);
    const pendingTasks = tasks.filter((t) => t.status === "pending_approval");

    // ── 2. 对 stalled / 长候诊 session 生成 WorkflowSnapshot ──
    const snapshotsTouched = [];
    const sessionCandidates = [...stalled, ...longWaiting];
    for (const sess of sessionCandidates.slice(0, 8)) {
      const existing = await svc.entities.WorkflowSnapshot.filter(
        { clinic_id, session_id: sess.id, status: "active" },
        "-generated_at", 1
      ).catch(() => []);

      // 计算已耗时
      const start = sess.seated_time || sess.arrival_time;
      const elapsedMin = start ? Math.round((Date.now() - new Date(start).getTime()) / 60000) : 0;
      const nodesDone = (sess.node_scan_timestamps && Object.keys(sess.node_scan_timestamps)) || [];
      const business_line = sess.business_line || "optometry";

      // LLM 单 session 压缩（仅建议，不改动 state）
      let llmSummary = `${sess.patient_name || "患者"} ${sess.status === "stalled" ? "卡滞" : "长候诊"} ${elapsedMin}分钟`;
      let llmRec = "";
      let bottleneck = sess.current_node || "";
      let estRemaining = 0;
      try {
        const flow = flows.find((f) => f.business_line === business_line);
        const allNodes = flow?.nodes || [];
        const remaining = allNodes.filter((n) => !nodesDone.includes(n)).length;
        estRemaining = remaining * 15;
        const llmRes = await svc.integrations.Core.InvokeLLM({
          prompt: `你是视光诊所运营助手（V10，仅生成建议不改动状态）。
患者会话 ${sess.id}：
- 患者：${sess.patient_name || "未登记"}，业务线：${business_line}
- 当前状态：${sess.status}，当前节点：${sess.current_node || "—"}
- 已耗时：${elapsedMin}分钟
- 已完成节点：${nodesDone.join("→") || "无"}
- 剩余节点：${remaining}个
- 候诊时长过长或卡滞，请给出：一句话状态摘要(≤25字)、阻塞点(节点名)、干预建议(≤40字)。
输出JSON：{"summary":"","bottleneck":"","recommendation":""}`,
          response_json_schema: {
            type: "object",
            properties: {
              summary: { type: "string" },
              bottleneck: { type: "string" },
              recommendation: { type: "string" },
            },
          },
        });
        if (llmRes) {
          llmSummary = llmRes.summary || llmSummary;
          bottleneck = llmRes.bottleneck || bottleneck;
          llmRec = llmRes.recommendation || "";
        }
      } catch {
        // 降级用默认摘要
      }

      if (existing && existing.length > 0) {
        const snap = existing[0];
        const updated = await svc.entities.WorkflowSnapshot.update(snap.id, {
          current_node: sess.current_node || snap.current_node,
          nodes_completed: nodesDone,
          stage_durations: { ...(snap.stage_durations || {}), [bottleneck || "当前"]: elapsedMin },
          bottleneck_node: bottleneck,
          llm_summary: llmSummary,
          llm_recommendation: llmRec,
          total_elapsed_minutes: elapsedMin,
          estimated_completion_minutes: estRemaining,
          status: sess.status === "stalled" ? "stalled" : "active",
          pipeline_trigger: "session_stalled",
          generated_at: now,
        });
        snapshotsTouched.push(updated.id);
      } else {
        const created = await svc.entities.WorkflowSnapshot.create({
          clinic_id,
          session_id: sess.id,
          patient_name: sess.patient_name || "未登记",
          business_line,
          start_time: start || now,
          current_node: sess.current_node || "—",
          nodes_completed: nodesDone,
          stage_durations: { [bottleneck || "当前"]: elapsedMin },
          bottleneck_node: bottleneck,
          llm_summary: llmSummary,
          llm_recommendation: llmRec,
          estimated_completion_minutes: estRemaining,
          total_elapsed_minutes: elapsedMin,
          status: sess.status === "stalled" ? "stalled" : "active",
          pipeline_trigger: "session_stalled",
          generated_at: now,
        });
        snapshotsTouched.push(created.id);
      }
    }

    // ── 3. LLM 综合巡检 → AttentionItem（去重） ─────────
    const existingTitles = new Set(openAttentions.map((a) => a.title));
    const patrolEventId = `${clinic_id}/patrol-service/system/patrol_${Date.now()}`;

    let attentionsCreated = 0;
    if (activeSessions.length > 0 || lowInv.length > 0 || pendingTasks.length > 0 || longWaiting.length > 0) {
      try {
        const patrolRes = await svc.integrations.Core.InvokeLLM({
          prompt: `你是视光诊所巡检助手（Clinic OS V10）。输出仅是建议，不产生任何系统变更。
当前门店 ${clinic_id} 巡检态势：
- 活跃患者会话：${activeSessions.length}（其中卡滞 ${stalled.length}、长候诊 ${longWaiting.length}）
- 员工在岗：${staff.filter(s=>s.status==="on_duty"||s.status==="busy").length}/${staff.length}（忙碌 ${staff.filter(s=>s.status==="busy").length}）
- 库存低水位：${lowInv.length} 项（${lowInv.map(i=>i.item_name).join("、") || "无"}）
- 待审批任务：${pendingTasks.length} 条
- 已有待处理建议（避免重复）：${[...existingTitles].join(" / ") || "无"}

请识别最多3个需店长关注的新异常，每个含：
- attention_type：journey_gap/evidence_missing/resource_risk/wait_timeout/staff_unresponsive
- urgency：yellow/red
- attention_title：≤20字
- recommendation：≤45字
- reasoning：推理过程
仅输出JSON：{"findings":[{"attention_type":"","urgency":"yellow","attention_title":"","recommendation":"","reasoning":""}]}`,
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
        const findings = patrolRes?.findings || [];
        for (const f of findings.slice(0, 3)) {
          const title = f.attention_title || "巡检发现";
          if (existingTitles.has(title)) continue;
          existingTitles.add(title);
          await svc.entities.AttentionItem.create({
            clinic_id,
            session_id: null,
            attention_type: f.attention_type || "resource_risk",
            urgency: f.urgency || "yellow",
            title,
            reasoning: f.reasoning || "",
            evidence_ids: [],
            event_ids: [patrolEventId],
            recommendation: f.recommendation || "",
            status: "open",
            generated_at: now,
          });
          attentionsCreated++;
        }
      } catch {
        // LLM 失败则跳过建议，不影响快照
      }
    }

    // ── 4. AuditLog 巡检留痕 ─────────────────────────────
    await svc.entities.AuditLog.create({
      clinic_id,
      event_id: patrolEventId,
      timestamp: now,
      source_agent: "ClinicPatrolService_V10",
      trigger_type: "PATROL_EXECUTED",
      payload: {
        active_sessions: activeSessions.length,
        stalled: stalled.length,
        long_waiting: longWaiting.length,
        low_inventory: lowInv.length,
        pending_tasks: pendingTasks.length,
        snapshots_touched: snapshotsTouched.length,
        attentions_created: attentionsCreated,
      },
    });

    return Response.json({
      ok: true,
      clinic_id,
      patrol_event_id: patrolEventId,
      active_sessions: activeSessions.length,
      stalled: stalled.length,
      long_waiting: longWaiting.length,
      low_inventory: lowInv.length,
      snapshots_touched: snapshotsTouched.length,
      attentions_created: attentionsCreated,
      v10_note: "巡检仅生成 AttentionItem/Snapshot，不创建 Task/Alert，符合 V10",
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
});