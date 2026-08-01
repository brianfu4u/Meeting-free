import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { persistEyeExamMetadataForBridgeResults } from "@/lib/phase5/ingestionClient";
import MetaTaggingModal from "@/components/staffPad/MetaTaggingModal";
import {
  X, Camera, Image as ImageIcon, FileText, Mic, Square, Loader,
  Send, Paperclip, Plus, AlertTriangle, Check,
} from "lucide-react";

const MODE_META = {
  new_event: { title: "发起新事件", placeholder: "描述你遇到的情况、需求或异常…（可只传附件）" },
  progress: { title: "进度汇报", placeholder: "说明当前进展…（可附照片/语音）" },
  completion: { title: "完成提交", placeholder: "补充完成说明（选填）…" },
};

const ATT_ICON = { image: ImageIcon, file: FileText, voice: Mic };
const ATT_LABEL = { image: "照片", file: "文件", voice: "语音" };

const ATTACH_OPTIONS = [
  { key: "camera", icon: Camera, label: "拍照" },
  { key: "album", icon: ImageIcon, label: "相册" },
  { key: "file", icon: FileText, label: "文件" },
  { key: "voice", icon: Mic, label: "语音" },
];

const EXAM_ITEMS = [
  { id: "macular_oct", label: "黄斑OCT" },
  { id: "optic_nerve_oct", label: "视神经OCT" },
  { id: "intraocular_pressure", label: "眼压" },
  { id: "refraction", label: "验光" },
  { id: "corneal_endothelium", label: "角膜内皮" },
  { id: "ophthalmic_ultrasound", label: "眼科超声" },
  { id: "other", label: "其他" },
];

// Claude 风格暖灰深色 + 陶土橙调色板
const UI = {
  bg: "#1C1D21",
  bgElevated: "#232428",
  bgHover: "#2A2B30",
  border: "rgba(255,255,255,0.08)",
  borderStrong: "rgba(255,255,255,0.14)",
  borderActive: "rgba(217,119,87,0.5)",
  text: "#E8E6E3",
  textSub: "#A8A29E",
  textFaint: "#6B6862",
  accent: "#D97757",
  accentBg: "rgba(217,119,87,0.12)",
  danger: "#C75B5B",
  success: "#7BAE7F",
};

export default function ReportSheet({ open, mode, taskId, staff, clinicId, onClose, onSubmitted }) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [taggingAttachment, setTaggingAttachment] = useState(null);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [examItem, setExamItem] = useState("");
  const [examItemNote, setExamItemNote] = useState("");
  const [toast, setToast] = useState(null);

  const cameraRef = useRef(null);
  const photoRef = useRef(null);
  const fileRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const retakeIndexRef = useRef(null);
  const taRef = useRef(null);
  const touchStartY = useRef(null);

  useEffect(() => {
    if (open) {
      setText(""); setAttachments([]); setErr("");
      setRecording(false); setTaggingAttachment(null);
      setShowAttachMenu(false); setExpanded(false);
      setExamItem(""); setExamItemNote(""); setToast(null);
      retakeIndexRef.current = null;
    }
  }, [open, mode]);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta || !expanded) return;
    ta.style.height = "auto";
    const maxH = Math.round(window.innerHeight * 0.4);
    ta.style.height = Math.min(ta.scrollHeight, maxH) + "px";
  }, [text, expanded]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => { setToast(null); onClose?.(); }, 1600);
    return () => clearTimeout(t);
  }, [toast]);

  if (!open) return null;
  const meta = MODE_META[mode] || MODE_META.new_event;

  const hasImage = attachments.some((a) => a.type === "image");
  const canSend = !sending && !uploading && !recording && !transcribing && (text.trim().length > 0 || attachments.length > 0);

  const expand = () => { setExpanded(true); setTimeout(() => taRef.current?.focus(), 80); };
  const handleToggle = () => { if (expanded) setExpanded(false); else onClose?.(); };
  const onTouchStart = (e) => { touchStartY.current = e.touches[0]?.clientY; };
  const onTouchEnd = (e) => {
    if (touchStartY.current == null) return;
    const dy = (e.changedTouches[0]?.clientY || 0) - touchStartY.current;
    if (dy > 60) onClose?.();
    touchStartY.current = null;
  };

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
    } catch { setErr("图片上传失败"); retakeIndexRef.current = null; }
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
    } catch { setErr("文件上传失败"); }
    finally { setUploading(false); }
  };

  const removeAttach = (i) => setAttachments((prev) => prev.filter((_, idx) => idx !== i));
  const retakeAttach = (i) => { retakeIndexRef.current = i; setShowAttachMenu(false); cameraRef.current?.click(); };

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
          try { transcript = await base44.integrations.Core.TranscribeAudio({ audio_url: file_url }); } catch {}
          const att = { type: "voice", url: file_url, name: file.name, transcript: transcript || "", file };
          setAttachments((prev) => [...prev, att]);
          setTaggingAttachment(att);
          if (transcript) setText((t) => (t ? t + "\n" : "") + "[语音] " + transcript);
        } catch { setErr("语音上传失败"); }
        finally { setTranscribing(false); }
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
    } catch { setErr("无法访问麦克风"); }
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
      if (examItem) payload.exam_item_hint = examItem === "other" ? examItemNote.trim() : examItem;
      const res = await base44.functions.invoke("staffReportService", payload);
      const responseData = res.data || res;
      await persistEyeExamMetadataForBridgeResults({ clinicId, bridgeResults: responseData?.evidence_bridge || [] });
      onSubmitted?.();
      setToast({ msg: "已提交，子服务已存档", cat: responseData?.parsed?.category });
    } catch (e2) {
      setErr(e2?.response?.data?.error || e2?.message || "提交失败");
    } finally { setSending(false); }
  };

  const handleAttachOption = (key) => {
    setShowAttachMenu(false);
    if (key === "camera") cameraRef.current?.click();
    else if (key === "album") photoRef.current?.click();
    else if (key === "file") fileRef.current?.click();
    else if (key === "voice") toggleVoice();
  };

  return (
    <>
      {/* 成功提示 — 顶部滑入，自动消失 */}
      {toast && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-2xl flex items-center gap-2"
          style={{ background: UI.bgElevated, border: `1px solid ${UI.borderStrong}`, boxShadow: "0 8px 30px rgba(0,0,0,0.5)", animation: "slideInTop 0.25s ease-out" }}>
          <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "rgba(123,174,127,0.18)" }}>
            <Check size={12} style={{ color: UI.success }} />
          </div>
          <span className="text-sm" style={{ color: UI.text, fontWeight: 500 }}>{toast.msg}</span>
          {toast.cat && <span className="text-xs" style={{ color: UI.textSub }}>· {toast.cat}</span>}
        </div>
      )}

      <div className="fixed inset-0 z-50 flex flex-col justify-end" style={{ background: "rgba(0,0,0,0.4)" }}
        onClick={onClose} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>

        {/* 统一底部面板 — 吸附屏幕底部 */}
        <div onClick={(e) => e.stopPropagation()}
          className="w-full rounded-t-[20px] overflow-hidden"
          style={{ background: UI.bg, borderTop: `1px solid ${UI.border}`, animation: "fadeIn 0.2s ease-out" }}>

          {/* 拖拽指示条 */}
          <div className="flex justify-center pt-2.5 pb-1 cursor-pointer" onClick={handleToggle}>
            <div className="w-9 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.15)" }} />
          </div>

          {expanded ? (
            <div className="px-4 pb-4">
              {/* 附件预览横滚条 */}
              {attachments.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-2.5 mb-1" style={{ scrollbarWidth: "none" }}>
                  {attachments.map((a, i) => {
                    const Icon = ATT_ICON[a.type] || Paperclip;
                    const warned = a.qualityWarning;
                    return (
                      <div key={i} className="relative flex-shrink-0 rounded-xl p-1"
                        style={{ background: warned ? "rgba(199,91,91,0.08)" : UI.bgElevated, border: `1px solid ${warned ? "rgba(199,91,91,0.3)" : UI.border}` }}>
                        <div className="relative w-14 h-14 rounded-lg overflow-hidden" onClick={() => warned && retakeAttach(i)}>
                          {a.type === "image" ? (
                            <img src={a.url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center" style={{ background: UI.bgHover }}>
                              <Icon size={18} style={{ color: UI.textSub }} />
                            </div>
                          )}
                          {warned && (
                            <div className="absolute bottom-0 right-0 w-5 h-5 flex items-center justify-center rounded-tl-lg" style={{ background: UI.danger }}>
                              <AlertTriangle size={10} style={{ color: "#fff" }} />
                            </div>
                          )}
                        </div>
                        <button onClick={() => removeAttach(i)}
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center"
                          style={{ background: UI.bg, border: `1px solid ${UI.borderStrong}` }}>
                          <X size={10} style={{ color: UI.textSub }} />
                        </button>
                        <div className="text-[9px] text-center mt-0.5" style={{ color: warned ? UI.danger : UI.textFaint }}>
                          {warned ? "模糊·重拍" : ATT_LABEL[a.type]}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 文字输入区 — 融入容器背景 */}
              <textarea ref={taRef} value={text} onChange={(e) => setText(e.target.value)}
                placeholder={meta.placeholder} rows={2}
                className="w-full bg-transparent outline-none resize-none text-sm leading-relaxed py-2"
                style={{ color: UI.text, fontWeight: 400, minHeight: "48px", maxHeight: "40vh" }} />

              {/* 检查项目标签条 — 有图片附件时显示 */}
              {hasImage && (
                <div className="mb-1">
                  <div className="text-[10px] mb-1.5" style={{ color: UI.textFaint }}>检查项目类型</div>
                  <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
                    {EXAM_ITEMS.map((item) => {
                      const active = examItem === item.id;
                      return (
                        <button key={item.id} onClick={() => setExamItem(item.id)}
                          className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 active:scale-95"
                          style={active
                            ? { background: UI.accent, color: "#fff", border: `1px solid ${UI.accent}` }
                            : { background: "transparent", color: UI.textSub, border: `1px solid ${UI.border}` }}>
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                  {examItem === "other" && (
                    <input value={examItemNote} onChange={(e) => setExamItemNote(e.target.value)}
                      placeholder="请说明检查项目，如：视野检查"
                      className="w-full bg-transparent outline-none text-xs mt-1.5 px-3 py-2 rounded-lg"
                      style={{ background: UI.bgElevated, border: `1px solid ${UI.border}`, color: UI.text }} />
                  )}
                </div>
              )}

              {/* 附件抽屉 — 从功能条上方滑出 */}
              <div style={{
                maxHeight: showAttachMenu ? "130px" : "0",
                opacity: showAttachMenu ? 1 : 0,
                overflow: "hidden",
                transition: "max-height 0.25s ease, opacity 0.2s ease",
              }}>
                <div className="flex gap-2 pt-2 pb-3">
                  {ATTACH_OPTIONS.map((opt) => (
                    <button key={opt.key} onClick={() => handleAttachOption(opt.key)}
                      disabled={uploading || (opt.key === "voice" && (recording || transcribing))}
                      className="flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl transition-all duration-200 active:scale-95 disabled:opacity-40"
                      style={{ background: UI.bgElevated, border: `1px solid ${UI.border}` }}>
                      {opt.key === "voice" && recording ? (
                        <span className="w-4 h-4 rounded-full" style={{ background: UI.danger, animation: "pulseRed 1.2s ease-in-out infinite" }} />
                      ) : opt.key === "voice" && transcribing ? (
                        <Loader size={16} className="animate-spin" style={{ color: UI.textSub }} />
                      ) : (
                        <opt.icon size={18} style={{ color: UI.textSub, strokeWidth: 1.5 }} />
                      )}
                      <span className="text-[10px] font-medium" style={{ color: UI.textSub }}>{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 录音指示 */}
              {recording && (
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: UI.danger, animation: "pulseRed 1.2s ease-in-out infinite" }} />
                  <span className="text-[11px]" style={{ color: UI.danger }}>录音中… 点击麦克风停止</span>
                </div>
              )}

              {/* 错误提示 */}
              {err && <div className="text-[11px] mb-2" style={{ color: UI.danger }}>{err}</div>}

              {/* 底部功能条 */}
              <div className="flex items-center gap-1.5 pt-2.5" style={{ borderTop: `1px solid ${UI.border}` }}>
                {/* + 附件按钮 */}
                <button onClick={() => setShowAttachMenu((v) => !v)} disabled={uploading}
                  className="w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 active:scale-90 disabled:opacity-40 flex-shrink-0"
                  style={{
                    background: showAttachMenu ? UI.accentBg : "transparent",
                    border: `1px solid ${showAttachMenu ? UI.borderActive : UI.border}`,
                  }}>
                  {uploading ? <Loader size={16} className="animate-spin" style={{ color: UI.textSub }} />
                    : <Plus size={18} style={{ color: showAttachMenu ? UI.accent : UI.textSub, transform: showAttachMenu ? "rotate(45deg)" : "none", transition: "transform 0.2s", strokeWidth: 1.8 }} />}
                </button>

                <div className="flex-1" />

                {/* 麦克风 */}
                <button onClick={toggleVoice} disabled={uploading || transcribing}
                  className="w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 active:scale-90 disabled:opacity-40 flex-shrink-0"
                  style={{
                    background: recording ? "rgba(199,91,91,0.12)" : "transparent",
                    border: `1px solid ${recording ? "rgba(199,91,91,0.4)" : UI.border}`,
                  }}>
                  {recording ? <Square size={13} style={{ color: UI.danger, fill: UI.danger }} />
                    : transcribing ? <Loader size={16} className="animate-spin" style={{ color: UI.textSub }} />
                    : <Mic size={18} style={{ color: UI.textSub, strokeWidth: 1.8 }} />}
                </button>

                {/* 发送按钮 — 圆形，灰→橙渐变 */}
                <button onClick={submit} disabled={!canSend}
                  className="w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 active:scale-90 disabled:active:scale-100 flex-shrink-0"
                  style={{
                    background: canSend ? UI.accent : UI.bgElevated,
                    border: `1px solid ${canSend ? "transparent" : UI.border}`,
                    boxShadow: canSend ? "0 4px 14px rgba(217,119,87,0.3)" : "none",
                  }}>
                  {sending ? (
                    <div className="flex items-end gap-0.5" style={{ height: "14px" }}>
                      {[0, 120, 240].map((d, i) => (
                        <span key={i} className="w-1 rounded-full animate-bounce"
                          style={{ background: "#fff", height: "5px", animationDelay: `${d}ms` }} />
                      ))}
                    </div>
                  ) : (
                    <Send size={17} style={{ color: canSend ? "#fff" : UI.textFaint, strokeWidth: 1.8 }} />
                  )}
                </button>
              </div>
            </div>
          ) : (
            /* 收起态 — 紧凑单行 */
            <div className="px-4 pb-3 pt-1" onClick={expand}>
              <div className="flex items-center gap-3 py-2">
                <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ border: `1px solid ${UI.border}` }}>
                  <Plus size={17} style={{ color: UI.textSub, strokeWidth: 1.8 }} />
                </div>
                <span className="flex-1 text-sm" style={{ color: UI.textFaint, fontWeight: 400 }}>{meta.placeholder}</span>
                <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: UI.bgElevated, border: `1px solid ${UI.border}` }}>
                  <Send size={15} style={{ color: UI.textFaint, strokeWidth: 1.8 }} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 隐藏文件输入 */}
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => { addImage(e.target.files?.[0]); e.target.value = ""; }} />
        <input ref={photoRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => { addImage(e.target.files?.[0]); e.target.value = ""; }} />
        <input ref={fileRef} type="file" className="hidden"
          onChange={(e) => { addFile(e.target.files?.[0]); e.target.value = ""; }} />
      </div>

      <MetaTaggingModal open={!!taggingAttachment} attachment={taggingAttachment} staff={staff} clinicId={clinicId}
        onClose={() => setTaggingAttachment(null)}
        onNeedsReupload={(target) => {
          setAttachments((prev) => prev.map((item) =>
            item === target || item.url === target?.url ? { ...item, qualityWarning: true } : item));
          setTaggingAttachment(null);
        }}
        onConfirmed={() => {
          if (mode === "new_event" && !taskId) submit();
        }} />
    </>
  );
}