/**
 * MetaTaggingModal — 员工终端「补充上传资料」弹窗
 *
 * 设计目标（modal-v2 契约）：
 * - Chip 自适应：根据 staff.department_id 自动展示本部门 chips，预高亮默认项
 * - 零打字：90% 场景只需选 chip + 点确认
 * - 结构化交接：选中标签封装为 user_interactive_meta，注入 Artifact.original_metadata
 *   供 Agent 编组层读取，提升火车编组准确度
 *
 * 采集能力复用 ReportSheet 的拍照/相册/文件/语音模式。
 */
import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useTheme } from "@/lib/ThemeContext";
import { getChipsForRole } from "@/lib/departments/modalChips";
import { ROLE_TO_DEPARTMENT } from "@/lib/departments/registry";
import { buildUserInteractiveMeta, validateUserInteractiveMeta } from "@/lib/phase5/metaPayload";
import {
  captureFragment, uploadFile, computeChecksum, newClientRequestId,
} from "@/lib/phase5/ingestionClient";
import {
  X, Camera, Image as ImageIcon, FileText, Mic, Square, Loader,
  Send, CheckCircle2, Paperclip,
} from "lucide-react";

const ATT_ICON = { image: ImageIcon, file: FileText, voice: Mic };
const ATT_LABEL = { image: "照片", file: "文件", voice: "语音" };

// chip id → fragment_type 推断（供后端对齐层参考）
function inferFragmentType(attachment) {
  if (!attachment) return "text";
  if (attachment.type === "image") return "image";
  if (attachment.type === "voice") return "audio";
  if (attachment.type === "file") return "document";
  return "text";
}

export default function MetaTaggingModal({ open, staff, clinicId, onClose, onSubmitted }) {
  const { theme } = useTheme();
  const [attachments, setAttachments] = useState([]);
  const [note, setNote] = useState("");
  const [selectedChipId, setSelectedChipId] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  const openTsRef = useRef(null);

  const cameraRef = useRef(null);
  const photoRef = useRef(null);
  const fileRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  // 自适应 chips
  const { role_name, chips } = getChipsForRole(staff?.role);
  const deptId = staff?.department_id || ROLE_TO_DEPARTMENT[staff?.role] || "supplemental";
  const defaultChip = chips.find((c) => c.is_default) || chips[0];

  useEffect(() => {
    if (open) {
      setAttachments([]); setNote(""); setResult(null); setErr(""); setRecording(false);
      setSelectedChipId(defaultChip?.id || null);
      openTsRef.current = Date.now();
    }
  }, [open]);

  if (!open) return null;

  const addImage = async (f) => {
    if (!f) return;
    setUploading(true); setErr("");
    try {
      const file_url = await uploadFile(f);
      if (!file_url) { setErr("图片上传失败"); return; }
      setAttachments((prev) => [...prev, { type: "image", url: file_url, name: f.name, file: f }]);
    } catch { setErr("图片上传失败"); }
    finally { setUploading(false); }
  };

  const addFile = async (f) => {
    if (!f) return;
    setUploading(true); setErr("");
    try {
      const file_url = await uploadFile(f);
      if (!file_url) { setErr("文件上传失败"); return; }
      setAttachments((prev) => [...prev, { type: "file", url: file_url, name: f.name, file: f }]);
    } catch { setErr("文件上传失败"); }
    finally { setUploading(false); }
  };

  const removeAttach = (i) => setAttachments((prev) => prev.filter((_, idx) => idx !== i));

  const toggleVoice = async () => {
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
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type });
        setTranscribing(true);
        try {
          const file_url = await uploadFile(file);
          let transcript = "";
          try { transcript = await base44.integrations.Core.TranscribeAudio({ audio_url: file_url }); } catch {}
          setAttachments((prev) => [...prev, { type: "voice", url: file_url, name: file.name, transcript: transcript || "", file }]);
          if (transcript) setNote((t) => (t ? t + "\n" : "") + "[语音] " + transcript);
        } catch { setErr("语音上传失败"); }
        finally { setTranscribing(false); }
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
    } catch { setErr("无法访问麦克风"); }
  };

  const submit = async () => {
    if (attachments.length === 0 && !note.trim()) { setErr("请添加文件或填写说明"); return; }
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
      // 文本类直接以 text fragment 入站；有附件则逐个 capture
      const payloads = [];
      if (attachments.length === 0 && note.trim()) {
        payloads.push({
          action: "captureFragment",
          clinic_id: clinicId,
          client_request_id: newClientRequestId(),
          fragment_type: "text",
          source: { text: note.trim().slice(0, 8000), mime_type: "text/plain" },
          context: { department: deptId, user_interactive_meta: meta },
        });
      } else {
        for (const a of attachments) {
          const ft = inferFragmentType(a);
          const checksum = a.file ? await computeChecksum(a.file) : null;
          payloads.push({
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
          });
        }
      }

      const responses = [];
      for (const p of payloads) {
        const r = await captureFragment(p);
        responses.push(r);
      }
      setResult({ count: responses.length, ok: responses.every((r) => r?.ok !== false) });
      onSubmitted?.();
    } catch (e) {
      setErr(e?.response?.data?.error || e?.message || "提交失败");
    } finally { setSending(false); }
  };

  const btnBase = { background: theme.canvas, border: `1px solid ${theme.border}` };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="rounded-t-2xl p-4 max-h-[90vh] overflow-y-auto"
        style={{ background: theme.cardBg, border: `1px solid ${theme.border}`, animation: "slideInRight 0.25s ease-out" }}>

        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-bold" style={{ color: theme.text }}>补充上传资料</div>
            <div className="text-[11px] mt-0.5" style={{ color: theme.textMuted }}>{role_name} · 标签自适应</div>
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
            <div className="text-center text-sm font-semibold mb-1" style={{ color: theme.text }}>已上传 {result.count} 份资料</div>
            <div className="text-center text-[11px] mb-4" style={{ color: theme.textSub }}>
              标签「{chips.find((c) => c.id === selectedChipId)?.label}」已随物件送入解析站，Agent 将据此编组
            </div>
            <button onClick={onClose} className="w-full rounded-lg py-2.5 text-sm font-semibold" style={{ background: "linear-gradient(135deg,#00C7D9,#00A8BD)", color: "#0D1B2A" }}>完成</button>
          </div>
        ) : (
          <>
            {/* Zone 3: 资料类型 chips（自适应） */}
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

            {/* Zone 4: 补充说明 */}
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="补充说明（选填）…" rows={2}
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none resize-none mb-3"
              style={{ background: theme.canvas, border: `1px solid ${theme.border}`, color: theme.text }} />

            {/* 一键采集 */}
            <div className="grid grid-cols-4 gap-2 mb-3">
              <button onClick={() => cameraRef.current?.click()} disabled={uploading || recording}
                className="flex flex-col items-center gap-1 py-2.5 rounded-xl transition-all active:scale-95 disabled:opacity-50" style={btnBase}>
                {uploading ? <Loader size={16} className="animate-spin" style={{ color: theme.textSub }} /> : <Camera size={16} style={{ color: "#00C7D9" }} />}
                <span className="text-[10px]" style={{ color: theme.textSub }}>拍照</span>
              </button>
              <button onClick={() => photoRef.current?.click()} disabled={uploading || recording}
                className="flex flex-col items-center gap-1 py-2.5 rounded-xl transition-all active:scale-95 disabled:opacity-50" style={btnBase}>
                <ImageIcon size={16} style={{ color: "#A78BFA" }} />
                <span className="text-[10px]" style={{ color: theme.textSub }}>相册</span>
              </button>
              <button onClick={() => fileRef.current?.click()} disabled={uploading || recording}
                className="flex flex-col items-center gap-1 py-2.5 rounded-xl transition-all active:scale-95 disabled:opacity-50" style={btnBase}>
                <FileText size={16} style={{ color: "#FBBF24" }} />
                <span className="text-[10px]" style={{ color: theme.textSub }}>文件</span>
              </button>
              <button onClick={toggleVoice} disabled={uploading || transcribing}
                className="flex flex-col items-center gap-1 py-2.5 rounded-xl transition-all active:scale-95 disabled:opacity-50"
                style={{ background: recording ? "rgba(220,38,38,0.15)" : theme.canvas, border: `1px solid ${recording ? "rgba(220,38,38,0.5)" : theme.border}` }}>
                {recording ? <Square size={14} style={{ color: "#f87171" }} /> : transcribing ? <Loader size={16} className="animate-spin" style={{ color: theme.textSub }} /> : <Mic size={16} style={{ color: "#f87171" }} />}
                <span className="text-[10px]" style={{ color: recording ? "#f87171" : theme.textSub }}>{recording ? "停止" : transcribing ? "转写" : "语音"}</span>
              </button>
            </div>

            {recording && (
              <div className="flex items-center justify-center gap-2 rounded-xl py-2 mb-3" style={{ background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.3)" }}>
                <span className="w-2 h-2 rounded-full" style={{ background: "#f87171", animation: "pulseRed 1.2s ease-in-out infinite" }} />
                <span className="text-xs font-semibold" style={{ color: "#f87171" }}>录音中… 点击「语音」停止</span>
              </div>
            )}

            {/* 附件列表 */}
            {attachments.length > 0 && (
              <div className="space-y-2 mb-3">
                {attachments.map((a, i) => {
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
                      <button onClick={() => removeAttach(i)} className="p-1 rounded-lg flex-shrink-0" style={{ background: "rgba(255,255,255,0.05)" }}>
                        <X size={13} style={{ color: theme.textSub }} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => { addImage(e.target.files?.[0]); e.target.value = ""; }} />
            <input ref={photoRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => { addImage(e.target.files?.[0]); e.target.value = ""; }} />
            <input ref={fileRef} type="file" className="hidden"
              onChange={(e) => { addFile(e.target.files?.[0]); e.target.value = ""; }} />

            {err && <div className="text-xs mb-3" style={{ color: "#f87171" }}>{err}</div>}

            <button onClick={submit} disabled={sending || uploading || recording || transcribing}
              className="w-full rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
              style={{ background: "linear-gradient(135deg,#00C7D9,#00A8BD)", color: "#0D1B2A" }}>
              {sending ? <Loader size={16} className="animate-spin" /> : <Send size={16} />}
              {sending ? "提交中…" : "确认上传"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}