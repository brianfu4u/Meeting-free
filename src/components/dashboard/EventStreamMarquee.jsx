/**
 * Clinic OS V10 — 事件流走马灯（火车车厢版）
 *
 * 取代注意力队列位置：以一列火车车厢从右向左滚动，
 * 每节车厢展示「提交员工注册名 + 事件概要」。
 * 数据源：今日 OperationalTask（assignee_staff_id）+ EvidenceFactCard（artifact.source_staff_id）。
 */

import React, { useRef, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useTheme } from "@/lib/ThemeContext";
import { Radio, Loader, Train, Link2 } from "lucide-react";
import { isToday } from "@/lib/clinicDate";
import { asList, CLINIC_ID } from "@/hooks/useClinicData";
const PRIORITY_COLOR = { P1: "#DC2626", P2: "#D97706", P3: "#00C7D9", P4: "#64748B" };
const URGENCY_COLOR = { green: "#16A34A", yellow: "#D97706", red: "#DC2626" };


function todayBusinessDate() {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch { return new Date().toISOString().slice(0, 10); }
}

function fmtHHmm(ts) {
  if (!ts) return "";
  try {
    return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ts));
  } catch { return ""; }
}

function marqueeLabel(task) {
  if (task.ai_parsed?.marquee_label) return task.ai_parsed.marquee_label;
  const { category, summary } = task.ai_parsed || {};
  if (summary && category) return `${category}·${summary}`.slice(0, 28);
  if (summary) return String(summary).slice(0, 28);
  if (category) return String(category).slice(0, 28);
  return "事件流";
}

function Carriage({ item, theme }) {
  const accent = item.dot;
  return (
    <div className="inline-flex items-stretch flex-shrink-0">
      {/* 车厢连接器 */}
      <div className="flex items-center px-1" style={{ color: theme.textFaint }}>
        <span className="block w-3 h-0.5 rounded" style={{ background: theme.borderSubtle }} />
        <Link2 size={12} style={{ color: theme.textFaint }} />
        <span className="block w-3 h-0.5 rounded" style={{ background: theme.borderSubtle }} />
      </div>
      {/* 车厢本体 */}
      <div
        className="relative rounded-lg px-3 py-2 flex flex-col justify-center min-w-[180px] max-w-[280px]"
        style={{ background: theme.cardBg, border: `1px solid ${theme.border}`, borderTop: `2px solid ${accent}` }}
      >
        {/* 车顶条纹 */}
        <div className="absolute left-2 right-2 top-0.5 h-px" style={{ background: `repeating-linear-gradient(90deg, ${theme.borderSubtle} 0 4px, transparent 4px 8px)` }} />
        {/* 员工名 + 概要 */}
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: accent }} />
          <span className="text-[11px] font-bold truncate" style={{ color: "#00C7D9" }}>{item.staffName}</span>
        </div>
        <div className="text-[11px] mt-0.5 truncate" style={{ color: theme.textSub }}>{item.label}</div>
        <div className="text-[9px] mt-0.5 tabular-nums" style={{ color: theme.textMuted }}>{item.time}</div>
        {/* 车轮 */}
        <div className="flex justify-between mt-1 px-1">
          <span className="w-2 h-2 rounded-full" style={{ background: theme.textFaint, border: `1px solid ${theme.borderSubtle}` }} />
          <span className="w-2 h-2 rounded-full" style={{ background: theme.textFaint, border: `1px solid ${theme.borderSubtle}` }} />
        </div>
      </div>
    </div>
  );
}

export default function EventStreamMarquee() {
  const { theme } = useTheme();
  const q = useQuery({
    queryKey: ["marquee", "unclosed-tasks", CLINIC_ID],
    queryFn: async () => asList(await base44.entities.OperationalTask.filter({ clinic_id: CLINIC_ID }, "-created_date", 100)),
    refetchInterval: 15000,
  });
  const fc = useQuery({
    queryKey: ["marquee", "fact-cards", CLINIC_ID],
    queryFn: async () => asList(await base44.entities.EvidenceFactCard.filter({ clinic_id: CLINIC_ID, business_date: todayBusinessDate() }, "-extracted_at", 100)),
    refetchInterval: 8000,
  });
  const staffQ = useQuery({
    queryKey: ["marquee", "staff", CLINIC_ID],
    queryFn: async () => asList(await base44.entities.Staff.filter({ clinic_id: CLINIC_ID }, "-created_date", 60)),
    refetchInterval: 30000,
  });
  const artQ = useQuery({
    queryKey: ["marquee", "artifacts", CLINIC_ID],
    queryFn: async () => asList(await base44.entities.Artifact.filter({ clinic_id: CLINIC_ID, business_date: todayBusinessDate() }, "-created_date", 200)),
    refetchInterval: 15000,
  });

  const staffMap = React.useMemo(() => {
    const m = {};
    for (const s of asList(staffQ.data)) m[s.id] = s.staff_name;
    return m;
  }, [staffQ.data]);

  const artifactStaff = React.useMemo(() => {
    const m = {};
    for (const a of asList(artQ.data)) m[a.id] = a.source_staff_id;
    return m;
  }, [artQ.data]);

  const resolveName = (id) => (id && staffMap[id]) || "员工";

  const taskItems = asList(q.data)
    .filter((t) => isToday(t.created_date))
    .filter((t) => t.ai_parsed?.marquee_label || t.description)
    .sort((a, b) => new Date(b.created_date) - new Date(a.created_date))
    .map((t) => ({
      kind: "task",
      id: t.id,
      label: marqueeLabel(t),
      dot: PRIORITY_COLOR[t.priority] || "#64748B",
      staffName: t.dispatched_by === "manager" ? "店长" : resolveName(t.assignee_staff_id),
      time: fmtHHmm(t.created_date),
    }));

  const factItems = asList(fc.data)
    .filter((f) => f.marquee_label)
    .sort((a, b) => new Date(a.extracted_at) - new Date(b.extracted_at))
    .map((f) => ({
      kind: "fact",
      id: f.id,
      label: f.marquee_label,
      dot: URGENCY_COLOR[f.marquee_urgency] || "#16A34A",
      staffName: resolveName(artifactStaff[f.artifact_id]),
      time: fmtHHmm(f.extracted_at),
    }));

  const items = [...factItems, ...taskItems];

  const isLoading = q.isLoading && fc.isLoading;

  // 仅当内容超出容器宽度时才复制+滚动，避免少量条目时出现"两列重复"
  const trackRef = useRef(null);
  const containerRef = useRef(null);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const check = () => {
      const track = trackRef.current;
      const container = containerRef.current;
      if (track && container) setOverflow(track.scrollWidth > container.clientWidth + 1);
    };
    check();
    if (!containerRef.current) return;
    const ro = new ResizeObserver(check);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [items.length]);

  return (
    <div className="rounded-xl overflow-hidden flex flex-col h-full" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
      {/* 面板头 */}
      <div className="flex items-center justify-between px-4 py-2.5 flex-shrink-0" style={{ borderBottom: `1px solid ${theme.borderSubtle}`, background: "rgba(0,199,217,0.06)" }}>
        <div className="flex items-center gap-2">
          <Train size={15} style={{ color: "#00C7D9" }} />
          <span className="text-sm font-bold" style={{ color: theme.text }}>事件流走马灯</span>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: "rgba(220,38,38,0.15)", color: "#f87171" }}>{items.length}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Radio size={12} style={{ color: "#16A34A" }} />
          <span className="text-[10px]" style={{ color: theme.textMuted }}>实时滚动</span>
        </div>
      </div>

      {/* 轨道 */}
      <div ref={containerRef} className="flex-1 flex items-center overflow-hidden" style={{ background: theme.canvas }}>
        {isLoading ? (
          <div className="w-full flex items-center justify-center gap-2 text-xs" style={{ color: theme.textFaint }}>
            <Loader className="animate-spin" size={14} /> 事件流加载中…
          </div>
        ) : items.length === 0 ? (
          <div className="w-full flex items-center justify-center gap-2 text-xs" style={{ color: theme.textSub }}>
            <Radio size={13} style={{ color: "#16A34A" }} /> 今日无事件流
          </div>
        ) : (
          <div
            ref={trackRef}
            className={`flex items-center whitespace-nowrap py-2 ${overflow ? "marquee-track" : ""}`}
            style={{ width: overflow ? "max-content" : "100%", justifyContent: overflow ? undefined : "center" }}
          >
            {/* 火车头 */}
            <div className="inline-flex items-center justify-center flex-shrink-0 px-2.5 py-2 rounded-l-lg" style={{ background: "linear-gradient(135deg,#00C7D9,#00A8BD)", color: "#0D1B2A" }}>
              <Train size={20} />
            </div>
            {(overflow ? [...items, ...items] : items).map((it, i) => (
              <Carriage key={it.kind + "-" + it.id + "-" + i} item={it} theme={theme} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}