import React from "react";
import { X } from "lucide-react";
import { useTheme } from "@/lib/ThemeContext";

const PRIORITY_LABEL = { P1: "P1 店长指令", P2: "P2 紧迫", P3: "P3 遗留", P4: "P4 常规" };
const URGENCY_LABEL = { green: "正常", yellow: "关注", red: "紧急" };
const TASK_STATUS_LABEL = {
  pending_approval: "待审批", assigned: "已指派", in_progress: "进行中",
  pending_evidence: "待补证据", under_review: "审核中", exception: "异常", completed: "已完成",
};
const ALIGN_LABEL = { aligned: "已对齐", needs_clarification: "需澄清", rejected: "已驳回", failed: "失败" };
const QUALITY_LABEL = { high: "高", medium: "中", low: "低", uncertain: "不确定" };
const URGENCY_COLOR = { green: "#16A34A", yellow: "#D97706", red: "#DC2626" };

function fmtTime(ts) {
  if (!ts) return "—";
  try {
    return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ts));
  } catch { return String(ts); }
}

function Row({ label, children }) {
  return (
    <div className="flex gap-2 py-1.5 text-xs">
      <span className="flex-shrink-0 w-20 text-right" style={{ color: "#64748B" }}>{label}</span>
      <span className="flex-1 break-words" style={{ color: "#F1F5F9" }}>{children}</span>
    </div>
  );
}

function Badge({ text, color }) {
  return (
    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold mr-1 mb-1"
      style={{ background: `${color}22`, color, border: `1px solid ${color}55` }}>{text}</span>
  );
}

function TaskDetail({ raw }) {
  const ai = raw.ai_parsed || {};
  return (
    <>
      <Row label="优先级"><Badge text={PRIORITY_LABEL[raw.priority] || raw.priority} color="#00C7D9" /></Row>
      <Row label="状态"><Badge text={TASK_STATUS_LABEL[raw.status] || raw.status} color="#94A3B8" /></Row>
      <Row label="发起方">{raw.dispatched_by === "manager" ? "店长" : "员工自主"}</Row>
      <Row label="创建时间">{fmtTime(raw.created_date)}</Row>
      {raw.due_time && <Row label="截止时间">{fmtTime(raw.due_time)}</Row>}
      {ai.category && <Row label="业务族"><Badge text={ai.category} color="#00C7D9" /></Row>}
      {ai.urgency && <Row label="紧迫度"><Badge text={ai.urgency} color={URGENCY_COLOR[ai.urgency] || "#94A3B8"} /></Row>}
      {ai.summary && <Row label="AI摘要">{ai.summary}</Row>}
      {ai.suggested_action && <Row label="建议动作">{ai.suggested_action}</Row>}
      {raw.description && <Row label="任务描述">{raw.description}</Row>}
      {Array.isArray(raw.report_log) && raw.report_log.length > 0 && (
        <Row label="汇报记录">{raw.report_log.length} 条</Row>
      )}
    </>
  );
}

function FactDetail({ raw }) {
  const fp = raw.subject_fingerprint || {};
  return (
    <>
      <Row label="紧迫度"><Badge text={URGENCY_LABEL[raw.marquee_urgency] || raw.marquee_urgency} color={URGENCY_COLOR[raw.marquee_urgency] || "#94A3B8"} /></Row>
      {raw.alignment_status && <Row label="对齐状态"><Badge text={ALIGN_LABEL[raw.alignment_status] || raw.alignment_status} color="#A78BFA" /></Row>}
      {raw.subject_type && <Row label="主体类型">{raw.subject_type}</Row>}
      {fp.name && <Row label="主体名称">{fp.name}</Row>}
      {raw.occurred_at && <Row label="业务时间">{fmtTime(raw.occurred_at)}</Row>}
      <Row label="提取时间">{fmtTime(raw.extracted_at)}</Row>
      {raw.model_version && <Row label="模型版本">{raw.model_version}</Row>}
      {Array.isArray(raw.fields) && raw.fields.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] font-bold mb-1" style={{ color: "#94A3B8" }}>提取字段（{raw.fields.length}）</div>
          {raw.fields.slice(0, 12).map((f, i) => (
            <div key={i} className="flex gap-2 py-1 text-xs">
              <span className="flex-shrink-0 w-24 truncate" style={{ color: "#00C7D9" }}>{f.field_name}</span>
              <span className="flex-1 break-words" style={{ color: "#F1F5F9" }}>{f.value}</span>
              <span className="flex-shrink-0 text-[9px]" style={{ color: QUALITY_LABEL[f.extraction_quality] === "高" ? "#16A34A" : "#94A3B8" }}>
                {QUALITY_LABEL[f.extraction_quality] || f.extraction_quality}
              </span>
            </div>
          ))}
        </div>
      )}
      {Array.isArray(raw.contradictions) && raw.contradictions.length > 0 && (
        <Row label="矛盾清单">{raw.contradictions.join("；")}</Row>
      )}
    </>
  );
}

export default function MarqueeDetailModal({ item, onClose }) {
  const { theme } = useTheme();
  if (!item) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div className="w-full max-w-md rounded-xl flex flex-col max-h-[80vh]"
        style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 flex-shrink-0"
          style={{ borderBottom: `1px solid ${theme.borderSubtle}` }}>
          <div className="flex items-center gap-2 min-w-0">
            <span className="px-2 py-0.5 rounded text-[10px] font-bold flex-shrink-0"
              style={{
                background: item.kind === "task" ? "rgba(0,199,217,0.15)" : "rgba(167,139,250,0.15)",
                color: item.kind === "task" ? "#00C7D9" : "#A78BFA",
              }}>
              {item.kind === "task" ? "运营任务" : "证据事实卡"}
            </span>
            <span className="text-sm font-bold truncate" style={{ color: theme.text }}>{item.label}</span>
          </div>
          <button onClick={onClose} className="flex-shrink-0 ml-2"><X size={16} style={{ color: theme.textMuted }} /></button>
        </div>
        <div className="overflow-y-auto px-4 py-2">
          <Row label="提交员工">{item.staffName}</Row>
          <Row label="时间戳">{item.time}</Row>
          <div className="my-1" style={{ borderTop: `1px dashed ${theme.borderSubtle}` }} />
          {item.kind === "task" ? <TaskDetail raw={item.raw} /> : <FactDetail raw={item.raw} />}
        </div>
      </div>
    </div>
  );
}