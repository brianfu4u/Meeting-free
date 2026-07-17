import { useTheme } from "@/lib/ThemeContext";
import { TASK_STATUS_LABELS } from "@/lib/staffPad/useStaffSelf";
import { CheckCircle2, Image as ImageIcon, FileText, Mic, Sparkles } from "lucide-react";

const ATT_ICON = { image: ImageIcon, file: FileText, voice: Mic };
const ATT_LABEL = { image: "照片", file: "文件", voice: "语音" };
const TYPE_META = {
  new_event: { label: "发起", color: "#FB923C" },
  progress: { label: "进展", color: "#00C7D9" },
  completion: { label: "核销", color: "#4ade80" },
};
const fmt = (d) => d ? new Date(d).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "--";

function Attachments({ atts, theme }) {
  if (!atts || atts.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {atts.map((a, i) => {
        const Icon = ATT_ICON[a.type] || FileText;
        if (a.type === "image") {
          return (
            <a key={i} href={a.url} target="_blank" rel="noreferrer" className="block">
              <img src={a.url} alt={a.name || ""} className="w-16 h-16 rounded-lg object-cover" style={{ border: `1px solid ${theme.border}` }} />
            </a>
          );
        }
        return (
          <div key={i} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5" style={{ background: theme.canvas, border: `1px solid ${theme.border}` }}>
            <Icon size={13} style={{ color: theme.textSub }} />
            <span className="text-[10px] truncate max-w-[120px]" style={{ color: theme.textSub }}>{a.name || ATT_LABEL[a.type]}</span>
          </div>
        );
      })}
    </div>
  );
}

function TimelineEntry({ log, isLast, theme }) {
  const meta = TYPE_META[log.type] || { label: log.type, color: "#94A3B8" };
  return (
    <div className="relative pb-5 last:pb-0">
      {!isLast && <div className="absolute left-[-15px] top-3 bottom-0 w-px" style={{ background: theme.border }} />}
      <div className="absolute left-[-19px] top-1 w-2.5 h-2.5 rounded-full" style={{ background: meta.color, border: `2px solid ${theme.cardBg}` }} />
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${meta.color}22`, color: meta.color }}>{meta.label}</span>
        <span className="text-[10px]" style={{ color: theme.textFaint }}>{fmt(log.timestamp)}</span>
        {log.staff_name && <span className="text-[10px]" style={{ color: theme.textFaint }}>· {log.staff_name}</span>}
      </div>
      {log.text && <div className="text-xs whitespace-pre-wrap leading-relaxed" style={{ color: theme.text }}>{log.text}</div>}
      <Attachments atts={log.attachments} theme={theme} />
      {log.parsed && log.parsed.summary && (
        <div className="mt-2 rounded-lg p-2 flex items-start gap-1.5" style={{ background: theme.canvas }}>
          <Sparkles size={11} style={{ color: "#A78BFA", marginTop: 1 }} />
          <div className="text-[10px] leading-relaxed" style={{ color: theme.textSub }}>
            <span style={{ color: "#A78BFA", fontWeight: 600 }}>AI：</span>{log.parsed.summary}
            {log.parsed.suggested_action && <span>｜建议：{log.parsed.suggested_action}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function HistoryDetail({ task }) {
  const { theme } = useTheme();
  if (!task) return null;

  // 事件流：优先 report_log；旧任务无 log 时用 report_attachments/ai_parsed 合成发起条目
  let logs = Array.isArray(task.report_log) && task.report_log.length
    ? task.report_log
    : ((task.report_attachments && task.report_attachments.length) || (task.ai_parsed && task.ai_parsed.summary))
      ? [{ type: "new_event", text: task.description, attachments: task.report_attachments || [], parsed: task.ai_parsed || {}, timestamp: task.created_date, staff_name: "" }]
      : [];

  const firstTs = logs[0]?.timestamp || task.created_date;
  const lastTs = logs[logs.length - 1]?.timestamp || task.updated_date;

  return (
    <div className="space-y-3">
      <div className="rounded-xl p-3" style={{ background: theme.cardBg, border: `1px solid ${theme.border}`, borderLeft: "3px solid #4ade80" }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "#94A3B822", color: "#94A3B8" }}>{task.priority}</span>
          <span className="text-[10px] flex items-center gap-1" style={{ color: "#4ade80" }}>
            <CheckCircle2 size={11} /> {TASK_STATUS_LABELS[task.status] || task.status}
          </span>
        </div>
        <div className="text-xs whitespace-pre-wrap leading-relaxed" style={{ color: theme.text }}>{task.description}</div>
      </div>

      <div className="flex items-center justify-between text-[11px] px-1" style={{ color: theme.textFaint }}>
        <span>起点 {fmt(firstTs)}</span>
        <span className="flex items-center gap-1">核销 {fmt(lastTs)}</span>
      </div>

      <div>
        <div className="text-xs font-bold mb-3" style={{ color: theme.textSub }}>事件流 · {logs.length} 条</div>
        {logs.length === 0 ? (
          <div className="text-xs rounded-lg p-4 text-center" style={{ color: theme.textFaint, background: theme.cardBg, border: `1px dashed ${theme.border}` }}>无事件流记录</div>
        ) : (
          <div className="relative pl-5">
            {logs.map((l, i) => (
              <TimelineEntry key={i} log={l} isLast={i === logs.length - 1} theme={theme} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}