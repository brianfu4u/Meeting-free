/**
 * Clinic OS V10 — 日结复盘面板（Daily Review Summary）
 *
 * 看板内紧凑组件，供店长下班前一键查看当日总览：
 * - 今日营收（RevenueRecord 当日合计，环比昨日）
 * - 今日客流（PatientSession 当日到店数，环比昨日）
 * - 任务完成率（OperationalTask 当日 completed/total）
 * - AI 辅助任务占比（当日带 ai_parsed 的任务）
 * - 一句话 AI 总结（基于上述指标自动生成）+ 跳转每日复盘页
 */

import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useTheme } from "@/lib/ThemeContext";
import {
  ClipboardCheck, TrendingUp, TrendingDown, Users, Wallet,
  CheckCircle2, Brain, ChevronRight, Loader,
} from "lucide-react";
import { asList, CLINIC_ID } from "@/hooks/useClinicData";

function sameDay(a, b) {
  const d1 = new Date(a), d2 = new Date(b);
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}
function isYesterday(a, ref) {
  const d1 = new Date(a);
  const y = new Date(ref);
  y.setDate(y.getDate() - 1);
  return d1.getFullYear() === y.getFullYear() && d1.getMonth() === y.getMonth() && d1.getDate() === y.getDate();
}

function Trend({ today, yesterday, unit = "", invert = false }) {
  const { theme } = useTheme();
  if (yesterday == null || yesterday === 0) {
    return <span className="text-[10px]" style={{ color: theme.textFaint }}>无昨日数据</span>;
  }
  const diff = today - yesterday;
  const pct = Math.round((diff / yesterday) * 100);
  const up = diff >= 0;
  // invert: 越低越好（如待办）。默认越高越好
  const good = invert ? !up : up;
  const color = good ? "#4ade80" : "#f87171";
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px]" style={{ color }}>
      <Icon size={11} />
      {up ? "+" : ""}{pct}%{unit}
    </span>
  );
}

function Inner() {
  const { theme } = useTheme();
  const now = new Date();

  const revQ = useQuery({
    queryKey: ["dailyReview", "revenue", CLINIC_ID],
    queryFn: async () => asList(await base44.entities.RevenueRecord.filter({ clinic_id: CLINIC_ID }, "-recorded_at", 200)),
    refetchInterval: 30000,
  });
  const sessQ = useQuery({
    queryKey: ["dailyReview", "sessions", CLINIC_ID],
    queryFn: async () => asList(await base44.entities.PatientSession.filter({ clinic_id: CLINIC_ID }, "-arrival_time", 200)),
    refetchInterval: 30000,
  });
  const taskQ = useQuery({
    queryKey: ["dailyReview", "tasks", CLINIC_ID],
    queryFn: async () => asList(await base44.entities.OperationalTask.filter({ clinic_id: CLINIC_ID }, "-created_date", 300)),
    refetchInterval: 30000,
  });

  const loading = revQ.isLoading || sessQ.isLoading || taskQ.isLoading;

  const m = useMemo(() => {
    const revs = asList(revQ.data);
    const sess = asList(sessQ.data);
    const tasks = asList(taskQ.data);

    const todayRevenue = revs.filter((r) => r.recorded_at && sameDay(r.recorded_at, now)).reduce((s, r) => s + (r.amount || 0), 0);
    const yRevenue = revs.filter((r) => r.recorded_at && isYesterday(r.recorded_at, now)).reduce((s, r) => s + (r.amount || 0), 0);

    const todayVisits = sess.filter((s) => s.arrival_time && sameDay(s.arrival_time, now)).length;
    const yVisits = sess.filter((s) => s.arrival_time && isYesterday(s.arrival_time, now)).length;

    const todayTasks = tasks.filter((t) => t.created_date && sameDay(t.created_date, now));
    const todayCompleted = todayTasks.filter((t) => t.status === "completed").length;
    const todayTotal = todayTasks.length;
    const completionRate = todayTotal ? Math.round((todayCompleted / todayTotal) * 100) : 0;
    const aiAssisted = todayTasks.filter((t) => t.ai_parsed && Object.keys(t.ai_parsed).length > 0).length;
    const aiRate = todayTotal ? Math.round((aiAssisted / todayTotal) * 100) : 0;

    const avgRevenue = todayVisits ? Math.round(todayRevenue / todayVisits) : 0;

    return { todayRevenue, yRevenue, todayVisits, yVisits, todayCompleted, todayTotal, completionRate, aiAssisted, aiRate, avgRevenue };
  }, [revQ.data, sessQ.data, taskQ.data]);

  // 一句话 AI 总结（本地推导，不耗 LLM）
  const summary = useMemo(() => {
    if (m.todayTotal === 0 && m.todayVisits === 0) return "今日暂无运营数据，请确认是否已开诊。";
    const parts = [];
    parts.push(`今日营收 ¥${m.todayRevenue.toLocaleString()}（${m.todayVisits} 人到店，客单价 ¥${m.avgRevenue}）`);
    parts.push(`任务完成率 ${m.completionRate}%（${m.todayCompleted}/${m.todayTotal}）`);
    if (m.aiRate > 0) parts.push(`AI 辅助 ${m.aiAssisted} 项（占 ${m.aiRate}%）`);
    const risk = [];
    if (m.completionRate < 70 && m.todayTotal > 0) risk.push("任务完成率偏低");
    if (m.todayVisits > 0 && m.avgRevenue === 0) risk.push("营收为零");
    const tail = risk.length ? `，需关注：${risk.join("、")}` : "，运营平稳。";
    return parts.join("，") + tail;
  }, [m]);

  const cards = [
    { label: "今日营收", value: `¥${m.todayRevenue.toLocaleString()}`, icon: Wallet, color: "#00C7D9", trend: <Trend today={m.todayRevenue} yesterday={m.yRevenue} /> },
    { label: "今日客流", value: `${m.todayVisits} 人`, icon: Users, color: "#A78BFA", trend: <Trend today={m.todayVisits} yesterday={m.yVisits} /> },
    { label: "任务完成率", value: `${m.completionRate}%`, icon: CheckCircle2, color: "#4ade80", sub: `${m.todayCompleted}/${m.todayTotal}` },
    { label: "AI 辅助任务", value: `${m.aiRate}%`, icon: Brain, color: "#FBBF24", sub: `${m.aiAssisted} 项` },
  ];

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${theme.border}` }}>
        <ClipboardCheck size={15} style={{ color: "#00C7D9" }} />
        <span className="text-sm font-bold" style={{ color: theme.text }}>日结复盘</span>
        <span className="text-[10px]" style={{ color: theme.textFaint }}>
          {now.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" })} · 下班前一键总览
        </span>
        <Link to="/daily-review" className="ml-auto flex items-center gap-0.5 text-[10px] font-semibold" style={{ color: "#00C7D9" }}>
          查看完整复盘 <ChevronRight size={11} />
        </Link>
      </div>

      {loading ? (
        <div className="py-8 flex justify-center"><Loader className="animate-spin" style={{ color: theme.textSub }} /></div>
      ) : (
        <>
          {/* 指标卡 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3">
            {cards.map((c) => {
              const Icon = c.icon;
              return (
                <div key={c.label} className="rounded-lg p-3" style={{ background: theme.canvas, border: `1px solid ${theme.borderSubtle}` }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px]" style={{ color: theme.textSub }}>{c.label}</span>
                    <Icon size={13} style={{ color: c.color }} />
                  </div>
                  <div className="text-xl font-bold" style={{ color: c.color }}>{c.value}</div>
                  <div className="mt-1 flex items-center gap-2">
                    {c.sub && <span className="text-[10px]" style={{ color: theme.textFaint }}>{c.sub}</span>}
                    {c.trend}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 一句话总结 */}
          <div className="mx-3 mb-3 rounded-lg p-3 flex items-start gap-2" style={{ background: "rgba(0,199,217,0.05)", border: "1px solid rgba(0,199,217,0.15)" }}>
            <Brain size={14} style={{ color: "#00C7D9", marginTop: 1, flexShrink: 0 }} />
            <div>
              <div className="text-[10px] font-semibold mb-0.5" style={{ color: "#00C7D9" }}>AI 日结摘要</div>
              <div className="text-xs leading-relaxed" style={{ color: theme.textMsg }}>{summary}</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function DailyReviewPanel() {
  return <Inner />;
}