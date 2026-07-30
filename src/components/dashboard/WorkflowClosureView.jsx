/**
 * Clinic OS V10 — 工作流闭环视图（Workflow Closure View）
 *
 * 全宽战略层组件：
 * - 顶部统计：流动中 / 卡滞 / 已归档 / 今日闭环数
 * - 主体：AI 压缩后的业务链路快照列表，每条展示语义摘要 + 节点链 + 阻塞点
 * - 店长闭环入口：对任意 active / stalled / pending_manager_closure 快照执行「确认闭环」
 *   （V10 合规：AI 仅生成快照，闭环决策由店长人工执行）
 * - 已归档区：展示 manager_note + 闭环时间
 */

import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import {
  GitBranch, Clock, CheckCircle2, AlertCircle, Loader2,
  Archive, ArrowRightCircle, ChevronDown, FileSearch,
} from "lucide-react";
import { asList, CLINIC_ID } from "@/hooks/useClinicData";

const C = {
  canvas: "#0D1B2A", card: "#1E293B", border: "#334155",
  text: "#F1F5F9", sub: "#94A3B8", faint: "#64748B",
  cyan: "#00C7D9", red: "#DC2626", amber: "#D97706", green: "#16A34A", purple: "#8B5CF6",
};

const STATUS_CONFIG = {
  active: { label: "流动中", color: C.green, bg: "rgba(22,163,74,0.12)" },
  stalled: { label: "卡滞", color: C.amber, bg: "rgba(217,119,6,0.12)" },
  pending_manager_closure: { label: "待闭环", color: C.cyan, bg: "rgba(0,199,217,0.12)" },
  closed: { label: "已归档", color: C.faint, bg: "rgba(100,116,139,0.1)" },
};

const LINE_LABEL = { optometry: "验光配镜", medical: "眼科医疗", vision_training: "视觉训练" };

// 预估闭环进度：已耗时 / (已耗时 + 预估剩余)，封顶 95%
const closureProgress = (s) => {
  const elapsed = s.total_elapsed_minutes || 0;
  const remain = s.estimated_completion_minutes || 0;
  if (elapsed === 0 && remain === 0) return 0;
  const total = elapsed + remain;
  if (total <= 0) return 0;
  return Math.min(95, Math.max(5, Math.round((elapsed / total) * 100)));
};
// 关键证据缺口：基于瓶颈节点 / 当前节点推断还缺什么证据可闭环
const evidenceGap = (s) => {
  if (s.bottleneck_node) return `需补充「${s.bottleneck_node}」节点的关键执行证据（单据/影像/签字）以解除阻塞`;
  if (s.current_node) return `需补充「${s.current_node}」节点的完成证据以推进闭环`;
  return "暂无明确缺失证据，建议店长核查全链路后确认闭环";
};

function StatPill({ icon: Icon, label, value, color }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg flex-1 min-w-[120px]" style={{ background: C.card, border: `1px solid ${C.border}` }}>
      <Icon size={14} style={{ color }} />
      <div>
        <div className="text-[9px]" style={{ color: C.faint }}>{label}</div>
        <div className="text-base font-bold" style={{ color }}>{value}</div>
      </div>
    </div>
  );
}

function ClosureCard({ snap, onClosed }) {
  const qc = useQueryClient();
  const [showClose, setShowClose] = useState(false);
  const [note, setNote] = useState("");
  const [closing, setClosing] = useState(false);
  const sc = STATUS_CONFIG[snap.status] || STATUS_CONFIG.active;
  const isClosed = snap.status === "closed";

  const handleClose = async () => {
    setClosing(true);
    await base44.entities.WorkflowSnapshot.update(snap.id, {
      status: "closed",
      manager_closed_at: new Date().toISOString(),
      manager_note: note || "店长确认业务链路已闭环",
    });
    qc.invalidateQueries({ queryKey: ["workflowSnapshots", CLINIC_ID] });
    qc.invalidateQueries({ queryKey: ["closureView", CLINIC_ID] });
    setClosing(false);
    setShowClose(false);
    onClosed?.();
  };

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: C.card, border: `1px solid ${isClosed ? C.border : `${sc.color}33`}` }}>
      <div className="flex items-center gap-2 px-3 py-2.5 border-b" style={{ borderColor: C.border }}>
        <GitBranch size={12} style={{ color: C.purple }} />
        <span className="text-xs font-bold truncate flex-1" style={{ color: C.text }}>
          {snap.patient_name || "未登记患者"} · {LINE_LABEL[snap.business_line] || snap.business_line}
        </span>
        <span className="text-[9.5px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0" style={{ background: sc.bg, color: sc.color }}>
          {sc.label}
        </span>
      </div>

      <div className="px-3 pt-2.5 pb-1">
        <div className="text-xs" style={{ color: C.sub, fontSize: "11px", lineHeight: 1.5 }}>
          {snap.llm_summary || "压缩摘要生成中…"}
        </div>
        {snap.llm_recommendation && !isClosed && (
          <div className="mt-1.5 text-[10.5px] px-2 py-1.5 rounded-lg" style={{ background: "rgba(0,199,217,0.06)", color: C.cyan, border: "1px solid rgba(0,199,217,0.15)" }}>
            💡 {snap.llm_recommendation}
          </div>
        )}
      </div>

      {/* 节点链 */}
      {snap.nodes_completed && snap.nodes_completed.length > 0 && (
        <div className="px-3 py-2">
          <div className="text-[9px] mb-1 font-semibold" style={{ color: C.faint }}>业务链路（AI 压缩）</div>
          <div className="flex flex-wrap items-center gap-1">
            {snap.nodes_completed.map((n, i) => (
              <span key={i} className="text-[9.5px] px-1.5 py-0.5 rounded" style={{ background: "rgba(0,199,217,0.08)", color: C.cyan }}>
                {n}
              </span>
            ))}
            {snap.current_node && !snap.nodes_completed.includes(snap.current_node) && (
              <>
                <ArrowRightCircle size={10} style={{ color: C.faint }} />
                <span className="text-[9.5px] px-1.5 py-0.5 rounded" style={{ background: sc.bg, color: sc.color }}>
                  {snap.current_node}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* 统计行 */}
      <div className="flex items-center gap-3 px-3 py-1.5">
        <div className="flex items-center gap-1">
          <Clock size={10} style={{ color: C.faint }} />
          <span className="text-[9.5px]" style={{ color: C.faint }}>已耗时 {snap.total_elapsed_minutes || 0}分</span>
        </div>
        {snap.bottleneck_node && !isClosed && (
          <div className="flex items-center gap-1 ml-auto">
            <AlertCircle size={10} style={{ color: C.amber }} />
            <span className="text-[9.5px]" style={{ color: C.amber }}>阻塞：{snap.bottleneck_node}</span>
          </div>
        )}
        {isClosed && snap.manager_closed_at && (
          <div className="flex items-center gap-1 ml-auto">
            <CheckCircle2 size={10} style={{ color: C.green }} />
            <span className="text-[9.5px]" style={{ color: C.faint }}>
              闭环于 {new Date(snap.manager_closed_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        )}
      </div>

      {/* 闭环进度 + 关键证据缺口（未归档） */}
      {!isClosed && (
        <div className="px-3 pb-2 space-y-2">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-[9px] font-semibold" style={{ color: C.faint }}>预估闭环进度</span>
              <span className="ml-auto text-[9.5px] tabular-nums" style={{ color: C.cyan }}>{closureProgress(snap)}%</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${closureProgress(snap)}%`, background: "linear-gradient(90deg,#4ade80,#00C7D9)" }} />
            </div>
          </div>
          <div className="flex items-start gap-1.5 text-[10px] px-2 py-1.5 rounded-lg" style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.2)" }}>
            <FileSearch size={11} className="mt-0.5 flex-shrink-0" style={{ color: C.amber }} />
            <span style={{ color: "#fbbf24" }}>
              <span className="font-semibold">关键证据缺口：</span>
              {evidenceGap(snap)}
            </span>
          </div>
        </div>
      )}

      {/* 闭环备注（已归档） */}
      {isClosed && snap.manager_note && (
        <div className="px-3 pb-2.5">
          <div className="text-[10px] px-2 py-1.5 rounded-lg" style={{ background: "rgba(100,116,139,0.08)", color: C.sub, border: `1px solid ${C.border}` }}>
            店长备注：{snap.manager_note}
          </div>
        </div>
      )}

      {/* 店长闭环入口（未归档） */}
      {!isClosed && (
        <div className="px-3 pb-3">
          {!showClose ? (
            <button
              onClick={() => setShowClose(true)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all active:scale-95"
              style={{ background: "rgba(0,199,217,0.12)", color: C.cyan, border: "1px solid rgba(0,199,217,0.3)" }}
            >
              <CheckCircle2 size={12} /> 确认业务链路闭环
            </button>
          ) : (
            <div className="space-y-2 animate-fade-in">
              <div className="text-[10px] px-2 py-1.5 rounded-lg" style={{ background: "rgba(217,119,6,0.08)", color: C.amber, border: "1px solid rgba(217,119,6,0.2)" }}>
                V10 提示：闭环后该工作流归档，不再出现在流动视图。AI 仅生成快照，闭环由您决策。
              </div>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="店长闭环备注（可选，建议记录处置结果）"
                rows={2}
                className="w-full text-xs rounded-lg px-2 py-1.5 outline-none resize-none"
                style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`, color: C.text }}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleClose}
                  disabled={closing}
                  className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                  style={{ background: "rgba(22,163,74,0.15)", color: "#4ade80", border: "1px solid rgba(22,163,74,0.3)" }}
                >
                  {closing ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                  确认归档
                </button>
                <button
                  onClick={() => setShowClose(false)}
                  className="px-3 py-1.5 rounded-lg text-xs"
                  style={{ color: C.faint, border: `1px solid ${C.border}` }}
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function WorkflowClosureView() {
  const [showArchive, setShowArchive] = useState(false);
  const { data: rawSnapshots, isLoading } = useQuery({
    queryKey: ["workflowSnapshots", CLINIC_ID, "all"],
    queryFn: async () => asList(await base44.entities.WorkflowSnapshot.filter({ clinic_id: CLINIC_ID }, "-generated_at", 50)),
    refetchInterval: 15000,
  });
  const allSnapshots = asList(rawSnapshots);

  const open = allSnapshots.filter((s) => s.status !== "closed");
  const closed = allSnapshots.filter((s) => s.status === "closed");
  const active = allSnapshots.filter((s) => s.status === "active");
  const stalled = allSnapshots.filter((s) => s.status === "stalled");
  const todayClosed = closed.filter((s) => {
    if (!s.manager_closed_at) return false;
    const d = new Date(s.manager_closed_at);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  });

  return (
    <div className="rounded-xl" style={{ background: C.card, border: `1px solid ${C.border}` }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: C.border }}>
        <Archive size={14} style={{ color: C.purple }} />
        <span className="text-xs font-bold" style={{ color: C.text }}>工作流闭环视图</span>
        <span className="text-[9.5px] ml-1" style={{ color: C.faint }}>AI 语义压缩 · 店长闭环决策入口</span>
        <span className="ml-auto text-[9.5px]" style={{ color: C.faint }}>
          共 {allSnapshots.length} 条 · 15s 自动刷新
        </span>
      </div>

      {/* Stats bar */}
      <div className="flex gap-2 p-3 flex-wrap" style={{ borderBottom: `1px solid ${C.border}` }}>
        <StatPill icon={GitBranch} label="流动中" value={active.length} color={C.green} />
        <StatPill icon={AlertCircle} label="卡滞" value={stalled.length} color={C.amber} />
        <StatPill icon={CheckCircle2} label="今日闭环" value={todayClosed.length} color={C.cyan} />
        <StatPill icon={Archive} label="累计归档" value={closed.length} color={C.faint} />
      </div>

      {/* Open workflows */}
      <div className="p-3">
        <div className="text-[10px] font-semibold mb-2" style={{ color: C.sub }}>待闭环工作流（{open.length}）</div>
        {isLoading ? (
          <div className="py-8 text-center text-xs" style={{ color: C.faint }}>加载工作流快照…</div>
        ) : open.length === 0 ? (
          <div className="py-6 text-center">
            <CheckCircle2 size={20} className="mx-auto mb-1.5" style={{ color: C.green }} />
            <div className="text-xs font-semibold" style={{ color: C.faint }}>当前无待闭环工作流</div>
            <div className="text-[10.5px] mt-0.5" style={{ color: C.faint }}>所有业务链路均已闭环或暂无活跃会话</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {open.map((s) => <ClosureCard key={s.id} snap={s} />)}
          </div>
        )}
      </div>

      {/* Archive section */}
      {closed.length > 0 && (
        <div className="border-t" style={{ borderColor: C.border }}>
          <button
            onClick={() => setShowArchive(!showArchive)}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-xs"
            style={{ color: C.sub }}
          >
            <ChevronDown size={12} style={{ transform: showArchive ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
            <Archive size={12} style={{ color: C.faint }} />
            <span className="font-semibold">已归档闭环历史（{closed.length}）</span>
          </button>
          {showArchive && (
            <div className="p-3 pt-0 animate-fade-in">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {closed.slice(0, 10).map((s) => <ClosureCard key={s.id} snap={s} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}