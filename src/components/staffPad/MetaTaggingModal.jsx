/**
 * MetaTaggingModal — 上传后立即弹出的多选标签弹窗
 *
 * 触发时机：ReportSheet 每上传一个附件后立即弹出（内联，提交前）。
 * 设计目标（modal-v2 契约）：
 * - 只针对刚上传的那一个文件
 * - Chip 自适应：根据 staff.department_id 展示本部门 chips，可多选
 * - 零打字：选 chip + 点确认
 * - 确认后随物件注入 fragmentIngestionService → Artifact.original_metadata.user_interactive_meta
 *   供 Agent 编组层读取，提升火车编组准确度
 */
import { useState, useEffect, useRef } from "react";
import { useTheme } from "@/lib/ThemeContext";
import { getChipsForRole } from "@/lib/departments/modalChips";
import { ROLE_TO_DEPARTMENT } from "@/lib/departments/registry";
import { buildUserInteractiveMeta, validateUserInteractiveMeta } from "@/lib/phase5/metaPayload";
import { captureFragment, computeChecksum, newClientRequestId } from "@/lib/phase5/ingestionClient";
import { base44 } from "@/api/base44Client";
import { X, Send, Loader, CheckCircle2, Paperclip, Image as ImageIcon, FileText, Mic, Tag } from "lucide-react";

const ATT_ICON = { image: ImageIcon, file: FileText, voice: Mic };
const ATT_LABEL = { image: "照片", file: "文件", voice: "语音" };

function inferFragmentType(attachment) {
  if (!attachment) return "text";
  if (attachment.type === "image") return "image";
  if (attachment.type === "voice") return "audio";
  if (attachment.type === "file") return "document";
  return "text";
}

export default function MetaTaggingModal({ open, attachment, staff, clinicId, onClose, onConfirmed }) {
  const { theme } = useTheme();
  const [selected, setSelected] = useState([]);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const openTsRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  const toggleVoiceNote = async () => {
    if (recording) { mediaRecorderRef.current?.stop(); return; }
    setErr("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        if (!blob.size) return;
        const file = new File([blob], `note-${Date.now()}.webm`, { type: blob.type });
        setTranscribing(true);
        try {
          const { file_url } = await base44.integrations.Core.UploadFile({ file });
          const transcript = await base44.integrations.Core.TranscribeAudio({ audio_url: file_url });
          if (transcript) setNote((n) => (n ? n + " " : "") + transcript);
        } catch { setErr("语音转写失败"); }
        finally { setTranscribing(false); }
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
    } catch { setErr("无法访问麦克风"); }
  };

  useEffect(() => {
    return () => { if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop(); };
  }, []);

  const { role_name, chips } = getChipsForRole(staff?.role);
  const deptId = staff?.department_id || ROLE_TO_DEPARTMENT[staff?.role] || "supplemental";
  const defaultChip = chips.find((c) => c.is_default);

  useEffect(() => {
    if (open) {
      setNote(""); setResult(null); setErr("");
      setSelected(defaultChip ? [defaultChip.id] : []);
      openTsRef.current = Date.now();
      setRecording(false); setTranscribing(false);
    }
  }, [open]);

  if (!open) return null;

  const toggle = (id) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const submit = async () => {
    if (!attachment) { setErr("没有可标记的文件"); return; }
    if (selected.length === 0) { setErr("请至少选择一个类型"); return; }

    const selectedLabels = chips.filter((c) => selected.includes(c.id)).map((c) => c.label);
    const wasPrefill = selected.length === 1 && defaultChip && selected[0] === defaultChip.id;
    const latency = openTsRef.current ? Date.now() - openTsRef.current : null;

    const meta = buildUserInteractiveMeta({
      role_id: staff?.role,
      dept_id: deptId,
      category_id: selected.join(","),
      category_label: selectedLabels.join(" / "),
      note: note.trim() || null,
      capture_latency_ms: latency,
      was_prefill: wasPrefill,
    });
    const v = validateUserInteractiveMeta(meta);
    if (!v.ok) { setErr(`标签数据不完整：${v.reason}`); return; }

    setSending(true); setErr("");
    try {
      const ft = inferFragmentType(attachment);
      const checksum = attachment.file ? await computeChecksum(attachment.file) : null;
      const payload = {
        action: "captureFragment",
        clinic_id: clinicId,
        client_request_id: newClientRequestId(),
        fragment_type: ft,
        source: {
          file_url: attachment.url,
          mime_type: attachment.file?.type || (ft === "image" ? "image/jpeg" : ft === "audio" ? "audio/webm" : "application/pdf"),
          original_filename: attachment.name,
          file_size: attachment.file?.size ?? null,
          checksum,
        },
        context: {
          department: deptId,
          user_interactive_meta: meta,
          ...(attachment.transcript ? { client_text_hint: attachment.transcript.slice(0, 2000) } : {}),
        },
      };
      const res = await captureFragment(payload);
      setResult({ ok: true, tags: selectedLabels, preview: res?.parse_preview || null });
      onConfirmed?.(selected, attachment);
    } catch (e) {
      const code = e?.error_code || e?.response?.data?.error_code;
      const base = e?.response?.data?.error || e?.message || "提交失败";
      setErr(code === "url_not_whitelisted" ? `${base}（${attachment?.url || "无URL"}）` : base);
    } finally { setSending(false); }
  };

  const Icon = ATT_ICON[attachment?.type] || Paperclip;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end" style={{ background: "rgba(0,0,0,0.55)" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="rounded-t-2xl p-4 max-h-[88vh] overflow-y-auto"
        style={{ background: theme.cardBg, border: `1px solid ${theme.border}`, animation: "slideInRight 0.25s ease-out" }}>

        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Tag size={16} style={{ color: "#00C7D9" }} />
            <div>
              <div className="text-sm font-bold" style={{ color: theme.text }}>给这份资料选类型</div>
              <div className="text-[11px] mt-0.5" style={{ color: theme.textMuted }}>{role_name} · 可多选，帮 AI 编组</div>
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
            <div className="text-center text-sm font-semibold mb-1" style={{ color: theme.text }}>已标记</div>
            <div className="text-center text-[11px] mb-3" style={{ color: theme.textSub }}>
              标签「{result.tags.join(" / ")}」已随物件送入解析站
            </div>
            {result.preview && (
              <div className="rounded-xl p-3 mb-3 text-left" style={{ background: theme.canvas, border: `1px solid ${theme.border}` }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold" style={{ color: theme.text }}>解析结果</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: "rgba(0,199,217,0.12)", color: "#00C7D9" }}>{result.preview.alignment_status}</span>
                </div>
                {result.preview.extracted_text && (
                  <div className="mb-2">
                    <div className="text-[10px] mb-1" style={{ color: theme.textMuted }}>OCR 文本</div>
                    <div className="text-[11px] leading-relaxed max-h-24 overflow-y-auto" style={{ color: theme.text, whiteSpace: "pre-wrap" }}>{result.preview.extracted_text}</div>
                  </div>
                )}
                {result.preview.fields && result.preview.fields.length > 0 && (
                  <div>
                    <div className="text-[10px] mb-1" style={{ color: theme.textMuted }}>提取字段（{result.preview.fields.length}）</div>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {result.preview.fields.map((f, i) => (
                        <div key={i} className="flex items-start gap-1.5">
                          <span className="px-1 py-0.5 rounded text-[9px] font-semibold flex-shrink-0" style={{ background: "rgba(148,163,184,0.15)", color: theme.textSub }}>{f.field_name}</span>
                          <span className="text-[11px] flex-1 break-all" style={{ color: theme.text }}>{f.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {result.preview.quality_issues && result.preview.quality_issues.length > 0 && (
                  <div className="mt-2 pt-2 text-[10px]" style={{ borderTop: `1px solid ${theme.border}`, color: theme.textMuted }}>
                    质量告警：{result.preview.quality_issues.join("、")}
                  </div>
                )}
              </div>
            )}
            <button onClick={onClose} className="w-full rounded-lg py-2.5 text-sm font-semibold" style={{ background: "linear-gradient(135deg,#00C7D9,#00A8BD)", color: "#0D1B2A" }}>完成</button>
          </div>
        ) : (
          <>
            {/* 刚上传的文件（只读） */}
            {attachment && (
              <div className="flex items-center gap-2 rounded-xl p-2 mb-3" style={{ background: theme.canvas, border: `1px solid ${theme.border}` }}>
                {attachment.type === "image"
                  ? <img src={attachment.url} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                  : <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(148,163,184,0.1)" }}><Icon size={16} style={{ color: theme.textSub }} /></div>}
                <div className="flex-1 min-w-0">
                  <div className="text-xs truncate" style={{ color: theme.text }}>{ATT_LABEL[attachment.type] || attachment.type} · {attachment.name}</div>
                  {attachment.transcript && <div className="text-[10px] truncate" style={{ color: theme.textFaint }}>转写：{attachment.transcript.slice(0, 40)}</div>}
                </div>
              </div>
            )}

            {/* 资料类型 chips（多选，自适应） */}
            <div className="mb-3">
              <div className="text-[11px] font-semibold mb-2" style={{ color: theme.textSub }}>这份资料属于哪些类型？（可多选）</div>
              <div className="flex flex-wrap gap-2">
                {chips.map((c) => {
                  const active = selected.includes(c.id);
                  return (
                    <button key={c.id} onClick={() => toggle(c.id)}
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

            {/* 补充说明（选填，支持语音输入） */}
            <div className="relative mb-3">
              <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="补充说明（选填）… 点右上麦克风语音输入" rows={2}
                className="w-full rounded-xl px-3 py-2.5 pr-10 text-sm outline-none resize-none"
                style={{ background: theme.canvas, border: `1px solid ${recording ? "rgba(220,38,38,0.5)" : theme.border}`, color: theme.text }} />
              <button type="button" onClick={toggleVoiceNote} disabled={transcribing}
                title={recording ? "停止录音" : "语音输入"}
                className="absolute top-2 right-2 p-1.5 rounded-lg disabled:opacity-50"
                style={{ background: recording ? "rgba(220,38,38,0.15)" : "rgba(255,255,255,0.05)" }}>
                {recording
                  ? <span className="w-2.5 h-2.5 rounded-full" style={{ background: "#f87171", animation: "pulseRed 1.2s ease-in-out infinite" }} />
                  : transcribing ? <Loader size={14} className="animate-spin" style={{ color: theme.textSub }} /> : <Mic size={14} style={{ color: recording ? "#f87171" : theme.textSub }} />}
              </button>
            </div>

            {err && <div className="text-xs mb-3" style={{ color: "#f87171" }}>{err}</div>}

            <button onClick={submit} disabled={sending || !attachment || recording || transcribing}
              className="w-full rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
              style={{ background: "linear-gradient(135deg,#00C7D9,#00A8BD)", color: "#0D1B2A" }}>
              {sending ? <Loader size={16} className="animate-spin" /> : <Send size={16} />}
              {sending ? "提交中…" : recording ? "录音中…" : transcribing ? "转写中…" : "确认"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}