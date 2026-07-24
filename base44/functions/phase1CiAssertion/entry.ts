import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import { computeHardLinkShare } from "../../shared/phase1Instrumentation.ts";

/**
 * phase1CiAssertion — Phase 1 完成标准 CI 断言
 *
 * 返回四项完成标准指标，供 CI 跑在生产形状的数据上断言：
 *  1. unattended_audit_count: llm_audit_required=true 且 无对应 pre_attach_conflict AttentionItem
 *     且年龄超过 1 小时的 run 数（必须为 0）
 *  2. decision_log_coverage: 过去 24h 完成的 run 数 vs 对应 AttachDecisionLog 行数（应一致）
 *  3. stickiness: 当前 active NegativeConstraint 数量（样本；黏性逻辑由单测验证）
 *  4. hard_link_share_7d: 最近 7 天硬链接占比（Phase 2 基线）
 *
 * 系统级只读函数（CI / 调度调用），使用 asServiceRole。
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // 1. unattended_audit_count
    const auditRuns = await svc.entities.CompositionRun.filter(
      { llm_audit_required: true },
      "-created_date",
      200
    );
    let unattended = 0;
    for (const run of auditRuns || []) {
      if (!run.id || !run.clinic_id) continue;
      if (!run.created_date || run.created_date > oneHourAgo) continue; // 仅算超过 1h 的
      const existing = await svc.entities.AttentionItem.filter(
        {
          clinic_id: run.clinic_id,
          composition_run_id: run.id,
          attention_type: "pre_attach_conflict",
        },
        "-generated_at",
        1
      );
      if (!existing || existing.length === 0) unattended += 1;
    }

    // 2. decision_log_coverage（过去 24h 完成的 run vs AttachDecisionLog）
    const recentRuns = await svc.entities.CompositionRun.filter(
      { status: "completed" },
      "-run_finished_at",
      200
    );
    const completed24h = (recentRuns || []).filter(
      (r) => r.run_finished_at && r.run_finished_at > twentyFourHoursAgo && r.id && r.clinic_id
    );
    let logMatched = 0;
    for (const r of completed24h) {
      const logs = await svc.entities.AttachDecisionLog.filter(
        { clinic_id: r.clinic_id, composition_run_id: r.id },
        "-timestamp",
        1
      );
      if (logs && logs.length > 0) logMatched += 1;
    }

    // 3. stickiness: active NegativeConstraint 计数
    let activeNegativeConstraints = 0;
    try {
      const ncs = await svc.entities.NegativeConstraint.filter(
        { active: true },
        "-created_at",
        500
      );
      activeNegativeConstraints = (ncs || []).length;
    } catch { /* 忽略 */ }

    // 4. hard_link_share_7d
    let hardLinkShare = { hard: 0, soft: 0, total: 0, share: null, byBranchDomain: {} };
    try {
      const ledger = await svc.entities.HardLinkShareLedger.filter(
        { created_at: { $gte: sevenDaysAgo } },
        "-created_at",
        500
      );
      hardLinkShare = computeHardLinkShare(ledger || [], 7, now);
    } catch { /* 忽略 */ }

    return Response.json({
      ok: true,
      assertions: {
        unattended_audit_count: unattended, // 必须 === 0
        decision_log_coverage: {
          runs_completed_24h: completed24h.length,
          decision_logs_matched: logMatched,
          match: completed24h.length === logMatched,
        },
        stickiness: {
          active_negative_constraints: activeNegativeConstraints,
          note: "黏性逻辑（filterByNegativeConstraints 抑制已 un-attach 对）由 instrumentation 单测验证",
        },
        hard_link_share_7d: hardLinkShare,
        note: "Phase 2 基线：hard_link_share_7d.share",
      },
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
});