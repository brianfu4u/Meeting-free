import React from "react";
import {
  LayoutDashboard,
  Users,
  Stethoscope,
  AlertTriangle,
  Zap,
  UserCheck,
  CircleDollarSign,
  Package,
  TrendingUp,
  Server,
} from "lucide-react";

const ICON_MAP = {
  LayoutDashboard,
  Users,
  Stethoscope,
  AlertTriangle,
  Zap,
  UserCheck,
  CircleDollarSign,
  Package,
  TrendingUp,
  Server,
};

const STATUS_DOT = {
  green: "#16A34A",
  amber: "#D97706",
  red: "#DC2626",
};

export default function Sidebar({ navItems, activeSection, onNavigate, panelStatuses, isOpen, onClose }) {
  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 md:hidden"
          style={{ background: "rgba(0,0,0,0.7)" }}
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-14 bottom-0 left-0 z-40 flex flex-col transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
        style={{
          width: "200px",
          background: "rgba(13, 27, 42, 0.98)",
          borderRight: "1px solid #1E3352",
          backdropFilter: "blur(12px)",
        }}
      >
        <div className="flex-1 overflow-y-auto py-3 px-2">
          {navItems.map((item) => {
            const IconComp = ICON_MAP[item.icon] || LayoutDashboard;
            const isActive = activeSection === item.id;
            const panelStatus = item.id !== "overview" ? panelStatuses[item.id] : null;
            const dotColor = panelStatus ? STATUS_DOT[panelStatus] : null;

            return (
              <button
                key={item.id}
                onClick={() => {
                  onNavigate(item.id);
                  onClose();
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg mb-0.5 transition-all duration-150 text-left group"
                style={{
                  background: isActive ? "rgba(0, 199, 217, 0.12)" : "transparent",
                  border: isActive ? "1px solid rgba(0, 199, 217, 0.25)" : "1px solid transparent",
                }}
              >
                <div
                  className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
                  style={{
                    background: isActive ? "rgba(0, 199, 217, 0.2)" : "rgba(255,255,255,0.05)",
                  }}
                >
                  <IconComp
                    size={14}
                    style={{ color: isActive ? "#00C7D9" : "#64748B" }}
                  />
                </div>
                <span
                  className="flex-1 text-xs font-medium truncate"
                  style={{ color: isActive ? "#00C7D9" : "#94A3B8" }}
                >
                  {item.label}
                </span>
                {dotColor && (
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{
                      background: dotColor,
                      boxShadow: `0 0 0 0 ${dotColor}`,
                      animation: panelStatus === "red" ? "pulseRed 1.5s ease-in-out infinite" : "none",
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Bottom shift info */}
        <div
          className="mx-2 mb-3 p-3 rounded-lg"
          style={{ background: "rgba(0, 199, 217, 0.06)", border: "1px solid rgba(0, 199, 217, 0.12)" }}
        >
          <div className="text-xs font-semibold mb-1.5" style={{ color: "#00C7D9", fontSize: "10px", letterSpacing: "0.05em" }}>
            当前班次
          </div>
          <div className="text-xs" style={{ color: "#F1F5F9", fontWeight: 600 }}>
            上午班
          </div>
          <div className="text-xs mt-0.5" style={{ color: "#64748B" }}>
            08:00 – 13:00
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#16A34A" }} />
            <span className="text-xs" style={{ color: "#4ade80", fontSize: "10px" }}>
              进行中
            </span>
          </div>
        </div>
      </aside>
    </>
  );
}