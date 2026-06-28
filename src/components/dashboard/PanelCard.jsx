import React from "react";
import {
  Users, Stethoscope, AlertTriangle, Zap, UserCheck,
  CircleDollarSign, Package, TrendingUp, Server, ChevronRight,
} from "lucide-react";

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
    glow: "rgba(22,163,74,0.08)",
    pulse: false,
  },
  amber: {
    border: "#D97706",
    dot: "#D97706",
    badge: { bg: "rgba(217,119,6,0.12)", text: "#fbbf24", border: "rgba(217,119,6,0.25)" },
    label: "注意",
    glow: "rgba(217,119,6,0.08)",
    pulse: false,
  },
  red: {
    border: "#DC2626",
    dot: "#DC2626",
    badge: { bg: "rgba(220,38,38,0.12)", text: "#f87171", border: "rgba(220,38,38,0.25)" },
    label: "紧急",
    glow: "rgba(220,38,38,0.1)",
    pulse: true,
  },
};

export default function PanelCard({ panel, onClick }) {
  const cfg = STATUS_CONFIG[panel.status] || STATUS_CONFIG.green;
  const IconComp = ICON_MAP[panel.icon] || Users;

  return (
    <button
      onClick={() => onClick(panel)}
      className="w-full text-left rounded-xl transition-all duration-200 group relative overflow-hidden"
      style={{
        background: `linear-gradient(135deg, #1E293B 0%, #1A2535 100%)`,
        border: `1px solid #2D3F55`,
        borderLeft: `3px solid ${cfg.border}`,
        boxShadow: panel.status === "red"
          ? `0 0 20px rgba(220,38,38,0.12), 0 2px 8px rgba(0,0,0,0.3)`
          : `0 2px 8px rgba(0,0,0,0.2)`,
        transition: "all 0.2s ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.borderColor = `#3D5070`;
        e.currentTarget.style.boxShadow = `0 0 0 1px rgba(0,199,217,0.15), 0 8px 24px rgba(0,0,0,0.35)`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.borderColor = "#2D3F55";
        e.currentTarget.style.boxShadow = panel.status === "red"
          ? `0 0 20px rgba(220,38,38,0.12), 0 2px 8px rgba(0,0,0,0.3)`
          : `0 2px 8px rgba(0,0,0,0.2)`;
      }}
    >
      {/* Subtle glow overlay for critical panels */}
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
              style={{
                background: `rgba(${panel.status === "green" ? "22,163,74" : panel.status === "amber" ? "217,119,6" : "220,38,38"}, 0.15)`,
                border: `1px solid ${cfg.border}30`,
              }}
            >
              <IconComp size={15} style={{ color: cfg.border }} />
            </div>
            <div>
              <div className="text-sm font-semibold" style={{ color: "#F1F5F9", lineHeight: "1.2" }}>
                {panel.title}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-full"
              style={{
                background: cfg.badge.bg,
                border: `1px solid ${cfg.badge.border}`,
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{
                  background: cfg.dot,
                  animation: cfg.pulse ? "pulseRed 1.5s ease-in-out infinite" : "none",
                }}
              />
              <span className="text-xs font-semibold" style={{ color: cfg.badge.text, fontSize: "10px" }}>
                {cfg.label}
              </span>
            </div>
            <ChevronRight size={13} style={{ color: "#475569" }} className="group-hover:text-cyan-400 transition-colors" />
          </div>
        </div>

        {/* Metrics grid */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          {panel.metrics.map((m, i) => (
            <div key={i} className="min-w-0">
              <div className="flex items-baseline gap-0.5">
                <span
                  className="font-bold leading-none"
                  style={{
                    color: "#00C7D9",
                    fontSize: m.value.length > 6 ? "13px" : "18px",
                    lineHeight: "1.1",
                  }}
                >
                  {m.value}
                </span>
                {m.unit && (
                  <span className="text-xs" style={{ color: "#64748B", fontSize: "10px" }}>
                    {m.unit}
                  </span>
                )}
              </div>
              <div className="text-xs mt-0.5 truncate" style={{ color: "#64748B", fontSize: "10px" }}>
                {m.label}
              </div>
            </div>
          ))}
        </div>

        {/* Live note */}
        <div
          className="text-xs leading-snug py-2 px-2.5 rounded-lg"
          style={{
            color: "#94A3B8",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.05)",
            fontSize: "11px",
          }}
        >
          {panel.liveNote}
        </div>
      </div>
    </button>
  );
}