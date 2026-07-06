/**
 * Clinic OS V9 — 四维现实空间指挥台
 * 聚焦诊所运营的四个核心维度：人 / 流 / 钱 / 物
 * 每个维度仅展示最关键态势指标，点击下钻进入维度详情抽屉。
 * 设计原则：无异常即静默；告警触发才高亮。
 */

import React from "react";
import { Users, Activity, TrendingUp, Package, AlertTriangle, ChevronRight, RefreshCw } from "lucide-react";
import { useTheme } from "@/lib/ThemeContext";
import {
  usePatientSessions,
  useStaff,
  useInventory,
  useRevenueTargets,
} from "@/hooks/useClinicData";

const STATUS_LEVEL = {
  green: { color: "#4ade80", glow: "rgba(22,163,74,0.08)", border: "rgba(22,163,74,0.2)" },
  amber: { color: "#FBBF24", glow: "rgba(217,119,6,0.1)",  border: "rgba(217,119,6,0.3)" },
  red:   { color: "#f87171", glow: "rgba(220,38,38,0.12)", border: "rgba(220,38,38,0.35)" },
};

const STAFF_STATUS = {
  on_duty: "#4ade80", busy: "#00C7D9", awaiting_confirm: "#FBBF24",
  break: "#94A3B8", off_duty: "#64748B",
};

const PATIENT_STATUS = {
  arrived: "#94A3B8", seated: "#FBBF24", in_progress: "#00C7D9",
  completed: "#4ade80", stalled: "#f87171",
};

function DimensionCard({ icon: Icon, label, headline, headlineSub, alerts, status, onClick, theme, accent }) {
  const lvl = STATUS_LEVEL[status] || STATUS_LEVEL.green;
  const hasAlert = alerts > 0;
  return (
    <button
      onClick={onClick}
      className="group text-left rounded-2xl p-4 md:p-5 transition-all duration-200 active:scale-[0.98] relative overflow-hidden"
      style={{
        background: theme.cardBg,
        border: `1px solid ${hasAlert ? lvl.border : theme.border}`,
        boxShadow: hasAlert ? `0 0 24px ${lvl.glow}` : "none",
      }}
    >
      {/* Pulse ring for red alerts */}
      {status === "red" && (
        <span
          className="absolute top-3 right-3 w-2.5 h-2.5 rounded-full"
          style={{ background: lvl.color, animation: "pulseRed 1.5s ease-in-out infinite" }}
        />
      )}

      {/* Header */}
      <div className="flex items-center gap-2.5 mb-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: `${accent}1a`, border: `1px solid ${accent}33` }}
        >
          <Icon size={17} style={{ color: accent }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold tracking-widest" style={{ color: theme.textMuted, fontSize: "10px", letterSpacing: "0.12em" }}>
            {label}
          </div>
          {hasAlert && (
            <div className="flex items-center gap-1 mt-0.5">
              <AlertTriangle size={10} style={{ color: lvl.color }} />
              <span className="text-xs font-semibold" style={{ color: lvl.color, fontSize: "10px" }}>
                {alerts} 项告警
              </span>
            </div>
          )}
        </div>
        <ChevronRight
          size={15}
          className="transition-transform duration-200 group-hover:translate-x-0.5"
          style={{ color: theme.textFaint }}
        />
      </div>

      {/* Headline metric */}
      <div className="flex items-baseline gap-1.5">
        <span className="font-bold tabular-nums" style={{ color: theme.text, fontSize: "30px", lineHeight: "1" }}>
          {headline}
        </span>
        {headlineSub && (
          <span className="text-xs" style={{ color: theme.textMuted, fontSize: "11px" }}>{headlineSub}</span>
        )}
      </div>
    </button>
  );
}

export default function FourDimensionsPanel({ onOpenDimension }) {
  const { theme } = useTheme();
  const staffQ = useStaff();
  const sessionsQ = usePatientSessions();
  const inventoryQ = useInventory();
  const revenueQ = useRevenueTargets();

  const loading = staffQ.isLoading || sessionsQ.isLoading;
  const staff = staffQ.data || [];
  const sessions = sessionsQ.data || [];
  const inventory = inventoryQ.data || [];
  const revenue = revenueQ.data || [];

  // ── 人：员工在岗态势 ──
  const onDuty = staff.filter((s) => s.status === "on_duty" || s.status === "busy").length;
  const busy = staff.filter((s) => s.status === "busy").length;
  const anomalies = staff.filter((s) => s.status === "awaiting_confirm" || (s.pad_online === false && s.status !== "off_duty")).length;
  const staffStatus = anomalies > 0 ? "red" : busy >= onDuty * 0.8 ? "amber" : "green";

  // ── 流：患者流转 ──
  const waiting = sessions.filter((s) => s.status === "seated" || s.status === "arrived").length;
  const inProgress = sessions.filter((s) => s.status === "in_progress").length;
  const stalled = sessions.filter((s) => s.status === "stalled").length;
  const flowStatus = stalled > 0 ? "red" : waiting >= 8 ? "amber" : "green";
  const flowAlerts = stalled + (waiting >= 8 ? 1 : 0);

  // ── 钱：营收达成 ──
  const totalTarget = revenue.reduce((s, r) => s + (r.target_amount || 0), 0);
  const totalActual = revenue.reduce((s, r) => s + (r.actual_amount || 0), 0);
  const achievementRate = totalTarget > 0 ? Math.round((totalActual / totalTarget) * 100) : 0;
  const moneyStatus = achievementRate < 40 ? "red" : achievementRate < 60 ? "amber" : "green";

  // ── 物：库存水位 ──
  const lowStock = inventory.filter((i) => i.below_threshold).length;
  const thingStatus = lowStock >= 3 ? "red" : lowStock > 0 ? "amber" : "green";

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <div className="w-1 h-4 rounded-full" style={{ background: "#00C7D9" }} />
          <span className="text-xs font-bold tracking-widest" style={{ color: "#00C7D9", letterSpacing: "0.1em" }}>
            四维现实空间 · 实时投影
          </span>
        </div>
        {loading && <RefreshCw size={11} className="animate-spin" style={{ color: theme.textMuted }} />}
      </div>

      {/* Four dimension cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <DimensionCard
          icon={Users}
          label="人 · STAFF"
          headline={onDuty}
          headlineSub={`/ ${staff.length} 人 · 忙碌 ${busy}`}
          alerts={anomalies}
          status={staffStatus}
          accent="#4ade80"
          theme={theme}
          onClick={() => onOpenDimension("people")}
        />
        <DimensionCard
          icon={Activity}
          label="流 · FLOW"
          headline={waiting}
          headlineSub={`候诊 · 诊疗 ${inProgress}`}
          alerts={flowAlerts}
          status={flowStatus}
          accent="#00C7D9"
          theme={theme}
          onClick={() => onOpenDimension("flow")}
        />
        <DimensionCard
          icon={TrendingUp}
          label="钱 · REVENUE"
          headline={`${achievementRate}%`}
          headlineSub={`¥${totalActual.toLocaleString()} / 目标`}
          alerts={achievementRate < 60 ? 1 : 0}
          status={moneyStatus}
          accent="#FBBF24"
          theme={theme}
          onClick={() => onOpenDimension("money")}
        />
        <DimensionCard
          icon={Package}
          label="物 · SUPPLY"
          headline={lowStock}
          headlineSub={`/ ${inventory.length} 项低水位`}
          alerts={lowStock}
          status={thingStatus}
          accent="#A78BFA"
          theme={theme}
          onClick={() => onOpenDimension("things")}
        />
      </div>
    </div>
  );
}