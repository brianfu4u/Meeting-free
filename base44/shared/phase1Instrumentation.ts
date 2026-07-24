// Phase 1 埋点纯逻辑：构造记录、负约束过滤、硬链接占比计算、决策日志结果推导。
// 不依赖 base44 SDK，供后端自动化函数与 vitest 共用。Clinic OS V12 Phase 1a/1b。

export type CompositionResult = "attach" | "new_train" | "orphan" | "blocked";

export function decisionLogIdempotencyKey(clinicId: string, compositionRunId: string): string {
  return `${clinicId}::${compositionRunId}`;
}

export function negativeConstraintIdempotencyKey(
  clinicId: string,
  workflowId: string,
  artifactId: string
): string {
  return `${clinicId}::${workflowId}::${artifactId}`;
}

export function hardLinkLedgerIdempotencyKey(clinicId: string, linkId: string): string {
  return `${clinicId}::${linkId}`;
}

/**
 * deriveResult：从 run 的持久化字段推导决策结果。
 * blocked = 不通过自动挂接门 / 进入预审队列 / 存在拦截原因码。
 */
export function deriveResult(input: {
  bestCompositionType: string | null;
  canAutoAttach: boolean;
  llmAuditRequired: boolean;
  autoAttachGateReasons?: string[];
}): CompositionResult {
  const gateReasons = input.autoAttachGateReasons || [];
  if (!input.canAutoAttach || input.llmAuditRequired || gateReasons.length > 0) return "blocked";
  if (input.bestCompositionType === "attach") return "attach";
  if (input.bestCompositionType === "new_train") return "new_train";
  if (input.bestCompositionType === "orphan") return "orphan";
  return "blocked";
}

/**
 * buildTrackScores：聚合各假设的 reasoning_tracks，按 track_id 统计 supporting/opposing/net。
 * 当前架构为推理协议而非加权打分，net = supporting - opposing；
 * aggregate_score / threshold / margin 留待 Phase 7 阈值调优。
 */
export function buildTrackScores(
  hypotheses: any[]
): Record<string, { supporting: number; opposing: number; net: number }> {
  const acc: Record<string, { supporting: number; opposing: number; net: number }> = {};
  for (const h of hypotheses || []) {
    const tracks = h?.reasoning_tracks;
    if (!tracks || typeof tracks !== "object") continue;
    for (const [trackId, t] of Object.entries(tracks)) {
      const sup = Array.isArray((t as any).supporting_evidence)
        ? (t as any).supporting_evidence.length
        : 0;
      const opp = Array.isArray((t as any).opposing_evidence)
        ? (t as any).opposing_evidence.length
        : 0;
      if (!acc[trackId]) acc[trackId] = { supporting: 0, opposing: 0, net: 0 };
      acc[trackId].supporting += sup;
      acc[trackId].opposing += opp;
      acc[trackId].net = acc[trackId].supporting - acc[trackId].opposing;
    }
  }
  return acc;
}

export function buildAttachDecisionLog(input: {
  clinicId: string;
  compositionRunId: string;
  businessDate: string;
  branch?: string | null;
  domain?: string | null;
  trackScores?: Record<string, any>;
  aggregateScore?: number | null;
  threshold?: number | null;
  margin?: number | null;
  result: CompositionResult;
  bestHypothesisId?: string | null;
  autoAttachEligible?: boolean;
  autoAttachGateReasons?: string[];
  llmAuditRequired?: boolean;
  llmAuditReasonCodes?: string[];
  timestamp: string;
}) {
  return {
    clinic_id: input.clinicId,
    composition_run_id: input.compositionRunId,
    business_date: input.businessDate,
    branch: input.branch ?? null,
    domain: input.domain ?? null,
    track_scores: input.trackScores ?? {},
    aggregate_score: input.aggregateScore ?? null,
    threshold: input.threshold ?? null,
    margin: input.margin ?? null,
    result: input.result,
    best_hypothesis_id: input.bestHypothesisId ?? null,
    auto_attach_eligible: input.autoAttachEligible ?? false,
    auto_attach_gate_reasons: input.autoAttachGateReasons ?? [],
    llm_audit_required: input.llmAuditRequired ?? false,
    llm_audit_reason_codes: input.llmAuditReasonCodes ?? [],
    timestamp: input.timestamp,
  };
}

export function buildCorrectionCapture(input: {
  clinicId: string;
  linkId: string;
  workflowId: string;
  artifactId: string;
  managerId?: string | null;
  correctionReason?: string | null;
  label?: string;
  tags?: string[];
  branch?: string | null;
  domain?: string | null;
  capturedAt: string;
}) {
  return {
    clinic_id: input.clinicId,
    link_id: input.linkId,
    workflow_id: input.workflowId,
    artifact_id: input.artifactId,
    manager_id: input.managerId ?? null,
    correction_reason: input.correctionReason ?? null,
    label: input.label ?? "误挂接",
    tags: input.tags ?? [],
    branch: input.branch ?? null,
    domain: input.domain ?? null,
    captured_at: input.capturedAt,
  };
}

export function buildNegativeConstraint(input: {
  clinicId: string;
  workflowId: string;
  artifactId: string;
  sourceLinkId: string;
  createdAt: string;
  active?: boolean;
}) {
  return {
    clinic_id: input.clinicId,
    workflow_id: input.workflowId,
    artifact_id: input.artifactId,
    idempotency_key: negativeConstraintIdempotencyKey(
      input.clinicId,
      input.workflowId,
      input.artifactId
    ),
    source_link_id: input.sourceLinkId,
    active: input.active ?? true,
    created_at: input.createdAt,
  };
}

/**
 * isSuppressed：一个 attach 假设若其 (target_workflow_id, 任一 ordered_artifact_id)
 * 命中 active 负约束，则被抑制（un-attach 黏性）。
 */
export function isSuppressed(hypothesis: any, negativeConstraints: any[]): boolean {
  if (!hypothesis || !Array.isArray(negativeConstraints) || negativeConstraints.length === 0)
    return false;
  if (hypothesis.composition_type !== "attach") return false;
  const wf = hypothesis.target_workflow_id;
  const arts: string[] = Array.isArray(hypothesis.ordered_artifact_ids)
    ? hypothesis.ordered_artifact_ids
    : [];
  if (!wf || arts.length === 0) return false;
  return negativeConstraints.some(
    (nc) => nc && nc.active !== false && nc.workflow_id === wf && arts.includes(nc.artifact_id)
  );
}

export function filterByNegativeConstraints(
  hypotheses: any[],
  negativeConstraints: any[]
): any[] {
  if (!Array.isArray(negativeConstraints) || negativeConstraints.length === 0)
    return hypotheses || [];
  return (hypotheses || []).filter((h) => !isSuppressed(h, negativeConstraints));
}

export function buildHardLinkLedgerRow(input: {
  clinicId: string;
  linkId: string;
  businessDate: string;
  branch: string;
  domain: string;
  kind: "hard" | "soft";
  createdAt: string;
}) {
  return {
    clinic_id: input.clinicId,
    link_id: input.linkId,
    business_date: input.businessDate,
    branch: input.branch,
    domain: input.domain,
    kind: input.kind,
    created_at: input.createdAt,
  };
}

/**
 * computeHardLinkShare：聚合 ledger 行，按 branch/domain 分组，计算 hard 占比。
 * share = hard / (hard + soft)；窗口默认 7 天。
 */
export function computeHardLinkShare(
  ledgerRows: any[],
  daysWindow = 7,
  now: Date = new Date()
): {
  hard: number;
  soft: number;
  total: number;
  share: number | null;
  byBranchDomain: Record<string, {
    hard: number;
    soft: number;
    total: number;
    share: number | null;
  }>;
} {
  const cutoff = new Date(now.getTime() - daysWindow * 24 * 60 * 60 * 1000);
  let hard = 0;
  let soft = 0;
  const byBranchDomain: Record<string, {
    hard: number;
    soft: number;
    total: number;
    share: number | null;
  }> = {};
  for (const row of ledgerRows || []) {
    if (!row || !row.created_at) continue;
    const created = new Date(row.created_at);
    if (created < cutoff) continue;
    if (row.kind === "hard") hard += 1;
    else soft += 1;
    const key = `${row.branch || "?"}|${row.domain || "?"}`;
    if (!byBranchDomain[key])
      byBranchDomain[key] = { hard: 0, soft: 0, total: 0, share: null };
    if (row.kind === "hard") byBranchDomain[key].hard += 1;
    else byBranchDomain[key].soft += 1;
  }
  const total = hard + soft;
  const share = total > 0 ? hard / total : null;
  for (const key of Object.keys(byBranchDomain)) {
    const g = byBranchDomain[key];
    g.total = g.hard + g.soft;
    g.share = g.total > 0 ? g.hard / g.total : null;
  }
  return { hard, soft, total, share, byBranchDomain };
}

/**
 * buildPreAttachConflictAttention：构造 interim A1 安全路由的 AttentionItem。
 * Phase 1b：不加 SLA 分级，urgency 统一 yellow。
 */
export function buildPreAttachConflictAttention(input: {
  clinicId: string;
  compositionRunId: string;
  generatedAt: string;
  artifactIds?: string[];
  evidenceFactCardIds?: string[];
  reasonCodes?: string[];
  autoAttachGateReasons?: string[];
}) {
  const reasons = [
    ...(input.reasonCodes || []),
    ...(input.autoAttachGateReasons || []),
  ].filter(Boolean);
  return {
    clinic_id: input.clinicId,
    attention_type: "pre_attach_conflict",
    urgency: "yellow",
    title: "预挂接冲突待裁决",
    reasoning:
      `interim A1 安全路由：CompositionRun ${input.compositionRunId} 被硬护栏/审计门拦截 ` +
      `(reasons: ${reasons.join(", ") || "unknown"})。按 V12.4 interim 规则，冲突需店长裁决。`,
    recommendation: "请店长审核该编组候选，确认挂接/独立/新工作流",
    status: "open",
    generated_at: input.generatedAt,
    composition_run_id: input.compositionRunId,
    artifact_ids: input.artifactIds || [],
    evidence_fact_card_ids: input.evidenceFactCardIds || [],
  };
}