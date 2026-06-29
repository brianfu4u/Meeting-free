import React from "react";
import { useTheme } from "@/lib/ThemeContext";

export default function StatsBar({ panels }) {
  const { theme } = useTheme();
  const red   = Object.values(panels).filter((p) => p.status === "red").length;
  const amber = Object.values(panels).filter((p) => p.status === "amber").length;
  const green = Object.values(panels).filter((p) => p.status === "green").length;

  return (
    <div
      className="flex items-center gap-4 px-4 py-2.5 rounded-xl"
      style={{ background: theme.statsBar, border: `1px solid ${theme.statsBarBorder}`, transition: "background 0.3s ease, border-color 0.3s ease" }}
    >
      <span className="text-xs font-semibold" style={{ color: theme.textMuted, letterSpacing: "0.05em", fontSize: "10px" }}>
        系统概况
      </span>
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full" style={{ background: "#DC2626" }} />
        <span className="text-xs font-semibold" style={{ color: "#f87171" }}>{red} 紧急</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full" style={{ background: "#D97706" }} />
        <span className="text-xs font-semibold" style={{ color: "#fbbf24" }}>{amber} 注意</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full" style={{ background: "#16A34A" }} />
        <span className="text-xs font-semibold" style={{ color: "#4ade80" }}>{green} 正常</span>
      </div>
      <div className="ml-auto text-xs" style={{ color: theme.textFaint, fontSize: "10px" }}>
        共 9 个板块在监控
      </div>
    </div>
  );
}