import React from "react";
import {
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
} from "lucide-react";
import {
  STATUS_LABELS,
  STATUS_COLORS,
  ERROR_LABELS,
} from "@/lib/phase5/ingestionClient";

// 单条碎片采集结果回显卡片：状态 / assembly_eligible / 幂等 / 质量告警 / 错误码 / 重试。
export default function FragmentResultCard({ entry, onRetry, onRefresh, theme }) {
  const r = entry.result || {};
  const status =
    r.processing?.status || r.alignment?.status || r.status || "pending";
  const color = STATUS_COLORS[status] || "#94A3B8";
  const eligible = r.alignment?.assembly_eligible === true;
  const issues = r.alignment?.quality_issues || [];
  const errorCode = r.error_code;
  const idempotent = r.idempotent === true;
  const retryable = r.processing?.retryable === true || status === "failed";

  return (
    <div
      className="rounded-xl p-3 animate-fade-in"
      style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}
    >
      <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
        <span
          className="text-[10px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0"
          style={{ background: `${color}22`, color: color, border: `1px solid ${color}55` }}
        >
          {STATUS_LABELS[status] || status}
        </span>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded font-semibold flex-shrink-0"
          style={{ color: theme.textMuted, background: theme.cardHover }}
        >
          {entry.fragmentType}
        </span>
        {eligible && (
          <span
            className="text-[10px] flex items-center gap-0.5 font-semibold flex-shrink-0"
            style={{ color: "#4ade80" }}
          >
            <CheckCircle2 size={11} /> 可送编组
          </span>
        )}
        {idempotent && (
          <span
            className="text-[10px] flex items-center gap-0.5 flex-shrink-0"
            style={{ color: theme.textMuted }}
          >
            <Info size={11} /> 幂等重放
          </span>
        )}
        {eligible === false && status === "aligned" && (
          <span
            className="text-[10px] flex items-center gap-0.5 flex-shrink-0"
            style={{ color: "#94A3B8" }}
          >
            <XCircle size={11} /> 不可送编组
          </span>
        )}
      </div>

      <div className="text-[10px] font-mono break-all" style={{ color: theme.textFaint }}>
        artifact: {r.artifact?.id || "—"}
      </div>

      {errorCode && (
        <div
          className="mt-1 text-[10px] flex items-start gap-1"
          style={{ color: "#f87171" }}
        >
          <XCircle size={11} className="mt-0.5 flex-shrink-0" />
          <span>{ERROR_LABELS[errorCode] || errorCode}</span>
        </div>
      )}

      {issues.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {issues.map((q, i) => (
            <div
              key={i}
              className="text-[10px] flex items-start gap-1"
              style={{ color: "#fbbf24" }}
            >
              <AlertTriangle size={10} className="mt-0.5 flex-shrink-0" />
              {q}
            </div>
          ))}
        </div>
      )}

      {r._message && (
        <div className="mt-1 text-[10px]" style={{ color: "#f87171" }}>
          {r._message}
        </div>
      )}

      <div className="flex items-center gap-2 mt-2">
        {retryable && (
          <button
            onClick={onRetry}
            disabled={entry.busy}
            className="text-[10px] px-2 py-1 rounded-lg flex items-center gap-1 disabled:opacity-50"
            style={{
              background: "rgba(220,38,38,0.12)",
              color: "#f87171",
              border: "1px solid rgba(220,38,38,0.25)",
            }}
          >
            <RefreshCw size={10} /> 重试
          </button>
        )}
        <button
          onClick={onRefresh}
          disabled={entry.busy}
          className="text-[10px] px-2 py-1 rounded-lg disabled:opacity-50"
          style={{
            background: theme.cardHover,
            color: theme.textSub,
            border: `1px solid ${theme.border}`,
          }}
        >
          刷新状态
        </button>
      </div>
    </div>
  );
}