import { useTheme } from "@/lib/ThemeContext";
import { TASK_STATUS_LABELS } from "@/lib/staffPad/useStaffSelf";
import { CheckCircle2, Clock, Image as ImageIcon, FileText, Mic, Sparkles } from "lucide-react";

const ATT_ICON = { image: ImageIcon, file: FileText, voice: Mic };
const ATT_LABEL = { image: "照片", file: "文件", voice: "语音" };
const fmt = (d) => d ? new Date(d).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "--";

function Row({ label, value, theme }) {
  return (
    <div className="flex gap-2">
      <span className="text-[11px] flex-shrink-0" style={{ color: theme.textFaint }}>{label}</span>
      <span className="text-[11px]" style={{ color: theme.text }}>{value || "—"}</span>
    </div>
  );
}

export default function HistoryDetail({ task }) {
  const { theme } = useTheme();
  if (!task) return null;
  const atts = Array.isArray(task.report_attachments) ? task.report_attachments : [];
  const ai = task.ai_parsed || {};
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
        <span>发起 {fmt(task.created_date)}</span>
        <span className="flex items-center gap-1"><Clock size={11} /> 核销 {fmt(task.updated_date)}</span>
      </div>

      {atts.length > 0 && (
        <div>
          <div className="text-xs font-bold mb-2" style={{ color: theme.textSub }}>附件 · {atts.length}</div>
          <div className="space-y-2">
            {atts.map((a, i) => {
              const Icon = ATT_ICON[a.type] || FileText;
              return (
                <div key={i} className="rounded-xl p-2.5" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
                  <div className="flex items-center gap-2 mb-1.5">
                    {a.type === "image" ? (
                      <img src={a.url} alt="" className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(148,163,184,0.1)" }}>
                        <Icon size={18} style={{ color: theme.textSub }} />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs truncate" style={{ color: theme.text }}>{a.name || ATT_LABEL[a.type]}</div>
                      <div className="text-[10px]" style={{ color: theme.textFaint }}>{ATT_LABEL[a.type] || a.type}</div>
                    </div>
                    {a.type === "image" && (
                      <a href={a.url} target="_blank" rel="noreferrer" className="text-[10px] flex-shrink-0" style={{ color: "#00C7D9" }}>查看原图</a>
                    )}
                  </div>
                  {a.type === "voice" && a.transcript && (
                    <div className="text-[11px] rounded-lg p-2 leading-relaxed" style={{ background: theme.canvas, color: theme.textSub }}>{a.transcript}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {ai.summary && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Sparkles size={12} style={{ color: "#A78BFA" }} />
            <span className="text-xs font-bold" style={{ color: "#A78BFA" }}>AI 语意解析</span>
          </div>
          <div className="rounded-xl p-3 space-y-1.5" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
            <Row label="分类" value={ai.category} theme={theme} />
            <Row label="紧急" value={ai.urgency === "red" ? "红色" : ai.urgency === "yellow" ? "黄色" : "—"} theme={theme} />
            <Row label="摘要" value={ai.summary} theme={theme} />
            {ai.suggested_action && <Row label="建议" value={ai.suggested_action} theme={theme} />}
          </div>
        </div>
      )}
    </div>
  );
}