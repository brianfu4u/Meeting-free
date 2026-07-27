import React, { useEffect } from "react";
import { X } from "lucide-react";
import { useTheme } from "@/lib/ThemeContext";

/**
 * 通用店长工作区抽屉：承载需要操作或查看历史的完整面板。
 * 首页仅展示当天只读摘要，点击侧边栏入口后由此抽屉打开完整视图。
 */
export default function ManagerPanelDrawer({ title, subtitle, icon: Icon, accent = "#A78BFA", onClose, children }) {
  const { theme } = useTheme();

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

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
          width: "min(560px, 100vw)",
          background: theme.drawerBg,
          borderLeft: `1px solid ${theme.borderSubtle}`,
          boxShadow: "-8px 0 40px rgba(0,0,0,0.3)",
        }}
      >
        <div
          className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: `1px solid ${theme.borderSubtle}`, background: theme.drawerHeader }}
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: `${accent}1a`, border: `1px solid ${accent}33` }}>
              {Icon && <Icon size={17} style={{ color: accent }} />}
            </div>
            <div>
              <div className="text-base font-bold" style={{ color: theme.text }}>{title}</div>
              <div className="text-xs" style={{ color: theme.textMuted }}>{subtitle || "店长工作区 · 操作与历史"}</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
            style={{ background: "rgba(128,128,128,0.1)" }}
          >
            <X size={16} style={{ color: theme.textSub }} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </>
  );
}