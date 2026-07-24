import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import { buildPreAttachConflictAttention } from "../../shared/phase1Instrumentation.ts";

/**
 * preAttachConflictRouter — Phase 1b Interim A1 安全路由
 *
 * 定时扫描 CompositionRun(llm_audit_required=true)，为每条尚无对应 pre_attach_conflict
 * AttentionItem 的 run 物化一条 AttentionItem（V12.4 interim 规则，单终态 escalate_human）。
 *
 * 幂等：先查 AttentionItem(composition_run_id=run.id, attention_type=pre_attach_conflict)。
 * Phase 1b：不加 urgency 分级 / SLA，统一 yellow。
 *
 * 上线预警：当天 AttentionQueue 量可能暴涨一个数量级——这是历史被静默拦截积压首次变可见，
 * 预计一次性暴涨后约两周回落稳定水位。不得因此调高冲突阈值或回滚路由。
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;
    const now = new Date().toISOString();

    // 扫描最近 7 天 llm_audit_required=true 的 run（含历史积压）
    const runs = await svc.entities.CompositionRun.filter(
      { llm_audit_required: true },
      "-created_date",
      100
    );

    let created = 0;
    let skipped = 0;
    const createdIds: string[] = [];
    for (const run of runs || []) {
      if (!run.id || !run.clinic_id) continue;
      // 幂等检查
      const existing = await svc.entities.AttentionItem.filter(
        {
          clinic_id: run.clinic_id,
          composition_run_id: run.id,
          attention_type: "pre_attach_conflict",
        },
        "-generated_at",
        1
      );
      if (existing && existing.length > 0) {
        skipped += 1;
        continue;
      }
      const descriptor = buildPreAttachConflictAttention({
        clinicId: run.clinic_id,
        compositionRunId: run.id,
        generatedAt: now,
        artifactIds: run.artifact_ids_processed || [],
        reasonCodes: run.llm_audit_reason_codes || [],
        autoAttachGateReasons: run.auto_attach_gate_reasons || [],
      });
      const attn = await svc.entities.AttentionItem.create(descriptor);
      created += 1;
      createdIds.push(attn.id);
    }

    return Response.json({
      ok: true,
      scanned: (runs || []).length,
      created,
      skipped,
      created_ids: createdIds,
      note: "interim A1 路由：单终态 escalate_human，无三态队列（Phase 5）",
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
});