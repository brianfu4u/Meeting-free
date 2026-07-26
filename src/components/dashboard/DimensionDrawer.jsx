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
  usePaymentFactCards,
  useExamReportFactCards,
  useStaff,
  useInventory,
  useRevenueTargets,
  useClinicConfig,
} from "@/hooks/useClinicData";

const DIM_META = {
  people: { icon: Users,    label: "人 · 员工在岗态势", accent: "#4ade80" },
  flow:   { icon: Activity, label: "流 · 患者诊疗流转", accent: "#00C7D9" },
  money:  { icon: TrendingUp, label: "钱 · 营收达成进度", accent: "#FBBF24" },
  things: { icon: Package,  label: "物 · 固定设备使用现状", accent: "#A78BFA" },
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
  if (regCards.length === 0) return <Empty theme={theme} />;

  // 挂号解析卡 → 就诊目的 + 新客/老客；session_id join PatientSession → 当前就诊状态
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const fieldOf = (card, name) => (card.fields || []).find((f) => f.field_name === name)?.value;

  const rows = regCards.map((c) => {
    const sess = c.session_id ? sessionById.get(c.session_id) : null;
    const status = sess?.status || "arrived";
    const st = PATIENT_STATUS_LABEL[status] || PATIENT_STATUS_LABEL.arrived;
    return {
      id: c.id,
      name: c.subject_fingerprint?.name || "未登记",
      purpose: fieldOf(c, "visit_purpose") || "—",
      customerType: fieldOf(c, "customer_type"),
      line: sess?.business_line || "—",
      node: sess?.current_node || "—",
      status,
      st,
    };
  });

  // 卡滞优先，其余按状态自然序
  const sorted = [...rows].sort((a, b) => {
    const sa = a.status === "stalled" ? 0 : 1, sb = b.status === "stalled" ? 0 : 1;
    return sa - sb;
  });

  const waiting = rows.filter((r) => r.status === "seated" || r.status === "arrived").length;
  const inProgress = rows.filter((r) => r.status === "in_progress").length;
  const stalled = rows.filter((r) => r.status === "stalled").length;
  const newCount = rows.filter((r) => r.customerType === "新客").length;
  const oldCount = rows.filter((r) => r.customerType === "老客").length;

  return (
    <div>
      <div className="grid grid-cols-5 gap-2 mb-3">
        <Stat theme={theme} value={rows.length} label="来院人次" color="#00C7D9" />
        <Stat theme={theme} value={newCount} label="新客" color="#4ade80" />
        <Stat theme={theme} value={oldCount} label="老客" color="#A78BFA" />
        <Stat theme={theme} value={inProgress} label="诊疗中" color="#00C7D9" />
        <Stat theme={theme} value={stalled} label="卡滞" color="#f87171" />
      </div>
      <div className="space-y-1.5">
        {sorted.map((r) => {
          const isNew = r.customerType === "新客";
          const tagColor = isNew ? "#4ade80" : "#A78BFA";
          const tagBg = isNew ? "rgba(74,222,128,0.15)" : "rgba(167,139,250,0.15)";
          return (
            <div key={r.id} className="px-3 py-2 rounded-lg" style={{ background: theme.canvas, border: `1px solid ${theme.border}`, borderLeft: `3px solid ${r.st.color}` }}>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold flex-shrink-0" style={{ color: theme.text, minWidth: "64px" }}>{r.name}</span>
                {r.customerType && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 font-semibold" style={{ background: tagBg, color: tagColor, border: `1px solid ${tagColor}40` }}>{r.customerType}</span>
                )}
                <span className="text-xs flex-shrink-0" style={{ color: theme.textMuted, fontSize: "10px" }}>{BUSINESS_LINE_LABEL[r.line] || "—"}</span>
                <span className="text-xs px-1.5 py-0.5 rounded flex-shrink-0 ml-auto" style={{ background: `${r.st.color}1a`, color: r.st.color, fontSize: "10px" }}>{r.st.label}</span>
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

// 眼科收费目录（固定类目，按此归类展示）
const FEE_CATEGORIES = [
  { key: "挂号费", color: "#94A3B8" },
  { key: "诊疗费", color: "#00C7D9" },
  { key: "检测费", color: "#60A5FA" },
  { key: "治疗费", color: "#A78BFA" },
  { key: "手术费", color: "#f87171" },
  { key: "配镜费", color: "#FBBF24" },
  { key: "预付款", color: "#34d399" },
  { key: "药费", color: "#f472b6" },
  { key: "材料费", color: "#c084fc" },
];

function MoneyDetail({ theme }) {
  const { data: cards = [] } = usePaymentFactCards();
  if (cards.length === 0) {
    return <div className="text-xs py-8 text-center" style={{ color: theme.textMuted }}>今日暂无收款记录</div>;
  }
  const fieldOf = (c, name) => (c.fields || []).find((f) => f.field_name === name)?.value;
  const fmt = (n) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const rows = cards.map((c) => {
    const amt = parseFloat(fieldOf(c, "amount") || "0") || 0;
    return {
      id: c.id,
      name: c.subject_fingerprint?.name || fieldOf(c, "patient_name") || "—",
      category: fieldOf(c, "fee_category") || "其他",
      amount: amt,
      time: c.extracted_at,
    };
  });

  const total = rows.reduce((s, r) => s + r.amount, 0);

  // 按收费类目汇总
  const catMap = new Map();
  for (const r of rows) {
    const e = catMap.get(r.category) || { category: r.category, total: 0, count: 0 };
    e.total += r.amount; e.count += 1;
    catMap.set(r.category, e);
  }
  const catColor = (k) => FEE_CATEGORIES.find((c) => c.key === k)?.color || "#64748B";
  const catRows = [...catMap.values()].sort((a, b) => b.total - a.total);

  const fmtTime = (t) => {
    try { return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(t)); }
    catch { return ""; }
  };
  const sortedRows = [...rows].sort((a, b) => new Date(b.time) - new Date(a.time));

  return (
    <div>
      {/* 总收款 */}
      <div className="rounded-xl p-4 mb-3" style={{ background: theme.canvas, border: `1px solid ${theme.border}` }}>
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-xs" style={{ color: theme.textMuted }}>今日累计收款</span>
          <span className="text-2xl font-bold tabular-nums" style={{ color: "#FBBF24" }}>{fmt(total)}</span>
        </div>
        <div className="text-[10px]" style={{ color: theme.textFaint }}>共 {rows.length} 笔 · 数据来自收银台小票解析</div>
      </div>

      {/* 按收费类目汇总 */}
      <div className="text-[11px] font-bold mb-1.5" style={{ color: theme.textSub }}>按收费类目</div>
      <div className="space-y-1.5 mb-3">
        {catRows.map((c) => {
          const color = catColor(c.category);
          const pct = total > 0 ? Math.round((c.total / total) * 100) : 0;
          return (
            <div key={c.category} className="px-3 py-2 rounded-lg" style={{ background: theme.canvas, border: `1px solid ${theme.border}`, borderLeft: `3px solid ${color}` }}>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold flex-shrink-0" style={{ color: theme.text, minWidth: "56px" }}>{c.category}</span>
                <span className="text-[10px] flex-shrink-0" style={{ color: theme.textMuted }}>{c.count} 笔</span>
                <span className="text-xs font-bold tabular-nums ml-auto" style={{ color: color }}>{fmt(c.total)}</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden mt-1.5" style={{ background: "rgba(148,163,184,0.12)" }}>
                <div style={{ height: "100%", width: `${pct}%`, background: color, transition: "width 0.4s ease" }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* 收款明细 */}
      <div className="text-[11px] font-bold mb-1.5" style={{ color: theme.textSub }}>收款明细</div>
      <div className="space-y-1.5 max-h-[40vh] overflow-y-auto">
        {sortedRows.map((r) => {
          const color = catColor(r.category);
          return (
            <div key={r.id} className="px-3 py-2 rounded-lg flex items-center gap-2" style={{ background: theme.canvas, border: `1px solid ${theme.border}` }}>
              <span className="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: `${color}1a`, color, fontSize: "10px" }}>{r.category}</span>
              <span className="text-xs font-semibold flex-shrink-0" style={{ color: theme.text, minWidth: "56px" }}>{r.name}</span>
              <span className="text-[10px] flex-shrink-0 ml-auto tabular-nums" style={{ color: theme.textFaint }}>{fmtTime(r.time)}</span>
              <span className="text-xs font-bold tabular-nums flex-shrink-0" style={{ color: "#FBBF24" }}>{fmt(r.amount)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 计算固定资产使用年限（购置日期→今天），返回保留1位小数的年数字符串
function yearsInService(purchaseDate) {
  if (!purchaseDate) return null;
  const ms = Date.now() - new Date(purchaseDate).getTime();
  if (isNaN(ms) || ms < 0) return null;
  return (ms / (365.25 * 24 * 3600 * 1000)).toFixed(1);
}

// 特检报告单据归属具体设备：设备序号(sku)匹配单据 device_serial；否则按设备名匹配单据字段值
function matchDeviceCount(equipment, examCards) {
  return examCards.filter((c) => {
    if (equipment.sku && c.device_serial && c.device_serial === equipment.sku) return true;
    const vals = (c.fields || []).map((f) => f.value).filter(Boolean);
    return vals.some((v) => v === equipment.item_name);
  }).length;
}

function ThingsDetail({ theme }) {
  const { data: inventory = [] } = useInventory();
  const { data: examCards = [] } = useExamReportFactCards();
  const equipment = inventory.filter((i) => i.category === "equipment");
  if (equipment.length === 0) return <Empty theme={theme} />;

  const rows = equipment.map((e) => ({
    id: e.id,
    name: e.item_name,
    sku: e.sku,
    usage: matchDeviceCount(e, examCards),
    years: yearsInService(e.purchase_date),
  }));
  // 今日有使用的设备优先，其次按使用年限降序（老设备靠前）
  const sorted = [...rows].sort((a, b) => {
    if ((b.usage > 0 ? 1 : 0) !== (a.usage > 0 ? 1 : 0)) return (b.usage > 0 ? 1 : 0) - (a.usage > 0 ? 1 : 0);
    return (parseFloat(b.years) || 0) - (parseFloat(a.years) || 0);
  });

  const totalUsage = examCards.length;
  const usedToday = rows.filter((r) => r.usage > 0).length;
  const withYears = rows.filter((r) => r.years !== null);

  return (
    <div>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <Stat theme={theme} value={totalUsage} label="今日使用次数" color="#A78BFA" />
        <Stat theme={theme} value={usedToday} label="启用设备" color="#4ade80" />
        <Stat theme={theme} value={equipment.length} label="在册设备" color="#cbd5e1" />
      </div>
      <div className="text-[10px] mb-3 px-1" style={{ color: theme.textFaint }}>
        数据来源：特检技师上传的检验结果单据（每张单据算一次设备使用）
      </div>
      <div className="space-y-1.5">
        {sorted.map((r) => {
          const hasUsage = r.usage > 0;
          const color = hasUsage ? "#A78BFA" : "#64748B";
          return (
            <div key={r.id} className="px-3 py-2 rounded-lg" style={{ background: theme.canvas, border: `1px solid ${theme.border}`, borderLeft: `3px solid ${color}` }}>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold flex-shrink-0" style={{ color: theme.text, minWidth: "92px" }}>{r.name}</span>
                {r.sku && <span className="text-[10px] flex-shrink-0" style={{ color: theme.textFaint }}>#{r.sku}</span>}
                <span className="text-xs font-bold tabular-nums ml-auto flex-shrink-0" style={{ color: hasUsage ? "#A78BFA" : theme.textMuted }}>
                  {r.usage}<span className="text-[10px] font-normal" style={{ color: theme.textMuted }}> 次</span>
                </span>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="text-[10px] flex-shrink-0" style={{ color: theme.textMuted }}>使用年限</span>
                <span className="text-xs tabular-nums" style={{ color: r.years !== null ? theme.textSub : theme.textFaint, fontSize: "11px" }}>
                  {r.years !== null ? `${r.years} 年` : "未登记购置日期"}
                </span>
              </div>
            </div>
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