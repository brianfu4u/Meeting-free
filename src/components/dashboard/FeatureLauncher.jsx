import React, { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  LayoutGrid, ChevronDown, Network, Play, GitBranch,
  ClipboardCheck, Crown, Brain, Wrench, Users, UserPlus,
  BarChart3, Settings, Trophy, FlaskConical,
} from "lucide-react";
import { useTheme } from "@/lib/ThemeContext";

const FEATURE_GROUPS = [
  {
    label: "开发与演示",
    accent: "#00C7D9",
    items: [
      { to: "/architecture", icon: Network, label: "架构图", color: "#00C7D9" },
      { to: "/boot-demo", icon: Play, label: "启动演示", color: "#4ade80" },
      { to: "/causal-canvas", icon: GitBranch, label: "因果画布", color: "#A78BFA" },
      { to: "/v9-case", icon: Crown, label: "V9演练", color: "#f87171" },
      { to: "/phase5-smoke", icon: FlaskConical, label: "碎片采集", color: "#4ade80" },
    ],
  },
  {
    label: "智能与运营",
    accent: "#A78BFA",
    items: [
      { to: "/m3-hub", icon: Brain, label: "智能中枢", color: "#A78BFA" },
      { to: "/dev-director", icon: Wrench, label: "开发总监", color: "#FB923C" },
      { to: "/daily-review", icon: ClipboardCheck, label: "每日复盘", color: "#FBBF24" },
    ],
  },
  {
    label: "管理与配置",
    accent: "#94A3B8",
    items: [
      { to: "/staff-mgmt", icon: Users, label: "员工管理", color: "#94A3B8" },
      { to: "/staff-onboarding", icon: UserPlus, label: "入职邀请", color: "#A855F7" },
      { to: "/analytics-dashboard", icon: BarChart3, label: "数据分析", color: "#00C7D9" },
      { to: "/performance-report", icon: Trophy, label: "绩效报告", color: "#FBBF24" },
      { to: "/clinic-settings", icon: Settings, label: "配置中心", color: "#94A3B8" },
    ],
  },
];

export default function FeatureLauncher() {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all duration-200 active:scale-95"
        style={{ background: "rgba(0,199,217,0.1)", border: "1px solid rgba(0,199,217,0.25)" }}
        title="功能导航"
      >
        <LayoutGrid size={13} style={{ color: "#00C7D9" }} />
        <span className="hidden sm:block text-xs font-semibold" style={{ color: "#00C7D9", fontSize: "10px" }}>
          功能导航
        </span>
        <ChevronDown
          size={12}
          style={{ color: "#00C7D9", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}
        />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 z-50 rounded-xl p-3 animate-fade-in"
          style={{
            background: theme.drawerBg,
            border: `1px solid ${theme.border}`,
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            minWidth: "320px",
            backdropFilter: "blur(12px)",
          }}
        >
          {FEATURE_GROUPS.map((group) => (
            <div key={group.label} className="mb-3 last:mb-0">
              <div className="flex items-center gap-1.5 px-1 mb-1.5">
                <div className="w-1 h-3 rounded-full" style={{ background: group.accent }} />
                <span style={{ color: group.accent, fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em" }}>
                  {group.label}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all duration-150 hover:bg-white/5"
                    >
                      <Icon size={13} style={{ color: item.color }} />
                      <span className="truncate" style={{ color: theme.text, fontSize: "11px" }}>
                        {item.label}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}