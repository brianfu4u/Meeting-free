import React, { useState, useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useTheme, ThemeProvider } from "@/lib/ThemeContext";
import { Send, Sparkles, Plus, MessageSquare, ArrowLeft, Loader, Wrench } from "lucide-react";
import { Link } from "react-router-dom";
import MessageBubble from "@/components/devDirector/MessageBubble";

const AGENT_NAME = "DevDirector";

const SUGGESTED_PROMPTS = [
  "扫描当前门店，列出所有未处理的异常告警",
  "检查区有患者卡顿超过30分钟了吗？给我处置建议",
  "把库存低于阈值的物品汇总成一份补货任务草案",
  "当前哪些视光师处于空闲状态？可以调度谁去支援检查区",
];

function DevDirectorInner() {
  const { theme } = useTheme();
  const [conversations, setConversations] = useState([]);
  const [activeConvId, setActiveConvId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const messagesEndRef = useRef(null);

  const loadConversations = useCallback(async () => {
    try {
      setLoadingConvs(true);
      const list = await base44.agents.listConversations({ agent_name: AGENT_NAME });
      setConversations(list || []);
      if (list && list.length > 0 && !activeConvId) {
        setActiveConvId(list[0].id);
      }
    } catch (e) {
      console.error("load conversations failed", e);
    } finally {
      setLoadingConvs(false);
    }
  }, [activeConvId]);

  useEffect(() => { loadConversations(); }, []);

  useEffect(() => {
    if (!activeConvId) { setMessages([]); return; }
    const unsubscribe = base44.agents.subscribeToConversation(activeConvId, (data) => {
      setMessages(data.messages || []);
    });
    base44.agents.getConversation(activeConvId).then((conv) => {
      setMessages(conv.messages || []);
    }).catch(console.error);
    return () => unsubscribe();
  }, [activeConvId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const newConversation = async () => {
    const conv = await base44.agents.createConversation({
      agent_name: AGENT_NAME,
      metadata: { name: "作战指令 " + new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }), description: "店长与开发总监对话" },
    });
    return conv;
  };

  const handleNewConversation = async () => {
    try {
      const conv = await newConversation();
      setActiveConvId(conv.id);
      setMessages([]);
      await loadConversations();
    } catch (e) { console.error(e); }
  };

  const handleSend = async (text) => {
    const content = (text ?? input).trim();
    if (!content || sending) return;
    setInput("");
    setSending(true);
    try {
      let convId = activeConvId;
      if (!convId) {
        const conv = await newConversation();
        convId = conv.id;
        setActiveConvId(convId);
        await loadConversations();
      }
      const conv = await base44.agents.getConversation(convId);
      await base44.agents.addMessage(conv, { role: "user", content });
    } catch (e) {
      console.error(e);
    } finally {
      setSending(false);
    }
  };

  const activeConv = conversations.find((c) => c.id === activeConvId);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: theme.canvas }}>
      <header className="flex items-center justify-between px-4 md:px-6 py-3 flex-shrink-0" style={{ borderBottom: `1px solid ${theme.border}` }}>
        <div className="flex items-center gap-3">
          <Link to="/" className="p-1.5 rounded-lg transition-colors" style={{ background: "rgba(255,255,255,0.04)" }} title="返回指挥台">
            <ArrowLeft size={15} style={{ color: theme.textSub }} />
          </Link>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(251,146,60,0.15)", border: "1px solid rgba(251,146,60,0.35)" }}>
            <Wrench size={17} style={{ color: "#FB923C" }} />
          </div>
          <div>
            <div className="text-sm font-bold" style={{ color: theme.text }}>开发总监 · DevDirector</div>
            <div className="text-xs flex items-center gap-1.5 mt-0.5" style={{ color: theme.textMuted }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#4ade80", animation: "pulseGreen 3s ease-in-out infinite" }} />
              Clinic OS V9 智能监理 · 在线
            </div>
          </div>
        </div>
        <button onClick={handleNewConversation} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all active:scale-95" style={{ background: "rgba(251,146,60,0.12)", border: "1px solid rgba(251,146,60,0.3)" }}>
          <Plus size={13} style={{ color: "#FB923C" }} />
          <span className="text-xs font-semibold" style={{ color: "#FB923C" }}>新指令</span>
        </button>
      </header>

      <div className="flex-1 flex flex-col min-h-0 max-w-4xl w-full mx-auto px-4 md:px-6 py-4">
        <div className="flex-1 overflow-y-auto space-y-4 pb-4">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-4">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: "rgba(251,146,60,0.12)", border: "1px solid rgba(251,146,60,0.3)" }}>
                <Sparkles size={26} style={{ color: "#FB923C" }} />
              </div>
              <div className="text-base font-semibold mb-1" style={{ color: theme.text }}>开发总监已就位</div>
              <div className="text-xs mb-6 max-w-sm" style={{ color: theme.textMuted }}>
                我是你的智能运营监理。告诉我你想解决什么问题，我会读取门店实时数据并生成处置任务草案。
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-xl">
                {SUGGESTED_PROMPTS.map((p, i) => (
                  <button key={i} onClick={() => handleSend(p)} className="text-left text-xs px-3 py-2.5 rounded-xl transition-all active:scale-[0.98]" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
                    <span style={{ color: theme.textSub }}>{p}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((m, i) => <MessageBubble key={i} message={m} />)}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        <div className="flex-shrink-0">
          <div className="flex items-end gap-2 rounded-2xl p-2" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
              }}
              placeholder="向开发总监下达指令…（Enter 发送 / Shift+Enter 换行）"
              rows={1}
              className="flex-1 bg-transparent resize-none px-2 py-2 text-sm outline-none"
              style={{ color: theme.text, maxHeight: "120px" }}
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || sending}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-95 disabled:opacity-40 flex-shrink-0"
              style={{ background: input.trim() ? "linear-gradient(135deg, #FB923C, #F97316)" : "rgba(251,146,60,0.2)", color: input.trim() ? "#0D1B2A" : "#FB923C" }}
            >
              {sending ? <Loader size={15} className="animate-spin" /> : <Send size={15} />}
            </button>
          </div>
          {activeConv && (
            <div className="text-xs mt-2 flex items-center gap-1.5" style={{ color: theme.textFaint }}>
              <MessageSquare size={10} />
              当前会话：{activeConv.metadata?.name || "作战指令"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DevDirector() {
  return (
    <ThemeProvider>
      <DevDirectorInner />
    </ThemeProvider>
  );
}