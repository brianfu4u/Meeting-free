import { useTheme } from "@/lib/ThemeContext";
import { TASK_STATUS_LABELS } from "@/lib/staffPad/useStaffSelf";
import { Clock, User, Stethoscope, MessageSquare, CheckCircle2 } from "lucide-react";

function InfoRow({ icon: Icon, label, value, theme }) {
  return (
    <div className="flex items-start gap-2 py-2" style={{ borderBottom: `1px solid ${theme.border}` }}>
      <Icon size={14} style={{ color: theme.textFaint, marginTop: "2px" }} />
      <div className="flex-1 min-w-0">
        <div className="text-[10px]" style={{ color: theme.textFaint }}>{label}</div>
        <div className="text-xs break-words" style={{ color: theme.textSub }}>{value || "—"}</div>
      </div>
    </div>
  );
}

export default function TaskDetail({ task, onProgress, onComplete }) {
  const { theme } = useTheme();
  const isPri = task.priority === "P1" || task.priority === "P2";

  return (
    <div className="rounded-2xl p-4" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] font-bold px-2 py-0.5 rounded"
          style={{ background: isPri ? "rgba(248,113,113,0.15)" : "rgba(148,163,184,0.15)", color: isPri ? "#f87171" : "#94A3B8" }}>
          {task.priority}
        </span>
        <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: "rgba(0,199,217,0.12)", color: "#00C7D9" }}>
          {TASK_STATUS_LABELS[task.status] || task.status}
        </span>
      </div>

      <div className="text-sm font-bold mb-1" style={{ color: theme.text }}>任务描述</div>
      <div className="text-sm leading-relaxed mb-4" style={{ color: theme.textSub }}>{task.description}</div>

      <div className="rounded-xl px-3 mb-5" style={{ background: theme.canvas }}>
        <InfoRow icon={User} label="指派员工" value={task.assignee_staff_id || "未指派"} theme={theme} />
        <InfoRow icon={Clock} label="截止时间" value={task.due_time ? new Date(task.due_time).toLocaleString("zh-CN") : "未设置"} theme={theme} />
        <InfoRow icon={Stethoscope} label="关联患者会话" value={task.patient_session_id || "无"} theme={theme} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={onProgress}
          className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all active:scale-95"
          style={{ background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.4)", color: "#60a5fa" }}>
          <MessageSquare size={15} /> 进度汇报
        </button>
        <button onClick={onComplete}
          className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all active:scale-95"
          style={{ background: "linear-gradient(135deg,#16A34A,#15803D)", color: "#fff" }}>
          <CheckCircle2 size={15} /> 完成提交
        </button>
      </div>
    </div>
  );
}