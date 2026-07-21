import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useTheme } from "@/lib/ThemeContext";
import { X, Camera, Image as ImageIcon, FileText, Mic, Square, Loader, Send, CheckCircle2, Sparkles, Paperclip } from "lucide-react";

const MODE_META = {
  new_event: { title: "发起新事件", placeholder: "描述你遇到的情况、需求或异常…（可只传附件）", submitText: "提交汇报" },
  progress: { title: "进度汇报", placeholder: "说明当前进展…（可附照片/语音）", submitText: "提交进度" },
  completion: { title: "完成提交", placeholder: "补充完成说明（选填）…", submitText: "提交完成" },
};

const ATT_ICON = { image: ImageIcon, file: FileText, voice: Mic };
const ATT_LABEL = { image: "照片", file: "文件", voice: "语音" };

export default function ReportSheet({ open, mode, taskId, staff, onClose, onSubmitted, onTagAttachments }) {
  const { theme } = useTheme();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  const cameraRef = useRef(null);
  const photoRef = useRef(null);
  const fileRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  useEffect(() => {
    if (open) { setText(""); setAttachments([]); setResult(null); setErr(""); setRecording(false); }
  }, [open, mode]);

  if (!open) return null;
  const meta = MODE_META[mode] || MODE_META.new_event;

  const addImage = async (f) => {
    if (!f) return;
    setUploading(true); setErr("");
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file: f });
      setAttachments((prev) => [...prev, { type: "image", url: file_url, name: f.name }]);
    } catch (e) { setErr("图片上传失败"); }
    finally { setUploading(false); }
  };

  const addFile = async (f) => {
    if (!f) return;
    setUploading(true); setErr("");
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file: f });
      setAttachments((prev) => [...prev, { type: "file", url: file_url, name: f.name }]);
    } catch (e) { setErr("文件上传失败"); }
    finally { setUploading(false); }
  };

  const removeAttach = (i) => setAttachments((prev) => prev.filter((_, idx) => idx !== i));

  const toggleVoice = async () => {
    if (recording) {
      mediaRecorderRef.current?.stop();
      return;
    }
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
          const { file_url } = await base44.integrations.Core.UploadFile({ file });
          let transcript = "";
          try { transcript = await base44.integrations.Core.TranscribeAudio({ audio_url: file_url }); } catch (e) {}
          setAttachments((prev) => [...prev, { type: "voice", url: file_url, name: file.name, transcript: transcript || "" }]);
          if (transcript) setText((t) => (t ? t + "\n" : "") + "[语音] " + transcript);
        } catch (e) { setErr("语音上传失败"); }
        finally { setTranscribing(false); }
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
    } catch (e) { setErr("无法访问麦克风"); }
  };

  const submit = async () => {
    const hasContent = text.trim() || attachments.length > 0;
    if (!hasContent) { setErr("请填写内容或添加附件"); return; }
    if (mode === "completion" && !attachments.some((a) => a.type === "image")) {
      setErr("完成提交需上传证据照片"); return;
    }
    setSending(true); setErr("");
    try {
      const payload = {
        report_type: mode,
        text: text.trim(),
        staff_id: staff.id,
        attachments: attachments.map((a) => ({ type: a.type, url: a.url, name: a.name, transcript: a.transcript || "" })),
      };
      if (taskId) payload.task_id = taskId;
      const res = await base44.functions.invoke("staffReportService", payload);
      setResult(res.data || res);
      onSubmitted?.();
    } catch (e2) {
      setErr(e2?.response?.data?.error || e2?.message || "提交失败");
    } finally { setSending(false); }
  };

  const btnBase = { background: theme.canvas, border: `1px solid ${theme.border}` };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="rounded-t-2xl p-4 max-h-[88vh] overflow-y-auto"
        style={{ background: theme.cardBg, border: `1px solid ${theme.border}`, animation: "slideInRight 0.25s ease-out" }}>

        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-bold" style={{ color: theme.text }}>{meta.title}</div>
          <button onClick={onClose} className="p-1 rounded-lg" style={{ background: "rgba(255,255,255,0.05)" }}>
            <X size={16} style={{ color: theme.textSub }} />
          </button>
        </div>

        {result ? (
          <div className="py-4">
            <div className="w-12 h-12 rounded-full mx-auto flex items-center justify-center mb-3" style={{ background: "rgba(22,163,74,0.15)", border: "1px solid rgba(22,163,74,0.4)" }}>
              <CheckCircle2 size={26} style={{ color: "#4ade80" }} />
            </div>
            <div className="text-center text-sm font-semibold mb-3" style={{ color: theme.text }}>已提交，子服务已存档</div>
            <div className="rounded-xl p-3 mb-3" style={{ background: theme.canvas, border: `1px solid ${theme.border}` }}>
              <div className="flex items-center gap-1.5 mb-2">
                <Sparkles size={12} style={{ color: "#A78BFA" }} />
                <span className="text-xs font-bold" style={{ color: "#A78BFA" }}>AI 语意解析</span>
              </div>
              <div className="text-xs mb-1.5" style={{ color: theme.textSub }}>分类：{result.parsed?.category || "—"}</div>
              <div className="text-xs mb-1.5" style={{ color: theme.textSub }}>摘要：{result.parsed?.summary || "—"}</div>
              {result.parsed?.suggested_action && <div className="text-xs" style={{ color: theme.textSub }}>建议：{result.parsed.suggested_action}</div>}
            </div>
            <button onClick={() => {
              if (attachments.length > 0 && onTagAttachments) onTagAttachments(attachments);
              onClose();
            }} className="w-full rounded-lg py-2.5 text-sm font-semibold" style={{ background: "linear-gradient(135deg,#00C7D9,#00A8BD)", color: "#0D1B2A" }}>
              {attachments.length > 0 ? "下一步：选标签" : "完成"}
            </button>
          </div>
        ) : (
          <>
            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={meta.placeholder} rows={3}
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none resize-none mb-3"
              style={{ background: theme.canvas, border: `1px solid ${theme.border}`, color: theme.text }} />

            {/* 一键采集按钮 */}
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
                      {a.type === "image" ? (
                        <img src={a.url} alt="" className="w-9 h-9 rounded-lg object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(148,163,184,0.1)" }}>
                          <Icon size={15} style={{ color: theme.textSub }} />
                        </div>
                      )}
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

            {/* 隐藏输入：拍照 / 相册 / 文件 */}
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => { addImage(e.target.files?.[0]); e.target.value = ""; }} />
            <input ref={photoRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => { addImage(e.target.files?.[0]); e.target.value = ""; }} />
            <input ref={fileRef} type="file" className="hidden"
              onChange={(e) => { addFile(e.target.files?.[0]); e.target.value = ""; }} />

            {err && <div className="text-xs mb-3" style={{ color: "#f87171" }}>{err}</div>}

            <button onClick={submit} disabled={sending || uploading || recording || transcribing}
              className="w-full rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
              style={{ background: "linear-gradient(135deg,#FB923C,#F97316)", color: "#0D1B2A" }}>
              {sending ? <Loader size={16} className="animate-spin" /> : <Send size={16} />}
              {sending ? "提交中…" : meta.submitText}
            </button>
          </>
        )}
      </div>
    </div>
  );
}