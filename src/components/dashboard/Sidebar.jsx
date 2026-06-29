import React from "react";
import {
  LayoutDashboard, Stethoscope, Server, CircleDollarSign,
  ConciergeBell, GitBranch, Microscope, Activity, Syringe,
  BedDouble, HeartPulse, Warehouse, CreditCard, ShoppingCart,
  Wrench, Megaphone, ShoppingBag, Ambulance,
} from "lucide-react";
import { useTheme } from "@/lib/ThemeContext";

const ICON_MAP = {
  LayoutDashboard, Stethoscope, Server, CircleDollarSign,
  ConciergeBell, GitBranch, Microscope, Activity, Syringe,
  BedDouble, HeartPulse, Warehouse, CreditCard, ShoppingCart,
  Wrench, Megaphone, ShoppingBag, Ambulance,
};

const STATUS_DOT = { green: "#16A34A", amber: "#D97706", red: "#DC2626" };

const GROUP_COLORS = {
  clinical:   "#00C7D9",
  support:    "#16A34A",
  management: "#D97706",
};

const GROUP_LABELS = {
  clinical:   "一线诊疗",
  support:    "后勤支撑",
  management: "管理赋能",
};

export default function Sidebar({ navItems, activeSection, onNavigate, panelStatuses, isOpen, onClose }) {
  const { theme } = useTheme();

  // Group nav items
  const overview = navItems.filter((i) => !i.group);
  const grouped = {};
  navItems.filter((i) => i.group).forEach((i) => {
    if (!grouped[i.group]) grouped[i.group] = [];
    grouped[i.group].push(i);
  });

  const renderItem = (item) => {
    const IconComp = ICON_MAP[item.icon] || LayoutDashboard;
    const isActive = activeSection === item.id;
    const panelStatus = item.id !== "overview" ? panelStatuses[item.id] : null;
    const dotColor = panelStatus ? STATUS_DOT[panelStatus] : null;

    return (
      <button
        key={item.id}
        onClick={() => { onNavigate(item.id); onClose(); }}
        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg mb-0.5 transition-all duration-150 text-left"
        style={{
          background: isActive ? "rgba(0,199,217,0.12)" : "transparent",
          border: isActive ? "1px solid rgba(0,199,217,0.25)" : "1px solid transparent",
        }}
      >
        <div
          className="flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center"
          style={{ background: isActive ? "rgba(0,199,217,0.2)" : "rgba(128,128,128,0.08)" }}
        >
          <IconComp size={12} style={{ color: isActive ? "#00C7D9" : theme.textMuted }} />
        </div>
        <span className="flex-1 truncate" style={{ color: isActive ? "#00C7D9" : theme.textSub, fontSize: "11px", fontWeight: isActive ? 600 : 400 }}>
          {item.label}
        </span>
        {dotColor && (
          <span
            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{
              background: dotColor,
              animation: panelStatus === "red" ? "pulseRed 1.5s ease-in-out infinite" : "none",
            }}
          />
        )}
      </button>
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
          {/* Overview */}
          {overview.map(renderItem)}

          {/* Grouped sections */}
          {Object.entries(grouped).map(([groupId, items]) => (
            <div key={groupId} className="mt-3">
              <div className="flex items-center gap-1.5 px-2 mb-1">
                <div className="w-1 h-3 rounded-full" style={{ background: GROUP_COLORS[groupId] }} />
                <span style={{ color: GROUP_COLORS[groupId], fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em" }}>
                  {GROUP_LABELS[groupId]}
                </span>
              </div>
              {items.map(renderItem)}
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
          <div className="text-xs font-bold" style={{ color: theme.text }}>上午班</div>
          <div className="text-xs mt-0.5" style={{ color: theme.textMuted }}>08:00 – 13:00</div>
          <div className="mt-2 flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#16A34A" }} />
            <span className="text-xs" style={{ color: "#4ade80", fontSize: "10px" }}>进行中</span>
          </div>
        </div>
      </aside>
    </>
  );
}