/**
 * Clinic OS V10 — 工作流今日摘要（首页只读）
 * 仅展示当天实时态势计数（流动中/卡滞/待闭环/今日闭环），
 * 不含任何操作按钮或历史归档区。点击卡片打开店长工作区抽屉查看完整视图。
 */

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { GitBranch, Archive, ChevronRight } from "lucide-react";
import { useTheme } from "@/lib/ThemeContext";
import { base44 } from "@/api/base44Client";

const CLINIC_ID = "clinic-001";

function sameDay(a) {
  if (!a) return false;
  const d = new Date(a), n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

function Stat({ value, label, color, theme }) {
  return (
    <div className="rounded-lg p-2 text-center" style={{ background: theme.canvas, border: `1px solid ${theme.border}` }}>
      <div className="text-lg font-bold tabular-nums" style={{ color }}>{value}</div>
      <div className="text-[10px]" style={{ color: theme.textMuted }}>{label}</div>
    </div>
  );
}

export default function WorkflowTodaySummary({ onOpenSnapshot, onOpenClosure }) {
  const { theme } = useTheme();
  const { data: all = [] } = useQuery({
    queryKey: ["workflowSnapshots", CLINIC_ID, "todaySummary"],
    queryFn: () => base44.entities.WorkflowSnapshot.filter({ clinic_id: CLINIC_ID }, "-generated_at", 50),
    refetchInterval: 15000,
  });

  const open = all.filter((s) => s.status !== "closed");
  const active = open.filter((s) => s.status === "active");
  const stalled = open.filter((s) => s.status === "stalled");
  const pending = open.filter((s) => s.status === "pending_manager_closure");
  const todayClosed = all.filter((s) => s.status === "closed" && sameDay(s.manager_closed_at));

  const Card = ({ icon: Icon, title, accent, onOpen, children }) => (
    <button
      onClick={onOpen}
      className="text-left rounded-xl p-4 transition-all active:scale-[0.98] w-full"
      style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${accent}1a`, border: `1px solid ${accent}33` }}>
          <Icon size={15} style={{ color: accent }} />
        </div>
        <span className="text-xs font-bold" style={{ color: theme.text }}>{title}</span>
        <span className="ml-auto text-[10px] flex items-center gap-0.5" style={{ color: theme.textMuted }}>
          查看详情 <ChevronRight size={12} />
        </span>
      </div>
      {children}
    </button>
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <Card icon={GitBranch} title="工作流快照（今日）" accent="#8B5CF6" onOpen={onOpenSnapshot}>
        <div className="grid grid-cols-3 gap-2">
          <Stat value={active.length} label="流动中" color="#4ade80" theme={theme} />
          <Stat value={stalled.length} label="卡滞" color="#fbbf24" theme={theme} />
          <Stat value={pending.length} label="待闭环" color="#00C7D9" theme={theme} />
        </div>
      </Card>
      <Card icon={Archive} title="闭环态势（今日）" accent="#A78BFA" onOpen={onOpenClosure}>
        <div className="grid grid-cols-3 gap-2">
          <Stat value={active.length} label="流动中" color="#4ade80" theme={theme} />
          <Stat value={stalled.length} label="卡滞" color="#fbbf24" theme={theme} />
          <Stat value={todayClosed.length} label="今日闭环" color="#00C7D9" theme={theme} />
        </div>
      </Card>
    </div>
  );
}