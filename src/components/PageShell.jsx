import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useTheme } from "@/lib/ThemeContext";

/**
 * 通用页面外壳：固定顶栏（返回看板 + 标题）+ 居中内容区。
 * 子页需自行包裹 ThemeProvider。
 */
export default function PageShell({ icon: Icon, iconColor = "#00C7D9", title, subtitle, children, maxWidth = "max-w-5xl" }) {
  const { theme } = useTheme();
  return (
    <div className="min-h-screen" style={{ background: theme.canvas }}>
      <header
        className="fixed top-0 left-0 right-0 z-40 flex items-center gap-3 px-4 h-14"
        style={{ background: theme.topbar, borderBottom: `1px solid ${theme.borderSubtle}` }}
      >
        <Link to="/" className="p-1.5 rounded-lg" style={{ background: "rgba(255,255,255,0.04)" }}>
          <ArrowLeft size={16} style={{ color: theme.textSub }} />
        </Link>
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: `${iconColor}1a`, border: `1px solid ${iconColor}3d` }}
        >
          <Icon size={15} style={{ color: iconColor }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold" style={{ color: theme.text }}>{title}</div>
          {subtitle && <div className="text-[11px] truncate" style={{ color: theme.textMuted }}>{subtitle}</div>}
        </div>
      </header>
      <div className={`pt-16 px-4 pb-10 ${maxWidth} mx-auto`}>{children}</div>
    </div>
  );
}