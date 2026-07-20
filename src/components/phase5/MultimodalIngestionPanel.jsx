import React, { useState, useRef, useCallback } from "react";
import {
  Image as ImageIcon,
  FileText,
  Mic,
  Type,
  Upload,
  Square,
  X,
  Loader,
  Send,
  Camera,
} from "lucide-react";
import { useTheme } from "@/lib/ThemeContext";
import {
  computeChecksum,
  uploadFile,
  captureFragment,
  getFragmentStatus,
  retryFragment,
  newClientRequestId,
} from "@/lib/phase5/ingestionClient";
import FragmentResultCard from "@/components/phase5/FragmentResultCard";

const TABS = [
  { id: "image", label: "图片", icon: ImageIcon },
  { id: "document", label: "文档", icon: FileText },
  { id: "audio", label: "音频", icon: Mic },
  { id: "text", label: "文本", icon: Type },
];

const DOC_ACCEPT =
  ".pdf,.xlsx,.csv,.txt,application/pdf,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export default function MultimodalIngestionPanel({ clinicId }) {
  const { theme } = useTheme();
  const [tab, setTab] = useState("image");
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [micError, setMicError] = useState(null);
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);

  const addResult = useCallback((r, fragmentType) => {
    setResults((prev) => [
      { key: newClientRequestId(), result: r, fragmentType, busy: false },
      ...prev,
    ]);
  }, []);

  const setEntryBusy = (key, busy) =>
    setResults((prev) => prev.map((x) => (x.key === key ? { ...x, busy } : x)));

  const updateEntry = (key, r) =>
    setResults((prev) => prev.map((x) => (x.key === key ? { ...x, result: r } : x)));

  const captureFile = useCallback(
    async (file, fragmentType) => {
      setBusy(true);
      try {
        const checksum = await computeChecksum(file);
        const file_url = await uploadFile(file);
        if (!file_url) {
          addResult({ error_code: "upload_failed" }, fragmentType);
          return;
        }
        const res = await captureFragment({
          action: "captureFragment",
          clinic_id: clinicId,
          fragment_type: fragmentType,
          client_request_id: newClientRequestId(),
          source: {
            file_url,
            mime_type: file.type || "application/octet-stream",
            original_filename: file.name,
            file_size: file.size,
            checksum,
          },
          context: { department: "optometry" },
        });
        addResult(res, fragmentType);
      } catch (e) {
        addResult({ error_code: "upload_failed", _message: String(e?.message || e) }, fragmentType);
      } finally {
        setBusy(false);
      }
    },
    [clinicId, addResult]
  );

  const submitText = useCallback(async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const res = await captureFragment({
        action: "captureFragment",
        clinic_id: clinicId,
        fragment_type: "text",
        client_request_id: newClientRequestId(),
        source: { text: text.trim() },
        context: { department: "reception" },
      });
      addResult(res, "text");
      setText("");
    } catch (e) {
      addResult({ error_code: "upload_failed", _message: String(e?.message || e) }, "text");
    } finally {
      setBusy(false);
    }
  }, [clinicId, text, addResult]);

  const startRecording = useCallback(async () => {
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        if (blob.size === 0) return;
        const file = new File([blob], `recording-${Date.now()}.webm`, {
          type: blob.type,
        });
        captureFile(file, "audio");
      };
      mr.start();
      mediaRef.current = mr;
      setRecording(true);
    } catch (e) {
      const name = e?.name || "";
      setMicError(
        name === "NotAllowedError" || name === "SecurityError"
          ? "麦克风权限被拒绝，请在浏览器设置中授权后重试"
          : name === "NotFoundError"
          ? "未找到可用的麦克风设备"
          : String(e?.message || e)
      );
    }
  }, [captureFile]);

  const stopRecording = useCallback(() => {
    const mr = mediaRef.current;
    if (mr && mr.state !== "inactive") mr.stop();
    setRecording(false);
  }, []);

  const cancelRecording = useCallback(() => {
    const mr = mediaRef.current;
    if (mr && mr.state !== "inactive") {
      mr.onstop = null;
      mr.stop();
    }
    const stream = mediaRef.current?.stream;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    chunksRef.current = [];
    setRecording(false);
  }, []);

  const handleRetry = useCallback(
    async (entry) => {
      const artifactId = entry.result?.artifact?.id;
      if (!artifactId) return;
      setEntryBusy(entry.key, true);
      try {
        const res = await retryFragment({ clinic_id: clinicId, artifact_id: artifactId });
        updateEntry(entry.key, res);
      } catch (e) {
        updateEntry(entry.key, { ...entry.result, _message: String(e?.message || e) });
      } finally {
        setEntryBusy(entry.key, false);
      }
    },
    [clinicId]
  );

  const handleRefresh = useCallback(
    async (entry) => {
      const artifactId = entry.result?.artifact?.id;
      if (!artifactId) return;
      setEntryBusy(entry.key, true);
      try {
        const res = await getFragmentStatus({ clinic_id: clinicId, artifact_id: artifactId });
        updateEntry(entry.key, res);
      } catch (e) {
        updateEntry(entry.key, { ...entry.result, _message: String(e?.message || e) });
      } finally {
        setEntryBusy(entry.key, false);
      }
    },
    [clinicId]
  );

  const fileInputProps = (fragmentType, accept, capture) => ({
    type: "file",
    accept,
    capture,
    className: "hidden",
    onChange: (e) => {
      const f = e.target.files?.[0];
      if (f) captureFile(f, fragmentType);
      e.target.value = "";
    },
  });

  return (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div
        className="flex items-center gap-1 p-1 rounded-xl flex-shrink-0"
        style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}
      >
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex-1 flex flex-col items-center gap-1 py-2 rounded-lg transition-all"
              style={{
                background: active ? "rgba(0,199,217,0.15)" : "transparent",
                border: active ? "1px solid rgba(0,199,217,0.35)" : "1px solid transparent",
              }}
            >
              <Icon size={16} style={{ color: active ? "#00C7D9" : theme.textSub }} />
              <span
                className="text-[10px] font-semibold"
                style={{ color: active ? "#00C7D9" : theme.textSub }}
              >
                {t.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Capture area */}
      <div
        className="mt-3 rounded-xl p-4 flex-shrink-0"
        style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}
      >
        {tab === "image" && (
          <div className="space-y-2">
            <label
              className="flex flex-col items-center justify-center gap-2 py-6 rounded-xl cursor-pointer transition-all"
              style={{ background: theme.cardHover, border: `1.5px dashed ${theme.border}` }}
            >
              {busy ? (
                <Loader size={22} className="animate-spin" style={{ color: "#00C7D9" }} />
              ) : (
                <Upload size={22} style={{ color: theme.textSub }} />
              )}
              <span className="text-xs font-semibold" style={{ color: theme.text }}>
                点击上传图片
              </span>
              <span className="text-[10px]" style={{ color: theme.textMuted }}>
                JPG / PNG / WEBP
              </span>
              <input {...fileInputProps("image", "image/*")} />
            </label>
            <label
              className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl cursor-pointer text-xs font-semibold transition-all"
              style={{ background: "rgba(0,199,217,0.1)", border: "1px solid rgba(0,199,217,0.25)", color: "#00C7D9" }}
            >
              <Camera size={14} /> 拍照上传
              <input {...fileInputProps("image", "image/*", "environment")} />
            </label>
          </div>
        )}

        {tab === "document" && (
          <label
            className="flex flex-col items-center justify-center gap-2 py-6 rounded-xl cursor-pointer transition-all"
            style={{ background: theme.cardHover, border: `1.5px dashed ${theme.border}` }}
          >
            {busy ? (
              <Loader size={22} className="animate-spin" style={{ color: "#00C7D9" }} />
            ) : (
              <FileText size={22} style={{ color: theme.textSub }} />
            )}
            <span className="text-xs font-semibold" style={{ color: theme.text }}>
              点击上传文档
            </span>
            <span className="text-[10px]" style={{ color: theme.textMuted }}>
              PDF / XLSX / CSV / TXT
            </span>
            <input {...fileInputProps("document", DOC_ACCEPT)} />
          </label>
        )}

        {tab === "audio" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              {!recording ? (
                <button
                  onClick={startRecording}
                  className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl text-sm font-semibold transition-all active:scale-95"
                  style={{ background: "rgba(220,38,38,0.12)", border: "1px solid rgba(220,38,38,0.3)", color: "#f87171" }}
                >
                  <Mic size={16} /> 开始录音
                </button>
              ) : (
                <>
                  <button
                    onClick={stopRecording}
                    className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl text-sm font-semibold"
                    style={{ background: "rgba(0,199,217,0.15)", border: "1px solid rgba(0,199,217,0.35)", color: "#00C7D9" }}
                  >
                    <Square size={14} /> 停止并上传
                  </button>
                  <button
                    onClick={cancelRecording}
                    className="flex items-center justify-center gap-1.5 px-3 py-3 rounded-xl text-sm font-semibold"
                    style={{ background: "rgba(148,163,184,0.12)", border: "1px solid rgba(148,163,184,0.25)", color: "#94A3B8" }}
                  >
                    <X size={14} /> 取消
                  </button>
                </>
              )}
            </div>
            <label
              className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl cursor-pointer text-xs font-semibold"
              style={{ background: theme.cardHover, border: `1px solid ${theme.border}`, color: theme.textSub }}
            >
              <Upload size={13} /> 选择音频文件上传
              <input {...fileInputProps("audio", "audio/*")} />
            </label>
            {recording && (
              <div className="flex items-center justify-center gap-2 text-xs" style={{ color: "#f87171" }}>
                <span className="w-2 h-2 rounded-full pulse-red" style={{ background: "#DC2626" }} />
                录音中…点击停止后自动上传
              </div>
            )}
            {micError && (
              <div className="text-[11px] text-center" style={{ color: "#fbbf24" }}>
                {micError}
              </div>
            )}
          </div>
        )}

        {tab === "text" && (
          <div className="space-y-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              placeholder="手动输入文本碎片（如备忘、电话记录）…"
              className="w-full text-sm rounded-xl p-3 outline-none resize-none"
              style={{ background: theme.cardHover, border: `1px solid ${theme.border}`, color: theme.text }}
            />
            <button
              onClick={submitText}
              disabled={busy || !text.trim()}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
              style={{ background: "linear-gradient(135deg,#00C7D9,#00A8BD)", color: "#0D1B2A" }}
            >
              {busy ? <Loader size={14} className="animate-spin" /> : <Send size={14} />}
              提交文本碎片
            </button>
          </div>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto mt-3 space-y-2 pb-4">
        {results.length === 0 && (
          <div className="text-center py-8 text-xs" style={{ color: theme.textMuted }}>
            尚无采集记录。上方选择模态后开始上传。
          </div>
        )}
        {results.map((entry) => (
          <FragmentResultCard
            key={entry.key}
            entry={entry}
            onRetry={() => handleRetry(entry)}
            onRefresh={() => handleRefresh(entry)}
            theme={theme}
          />
        ))}
      </div>
    </div>
  );
}