/**
 * Clinic OS V10 — WorkflowSnapshotPanel（工作流快照面板）
 *
 * 战略层展示组件：
 * - 只展示 LLM 语义压缩后的工作流快照（非原始事件流）
 * - 提供时耗热力图（各节点耗时）
 * - 店长可执行「最终闭环确认」按钮
 * - 下钻查看完整 LLM 推理 + 溯源链
 */

import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { GitBranch, Clock, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { asList, CLINIC_ID } from "@/hooks/useClinicData";
import EyeExamMetadataPanel from "@/components/dashboard/EyeExamMetadataPanel";

const C = {
  canvas: "#0D1B2A", card: "#1E293B", border: "#334155",
  text: "#F1F5F9", sub: "#94A3B8", faint: "#64748B",
  cyan: "#00C7D9", red: "#DC2626", amber: "#D97706", green: "#16A34A", purple: "#8B5CF6",
};

const STATUS_CONFIG = {
  active: { label: "流动中", color: C.green, bg: "rgba(22,163,74,0.12)" },
  stalled: { label: "⚠ 卡滞", color: C.amber, bg: "rgba(217,119,6,0.12)" },
  pending_manager_closure: { label: "待闭环", color: C.cyan, bg: "rgba(0,199,217,0.12)" },
  closed: { label: "已归档", color: C.faint, bg: "rgba(100,116,139,0.1)" },
};

function HeatBar({ stageDurations }) {
  if (!stageDurations || Object.keys(stageDurations).length === 0) return null;
  const entries = Object.entries(stageDurations);
  const maxMin = Math.max(...entries.map(([, v]) => v), 1);
  return (
    <div className="space-y-1 mt-2">
      {entries.map(([node, minutes]) => {
        const pct = Math.round((minutes / maxMin) * 100);
        const color = pct > 80 ? C.red : pct > 50 ? C.amber : C.green;
        return (
          <div key={node} className="flex items-center gap-2">
            <span className="text-[9.5px] flex-shrink-0 w-24 truncate" style={{ color: C.faint }}>{node}</span>
            <div className="flex-1 h-2 rounded-full" style={{ background: C.border }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
            </div>
            <span className="text-[9.5px] flex-shrink-0 w-10 text-right" style={{ color }}>
              {minutes}分
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SnapshotCard({ snap, onClose }) {
  const qc = useQueryClient();
  const [closing, setClosing] = useState(false);
  const [note, setNote] = useState("");
  const [showClose, setShowClose] = useState(false);
  const sc = STATUS_CONFIG[snap.status] || STATUS_CONFIG.active;

  const handleManagerClose = async () => {
    setClosing(true);
    await base44.entities.WorkflowSnapshot.update(snap.id, {
      status: "closed",
      manager_closed_at: new Date().toISOString(),
      manager_note: note,
    });
    qc.invalidateQueries({ queryKey: ["workflowSnapshots", CLINIC_ID] });
    setClosing(false);
    setShowClose(false);
  };

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: C.card, border: `1px solid ${C.border}` }}>
      {/* Top bar */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b" style={{ borderColor: C.border }}>
        <GitBranch size={12} style={{ color: C.purple }} />
        <span className="text-xs font-bold truncate flex-1" style={{ color: C.text }}>
          {snap.patient_name || "患者"} · {snap.business_line === "optometry" ? "验光配镜" : snap.business_line === "medical" ? "眼科医疗" : "视觉训练"}
        </span>
        <span className="text-[9.5px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0" style={{ background: sc.bg, color: sc.color }}>
          {sc.label}
        </span>
      </div>

      {/* LLM Summary */}
      <div className="px-3 pt-2.5 pb-1">
        <div className="text-xs" style={{ color: C.sub, fontSize: "11px", lineHeight: "1.5" }}>
          {snap.llm_summary || "压缩摘要生成中…"}
        </div>
        {snap.llm_recommendation && (
          <div className="mt-1.5 text-[10.5px] px-2 py-1.5 rounded-lg" style={{ background: "rgba(0,199,217,0.06)", color: C.cyan, border: "1px solid rgba(0,199,217,0.15)" }}>
            💡 {snap.llm_recommendation}
          </div>
        )}
      </div>

      {/* Eye exam report metadata — data record only, never diagnosis */}
      <EyeExamMetadataPanel
        artifactIds={snap.artifact_ids || []}
        clinicId={snap.clinic_id || CLINIC_ID}
      />

      {/* Stats row */}
      <div className="flex items-center gap-3 px-3 py-2">
        <div className="flex items-center gap-1">
          <Clock size={10} style={{ color: C.faint }} />
          <span className="text-[9.5px]" style={{ color: C.faint }}>已耗时 {snap.total_elapsed_minutes || 0} 分</span>
        </div>
        {snap.estimated_completion_minutes != null && (
          <div className="flex items-center gap-1">
            <span className="text-[9.5px]" style={{ color: C.faint }}>预计剩余 {snap.estimated_completion_minutes} 分</span>
          </div>
        )}
        {snap.bottleneck_node && (
          <div className="flex items-center gap-1 ml-auto">
            <AlertCircle size={10} style={{ color: C.amber }} />
            <span className="text-[9.5px]" style={{ color: C.amber }}>卡：{snap.bottleneck_node}</span>
          </div>
        )}
      </div>

      {/* Heat bar */}
      {snap.stage_durations && Object.keys(snap.stage_durations).length > 0 && (
        <div className="px-3 pb-2.5">
          <div className="text-[9.5px] mb-1 font-semibold" style={{ color: C.faint }}>时耗热力图</div>
          <HeatBar stageDurations={snap.stage_durations} />
        </div>
      )}

      {/* Manager closure */}
      {snap.status === "pending_manager_closure" && (
        <div className="px-3 pb-3">
          {!showClose ? (
            <button
              onClick={() => setShowClose(true)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold"
              style={{ background: "rgba(0,199,217,0.12)", color: C.cyan, border: "1px solid rgba(0,199,217,0.3)" }}
            >
              <CheckCircle2 size={12} /> 执行最终闭环确认
            </button>
          ) : (
            <div className="space-y-2">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="店长闭环备注（可选）"
                rows={2}
                className="w-full text-xs rounded-lg px-2 py-1.5 outline-none resize-none"
                style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`, color: C.text }}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleManagerClose}
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

export default function WorkflowSnapshotPanel() {
  const [filter, setFilter] = useState("active");
  const { data: rawSnapshots, isLoading } = useQuery({
    queryKey: ["workflowSnapshots", CLINIC_ID, filter],
    queryFn: async () => {
      const query = filter === "all"
        ? { clinic_id: CLINIC_ID }
        : { clinic_id: CLINIC_ID, status: filter };
      return asList(await base44.entities.WorkflowSnapshot.filter(query, "-generated_at", 20));
    },
    refetchInterval: 15000,
  });
  const snapshots = asList(rawSnapshots);

  const FILTERS = [
    { key: "active", label: "流动中" },
    { key: "stalled", label: "卡滞" },
    { key: "pending_manager_closure", label: "待闭环" },
    { key: "all", label: "全部" },
  ];

  return (
    <div className="rounded-xl" style={{ background: C.card, border: `1px solid ${C.border}` }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: C.border }}>
        <GitBranch size={14} style={{ color: C.purple }} />
        <span className="text-xs font-bold" style={{ color: C.text }}>工作流快照</span>
        <span className="text-[9.5px] ml-1" style={{ color: C.faint }}>LLM 语义压缩 · 战略视图</span>
        <div className="ml-auto flex items-center gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className="text-[9.5px] px-2 py-0.5 rounded-lg transition-all"
              style={filter === f.key
                ? { background: "rgba(139,92,246,0.15)", color: C.purple, border: "1px solid rgba(139,92,246,0.3)" }
                : { color: C.faint, border: `1px solid ${C.border}` }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="p-3 space-y-2 max-h-[500px] overflow-y-auto">
        {isLoading ? (
          <div className="py-8 text-center text-xs" style={{ color: C.faint }}>加载工作流快照…</div>
        ) : snapshots.length === 0 ? (
          <div className="py-8 text-center">
            <div className="text-xs font-semibold mb-1" style={{ color: C.faint }}>暂无工作流快照</div>
            <div className="text-[10.5px]" style={{ color: C.faint }}>
              PatientSession 关键节点完成后，Pipeline 引擎自动生成压缩快照
            </div>
          </div>
        ) : (
          snapshots.map((snap) => <SnapshotCard key={snap.id} snap={snap} />)
        )}
      </div>
    </div>
  );
}
