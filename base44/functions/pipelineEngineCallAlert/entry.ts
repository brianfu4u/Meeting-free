import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";

/**
 * pipelineEngineCallAlert — 观察期告警通知函数
 *
 * 由 AuditLog 实体自动化触发：每当 pipelineEngine 的鉴权前探针写入一条
 * source_agent="PipelineEngine_PROBE" 的 AuditLog 时，本函数被调用，
 * 在 manager Dashboard 的 AttentionQueue 生成一条红色告警项。
 *
 * 观察窗口：2026-07-24 → 2026-08-23。
 * 仅响应探针记录，拒绝其它来源（避免被直接打 endpoint 伪造告警）。
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    // 实体自动化载荷：{ event, data, old_data, payload_too_large }
    const data = body?.data || {};

    if (data.source_agent !== "PipelineEngine_PROBE") {
      return Response.json({ ok: true, ignored: true, reason: "非探针记录，忽略" });
    }

    const now = new Date().toISOString();
    const probeId = data.event_id || "unknown";
    const svc = base44.asServiceRole;

    const attn = await svc.entities.AttentionItem.create({
      clinic_id: "clinic-001",
      session_id: null,
      attention_type: "resource_risk",
      urgency: "red",
      title: "⚠ pipelineEngine 被调用（观察期告警）",
      reasoning:
        `观察期探针捕获到 pipelineEngine endpoint 被命中。探针事件ID: ${probeId}；` +
        `来源方法: ${data?.payload?.method || "?"}；命中URL: ${data?.payload?.url || "?"}。` +
        `此告警来自 2026-07-24 起的 30 天观察期监控，用于确认 pipelineEngine 是否仍有活跃调用来源。`,
      evidence_ids: [],
      event_ids: [probeId],
      recommendation:
        "pipelineEngine 在观察期内被调用，说明仍有活跃调用来源。请立即核查调用方（控制台 Logs / Integrations），并重新评估 arrival_time 回退 bug 的紧急程度。",
      status: "open",
      generated_at: now,
    });

    return Response.json({
      ok: true,
      alert_created: true,
      attention_item_id: attn.id,
      probe_event_id: probeId,
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
});