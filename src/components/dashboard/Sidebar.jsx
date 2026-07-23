import React from "react";
import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard, ClipboardCheck, BarChart3, Trophy,
  Users, UserPlus, Settings,
} from "lucide-react";
import { useTheme } from "@/lib/ThemeContext";
import { beijingShift } from "@/lib/clinicTime";

// 功能板块（可点击进入对应页面），部门面板不再罗列
const GROUPS = [
  {
    color: "#00C7D9",
    label: "总览",
    items: [
      { to: "/", icon: LayoutDashboard, label: "院长指挥台" },
    ],
  },
  {
    color: "#FBBF24",
    label: "运营分析",
    items: [
      { to: "/daily-review", icon: ClipboardCheck, label: "每日复盘" },
      { to: "/analytics-dashboard", icon: BarChart3, label: "数据分析" },
      { to: "/performance-report", icon: Trophy, label: "绩效报告" },
    ],
  },
  {
    color: "#16A34A",
    label: "团队管理",
    items: [
      { to: "/staff-mgmt", icon: Users, label: "员工管理" },
      { to: "/staff-onboarding", icon: UserPlus, label: "入职邀请" },
    ],
  },
  {
    color: "#94A3B8",
    label: "系统配置",
    items: [
      { to: "/clinic-settings", icon: Settings, label: "配置中心" },
    ],
  },
];

export default function Sidebar({ isOpen, onClose }) {
  const { theme } = useTheme();
  const shift = beijingShift();
  const { pathname } = useLocation();

  const isActive = (to) => (to === "/" ? pathname === "/" : pathname.startsWith(to));

  const renderItem = (item) => {
    const IconComp = item.icon;
    const active = isActive(item.to);
    return (
      <Link
        key={item.to}
        to={item.to}
        onClick={onClose}
        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg mb-0.5 transition-all duration-150 text-left"
        style={{
          background: active ? "rgba(0,199,217,0.12)" : "transparent",
          border: active ? "1px solid rgba(0,199,217,0.25)" : "1px solid transparent",
        }}
      >
        <div
          className="flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center"
          style={{ background: active ? "rgba(0,199,217,0.2)" : "rgba(128,128,128,0.08)" }}
        >
          <IconComp size={12} style={{ color: active ? "#00C7D9" : theme.textMuted }} />
        </div>
        <span
          className="flex-1 truncate"
          style={{ color: active ? "#00C7D9" : theme.textSub, fontSize: "11px", fontWeight: active ? 600 : 400 }}
        >
          {item.label}
        </span>
      </Link>
    );
  };

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 md:hidden"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={onClose}
        />
      )}
      <aside
        className={`fixed top-14 bottom-0 left-0 z-40 flex flex-col transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
        style={{
          width: "200px",
          background: theme.sidebar,
          borderRight: `1px solid ${theme.borderSubtle}`,
          backdropFilter: "blur(12px)",
          transition: "background 0.3s ease, border-color 0.3s ease, transform 0.3s ease",
        }}
      >
        <div className="flex-1 overflow-y-auto py-2 px-2">
          {GROUPS.map((group, idx) => (
            <div key={group.label} className={idx === 0 ? "" : "mt-3"}>
              <div className="flex items-center gap-1.5 px-2 mb-1">
                <div className="w-1 h-3 rounded-full" style={{ background: group.color }} />
                <span style={{ color: group.color, fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em" }}>
                  {group.label}
                </span>
              </div>
              {group.items.map(renderItem)}
            </div>
          ))}
        </div>

        <div
          className="mx-2 mb-3 p-3 rounded-lg"
          style={{ background: theme.shiftInfoBg, border: `1px solid ${theme.shiftInfoBorder}` }}
        >
          <div className="text-xs font-semibold mb-1.5" style={{ color: "#00C7D9", fontSize: "10px", letterSpacing: "0.05em" }}>
            当前班次
          </div>
          <div className="text-xs font-bold" style={{ color: theme.text }}>{shift.label}</div>
          <div className="text-xs mt-0.5" style={{ color: theme.textMuted }}>{shift.range}</div>
          <div className="mt-2 flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: shift.color }} />
            <span className="text-xs" style={{ color: shift.color, fontSize: "10px" }}>进行中</span>
          </div>
        </div>
      </aside>
    </>
  );
}