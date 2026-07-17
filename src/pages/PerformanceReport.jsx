import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useTheme, ThemeProvider } from "@/lib/ThemeContext";
import { useClinicId } from "@/lib/ClinicContext";
import PageShell from "@/components/PageShell";
import { Award, Loader, Trophy, TrendingUp, CheckCircle2, Brain } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

function monthKey(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * AI 效率评分推导：
 * - 基础分 60
 * - 完成率权重 +30
 * - 高优先级(P1/P2)完成额外 +10
 * - 异常(exception)状态 -10/条
 * - 截止 100 分
 */
function efficiencyScore(tasks) {
  const total = tasks.length;
  if (total === 0) return 0;
  const completed = tasks.filter((t) => t.status === "completed").length;
  const rate = completed / total;
  let score = 60 + rate * 30;
  const highPriDone = tasks.filter((t) => t.status === "completed" && (t.priority === "P1" || t.priority === "P2")).length;
  score += Math.min(highPriDone * 4, 10);
  const exceptions = tasks.filter((t) => t.status === "exception").length;
  score -= exceptions * 8;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function Inner() {
  const { theme } = useTheme();
  const clinicId = useClinicId();

  const staffQ = useQuery({
    queryKey: ["staff", clinicId, "perf"],
    queryFn: () => base44.entities.Staff.filter({ clinic_id: clinicId }, "-created_date", 100),
    refetchInterval: 30000,
  });
  const taskQ = useQuery({
    queryKey: ["tasks", clinicId, "perf"],
    queryFn: () => base44.entities.OperationalTask.filter({ clinic_id: clinicId }, "-created_date", 300),
    refetchInterval: 30000,
  });

  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const months = useMemo(() => {
    const set = new Set([month]);
    (taskQ.data || []).forEach((t) => { if (t.created_date) set.add(monthKey(t.created_date)); });
    return Array.from(set).sort().reverse().slice(0, 6);
  }, [taskQ.data, month]);

  const loading = staffQ.isLoading || taskQ.isLoading;
  const staff = staffQ.data || [];
  const tasks = taskQ.data || [];

  // 当月任务
  const monthTasks = useMemo(() => tasks.filter((t) => t.created_date && monthKey(t.created_date) === month), [tasks, month]);

  // 每员工绩效
  const perStaff = useMemo(() => {
    return staff.map((s) => {
      const mine = monthTasks.filter((t) => t.assignee_staff_id === s.id);
      const completed = mine.filter((t) => t.status === "completed").length;
      const total = mine.length;
      const rate = total ? Math.round((completed / total) * 100) : 0;
      const score = efficiencyScore(mine);
      const highPri = mine.filter((t) => (t.priority === "P1" || t.priority === "P2") && t.status === "completed").length;
      const exceptions = mine.filter((t) => t.status === "exception").length;
      const aiParsedCount = mine.filter((t) => t.ai_parsed && Object.keys(t.ai_parsed).length > 0).length;
      return { staff: s, total, completed, rate, score, highPri, exceptions, aiParsedCount };
    }).sort((a, b) => b.score - a.score);
  }, [staff, monthTasks]);

  // 图表数据：完成数对比
  const chartData = perStaff.filter((p) => p.total > 0).slice(0, 10).map((p) => ({
    name: p.staff.staff_name || "?",
    完成: p.completed,
    待办: p.total - p.completed,
  }));

  const axisColor = theme.textFaint;
  const gridColor = theme.borderSubtle;
  const tooltipStyle = { background: theme.chartTooltipBg, border: `1px solid ${theme.chartTooltipBorder}`, borderRadius: 8, fontSize: 11 };

  const medalColor = (i) => i === 0 ? "#fbbf24" : i === 1 ? "#CBD5E1" : i === 2 ? "#FB923C" : theme.textFaint;

  return (
    <PageShell icon={Award} title="工作绩效报告" subtitle={`${clinicId} · 月度任务完成 / AI 效率评分 / 关键贡献`} maxWidth="max-w-5xl">
      {loading ? (
        <div className="py-16 flex justify-center"><Loader className="animate-spin" style={{ color: theme.textSub }} /></div>
      ) : (
        <>
          {/* 月份选择 + 汇总 */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: theme.textSub }}>报告月份</span>
              <select value={month} onChange={(e) => setMonth(e.target.value)} className="text-sm rounded-lg px-3 py-2 outline-none" style={{ background: theme.canvas, border: `1px solid ${theme.border}`, color: theme.text }}>
                {months.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="ml-auto flex gap-2">
              <div className="rounded-lg px-3 py-2" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
                <div className="text-[10px]" style={{ color: theme.textSub }}>当月任务总数</div>
                <div className="text-lg font-bold" style={{ color: "#00C7D9" }}>{monthTasks.length}</div>
              </div>
              <div className="rounded-lg px-3 py-2" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
                <div className="text-[10px]" style={{ color: theme.textSub }}>完成数</div>
                <div className="text-lg font-bold" style={{ color: "#4ade80" }}>{monthTasks.filter((t) => t.status === "completed").length}</div>
              </div>
            </div>
          </div>

          {/* 排行榜 */}
          <div className="rounded-xl p-4 mb-4" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
            <div className="flex items-center gap-2 mb-3">
              <Trophy size={15} style={{ color: "#fbbf24" }} />
              <span className="text-sm font-bold" style={{ color: theme.text }}>员工效率排行（{month}）</span>
            </div>
            {perStaff.filter((p) => p.total > 0).length === 0 ? (
              <div className="py-8 text-center text-xs" style={{ color: theme.textFaint }}>本月暂无任务数据</div>
            ) : (
              <div className="space-y-2">
                {perStaff.filter((p) => p.total > 0).slice(0, 5).map((p, i) => (
                  <div key={p.staff.id} className="flex items-center gap-3 p-3 rounded-lg" style={{ background: theme.canvas, border: `1px solid ${theme.borderSubtle}` }}>
                    <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-sm" style={{ background: `${medalColor(i)}1a`, color: medalColor(i), border: `1px solid ${medalColor(i)}3d` }}>
                      {i + 1}
                    </div>
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(0,199,217,0.12)" }}>
                      <span className="text-xs font-bold" style={{ color: "#00C7D9" }}>{(p.staff.staff_name || "?").slice(0, 1)}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate" style={{ color: theme.text }}>{p.staff.staff_name}</div>
                      <div className="text-[10px]" style={{ color: theme.textSub }}>{p.staff.role} · 完成 {p.completed}/{p.total} · 完成率 {p.rate}%</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-lg font-bold" style={{ color: p.score >= 80 ? "#4ade80" : p.score >= 60 ? "#fbbf24" : "#f87171" }}>{p.score}</div>
                      <div className="text-[9px]" style={{ color: theme.textFaint }}>AI 效率分</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 图表 */}
          {chartData.length > 0 && (
            <div className="rounded-xl p-4 mb-4" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp size={15} style={{ color: "#00C7D9" }} />
                <span className="text-sm font-bold" style={{ color: theme.text }}>员工任务完成对比</span>
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="name" tick={{ fill: axisColor, fontSize: 10 }} />
                  <YAxis tick={{ fill: axisColor, fontSize: 10 }} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(0,199,217,0.05)" }} />
                  <Bar dataKey="完成" stackId="a" fill="#4ade80" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="待办" stackId="a" fill="#fbbf24" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* 全员明细 */}
          <div className="rounded-xl overflow-hidden" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
            <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: `1px solid ${theme.border}` }}>
              <CheckCircle2 size={15} style={{ color: "#4ade80" }} />
              <span className="text-sm font-bold" style={{ color: theme.text }}>全员绩效明细</span>
              <span className="text-[11px] ml-auto" style={{ color: theme.textFaint }}>{perStaff.length} 人</span>
            </div>
            {perStaff.length === 0 ? (
              <div className="p-6 text-center text-xs" style={{ color: theme.textFaint }}>暂无员工</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
                      <th className="text-left py-2 px-3" style={{ color: theme.textSub }}>员工</th>
                      <th className="text-center py-2 px-2" style={{ color: theme.textSub }}>任务数</th>
                      <th className="text-center py-2 px-2" style={{ color: theme.textSub }}>完成</th>
                      <th className="text-center py-2 px-2" style={{ color: theme.textSub }}>完成率</th>
                      <th className="text-center py-2 px-2" style={{ color: theme.textSub }}>高优完成</th>
                      <th className="text-center py-2 px-2" style={{ color: theme.textSub }}>异常</th>
                      <th className="text-center py-2 px-2" style={{ color: theme.textSub }}>AI解析</th>
                      <th className="text-center py-2 px-2" style={{ color: theme.textSub }}>效率分</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perStaff.map((p) => (
                      <tr key={p.staff.id} style={{ borderBottom: `1px solid ${theme.borderSubtle}` }}>
                        <td className="py-2.5 px-3">
                          <div className="text-sm font-semibold" style={{ color: theme.text }}>{p.staff.staff_name}</div>
                          <div className="text-[9px]" style={{ color: theme.textFaint }}>{p.staff.role}</div>
                        </td>
                        <td className="text-center py-2.5 px-2" style={{ color: theme.textSub }}>{p.total}</td>
                        <td className="text-center py-2.5 px-2" style={{ color: "#4ade80" }}>{p.completed}</td>
                        <td className="text-center py-2.5 px-2" style={{ color: theme.textSub }}>{p.rate}%</td>
                        <td className="text-center py-2.5 px-2" style={{ color: "#fbbf24" }}>{p.highPri}</td>
                        <td className="text-center py-2.5 px-2" style={{ color: p.exceptions ? "#f87171" : theme.textFaint }}>{p.exceptions}</td>
                        <td className="text-center py-2.5 px-2">
                          <span className="inline-flex items-center gap-1" style={{ color: "#A78BFA" }}>
                            <Brain size={10} />{p.aiParsedCount}
                          </span>
                        </td>
                        <td className="text-center py-2.5 px-2">
                          <span className="text-sm font-bold" style={{ color: p.score >= 80 ? "#4ade80" : p.score >= 60 ? "#fbbf24" : "#f87171" }}>{p.score}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </PageShell>
  );
}

export default function PerformanceReport() {
  return <ThemeProvider><Inner /></ThemeProvider>;
}