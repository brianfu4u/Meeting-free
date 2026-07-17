import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useTheme } from "@/lib/ThemeContext";
import { X, ImagePlus, Send, Loader, CheckCircle2, Sparkles } from "lucide-react";

const MODE_META = {
  new_event: { title: "发起新事件", placeholder: "描述你遇到的情况、需求或异常…", needPhoto: false, submitText: "提交汇报" },
  progress: { title: "进度汇报", placeholder: "说明当前进展…", needPhoto: false, submitText: "提交进度" },
  completion: { title: "完成提交", placeholder: "补充完成说明（选填）…", needPhoto: true, submitText: "提交完成" },
};

export default function ReportSheet({ open, mode, taskId, staff, onClose, onSubmitted }) {
  const { theme } = useTheme();
  const [text, setText] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (open) { setText(""); setFileUrl(""); setResult(null); setErr(""); }
  }, [open, mode]);

  if (!open) return null;
  const meta = MODE_META[mode] || MODE_META.new_event;

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true); setErr("");
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file: f });
      setFileUrl(file_url);
    } catch (e2) { setErr("图片上传失败"); }
    finally { setUploading(false); }
  };

  const submit = async () => {
    if (!text.trim() && !meta.needPhoto) { setErr("请填写内容"); return; }
    if (meta.needPhoto && !fileUrl) { setErr("完成提交需上传证据照片"); return; }
    setSending(true); setErr("");
    try {
      const res = await base44.functions.invoke("staffReportService", {
        report_type: mode,
        task_id: taskId || undefined,
        text: text.trim(),
        file_url: fileUrl || undefined,
        staff_id: staff.id,
      });
      setResult(res.data || res);
      onSubmitted?.();
    } catch (e2) {
      setErr(e2?.response?.data?.error || e2?.message || "提交失败");
    } finally { setSending(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="rounded-t-2xl p-4 max-h-[85vh] overflow-y-auto"
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
              {result.parsed?.suggested_action && (
                <div className="text-xs" style={{ color: theme.textSub }}>建议：{result.parsed.suggested_action}</div>
              )}
            </div>
            <button onClick={onClose} className="w-full rounded-lg py-2.5 text-sm font-semibold" style={{ background: "linear-gradient(135deg,#00C7D9,#00A8BD)", color: "#0D1B2A" }}>
              完成
            </button>
          </div>
        ) : (
          <>
            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={meta.placeholder} rows={4}
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none resize-none mb-3"
              style={{ background: theme.canvas, border: `1px solid ${theme.border}`, color: theme.text }} />

            {meta.needPhoto && (
              <div className="mb-3">
                <label className="text-xs font-medium mb-1.5 block" style={{ color: theme.textSub }}>证据照片（必传）</label>
                {fileUrl ? (
                  <div className="relative rounded-xl overflow-hidden" style={{ border: `1px solid ${theme.border}` }}>
                    <img src={fileUrl} alt="证据" className="w-full max-h-48 object-cover" />
                    <button onClick={() => setFileUrl("")} className="absolute top-2 right-2 p-1 rounded-lg" style={{ background: "rgba(0,0,0,0.6)" }}>
                      <X size={14} style={{ color: "#fff" }} />
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center gap-1.5 rounded-xl py-6 cursor-pointer" style={{ background: theme.canvas, border: `1px dashed ${theme.border}` }}>
                    {uploading ? <Loader size={18} className="animate-spin" style={{ color: theme.textSub }} /> : <ImagePlus size={20} style={{ color: theme.textSub }} />}
                    <span className="text-xs" style={{ color: theme.textSub }}>{uploading ? "上传中…" : "点击上传"}</span>
                    <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
                  </label>
                )}
              </div>
            )}

            {err && <div className="text-xs mb-3" style={{ color: "#f87171" }}>{err}</div>}

            <button onClick={submit} disabled={sending || uploading}
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