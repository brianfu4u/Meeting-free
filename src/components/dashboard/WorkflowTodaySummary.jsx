/**
 * Clinic OS V10 — 工作流今日摘要（首页只读）
 * 左卡：当天工作流编组情况（CompositionRun 运行 / 提案 / 处理证据 / 状态）
 * 右卡：截止当前工作流流动情况（WorkflowSnapshot 三态：正常流动 / 疑似卡滞 / 急需介入）
 * 仅展示当天实时态势，不含操作按钮或历史归档；点击打开店长工作区抽屉查看完整视图。
 */

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { GitBranch, Activity, ChevronRight, Layers, FileText, Boxes } from "lucide-react";
import { useTheme } from "@/lib/ThemeContext";
import { base44 } from "@/api/base44Client";
import { todayBeijingDate } from "@/lib/clinicTime";
import { asList, CLINIC_ID } from "@/hooks/useClinicData";

const LINE_LABEL = { optometry: "验光", medical: "眼科", vision_training: "训练" };

// 工作流流动三态（宪法 V10 状态语义映射）
const FLOW_STATES = {
  active: { label: "正常流动", color: "#4ade80", bg: "rgba(74,222,128,0.12)" },
  stalled: { label: "疑似卡滞", color: "#fbbf24", bg: "rgba(251,191,36,0.12)" },
  pending_manager_closure: { label: "急需介入", color: "#f87171", bg: "rgba(248,113,113,0.12)" },
};

export default function WorkflowTodaySummary({ onOpenSnapshot, onOpenClosure }) {
  const { theme } = useTheme();
  const today = todayBeijingDate();

  const runsQ = useQuery({
    queryKey: ["compositionRuns", CLINIC_ID, today],
    queryFn: async () => asList(await base44.entities.CompositionRun.filter({ clinic_id: CLINIC_ID, business_date: today }, "-run_started_at", 50)),
    refetchInterval: 15000,
  });
  const snapsQ = useQuery({
    queryKey: ["workflowSnapshots", CLINIC_ID, "todayFlow"],
    queryFn: async () => asList(await base44.entities.WorkflowSnapshot.filter({ clinic_id: CLINIC_ID }, "-generated_at", 50)),
    refetchInterval: 15000,
  });

  const runs = asList(runsQ.data);
  const snaps = asList(snapsQ.data);

  // ── 左：当天工作流编组（CompositionRun）──
  const runCount = runs.length;
  const proposals = runs.reduce((s, r) => s + (r.proposals_generated || 0), 0);
  const artifacts = runs.reduce((s, r) => s + (r.artifact_ids_processed?.length || 0), 0);
  const completedRuns = runs.filter((r) => r.status === "completed").length;
  const runningRuns = runs.filter((r) => r.status === "running").length;
  const failedRuns = runs.filter((r) => r.status === "failed").length;

  // ── 右：截止当前工作流流动（WorkflowSnapshot 三态）──
  const openSnaps = snaps.filter((s) => s.status !== "closed");
  const flow = { active: 0, stalled: 0, pending_manager_closure: 0 };
  for (const s of openSnaps) {
    if (flow[s.status] !== undefined) flow[s.status] += 1;
  }
  // 首页仅列出「急需介入」工作流，其余状态点击上方数字抽屉查看完整列表
  const urgent = openSnaps.filter((s) => s.status === "pending_manager_closure").slice(0, 6);

  const MiniStat = ({ icon: Icon, value, label, color }) => (
    <div className="rounded-lg p-2 flex items-center gap-2" style={{ background: theme.canvas, border: `1px solid ${theme.border}` }}>
      <Icon size={13} style={{ color }} />
      <div>
        <div className="text-base font-bold tabular-nums leading-none" style={{ color }}>{value}</div>
        <div className="text-[9.5px]" style={{ color: theme.textMuted }}>{label}</div>
      </div>
    </div>
  );

  const StatePill = ({ state, count, onClick }) => {
    const c = FLOW_STATES[state];
    return (
      <button onClick={onClick} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg flex-1 min-w-0 transition hover:opacity-80" style={{ background: c.bg, border: `1px solid ${c.color}33` }}>
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: c.color }} />
        <span className="text-sm font-bold tabular-nums flex-shrink-0" style={{ color: c.color }}>{count}</span>
        <span className="text-[10px] truncate" style={{ color: theme.textMuted }}>{c.label}</span>
      </button>
    );
  };

  // 闭环进度：已耗时 / (已耗时 + 预估剩余)，封顶 95%
  const closureProgress = (s) => {
    const elapsed = s.total_elapsed_minutes || 0;
    const remain = s.estimated_completion_minutes || 0;
    if (elapsed === 0 && remain === 0) return 0;
    const total = elapsed + remain;
    if (total <= 0) return 0;
    return Math.min(95, Math.max(5, Math.round((elapsed / total) * 100)));
  };
  // AI 闭环建议：优先 llm_recommendation，缺省回退到瓶颈节点提示
  const closureAdvice = (s) =>
    s.llm_recommendation ||
    (s.bottleneck_node ? `需补充「${s.bottleneck_node}」节点证据以推进闭环` : "暂无 AI 建议，请店长研判");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {/* 左卡：当天工作流编组情况 */}
      <button
        onClick={onOpenSnapshot}
        className="text-left rounded-xl p-4 transition-all active:scale-[0.98] w-full"
        style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}
      >
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.33)" }}>
            <Layers size={15} style={{ color: "#8B5CF6" }} />
          </div>
          <span className="text-xs font-bold" style={{ color: theme.text }}>工作流编组（今日）</span>
          <span className="ml-auto text-[10px] flex items-center gap-0.5" style={{ color: theme.textMuted }}>
            查看详情 <ChevronRight size={12} />
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-2">
          <MiniStat icon={GitBranch} value={runCount} label="编组运行" color="#8B5CF6" />
          <MiniStat icon={FileText} value={proposals} label="生成提案" color="#00C7D9" />
          <MiniStat icon={Boxes} value={artifacts} label="处理证据" color="#A78BFA" />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: "rgba(74,222,128,0.12)", color: "#4ade80" }}>已完成 {completedRuns}</span>
          <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: "rgba(0,199,217,0.12)", color: "#00C7D9" }}>进行中 {runningRuns}</span>
          {failedRuns > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: "rgba(248,113,113,0.12)", color: "#f87171" }}>失败 {failedRuns}</span>
          )}
          {runCount === 0 && <span className="text-[10px]" style={{ color: theme.textFaint }}>今日暂无编组运行</span>}
        </div>
      </button>

      {/* 右卡：截止当前工作流流动情况（三态 + 急需介入清单） */}
      <div
        className="rounded-xl p-4 w-full"
        style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}
      >
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(0,199,217,0.15)", border: "1px solid rgba(0,199,217,0.33)" }}>
            <Activity size={15} style={{ color: "#00C7D9" }} />
          </div>
          <span className="text-xs font-bold" style={{ color: theme.text }}>工作流流动（截至当前）</span>
          <button onClick={onOpenClosure} className="ml-auto text-[10px] flex items-center gap-0.5 transition hover:opacity-80" style={{ color: theme.textMuted }}>
            查看详情 <ChevronRight size={12} />
          </button>
        </div>
        {/* 三态数字：点击打开抽屉查看对应完整列表 */}
        <div className="flex items-center gap-2 mb-2.5">
          <StatePill state="active" count={flow.active} onClick={onOpenClosure} />
          <StatePill state="stalled" count={flow.stalled} onClick={onOpenClosure} />
          <StatePill state="pending_manager_closure" count={flow.pending_manager_closure} onClick={onOpenClosure} />
        </div>
        {/* 急需介入清单：闭环进度条 + AI 闭环建议 */}
        <div className="space-y-1.5">
          {urgent.length === 0 && (
            <div className="text-[10px] py-3 text-center" style={{ color: theme.textFaint }}>暂无急需介入工作流</div>
          )}
          {urgent.map((s) => {
            const pct = closureProgress(s);
            const advice = closureAdvice(s);
            return (
              <button
                key={s.id}
                onClick={onOpenClosure}
                className="w-full text-left px-2.5 py-2 rounded-lg transition hover:opacity-90"
                style={{ background: theme.canvas, border: `1px solid ${theme.border}`, borderLeft: "3px solid #f87171" }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold flex-shrink-0" style={{ color: theme.text, minWidth: "56px" }}>{s.patient_name || "未登记"}</span>
                  <span className="text-[10px] flex-shrink-0" style={{ color: theme.textMuted }}>{LINE_LABEL[s.business_line] || "—"}</span>
                  <span className="text-[10px] flex-1 truncate ml-1" style={{ color: theme.textMuted }}>{s.current_node || "—"}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold flex-shrink-0 tag-red">{FLOW_STATES.pending_manager_closure.label}</span>
                </div>
                {/* 闭环进度条 */}
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "linear-gradient(90deg,#fbbf24,#f87171)" }} />
                  </div>
                  <span className="text-[9.5px] tabular-nums w-7 text-right" style={{ color: theme.textMuted }}>{pct}%</span>
                </div>
                {/* AI 闭环建议 */}
                <div className="flex items-start gap-1">
                  <span className="text-[9px] px-1 py-0.5 rounded flex-shrink-0" style={{ background: "rgba(248,113,113,0.12)", color: "#f87171" }}>AI建议</span>
                  <span className="text-[10px] leading-snug" style={{ color: theme.textMuted }}>{advice}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
