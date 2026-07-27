/**
 * Clinic OS V10.1 — 闭环工作流批量核销入库抽屉
 * 店长从「院长指挥台」独立入口点开：
 *  - 列出所有已闭环（status=closed）但尚未核销入库的工作流快照
 *  - 每条可「查看」细节、「同意」单条核销入库
 *  - 可勾选多条后「一键核销入库」批量核销
 *  - 核销入库 = 标记 reconciled=true + reconciled_at + reconciled_by（持久化）
 */

import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { useTheme } from "@/lib/ThemeContext";
import {
  X, Eye, CheckCircle2, Loader2, Archive, GitBranch,
  Clock, ArrowRightCircle, FileText, ChevronLeft, Inbox,
} from "lucide-react";

const CLINIC_ID = "clinic-001";
const LINE_LABEL = { optometry: "验光配镜", medical: "眼科医疗", vision_training: "视觉训练" };

function fmtTime(t) {
  if (!t) return "—";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(t));
  } catch { return "—"; }
}

export default function ReconcileBatchDrawer({ open, onClose }) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selected, setSelected] = useState(() => new Set());
  const [detailId, setDetailId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  const q = useQuery({
    queryKey: ["reconcileClosedSnapshots", CLINIC_ID],
    queryFn: () =>
      base44.entities.WorkflowSnapshot.filter(
        { clinic_id: CLINIC_ID, status: "closed" },
        "-manager_closed_at",
        100
      ),
    refetchInterval: 15000,
    enabled: open,
  });

  const pending = useMemo(
    () => (q.data || []).filter((s) => !s.reconciled),
    [q.data]
  );
  const detail = detailId ? (q.data || []).find((s) => s.id === detailId) : null;

  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setDetailId(null);
      setNote("");
      setErr("");
    }
  }, [open]);

  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    if (open) window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  const toggle = (id) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  const toggleAll = () =>
    setSelected((s) =>
      s.size === pending.length ? new Set() : new Set(pending.map((p) => p.id))
    );

  const markReconciled = async (ids, batchNote) => {
    const now = new Date().toISOString();
    const by = user?.id || "manager";
    const payload = {
      reconciled: true,
      reconciled_at: now,
      reconciled_by: by,
      reconcile_note: batchNote || note || "店长核销入库",
    };
    if (ids.length === 1) {
      await base44.entities.WorkflowSnapshot.update(ids[0], payload);
    } else {
      await base44.entities.WorkflowSnapshot.bulkUpdate(
        ids.map((id) => ({ id, ...payload }))
      );
    }
    qc.invalidateQueries({ queryKey: ["reconcileClosedSnapshots", CLINIC_ID] });
    qc.invalidateQueries({ queryKey: ["pendingReconcileSnapshots", CLINIC_ID] });
    qc.invalidateQueries({ queryKey: ["workflowSnapshots", CLINIC_ID] });
  };

  const reconcileOne = async (id) => {
    setBusy(true); setErr("");
    try {
      await markReconciled([id]);
      setSelected((s) => { const n = new Set(s); n.delete(id); return n; });
      if (detailId === id) setDetailId(null);
    } catch (e) { setErr(e.message || "核销失败"); }
    finally { setBusy(false); }
  };

  const reconcileBatch = async () => {
    if (selected.size === 0) return;
    setBusy(true); setErr("");
    try {
      await markReconciled(Array.from(selected), "店长批量核销入库");
      setSelected(new Set());
    } catch (e) { setErr(e.message || "批量核销失败"); }
    finally { setBusy(false); }
  };

  if (!open) return null;

  const allChecked = pending.length > 0 && selected.size === pending.length;

  return (
    <>
      <div
        className="fixed inset-0 z-50 animate-fade-in"
        style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      />
      <div
        className="fixed top-0 right-0 bottom-0 z-50 flex flex-col animate-slide-in-right"
        style={{
          width: "min(560px, 100vw)",
          background: theme.drawerBg,
          borderLeft: `1px solid ${theme.borderSubtle}`,
          boxShadow: "-8px 0 40px rgba(0,0,0,0.3)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: `1px solid ${theme.borderSubtle}`, background: theme.drawerHeader }}
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: "rgba(167,139,250,0.15)", border: "1px solid rgba(167,139,250,0.35)" }}>
              <Inbox size={17} style={{ color: "#A78BFA" }} />
            </div>
            <div>
              <div className="text-base font-bold" style={{ color: theme.text }}>闭环工作流 · 核销入库</div>
              <div className="text-xs" style={{ color: theme.textMuted }}>
                待核销 {pending.length} 条 · 单条同意或勾选批量入库
              </div>
            </div>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(128,128,128,0.1)" }}>
            <X size={16} style={{ color: theme.textSub }} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {detail ? (
            <DetailPane
              snap={detail}
              theme={theme}
              onBack={() => setDetailId(null)}
              onApprove={() => reconcileOne(detail.id)}
              busy={busy}
            />
          ) : (
            <>
              {/* Select-all + batch bar */}
              {pending.length > 0 && (
                <div className="flex items-center gap-3 mb-3 px-1">
                  <button onClick={toggleAll}
                    className="flex items-center gap-2 text-xs"
                    style={{ color: theme.textSub }}>
                    <span className="w-4 h-4 rounded flex items-center justify-center"
                      style={{
                        background: allChecked ? "#A78BFA" : "transparent",
                        border: `1px solid ${allChecked ? "#A78BFA" : theme.border}`,
                      }}>
                      {allChecked && <CheckCircle2 size={11} style={{ color: "#0D1B2A" }} />}
                    </span>
                    {allChecked ? "取消全选" : "全选"}
                  </button>
                  <span className="text-xs ml-auto" style={{ color: theme.textMuted }}>
                    已选 <b style={{ color: "#A78BFA" }}>{selected.size}</b> / {pending.length}
                  </span>
                </div>
              )}

              {/* Note */}
              {pending.length > 0 && (
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="核销备注（可选）"
                  rows={2}
                  className="w-full text-xs rounded-lg px-3 py-2 mb-3 outline-none resize-none"
                  style={{ background: theme.canvas, border: `1px solid ${theme.border}`, color: theme.text }}
                />
              )}

              {err && (
                <div className="text-xs mb-3 px-2 py-1.5 rounded-lg"
                  style={{ color: "#f87171", background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.3)" }}>
                  {err}
                </div>
              )}

              {/* List */}
              {q.isLoading ? (
                <div className="py-12 text-center text-xs" style={{ color: theme.textMuted }}>加载中…</div>
              ) : pending.length === 0 ? (
                <div className="py-12 text-center">
                  <CheckCircle2 size={22} className="mx-auto mb-2" style={{ color: "#4ade80" }} />
                  <div className="text-sm font-semibold" style={{ color: theme.textSub }}>暂无待核销工作流</div>
                  <div className="text-xs mt-1" style={{ color: theme.textMuted }}>所有闭环工作流均已核销入库</div>
                </div>
              ) : (
                <div className="space-y-2">
                  {pending.map((s) => {
                    const checked = selected.has(s.id);
                    return (
                      <div key={s.id}
                        className="rounded-xl p-3"
                        style={{
                          background: theme.canvas,
                          border: `1px solid ${checked ? "rgba(167,139,250,0.5)" : theme.border}`,
                          boxShadow: checked ? "0 0 0 1px rgba(167,139,250,0.3)" : "none",
                        }}>
                        <div className="flex items-center gap-2.5">
                          <button onClick={() => toggle(s.id)}
                            className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                            style={{
                              background: checked ? "#A78BFA" : "transparent",
                              border: `1px solid ${checked ? "#A78BFA" : theme.border}`,
                            }}>
                            {checked && <CheckCircle2 size={11} style={{ color: "#0D1B2A" }} />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <GitBranch size={11} style={{ color: "#8B5CF6" }} />
                              <span className="text-xs font-bold truncate" style={{ color: theme.text }}>
                                {s.patient_name || "未登记患者"}
                              </span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0"
                                style={{ background: "rgba(100,116,139,0.15)", color: theme.textMuted }}>
                                {LINE_LABEL[s.business_line] || s.business_line || "—"}
                              </span>
                              <span className="text-[10px] ml-auto flex-shrink-0" style={{ color: theme.textFaint }}>
                                闭环 {fmtTime(s.manager_closed_at)}
                              </span>
                            </div>
                            <div className="text-[11px] mt-1 line-clamp-2" style={{ color: theme.textSub }}>
                              {s.llm_summary || "压缩摘要生成中…"}
                            </div>
                            {s.nodes_completed && s.nodes_completed.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1 mt-1.5">
                                {s.nodes_completed.slice(0, 4).map((n, i) => (
                                  <span key={i} className="text-[9.5px] px-1.5 py-0.5 rounded"
                                    style={{ background: "rgba(0,199,217,0.08)", color: "#00C7D9" }}>{n}</span>
                                ))}
                                {s.nodes_completed.length > 4 && (
                                  <span className="text-[9.5px]" style={{ color: theme.textFaint }}>+{s.nodes_completed.length - 4}</span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mt-2 pl-6">
                          <button onClick={() => setDetailId(s.id)}
                            className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg"
                            style={{ color: theme.textSub, border: `1px solid ${theme.border}` }}>
                            <Eye size={11} /> 查看
                          </button>
                          <button onClick={() => reconcileOne(s.id)} disabled={busy}
                            className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg font-semibold disabled:opacity-50 ml-auto"
                            style={{ background: "rgba(167,139,250,0.15)", color: "#A78BFA", border: "1px solid rgba(167,139,250,0.35)" }}>
                            {busy ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />} 同意核销
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Batch footer */}
        {!detail && pending.length > 0 && (
          <div className="flex-shrink-0 px-4 py-3" style={{ borderTop: `1px solid ${theme.borderSubtle}`, background: theme.drawerHeader }}>
            <button onClick={reconcileBatch} disabled={busy || selected.size === 0}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold disabled:opacity-40"
              style={{ background: "linear-gradient(135deg,#A78BFA,#8B5CF6)", color: "#0D1B2A" }}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Archive size={15} />}
              一键核销入库{selected.size > 0 ? `（${selected.size}）` : ""}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function DetailPane({ snap, theme, onBack, onApprove, busy }) {
  return (
    <div>
      <button onClick={onBack}
        className="flex items-center gap-1 text-xs mb-3" style={{ color: theme.textSub }}>
        <ChevronLeft size={14} /> 返回列表
      </button>

      <div className="rounded-xl p-4 mb-3" style={{ background: theme.canvas, border: `1px solid ${theme.border}` }}>
        <div className="flex items-center gap-2 mb-2">
          <GitBranch size={13} style={{ color: "#8B5CF6" }} />
          <span className="text-sm font-bold" style={{ color: theme.text }}>
            {snap.patient_name || "未登记患者"}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded"
            style={{ background: "rgba(100,116,139,0.15)", color: theme.textMuted }}>
            {LINE_LABEL[snap.business_line] || snap.business_line || "—"}
          </span>
          <span className="text-[10px] ml-auto" style={{ color: theme.textFaint }}>
            闭环于 {fmtTime(snap.manager_closed_at)}
          </span>
        </div>

        <div className="text-xs mb-3" style={{ color: theme.textSub, lineHeight: 1.6 }}>
          {snap.llm_summary || "压缩摘要生成中…"}
        </div>

        {snap.llm_recommendation && (
          <div className="text-[11px] px-2.5 py-1.5 rounded-lg mb-3"
            style={{ background: "rgba(0,199,217,0.06)", color: "#00C7D9", border: "1px solid rgba(0,199,217,0.15)" }}>
            💡 {snap.llm_recommendation}
          </div>
        )}

        {snap.nodes_completed && snap.nodes_completed.length > 0 && (
          <div className="mb-3">
            <div className="text-[10px] mb-1.5 font-semibold" style={{ color: theme.textMuted }}>业务链路</div>
            <div className="flex flex-wrap items-center gap-1">
              {snap.nodes_completed.map((n, i) => (
                <span key={i} className="text-[10px] px-1.5 py-0.5 rounded"
                  style={{ background: "rgba(0,199,217,0.08)", color: "#00C7D9" }}>{n}</span>
              ))}
              {snap.current_node && !snap.nodes_completed.includes(snap.current_node) && (
                <>
                  <ArrowRightCircle size={10} style={{ color: theme.textFaint }} />
                  <span className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{ background: "rgba(100,116,139,0.12)", color: theme.textSub }}>{snap.current_node}</span>
                </>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 mb-3">
          <MiniStat label="总耗时" value={`${snap.total_elapsed_minutes || 0}分`} theme={theme} />
          <MiniStat label="证据单据" value={`${(snap.artifact_ids || []).length} 张`} theme={theme} />
          <MiniStat label="事实卡" value={`${(snap.evidence_fact_card_ids || []).length} 条`} theme={theme} />
        </div>

        {snap.manager_note && (
          <div className="text-[11px] px-2.5 py-1.5 rounded-lg"
            style={{ background: "rgba(100,116,139,0.08)", color: theme.textSub, border: `1px solid ${theme.border}` }}>
            闭环备注：{snap.manager_note}
          </div>
        )}
      </div>

      <button onClick={onApprove} disabled={busy}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50"
        style={{ background: "linear-gradient(135deg,#A78BFA,#8B5CF6)", color: "#0D1B2A" }}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
        同意并核销入库
      </button>
    </div>
  );
}

function MiniStat({ label, value, theme }) {
  return (
    <div className="rounded-lg p-2 text-center" style={{ background: theme.canvas, border: `1px solid ${theme.border}` }}>
      <div className="text-sm font-bold tabular-nums" style={{ color: theme.text }}>{value}</div>
      <div className="text-[10px]" style={{ color: theme.textMuted }}>{label}</div>
    </div>
  );
}