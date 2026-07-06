/**
 * Clinic OS V9 M2 — 实时态势总览面板
 * 从实体库实时读取数据，替代模拟数据源。
 * 展示：在岗人员状态、患者流转队列、待决策任务、活跃告警、营收达成。
 */

import React from "react";
import { Users, UserCheck, AlertTriangle, ClipboardList, TrendingUp, Activity, RefreshCw } from "lucide-react";
import { useTheme } from "@/lib/ThemeContext";
import {
  usePatientSessions,
  useStaff,
  useOperationalTasks,
  useAlerts,
  useInventory,
  useRevenueTargets,
  deriveHealthScore,
} from "@/hooks/useClinicData";

const STATUS_LABEL = {
  arrived: { label: "已到店", color: "#94A3B8" },
  seated: { label: "候诊中", color: "#FBBF24" },
  in_progress: { label: "诊疗中", color: "#00C7D9" },
  completed: { label: "已完成", color: "#4ade80" },
  stalled: { label: "卡滞", color: "#f87171" },
};

const STAFF_STATUS_LABEL = {
  on_duty: { label: "在岗", color: "#4ade80" },
  busy: { label: "忙碌", color: "#00C7D9" },
  awaiting_confirm: { label: "待确认", color: "#FBBF24" },
  break: { label: "休息", color: "#94A3B8" },
  off_duty: { label: "离岗", color: "#64748B" },
};

const TASK_STATUS_LABEL = {
  pending_approval: { label: "待审批", color: "#FBBF24" },
  assigned: { label: "已派发", color: "#00C7D9" },
  in_progress: { label: "执行中", color: "#3B82F6" },
  pending_evidence: { label: "待取证", color: "#A78BFA" },
  under_review: { label: "审核中", color: "#A78BFA" },
  exception: { label: "异常", color: "#f87171" },
  completed: { label: "已完成", color: "#4ade80" },
};

function MetricPill({ icon: Icon, label, value, color, sub }) {
  const { theme } = useTheme();
  return (
    <div className="rounded-xl px-4 py-3 flex items-center gap-3" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${color}1a`, border: `1px solid ${color}33` }}>
        <Icon size={16} style={{ color }} />
      </div>
      <div className="min-w-0">
        <div className="text-xs" style={{ color: theme.textMuted, fontSize: "10px" }}>{label}</div>
        <div className="flex items-baseline gap-1">
          <span className="text-lg font-bold" style={{ color: theme.text }}>{value}</span>
          {sub && <span className="text-xs" style={{ color: theme.textMuted, fontSize: "10px" }}>{sub}</span>}
        </div>
      </div>
    </div>
  );
}

export default function LiveOpsPanel() {
  const { theme } = useTheme();
  const sessionsQ = usePatientSessions();
  const staffQ = useStaff();
  const tasksQ = useOperationalTasks();
  const alertsQ = useAlerts();
  const inventoryQ = useInventory();
  const revenueQ = useRevenueTargets();

  const loading = sessionsQ.isLoading || staffQ.isLoading;
  const sessions = sessionsQ.data || [];
  const staff = staffQ.data || [];
  const tasks = tasksQ.data || [];
  const alerts = alertsQ.data || [];
  const inventory = inventoryQ.data || [];
  const revenue = revenueQ.data || [];

  const healthScore = deriveHealthScore(sessions, tasks, alerts, inventory);

  const onDutyStaff = staff.filter((s) => s.status === "on_duty" || s.status === "busy").length;
  const busyStaff = staff.filter((s) => s.status === "busy").length;
  const inProgressPatients = sessions.filter((s) => s.status === "in_progress").length;
  const waitingPatients = sessions.filter((s) => s.status === "seated" || s.status === "arrived").length;
  const pendingTasks = tasks.filter((t) => t.status === "pending_approval").length;
  const redAlerts = alerts.filter((a) => a.urgency === "red").length;
  const lowStock = inventory.filter((i) => i.below_threshold).length;
  const totalTarget = revenue.reduce((s, r) => s + (r.target_amount || 0), 0);
  const totalActual = revenue.reduce((s, r) => s + (r.actual_amount || 0), 0);
  const achievementRate = totalTarget > 0 ? Math.round((totalActual / totalTarget) * 100) : 0;

  const healthColor = healthScore >= 85 ? "#4ade80" : healthScore >= 70 ? "#FBBF24" : "#f87171";

  return (
    <div className="rounded-2xl p-4 md:p-5" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(0,199,217,0.15)", border: "1px solid rgba(0,199,217,0.3)" }}>
            <Activity size={14} style={{ color: "#00C7D9" }} />
          </div>
          <div>
            <div className="text-sm font-bold" style={{ color: theme.text }}>实时态势总览</div>
            <div className="text-xs" style={{ color: theme.textMuted, fontSize: "10px" }}>M2 态势层 · 实体库直读 · 15秒刷新</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {loading && <RefreshCw size={12} className="animate-spin" style={{ color: theme.textMuted }} />}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg" style={{ background: `${healthColor}1a`, border: `1px solid ${healthColor}33` }}>
            <span className="text-xs font-semibold" style={{ color: healthColor, fontSize: "10px" }}>健康</span>
            <span className="text-sm font-bold" style={{ color: healthColor }}>{healthScore}</span>
          </div>
        </div>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <MetricPill icon={UserCheck} label="在岗员工" value={onDutyStaff} sub={`/ ${staff.length}`} color="#4ade80" />
        <MetricPill icon={Users} label="候诊患者" value={waitingPatients} sub="人" color="#FBBF24" />
        <MetricPill icon={Activity} label="诊疗中" value={inProgressPatients} sub="人" color="#00C7D9" />
        <MetricPill icon={ClipboardList} label="待决策" value={pendingTasks} sub="项" color="#A78BFA" />
        <MetricPill icon={AlertTriangle} label="活跃告警" value={alerts.length} sub={`红${redAlerts}`} color={redAlerts > 0 ? "#f87171" : "#FBBF24"} />
        <MetricPill icon={TrendingUp} label="营收达成" value={`${achievementRate}%`} sub={`¥${totalActual.toLocaleString()}`} color={achievementRate >= 60 ? "#4ade80" : "#FBBF24"} />
      </div>

      {/* Two-column: patient flow + staff status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Patient flow */}
        <div className="rounded-xl p-3" style={{ background: theme.canvas, border: `1px solid ${theme.border}` }}>
          <div className="text-xs font-bold mb-2" style={{ color: theme.text }}>患者流转队列</div>
          {sessions.length === 0 ? (
            <div className="text-xs py-4 text-center" style={{ color: theme.textMuted }}>暂无就诊会话</div>
          ) : (
            <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
              {sessions.slice(0, 8).map((s) => {
                const st = STATUS_LABEL[s.status] || STATUS_LABEL.arrived;
                return (
                  <div key={s.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: st.color }} />
                    <span className="text-xs font-semibold flex-shrink-0" style={{ color: theme.text, minWidth: "60px" }}>{s.patient_name || "未登记"}</span>
                    <span className="text-xs flex-shrink-0" style={{ color: theme.textMuted, fontSize: "10px" }}>{s.business_line === "optometry" ? "验光" : s.business_line === "medical" ? "眼科" : "训练"}</span>
                    <span className="text-xs flex-1 truncate" style={{ color: theme.textSub, fontSize: "10px" }}>{s.current_node || "—"}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: `${st.color}1a`, color: st.color, fontSize: "10px" }}>{st.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Staff status */}
        <div className="rounded-xl p-3" style={{ background: theme.canvas, border: `1px solid ${theme.border}` }}>
          <div className="text-xs font-bold mb-2" style={{ color: theme.text }}>员工在岗态势</div>
          {staff.length === 0 ? (
            <div className="text-xs py-4 text-center" style={{ color: theme.textMuted }}>暂无员工数据</div>
          ) : (
            <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
              {staff.slice(0, 8).map((s) => {
                const st = STAFF_STATUS_LABEL[s.status] || STAFF_STATUS_LABEL.off_duty;
                return (
                  <div key={s.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: st.color }} />
                    <span className="text-xs font-semibold flex-shrink-0" style={{ color: theme.text, minWidth: "60px" }}>{s.staff_name}</span>
                    <span className="text-xs flex-1 truncate" style={{ color: theme.textSub, fontSize: "10px" }}>{s.assigned_zone || "—"}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: `${st.color}1a`, color: st.color, fontSize: "10px" }}>{st.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Alerts strip */}
      {alerts.length > 0 && (
        <div className="mt-3 rounded-xl p-3" style={{ background: theme.canvas, border: `1px solid ${theme.border}` }}>
          <div className="text-xs font-bold mb-2" style={{ color: theme.text }}>活跃告警 · 待店长决策</div>
          <div className="space-y-1.5 max-h-[120px] overflow-y-auto">
            {alerts.slice(0, 4).map((a) => {
              const color = a.urgency === "red" ? "#f87171" : "#FBBF24";
              return (
                <div key={a.id} className="flex items-start gap-2 px-2 py-1.5 rounded-lg" style={{ background: `${color}0d`, border: `1px solid ${color}33`, borderLeft: `3px solid ${color}` }}>
                  <AlertTriangle size={12} style={{ color, flexShrink: 0, marginTop: "1px" }} />
                  <span className="text-xs flex-1" style={{ color: theme.text, fontSize: "11px" }}>{a.message}</span>
                  {a.llm_suggestion && <span className="text-xs flex-shrink-0" style={{ color: theme.textMuted, fontSize: "10px", maxWidth: "200px" }}>💡 {a.llm_suggestion}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}