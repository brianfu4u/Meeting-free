/**
 * Clinic OS V9 — 四维现实空间指挥台
 * 聚焦诊所运营的四个核心维度：人 / 流 / 钱 / 物
 * 每个维度仅展示最关键态势指标，点击下钻进入维度详情抽屉。
 * 设计原则：无异常即静默；告警触发才高亮。
 */

import React from "react";
import { Users, Activity, TrendingUp, Package, ChevronRight, RefreshCw } from "lucide-react";
import { useTheme } from "@/lib/ThemeContext";
import { beijingShift, todayBeijingDate } from "@/lib/clinicTime";
import {
  usePatientSessions,
  useRegistrationFactCards,
  usePaymentFactCards,
  useExamReportFactCards,
  useStaff,
  useInventory,
  useRevenueTargets,
  useClinicConfig,
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

function DimensionCard({ icon: Icon, label, headline, headlineSub, onClick, theme, accent }) {
  return (
    <button
      onClick={onClick}
      className="group text-left rounded-2xl p-4 md:p-5 transition-all duration-200 active:scale-[0.98] relative overflow-hidden"
      style={{
        background: theme.cardBg,
        border: `1px solid ${theme.border}`,
      }}
    >
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
  const regQ = useRegistrationFactCards();
  const inventoryQ = useInventory();
  const revenueQ = useRevenueTargets();
  const configQ = useClinicConfig();

  const loading = staffQ.isLoading || sessionsQ.isLoading;
  const staff = staffQ.data || [];
  const sessions = sessionsQ.data || [];
  const inventory = inventoryQ.data || [];
  const revenue = revenueQ.data || [];
  const config = configQ.data || null;

  // ── 人：员工在岗态势 ──
  // 在岗 = on_duty + busy；可调度 = on_duty（在岗且不忙）；忙碌 = busy
  const onDuty = staff.filter((s) => s.status === "on_duty" || s.status === "busy").length;
  const available = staff.filter((s) => s.status === "on_duty").length;
  const busy = staff.filter((s) => s.status === "busy").length;
  // 当天休假 = off_duty（休息 break 不计为休假）；终端在线 = pad_online 实时累计
  const onLeave = staff.filter((s) => s.status === "off_duty").length;
  const padOnline = staff.filter((s) => s.pad_online === true).length;
  const onBreak = staff.filter((s) => s.status === "break").length;
  // 异常：状态待确认 + 在岗类岗位 PAD 离线（休息/离岗不计入）
  const awaiting = staff.filter((s) => s.status === "awaiting_confirm").length;
  const padOffline = staff.filter(
    (s) => (s.status === "on_duty" || s.status === "busy" || s.status === "awaiting_confirm") && s.pad_online === false
  ).length;
  const anomalies = awaiting + padOffline;
  const shift = beijingShift();
  const businessHours = shift.label !== "非营业";
  // 营业时段无人到岗→红；有异常→红；忙碌占比≥80%→黄；否则绿
  const staffStatus =
    onDuty === 0
      ? businessHours ? "red" : "green"
      : anomalies > 0
        ? "red"
        : onDuty > 0 && busy >= onDuty * 0.8
          ? "amber"
          : "green";

  // ── 流：患者流转 ──
  // 人流 = 截止到目前为止的来院病人总数（数据来源：挂号单解析结果）
  const regCards = regQ.data || [];
  const totalVisitors = regCards.length;
  const ACTIVE_SESSION = new Set(["arrived", "seated", "in_progress", "stalled"]);
  const activeSessions = sessions.filter((s) => ACTIVE_SESSION.has(s.status));
  const waiting = activeSessions.filter((s) => s.status === "seated" || s.status === "arrived").length;
  const inProgress = activeSessions.filter((s) => s.status === "in_progress").length;
  const stalled = activeSessions.filter((s) => s.status === "stalled").length;
  // 最长候诊时长（分钟）：到店/候诊患者中最大等待
  const nowMs = Date.now();
  const waitMinutes = activeSessions
    .filter((s) => s.status === "seated" || s.status === "arrived")
    .map((s) => {
      const t = s.seated_time || s.arrival_time;
      return t ? (nowMs - new Date(t).getTime()) / 60000 : 0;
    });
  const maxWaitMin = waitMinutes.length ? Math.round(Math.max(...waitMinutes)) : 0;
  const yellowWait = config?.wait_timeout_yellow_minutes ?? 15;
  const redWait = config?.wait_timeout_red_minutes ?? 30;
  const waitRed = maxWaitMin >= redWait;
  const waitAmber = maxWaitMin >= yellowWait;
  const flowStatus = stalled > 0 || waitRed ? "red" : waiting >= 8 || waitAmber ? "amber" : "green";
  const flowAlerts = stalled + (waitRed ? 1 : 0) + (waiting >= 8 && !waitRed ? 1 : 0);

  // ── 钱：截止现在总收款（数据来源：收银台上传小票解析结果）──
  const payQ = usePaymentFactCards();
  const payCards = payQ.data || [];
  const totalCollected = payCards.reduce((s, c) => {
    const v = (c.fields || []).find((f) => f.field_name === "amount")?.value;
    return s + (v ? parseFloat(v) || 0 : 0);
  }, 0);
  const fmtYuan = (n) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ── 物：固定资产设备使用现状（非库存）──
  // 设备清单来自 InventoryItem(category=equipment)；今日使用次数 = 今日特检报告单据数（每张算一次）
  const equipment = inventory.filter((i) => i.category === "equipment");
  const examQ = useExamReportFactCards();
  const examCards = examQ.data || [];
  const totalEquipUsage = examCards.length;

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
          headlineSub={`总${staff.length} · 忙${busy} · 闲${available} · 休${onBreak} · 假${onLeave} · 端${padOnline}`}
          accent="#4ade80"
          theme={theme}
          onClick={() => onOpenDimension("people")}
        />
        <DimensionCard
          icon={Activity}
          label="流 · FLOW"
          headline={totalVisitors}
          headlineSub={`来院人次 · 候诊 ${waiting} · 诊疗 ${inProgress}`}
          accent="#00C7D9"
          theme={theme}
          onClick={() => onOpenDimension("flow")}
        />
        <DimensionCard
          icon={TrendingUp}
          label="钱 · REVENUE"
          headline={fmtYuan(totalCollected)}
          headlineSub={`今日收款 · ${payCards.length} 笔`}
          accent="#FBBF24"
          theme={theme}
          onClick={() => onOpenDimension("money")}
        />
        <DimensionCard
          icon={Package}
          label="物 · EQUIP"
          headline={totalEquipUsage}
          headlineSub={`今日设备使用 · 在册 ${equipment.length} 台`}
          accent="#A78BFA"
          theme={theme}
          onClick={() => onOpenDimension("things")}
        />
      </div>
    </div>
  );
}