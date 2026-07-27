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

const CLINIC_ID = "clinic-001";
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
    queryFn: () => base44.entities.CompositionRun.filter({ clinic_id: CLINIC_ID, business_date: today }, "-run_started_at", 50),
    refetchInterval: 15000,
  });
  const snapsQ = useQuery({
    queryKey: ["workflowSnapshots", CLINIC_ID, "todayFlow"],
    queryFn: () => base44.entities.WorkflowSnapshot.filter({ clinic_id: CLINIC_ID }, "-generated_at", 50),
    refetchInterval: 15000,
  });

  const runs = runsQ.data || [];
  const snaps = snapsQ.data || [];

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
  // 红色（急需介入）优先展示，其次黄色（疑似卡滞），最后绿色（正常流动）
  const stateOrder = ["pending_manager_closure", "stalled", "active"];
  const listed = [...openSnaps]
    .sort((a, b) => stateOrder.indexOf(a.status) - stateOrder.indexOf(b.status))
    .slice(0, 5);

  const MiniStat = ({ icon: Icon, value, label, color }) => (
    <div className="rounded-lg p-2 flex items-center gap-2" style={{ background: theme.canvas, border: `1px solid ${theme.border}` }}>
      <Icon size={13} style={{ color }} />
      <div>
        <div className="text-base font-bold tabular-nums leading-none" style={{ color }}>{value}</div>
        <div className="text-[9.5px]" style={{ color: theme.textMuted }}>{label}</div>
      </div>
    </div>
  );

  const StatePill = ({ state, count }) => {
    const c = FLOW_STATES[state];
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg flex-1 min-w-0" style={{ background: c.bg, border: `1px solid ${c.color}33` }}>
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: c.color }} />
        <span className="text-sm font-bold tabular-nums flex-shrink-0" style={{ color: c.color }}>{count}</span>
        <span className="text-[10px] truncate" style={{ color: theme.textMuted }}>{c.label}</span>
      </div>
    );
  };

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

      {/* 右卡：截止当前工作流流动情况（三态） */}
      <button
        onClick={onOpenClosure}
        className="text-left rounded-xl p-4 transition-all active:scale-[0.98] w-full"
        style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}
      >
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(0,199,217,0.15)", border: "1px solid rgba(0,199,217,0.33)" }}>
            <Activity size={15} style={{ color: "#00C7D9" }} />
          </div>
          <span className="text-xs font-bold" style={{ color: theme.text }}>工作流流动（今日）</span>
          <span className="ml-auto text-[10px] flex items-center gap-0.5" style={{ color: theme.textMuted }}>
            查看详情 <ChevronRight size={12} />
          </span>
        </div>
        <div className="flex items-center gap-2 mb-2.5">
          <StatePill state="active" count={flow.active} />
          <StatePill state="stalled" count={flow.stalled} />
          <StatePill state="pending_manager_closure" count={flow.pending_manager_closure} />
        </div>
        <div className="space-y-1">
          {listed.length === 0 && (
            <div className="text-[10px] py-2 text-center" style={{ color: theme.textFaint }}>今日暂无活跃工作流</div>
          )}
          {listed.map((s) => {
            const c = FLOW_STATES[s.status] || FLOW_STATES.active;
            return (
              <div key={s.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ background: theme.canvas, border: `1px solid ${theme.border}`, borderLeft: `3px solid ${c.color}` }}>
                <span className="text-xs font-semibold flex-shrink-0" style={{ color: theme.text, minWidth: "60px" }}>{s.patient_name || "未登记"}</span>
                <span className="text-[10px] flex-shrink-0" style={{ color: theme.textMuted }}>{LINE_LABEL[s.business_line] || "—"}</span>
                <span className="text-[10px] flex-1 truncate ml-1" style={{ color: theme.textMuted }}>{s.current_node || "—"}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold flex-shrink-0" style={{ background: c.bg, color: c.color }}>{c.label}</span>
              </div>
            );
          })}
        </div>
      </button>
    </div>
  );
}