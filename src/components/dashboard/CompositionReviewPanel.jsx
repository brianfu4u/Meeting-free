import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  GitMerge,
  Loader2,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useClinicId } from "@/lib/ClinicContext";
import {
  canCommitHypothesis,
  invokeComposition,
  reasoningTrackEntries,
} from "@/lib/phase3/compositionClient";

const C = {
  card: "#1E293B", border: "#334155", text: "#F1F5F9", sub: "#94A3B8",
  faint: "#64748B", cyan: "#00C7D9", green: "#4ade80", red: "#f87171", amber: "#fbbf24",
};

const LABELS = {
  pending_review: "待审核", selected: "已选择", dispatched: "已派发",
  committed: "已提交", stale: "已过期", rejected: "已拒绝", ignored: "已忽略",
  attach: "挂接既有工作流", new_train: "新建工作流", orphan: "孤立碎片",
};

function errorText(error) {
  const code = error?.errorCode || error?.message || "request_failed";
  const map = {
    stale_proposal: "目标快照已变化，提案已过期，请重新运行编组。",
    review_lock_busy: "另一位经理正在审核，请稍后重试。",
    commit_lock_busy: "提交正在进行，请稍后刷新。",
    action_not_allowed: "当前账号无权执行此操作。",
    manager_approval_required: "提交前必须先选择该假设。",
  };
  return map[code] || `操作失败：${code}`;
}

function Tag({ children, color = C.cyan }) {
  return (
    <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
      style={{ color, border: `1px solid ${color}55`, background: `${color}12` }}>
      {children}
    </span>
  );
}

function HypothesisCard({ hypothesis, busy, onReview, onCommit }) {
  const [open, setOpen] = React.useState(false);
  const blocks = hypothesis.validation_blocks || [];
  const tracks = reasoningTrackEntries(hypothesis.reasoning_tracks);
  const selectable = hypothesis.status === "pending_review" && blocks.length === 0;
  return (
    <div className="rounded-xl p-3" style={{ border: `1px solid ${blocks.length ? "#dc262655" : C.border}`, background: "#0f1d2e" }}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Tag color={hypothesis.status === "pending_review" ? C.amber : C.cyan}>
              {LABELS[hypothesis.status] || hypothesis.status}
            </Tag>
            <Tag>{LABELS[hypothesis.composition_type] || hypothesis.composition_type}</Tag>
            {hypothesis.rank != null && <Tag color={C.sub}>排序 #{Number(hypothesis.rank) + 1}</Tag>}
            {blocks.length > 0 && <Tag color={C.red}>{blocks.length} 项硬阻断</Tag>}
          </div>
          <div className="mt-2 break-all text-[10px]" style={{ color: C.faint }}>
            {hypothesis.workflow_hypothesis_id}
          </div>
          <div className="mt-1 text-xs" style={{ color: C.sub }}>
            {hypothesis.workflow_family || "未分类"} · 已解释 {(hypothesis.ordered_artifact_ids || []).length} 个碎片
            {(hypothesis.unexplained_artifact_ids || []).length > 0 &&
              ` · 未解释 ${hypothesis.unexplained_artifact_ids.length}`}
          </div>
        </div>
        <button aria-label="展开推理详情" onClick={() => setOpen((v) => !v)}
          className="rounded p-1" style={{ color: C.sub }}>
          {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      </div>

      {blocks.length > 0 && (
        <div className="mt-2 rounded-lg p-2 text-[11px]" style={{ color: C.red, background: "#dc262610" }}>
          {blocks.map((b, i) => <div key={i}>阻断：{b.rule_code || "unknown_rule"}</div>)}
        </div>
      )}

      {open && (
        <div className="mt-3 space-y-2 text-[11px]" style={{ color: C.sub }}>
          {tracks.map((track) => (
            <div key={track.trackId} className="rounded-lg p-2" style={{ border: `1px solid ${C.border}` }}>
              <div className="font-semibold" style={{ color: C.cyan }}>{track.trackId}</div>
              <div>{track.evidence.length ? track.evidence.join(" · ") : "暂无证据或缺口"}</div>
            </div>
          ))}
          {(hypothesis.unsupported_assumptions || []).length > 0 && (
            <div><b style={{ color: C.amber }}>无依据假设：</b>{hypothesis.unsupported_assumptions.join("；")}</div>
          )}
          {(hypothesis.contradictions || []).length > 0 && (
            <div><b style={{ color: C.red }}>矛盾：</b>{hypothesis.contradictions.join("；")}</div>
          )}
          {hypothesis.target_snapshot_id && (
            <div>目标快照：{hypothesis.target_snapshot_id} / v{hypothesis.target_snapshot_version}</div>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {hypothesis.status === "pending_review" && (
          <>
            <button disabled={busy || !selectable} onClick={() => onReview(hypothesis, "select")}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
              style={{ color: C.green, border: "1px solid #16a34a55", background: "#16a34a18" }}>
              <CheckCircle2 size={12} className="mr-1 inline" />选择
            </button>
            <button disabled={busy} onClick={() => onReview(hypothesis, "reject")}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
              style={{ color: C.red, border: "1px solid #dc262655" }}>
              <XCircle size={12} className="mr-1 inline" />拒绝
            </button>
            <button disabled={busy} onClick={() => onReview(hypothesis, "ignore")}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
              style={{ color: C.sub, border: `1px solid ${C.border}` }}>忽略</button>
          </>
        )}
        {canCommitHypothesis(hypothesis) && (
          <button disabled={busy} onClick={() => onCommit(hypothesis)}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
            style={{ color: C.cyan, border: "1px solid #00c7d955", background: "#00c7d912" }}>
            <GitMerge size={12} className="mr-1 inline" />审核后提交
          </button>
        )}
      </div>
    </div>
  );
}

export default function CompositionReviewPanel() {
  const clinicId = useClinicId();
  const qc = useQueryClient();
  const [selectedRunId, setSelectedRunId] = React.useState(null);
  const [notice, setNotice] = React.useState(null);

  const runsQ = useQuery({
    queryKey: ["compositionRuns", clinicId],
    queryFn: async () => invokeComposition(base44, {
      action: "listRuns", clinic_id: clinicId, limit: 20, include_hypothesis_summary: true,
    }),
    refetchInterval: 15000,
  });
  const runs = runsQ.data?.runs || [];
  React.useEffect(() => {
    if (!selectedRunId) {
      const first = runs.find((r) => (r.hypothesis_summary?.active_count || 0) > 0) || runs[0];
      if (first?.id) setSelectedRunId(first.id);
    }
  }, [runs, selectedRunId]);

  const detailQ = useQuery({
    queryKey: ["compositionRun", clinicId, selectedRunId],
    enabled: Boolean(selectedRunId),
    queryFn: async () => invokeComposition(base44, {
      action: "query", clinic_id: clinicId, composition_run_id: selectedRunId,
    }),
    refetchInterval: 15000,
  });

  const actionM = useMutation({
    mutationFn: async ({ action, hypothesis, decision }) => invokeComposition(base44, {
      action,
      clinic_id: clinicId,
      workflow_hypothesis_id: hypothesis.workflow_hypothesis_id,
      ...(action === "review" ? { review_decision: decision } : {}),
    }),
    onSuccess: (data, variables) => {
      setNotice({
        type: "success",
        text: variables.action === "commit"
          ? `提交结果：${data.commit?.outcome || "committed"}`
          : "审核决定已记录",
      });
      qc.invalidateQueries({ queryKey: ["compositionRuns", clinicId] });
      qc.invalidateQueries({ queryKey: ["compositionRun", clinicId, selectedRunId] });
    },
    onError: (error) => setNotice({ type: "error", text: errorText(error) }),
  });

  const hypotheses = detailQ.data?.hypotheses || [];
  const pendingCount = hypotheses.filter((h) => h.status === "pending_review").length;

  return (
    <section className="rounded-xl" style={{ background: C.card, border: `1px solid ${C.border}` }}>
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3" style={{ borderColor: C.border }}>
        <ShieldAlert size={15} style={{ color: pendingCount ? C.amber : C.cyan }} />
        <span className="text-xs font-bold" style={{ color: C.text }}>Phase 3 · 编组假设审核</span>
        {pendingCount > 0 && <Tag color={C.amber}>{pendingCount} 个待审核</Tag>}
        <button onClick={() => { runsQ.refetch(); detailQ.refetch(); }}
          className="ml-auto rounded p-1" aria-label="刷新" style={{ color: C.sub }}>
          <RefreshCw size={14} />
        </button>
      </header>

      {notice && (
        <div className="mx-3 mt-3 rounded-lg p-2 text-xs"
          style={{ color: notice.type === "error" ? C.red : C.green, border: `1px solid ${notice.type === "error" ? "#dc262655" : "#16a34a55"}` }}>
          {notice.text}
        </div>
      )}

      <div className="grid gap-3 p-3 lg:grid-cols-[230px_1fr]">
        <div className="max-h-[520px] space-y-2 overflow-y-auto">
          {runsQ.isLoading && <div className="p-3 text-xs" style={{ color: C.faint }}>加载编组运行…</div>}
          {!runsQ.isLoading && runs.length === 0 && <div className="p-3 text-xs" style={{ color: C.faint }}>暂无编组运行</div>}
          {runs.map((run) => (
            <button key={run.id} onClick={() => setSelectedRunId(run.id)}
              className="w-full rounded-lg p-2 text-left"
              style={{
                border: `1px solid ${selectedRunId === run.id ? "#00c7d966" : C.border}`,
                background: selectedRunId === run.id ? "#00c7d90d" : "#0f1d2e",
              }}>
              <div className="flex items-center justify-between text-xs">
                <span style={{ color: C.text }}>{run.business_date} · {run.slot}</span>
                <Tag color={run.status === "completed" ? C.green : run.status === "failed" ? C.red : C.amber}>
                  {run.status}
                </Tag>
              </div>
              <div className="mt-1 text-[10px]" style={{ color: C.faint }}>
                {run.hypothesis_summary?.active_count || 0} 个活跃假设 · {run.proposals_generated || 0} 个提案
              </div>
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {detailQ.isLoading && <div className="flex items-center gap-2 p-4 text-xs" style={{ color: C.faint }}><Loader2 size={14} className="animate-spin" />加载假设…</div>}
          {detailQ.error && <div className="p-3 text-xs" style={{ color: C.red }}>{errorText(detailQ.error)}</div>}
          {!detailQ.isLoading && selectedRunId && hypotheses.length === 0 && (
            <div className="p-4 text-xs" style={{ color: C.faint }}>本轮没有假设</div>
          )}
          {hypotheses.map((hypothesis) => (
            <HypothesisCard key={hypothesis.workflow_hypothesis_id}
              hypothesis={hypothesis}
              busy={actionM.isPending}
              onReview={(h, decision) => actionM.mutate({ action: "review", hypothesis: h, decision })}
              onCommit={(h) => actionM.mutate({ action: "commit", hypothesis: h })} />
          ))}
          {(detailQ.data?.attention_items || []).some((x) => x.status === "open") && (
            <div className="flex items-center gap-2 rounded-lg p-2 text-[11px]"
              style={{ color: C.amber, border: "1px solid #d9770655" }}>
              <AlertTriangle size={13} />本轮仍需经理处理，所有待审核假设均已在上方展示。
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
