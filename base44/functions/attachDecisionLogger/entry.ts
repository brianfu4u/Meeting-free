import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import {
  buildAttachDecisionLog,
  buildTrackScores,
  deriveResult,
} from "../../shared/phase1Instrumentation.ts";

/**
 * attachDecisionLogger — Phase 1a 决策日志埋点
 *
 * 由 CompositionRun 实体 update 自动化触发：每当一个 run 流转到 status=completed，
 * 从其持久化字段 + 关联 WorkflowHypothesis 重建一行 AttachDecisionLog。
 * 幂等：以 composition_run_id 为键，已存在则跳过。
 *
 * 完全不动 orchestrator 核心与 service.ts——副作用通过实体自动化投影实现。
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const data = body?.data || {};
    const event = body?.event || {};

    // 仅在 run 流转到 completed 时记录
    if (event.type !== "update" || data.status !== "completed") {
      return Response.json({ ok: true, ignored: true, reason: "非 run 完成事件" });
    }
    const clinicId = data.clinic_id;
    const runId = data.id;
    if (!clinicId || !runId) {
      return Response.json({ ok: true, ignored: true, reason: "缺 clinic_id/run id" });
    }

    const svc = base44.asServiceRole;

    // 幂等：已存在则跳过
    const existing = await svc.entities.AttachDecisionLog.filter(
      { clinic_id: clinicId, composition_run_id: runId },
      "-timestamp",
      1
    );
    if (existing && existing.length > 0) {
      return Response.json({ ok: true, idempotent: true, decision_log_id: existing[0].id });
    }

    // 读取本 run 的假设，重建 track_scores + best composition_type
    const hypotheses = await svc.entities.WorkflowHypothesis.filter(
      { clinic_id: clinicId, composition_run_id: runId },
      "rank",
      50
    );
    const trackScores = buildTrackScores(hypotheses);
    const bestHypothesisId = data.auto_attach_hypothesis_id || null;
    const best = bestHypothesisId
      ? hypotheses.find((h) => h.workflow_hypothesis_id === bestHypothesisId)
      : hypotheses[0] || null;
    const bestCompositionType = best?.composition_type || null;

    // branch = best.workflow_family；domain = best 首个 artifact 的 source_region
    let branch = best?.workflow_family || null;
    let domain = null;
    const firstArtifactId =
      best && Array.isArray(best.ordered_artifact_ids) && best.ordered_artifact_ids.length > 0
        ? best.ordered_artifact_ids[0]
        : null;
    if (firstArtifactId) {
      try {
        const arts = await svc.entities.Artifact.filter({ id: firstArtifactId }, "-created_date", 1);
        if (arts && arts[0]) domain = arts[0].source_region || null;
      } catch { /* domain 可缺失 */ }
    }

    const result = deriveResult({
      bestCompositionType,
      canAutoAttach: data.auto_attach_eligible === true,
      llmAuditRequired: data.llm_audit_required === true,
      autoAttachGateReasons: data.auto_attach_gate_reasons || [],
    });

    const log = buildAttachDecisionLog({
      clinicId,
      compositionRunId: runId,
      businessDate: data.business_date,
      branch,
      domain,
      trackScores,
      // numeric aggregate/threshold/margin 当前架构不产出，留 null，Phase 7 填充
      aggregateScore: null,
      threshold: null,
      margin: null,
      result,
      bestHypothesisId,
      autoAttachEligible: data.auto_attach_eligible === true,
      autoAttachGateReasons: data.auto_attach_gate_reasons || [],
      llmAuditRequired: data.llm_audit_required === true,
      llmAuditReasonCodes: data.llm_audit_reason_codes || [],
      timestamp: new Date().toISOString(),
    });

    const created = await svc.entities.AttachDecisionLog.create(log);
    return Response.json({ ok: true, decision_log_id: created.id, result });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
});