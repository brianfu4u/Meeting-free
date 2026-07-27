/**
 * 经营报告 · 人 — 员工效能
 * 闭环率 / 主动参与度 / 按员工完成任务排行
 */

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useTheme } from "@/lib/ThemeContext";
import { inRangeISO } from "@/lib/reportRange";
import { CheckCircle2, Zap, ClipboardList, Trophy } from "lucide-react";

const CLINIC_ID = "clinic-001";

function Metric({ icon: Icon, value, label, sub, color, theme }) {
  return (
    <div className="rounded-xl p-3" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
      <div className="flex items-center gap-2 mb-1.5">
        <Icon size={14} style={{ color }} />
        <span className="text-[10px]" style={{ color: theme.textMuted }}>{label}</span>
      </div>
      <div className="text-2xl font-bold tabular-nums" style={{ color }}>{value}</div>
      {sub && <div className="text-[10px] mt-0.5" style={{ color: theme.textFaint }}>{sub}</div>}
    </div>
  );
}

export default function StaffReport({ range }) {
  const { theme } = useTheme();
  const tasksQ = useQuery({
    queryKey: ["reportTasks", CLINIC_ID, range.start, range.end],
    queryFn: () => base44.entities.OperationalTask.filter({ clinic_id: CLINIC_ID }, "-created_date", 500),
    refetchInterval: 30000,
  });
  const staffQ = useQuery({
    queryKey: ["reportStaff", CLINIC_ID],
    queryFn: () => base44.entities.Staff.filter({ clinic_id: CLINIC_ID }, "-created_date", 100),
    refetchInterval: 30000,
  });

  const tasks = (tasksQ.data || []).filter((t) => inRangeISO(t.created_date, range));
  const staff = staffQ.data || [];

  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === "completed").length;
  const closureRate = total ? Math.round((completed / total) * 100) : 0;
  const selfInit = tasks.filter((t) => t.dispatched_by === "staff_self").length;
  const proactiveness = total ? Math.round((selfInit / total) * 100) : 0;

  const byStaff = {};
  for (const t of tasks) {
    if (t.status === "completed" && t.assignee_staff_id) {
      byStaff[t.assignee_staff_id] = (byStaff[t.assignee_staff_id] || 0) + 1;
    }
  }
  const nameOf = (id) => staff.find((s) => s.id === id)?.staff_name || "未绑定";
  const roleOf = (id) => staff.find((s) => s.id === id)?.role || "—";
  const ranked = Object.entries(byStaff).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const maxCount = ranked[0]?.[1] || 1;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2.5">
        <Metric icon={ClipboardList} value={total} label="任务总数" sub={`范围内派发`} color="#00C7D9" theme={theme} />
        <Metric icon={CheckCircle2} value={`${closureRate}%`} label="闭环率" sub={`已完成 ${completed}/${total}`} color="#4ade80" theme={theme} />
        <Metric icon={Zap} value={`${proactiveness}%`} label="主动参与度" sub={`员工自主发起 ${selfInit}`} color="#FBBF24" theme={theme} />
      </div>

      <div className="rounded-xl p-3" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
        <div className="flex items-center gap-2 mb-2.5">
          <Trophy size={13} style={{ color: "#FBBF24" }} />
          <span className="text-xs font-bold" style={{ color: theme.text }}>员工任务完成排行</span>
          <span className="ml-auto text-[10px]" style={{ color: theme.textFaint }}>Top {ranked.length}</span>
        </div>
        {ranked.length === 0 ? (
          <div className="py-6 text-center text-xs" style={{ color: theme.textFaint }}>范围内无已完成任务</div>
        ) : (
          <div className="space-y-1.5">
            {ranked.map(([sid, cnt], i) => (
              <div key={sid} className="flex items-center gap-2">
                <span className="text-[10px] w-4 text-center" style={{ color: i < 3 ? "#FBBF24" : theme.textFaint }}>{i + 1}</span>
                <span className="text-xs font-semibold w-20 truncate" style={{ color: theme.text }}>{nameOf(sid)}</span>
                <span className="text-[9.5px] w-16 truncate" style={{ color: theme.textMuted }}>{roleOf(sid)}</span>
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                  <div className="h-full rounded-full" style={{ width: `${(cnt / maxCount) * 100}%`, background: "linear-gradient(90deg,#4ade80,#00C7D9)" }} />
                </div>
                <span className="text-xs font-bold tabular-nums w-6 text-right" style={{ color: "#4ade80" }}>{cnt}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}