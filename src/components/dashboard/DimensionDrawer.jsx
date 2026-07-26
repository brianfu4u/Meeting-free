/**
 * Clinic OS V9 — 维度详情抽屉
 * 点击四维板块卡片后，侧边滑出该维度的明细数据。
 * 仅展示该维度内的实体记录，遵循"点击即下钻"原则。
 */

import React, { useEffect } from "react";
import { X, Users, Activity, TrendingUp, Package, AlertTriangle } from "lucide-react";
import { useTheme } from "@/lib/ThemeContext";
import { todayBeijingDate } from "@/lib/clinicTime";
import { DEPARTMENT_BY_ID, ROLE_LABELS, ROLE_TO_DEPARTMENT } from "@/lib/departments/registry";
import {
  usePatientSessions,
  useRegistrationFactCards,
  useStaff,
  useInventory,
  useRevenueTargets,
  useClinicConfig,
} from "@/hooks/useClinicData";

const DIM_META = {
  people: { icon: Users,    label: "人 · 员工在岗态势", accent: "#4ade80" },
  flow:   { icon: Activity, label: "流 · 患者诊疗流转", accent: "#00C7D9" },
  money:  { icon: TrendingUp, label: "钱 · 营收达成进度", accent: "#FBBF24" },
  things: { icon: Package,  label: "物 · 库存与设备水位", accent: "#A78BFA" },
};

const STAFF_STATUS_LABEL = {
  on_duty: { label: "在岗", color: "#4ade80" },
  busy: { label: "忙碌", color: "#00C7D9" },
  awaiting_confirm: { label: "待确认", color: "#FBBF24" },
  break: { label: "休息", color: "#94A3B8" },
  off_duty: { label: "离岗", color: "#64748B" },
};

const PATIENT_STATUS_LABEL = {
  arrived: { label: "已到店", color: "#94A3B8" },
  seated: { label: "候诊中", color: "#FBBF24" },
  in_progress: { label: "诊疗中", color: "#00C7D9" },
  completed: { label: "已完成", color: "#4ade80" },
  stalled: { label: "卡滞", color: "#f87171" },
};

const BUSINESS_LINE_LABEL = {
  optometry: "验光", medical: "眼科", vision_training: "训练",
};

function Row({ children, color, theme }) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-lg"
      style={{ background: theme.canvas, border: `1px solid ${theme.border}` }}
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
      {children}
    </div>
  );
}

function Stat({ theme, value, label, color }) {
  return (
    <div className="rounded-lg p-2 text-center" style={{ background: theme.canvas, border: `1px solid ${theme.border}` }}>
      <div className="text-lg font-bold tabular-nums" style={{ color }}>{value}</div>
      <div className="text-[10px]" style={{ color: theme.textMuted }}>{label}</div>
    </div>
  );
}

function PeopleDetail({ theme }) {
  const { data = [] } = useStaff();
  if (data.length === 0) return <Empty theme={theme} />;

  const isOnDutyLike = (s) => s.status === "on_duty" || s.status === "busy" || s.status === "awaiting_confirm";
  const isAnomaly = (s) => s.status === "awaiting_confirm" || (isOnDutyLike(s) && s.pad_online === false);

  const onDuty = data.filter((s) => s.status === "on_duty" || s.status === "busy").length;
  const available = data.filter((s) => s.status === "on_duty").length;
  const busy = data.filter((s) => s.status === "busy").length;
  const onBreak = data.filter((s) => s.status === "break").length;
  const onLeave = data.filter((s) => s.status === "off_duty").length;
  const padOnline = data.filter((s) => s.pad_online === true).length;
  const total = data.length;
  const anomalies = data.filter(isAnomaly).length;

  // 异常优先，再按在岗→忙碌→待确认→休息→离岗排序
  const order = { busy: 0, on_duty: 1, awaiting_confirm: 2, break: 3, off_duty: 4 };
  const sorted = [...data].sort((a, b) => {
    const aa = isAnomaly(a) ? 0 : 1, bb = isAnomaly(b) ? 0 : 1;
    if (aa !== bb) return aa - bb;
    return (order[a.status] ?? 9) - (order[b.status] ?? 9);
  });

  return (
    <div>
      <div className="grid grid-cols-4 gap-2 mb-3">
        <Stat theme={theme} value={onDuty} label="在岗" color="#4ade80" />
        <Stat theme={theme} value={available} label="空闲" color="#00C7D9" />
        <Stat theme={theme} value={busy} label="忙碌" color="#FBBF24" />
        <Stat theme={theme} value={onBreak} label="休息" color="#94A3B8" />
        <Stat theme={theme} value={onLeave} label="休假" color="#64748B" />
        <Stat theme={theme} value={total} label="总人数" color="#cbd5e1" />
        <Stat theme={theme} value={padOnline} label="终端在线" color="#22d3ee" />
        <Stat theme={theme} value={anomalies} label="异常" color="#f87171" />
      </div>
      <div className="space-y-1.5">
        {sorted.map((s) => {
          const st = STAFF_STATUS_LABEL[s.status] || STAFF_STATUS_LABEL.off_duty;
          const anomaly = isAnomaly(s);
          return (
            <Row key={s.id} color={st.color} theme={theme}>
              <span className="text-xs font-semibold flex-shrink-0" style={{ color: theme.text, minWidth: "70px" }}>{s.staff_name}</span>
              <span className="text-xs flex-1 truncate" style={{ color: theme.textSub, fontSize: "10px" }}>
                {DEPARTMENT_BY_ID[s.department_id || ROLE_TO_DEPARTMENT[s.role]]?.name || "未分配部门"} · {ROLE_LABELS[s.role] || s.role}
              </span>
              {anomaly && <AlertTriangle size={11} style={{ color: "#f87171" }} />}
              <span className="text-xs px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: `${st.color}1a`, color: st.color, fontSize: "10px" }}>{st.label}</span>
            </Row>
          );
        })}
      </div>
    </div>
  );
}

function FlowDetail({ theme }) {
  const { data: sessions = [] } = usePatientSessions();
  const { data: regCards = [] } = useRegistrationFactCards();
  const { data: config = null } = useClinicConfig();
  if (regCards.length === 0) return <Empty theme={theme} />;

  const nowMs = Date.now();
  const yellowWait = config?.wait_timeout_yellow_minutes ?? 15;
  const redWait = config?.wait_timeout_red_minutes ?? 30;

  // 挂号解析卡 → 就诊目的；session_id join PatientSession → 当前就诊状态
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const purposeOf = (card) => (card.fields || []).find((f) => f.field_name === "visit_purpose")?.value || "—";

  const rows = regCards.map((c) => {
    const sess = c.session_id ? sessionById.get(c.session_id) : null;
    const status = sess?.status || "arrived";
    const st = PATIENT_STATUS_LABEL[status] || PATIENT_STATUS_LABEL.arrived;
    const waitMin = (() => {
      const t = sess?.seated_time || sess?.arrival_time;
      return t ? Math.round((nowMs - new Date(t).getTime()) / 60000) : 0;
    })();
    return {
      id: c.id,
      name: c.subject_fingerprint?.name || "未登记",
      purpose: purposeOf(c),
      line: sess?.business_line || "—",
      node: sess?.current_node || "—",
      status,
      st,
      wait: (status === "seated" || status === "arrived") ? waitMin : null,
    };
  });

  // 卡滞优先，再按等待时长降序
  const sorted = [...rows].sort((a, b) => {
    const sa = a.status === "stalled" ? 0 : 1, sb = b.status === "stalled" ? 0 : 1;
    if (sa !== sb) return sa - sb;
    return (b.wait || 0) - (a.wait || 0);
  });

  const waiting = rows.filter((r) => r.status === "seated" || r.status === "arrived").length;
  const inProgress = rows.filter((r) => r.status === "in_progress").length;
  const stalled = rows.filter((r) => r.status === "stalled").length;
  const maxWait = Math.max(0, ...rows.filter((r) => r.wait != null).map((r) => r.wait || 0));

  return (
    <div>
      <div className="grid grid-cols-4 gap-2 mb-3">
        <Stat theme={theme} value={rows.length} label="来院人次" color="#00C7D9" />
        <Stat theme={theme} value={waiting} label="候诊" color="#FBBF24" />
        <Stat theme={theme} value={inProgress} label="诊疗中" color="#00C7D9" />
        <Stat theme={theme} value={stalled} label="卡滞" color="#f87171" />
      </div>
      <div className="space-y-1.5">
        {sorted.map((r) => {
          const waitColor = r.wait != null && r.wait >= redWait ? "#f87171" : r.wait != null && r.wait >= yellowWait ? "#FBBF24" : null;
          return (
            <div key={r.id} className="px-3 py-2 rounded-lg" style={{ background: theme.canvas, border: `1px solid ${theme.border}`, borderLeft: `3px solid ${r.st.color}` }}>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold flex-shrink-0" style={{ color: theme.text, minWidth: "64px" }}>{r.name}</span>
                <span className="text-xs flex-shrink-0" style={{ color: theme.textMuted, fontSize: "10px" }}>{BUSINESS_LINE_LABEL[r.line] || "—"}</span>
                {r.wait != null && (
                  <span className="text-xs flex-shrink-0 ml-auto" style={{ color: waitColor || theme.textMuted, fontSize: "10px" }}>等 {r.wait}分</span>
                )}
                <span className="text-xs px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: `${r.st.color}1a`, color: r.st.color, fontSize: "10px" }}>{r.st.label}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="text-[10px] flex-shrink-0" style={{ color: theme.textMuted }}>就诊目的</span>
                <span className="text-xs truncate" style={{ color: theme.textSub, fontSize: "11px" }}>{r.purpose}</span>
                <span className="text-[10px] ml-auto flex-shrink-0" style={{ color: theme.textFaint }}>{r.node}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MoneyDetail({ theme }) {
  const { data = [] } = useRevenueTargets();
  const today = todayBeijingDate();
  const todayData = data.filter((r) => r.target_date === today);
  if (todayData.length === 0) {
    return <div className="text-xs py-8 text-center" style={{ color: theme.textMuted }}>今日未设营收目标</div>;
  }
  const totalTarget = todayData.reduce((s, r) => s + (r.target_amount || 0), 0);
  const totalActual = todayData.reduce((s, r) => s + (r.actual_amount || 0), 0);
  const rate = totalTarget > 0 ? Math.round((totalActual / totalTarget) * 100) : 0;
  return (
    <div>
      <div className="rounded-xl p-4 mb-3" style={{ background: theme.canvas, border: `1px solid ${theme.border}` }}>
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-xs" style={{ color: theme.textMuted }}>今日达成率</span>
          <span className="text-2xl font-bold" style={{ color: rate >= 60 ? "#4ade80" : rate >= 40 ? "#FBBF24" : "#f87171" }}>{rate}%</span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(148,163,184,0.15)" }}>
          <div style={{ height: "100%", width: `${Math.min(rate, 100)}%`, background: rate >= 60 ? "#4ade80" : rate >= 40 ? "#FBBF24" : "#f87171", transition: "width 0.5s ease" }} />
        </div>
        <div className="flex justify-between mt-2 text-xs" style={{ color: theme.textMuted, fontSize: "10px" }}>
          <span>实际 ¥{totalActual.toLocaleString()}</span>
          <span>目标 ¥{totalTarget.toLocaleString()}</span>
        </div>
      </div>
      <div className="space-y-1.5">
        {todayData.map((r) => {
          const rRate = r.target_amount > 0 ? Math.round((r.actual_amount / r.target_amount) * 100) : 0;
          const color = rRate >= 60 ? "#4ade80" : rRate >= 40 ? "#FBBF24" : "#f87171";
          return (
            <Row key={r.id} color={color} theme={theme}>
              <span className="text-xs font-semibold flex-shrink-0" style={{ color: theme.text, minWidth: "50px" }}>{BUSINESS_LINE_LABEL[r.business_line] || "—"}</span>
              <span className="text-xs flex-1" style={{ color: theme.textSub, fontSize: "10px" }}>¥{r.actual_amount?.toLocaleString()} / ¥{r.target_amount?.toLocaleString()}</span>
              <span className="text-xs font-bold flex-shrink-0" style={{ color, fontSize: "11px" }}>{rRate}%</span>
            </Row>
          );
        })}
      </div>
    </div>
  );
}

function ThingsDetail({ theme }) {
  const { data = [] } = useInventory();
  if (data.length === 0) return <Empty theme={theme} />;

  // 实时按数量/阈值计算水位，不依赖可能过期的 below_threshold 标记
  const level = (i) => {
    if (i.threshold > 0 && i.quantity < i.threshold) return "low";
    if (i.threshold > 0 && i.quantity < i.threshold * 1.2) return "near";
    return "ok";
  };
  const low = data.filter((i) => level(i) === "low").length;
  const near = data.filter((i) => level(i) === "near").length;
  const ok = data.filter((i) => level(i) === "ok").length;

  const ord = { low: 0, near: 1, ok: 2 };
  const sorted = [...data].sort((a, b) => ord[level(a)] - ord[level(b)]);
  const COLOR = { low: "#f87171", near: "#FBBF24", ok: "#4ade80" };
  const LABEL = { low: "低水位", near: "预警", ok: "正常" };

  return (
    <div>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <Stat theme={theme} value={low} label="低水位" color="#f87171" />
        <Stat theme={theme} value={near} label="预警" color="#FBBF24" />
        <Stat theme={theme} value={ok} label="正常" color="#4ade80" />
      </div>
      <div className="space-y-1.5">
        {sorted.map((i) => {
          const lv = level(i);
          const color = COLOR[lv];
          return (
            <Row key={i.id} color={color} theme={theme}>
              <span className="text-xs font-semibold flex-shrink-0" style={{ color: theme.text, minWidth: "80px" }}>{i.item_name}</span>
              <span className="text-xs flex-1" style={{ color: theme.textSub, fontSize: "10px" }}>
                {i.quantity} / 阈值 {i.threshold} {i.unit}
              </span>
              {lv !== "ok" && <AlertTriangle size={11} style={{ color }} />}
              <span className="text-xs px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: `${color}1a`, color, fontSize: "10px" }}>{LABEL[lv]}</span>
            </Row>
          );
        })}
      </div>
    </div>
  );
}

function Empty({ theme }) {
  return <div className="text-xs py-8 text-center" style={{ color: theme.textMuted }}>暂无数据</div>;
}

const DETAIL_MAP = {
  people: PeopleDetail,
  flow: FlowDetail,
  money: MoneyDetail,
  things: ThingsDetail,
};

export default function DimensionDrawer({ dimension, onClose }) {
  const { theme } = useTheme();
  const meta = DIM_META[dimension];
  const Detail = DETAIL_MAP[dimension];

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  if (!meta) return null;
  const Icon = meta.icon;

  return (
    <>
      <div
        className="fixed inset-0 z-50 animate-fade-in"
        style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      />
      <div
        className="fixed top-0 right-0 bottom-0 z-50 flex flex-col animate-slide-in-right"
        style={{
          width: "min(480px, 100vw)",
          background: theme.drawerBg,
          borderLeft: `1px solid ${theme.borderSubtle}`,
          boxShadow: "-8px 0 40px rgba(0,0,0,0.3)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: `1px solid ${theme.borderSubtle}`, background: theme.drawerHeader }}
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: `${meta.accent}1a`, border: `1px solid ${meta.accent}33` }}>
              <Icon size={17} style={{ color: meta.accent }} />
            </div>
            <div>
              <div className="text-base font-bold" style={{ color: theme.text }}>{meta.label}</div>
              <div className="text-xs" style={{ color: theme.textMuted }}>维度明细 · 实时刷新</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
            style={{ background: "rgba(128,128,128,0.1)" }}
          >
            <X size={16} style={{ color: theme.textSub }} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {Detail && <Detail theme={theme} />}
        </div>
      </div>
    </>
  );
}