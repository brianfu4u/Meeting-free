import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import {
  buildHardLinkLedgerRow,
  hardLinkLedgerIdempotencyKey,
} from "../../shared/phase1Instrumentation.ts";

/**
 * hardLinkShareCounter — Phase 1a 硬链接占比计数器
 *
 * 由 WorkflowArtifactLink 实体 create 自动化触发：每当一个新链接 attached，
 * 判定其 kind（hard=self_supplement 自我补充 / soft=其余），写一条 HardLinkShareLedger 行。
 * kind 判定依据：UndoListItem 中 resolved_by_link_id === link.id 的记录，
 *   resolution_type=self_supplement → hard；handoff 或无记录 → soft。
 * 幂等：以 link_id 为键。
 * 占比 = hard / (hard + soft)，按 branch/domain 分组，由 computeHardLinkShare 聚合（最近 7 天）。
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const data = body?.data || {};
    const event = body?.event || {};

    if (event.type !== "create" || data.status !== "attached" || !data.id) {
      return Response.json({ ok: true, ignored: true, reason: "非 link 创建事件" });
    }
    const clinicId = data.clinic_id;
    const linkId = data.id;
    const workflowId = data.workflow_id;
    const artifactId = data.artifact_id;
    if (!clinicId || !workflowId || !artifactId) {
      return Response.json({ ok: true, ignored: true, reason: "缺关键字段" });
    }

    const svc = base44.asServiceRole;

    // 幂等：已存在则跳过
    const existing = await svc.entities.HardLinkShareLedger.filter(
      { clinic_id: clinicId, link_id: linkId },
      "-created_at",
      1
    );
    if (existing && existing.length > 0) {
      return Response.json({ ok: true, idempotent: true, ledger_id: existing[0].id });
    }

    // kind 判定：查 UndoListItem.resolved_by_link_id
    let kind: "hard" | "soft" = "soft";
    try {
      const undos = await svc.entities.UndoListItem.filter(
        { clinic_id: clinicId, resolved_by_link_id: linkId },
        "-resolved_at",
        5
      );
      if (undos && undos.length > 0 && undos[0].resolution_type === "self_supplement") {
        kind = "hard";
      }
    } catch { /* 缺失按 soft */ }

    // branch/domain best-effort
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

    const attachedAt = data.attached_at || new Date().toISOString();
    const businessDate = attachedAt.slice(0, 10);

    const row = buildHardLinkLedgerRow({
      clinicId,
      linkId,
      businessDate,
      branch: branch || "unknown",
      domain: domain || "unknown",
      kind,
      createdAt: attachedAt,
    });
    const created = await svc.entities.HardLinkShareLedger.create(row);

    return Response.json({ ok: true, ledger_id: created.id, kind, key: hardLinkLedgerIdempotencyKey(clinicId, linkId) });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
});