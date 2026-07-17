/**
 * Clinic OS V10 — AttentionQueue（注意力队列）
 *
 * V10 宪法核心展示组件：
 * - 只展示 status: "open" 的 AttentionItem（过滤所有常规事件流，仅呈现需店长介入的情境）
 * - 红色 = 需15分钟内响应，黄色 = 今日内关注
 * - 店长三选一：execute（执行）/ ignore（忽略）/ escalate（升级）
 * - 每条建议可下钻查看完整溯源链（evidence → event → recommendation）
 */

import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { AlertTriangle, ChevronDown, ChevronUp, CheckCircle2, XCircle, ArrowUpCircle, Clock, Link2, Eye } from "lucide-react";

const CLINIC_ID = "clinic-001";

const ATTENTION_TYPE_LABELS = {
  journey_gap: "旅程断点",
  evidence_missing: "证据缺失",
  contradiction: "数据矛盾",
  resource_risk: "资源风险",
  wait_timeout: "等待超时",
  staff_unresponsive: "员工无响应",
};

const C = {
  canvas: "#0D1B2A", card: "#1E293B", border: "#334155",
  text: "#F1F5F9", sub: "#94A3B8", faint: "#64748B",
  cyan: "#00C7D9", red: "#DC2626", amber: "#D97706", green: "#16A34A",
};

function AttentionCard({ item, onDecision }) {
  const [expanded, setExpanded] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const isRed = item.urgency === "red";
  const urgencyColor = isRed ? C.red : C.amber;
  const urgencyBg = isRed ? "rgba(220,38,38,0.1)" : "rgba(217,119,6,0.1)";
  const urgencyBorder = isRed ? "rgba(220,38,38,0.3)" : "rgba(217,119,6,0.3)";

  const handleDecision = async (action) => {
    setDeciding(true);
    await onDecision(item.id, action);
    setDeciding(false);
  };

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: C.card,
        border: `1px solid ${urgencyBorder}`,
        boxShadow: isRed ? "0 0 0 1px rgba(220,38,38,0.15), 0 4px 12px rgba(220,38,38,0.1)" : "none",
        animation: isRed ? "pulseRed 2s ease-in-out infinite" : undefined,
      }}
    >
      {/* Header row */}
      <div className="flex items-start gap-3 p-3">
        <div
          className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center mt-0.5"
          style={{ background: urgencyBg, border: `1px solid ${urgencyBorder}` }}
        >
          <AlertTriangle size={14} style={{ color: urgencyColor }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-xs font-bold" style={{ color: C.text }}>{item.title}</span>
            <span
              className="text-[9.5px] px-1.5 py-0.5 rounded font-semibold"
              style={{ background: urgencyBg, color: urgencyColor, border: `1px solid ${urgencyBorder}` }}
            >
              {isRed ? "🔴 立即响应" : "🟡 今日关注"}
            </span>
            <span
              className="text-[9.5px] px-1.5 py-0.5 rounded"
              style={{ background: "rgba(0,199,217,0.08)", color: C.cyan, border: "1px solid rgba(0,199,217,0.2)" }}
            >
              {ATTENTION_TYPE_LABELS[item.attention_type] || item.attention_type}
            </span>
          </div>
          <div className="text-xs" style={{ color: C.sub, fontSize: "11px", lineHeight: "1.4" }}>
            {item.recommendation}
          </div>
          {item.generated_at && (
            <div className="flex items-center gap-1 mt-1">
              <Clock size={9} style={{ color: C.faint }} />
              <span className="text-[9px]" style={{ color: C.faint }}>
                {new Date(item.generated_at).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" })} 生成
              </span>
              {(item.evidence_ids?.length > 0 || item.event_ids?.length > 0) && (
                <>
                  <Link2 size={9} style={{ color: C.faint }} className="ml-1" />
                  <span className="text-[9px]" style={{ color: C.faint }}>
                    {item.evidence_ids?.length || 0}条证据 · {item.event_ids?.length || 0}条事件
                  </span>
                </>
              )}
            </div>
          )}
        </div>
        <button
          onClick={() => setExpanded((p) => !p)}
          className="flex-shrink-0 p-1 rounded"
          style={{ color: C.faint }}
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* Expanded: reasoning chain */}
      {expanded && item.reasoning && (
        <div className="px-3 pb-3">
          <div
            className="rounded-lg p-2.5 text-xs"
            style={{ background: "rgba(0,199,217,0.05)", border: "1px solid rgba(0,199,217,0.15)", color: C.sub, fontSize: "10.5px", lineHeight: "1.5" }}
          >
            <div className="flex items-center gap-1 mb-1">
              <Eye size={10} style={{ color: C.cyan }} />
              <span className="font-semibold" style={{ color: C.cyan, fontSize: "9.5px" }}>AI 推理过程（溯源链）</span>
            </div>
            {item.reasoning}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 px-3 pb-3">
        <button
          onClick={() => handleDecision("execute")}
          disabled={deciding}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50 transition-all active:scale-95"
          style={{ background: "rgba(22,163,74,0.12)", color: "#4ade80", border: "1px solid rgba(22,163,74,0.3)" }}
        >
          <CheckCircle2 size={11} /> 执行
        </button>
        <button
          onClick={() => handleDecision("ignore")}
          disabled={deciding}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50 transition-all active:scale-95"
          style={{ background: "rgba(100,116,139,0.12)", color: C.sub, border: `1px solid ${C.border}` }}
        >
          <XCircle size={11} /> 忽略
        </button>
        <button
          onClick={() => handleDecision("escalate")}
          disabled={deciding}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50 transition-all active:scale-95"
          style={{ background: "rgba(220,38,38,0.1)", color: "#f87171", border: "1px solid rgba(220,38,38,0.25)" }}
        >
          <ArrowUpCircle size={11} /> 升级
        </button>
      </div>
    </div>
  );
}

export default function AttentionQueue() {
  const qc = useQueryClient();
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["attentionItems", CLINIC_ID],
    queryFn: () => base44.entities.AttentionItem.filter({ clinic_id: CLINIC_ID, status: "open" }, "-generated_at", 30),
    refetchInterval: 10000,
  });

  const redItems = items.filter((i) => i.urgency === "red");
  const yellowItems = items.filter((i) => i.urgency === "yellow");

  const handleDecision = async (id, action) => {
    const statusMap = { execute: "executed", ignore: "ignored", escalate: "escalated" };
    await base44.entities.AttentionItem.update(id, {
      manager_action: action,
      status: statusMap[action],
      decided_at: new Date().toISOString(),
    });
    // 若执行，同时创建 OperationalTask（唯一合法创建路径）
    if (action === "execute") {
      const item = items.find((i) => i.id === id);
      if (item) {
        await base44.entities.OperationalTask.create({
          clinic_id: CLINIC_ID,
          attention_item_id: id,
          priority: item.urgency === "red" ? "P1" : "P2",
          dispatched_by: "manager",
          description: item.recommendation,
          status: "assigned",
        });
      }
    }
    qc.invalidateQueries({ queryKey: ["attentionItems", CLINIC_ID] });
    qc.invalidateQueries({ queryKey: ["tasks", CLINIC_ID] });
  };

  if (isLoading) {
    return (
      <div className="rounded-xl p-4 flex items-center justify-center" style={{ background: C.card, border: `1px solid ${C.border}`, minHeight: 80 }}>
        <span className="text-xs" style={{ color: C.faint }}>加载注意力队列…</span>
      </div>
    );
  }

  return (
    <div className="rounded-xl" style={{ background: C.card, border: `1px solid ${C.border}` }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: C.border }}>
        <AlertTriangle size={14} style={{ color: items.length > 0 ? "#f87171" : C.faint }} />
        <span className="text-xs font-bold" style={{ color: C.text }}>注意力队列</span>
        {redItems.length > 0 && (
          <span className="text-[9.5px] px-2 py-0.5 rounded-full font-bold" style={{ background: "rgba(220,38,38,0.15)", color: "#f87171", border: "1px solid rgba(220,38,38,0.3)" }}>
            {redItems.length} 红
          </span>
        )}
        {yellowItems.length > 0 && (
          <span className="text-[9.5px] px-2 py-0.5 rounded-full font-bold" style={{ background: "rgba(217,119,6,0.15)", color: "#fbbf24", border: "1px solid rgba(217,119,6,0.3)" }}>
            {yellowItems.length} 黄
          </span>
        )}
        <span className="ml-auto text-[9.5px]" style={{ color: C.faint }}>AI 建议 · 店长决策</span>
      </div>

      {/* Items */}
      <div className="p-3 space-y-2 max-h-[480px] overflow-y-auto">
        {items.length === 0 ? (
          <div className="py-8 text-center">
            <div className="text-xs font-semibold mb-1" style={{ color: C.green }}>✓ 诊所运行正常</div>
            <div className="text-xs" style={{ color: C.faint }}>无待处理注意力项目</div>
          </div>
        ) : (
          <>
            {/* 红色优先 */}
            {redItems.map((item) => (
              <AttentionCard key={item.id} item={item} onDecision={handleDecision} />
            ))}
            {/* 黄色次之 */}
            {yellowItems.map((item) => (
              <AttentionCard key={item.id} item={item} onDecision={handleDecision} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}