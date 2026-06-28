import React, { useState, useEffect } from "react";
import { Activity, Wifi, Bell } from "lucide-react";
import { CLINIC_NAME } from "@/data/mockData";

export default function TopBar({ overallHealth, onMenuToggle }) {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (date) => {
    const h = String(date.getHours()).padStart(2, "0");
    const m = String(date.getMinutes()).padStart(2, "0");
    const s = String(date.getSeconds()).padStart(2, "0");
    return `${h}:${m}:${s}`;
  };

  const formatDate = (date) => {
    const days = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    const d = days[date.getDay()];
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${d}`;
  };

  const healthColor =
    overallHealth >= 85
      ? "text-green-400"
      : overallHealth >= 70
      ? "text-amber-400"
      : "text-red-400";

  const healthBg =
    overallHealth >= 85
      ? "tag-green"
      : overallHealth >= 70
      ? "tag-amber"
      : "tag-red";

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 md:px-6"
      style={{
        height: "56px",
        background: "rgba(10, 22, 40, 0.97)",
        borderBottom: "1px solid #1E3352",
        backdropFilter: "blur(12px)",
      }}
    >
      {/* Left: Logo + Clinic */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          className="md:hidden p-1.5 rounded-lg hover:bg-white/10 transition-colors"
          onClick={onMenuToggle}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <rect y="3" width="18" height="1.5" rx="0.75" fill="#94A3B8" />
            <rect y="8.25" width="18" height="1.5" rx="0.75" fill="#94A3B8" />
            <rect y="13.5" width="18" height="1.5" rx="0.75" fill="#94A3B8" />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(0, 199, 217, 0.2)", border: "1px solid rgba(0, 199, 217, 0.4)" }}
          >
            <Activity size={14} style={{ color: "#00C7D9" }} />
          </div>
          <div className="hidden sm:flex flex-col leading-none">
            <span className="text-xs font-semibold" style={{ color: "#00C7D9", letterSpacing: "0.05em" }}>
              今天我来当店长
            </span>
            <span className="text-xs" style={{ color: "#64748B", marginTop: "1px" }}>
              {CLINIC_NAME}
            </span>
          </div>
          <div className="sm:hidden">
            <span className="text-xs font-semibold" style={{ color: "#00C7D9" }}>
              {CLINIC_NAME}
            </span>
          </div>
        </div>
      </div>

      {/* Center: Date (hidden on mobile) */}
      <div className="hidden md:flex flex-col items-center">
        <span className="text-xs" style={{ color: "#64748B" }}>
          {formatDate(time)}
        </span>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: "#16A34A", animation: "pulseGreen 3s ease-in-out infinite" }}
          />
          <span className="text-xs font-medium" style={{ color: "#4ade80" }}>
            上午班 进行中
          </span>
        </div>
      </div>

      {/* Right: Clock + Health + Alerts */}
      <div className="flex items-center gap-3 md:gap-4">
        {/* Live indicator */}
        <div className="hidden sm:flex items-center gap-1.5">
          <Wifi size={12} style={{ color: "#00C7D9" }} />
          <span className="text-xs" style={{ color: "#00C7D9", fontSize: "10px" }}>
            实时
          </span>
        </div>

        {/* Clock */}
        <div className="digit-clock font-bold tabular-nums" style={{ color: "#F1F5F9", fontSize: "20px", letterSpacing: "0.08em" }}>
          {formatTime(time)}
        </div>

        {/* Health score */}
        <div
          className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${healthBg}`}
          style={{ fontSize: "11px", fontWeight: 600 }}
        >
          <span className={healthColor}>健康</span>
          <span className={`font-bold ${healthColor}`}>{overallHealth}</span>
        </div>

        {/* Bell */}
        <button
          className="relative p-1.5 rounded-lg transition-colors"
          style={{ background: "rgba(255,255,255,0.05)" }}
        >
          <Bell size={15} style={{ color: "#94A3B8" }} />
          <span
            className="absolute top-0 right-0 w-2 h-2 rounded-full"
            style={{ background: "#DC2626", border: "1.5px solid #0A1628" }}
          />
        </button>
      </div>
    </header>
  );
}