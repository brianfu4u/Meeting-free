import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useTheme, ThemeProvider } from "@/lib/ThemeContext";
import { useClinicId } from "@/lib/ClinicContext";
import PageShell from "@/components/PageShell";
import { BarChart3, Loader, TrendingUp, Users, CheckCircle2, Clock } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from "recharts";
import { asList } from "@/hooks/useClinicData";

const LINE_LABEL = { optometry: "验光配镜", medical: "眼科医疗", vision_training: "视觉训练" };
const LINE_COLORS = { optometry: "#00C7D9", medical: "#A78BFA", vision_training: "#4ade80" };

function dayKey(d) {
  const dt = new Date(d);
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
}

function Inner() {
  const { theme } = useTheme();
  const clinicId = useClinicId();

  const revenueQ = useQuery({
    queryKey: ["analytics", "revenue", clinicId],
    queryFn: async () => asList(await base44.entities.RevenueRecord.filter({ clinic_id: clinicId }, "-recorded_at", 200)),
    refetchInterval: 30000,
  });
  const sessionQ = useQuery({
    queryKey: ["analytics", "sessions", clinicId],
    queryFn: async () => asList(await base44.entities.PatientSession.filter({ clinic_id: clinicId }, "-arrival_time", 200)),
    refetchInterval: 30000,
  });
  const taskQ = useQuery({
    queryKey: ["analytics", "tasks", clinicId],
    queryFn: async () => asList(await base44.entities.OperationalTask.filter({ clinic_id: clinicId }, "-created_date", 200)),
    refetchInterval: 30000,
  });

  const loading = revenueQ.isLoading || sessionQ.isLoading || taskQ.isLoading;
  const revenues = asList(revenueQ.data);
  const sessions = asList(sessionQ.data);
  const tasks = asList(taskQ.data);

  // 按日聚合营收（近 7 日）
  const revenueByDay = useMemo(() => {
    const map = {};
    revenues.forEach((r) => {
      if (!r.recorded_at) return;
      const k = dayKey(r.recorded_at);
      map[k] = (map[k] || 0) + (r.amount || 0);
    });
    return Object.entries(map).slice(-7).map(([day, amount]) => ({ day, amount: Math.round(amount) }));
  }, [revenues]);

  // 按业务线营收占比
  const revenueByLine = useMemo(() => {
    const map = {};
    revenues.forEach((r) => { map[r.business_line] = (map[r.business_line] || 0) + (r.amount || 0); });
    return Object.entries(map).map(([line, amount]) => ({ name: LINE_LABEL[line] || line, amount: Math.round(amount), line }));
  }, [revenues]);

  // 按日客流量
  const visitsByDay = useMemo(() => {
    const map = {};
    sessions.forEach((s) => {
      if (!s.arrival_time) return;
      const k = dayKey(s.arrival_time);
      map[k] = (map[k] || 0) + 1;
    });
    return Object.entries(map).slice(-7).map(([day, count]) => ({ day, count }));
  }, [sessions]);

  // 任务完成率
  const taskStats = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === "completed").length;
    const pending = tasks.filter((t) => t.status !== "completed").length;
    const rate = total ? Math.round((completed / total) * 100) : 0;
    return { total, completed, pending, rate };
  }, [tasks]);

  const sessionStatusPie = useMemo(() => {
    const map = {};
    sessions.forEach((s) => { map[s.status] = (map[s.status] || 0) + 1; });
    const labels = { arrived: "已到店", seated: "已就座", in_progress: "进行中", completed: "已完成", stalled: "卡滞" };
    return Object.entries(map).map(([k, v]) => ({ name: labels[k] || k, value: v }));
  }, [sessions]);

  const totalRevenue = revenues.reduce((s, r) => s + (r.amount || 0), 0);
  const axisColor = theme.textFaint;
  const gridColor = theme.borderSubtle;
  const tooltipStyle = { background: theme.chartTooltipBg, border: `1px solid ${theme.chartTooltipBorder}`, borderRadius: 8, fontSize: 11 };

  const Stat = ({ icon: I, label, value, sub, color }) => (
    <div className="rounded-xl p-3 flex items-center gap-3" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${color}1a` }}>
        <I size={16} style={{ color }} />
      </div>
      <div>
        <div className="text-xl font-bold" style={{ color }}>{value}</div>
        <div className="text-[10px] mt-0.5" style={{ color: theme.textSub }}>{label}</div>
        {sub && <div className="text-[9px]" style={{ color: theme.textFaint }}>{sub}</div>}
      </div>
    </div>
  );

  return (
    <PageShell icon={BarChart3} title="业务数据分析" subtitle={`${clinicId} · 营收 / 客流 / 任务效率 · 实时聚合`} maxWidth="max-w-6xl">
      {loading ? (
        <div className="py-16 flex justify-center"><Loader className="animate-spin" style={{ color: theme.textSub }} /></div>
      ) : (
        <>
          {/* 顶部指标 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Stat icon={TrendingUp} label="累计营收" value={`¥${totalRevenue.toLocaleString()}`} color="#00C7D9" />
            <Stat icon={Users} label="累计客流" value={sessions.length} color="#A78BFA" />
            <Stat icon={CheckCircle2} label="任务完成率" value={`${taskStats.rate}%`} sub={`${taskStats.completed}/${taskStats.total}`} color="#4ade80" />
            <Stat icon={Clock} label="待办任务" value={taskStats.pending} color="#fbbf24" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            {/* 营收趋势 */}
            <div className="rounded-xl p-4" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
              <div className="text-sm font-bold mb-3" style={{ color: theme.text }}>近 7 日营收趋势</div>
              {revenueByDay.length === 0 ? (
                <div className="py-10 text-center text-xs" style={{ color: theme.textFaint }}>暂无营收记录</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={revenueByDay}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                    <XAxis dataKey="day" tick={{ fill: axisColor, fontSize: 10 }} />
                    <YAxis tick={{ fill: axisColor, fontSize: 10 }} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(0,199,217,0.05)" }} />
                    <Bar dataKey="amount" name="营收(元)" fill="#00C7D9" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* 客流量趋势 */}
            <div className="rounded-xl p-4" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
              <div className="text-sm font-bold mb-3" style={{ color: theme.text }}>近 7 日客流量</div>
              {visitsByDay.length === 0 ? (
                <div className="py-10 text-center text-xs" style={{ color: theme.textFaint }}>暂无到店记录</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={visitsByDay}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                    <XAxis dataKey="day" tick={{ fill: axisColor, fontSize: 10 }} />
                    <YAxis tick={{ fill: axisColor, fontSize: 10 }} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Line type="monotone" dataKey="count" name="客流(人)" stroke="#A78BFA" strokeWidth={2} dot={{ r: 3, fill: "#A78BFA" }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* 业务线营收占比 */}
            <div className="rounded-xl p-4" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
              <div className="text-sm font-bold mb-3" style={{ color: theme.text }}>业务线营收占比</div>
              {revenueByLine.length === 0 ? (
                <div className="py-10 text-center text-xs" style={{ color: theme.textFaint }}>暂无营收记录</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={revenueByLine} dataKey="amount" nameKey="name" cx="50%" cy="50%" outerRadius={75} innerRadius={40}>
                      {revenueByLine.map((e) => <Cell key={e.line} fill={LINE_COLORS[e.line] || "#94A3B8"} />)}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 11, color: theme.textSub }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* 就诊会话状态分布 */}
            <div className="rounded-xl p-4" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
              <div className="text-sm font-bold mb-3" style={{ color: theme.text }}>就诊会话状态分布</div>
              {sessionStatusPie.length === 0 ? (
                <div className="py-10 text-center text-xs" style={{ color: theme.textFaint }}>暂无会话</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={sessionStatusPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} innerRadius={40}>
                      {sessionStatusPie.map((_, i) => <Cell key={i} fill={["#00C7D9", "#A78BFA", "#4ade80", "#fbbf24", "#f87171"][i % 5]} />)}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 11, color: theme.textSub }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </>
      )}
    </PageShell>
  );
}

export default function AnalyticsDashboard() {
  return <ThemeProvider><Inner /></ThemeProvider>;
}