/**
 * Clinic OS V10 — 事件流走马灯（Event Stream Marquee）
 *
 * 采集 staffReportService 产出的待核销 OperationalTask，
 * 按 created_date 事件顺序，以极简摘要循环滚动播放；
 * 已闭环（completed/exception）项自动剔除，剩余项持续循环直到被核销。
 * 摘要优先取 LLM 产出的 ai_parsed.marquee_label（如"前台完成新挂号"）。
 */

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useTheme } from "@/lib/ThemeContext";
import { Radio, Loader } from "lucide-react";
import { isToday } from "@/lib/clinicDate";

const CLINIC_ID = "clinic-001";
const CLOSED = new Set(["completed", "exception"]);
const PRIORITY_COLOR = { P1: "#DC2626", P2: "#D97706", P3: "#00C7D9", P4: "#64748B" };

function marqueeLabel(task) {
  if (task.ai_parsed && task.ai_parsed.marquee_label) return task.ai_parsed.marquee_label;
  if (task.ai_parsed && task.ai_parsed.summary) return task.ai_parsed.summary;
  return (task.description || "事件流").slice(0, 24);
}

export default function EventStreamMarquee() {
  const { theme } = useTheme();
  const q = useQuery({
    queryKey: ["marquee", "unclosed-tasks", CLINIC_ID],
    queryFn: () => base44.entities.OperationalTask.filter({ clinic_id: CLINIC_ID }, "-created_date", 100),
    refetchInterval: 15000,
  });

  const items = (q.data || [])
    .filter((t) => !CLOSED.has(t.status))
    .filter((t) => isToday(t.created_date))
    .sort((a, b) => new Date(a.created_date) - new Date(b.created_date));

  if (q.isLoading) {
    return (
      <div className="rounded-xl px-4 py-2 flex items-center gap-2 text-xs" style={{ background: theme.cardBg, border: `1px solid ${theme.border}`, color: theme.textFaint }}>
        <Loader className="animate-spin" size={12} /> 事件流加载中…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl px-4 py-2 flex items-center gap-2" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
        <Radio size={13} style={{ color: "#16A34A" }} />
        <span className="text-xs" style={{ color: theme.textSub }}>今日无待核销事件</span>
      </div>
    );
  }

  const loop = [...items, ...items];

  return (
    <div className="rounded-xl overflow-hidden flex items-center" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
      <div className="flex items-center gap-1.5 px-3 py-2 flex-shrink-0" style={{ background: "rgba(0,199,217,0.1)", borderRight: `1px solid ${theme.border}` }}>
        <Radio size={13} style={{ color: "#00C7D9" }} />
        <span className="text-xs font-bold" style={{ color: "#00C7D9" }}>事件流</span>
        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: "rgba(220,38,38,0.15)", color: "#f87171" }}>{items.length}</span>
      </div>
      <div className="flex-1 overflow-hidden">
        <div className="marquee-track flex items-center gap-6 whitespace-nowrap py-2" style={{ width: "max-content" }}>
          {loop.map((t, i) => {
            const dot = PRIORITY_COLOR[t.priority] || "#64748B";
            return (
              <span key={t.id + "-" + i} className="inline-flex items-center gap-1.5 text-xs" style={{ color: theme.textMsg }}>
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: dot }} />
                {marqueeLabel(t)}
                <span className="text-[10px]" style={{ color: theme.textFaint }}>·待核销</span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}