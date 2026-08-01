/**
 * MetaTaggingModal — 上传后立即弹出的多选标签弹窗
 *
 * 触发时机：ReportSheet 每上传一个附件后立即弹出（内联，提交前）。
 * 眼科报告在通用资料标签之后追加两道业务步骤：
 * - OCR 质量 poor：保留原始证据，但提示重新拍照/上传；
 * - 清晰眼科报告：要求人工确认具体检查项目，再完成提交。
 */
import { useState, useEffect, useRef } from "react";
import { useTheme } from "@/lib/ThemeContext";
import { getChipsForRole } from "@/lib/departments/modalChips";
import { ROLE_TO_DEPARTMENT } from "@/lib/departments/registry";
import { buildUserInteractiveMeta, validateUserInteractiveMeta } from "@/lib/phase5/metaPayload";
import {
  buildEyeExamMetadataPreview,
  captureFragment,
  computeChecksum,
  confirmEyeExamItem,
  newClientRequestId,
} from "@/lib/phase5/ingestionClient";
import { base44 } from "@/api/base44Client";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Loader,
  Mic,
  Paperclip,
  RotateCcw,
  Send,
  Tag,
  X,
} from "lucide-react";

const ATT_ICON = { image: ImageIcon, file: FileText, voice: Mic };
const ATT_LABEL = { image: "照片", file: "文件", voice: "语音" };
const REUPLOAD_MESSAGE = "这张检查报告照片过于模糊，系统无法可靠识别关键信息，请重新拍照并上传。";

function inferFragmentType(attachment) {
  if (!attachment) return "text";
  if (attachment.type === "image") return "image";
  if (attachment.type === "voice") return "audio";
  if (attachment.type === "file") return "document";
  return "text";
}

export default function MetaTaggingModal({
  open,
  attachment,
  staff,
  clinicId,
  onClose,
  onConfirmed,
  onNeedsReupload,
}) {
  const { theme } = useTheme();
  const [selected, setSelected] = useState([]);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [examItemTag, setExamItemTag] = useState("");
  const [examItemNote, setExamItemNote] = useState("");
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
      setExamItemTag(""); setExamItemNote("");
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
      const preview = res?.parse_preview || null;
      const baseResult = {
        tags: selectedLabels,
        preview,
        artifactId: res?.artifact?.id || preview?.artifact_id || null,
        factCardId: res?.eye_exam_metadata_result?.evidence_fact_card_id || preview?.evidence_fact_card_id || null,
      };

      if (res?.requires_reupload || preview?.requires_reupload) {
        setResult({
          ...baseResult,
          stage: "reupload",
          warningCode: res?.eye_exam_upload_warning_code || preview?.upload_warning_code,
        });
        return;
      }

      if (res?.requires_exam_item_confirmation || preview?.requires_exam_item_confirmation) {
        const candidates = res?.exam_item_candidates || preview?.exam_item_candidates || [];
        const suggested = res?.exam_item_suggested_tag || preview?.exam_item_suggested_tag || "";
        setExamItemTag(suggested);
        setResult({ ...baseResult, stage: "exam_confirmation", candidates });
        return;
      }

      setResult({ ...baseResult, stage: "done" });
      onConfirmed?.(selected, attachment);
    } catch (e) {
      const code = e?.error_code || e?.response?.data?.error_code;
      const base = e?.response?.data?.error || e?.message || "提交失败";
      setErr(code === "url_not_whitelisted" ? `${base}（${attachment?.url || "无URL"}）` : base);
    } finally { setSending(false); }
  };

  const confirmExamItem = async () => {
    if (!examItemTag) { setErr("请选择具体检查项目类型"); return; }
    const candidate = (result?.candidates || []).find((item) => item.id === examItemTag);
    if (candidate?.requires_note && examItemNote.trim().length < 2) {
      setErr("选择其他眼科检查时，请填写简短说明");
      return;
    }
    if (!result?.artifactId) { setErr("缺少报告 Artifact，无法保存检查项目"); return; }

    setSending(true); setErr("");
    try {
      const confirmed = await confirmEyeExamItem({
        clinic_id: clinicId,
        artifact_id: result.artifactId,
        evidence_fact_card_id: result.factCardId || null,
        exam_item_manual_tag: examItemTag,
        exam_item_manual_note: examItemNote.trim() || null,
      });
      const preview = buildEyeExamMetadataPreview(
        confirmed?.metadata,
        result.preview,
        confirmed,
      );
      setResult({ ...result, stage: "done", preview });
      onConfirmed?.(selected, attachment);
    } catch (e) {
      setErr(e?.message || "检查项目保存失败");
    } finally { setSending(false); }
  };

  const requestReupload = () => {
    onNeedsReupload?.(attachment);
    onClose?.();
  };

  const Icon = ATT_ICON[attachment?.type] || Paperclip;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end" style={{ background: "rgba(0,0,0,0.55)" }}>
      <div onClick={(e) => e.stopPropagation()}
        className="rounded-t-2xl p-4 max-h-[88vh] overflow-y-auto"
        style={{ background: theme.cardBg, border: `1px solid ${theme.border}`, animation: "slideInRight 0.25s ease-out" }}>

        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Tag size={16} style={{ color: "#00C7D9" }} />
            <div>
              <div className="text-sm font-bold" style={{ color: theme.text }}>
                {result?.stage === "exam_confirmation" ? "确认检查项目" : result?.stage === "reupload" ? "照片需要重新上传" : "给这份资料选类型"}
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: theme.textMuted }}>
                {result?.stage === "exam_confirmation" ? "人工分类将优先用于后续编组" : `${role_name} · 可多选，帮 AI 编组`}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg" style={{ background: "rgba(255,255,255,0.05)" }}>
            <X size={16} style={{ color: theme.textSub }} />
          </button>
        </div>

        {result?.stage === "reupload" ? (
          <div className="py-4">
            <div className="w-12 h-12 rounded-full mx-auto flex items-center justify-center mb-3" style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.4)" }}>
              <AlertTriangle size={25} style={{ color: "#f87171" }} />
            </div>
            <div className="text-center text-sm font-semibold mb-2" style={{ color: theme.text }}>无法可靠识别报告</div>
            <div className="text-center text-xs leading-relaxed mb-3" style={{ color: theme.textSub }}>{REUPLOAD_MESSAGE}</div>
            {result.preview?.ocr_quality_score != null && (
              <div className="text-center text-[10px] mb-4" style={{ color: theme.textMuted }}>
                OCR 质量：{result.preview.ocr_quality_flag} · {result.preview.ocr_quality_score}/100
              </div>
            )}
            <div className="rounded-xl p-3 mb-4 text-[11px] leading-relaxed" style={{ background: theme.canvas, border: `1px solid ${theme.border}`, color: theme.textSub }}>
              原始 Artifact 与 EvidenceItem 已保存。请避免抖动和反光，保证报告四边完整入镜，并让文字清晰可读。
            </div>
            <button onClick={requestReupload} className="w-full rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2" style={{ background: "linear-gradient(135deg,#FB923C,#F97316)", color: "#0D1B2A" }}>
              <RotateCcw size={16} /> 重新拍照或上传
            </button>
          </div>
        ) : result?.stage === "exam_confirmation" ? (
          <div className="py-2">
            <div className="rounded-xl p-3 mb-3" style={{ background: "rgba(0,199,217,0.08)", border: "1px solid rgba(0,199,217,0.28)" }}>
              <div className="text-xs font-semibold mb-1" style={{ color: "#00C7D9" }}>系统已识别为眼科检查报告</div>
              <div className="text-[11px] leading-relaxed" style={{ color: theme.textSub }}>
                请选择业务上的具体检查项目。该标签只用于分类和编组，不产生诊断或治疗建议。
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              {(result.candidates || []).map((candidate) => {
                const active = examItemTag === candidate.id;
                return (
                  <button key={candidate.id} onClick={() => setExamItemTag(candidate.id)}
                    className="px-3 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95"
                    style={active
                      ? { background: "rgba(0,199,217,0.18)", color: "#00C7D9", border: "1px solid rgba(0,199,217,0.5)" }
                      : { background: theme.canvas, color: theme.textSub, border: `1px solid ${theme.border}` }}>
                    {candidate.label}
                  </button>
                );
              })}
            </div>
            {examItemTag === "other_eye_exam" && (
              <textarea value={examItemNote} onChange={(e) => setExamItemNote(e.target.value)}
                placeholder="请简要说明检查项目，例如：视野检查"
                rows={2} className="w-full rounded-xl px-3 py-2.5 text-sm outline-none resize-none mb-3"
                style={{ background: theme.canvas, border: `1px solid ${theme.border}`, color: theme.text }} />
            )}
            {err && <div className="text-xs mb-3" style={{ color: "#f87171" }}>{err}</div>}
            <button onClick={confirmExamItem} disabled={sending || !examItemTag}
              className="w-full rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
              style={{ background: "linear-gradient(135deg,#00C7D9,#00A8BD)", color: "#0D1B2A" }}>
              {sending ? <Loader size={16} className="animate-spin" /> : <Send size={16} />}
              {sending ? "保存中…" : "确认检查项目"}
            </button>
          </div>
        ) : result ? (
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