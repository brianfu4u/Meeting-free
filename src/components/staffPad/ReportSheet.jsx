import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useTheme } from "@/lib/ThemeContext";
import { persistEyeExamMetadataForBridgeResults } from "@/lib/phase5/ingestionClient";
import MetaTaggingModal from "@/components/staffPad/MetaTaggingModal";
import {
  X, Camera, Image as ImageIcon, FileText, Mic, Square, Loader,
  Send, CheckCircle2, Sparkles, Paperclip, Plus, AlertTriangle, RotateCcw,
} from "lucide-react";

const MODE_META = {
  new_event: { title: "发起新事件", placeholder: "描述你遇到的情况、需求或异常…（可只传附件）", submitText: "提交" },
  progress: { title: "进度汇报", placeholder: "说明当前进展…（可附照片/语音）", submitText: "提交" },
  completion: { title: "完成提交", placeholder: "补充完成说明（选填）…", submitText: "提交" },
};

const ATT_ICON = { image: ImageIcon, file: FileText, voice: Mic };
const ATT_LABEL = { image: "照片", file: "文件", voice: "语音" };

const ATTACH_MENU = [
  { key: "camera", icon: Camera, label: "拍照", color: "#00C7D9" },
  { key: "album", icon: ImageIcon, label: "相册", color: "#A78BFA" },
  { key: "file", icon: FileText, label: "文件", color: "#FBBF24" },
];

export default function ReportSheet({ open, mode, taskId, staff, clinicId, onClose, onSubmitted }) {
  const { theme } = useTheme();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  const [taggingAttachment, setTaggingAttachment] = useState(null);
  const [showAttachMenu, setShowAttachMenu] = useState(false);

  const cameraRef = useRef(null);
  const photoRef = useRef(null);
  const fileRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const attachMenuRef = useRef(null);
  const retakeIndexRef = useRef(null);

  useEffect(() => {
    if (open) {
      setText(""); setAttachments([]); setResult(null); setErr("");
      setRecording(false); setTaggingAttachment(null); setShowAttachMenu(false);
      retakeIndexRef.current = null;
    }
  }, [open, mode]);

  useEffect(() => {
    if (!showAttachMenu) return;
    const handler = (e) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target)) setShowAttachMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showAttachMenu]);

  if (!open) return null;
  const meta = MODE_META[mode] || MODE_META.new_event;

  const addImage = async (f) => {
    if (!f) return;
    setUploading(true); setErr("");
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file: f });
      const att = { type: "image", url: file_url, name: f.name, file: f };
      const idx = retakeIndexRef.current;
      if (idx !== null && idx !== undefined) {
        setAttachments((prev) => prev.map((item, i) => (i === idx ? att : item)));
        retakeIndexRef.current = null;
      } else {
        setAttachments((prev) => [...prev, att]);
      }
      setTaggingAttachment(att);
    } catch (e) { setErr("图片上传失败"); retakeIndexRef.current = null; }
    finally { setUploading(false); }
  };

  const addFile = async (f) => {
    if (!f) return;
    setUploading(true); setErr("");
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file: f });
      const att = { type: "file", url: file_url, name: f.name, file: f };
      setAttachments((prev) => [...prev, att]);
      setTaggingAttachment(att);
    } catch (e) { setErr("文件上传失败"); }
    finally { setUploading(false); }
  };

  const removeAttach = (i) => setAttachments((prev) => prev.filter((_, idx) => idx !== i));

  const retakeAttach = (i) => {
    retakeIndexRef.current = i;
    setShowAttachMenu(false);
    cameraRef.current?.click();
  };

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
          const { file_url } = await base44.integrations.Core.UploadFile({ file });
          let transcript = "";
          try { transcript = await base44.integrations.Core.TranscribeAudio({ audio_url: file_url }); } catch (e) {}
          const att = { type: "voice", url: file_url, name: file.name, transcript: transcript || "", file };
          setAttachments((prev) => [...prev, att]);
          setTaggingAttachment(att);
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
      const responseData = res.data || res;
      await persistEyeExamMetadataForBridgeResults({
        clinicId,
        bridgeResults: responseData?.evidence_bridge || [],
      });
      setResult(responseData);
      onSubmitted?.();
    } catch (e2) {
      setErr(e2?.response?.data?.error || e2?.message || "提交失败");
    } finally { setSending(false); }
  };

  const canSend = !sending && !uploading && !recording && !transcribing && (text.trim().length > 0 || attachments.length > 0);
  const hasWarnedAttach = attachments.some((a) => a.qualityWarning);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded-t-3xl px-4 pt-2.5 pb-4 max-h-[92vh] overflow-y-auto"
        style={{ background: theme.cardBg, border: `1px solid ${theme.border}`, animation: "slideInRight 0.25s ease-out" }}
      >
        {/* 抓手 */}
        <div className="flex justify-center mb-2">
          <div className="w-9 h-1 rounded-full" style={{ background: theme.border }} />
        </div>

        {/* 标题栏 */}
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-bold" style={{ color: theme.text }}>{meta.title}</div>
          <button onClick={onClose} className="p-1.5 rounded-full transition-all active:scale-90" style={{ background: "rgba(255,255,255,0.06)" }}>
            <X size={15} style={{ color: theme.textSub }} />
          </button>
        </div>

        {result ? (
          <div className="py-3">
            <div className="w-11 h-11 rounded-full mx-auto flex items-center justify-center mb-3" style={{ background: "rgba(22,163,74,0.15)", border: "1px solid rgba(22,163,74,0.4)" }}>
              <CheckCircle2 size={24} style={{ color: "#4ade80" }} />
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
            <button onClick={onClose} className="w-full rounded-full py-2.5 text-sm font-semibold" style={{ background: "linear-gradient(135deg,#00C7D9,#00A8BD)", color: "#0D1B2A" }}>完成</button>
          </div>
        ) : (
          <>
            {/* 附件预览横滚条 */}
            {attachments.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-2 mb-2.5" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                {attachments.map((a, i) => {
                  const Icon = ATT_ICON[a.type] || Paperclip;
                  const warned = a.qualityWarning;
                  return (
                    <div
                      key={i}
                      className="relative flex-shrink-0 rounded-xl p-1.5"
                      style={{
                        background: warned ? "rgba(217,119,6,0.1)" : theme.canvas,
                        border: `1px solid ${warned ? "rgba(217,119,6,0.45)" : theme.border}`,
                      }}
                    >
                      {a.type === "image" ? (
                        <img src={a.url} alt="" className="w-16 h-16 rounded-lg object-cover" />
                      ) : (
                        <div className="w-16 h-16 rounded-lg flex items-center justify-center" style={{ background: "rgba(148,163,184,0.1)" }}>
                          <Icon size={18} style={{ color: theme.textSub }} />
                        </div>
                      )}
                      {warned && (
                        <div className="absolute top-0.5 left-0.5 rounded-full p-0.5" style={{ background: "#D97706" }}>
                          <AlertTriangle size={9} style={{ color: "#fff" }} />
                        </div>
                      )}
                      {!warned && (
                        <button
                          onClick={() => removeAttach(i)}
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center"
                          style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}
                        >
                          <X size={10} style={{ color: theme.textSub }} />
                        </button>
                      )}
                      <div className="text-[9px] mt-1 text-center" style={{ color: warned ? "#fbbf24" : theme.textMuted }}>
                        {warned ? "模糊" : ATT_LABEL[a.type]}
                      </div>
                      {warned && (
                        <div className="flex gap-1 mt-0.5">
                          <button
                            onClick={() => retakeAttach(i)}
                            className="flex-1 flex items-center justify-center gap-0.5 rounded py-0.5 text-[9px] font-semibold"
                            style={{ background: "rgba(217,119,6,0.2)", color: "#fbbf24" }}
                          >
                            <RotateCcw size={9} /> 重拍
                          </button>
                          <button
                            onClick={() => removeAttach(i)}
                            className="flex-1 rounded py-0.5 text-[9px] font-semibold"
                            style={{ background: "rgba(148,163,184,0.15)", color: theme.textSub }}
                          >
                            移除
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* 图片模糊提示条 */}
            {hasWarnedAttach && (
              <div className="flex items-center gap-1.5 rounded-xl px-3 py-2 mb-2.5" style={{ background: "rgba(217,119,6,0.1)", border: "1px solid rgba(217,119,6,0.3)" }}>
                <AlertTriangle size={13} style={{ color: "#fbbf24" }} />
                <span className="text-[11px]" style={{ color: "#fbbf24" }}>图片模糊，建议在卡片上重拍或移除</span>
              </div>
            )}

            {/* 录音指示 */}
            {recording && (
              <div className="flex items-center gap-2 mb-2.5">
                <span className="w-2 h-2 rounded-full" style={{ background: "#f87171", animation: "pulseRed 1.2s ease-in-out infinite" }} />
                <span className="text-[11px] font-semibold" style={{ color: "#f87171" }}>录音中… 点击麦克风停止</span>
              </div>
            )}

            {/* 一体化输入区 */}
            <div className="flex items-end gap-2">
              {/* + 附件按钮 + 弹出菜单 */}
              <div className="relative flex-shrink-0" ref={attachMenuRef}>
                <button
                  onClick={() => setShowAttachMenu((v) => !v)}
                  disabled={uploading || recording}
                  className="w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-90 disabled:opacity-40"
                  style={{
                    background: showAttachMenu ? "rgba(0,199,217,0.15)" : theme.canvas,
                    border: `1px solid ${showAttachMenu ? "rgba(0,199,217,0.4)" : theme.border}`,
                  }}
                >
                  {uploading ? (
                    <Loader size={16} className="animate-spin" style={{ color: theme.textSub }} />
                  ) : (
                    <Plus size={18} style={{ color: showAttachMenu ? "#00C7D9" : theme.textSub, transition: "transform 0.2s", transform: showAttachMenu ? "rotate(45deg)" : "none" }} />
                  )}
                </button>
                {showAttachMenu && (
                  <div
                    className="absolute bottom-12 left-0 rounded-2xl py-1 z-20"
                    style={{
                      background: theme.cardBg,
                      border: `1px solid ${theme.border}`,
                      boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
                      minWidth: "132px",
                      animation: "fadeIn 0.15s ease-out",
                    }}
                  >
                    {ATTACH_MENU.map((item) => (
                      <button
                        key={item.key}
                        onClick={() => {
                          setShowAttachMenu(false);
                          if (item.key === "camera") cameraRef.current?.click();
                          else if (item.key === "album") photoRef.current?.click();
                          else if (item.key === "file") fileRef.current?.click();
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 transition-all text-left active:bg-white/5"
                      >
                        <item.icon size={15} style={{ color: item.color }} />
                        <span className="text-xs" style={{ color: theme.text }}>{item.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 输入胶囊 */}
              <div
                className="flex-1 flex items-end rounded-3xl overflow-hidden"
                style={{
                  background: theme.canvas,
                  border: `1px solid ${recording ? "rgba(220,38,38,0.4)" : theme.border}`,
                  minHeight: "40px",
                }}
              >
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={meta.placeholder}
                  rows={1}
                  className="flex-1 bg-transparent px-4 py-2.5 text-sm outline-none resize-none max-h-28 leading-relaxed"
                  style={{ color: theme.text }}
                />
                {/* 麦克风 */}
                <button
                  onClick={toggleVoice}
                  disabled={uploading || transcribing}
                  className="p-2 mr-1 mb-1 rounded-full transition-all active:scale-90 disabled:opacity-40 flex-shrink-0"
                  style={{ background: recording ? "rgba(220,38,38,0.15)" : "transparent" }}
                >
                  {recording ? (
                    <Square size={14} style={{ color: "#f87171" }} />
                  ) : transcribing ? (
                    <Loader size={16} className="animate-spin" style={{ color: theme.textSub }} />
                  ) : (
                    <Mic size={18} style={{ color: recording ? "#f87171" : theme.textSub }} />
                  )}
                </button>
              </div>

              {/* 发送按钮 */}
              <button
                onClick={submit}
                disabled={!canSend}
                className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-all active:scale-90 disabled:active:scale-100"
                style={{
                  background: canSend ? "linear-gradient(135deg,#FB923C,#F97316)" : theme.canvas,
                  border: `1px solid ${canSend ? "transparent" : theme.border}`,
                  boxShadow: canSend ? "0 4px 14px rgba(249,115,22,0.35)" : "none",
                }}
              >
                {sending ? (
                  <div className="flex items-end gap-0.5" style={{ height: "14px" }}>
                    {[0, 120, 240].map((delay, i) => (
                      <span
                        key={i}
                        className="w-1 rounded-full animate-bounce"
                        style={{ background: "#0D1B2A", height: "4px", animationDelay: `${delay}ms` }}
                      />
                    ))}
                  </div>
                ) : (
                  <Send size={17} style={{ color: canSend ? "#0D1B2A" : theme.textMuted }} />
                )}
              </button>
            </div>

            {/* 隐藏文件输入 */}
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => { addImage(e.target.files?.[0]); e.target.value = ""; }} />
            <input ref={photoRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => { addImage(e.target.files?.[0]); e.target.value = ""; }} />
            <input ref={fileRef} type="file" className="hidden"
              onChange={(e) => { addFile(e.target.files?.[0]); e.target.value = ""; }} />

            {err && <div className="text-[11px] mt-2" style={{ color: "#f87171" }}>{err}</div>}
          </>
        )}
      </div>

      <MetaTaggingModal
        open={!!taggingAttachment}
        attachment={taggingAttachment}
        staff={staff}
        clinicId={clinicId}
        onClose={() => setTaggingAttachment(null)}
        onNeedsReupload={(target) => {
          setAttachments((prev) =>
            prev.map((item) =>
              item === target || item.url === target?.url ? { ...item, qualityWarning: true } : item
            )
          );
          setTaggingAttachment(null);
        }}
        onConfirmed={() => {
          if (mode === "new_event" && !taskId) submit();
        }}
      />
    </div>
  );
}