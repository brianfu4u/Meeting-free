import React, { useRef, useEffect } from "react";
import { AlertTriangle, CheckCircle, Clock, Info, Zap, User, Package, TrendingUp, AlertCircle, Users } from "lucide-react";
import { useTheme } from "@/lib/ThemeContext";

const ICON_MAP = {
  AlertTriangle, CheckCircle, Clock, Info, Zap, User, Package, TrendingUp, AlertCircle, Users,
};

const TYPE_CONFIG = {
  critical: { icon_bg: "rgba(220,38,38,0.15)", icon_color: "#f87171", border: "rgba(220,38,38,0.2)", bg: "rgba(220,38,38,0.05)", dot: "#DC2626" },
  warning:  { icon_bg: "rgba(217,119,6,0.15)",  icon_color: "#fbbf24", border: "rgba(217,119,6,0.2)",  bg: "rgba(217,119,6,0.04)",  dot: "#D97706" },
  info:     { icon_bg: "rgba(0,199,217,0.12)",   icon_color: "#00C7D9", border: "rgba(0,199,217,0.15)", bg: "rgba(0,199,217,0.03)",  dot: "#00C7D9" },
  success:  { icon_bg: "rgba(22,163,74,0.15)",   icon_color: "#4ade80", border: "rgba(22,163,74,0.2)",  bg: "rgba(22,163,74,0.04)",  dot: "#16A34A" },
};

function EventItem({ event, isNew, theme }) {
  const cfg = TYPE_CONFIG[event.type] || TYPE_CONFIG.info;
  const IconComp = ICON_MAP[event.icon] || Info;

  return (
    <div
      className={`rounded-xl p-3 mb-2 ${isNew ? "animate-slide-in-top" : ""}`}
      style={{
        background: event.awaitConfirm ? "rgba(220,38,38,0.08)" : cfg.bg,
        border: `1px solid ${event.awaitConfirm ? "rgba(220,38,38,0.35)" : cfg.border}`,
        transition: "all 0.3s ease",
      }}
    >
      <div className="flex items-start gap-2.5">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: cfg.icon_bg }}>
          <IconComp size={13} style={{ color: cfg.icon_color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-xs font-semibold" style={{
              color: event.awaitConfirm ? "#f87171" : event.type === "critical" ? "#f87171" : theme.textSub,
              fontSize: "10px", letterSpacing: "0.04em",
            }}>
              {event.awaitConfirm ? "⚡ 待店长确认" : event.type === "critical" ? "🔴 紧急预警" : event.type === "warning" ? "🟡 注意提示" : event.type === "success" ? "✅ 状态更新" : "ℹ️ 系统通知"}
            </span>
            <span className="text-xs flex-shrink-0" style={{ color: theme.textFaint, fontSize: "10px" }}>{event.time}</span>
          </div>
          <p className="text-xs leading-relaxed" style={{ color: theme.textMsg, fontSize: "12px" }}>{event.message}</p>
        </div>
      </div>
    </div>
  );
}

export default function EventStream({ events, pendingAction, onConfirm, onDispatch, onDefer, onEscalate, actionDone }) {
  const streamRef = useRef(null);
  const { theme, mode } = useTheme();

  useEffect(() => {
    if (streamRef.current) streamRef.current.scrollTop = 0;
  }, [events]);

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
          <span className="text-sm font-semibold" style={{ color: theme.text }}>实时事件流</span>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(0,199,217,0.12)", color: "#00C7D9", border: "1px solid rgba(0,199,217,0.25)", fontSize: "10px" }}>
          AI 智能监控
        </span>
      </div>

      {/* Events */}
      <div ref={streamRef} className="flex-1 overflow-y-auto p-3">
        {events.map((event, i) => (
          <EventItem key={event.id} event={event} isNew={i === 0} theme={theme} />
        ))}
      </div>

      {/* Action area */}
      <div
        className="flex-shrink-0 p-3"
        style={{ borderTop: `1px solid ${theme.borderSubtle}`, background: theme.actionAreaBg }}
      >
        {actionDone ? (
          <div className="rounded-xl p-3 text-center animate-fade-in" style={{ background: "rgba(22,163,74,0.12)", border: "1px solid rgba(22,163,74,0.25)" }}>
            <div className="text-sm font-semibold" style={{ color: "#4ade80" }}>✅ 指令已下发</div>
            <div className="text-xs mt-1" style={{ color: theme.textMuted }}>视光师X已调入检查区，拥堵压力正在缓解</div>
          </div>
        ) : pendingAction ? (
          <>
            <div className="rounded-xl p-3 mb-3" style={{ background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.3)" }}>
              <div className="text-xs font-semibold mb-1" style={{ color: "#f87171" }}>⚡ 待处理：排班调整建议</div>
              <div className="text-xs" style={{ color: theme.textMsg }}>将视光师X调入检查区3号位，预计等待时间降至15分钟以内。</div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={onConfirm} className="py-2.5 rounded-xl text-xs font-bold transition-all duration-150 active:scale-95"
                style={{ background: "linear-gradient(135deg, #00C7D9, #0099A8)", color: "#0D1B2A", boxShadow: "0 0 16px rgba(0,199,217,0.35)" }}>
                ✓ 确认
              </button>
              <button onClick={onDispatch} className="py-2.5 rounded-xl text-xs font-bold transition-all duration-150 active:scale-95"
                style={{ background: "rgba(0,199,217,0.15)", color: "#00C7D9", border: "1px solid rgba(0,199,217,0.35)" }}>
                📡 下发指令
              </button>
              <button onClick={onDefer} className="py-2.5 rounded-xl text-xs font-medium transition-all duration-150 active:scale-95"
                style={{ background: theme.deferBtn, color: theme.deferBtnText, border: `1px solid ${theme.deferBtnBorder}` }}>
                ⏱ 稍后处理
              </button>
              <button onClick={onEscalate} className="py-2.5 rounded-xl text-xs font-medium transition-all duration-150 active:scale-95"
                style={{ background: "rgba(220,38,38,0.1)", color: "#f87171", border: "1px solid rgba(220,38,38,0.25)" }}>
                🚨 升级处理
              </button>
            </div>
          </>
        ) : (
          <div className="text-center py-2">
            <div className="text-xs" style={{ color: theme.textFaint }}>当前无需店长干预</div>
            <div className="text-xs mt-1" style={{ color: theme.textFaintest, fontSize: "10px" }}>系统持续监控中...</div>
          </div>
        )}
      </div>
    </div>
  );
}