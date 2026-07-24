import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import {
  buildCorrectionCapture,
  buildNegativeConstraint,
  negativeConstraintIdempotencyKey,
} from "../../shared/phase1Instrumentation.ts";

/**
 * correctionAndNegativeConstraintLogger — Phase 1a 修正捕获 + 负约束表
 *
 * 由 WorkflowArtifactLink 实体 update 自动化触发：当一个链接从 attached 流转到
 * superseded（即 manager un-attach），写一条 CorrectionCapture（误挂接标注），
 * 并建立/激活一条 NegativeConstraint（禁止该 (artifact, workflow) 对再次挂接）。
 * 幂等：CorrectionCapture 以 link_id 为键；NegativeConstraint 以 idempotency_key 为键。
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const data = body?.data || {};
    const oldData = body?.old_data || {};
    const event = body?.event || {};

    // 仅在 attached -> superseded 时触发（un-attach）
    if (
      event.type !== "update" ||
      oldData.status !== "attached" ||
      data.status !== "superseded"
    ) {
      return Response.json({ ok: true, ignored: true, reason: "非 un-attach 事件" });
    }
    const clinicId = data.clinic_id;
    const linkId = data.id;
    const workflowId = data.workflow_id;
    const artifactId = data.artifact_id;
    if (!clinicId || !linkId || !workflowId || !artifactId) {
      return Response.json({ ok: true, ignored: true, reason: "缺关键字段" });
    }

    const svc = base44.asServiceRole;
    const now = data.superseded_at || new Date().toISOString();

    // 解析 branch/domain（best-effort，缺失不阻断）
    let branch = null;
    let domain = null;
    try {
      const wf = await svc.entities.Workflow.filter({ id: workflowId }, "-updated_date", 1);
      if (wf && wf[0]) branch = wf[0].business_line || wf[0].workflow_family || null;
    } catch { /* 忽略 */ }
    try {
      const arts = await svc.entities.Artifact.filter({ id: artifactId }, "-created_date", 1);
      if (arts && arts[0]) domain = arts[0].source_region || null;
    } catch { /* 忽略 */ }

    // CorrectionCapture 幂等
    const existingCorrection = await svc.entities.CorrectionCapture.filter(
      { clinic_id: clinicId, link_id: linkId },
      "-captured_at",
      1
    );
    if (!existingCorrection || existingCorrection.length === 0) {
      const correction = buildCorrectionCapture({
        clinicId,
        linkId,
        workflowId,
        artifactId,
        managerId: data.decision_actor_id || null,
        correctionReason: data.correction_reason || null,
        branch,
        domain,
        capturedAt: now,
      });
      await svc.entities.CorrectionCapture.create(correction);
    }

    // NegativeConstraint 幂等：存在则确保 active，否则创建
    const ncKey = negativeConstraintIdempotencyKey(clinicId, workflowId, artifactId);
    const existingNc = await svc.entities.NegativeConstraint.filter(
      { clinic_id: clinicId, idempotency_key: ncKey },
      "-created_at",
      1
    );
    if (existingNc && existingNc.length > 0) {
      if (existingNc[0].active !== true) {
        await svc.entities.NegativeConstraint.update(existingNc[0].id, { active: true });
      }
    } else {
      const nc = buildNegativeConstraint({
        clinicId,
        workflowId,
        artifactId,
        sourceLinkId: linkId,
        createdAt: now,
      });
      await svc.entities.NegativeConstraint.create(nc);
    }

    return Response.json({
      ok: true,
      correction_captured: true,
      negative_constraint_key: ncKey,
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
});