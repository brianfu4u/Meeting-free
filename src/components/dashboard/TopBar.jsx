import React, { useState, useEffect } from "react";
import { Activity, Wifi, Bell, Sun, Moon, Network, Play, GitBranch, ClipboardCheck, Crown, Brain, Wrench, Users, UserPlus, BarChart3, Settings, Trophy } from "lucide-react";
import { Link } from "react-router-dom";
import { CLINIC_NAME } from "@/data/mockData";
import { useTheme } from "@/lib/ThemeContext";

export default function TopBar({ overallHealth, onMenuToggle }) {
  const [time, setTime] = useState(new Date());
  const { theme, mode, toggleTheme } = useTheme();

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
    overallHealth >= 85 ? "#4ade80" : overallHealth >= 70 ? "#fbbf24" : "#f87171";
  const healthBgColor =
    overallHealth >= 85 ? "rgba(22,163,74,0.12)" : overallHealth >= 70 ? "rgba(217,119,6,0.12)" : "rgba(220,38,38,0.12)";
  const healthBorderColor =
    overallHealth >= 85 ? "rgba(22,163,74,0.3)" : overallHealth >= 70 ? "rgba(217,119,6,0.3)" : "rgba(220,38,38,0.3)";

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 md:px-6"
      style={{
        height: "56px",
        background: theme.topbar,
        borderBottom: `1px solid ${theme.borderSubtle}`,
        backdropFilter: "blur(12px)",
        transition: "background 0.3s ease, border-color 0.3s ease",
      }}
    >
      {/* Left: Logo + Clinic */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          className="md:hidden p-1.5 rounded-lg transition-colors"
          style={{ background: "transparent" }}
          onClick={onMenuToggle}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <rect y="3" width="18" height="1.5" rx="0.75" fill={theme.textSub} />
            <rect y="8.25" width="18" height="1.5" rx="0.75" fill={theme.textSub} />
            <rect y="13.5" width="18" height="1.5" rx="0.75" fill={theme.textSub} />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(0,199,217,0.2)", border: "1px solid rgba(0,199,217,0.4)" }}
          >
            <Activity size={14} style={{ color: "#00C7D9" }} />
          </div>
          <div className="hidden sm:flex flex-col leading-none">
            <span className="text-xs font-semibold" style={{ color: "#00C7D9", letterSpacing: "0.05em" }}>
              今天我来当店长
            </span>
            <span className="text-xs" style={{ color: theme.textMuted, marginTop: "1px" }}>
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

      {/* Center: Date */}
      <div className="hidden md:flex flex-col items-center">
        <span className="text-xs" style={{ color: theme.textMuted }}>
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

      {/* Right */}
      <div className="flex items-center gap-2 md:gap-3">
        {/* Architecture map link */}
        <Link
          to="/architecture"
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all duration-200 active:scale-95"
          style={{ background: "rgba(0,199,217,0.1)", border: "1px solid rgba(0,199,217,0.25)" }}
          title="查看 Clinic OS 开发逻辑总图"
        >
          <Network size={13} style={{ color: "#00C7D9" }} />
          <span className="text-xs font-semibold" style={{ color: "#00C7D9", fontSize: "10px" }}>架构图</span>
        </Link>

        {/* Boot demo link */}
        <Link
          to="/boot-demo"
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all duration-200 active:scale-95"
          style={{ background: "rgba(22,163,74,0.1)", border: "1px solid rgba(22,163,74,0.25)" }}
          title="系统启动联动演示"
        >
          <Play size={13} style={{ color: "#4ade80" }} />
          <span className="text-xs font-semibold" style={{ color: "#4ade80", fontSize: "10px" }}>启动演示</span>
        </Link>

        {/* Causal canvas link */}
        <Link
          to="/causal-canvas"
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all duration-200 active:scale-95"
          style={{ background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.25)" }}
          title="全景因果链画布"
        >
          <GitBranch size={13} style={{ color: "#A78BFA" }} />
          <span className="text-xs font-semibold" style={{ color: "#A78BFA", fontSize: "10px" }}>因果画布</span>
        </Link>

        {/* Daily review link */}
        <Link
          to="/daily-review"
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all duration-200 active:scale-95"
          style={{ background: "rgba(217,119,6,0.1)", border: "1px solid rgba(217,119,6,0.25)" }}
          title="每日经营复盘"
        >
          <ClipboardCheck size={13} style={{ color: "#FBBF24" }} />
          <span className="text-xs font-semibold" style={{ color: "#FBBF24", fontSize: "10px" }}>每日复盘</span>
        </Link>

        {/* V9 case flow link */}
        <Link
          to="/v9-case"
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all duration-200 active:scale-95"
          style={{ background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.25)" }}
          title="V9 案例闭环演练"
        >
          <Crown size={13} style={{ color: "#f87171" }} />
          <span className="text-xs font-semibold" style={{ color: "#f87171", fontSize: "10px" }}>V9演练</span>
        </Link>

        {/* M3 hub link */}
        <Link
          to="/m3-hub"
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all duration-200 active:scale-95"
          style={{ background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.25)" }}
          title="M3 智能中枢 · LLM 技能"
        >
          <Brain size={13} style={{ color: "#A78BFA" }} />
          <span className="text-xs font-semibold" style={{ color: "#A78BFA", fontSize: "10px" }}>智能中枢</span>
        </Link>

        {/* Dev director link */}
        <Link
          to="/dev-director"
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all duration-200 active:scale-95"
          style={{ background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.25)" }}
          title="开发总监 · 智能运营监理"
        >
          <Wrench size={13} style={{ color: "#FB923C" }} />
          <span className="text-xs font-semibold" style={{ color: "#FB923C", fontSize: "10px" }}>开发总监</span>
        </Link>

        {/* Staff management link */}
        <Link
          to="/staff-mgmt"
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all duration-200 active:scale-95"
          style={{ background: "rgba(100,116,139,0.12)", border: "1px solid rgba(100,116,139,0.25)" }}
          title="员工管理 · 邀请注册与花名册"
        >
          <Users size={13} style={{ color: "#94A3B8" }} />
          <span className="text-xs font-semibold" style={{ color: "#94A3B8", fontSize: "10px" }}>员工管理</span>
        </Link>

        {/* Staff onboarding link */}
        <Link
          to="/staff-onboarding"
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all duration-200 active:scale-95"
          style={{ background: "rgba(168,85,247,0.1)", border: "1px solid rgba(168,85,247,0.25)" }}
          title="员工入职邀请 · 邀请码与待审核申请"
        >
          <UserPlus size={13} style={{ color: "#A855F7" }} />
          <span className="text-xs font-semibold" style={{ color: "#A855F7", fontSize: "10px" }}>入职邀请</span>
        </Link>

        {/* Analytics dashboard link */}
        <Link
          to="/analytics-dashboard"
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all duration-200 active:scale-95"
          style={{ background: "rgba(0,199,217,0.1)", border: "1px solid rgba(0,199,217,0.25)" }}
          title="业务数据分析 · 营收/客流/任务效率"
        >
          <BarChart3 size={13} style={{ color: "#00C7D9" }} />
          <span className="text-xs font-semibold" style={{ color: "#00C7D9", fontSize: "10px" }}>数据分析</span>
        </Link>

        {/* Performance report link */}
        <Link
          to="/performance-report"
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all duration-200 active:scale-95"
          style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.25)" }}
          title="工作绩效报告 · 月度效率与AI评分"
        >
          <Trophy size={13} style={{ color: "#FBBF24" }} />
          <span className="text-xs font-semibold" style={{ color: "#FBBF24", fontSize: "10px" }}>绩效报告</span>
        </Link>

        {/* Clinic settings link */}
        <Link
          to="/clinic-settings"
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all duration-200 active:scale-95"
          style={{ background: "rgba(148,163,184,0.12)", border: "1px solid rgba(148,163,184,0.25)" }}
          title="系统配置中心 · 基础信息/流程开关/角色权限"
        >
          <Settings size={13} style={{ color: "#94A3B8" }} />
          <span className="text-xs font-semibold" style={{ color: "#94A3B8", fontSize: "10px" }}>配置中心</span>
        </Link>

        {/* Live indicator */}
        <div className="hidden sm:flex items-center gap-1.5">
          <Wifi size={12} style={{ color: "#00C7D9" }} />
          <span className="text-xs" style={{ color: "#00C7D9", fontSize: "10px" }}>
            实时
          </span>
        </div>

        {/* Clock */}
        <div className="digit-clock font-bold tabular-nums" style={{ color: theme.text, fontSize: "20px", letterSpacing: "0.08em", transition: "color 0.3s ease" }}>
          {formatTime(time)}
        </div>

        {/* Health score */}
        <div
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg"
          style={{ background: healthBgColor, border: `1px solid ${healthBorderColor}`, fontSize: "11px", fontWeight: 600 }}
        >
          <span style={{ color: healthColor }}>健康</span>
          <span style={{ color: healthColor, fontWeight: 700 }}>{overallHealth}</span>
        </div>

        {/* Day/Night toggle */}
        <button
          onClick={toggleTheme}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all duration-200 active:scale-95"
          style={{
            background: mode === "night" ? "rgba(255,220,80,0.1)" : "rgba(30,58,138,0.1)",
            border: mode === "night" ? "1px solid rgba(255,220,80,0.25)" : "1px solid rgba(30,58,138,0.2)",
          }}
          title={mode === "night" ? "切换白天模式" : "切换夜晚模式"}
        >
          {mode === "night" ? (
            <Sun size={13} style={{ color: "#FBBF24" }} />
          ) : (
            <Moon size={13} style={{ color: "#6366F1" }} />
          )}
          <span className="hidden sm:block text-xs font-semibold" style={{ color: mode === "night" ? "#FBBF24" : "#6366F1", fontSize: "10px" }}>
            {mode === "night" ? "白天" : "夜晚"}
          </span>
        </button>

        {/* Bell */}
        <button
          className="relative p-1.5 rounded-lg transition-colors"
          style={{ background: mode === "night" ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)" }}
        >
          <Bell size={15} style={{ color: theme.textSub }} />
          <span
            className="absolute top-0 right-0 w-2 h-2 rounded-full"
            style={{ background: "#DC2626", border: `1.5px solid ${theme.canvas}` }}
          />
        </button>
      </div>
    </header>
  );
}