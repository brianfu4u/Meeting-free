import React from "react";
import { AlertTriangle, CheckCircle, Clock, Info, Zap, User, Package, TrendingUp, AlertCircle, Users, FileText } from "lucide-react";
import { useTheme } from "@/lib/ThemeContext";

const ICON_MAP = {
  AlertTriangle, CheckCircle, Clock, Info, Zap, User, Package, TrendingUp, AlertCircle, Users, FileText,
};

const TYPE_CONFIG = {
  critical: { icon_bg: "rgba(220,38,38,0.15)", icon_color: "#f87171", border: "rgba(220,38,38,0.2)", bg: "rgba(220,38,38,0.05)", dot: "#DC2626", label: "🔴 紧急预警" },
  warning:  { icon_bg: "rgba(217,119,6,0.15)",  icon_color: "#fbbf24", border: "rgba(217,119,6,0.2)",  bg: "rgba(217,119,6,0.04)",  dot: "#D97706", label: "🟡 注意提示" },
  info:     { icon_bg: "rgba(0,199,217,0.12)",   icon_color: "#00C7D9", border: "rgba(0,199,217,0.15)", bg: "rgba(0,199,217,0.03)",  dot: "#00C7D9", label: "ℹ️ 系统通知" },
  success:  { icon_bg: "rgba(22,163,74,0.15)",   icon_color: "#4ade80", border: "rgba(22,163,74,0.2)",  bg: "rgba(22,163,74,0.04)",  dot: "#16A34A", label: "✅ 状态更新" },
};

// 将 AuditLog trigger_type 映射为展示类型
function triggerToType(triggerType) {
  if (!triggerType) return "info";
  if (/STALLED|ESCALATED|REJECTED|BELOW_THRESHOLD|MISSED|EXCEPTION/i.test(triggerType)) return "critical";
  if (/REPORT|DRAFT|SUGGEST|ATTENTION|RISK|GAP|MISSING/i.test(triggerType)) return "warning";
  if (/COMPLETED|APPROVED|SEATED|ARRIVED|CHECKED|GENERATED/i.test(triggerType)) return "success";
  return "info";
}

function triggerToIcon() {
  return "FileText";
}

function formatTime(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

function buildMessage(entry) {
  const p = entry.payload || {};
  const parts = [];
  if (entry.source_agent) parts.push(`[${entry.source_agent}]`);
  if (p.staff_name) parts.push(p.staff_name);
  if (p.patient_name) parts.push(`患者:${p.patient_name}`);
  if (p.text) parts.push(p.text.slice(0, 60));
  if (p.node_name) parts.push(`节点:${p.node_name}`);
  if (p.item_name) parts.push(`物品:${p.item_name}`);
  if (p.attention_title) parts.push(p.attention_title);
  if (parts.length === 0) parts.push(entry.trigger_type || "事件");
  return parts.join(" · ");
}

function EventItem({ event, theme }) {
  const cfg = TYPE_CONFIG[event.type] || TYPE_CONFIG.info;
  const IconComp = ICON_MAP[event.icon] || Info;
  return (
    <div
      className="rounded-xl p-3 mb-2"
      style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, transition: "all 0.3s ease" }}
    >
      <div className="flex items-start gap-2.5">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: cfg.icon_bg }}>
          <IconComp size={13} style={{ color: cfg.icon_color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-xs font-semibold" style={{ color: cfg.icon_color, fontSize: "10px", letterSpacing: "0.04em" }}>
              {cfg.label}
            </span>
            <span className="text-xs flex-shrink-0" style={{ color: theme.textFaint, fontSize: "10px" }}>{event.time}</span>
          </div>
          <p className="text-xs leading-relaxed" style={{ color: theme.textMsg, fontSize: "12px" }}>{event.message}</p>
        </div>
      </div>
    </div>
  );
}

export default function EventStream({ events, loading }) {
  const { theme } = useTheme();

  return (
    <div
      className="flex flex-col h-full"
      style={{
        background: theme.eventBg,
        border: `1px solid ${theme.borderSubtle}`,
        borderRadius: "12px",
        overflow: "hidden",
        transition: "background 0.3s ease, border-color 0.3s ease",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ borderBottom: `1px solid ${theme.borderSubtle}` }}>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: "#00C7D9", animation: "pulseGreen 2s ease-in-out infinite" }} />
          <span className="text-sm font-semibold" style={{ color: theme.text }}>系统事件流</span>
          <span className="text-xs" style={{ color: theme.textFaint, fontSize: "10px" }}>· AuditLog 实时</span>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(0,199,217,0.12)", color: "#00C7D9", border: "1px solid rgba(0,199,217,0.25)", fontSize: "10px" }}>
          V10 全链路留痕
        </span>
      </div>

      {/* Events */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading && events.length === 0 ? (
          <div className="text-xs py-8 text-center" style={{ color: theme.textFaint }}>加载系统事件中…</div>
        ) : events.length === 0 ? (
          <div className="text-xs py-8 text-center" style={{ color: theme.textFaint }}>暂无系统事件</div>
        ) : (
          events.map((event) => (
            <EventItem key={event.id} event={event} theme={theme} />
          ))
        )}
      </div>

      {/* V10 提示条：店长决策归口到注意力队列 */}
      <div
        className="flex-shrink-0 p-3"
        style={{ borderTop: `1px solid ${theme.borderSubtle}`, background: theme.actionAreaBg }}
      >
        <div className="rounded-xl p-3 text-center" style={{ background: "rgba(0,199,217,0.06)", border: "1px solid rgba(0,199,217,0.18)" }}>
          <div className="text-xs" style={{ color: theme.textMuted, fontSize: "11px" }}>
            需要店长决策的事项，请在上方「注意力队列」处理
          </div>
          <div className="text-xs mt-1" style={{ color: theme.textFaint, fontSize: "10px" }}>
            V10 宪法：AI 仅生成建议，所有动作由店长人工确认
          </div>
        </div>
      </div>
    </div>
  );
}