import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useTheme, ThemeProvider } from "@/lib/ThemeContext";
import { useStaffSelf, ROLE_LABELS, STAFF_STATUS_LABELS, STAFF_STATUS_COLORS } from "@/lib/staffPad/useStaffSelf";
import { useOperationalTasks, asList } from "@/hooks/useClinicData";
import { isToday } from "@/lib/clinicDate";
import { DEPARTMENT_BY_ID, ROLE_TO_DEPARTMENT } from "@/lib/departments/registry";
import BindingScreen from "@/components/staffPad/BindingScreen";
import ClockBar from "@/components/staffPad/ClockBar";
import TaskList from "@/components/staffPad/TaskList";
import TaskDetail from "@/components/staffPad/TaskDetail";
import ReportSheet from "@/components/staffPad/ReportSheet";
import HistoryList from "@/components/staffPad/HistoryList";
import HistoryDetail from "@/components/staffPad/HistoryDetail";
import { Loader, LogIn, LogOut, ArrowLeft, Plus, Activity, Search, ChevronDown, Check } from "lucide-react";

function StaffPadInner() {
  const { theme } = useTheme();
  const { user, staff, staffList, loading, refresh, clinicId, switchStaff } = useStaffSelf();
  const tasksQ = useOperationalTasks();
  const qc = useQueryClient();
  const [view, setView] = useState("home");
  const [showStaffPicker, setShowStaffPicker] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState(null);
  const [sheet, setSheet] = useState({ open: false, mode: "new_event", taskId: null });
  const [histRange, setHistRange] = useState(() => {
    const toL = (d) => { const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, "0"); const da = String(d.getDate()).padStart(2, "0"); return `${y}-${m}-${da}`; };
    const end = new Date(); const start = new Date(); start.setDate(end.getDate() - 6);
    return { start: toL(start), end: toL(end) };
  });
  const [histMode, setHistMode] = useState("range");
  const [histKeyword, setHistKeyword] = useState("");

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: theme.canvas }}>
        <Loader className="animate-spin" size={28} style={{ color: theme.textSub }} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6" style={{ background: theme.canvas }}>
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: "rgba(0,199,217,0.15)", border: "1px solid rgba(0,199,217,0.35)" }}>
          <Activity size={26} style={{ color: "#00C7D9" }} />
        </div>
        <div className="text-base font-bold" style={{ color: theme.text }}>员工终端</div>
        <div className="text-xs" style={{ color: theme.textMuted }}>请先登录以绑定终端身份</div>
        <button onClick={() => base44.auth.redirectToLogin("/staff-pad")}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold"
          style={{ background: "linear-gradient(135deg,#00C7D9,#00A8BD)", color: "#0D1B2A" }}>
          <LogIn size={15} /> 手机登录
        </button>
      </div>
    );
  }

  if (!staff) return <BindingScreen user={user} onBound={refresh} />;

  // V10 今日焦点：todo 只展示当日任务；历史未完成单独入口可查看
  const taskList = asList(tasksQ.data);
  const allUnfinished = taskList.filter(
    (t) => t.assignee_staff_id === staff.id && !["completed", "exception"].includes(t.status)
  );
  const todayTodo = allUnfinished.filter((t) => isToday(t.created_date));
  const historyUnfinished = allUnfinished.filter((t) => !isToday(t.created_date));
  const priority = todayTodo.filter((t) => t.priority === "P1" || t.priority === "P2");
  const normal = todayTodo.filter((t) => t.priority === "P3" || t.priority === "P4");
  const activeTask = taskList.find((t) => t.id === activeTaskId);
  const history = taskList
    .filter((t) => t.assignee_staff_id === staff.id && ["completed", "exception"].includes(t.status))
    .sort((a, b) => new Date(b.updated_date) - new Date(a.updated_date));
  const historyAll = [...history, ...historyUnfinished].sort(
    (a, b) => new Date(b.updated_date || b.created_date) - new Date(a.updated_date || a.created_date)
  );
  const toLocalDate = (d) => { const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, "0"); const da = String(d.getDate()).padStart(2, "0"); return `${y}-${m}-${da}`; };
  const todayStr = toLocalDate(new Date());
  const minDateStr = (() => { const d = new Date(); d.setDate(d.getDate() - 29); return toLocalDate(d); })();
  const filteredHistory = historyAll.filter((t) => {
    if (!t.created_date) return false;
    const d = new Date(t.created_date);
    const inRange = d >= new Date(histRange.start + "T00:00:00") && d <= new Date(histRange.end + "T23:59:59");
    if (!inRange) return false;
    if (histKeyword.trim()) {
      const kw = histKeyword.trim().toLowerCase();
      const hay = [t.description, t.ai_parsed?.summary, t.ai_parsed?.category, t.ai_parsed?.suggested_action, t.priority].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["staff"] });
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: theme.canvas }}>
      <header className="flex items-center gap-3 px-4 py-3 flex-shrink-0" style={{ borderBottom: `1px solid ${theme.border}` }}>
        {view !== "home" && (
          <button onClick={() => setView("home")} className="p-1.5 rounded-lg" style={{ background: "rgba(255,255,255,0.04)" }}>
            <ArrowLeft size={16} style={{ color: theme.textSub }} />
          </button>
        )}
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "rgba(0,199,217,0.15)", border: "1px solid rgba(0,199,217,0.35)" }}>
          <Activity size={17} style={{ color: "#00C7D9" }} />
        </div>
        <div className="flex-1 min-w-0 relative">
          {view === "home" && staffList.length > 1 ? (
            <button onClick={() => setShowStaffPicker((v) => !v)}
              className="flex items-center gap-1 text-sm font-bold truncate max-w-full"
              style={{ color: theme.text }}>
              <span className="truncate">{staff.staff_name} · {ROLE_LABELS[staff.role] || staff.role}</span>
              <ChevronDown size={14} style={{ color: theme.textSub, flexShrink: 0 }} />
            </button>
          ) : (
            <div className="text-sm font-bold truncate" style={{ color: theme.text }}>
              {view === "history" ? "历史记录" : view === "historyDetail" ? "历史详情" : view === "task" ? "任务详情" : `${staff.staff_name} · ${ROLE_LABELS[staff.role] || staff.role}`}
            </div>
          )}
          {view === "home" && (
            <div className="text-xs truncate" style={{ color: theme.textMuted }}>
              {clinicId} · {DEPARTMENT_BY_ID[staff.department_id || ROLE_TO_DEPARTMENT[staff.role]]?.name || "未分配部门"}
            </div>
          )}
          {showStaffPicker && view === "home" && staffList.length > 1 && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowStaffPicker(false)} />
              <div className="absolute top-full left-0 mt-1 rounded-xl py-1 z-50 min-w-[200px]"
                style={{ background: theme.cardBg, border: `1px solid ${theme.border}`, boxShadow: "0 8px 30px rgba(0,0,0,0.4)" }}>
                {staffList.map((s) => {
                  const active = s.id === staff.id;
                  return (
                    <button key={s.id} onClick={() => { switchStaff(s.id); setShowStaffPicker(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs"
                      style={{ background: active ? "rgba(0,199,217,0.08)" : "transparent" }}>
                      <span className="flex-1 truncate" style={{ color: active ? "#00C7D9" : theme.text }}>
                        {s.staff_name} · {ROLE_LABELS[s.role] || s.role}
                      </span>
                      {active && <Check size={12} style={{ color: "#00C7D9", flexShrink: 0 }} />}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
        <span className="text-[10px] px-2 py-1 rounded-full font-semibold flex-shrink-0"
          style={{ background: `${STAFF_STATUS_COLORS[staff.status]}22`, color: STAFF_STATUS_COLORS[staff.status] }}>
          {STAFF_STATUS_LABELS[staff.status] || staff.status}
        </span>
        <button onClick={() => base44.auth.logout(window.location.href)}
          title="退出登录"
          className="p-1.5 rounded-lg flex-shrink-0"
          style={{ background: "rgba(255,255,255,0.04)" }}>
          <LogOut size={15} style={{ color: theme.textSub }} />
        </button>
      </header>

      {view === "home" && (
        <>
          <div className="p-4 flex-shrink-0">
            <ClockBar staff={staff} clinicId={clinicId} onChanged={refresh} />
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-28">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-bold" style={{ color: theme.textSub }}>工作清单</div>
              <div className="flex items-center gap-2">
                {historyUnfinished.length > 0 && (
                  <button onClick={() => setView("history")} className="text-[11px] px-2 py-1 rounded-lg flex items-center gap-1" style={{ color: "#fbbf24", background: "rgba(217,119,6,0.12)", border: "1px solid rgba(217,119,6,0.25)" }}>
                    历史未完成 · {historyUnfinished.length}
                  </button>
                )}
                <button onClick={() => setView("history")} className="text-[11px] px-2 py-1 rounded-lg flex items-center gap-1" style={{ color: "#4ade80", background: "rgba(22,163,74,0.12)", border: "1px solid rgba(22,163,74,0.25)" }}>
                  历史 · {history.length}
                </button>
              </div>
            </div>
            <TaskList priority={priority} normal={normal}
              onSelect={(t) => { setActiveTaskId(t.id); setView("task"); }} />
          </div>
          <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-30">
            <button onClick={() => setSheet({ open: true, mode: "new_event", taskId: null })}
              className="flex items-center gap-2 px-6 py-3.5 rounded-full text-sm font-bold transition-all active:scale-95"
              style={{ background: "linear-gradient(135deg,#FB923C,#F97316)", color: "#0D1B2A", boxShadow: "0 6px 24px rgba(251,146,60,0.4)" }}>
              <Plus size={18} /> 发起新事件
            </button>
          </div>
        </>
      )}

      {view === "task" && activeTask && (
        <div className="flex-1 overflow-y-auto p-4">
          <TaskDetail task={activeTask}
            onProgress={() => setSheet({ open: true, mode: "progress", taskId: activeTask.id })}
            onComplete={() => setSheet({ open: true, mode: "completion", taskId: activeTask.id })} />
        </div>
      )}

      {view === "history" && (
        <div className="flex-1 overflow-y-auto p-4 pb-28">
          <div className="text-xs font-bold mb-2" style={{ color: theme.textSub }}>历史记录</div>
          <div className="space-y-2 mb-3">
            <div className="flex items-center gap-1.5">
              {["range", "day"].map((m) => (
                <button key={m} onClick={() => setHistMode(m)}
                  className="text-[11px] px-2.5 py-1 rounded-lg font-semibold transition-all"
                  style={histMode === m ? { background: "rgba(0,199,217,0.15)", color: "#00C7D9", border: "1px solid rgba(0,199,217,0.4)" } : { background: theme.cardBg, color: theme.textSub, border: `1px solid ${theme.border}` }}>
                  {m === "range" ? "时间段" : "单日"}
                </button>
              ))}
              <span className="text-[10px] ml-auto" style={{ color: theme.textFaint }}>共 {filteredHistory.length} 条</span>
            </div>
            {histMode === "range" ? (
              <div className="flex items-center gap-2 flex-wrap">
                <input type="date" value={histRange.start} min={minDateStr} max={histRange.end}
                  onChange={(e) => setHistRange((p) => ({ ...p, start: e.target.value }))}
                  className="text-xs rounded-lg px-2 py-1.5 outline-none" style={{ background: theme.cardBg, border: `1px solid ${theme.border}`, color: theme.text }} />
                <span className="text-xs" style={{ color: theme.textFaint }}>~</span>
                <input type="date" value={histRange.end} min={histRange.start} max={todayStr}
                  onChange={(e) => setHistRange((p) => ({ ...p, end: e.target.value }))}
                  className="text-xs rounded-lg px-2 py-1.5 outline-none" style={{ background: theme.cardBg, border: `1px solid ${theme.border}`, color: theme.text }} />
                <span className="text-[10px]" style={{ color: theme.textFaint }}>最多30天</span>
              </div>
            ) : (
              <input type="date" value={histRange.start} min={minDateStr} max={todayStr}
                onChange={(e) => setHistRange({ start: e.target.value, end: e.target.value })}
                className="text-xs rounded-lg px-2 py-1.5 outline-none" style={{ background: theme.cardBg, border: `1px solid ${theme.border}`, color: theme.text }} />
            )}
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: theme.textFaint }} />
              <input type="text" value={histKeyword} onChange={(e) => setHistKeyword(e.target.value)} placeholder="搜索关键字（描述/摘要/分类/优先级）"
                className="w-full text-xs rounded-lg pl-7 pr-2 py-1.5 outline-none" style={{ background: theme.cardBg, border: `1px solid ${theme.border}`, color: theme.text }} />
            </div>
          </div>
          <HistoryList items={filteredHistory} onSelect={(t) => { setActiveTaskId(t.id); setView("historyDetail"); }} />
        </div>
      )}

      {view === "historyDetail" && history.find((t) => t.id === activeTaskId) && (
        <div className="flex-1 overflow-y-auto p-4 pb-28">
          <HistoryDetail task={history.find((t) => t.id === activeTaskId)} />
        </div>
      )}

      <ReportSheet open={sheet.open} mode={sheet.mode} taskId={sheet.taskId} staff={staff} clinicId={clinicId}
        onClose={() => setSheet((s) => ({ ...s, open: false }))}
        onSubmitted={invalidate} />
    </div>
  );
}

export default function StaffPad() {
  return (
    <ThemeProvider>
      <StaffPadInner />
    </ThemeProvider>
  );
}