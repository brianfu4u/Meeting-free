import React, { useState } from "react";
import { Bot, User, ChevronDown, ChevronRight, Wrench, CheckCircle, XCircle, Loader } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useTheme } from "@/lib/ThemeContext";

const STATUS_MAP = {
  pending: { icon: Loader, color: "#94A3B8", label: "待执行", spin: true },
  running: { icon: Loader, color: "#00C7D9", label: "执行中", spin: true },
  in_progress: { icon: Loader, color: "#00C7D9", label: "进行中", spin: true },
  completed: { icon: CheckCircle, color: "#4ade80", label: "完成" },
  success: { icon: CheckCircle, color: "#4ade80", label: "成功" },
  failed: { icon: XCircle, color: "#f87171", label: "失败" },
  error: { icon: XCircle, color: "#f87171", label: "错误" },
};

function ToolCallDisplay({ toolCall }) {
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const status = STATUS_MAP[toolCall.status] || STATUS_MAP.pending;
  const StatusIcon = status.icon;
  const proj = toolCall.display_projection || {};
  const hidden = proj.hide_details && proj.details_redacted;

  let results = toolCall.results;
  if (typeof results === "string") {
    try { results = JSON.parse(results); } catch { /* keep raw */ }
  }
  const failed = ["failed", "error"].includes(toolCall.status) ||
    (typeof results === "object" && results && results.success === false) ||
    (typeof results === "string" && /error|failed/i.test(results));

  const label = hidden ? (failed ? (proj.error_label || "执行失败") : proj.active_label || status.label) : status.label;

  let argsPretty = toolCall.arguments_string || "";
  try { if (argsPretty) argsPretty = JSON.stringify(JSON.parse(argsPretty), null, 2); } catch { /* keep raw */ }
  const resultsPretty = typeof results === "object" ? JSON.stringify(results, null, 2) : String(results ?? "");

  return (
    <div className="mt-2 rounded-lg" style={{ background: "rgba(0,199,217,0.06)", border: "1px solid rgba(0,199,217,0.18)" }}>
      <button
        onClick={() => !hidden && setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2"
        style={{ cursor: hidden ? "default" : "pointer" }}
      >
        {!hidden && (expanded
          ? <ChevronDown size={11} style={{ color: theme.textMuted }} />
          : <ChevronRight size={11} style={{ color: theme.textMuted }} />)}
        <Wrench size={11} style={{ color: "#00C7D9" }} />
        <span className="font-mono" style={{ color: theme.text, fontSize: "11px" }}>{toolCall.name}</span>
        <span className="ml-auto flex items-center gap-1" style={{ color: failed ? "#f87171" : status.color }}>
          <StatusIcon size={11} className={status.spin ? "animate-spin" : ""} />
          <span style={{ fontSize: "10px" }}>{label}</span>
        </span>
      </button>
      {expanded && !hidden && (
        <div className="px-3 pb-2.5 space-y-2" style={{ borderTop: "1px solid rgba(0,199,217,0.12)" }}>
          {argsPretty && (
            <div>
              <div style={{ color: theme.textMuted, fontSize: "9px", marginBottom: "2px", letterSpacing: "0.05em" }}>参数</div>
              <pre style={{ color: theme.textSub, fontSize: "10px", whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0 }}>{argsPretty}</pre>
            </div>
          )}
          {resultsPretty && (
            <div>
              <div style={{ color: theme.textMuted, fontSize: "9px", marginBottom: "2px", letterSpacing: "0.05em" }}>结果</div>
              <pre style={{ color: failed ? "#f87171" : theme.textSub, fontSize: "10px", whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0 }}>{resultsPretty}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function MessageBubble({ message }) {
  const { theme } = useTheme();
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{
          background: isUser ? "rgba(0,199,217,0.15)" : "rgba(251,146,60,0.15)",
          border: `1px solid ${isUser ? "rgba(0,199,217,0.3)" : "rgba(251,146,60,0.3)"}`,
        }}
      >
        {isUser ? <User size={13} style={{ color: "#00C7D9" }} /> : <Bot size={13} style={{ color: "#FB923C" }} />}
      </div>
      <div className={`flex-1 min-w-0 ${isUser ? "flex justify-end" : ""}`} style={{ maxWidth: "85%" }}>
        <div
          className="rounded-xl px-3.5 py-2.5 inline-block"
          style={{
            background: isUser ? "rgba(0,199,217,0.1)" : theme.cardBg,
            border: `1px solid ${isUser ? "rgba(0,199,217,0.25)" : theme.border}`,
          }}
        >
          {message.content && (
            isUser ? (
              <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: theme.text }}>{message.content}</p>
            ) : (
              <div className="text-sm leading-relaxed" style={{ color: theme.text }}>
                <ReactMarkdown
                  components={{
                    p: ({ children }) => <p style={{ margin: "0 0 0.5em 0" }}>{children}</p>,
                    ul: ({ children }) => <ul style={{ margin: "0.3em 0", paddingLeft: "1.2em" }}>{children}</ul>,
                    ol: ({ children }) => <ol style={{ margin: "0.3em 0", paddingLeft: "1.2em" }}>{children}</ol>,
                    li: ({ children }) => <li style={{ marginBottom: "0.2em" }}>{children}</li>,
                    pre: ({ children }) => <pre style={{ background: "rgba(0,0,0,0.3)", padding: "8px 10px", borderRadius: "6px", overflowX: "auto", fontSize: "11px", margin: "0.4em 0" }}>{children}</pre>,
                    code: ({ children }) => <code style={{ background: "rgba(0,199,217,0.12)", padding: "1px 4px", borderRadius: "3px", fontSize: "0.85em", color: "#00C7D9" }}>{children}</code>,
                    h1: ({ children }) => <h1 style={{ fontSize: "1.1em", fontWeight: 700, margin: "0.5em 0 0.3em" }}>{children}</h1>,
                    h2: ({ children }) => <h2 style={{ fontSize: "1.05em", fontWeight: 700, margin: "0.5em 0 0.3em" }}>{children}</h2>,
                    h3: ({ children }) => <h3 style={{ fontSize: "1em", fontWeight: 600, margin: "0.4em 0 0.2em" }}>{children}</h3>,
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              </div>
            )
          )}
          {message.tool_calls?.map((tc, idx) => <ToolCallDisplay key={idx} toolCall={tc} />)}
        </div>
      </div>
    </div>
  );
}