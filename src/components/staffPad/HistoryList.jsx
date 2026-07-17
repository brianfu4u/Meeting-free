import { useTheme } from "@/lib/ThemeContext";
import { TASK_STATUS_LABELS } from "@/lib/staffPad/useStaffSelf";
import { CheckCircle2, Clock } from "lucide-react";

const fmt = (d) =>
  d ? new Date(d).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "--";

export default function HistoryList({ items, onSelect }) {
  const { theme } = useTheme();
  if (items.length === 0) {
    return (
      <div className="text-xs rounded-lg p-6 text-center" style={{ color: theme.textFaint, background: theme.cardBg, border: `1px dashed ${theme.border}` }}>
        暂无已核销记录
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((t) => (
        <button key={t.id} onClick={() => onSelect?.(t)} className="w-full text-left rounded-xl p-3 transition-all active:scale-[0.98]" style={{ background: theme.cardBg, border: `1px solid ${theme.border}`, borderLeft: "3px solid #4ade80", opacity: 0.9 }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: `#94A3B822`, color: "#94A3B8" }}>{t.priority}</span>
            <span className="text-[10px] flex items-center gap-1" style={{ color: "#4ade80" }}>
              <CheckCircle2 size={11} /> {TASK_STATUS_LABELS[t.status] || t.status}
            </span>
          </div>
          <div className="text-xs leading-snug mb-1.5 overflow-hidden" style={{ color: theme.text, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
            {t.description}
          </div>
          <div className="flex items-center justify-between text-[10px]" style={{ color: theme.textFaint }}>
            <span>发起 {fmt(t.created_date)}</span>
            <span className="flex items-center gap-1"><Clock size={10} /> 核销 {fmt(t.updated_date)}</span>
          </div>
        </button>
      ))}
    </div>
  );
}