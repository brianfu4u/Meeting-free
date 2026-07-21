/**
 * MetaTaggingModal — 事件流文件上传后的自动标签弹窗（4 选 1）
 *
 * 触发时机：ReportSheet 提交成功且包含附件时自动弹出。
 * 设计目标（modal-v2 契约）：
 * - 只展示已上传文件（只读），不重复采集
 * - Chip 自适应：根据 staff.department_id 自动展示本部门 chips，预高亮默认项
 * - 零打字：90% 场景只需选 chip + 点确认
 * - 结构化交接：选中标签封装为 user_interactive_meta，注入 Artifact.original_metadata
 *   供 Agent 编组层读取，提升火车编组准确度
 */
import { useState, useEffect, useRef } from "react";
import { useTheme } from "@/lib/ThemeContext";
import { getChipsForRole } from "@/lib/departments/modalChips";
import { ROLE_TO_DEPARTMENT } from "@/lib/departments/registry";
import { buildUserInteractiveMeta, validateUserInteractiveMeta } from "@/lib/phase5/metaPayload";
import {
  captureFragment, computeChecksum, newClientRequestId,
} from "@/lib/phase5/ingestionClient";
import {
  X, Send, Loader, CheckCircle2, Paperclip, Image as ImageIcon, FileText, Mic, Tag,
} from "lucide-react";

const ATT_ICON = { image: ImageIcon, file: FileText, voice: Mic };
const ATT_LABEL = { image: "照片", file: "文件", voice: "语音" };

function inferFragmentType(attachment) {
  if (!attachment) return "text";
  if (attachment.type === "image") return "image";
  if (attachment.type === "voice") return "audio";
  if (attachment.type === "file") return "document";
  return "text";
}

export default function MetaTaggingModal({ open, attachments, staff, clinicId, onClose, onSubmitted }) {
  const { theme } = useTheme();
  const [note, setNote] = useState("");
  const [selectedChipId, setSelectedChipId] = useState(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  const openTsRef = useRef(null);

  const { role_name, chips } = getChipsForRole(staff?.role);
  const deptId = staff?.department_id || ROLE_TO_DEPARTMENT[staff?.role] || "supplemental";
  const defaultChip = chips.find((c) => c.is_default) || chips[0];
  const files = attachments || [];

  useEffect(() => {
    if (open) {
      setNote(""); setResult(null); setErr("");
      setSelectedChipId(defaultChip?.id || null);
      openTsRef.current = Date.now();
    }
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    if (files.length === 0) { setErr("没有可标记的文件"); return; }
    if (!selectedChipId) { setErr("请选择资料类型"); return; }

    const selectedChip = chips.find((c) => c.id === selectedChipId);
    const wasPrefill = selectedChip?.is_default === true;
    const latency = openTsRef.current ? Date.now() - openTsRef.current : null;

    const meta = buildUserInteractiveMeta({
      role_id: staff?.role,
      dept_id: deptId,
      category_id: selectedChipId,
      category_label: selectedChip?.label,
      note: note.trim() || null,
      capture_latency_ms: latency,
      was_prefill: wasPrefill,
    });
    const v = validateUserInteractiveMeta(meta);
    if (!v.ok) { setErr(`标签数据不完整：${v.reason}`); return; }

    setSending(true); setErr("");
    try {
      const responses = [];
      for (const a of files) {
        const ft = inferFragmentType(a);
        const checksum = a.file ? await computeChecksum(a.file) : null;
        const payload = {
          action: "captureFragment",
          clinic_id: clinicId,
          client_request_id: newClientRequestId(),
          fragment_type: ft,
          source: {
            file_url: a.url,
            mime_type: a.file?.type || (ft === "image" ? "image/jpeg" : ft === "audio" ? "audio/webm" : "application/pdf"),
            original_filename: a.name,
            file_size: a.file?.size ?? null,
            checksum,
          },
          context: {
            department: deptId,
            user_interactive_meta: meta,
            ...(a.transcript ? { client_text_hint: a.transcript.slice(0, 2000) } : {}),
          },
        };
        responses.push(await captureFragment(payload));
      }
      setResult({ count: responses.length, ok: responses.every((r) => r?.ok !== false) });
      onSubmitted?.();
    } catch (e) {
      setErr(e?.response?.data?.error || e?.message || "提交失败");
    } finally { setSending(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="rounded-t-2xl p-4 max-h-[88vh] overflow-y-auto"
        style={{ background: theme.cardBg, border: `1px solid ${theme.border}`, animation: "slideInRight 0.25s ease-out" }}>

        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Tag size={16} style={{ color: "#00C7D9" }} />
            <div>
              <div className="text-sm font-bold" style={{ color: theme.text }}>给这份资料选个类型</div>
              <div className="text-[11px] mt-0.5" style={{ color: theme.textMuted }}>{role_name} · 标签帮助 AI 编组</div>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg" style={{ background: "rgba(255,255,255,0.05)" }}>
            <X size={16} style={{ color: theme.textSub }} />
          </button>
        </div>

        {result ? (
          <div className="py-6">
            <div className="w-12 h-12 rounded-full mx-auto flex items-center justify-center mb-3" style={{ background: "rgba(22,163,74,0.15)", border: "1px solid rgba(22,163,74,0.4)" }}>
              <CheckCircle2 size={26} style={{ color: "#4ade80" }} />
            </div>
            <div className="text-center text-sm font-semibold mb-1" style={{ color: theme.text }}>已标记 {result.count} 份资料</div>
            <div className="text-center text-[11px] mb-4" style={{ color: theme.textSub }}>
              标签「{chips.find((c) => c.id === selectedChipId)?.label}」已随物件送入解析站，Agent 将据此编组
            </div>
            <button onClick={onClose} className="w-full rounded-lg py-2.5 text-sm font-semibold" style={{ background: "linear-gradient(135deg,#00C7D9,#00A8BD)", color: "#0D1B2A" }}>完成</button>
          </div>
        ) : (
          <>
            {/* 已上传文件清单（只读） */}
            {files.length > 0 && (
              <div className="space-y-2 mb-3">
                {files.map((a, i) => {
                  const Icon = ATT_ICON[a.type] || Paperclip;
                  return (
                    <div key={i} className="flex items-center gap-2 rounded-xl p-2" style={{ background: theme.canvas, border: `1px solid ${theme.border}` }}>
                      {a.type === "image"
                        ? <img src={a.url} alt="" className="w-9 h-9 rounded-lg object-cover flex-shrink-0" />
                        : <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(148,163,184,0.1)" }}><Icon size={15} style={{ color: theme.textSub }} /></div>}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs truncate" style={{ color: theme.text }}>{ATT_LABEL[a.type] || a.type} · {a.name}</div>
                        {a.transcript && <div className="text-[10px] truncate" style={{ color: theme.textFaint }}>转写：{a.transcript.slice(0, 40)}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 资料类型 chips（4 选 1，自适应） */}
            <div className="mb-3">
              <div className="text-[11px] font-semibold mb-2" style={{ color: theme.textSub }}>这份资料属于哪个类型？</div>
              <div className="flex flex-wrap gap-2">
                {chips.map((c) => {
                  const active = c.id === selectedChipId;
                  return (
                    <button key={c.id} onClick={() => setSelectedChipId(c.id)}
                      className="px-3 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95"
                      style={active
                        ? { background: "rgba(0,199,217,0.18)", color: "#00C7D9", border: "1px solid rgba(0,199,217,0.5)", boxShadow: "0 0 0 1px rgba(0,199,217,0.2)" }
                        : { background: theme.canvas, color: theme.textSub, border: `1px solid ${theme.border}` }}>
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 补充说明（选填） */}
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="补充说明（选填）…" rows={2}
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none resize-none mb-3"
              style={{ background: theme.canvas, border: `1px solid ${theme.border}`, color: theme.text }} />

            {err && <div className="text-xs mb-3" style={{ color: "#f87171" }}>{err}</div>}

            <button onClick={submit} disabled={sending}
              className="w-full rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
              style={{ background: "linear-gradient(135deg,#00C7D9,#00A8BD)", color: "#0D1B2A" }}>
              {sending ? <Loader size={16} className="animate-spin" /> : <Send size={16} />}
              {sending ? "提交中…" : "确认"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}