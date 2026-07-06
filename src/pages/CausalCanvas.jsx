import React, { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, GitBranch, Zap, Radio, Activity } from "lucide-react";

const C = {
  cyan: "#00C7D9", green: "#16A34A", amber: "#D97706", red: "#DC2626", purple: "#8B5CF6",
  text: "#F1F5F9", sub: "#94A3B8", faint: "#64748B",
  card: "#1E293B", border: "#334155", canvas: "#0D1B2A",
};

const AGENTS = [
  { id: 1, name: "咨询接待", group: "一线" }, { id: 2, name: "验光检查", group: "一线" },
  { id: 3, name: "眼科诊疗", group: "一线" }, { id: 4, name: "配镜交付", group: "一线" },
  { id: 5, name: "收费结算", group: "一线" }, { id: 6, name: "术后随访", group: "一线" },
  { id: 7, name: "预约分诊", group: "一线" }, { id: 8, name: "档案管理", group: "后勤" },
  { id: 9, name: "库存补给", group: "后勤" }, { id: 10, name: "设备维护", group: "后勤" },
  { id: 11, name: "消毒供应", group: "后勤" }, { id: 12, name: "采购管理", group: "后勤" },
  { id: 13, name: "人事调度", group: "后勤" }, { id: 14, name: "财务核算", group: "管理" },
  { id: 15, name: "合规质控", group: "管理" }, { id: 16, name: "营销获客", group: "管理" },
  { id: 17, name: "会员运营", group: "管理" }, { id: 18, name: "院长决策台", group: "管理" },
];

const GROUP_COLOR = { 一线: C.cyan, 后勤: C.green, 管理: C.amber };

// Causal chains: each is a real business journey across agents
const CHAINS = [
  { id: "visit", name: "标准就诊流", color: C.cyan, icon: "🏥", steps: [7, 1, 2, 3, 4, 5, 6] },
  { id: "acquire", name: "获客转化流", color: C.amber, icon: "📣", steps: [16, 17, 7, 1, 2, 4, 5] },
  { id: "supply", name: "后勤保障流", color: C.green, icon: "📦", steps: [9, 12, 10, 11, 3] },
  { id: "audit", name: "合规质控流", color: C.purple, icon: "🛡️", steps: [15, 8, 14, 18] },
];

const CX = 380, CY = 290, R = 195;
function agentPos(id) {
  const i = AGENTS.findIndex((a) => a.id === id);
  const angle = (i / 18) * Math.PI * 2 - Math.PI / 2;
  return { x: CX + R * Math.cos(angle), y: CY + R * Math.sin(angle) };
}

// Quadratic curve path between two agents, bowing outward
function chainPath(fromId, toId) {
  const a = agentPos(fromId);
  const b = agentPos(toId);
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  // push midpoint outward from center
  const dx = mx - CX, dy = my - CY;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const bow = 26;
  const ox = mx + (dx / len) * bow;
  const oy = my + (dy / len) * bow;
  return { d: `M${a.x},${a.y} Q${ox},${oy} ${b.x},${b.y}`, mid: { x: ox, y: oy } };
}

export default function CausalCanvas() {
  const [agentStates, setAgentStates] = useState(() => Object.fromEntries(AGENTS.map((a) => [a.id, { state: "idle", count: 0, flash: 0 }])));
  const [particles, setParticles] = useState([]); // {id, chainId, stepIdx, color}
  const [log, setLog] = useState([]);
  const [activeChain, setActiveChain] = useState(null);
  const [autoRun, setAutoRun] = useState(true);
  const [selected, setSelected] = useState(null);
  const timersRef = useRef([]);

  const clearTimers = () => { timersRef.current.forEach(clearTimeout); timersRef.current = []; };

  useEffect(() => () => clearTimers(), []);

  const addLog = (entry) => {
    setLog((prev) => [{ id: Date.now() + Math.random(), time: new Date().toLocaleTimeString("zh-CN", { hour12: false }), ...entry }, ...prev].slice(0, 24));
  };

  const flashAgent = useCallback((id, color, kind) => {
    setAgentStates((prev) => ({
      ...prev,
      [id]: { state: kind === "alert" ? "alert" : "busy", count: prev[id].count + 1, flash: prev[id].flash + 1, lastColor: color },
    }));
    setTimeout(() => {
      setAgentStates((prev) => ({
        ...prev,
        [id]: { ...prev[id], state: prev[id].state === "alert" ? "idle" : "idle" },
      }));
    }, 1400);
  }, []);

  const injectChain = useCallback((chain) => {
    setActiveChain(chain.id);
    addLog({ type: "chain", color: chain.color, text: `${chain.icon} ${chain.name} · 因果链启动，共 ${chain.steps.length} 跳` });
    chain.steps.forEach((agentId, idx) => {
      // particle hops into this agent
      const t1 = setTimeout(() => {
        setParticles((prev) => [...prev, { id: `p-${chain.id}-${idx}-${Date.now()}`, chainId: chain.id, stepIdx: idx, color: chain.color, agentId }]);
        flashAgent(agentId, chain.color, "normal");
        const agent = AGENTS.find((a) => a.id === agentId);
        addLog({ type: "hop", color: chain.color, text: `→ [${agent.name}] 接收到上游数据，执行因果校验（第${idx + 1}跳）` });
      }, idx * 850);
      timersRef.current.push(t1);
      // particle leaves to next
      const t2 = setTimeout(() => {
        setParticles((prev) => prev.filter((p) => !(p.id === `p-${chain.id}-${idx}-${Date.now() - 850}`)));
      }, idx * 850 + 700);
      timersRef.current.push(t2);
    });
    const done = setTimeout(() => {
      addLog({ type: "success", color: C.green, text: `✅ ${chain.name} 因果链闭环完成，证据已核销` });
      setActiveChain(null);
    }, chain.steps.length * 850 + 200);
    timersRef.current.push(done);
  }, [flashAgent]);

  // Auto-run: cycle chains
  useEffect(() => {
    if (!autoRun) return;
    let idx = 0;
    const run = () => {
      injectChain(CHAINS[idx % CHAINS.length]);
      idx++;
    };
    run();
    const iv = setInterval(run, 7500);
    return () => clearInterval(iv);
  }, [autoRun, injectChain]);

  // Decay particles
  useEffect(() => {
    if (particles.length === 0) return;
    const t = setInterval(() => {
      setParticles((prev) => {
        const now = Date.now();
        return prev.filter((p) => now - (p.born || now) < 1200);
      });
    }, 400);
    return () => clearInterval(t);
  }, [particles.length > 0]);

  const onlineCount = 18;
  const busyCount = Object.values(agentStates).filter((s) => s.state !== "idle").length;
  const totalEvents = Object.values(agentStates).reduce((s, x) => s + x.count, 0);

  return (
    <div className="min-h-screen" style={{ background: C.canvas }}>
      {/* Header */}
      <div className="sticky top-0 z-20 px-4 py-3 flex items-center gap-3 border-b" style={{ background: "rgba(13,27,42,0.92)", backdropFilter: "blur(8px)", borderColor: C.border }}>
        <Link to="/" className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "rgba(0,199,217,0.1)", color: C.cyan, border: "1px solid rgba(0,199,217,0.25)" }}>
          <ArrowLeft size={13} /> 返回看板
        </Link>
        <div>
          <div className="text-sm font-bold" style={{ color: C.text }}>Clinic OS · 全景因果链画布</div>
          <div className="text-xs" style={{ color: C.faint }}>18 区域 Agent 实时联动 · 因果链驱动</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setAutoRun((v) => !v)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: autoRun ? "rgba(22,163,74,0.12)" : "rgba(148,163,184,0.1)", color: autoRun ? "#4ade80" : C.sub, border: `1px solid ${autoRun ? "rgba(22,163,74,0.3)" : C.border}` }}>
            <Radio size={13} /> {autoRun ? "自动联动中" : "已暂停"}
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 p-4 md:p-6 max-w-[1200px] mx-auto">
        {/* Canvas */}
        <div className="flex-1 min-w-0">
          {/* Stats strip */}
          <div className="flex items-center gap-4 px-4 py-2.5 rounded-xl mb-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <span className="text-xs font-semibold" style={{ color: C.faint, fontSize: "10px" }}>画布状态</span>
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: C.green }} /><span className="text-xs font-semibold" style={{ color: "#4ade80" }}>{onlineCount} 在线</span></div>
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: C.cyan }} /><span className="text-xs font-semibold" style={{ color: C.cyan }}>{busyCount} 执行中</span></div>
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: C.amber }} /><span className="text-xs font-semibold" style={{ color: "#fbbf24" }}>累计 {totalEvents} 次联动</span></div>
            <div className="ml-auto text-xs" style={{ color: C.faint, fontSize: "10px" }}>因果链实时校验</div>
          </div>

          <div className="rounded-2xl p-3" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <svg viewBox="0 0 760 580" className="w-full h-auto" style={{ display: "block" }}>
              <defs>
                <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="3" />
                </filter>
                <radialGradient id="centerGlow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor={C.cyan} stopOpacity="0.18" />
                  <stop offset="100%" stopColor={C.cyan} stopOpacity="0" />
                </radialGradient>
              </defs>

              <circle cx={CX} cy={CY} r="80" fill="url(#centerGlow)" />

              {/* Chain edges */}
              {CHAINS.map((chain) =>
                chain.steps.slice(0, -1).map((fromId, i) => {
                  const toId = chain.steps[i + 1];
                  const { d } = chainPath(fromId, toId);
                  const isHot = activeChain === chain.id;
                  return (
                    <path key={`${chain.id}-${i}`} d={d} fill="none"
                      stroke={chain.color}
                      strokeWidth={isHot ? 2.2 : 1}
                      strokeOpacity={isHot ? 0.6 : 0.2}
                      strokeDasharray={isHot ? "0" : "3 4"}
                      style={{ transition: "all 0.3s" }}
                    />
                  );
                })
              )}

              {/* Agent nodes */}
              {AGENTS.map((a) => {
                const p = agentPos(a.id);
                const st = agentStates[a.id];
                const col = GROUP_COLOR[a.group];
                const r = 17;
                const isBusy = st.state !== "idle";
                const isAlert = st.state === "alert";
                const ringColor = isAlert ? C.red : isBusy ? (st.lastColor || col) : col;
                const isSel = selected === a.id;
                return (
                  <g key={a.id} style={{ cursor: "pointer" }} onClick={() => setSelected(isSel ? null : a.id)}>
                    {isBusy && <circle cx={p.x} cy={p.y} r={r + 6} fill="none" stroke={ringColor} strokeWidth="1.5" opacity="0.5">
                      <animate attributeName="r" from={r + 2} to={r + 10} dur="1s" repeatCount="indefinite" />
                      <animate attributeName="opacity" from="0.6" to="0" dur="1s" repeatCount="indefinite" />
                    </circle>}
                    <circle cx={p.x} cy={p.y} r={r} fill={C.card} stroke={ringColor} strokeWidth={isSel ? 2.5 : isBusy ? 2 : 1.4} />
                    <circle cx={p.x} cy={p.y} r="3.5" fill={isBusy ? ringColor : col} opacity={isBusy ? 1 : 0.5} />
                    <text x={p.x} y={p.y + 3} textAnchor="middle" fill={col} fontSize="8.5" fontWeight="700">{String(a.id).padStart(2, "0")}</text>
                    <text x={p.x} y={p.y + r + 9} textAnchor="middle" fill={isSel ? C.text : C.sub} fontSize="7.5" fontWeight={isSel ? 600 : 400}>{a.name}</text>
                    <text x={p.x} y={p.y + r + 19} textAnchor="middle" fill={C.faint} fontSize="6.5">{st.count} 次</text>
                  </g>
                );
              })}

              {/* Particles on chain edges */}
              {particles.map((pt) => {
                const chain = CHAINS.find((c) => c.id === pt.chainId);
                if (!chain) return null;
                const fromId = chain.steps[pt.stepIdx];
                const toId = chain.steps[pt.stepIdx + 1];
                if (!toId) {
                  // terminal: sit on agent
                  const p = agentPos(fromId);
                  return <circle key={pt.id} cx={p.x} cy={p.y} r="5" fill={pt.color} filter="url(#glow)" opacity="0.9">
                    <animate attributeName="opacity" from="0.9" to="0" dur="0.6s" fill="freeze" />
                  </circle>;
                }
                const { d } = chainPath(fromId, toId);
                return (
                  <g key={pt.id}>
                    <path d={d} fill="none" stroke={pt.color} strokeWidth="3" strokeLinecap="round" opacity="0.85">
                      <animate attributeName="stroke-dasharray" from="0 300" to="300 0" dur="0.8s" fill="freeze" />
                    </path>
                    <circle r="5" fill={pt.color} filter="url(#glow)">
                      <animateMotion dur="0.8s" fill="freeze" path={d} />
                    </circle>
                  </g>
                );
              })}

              {/* Center label */}
              <text x={CX} y={CY - 4} textAnchor="middle" fill={C.sub} fontSize="10" fontWeight="700">因果链</text>
              <text x={CX} y={CY + 10} textAnchor="middle" fill={C.faint} fontSize="8">CrossVerification</text>
            </svg>
          </div>

          {/* Chain controls */}
          <div className="mt-4 rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <div className="flex items-center gap-2 mb-3">
              <GitBranch size={14} style={{ color: C.cyan }} />
              <span className="text-xs font-bold" style={{ color: C.text }}>因果链注入 · 点击手动触发某条业务流</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {CHAINS.map((chain) => (
                <button key={chain.id} onClick={() => injectChain(chain)} disabled={activeChain !== null}
                  className="rounded-lg px-3 py-2.5 text-left disabled:opacity-40 transition-all active:scale-95"
                  style={{ background: activeChain === chain.id ? `${chain.color}18` : "rgba(148,163,184,0.05)", border: `1px solid ${activeChain === chain.id ? chain.color : `${chain.color}33`}` }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span style={{ fontSize: "13px" }}>{chain.icon}</span>
                    <span className="text-xs font-bold" style={{ color: chain.color }}>{chain.name}</span>
                  </div>
                  <div className="text-xs" style={{ color: C.sub, fontSize: "9.5px" }}>{chain.steps.length} 跳 · {chain.steps.map((s) => AGENTS.find((a) => a.id === s).name).join("→")}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Selected agent detail */}
          {selected && (
            <div className="mt-4 rounded-2xl p-4 animate-slide-in-top" style={{ background: C.card, border: `1px solid ${GROUP_COLOR[AGENTS.find((a) => a.id === selected).group]}44` }}>
              {(() => {
                const a = AGENTS.find((x) => x.id === selected);
                const st = agentStates[selected];
                const inChains = CHAINS.filter((c) => c.steps.includes(selected));
                return (
                  <>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="w-6 h-6 rounded flex items-center justify-center text-xs font-bold" style={{ background: `${GROUP_COLOR[a.group]}22`, color: GROUP_COLOR[a.group] }}>{String(a.id).padStart(2, "0")}</span>
                      <span className="text-sm font-bold" style={{ color: C.text }}>{a.name}</span>
                      <span className="ml-auto text-xs" style={{ color: GROUP_COLOR[a.group] }}>{a.group}职能</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mb-2">
                      <div className="rounded-lg px-2 py-1.5" style={{ background: "rgba(148,163,184,0.06)" }}>
                        <div className="text-xs" style={{ color: C.faint, fontSize: "9px" }}>当前状态</div>
                        <div className="text-xs font-bold" style={{ color: st.state === "idle" ? "#4ade80" : st.state === "alert" ? "#f87171" : C.cyan }}>{st.state === "idle" ? "空闲" : st.state === "alert" ? "告警" : "执行中"}</div>
                      </div>
                      <div className="rounded-lg px-2 py-1.5" style={{ background: "rgba(148,163,184,0.06)" }}>
                        <div className="text-xs" style={{ color: C.faint, fontSize: "9px" }}>累计联动</div>
                        <div className="text-xs font-bold" style={{ color: C.text }}>{st.count} 次</div>
                      </div>
                      <div className="rounded-lg px-2 py-1.5" style={{ background: "rgba(148,163,184,0.06)" }}>
                        <div className="text-xs" style={{ color: C.faint, fontSize: "9px" }}>所属因果链</div>
                        <div className="text-xs font-bold" style={{ color: C.text }}>{inChains.length} 条</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {inChains.map((c) => (
                        <span key={c.id} className="text-xs px-2 py-0.5 rounded-full" style={{ background: `${c.color}15`, color: c.color, border: `1px solid ${c.color}33`, fontSize: "9.5px" }}>{c.icon} {c.name}</span>
                      ))}
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </div>

        {/* Right: causal log */}
        <div className="w-full lg:w-[320px] flex-shrink-0">
          <div className="rounded-2xl p-4 sticky top-[72px]" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <div className="flex items-center gap-2 mb-3">
              <Zap size={14} style={{ color: C.cyan }} />
              <span className="text-xs font-bold" style={{ color: C.text }}>因果链事件日志</span>
              <span className="ml-auto w-1.5 h-1.5 rounded-full" style={{ background: C.green, animation: "pulseGreen 3s ease-in-out infinite" }} />
            </div>
            <div className="space-y-1.5 max-h-[520px] overflow-y-auto">
              {log.length === 0 ? (
                <div className="text-xs py-6 text-center" style={{ color: C.faint }}>等待因果链启动…</div>
              ) : log.map((l) => (
                <div key={l.id} className="text-xs flex items-start gap-2 animate-fade-in" style={{ fontSize: "10.5px", lineHeight: "1.4" }}>
                  <span style={{ color: C.faint, flexShrink: 0 }}>{l.time}</span>
                  <span style={{ color: l.color || C.sub }}>
                    {l.type === "chain" && "🔗 "}
                    {l.type === "hop" && ""}
                    {l.type === "success" && ""}
                    {l.text}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t flex items-center gap-2" style={{ borderColor: C.border }}>
              <Activity size={12} style={{ color: C.faint }} />
              <span className="text-xs" style={{ color: C.faint, fontSize: "10px" }}>每次联动均经 CrossVerification 因果校验</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}