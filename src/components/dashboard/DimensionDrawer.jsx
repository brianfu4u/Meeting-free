/**
 * Clinic OS V9 — 维度详情抽屉
 * 点击四维板块卡片后，侧边滑出该维度的明细数据。
 * 仅展示该维度内的实体记录，遵循"点击即下钻"原则。
 */

import React, { useEffect } from "react";
import { X, Users, Activity, TrendingUp, Package, AlertTriangle } from "lucide-react";
import { useTheme } from "@/lib/ThemeContext";
import {
  usePatientSessions,
  useStaff,
  useInventory,
  useRevenueTargets,
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

function PeopleDetail({ theme }) {
  const { data = [] } = useStaff();
  if (data.length === 0) return <Empty theme={theme} />;
  return (
    <div className="space-y-1.5">
      {data.map((s) => {
        const st = STAFF_STATUS_LABEL[s.status] || STAFF_STATUS_LABEL.off_duty;
        const anomaly = s.status === "awaiting_confirm" || (s.pad_online === false && s.status !== "off_duty");
        return (
          <Row key={s.id} color={st.color} theme={theme}>
            <span className="text-xs font-semibold flex-shrink-0" style={{ color: theme.text, minWidth: "70px" }}>{s.staff_name}</span>
            <span className="text-xs flex-1 truncate" style={{ color: theme.textSub, fontSize: "10px" }}>
              {s.assigned_zone || "未分配"} · {s.role}
            </span>
            {anomaly && <AlertTriangle size={11} style={{ color: "#f87171" }} />}
            <span className="text-xs px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: `${st.color}1a`, color: st.color, fontSize: "10px" }}>{st.label}</span>
          </Row>
        );
      })}
    </div>
  );
}

function FlowDetail({ theme }) {
  const { data = [] } = usePatientSessions();
  if (data.length === 0) return <Empty theme={theme} />;
  return (
    <div className="space-y-1.5">
      {data.map((s) => {
        const st = PATIENT_STATUS_LABEL[s.status] || PATIENT_STATUS_LABEL.arrived;
        return (
          <Row key={s.id} color={st.color} theme={theme}>
            <span className="text-xs font-semibold flex-shrink-0" style={{ color: theme.text, minWidth: "70px" }}>{s.patient_name || "未登记"}</span>
            <span className="text-xs flex-shrink-0" style={{ color: theme.textMuted, fontSize: "10px" }}>{BUSINESS_LINE_LABEL[s.business_line] || "—"}</span>
            <span className="text-xs flex-1 truncate" style={{ color: theme.textSub, fontSize: "10px" }}>{s.current_node || "—"}</span>
            <span className="text-xs px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: `${st.color}1a`, color: st.color, fontSize: "10px" }}>{st.label}</span>
          </Row>
        );
      })}
    </div>
  );
}

function MoneyDetail({ theme }) {
  const { data = [] } = useRevenueTargets();
  if (data.length === 0) return <Empty theme={theme} />;
  const totalTarget = data.reduce((s, r) => s + (r.target_amount || 0), 0);
  const totalActual = data.reduce((s, r) => s + (r.actual_amount || 0), 0);
  const rate = totalTarget > 0 ? Math.round((totalActual / totalTarget) * 100) : 0;
  return (
    <div>
      <div className="rounded-xl p-4 mb-3" style={{ background: theme.canvas, border: `1px solid ${theme.border}` }}>
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-xs" style={{ color: theme.textMuted }}>总达成率</span>
          <span className="text-2xl font-bold" style={{ color: rate >= 60 ? "#4ade80" : "#FBBF24" }}>{rate}%</span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(148,163,184,0.15)" }}>
          <div style={{ height: "100%", width: `${Math.min(rate, 100)}%`, background: rate >= 60 ? "#4ade80" : "#FBBF24", transition: "width 0.5s ease" }} />
        </div>
        <div className="flex justify-between mt-2 text-xs" style={{ color: theme.textMuted, fontSize: "10px" }}>
          <span>实际 ¥{totalActual.toLocaleString()}</span>
          <span>目标 ¥{totalTarget.toLocaleString()}</span>
        </div>
      </div>
      <div className="space-y-1.5">
        {data.map((r) => {
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
  const sorted = [...data].sort((a, b) => (b.below_threshold ? 1 : 0) - (a.below_threshold ? 1 : 0));
  return (
    <div className="space-y-1.5">
      {sorted.map((i) => {
        const color = i.below_threshold ? "#f87171" : "#4ade80";
        return (
          <Row key={i.id} color={color} theme={theme}>
            <span className="text-xs font-semibold flex-shrink-0" style={{ color: theme.text, minWidth: "80px" }}>{i.item_name}</span>
            <span className="text-xs flex-1" style={{ color: theme.textSub, fontSize: "10px" }}>
              {i.quantity} / 阈值 {i.threshold} {i.unit}
            </span>
            {i.below_threshold && <AlertTriangle size={11} style={{ color: "#f87171" }} />}
            <span className="text-xs px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: `${color}1a`, color, fontSize: "10px" }}>
              {i.below_threshold ? "低水位" : "正常"}
            </span>
          </Row>
        );
      })}
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