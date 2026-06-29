import React, { useEffect } from "react";
import { X, ChevronRight } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, LineChart, Line, Tooltip } from "recharts";
import { useTheme } from "@/lib/ThemeContext";

const STATUS_COLORS = {
  在岗:  { bg: "rgba(22,163,74,0.12)",   text: "#4ade80", border: "rgba(22,163,74,0.25)" },
  忙碌:  { bg: "rgba(217,119,6,0.12)",   text: "#fbbf24", border: "rgba(217,119,6,0.25)" },
  空闲:  { bg: "rgba(0,199,217,0.12)",   text: "#00C7D9", border: "rgba(0,199,217,0.25)" },
  诊疗中:{ bg: "rgba(217,119,6,0.12)",   text: "#fbbf24", border: "rgba(217,119,6,0.25)" },
  外出:  { bg: "rgba(148,163,184,0.1)",  text: "#94A3B8", border: "rgba(148,163,184,0.2)" },
  远程:  { bg: "rgba(0,199,217,0.08)",   text: "#67E8F9", border: "rgba(0,199,217,0.2)" },
  支援中:{ bg: "rgba(0,199,217,0.15)",   text: "#00C7D9", border: "rgba(0,199,217,0.35)" },
};

const PANEL_STATUS = {
  green: { color: "#16A34A", label: "正常" },
  amber: { color: "#D97706", label: "注意" },
  red:   { color: "#DC2626", label: "紧急" },
};

export default function PanelDrawer({ panel, onClose }) {
  const { theme } = useTheme();

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  if (!panel) return null;

  const statusCfg = PANEL_STATUS[panel.status] || PANEL_STATUS.green;

  const hourlyData = panel.detail?.hourlyFlow?.map((v, i) => ({ 时间: `${8 + i}:00`, 人数: v }));
  const revenueData = panel.detail?.dailyRevenue?.map((v, i) => ({ 天: `D${i + 1}`, 营收: v }));

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
          transition: "background 0.3s ease",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: `1px solid ${theme.borderSubtle}`, background: theme.drawerHeader }}
        >
          <div className="flex items-center gap-3">
            <div className="w-1 h-8 rounded-full" style={{ background: statusCfg.color }} />
            <div>
              <div className="text-base font-bold" style={{ color: theme.text }}>{panel.title}</div>
              <div className="text-xs" style={{ color: theme.textMuted }}>详细数据 · 实时更新</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
              style={{ background: `${statusCfg.color}20`, border: `1px solid ${statusCfg.color}40` }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: statusCfg.color, animation: panel.status === "red" ? "pulseRed 1.5s ease-in-out infinite" : "none" }}
              />
              <span className="text-xs font-semibold" style={{ color: statusCfg.color }}>{statusCfg.label}</span>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
              style={{ background: "rgba(128,128,128,0.1)" }}
              onMouseEnter={(e) => e.currentTarget.style.background = "rgba(128,128,128,0.2)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "rgba(128,128,128,0.1)"}
            >
              <X size={16} style={{ color: theme.textSub }} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Core metrics */}
          <div className="p-5">
            <div className="text-xs font-semibold mb-3" style={{ color: theme.textMuted, letterSpacing: "0.08em" }}>核心指标</div>
            <div className="grid grid-cols-2 gap-3">
              {panel.metrics.map((m, i) => (
                <div key={i} className="rounded-xl p-3" style={{ background: theme.metricCard, border: `1px solid ${theme.metricCardBorder}` }}>
                  <div className="text-xs mb-1" style={{ color: theme.textMuted, fontSize: "10px" }}>{m.label}</div>
                  <div className="flex items-baseline gap-1">
                    <span className="font-bold" style={{ color: "#00C7D9", fontSize: "22px", lineHeight: "1" }}>{m.value}</span>
                    {m.unit && <span className="text-xs" style={{ color: theme.textMuted }}>{m.unit}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sub-metrics */}
          {panel.detail?.subMetrics && (
            <div className="px-5 pb-5">
              <div className="text-xs font-semibold mb-3" style={{ color: theme.textMuted, letterSpacing: "0.08em" }}>详细数据</div>
              <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${theme.borderSubtle}` }}>
                {panel.detail.subMetrics.map((sm, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between px-4 py-2.5"
                    style={{
                      borderBottom: i < panel.detail.subMetrics.length - 1 ? `1px solid ${theme.borderSubtle}` : "none",
                      background: i % 2 === 0 ? theme.subRowEven : "transparent",
                    }}
                  >
                    <span className="text-xs" style={{ color: theme.textSub }}>{sm.label}</span>
                    <span className="text-xs font-semibold" style={{ color: theme.text }}>{sm.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Line chart */}
          {hourlyData && (
            <div className="px-5 pb-5">
              <div className="text-xs font-semibold mb-3" style={{ color: theme.textMuted, letterSpacing: "0.08em" }}>患者逐小时流量</div>
              <div className="rounded-xl p-4" style={{ background: theme.metricCard, border: `1px solid ${theme.metricCardBorder}`, height: "140px" }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={hourlyData}>
                    <XAxis dataKey="时间" tick={{ fill: theme.textFaint, fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: theme.textFaint, fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: theme.chartTooltipBg, border: `1px solid ${theme.chartTooltipBorder}`, borderRadius: "8px", fontSize: "11px", color: theme.text }} labelStyle={{ color: theme.textSub }} />
                    <Line type="monotone" dataKey="人数" stroke="#00C7D9" strokeWidth={2} dot={{ fill: "#00C7D9", r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Bar chart */}
          {revenueData && (
            <div className="px-5 pb-5">
              <div className="text-xs font-semibold mb-3" style={{ color: theme.textMuted, letterSpacing: "0.08em" }}>近5日营收趋势</div>
              <div className="rounded-xl p-4" style={{ background: theme.metricCard, border: `1px solid ${theme.metricCardBorder}`, height: "140px" }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={revenueData}>
                    <XAxis dataKey="天" tick={{ fill: theme.textFaint, fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: theme.textFaint, fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: theme.chartTooltipBg, border: `1px solid ${theme.chartTooltipBorder}`, borderRadius: "8px", fontSize: "11px", color: theme.text }} labelStyle={{ color: theme.textSub }} />
                    <Bar dataKey="营收" fill="#00C7D9" radius={[4, 4, 0, 0]} opacity={0.85} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Staff list */}
          {panel.detail?.staffList && (
            <div className="px-5 pb-5">
              <div className="text-xs font-semibold mb-3" style={{ color: theme.textMuted, letterSpacing: "0.08em" }}>全员实时状态</div>
              <div className="space-y-1.5">
                {panel.detail.staffList.map((s, i) => {
                  const sc = STATUS_COLORS[s.status] || STATUS_COLORS["在岗"];
                  return (
                    <div key={i} className="flex items-center justify-between px-3 py-2.5 rounded-lg" style={{ background: theme.metricCard, border: `1px solid ${theme.metricCardBorder}` }}>
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: "rgba(0,199,217,0.12)", color: "#00C7D9", border: "1px solid rgba(0,199,217,0.2)" }}>
                          {s.id}
                        </div>
                        <div>
                          <div className="text-xs font-semibold" style={{ color: theme.text }}>{s.name}</div>
                          <div className="text-xs" style={{ color: theme.textMuted, fontSize: "10px" }}>{s.area}</div>
                        </div>
                      </div>
                      <div className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: sc.bg, color: sc.text, border: `1px solid ${sc.border}`, fontSize: "10px" }}>
                        {s.status}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Staff involved */}
          {panel.detail?.staffInvolved && !panel.detail?.staffList && (
            <div className="px-5 pb-5">
              <div className="text-xs font-semibold mb-3" style={{ color: theme.textMuted, letterSpacing: "0.08em" }}>相关人员</div>
              <div className="flex flex-wrap gap-2">
                {panel.detail.staffInvolved.map((name, i) => (
                  <span key={i} className="px-2.5 py-1 rounded-lg text-xs font-medium" style={{ background: "rgba(0,199,217,0.1)", color: "#00C7D9", border: "1px solid rgba(0,199,217,0.2)" }}>
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Alerts */}
          {panel.detail?.alerts && (
            <div className="px-5 pb-8">
              <div className="text-xs font-semibold mb-3" style={{ color: theme.textMuted, letterSpacing: "0.08em" }}>当前提醒</div>
              <div className="space-y-2">
                {panel.detail.alerts.map((alert, i) => (
                  <div key={i} className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg" style={{ background: "rgba(217,119,6,0.06)", border: "1px solid rgba(217,119,6,0.2)" }}>
                    <ChevronRight size={12} style={{ color: "#D97706", marginTop: "1px", flexShrink: 0 }} />
                    <span className="text-xs leading-relaxed" style={{ color: theme.textMsg }}>{alert}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}