import React from "react";
import {
  Users, Stethoscope, AlertTriangle, Zap, UserCheck,
  CircleDollarSign, Package, TrendingUp, Server, ChevronRight,
} from "lucide-react";
import { useTheme } from "@/lib/ThemeContext";

const ICON_MAP = {
  Users, Stethoscope, AlertTriangle, Zap, UserCheck,
  CircleDollarSign, Package, TrendingUp, Server,
};

const STATUS_CONFIG = {
  green: {
    border: "#16A34A",
    dot: "#16A34A",
    badge: { bg: "rgba(22,163,74,0.12)", text: "#4ade80", border: "rgba(22,163,74,0.25)" },
    label: "正常",
    pulse: false,
  },
  amber: {
    border: "#D97706",
    dot: "#D97706",
    badge: { bg: "rgba(217,119,6,0.12)", text: "#fbbf24", border: "rgba(217,119,6,0.25)" },
    label: "注意",
    pulse: false,
  },
  red: {
    border: "#DC2626",
    dot: "#DC2626",
    badge: { bg: "rgba(220,38,38,0.12)", text: "#f87171", border: "rgba(220,38,38,0.25)" },
    label: "紧急",
    pulse: true,
  },
};

export default function PanelCard({ panel, onClick }) {
  const { theme, mode } = useTheme();
  const cfg = STATUS_CONFIG[panel.status] || STATUS_CONFIG.green;
  const IconComp = ICON_MAP[panel.icon] || Users;

  const iconRgb = panel.status === "green" ? "22,163,74" : panel.status === "amber" ? "217,119,6" : "220,38,38";

  return (
    <button
      onClick={() => onClick(panel)}
      className="w-full text-left rounded-xl relative overflow-hidden group"
      style={{
        background: theme.panelCardBg,
        border: `1px solid ${theme.panelCardBorder}`,
        borderLeft: `3px solid ${cfg.border}`,
        boxShadow: panel.status === "red"
          ? `0 0 20px rgba(220,38,38,0.12), 0 2px 8px rgba(0,0,0,${mode === "night" ? "0.3" : "0.08"})`
          : `0 2px 8px rgba(0,0,0,${mode === "night" ? "0.2" : "0.06"})`,
        transition: "all 0.2s ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = `0 0 0 1px rgba(0,199,217,0.2), 0 8px 24px rgba(0,0,0,${mode === "night" ? "0.35" : "0.1"})`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = panel.status === "red"
          ? `0 0 20px rgba(220,38,38,0.12), 0 2px 8px rgba(0,0,0,${mode === "night" ? "0.3" : "0.08"})`
          : `0 2px 8px rgba(0,0,0,${mode === "night" ? "0.2" : "0.06"})`;
      }}
    >
      {panel.status === "red" && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse at top left, rgba(220,38,38,0.06) 0%, transparent 60%)" }}
        />
      )}

      <div className="p-4 relative">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: `rgba(${iconRgb}, 0.12)`, border: `1px solid rgba(${iconRgb}, 0.2)` }}
            >
              <IconComp size={15} style={{ color: cfg.border }} />
            </div>
            <div className="text-sm font-semibold" style={{ color: theme.text, lineHeight: "1.2", transition: "color 0.3s ease" }}>
              {panel.title}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-full"
              style={{ background: cfg.badge.bg, border: `1px solid ${cfg.badge.border}` }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: cfg.dot, animation: cfg.pulse ? "pulseRed 1.5s ease-in-out infinite" : "none" }}
              />
              <span className="text-xs font-semibold" style={{ color: cfg.badge.text, fontSize: "10px" }}>
                {cfg.label}
              </span>
            </div>
            <ChevronRight size={13} style={{ color: theme.textFaint }} />
          </div>
        </div>

        {/* Metrics grid */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          {panel.metrics.map((m, i) => (
            <div key={i} className="min-w-0">
              <div className="flex items-baseline gap-0.5">
                <span
                  className="font-bold leading-none"
                  style={{ color: "#00C7D9", fontSize: m.value.length > 6 ? "13px" : "18px", lineHeight: "1.1" }}
                >
                  {m.value}
                </span>
                {m.unit && (
                  <span className="text-xs" style={{ color: theme.textMuted, fontSize: "10px" }}>
                    {m.unit}
                  </span>
                )}
              </div>
              <div className="text-xs mt-0.5 truncate" style={{ color: theme.textMuted, fontSize: "10px" }}>
                {m.label}
              </div>
            </div>
          ))}
        </div>

        {/* Live note */}
        <div
          className="text-xs leading-snug py-2 px-2.5 rounded-lg"
          style={{
            color: theme.textSub,
            background: mode === "night" ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)",
            border: `1px solid ${mode === "night" ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)"}`,
            fontSize: "11px",
            transition: "all 0.3s ease",
          }}
        >
          {panel.liveNote}
        </div>
      </div>
    </button>
  );
}