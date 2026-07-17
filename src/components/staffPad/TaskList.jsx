import { useTheme } from "@/lib/ThemeContext";
import { TASK_STATUS_LABELS } from "@/lib/staffPad/useStaffSelf";
import { Flag } from "lucide-react";

function Column({ title, tasks, accent, onSelect, theme }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Flag size={12} style={{ color: accent }} />
        <span className="text-xs font-bold" style={{ color: accent }}>{title}</span>
        <span className="text-xs" style={{ color: theme.textFaint }}>{tasks.length}</span>
      </div>
      <div className="space-y-2">
        {tasks.length === 0 && (
          <div className="text-xs rounded-lg p-3 text-center" style={{ color: theme.textFaint, background: theme.cardBg, border: `1px dashed ${theme.border}` }}>
            暂无任务
          </div>
        )}
        {tasks.map((t) => (
          <button key={t.id} onClick={() => onSelect(t)}
            className="w-full text-left rounded-xl p-3 transition-all active:scale-[0.98]"
            style={{ background: theme.cardBg, border: `1px solid ${theme.border}`, borderLeft: `3px solid ${accent}` }}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${accent}22`, color: accent }}>{t.priority}</span>
              <span className="text-[10px]" style={{ color: theme.textFaint }}>{TASK_STATUS_LABELS[t.status] || t.status}</span>
            </div>
            <div className="text-xs leading-snug overflow-hidden mb-1" style={{ color: theme.text, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
              {t.description}
            </div>
            <div className="text-[10px]" style={{ color: theme.textFaint }}>
              {t.created_date ? new Date(t.created_date).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "--:--"} 发起
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function TaskList({ priority, normal, onSelect }) {
  const { theme } = useTheme();
  return (
    <div className="grid grid-cols-2 gap-3">
      <Column title="优先级" tasks={priority} accent="#f87171" onSelect={onSelect} theme={theme} />
      <Column title="普通级" tasks={normal} accent="#94A3B8" onSelect={onSelect} theme={theme} />
    </div>
  );
}