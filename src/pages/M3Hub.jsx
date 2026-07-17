/**
 * Clinic OS V10 M3 — 智能中枢交互页
 * 店长手动触发三大 LLM 技能，AI 仅生成建议（AttentionItem），
 * 店长在 Dashboard 注意力队列确认后才产生实际系统变更。
 */

import React, { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Brain, Zap, ShieldCheck, FileSearch, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { runTaskDraftSkill, runPatrolSkill, runEvidenceEvalSkill } from "@/lib/m3/intelligenceHub";

const C = {
  cyan: "#00C7D9", green: "#16A34A", amber: "#D97706", red: "#DC2626", purple: "#8B5CF6",
  text: "#F1F5F9", sub: "#94A3B8", faint: "#64748B",
  card: "#1E293B", border: "#334155", canvas: "#0D1B2A",
};

const SKILLS = [
  {
    id: "task_draft",
    name: "任务草案生成",
    code: "TaskDraftSkill",
    anchor: "A3 系统逻辑触发",
    desc: "扫描卡滞患者 + 空闲员工，LLM 生成调度建议，写入注意力队列待店长决策",
    icon: Zap,
    color: C.cyan,
    run: runTaskDraftSkill,
  },
  {
    id: "patrol",
    name: "全岗巡检",
    code: "PatrolSkill",
    anchor: "A3 系统逻辑触发",
    desc: "扫描全部实体（患者/员工/库存），LLM 识别异常生成建议，写入注意力队列",
    icon: FileSearch,
    color: C.amber,
    run: runPatrolSkill,
  },
  {
    id: "evidence_eval",
    name: "证据链预审",
    code: "EvidenceEvalSkill",
    anchor: "A1 交叉验证",
    desc: "读取待评估证据，LLM 预审结论；不足/不合格证据触发店长复核建议",
    icon: ShieldCheck,
    color: C.purple,
    run: runEvidenceEvalSkill,
  },
];

export default function M3Hub() {
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(null);
  const [log, setLog] = useState([]);

  const addLog = (entry) => {
    setLog((prev) => [{ id: Date.now() + Math.random(), time: new Date().toLocaleTimeString("zh-CN", { hour12: false }), ...entry }, ...prev].slice(0, 30));
  };

  const handleRun = useCallback(async (skill) => {
    setRunning(skill.id);
    addLog({ type: "start", color: skill.color, text: `▶ ${skill.name} 启动…` });
    try {
      const result = await skill.run();
      setResults((prev) => ({ ...prev, [skill.id]: result }));
      addLog({ type: result.status === "idle" ? "idle" : "success", color: result.status === "idle" ? C.sub : C.green, text: `✅ ${result.message}` });
      if (result.created && result.created.length > 0) {
        result.created.forEach((item) => {
          addLog({ type: "entity", color: skill.color, text: `  ↳ 写入 ${item.id?.slice(-8) || "?"} · ${(item.description || item.message || item.eval_result || "").slice(0, 40)}` });
        });
      }
    } catch (err) {
      addLog({ type: "error", color: C.red, text: `✖ ${skill.name} 执行失败: ${err.message || err}` });
    } finally {
      setRunning(null);
    }
  }, []);

  return (
    <div className="min-h-screen" style={{ background: C.canvas }}>
      {/* Header */}
      <div className="sticky top-0 z-20 px-4 py-3 flex items-center gap-3 border-b" style={{ background: "rgba(13,27,42,0.92)", backdropFilter: "blur(8px)", borderColor: C.border }}>
        <Link to="/" className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "rgba(0,199,217,0.1)", color: C.cyan, border: "1px solid rgba(0,199,217,0.25)" }}>
          <ArrowLeft size={13} /> 返回看板
        </Link>
        <div className="flex items-center gap-2">
          <Brain size={16} style={{ color: C.cyan }} />
          <div>
            <div className="text-sm font-bold" style={{ color: C.text }}>M3 智能中枢 · Intelligence Hub (V10)</div>
            <div className="text-xs" style={{ color: C.faint }}>AI 仅生成建议 · 店长在注意力队列决策后才落地</div>
          </div>
        </div>
      </div>

      <div className="max-w-[1100px] mx-auto p-4 md:p-6">
        {/* Skill cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
          {SKILLS.map((skill) => {
            const Icon = skill.icon;
            const isRunning = running === skill.id;
            const result = results[skill.id];
            return (
              <div key={skill.id} className="rounded-2xl p-4 flex flex-col" style={{ background: C.card, border: `1px solid ${result ? `${skill.color}44` : C.border}` }}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${skill.color}1a`, border: `1px solid ${skill.color}33` }}>
                    <Icon size={16} style={{ color: skill.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold" style={{ color: C.text }}>{skill.name}</div>
                    <div className="text-xs" style={{ color: skill.color, fontSize: "9.5px" }}>{skill.code}</div>
                  </div>
                </div>
                <div className="text-xs mb-2" style={{ color: C.sub, fontSize: "10.5px", lineHeight: "1.4", flex: 1 }}>{skill.desc}</div>
                <div className="text-xs mb-3 px-2 py-1 rounded" style={{ background: `${skill.color}0d`, color: skill.color, fontSize: "9.5px", border: `1px solid ${skill.color}22` }}>
                  锚点 · {skill.anchor}
                </div>
                {result && (
                  <div className="mb-3 rounded-lg px-3 py-2" style={{ background: result.status === "idle" ? "rgba(148,163,184,0.06)" : `${skill.color}0d`, border: `1px solid ${result.status === "idle" ? C.border : `${skill.color}33`}` }}>
                    <div className="flex items-center gap-1.5">
                      {result.status === "idle" ? <AlertCircle size={11} style={{ color: C.sub }} /> : <CheckCircle2 size={11} style={{ color: C.green }} />}
                      <span className="text-xs font-semibold" style={{ color: result.status === "idle" ? C.sub : C.text, fontSize: "10.5px" }}>{result.message}</span>
                    </div>
                    {result.created && result.created.length > 0 && (
                      <div className="text-xs mt-1" style={{ color: C.faint, fontSize: "9.5px" }}>产出 {result.created.length} 条记录</div>
                    )}
                  </div>
                )}
                <button
                  onClick={() => handleRun(skill)}
                  disabled={isRunning}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-50 transition-all active:scale-95"
                  style={{ background: isRunning ? "rgba(148,163,184,0.1)" : `${skill.color}14`, color: isRunning ? C.sub : skill.color, border: `1px solid ${isRunning ? "rgba(148,163,184,0.2)" : `${skill.color}33`}` }}
                >
                  {isRunning ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
                  {isRunning ? "执行中…" : "触发技能"}
                </button>
              </div>
            );
          })}
        </div>

        {/* Execution log */}
        <div className="rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <div className="flex items-center gap-2 mb-3">
            <FileSearch size={14} style={{ color: C.cyan }} />
            <span className="text-xs font-bold" style={{ color: C.text }}>中枢执行日志</span>
            <span className="ml-auto text-xs" style={{ color: C.faint, fontSize: "10px" }}>每次产出均经 Event Bus 记录</span>
          </div>
          {log.length === 0 ? (
            <div className="text-xs py-8 text-center" style={{ color: C.faint }}>点击上方「触发技能」启动 LLM 技能…</div>
          ) : (
            <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
              {log.map((l) => (
                <div key={l.id} className="text-xs flex items-start gap-2 animate-fade-in" style={{ fontSize: "10.5px", lineHeight: "1.4" }}>
                  <span style={{ color: C.faint, flexShrink: 0 }}>{l.time}</span>
                  <span style={{ color: l.color || C.sub }}>{l.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}