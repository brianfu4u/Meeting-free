import React, { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Play, RotateCcw, Power, Zap, Activity, Brain, CheckCircle2, AlertTriangle } from "lucide-react";

const C = {
  cyan: "#00C7D9", green: "#16A34A", amber: "#D97706", red: "#DC2626",
  text: "#F1F5F9", sub: "#94A3B8", faint: "#64748B",
  card: "#1E293B", border: "#334155", canvas: "#0D1B2A",
};

const AGENTS = [
  { id: 1, name: "咨询接待", group: "一线" }, { id: 2, name: "验光检查", group: "一线" },
  { id: 3, name: "眼科诊疗", group: "一线" }, { id: 4, name: "配镜交付", group: "一线" },
  { id: 5, name: "收费结算", group: "一线" }, { id: 6, name: "术后随访", group: "一线" },
  { id: 7, name: "预约分诊", group: "一线" }, { id: 8, name: "档案管理", group: "后勤" },
  { id: 9, name: "库存补给", group: "后勤" }, { id: 10, name: "设备维护", group: "后勤" },
  { id: 11, name: "消毒供应", group: "后勤" }, { id: 12, name: "采购 inbound", group: "后勤" },
  { id: 13, name: "人事调度", group: "后勤" }, { id: 14, name: "财务核算", group: "管理" },
  { id: 15, name: "合规质控", group: "管理" }, { id: 16, name: "营销获客", group: "管理" },
  { id: 17, name: "会员运营", group: "管理" }, { id: 18, name: "院长决策台", group: "管理" },
];

const BOOT_PHASES = [
  { code: "BOOT", name: "系统通电 · 内核加载", detail: "Clinic OS V8 运行时初始化", target: 1200 },
  { code: "M1", name: "基建层就绪 · 实体与多店隔离", detail: "ClinicDataSkill 加载 18 区域 Schema", target: 1500 },
  { code: "M2", name: "态势引擎启动 · 状态机接入", detail: "StationScanSkill 开启全岗监听", target: 1500 },
  { code: "AGENTS", name: "区域 Agent 依次上线", detail: "18 个 Agent 建立订阅通道", target: 2200 },
  { code: "M3", name: "智能中枢激活 · 因果链验证", detail: "CrossVerificationSkill 开始巡检", target: 1500 },
  { code: "LIVE", name: "全场景覆盖 · 实时联动开始", detail: "数据流闭环建立完成", target: 1000 },
];

const GROUP_COLOR = { 一线: C.cyan, 后勤: C.green, 管理: C.amber };

// Canvas geometry: ring layout for 18 agents around a central core
const CX = 360, CY = 290, R = 200;
function agentPos(i) {
  const angle = (i / 18) * Math.PI * 2 - Math.PI / 2;
  return { x: CX + R * Math.cos(angle), y: CY + R * Math.sin(angle) };
}

const LIVE_EVENTS = [
  { agent: 1, type: "info", msg: "新患者到店扫码登记" },
  { agent: 2, type: "warn", msg: "验光排队超 15 分钟，触发拥堵预警" },
  { agent: 5, type: "info", msg: "配镜订单完成结算" },
  { agent: 9, type: "warn", msg: "镜片库存低于安全线" },
  { agent: 3, type: "critical", msg: "诊室3设备离线，证据链断裂" },
  { agent: 13, type: "info", msg: "视光师X接到调度指令" },
  { agent: 14, type: "info", msg: "日营收达成率 62%" },
  { agent: 6, type: "info", msg: "术后随访电话接通" },
  { agent: 10, type: "warn", msg: "焦度计需校准，已派单" },
  { agent: 16, type: "info", msg: "小程序新客引流 +3" },
];

export default function SystemBootDemo() {
  const [phaseIdx, setPhaseIdx] = useState(-1); // -1 idle, 0..BOOT_PHASES.length-1 active, last = LIVE
  const [onlineAgents, setOnlineAgents] = useState(new Set());
  const [pulses, setPulses] = useState([]); // {id, from, to, color}
  const [log, setLog] = useState([]);
  const [liveEvents, setLiveEvents] = useState([]);
  const [running, setRunning] = useState(false);
  const timersRef = useRef([]);

  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

  const reset = useCallback(() => {
    clearTimers();
    setPhaseIdx(-1);
    setOnlineAgents(new Set());
    setPulses([]);
    setLog([]);
    setLiveEvents([]);
    setRunning(false);
  }, []);

  const addLog = (entry) => {
    setLog((prev) => [{ id: Date.now() + Math.random(), time: new Date().toLocaleTimeString("zh-CN", { hour12: false }), ...entry }, ...prev].slice(0, 30));
  };

  const start = useCallback(() => {
    clearTimers();
    setOnlineAgents(new Set());
    setPulses([]);
    setLog([]);
    setLiveEvents([]);
    setRunning(true);

    let delay = 0;
    BOOT_PHASES.forEach((ph, i) => {
      const t = setTimeout(() => {
        setPhaseIdx(i);
        addLog({ type: "phase", text: ph.name });

        if (ph.code === "AGENTS") {
          // bring agents online sequentially
          AGENTS.forEach((a, j) => {
            const at = setTimeout(() => {
              setOnlineAgents((prev) => new Set([...prev, a.id]));
              setPulses((prev) => [...prev, { id: `on-${a.id}-${j}`, from: "core", to: a.id, color: GROUP_COLOR[a.group], kind: "boot" }]);
              addLog({ type: "agent", text: `Agent ${String(a.id).padStart(2, "0")} · ${a.name} 上线` });
            }, j * 110);
            timersRef.current.push(at);
          });
        }
        if (ph.code === "M1" || ph.code === "M2" || ph.code === "M3") {
          setPulses((prev) => [...prev, { id: `core-${ph.code}-${Date.now()}`, from: ph.code, to: "core", color: C.cyan, kind: "boot" }]);
        }
      }, delay);
      timersRef.current.push(t);
      delay += ph.target;
    });

    // enter LIVE phase
    const liveT = setTimeout(() => {
      setPhaseIdx(BOOT_PHASES.length); // LIVE index
      addLog({ type: "success", text: "✅ 全场景覆盖完成，实时联动开启" });
      setRunning(false);
    }, delay);
    timersRef.current.push(liveT);
  }, []);

  // Cleanup
  useEffect(() => () => clearTimers(), []);

  // Remove pulses after animation
  useEffect(() => {
    if (pulses.length === 0) return;
    const t = setTimeout(() => setPulses((prev) => prev.slice(1)), 700);
    return () => clearTimeout(t);
  }, [pulses]);

  const isLive = phaseIdx >= BOOT_PHASES.length;
  const currentPhase = phaseIdx >= 0 && phaseIdx < BOOT_PHASES.length ? BOOT_PHASES[phaseIdx] : null;

  // Live event simulation once in LIVE phase
  useEffect(() => {
    if (!isLive) return;
    let evtIdx = 0;
    const spawn = () => {
      const ev = LIVE_EVENTS[evtIdx % LIVE_EVENTS.length];
      evtIdx++;
      const agent = AGENTS.find((a) => a.id === ev.agent);
      const color = ev.type === "critical" ? C.red : ev.type === "warn" ? C.amber : C.cyan;
      // pulse agent -> core
      setPulses((prev) => [...prev, { id: `evt-${Date.now()}-${evtIdx}`, from: ev.agent, to: "core", color, kind: "event" }]);
      // core -> back to agent (decision)
      setTimeout(() => {
        setPulses((prev) => [...prev, { id: `dec-${Date.now()}-${evtIdx}`, from: "core", to: ev.agent, color: C.green, kind: "decision" }]);
      }, 600);
      setLiveEvents((prev) => [{ id: Date.now() + Math.random(), agent: ev.agent, agentName: agent.name, type: ev.type, msg: ev.msg, color }, ...prev].slice(0, 8));
      addLog({ type: ev.type, text: `[${agent.name}] ${ev.msg}` });
    };
    spawn();
    const iv = setInterval(spawn, 2800);
    return () => clearInterval(iv);
  }, [isLive]);

  const coreStatus = phaseIdx < 0 ? "idle" : isLive ? "live" : "booting";

  return (
    <div className="min-h-screen" style={{ background: C.canvas }}>
      {/* Header */}
      <div className="sticky top-0 z-20 px-4 py-3 flex items-center gap-3 border-b" style={{ background: "rgba(13,27,42,0.92)", backdropFilter: "blur(8px)", borderColor: C.border }}>
        <Link to="/" className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "rgba(0,199,217,0.1)", color: C.cyan, border: "1px solid rgba(0,199,217,0.25)" }}>
          <ArrowLeft size={13} /> 返回看板
        </Link>
        <div>
          <div className="text-sm font-bold" style={{ color: C.text }}>Clinic OS · 系统启动联动演示</div>
          <div className="text-xs" style={{ color: C.faint }}>18 区域 Agent 上线 → 实时事件联动</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={start} disabled={running} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40" style={{ background: running ? "rgba(148,163,184,0.1)" : "rgba(22,163,74,0.12)", color: running ? C.sub : "#4ade80", border: `1px solid ${running ? "rgba(148,163,184,0.2)" : "rgba(22,163,74,0.3)"}` }}>
            <Play size={13} /> {running ? "启动中…" : "启动演示"}
          </button>
          <button onClick={reset} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "rgba(220,38,38,0.1)", color: "#f87171", border: "1px solid rgba(220,38,38,0.25)" }}>
            <RotateCcw size={13} /> 重置
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 p-4 md:p-6 max-w-[1200px] mx-auto">
        {/* Canvas */}
        <div className="flex-1 min-w-0">
          <div className="rounded-2xl p-3" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-xs font-bold" style={{ color: C.text }}>联动画布</span>
              <span className="text-xs" style={{ color: C.faint }}>
                {onlineAgents.size}/18 Agent 在线
              </span>
            </div>
            <svg viewBox="0 0 720 580" className="w-full h-auto" style={{ display: "block" }}>
              <defs>
                <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor={C.cyan} stopOpacity="0.35" />
                  <stop offset="100%" stopColor={C.cyan} stopOpacity="0" />
                </radialGradient>
                <filter id="soft" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="2.5" />
                </filter>
              </defs>

              {/* Core glow */}
              <circle cx={CX} cy={CY} r="90" fill="url(#coreGlow)" opacity={coreStatus === "idle" ? 0.2 : 0.7} />

              {/* Connection lines (faint) */}
              {AGENTS.map((a) => {
                const p = agentPos(a.id - 1);
                const online = onlineAgents.has(a.id);
                return (
                  <line key={`line-${a.id}`} x1={CX} y1={CY} x2={p.x} y2={p.y}
                    stroke={online ? GROUP_COLOR[a.group] : C.border}
                    strokeWidth={online ? 1 : 0.5}
                    strokeOpacity={online ? 0.3 : 0.4}
                  />
                );
              })}

              {/* Pulse particles */}
              {pulses.map((p) => {
                const core = { x: CX, y: CY };
                const fromAgent = typeof p.from === "number" ? AGENTS.find((a) => a.id === p.from) : null;
                const toAgent = typeof p.to === "number" ? AGENTS.find((a) => a.id === p.to) : null;
                const fromPos = fromAgent ? agentPos(fromAgent.id - 1) : core;
                const toPos = toAgent ? agentPos(toAgent.id - 1) : core;
                return (
                  <g key={p.id}>
                    <line x1={fromPos.x} y1={fromPos.y} x2={toPos.x} y2={toPos.y}
                      stroke={p.color} strokeWidth="2.5" strokeLinecap="round" opacity="0.9">
                      <animate attributeName="stroke-dasharray" from="0 200" to="200 0" dur="0.6s" fill="freeze" />
                    </line>
                    <circle r="4" fill={p.color} filter="url(#soft)">
                      <animateMotion dur="0.6s" fill="freeze" path={`M${fromPos.x},${fromPos.y} L${toPos.x},${toPos.y}`} />
                    </circle>
                  </g>
                );
              })}

              {/* Core node */}
              <g>
                <circle cx={CX} cy={CY} r="42" fill={C.card} stroke={coreStatus === "live" ? C.green : C.cyan} strokeWidth="2" />
                <circle cx={CX} cy={CY} r="42" fill="none" stroke={coreStatus === "live" ? C.green : C.cyan} strokeWidth="1" opacity="0.4">
                  {coreStatus !== "idle" && <animate attributeName="r" from="42" to="58" dur="1.6s" repeatCount="indefinite" />}
                  {coreStatus !== "idle" && <animate attributeName="opacity" from="0.4" to="0" dur="1.6s" repeatCount="indefinite" />}
                </circle>
                <text x={CX} y={CY - 6} textAnchor="middle" fill={C.text} fontSize="11" fontWeight="700">CORE</text>
                <text x={CX} y={CY + 9} textAnchor="middle" fill={coreStatus === "live" ? C.green : C.cyan} fontSize="8.5" fontWeight="600">
                  {coreStatus === "idle" ? "待启动" : coreStatus === "live" ? "实时联动" : "启动中"}
                </text>
              </g>

              {/* Agent nodes */}
              {AGENTS.map((a) => {
                const p = agentPos(a.id - 1);
                const online = onlineAgents.has(a.id);
                const col = GROUP_COLOR[a.group];
                const r = 16;
                return (
                  <g key={a.id} opacity={online ? 1 : 0.35}>
                    <circle cx={p.x} cy={p.y} r={r} fill={online ? C.card : "rgba(30,41,59,0.5)"} stroke={online ? col : C.border} strokeWidth={online ? 1.6 : 1} />
                    {online && <circle cx={p.x} cy={p.y} r="3" fill={col}>
                      <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" begin={`${a.id * 0.1}s`} />
                    </circle>}
                    <text x={p.x} y={p.y + 3} textAnchor="middle" fill={online ? col : C.faint} fontSize="8.5" fontWeight="700">
                      {String(a.id).padStart(2, "0")}
                    </text>
                    <text x={p.x} y={p.y + r + 9} textAnchor="middle" fill={online ? C.sub : C.faint} fontSize="7.5">{a.name}</text>
                  </g>
                );
              })}
            </svg>

            {/* Boot progress bar */}
            <div className="mt-3 px-1">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs" style={{ color: currentPhase ? C.cyan : isLive ? C.green : C.faint }}>
                  {currentPhase ? currentPhase.name : isLive ? "实时联动运行中" : "点击「启动演示」开始"}
                </span>
                <span className="text-xs" style={{ color: C.faint }}>
                  阶段 {Math.min(phaseIdx + 1, BOOT_PHASES.length)}/{BOOT_PHASES.length}
                </span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(148,163,184,0.12)" }}>
                <div style={{
                  height: "100%",
                  width: `${(Math.min(phaseIdx + 1, BOOT_PHASES.length) / BOOT_PHASES.length) * 100}%`,
                  background: isLive ? C.green : `linear-gradient(to right, ${C.cyan}, ${C.green})`,
                  transition: "width 0.5s ease",
                }} />
              </div>
            </div>
          </div>

          {/* Phase timeline */}
          <div className="mt-4 rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <div className="text-xs font-bold mb-3" style={{ color: C.text }}>启动阶段时间线</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {BOOT_PHASES.map((ph, i) => {
                const done = phaseIdx > i || isLive;
                const active = phaseIdx === i;
                return (
                  <div key={ph.code} className="rounded-lg px-3 py-2" style={{
                    background: active ? "rgba(0,199,217,0.1)" : done ? "rgba(22,163,74,0.06)" : "rgba(148,163,184,0.04)",
                    border: `1px solid ${active ? "rgba(0,199,217,0.3)" : done ? "rgba(22,163,74,0.25)" : C.border}`,
                  }}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      {done ? <CheckCircle2 size={11} style={{ color: "#4ade80" }} /> : active ? <Activity size={11} style={{ color: C.cyan }} /> : <Power size={11} style={{ color: C.faint }} />}
                      <span className="text-xs font-bold" style={{ color: done ? "#4ade80" : active ? C.cyan : C.faint }}>{ph.code}</span>
                    </div>
                    <div className="text-xs" style={{ color: active ? C.text : C.sub, fontSize: "10px", lineHeight: "1.3" }}>{ph.name}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: live event feed + log */}
        <div className="w-full lg:w-[340px] flex-shrink-0 flex flex-col gap-4">
          {/* Live events */}
          <div className="rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <div className="flex items-center gap-2 mb-3">
              <Zap size={14} style={{ color: isLive ? C.green : C.faint }} />
              <span className="text-xs font-bold" style={{ color: C.text }}>实时事件流</span>
              {isLive && <span className="w-1.5 h-1.5 rounded-full ml-auto" style={{ background: C.green, animation: "pulseGreen 3s ease-in-out infinite" }} />}
            </div>
            {liveEvents.length === 0 ? (
              <div className="text-xs py-6 text-center" style={{ color: C.faint }}>等待系统进入实时联动…</div>
            ) : (
              <div className="space-y-2">
                {liveEvents.map((ev) => (
                  <div key={ev.id} className="rounded-lg px-3 py-2 animate-slide-in-right" style={{ background: `${ev.color}10`, border: `1px solid ${ev.color}33`, borderLeft: `3px solid ${ev.color}` }}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-xs font-bold" style={{ color: ev.color, fontSize: "10px" }}>
                        {ev.type === "critical" ? "🚨 紧急" : ev.type === "warn" ? "⚠️ 预警" : "ℹ️ 动态"}
                      </span>
                      <span className="text-xs" style={{ color: C.sub, fontSize: "10px" }}>· {ev.agentName}</span>
                    </div>
                    <div className="text-xs" style={{ color: C.text, fontSize: "11px", lineHeight: "1.4" }}>{ev.msg}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* System log */}
          <div className="rounded-2xl p-4 flex-1" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <div className="flex items-center gap-2 mb-3">
              <Brain size={14} style={{ color: C.cyan }} />
              <span className="text-xs font-bold" style={{ color: C.text }}>系统日志</span>
            </div>
            <div className="space-y-1 max-h-[300px] overflow-y-auto">
              {log.length === 0 ? (
                <div className="text-xs py-4 text-center" style={{ color: C.faint }}>尚无日志</div>
              ) : log.map((l) => {
                const color = l.type === "critical" ? C.red : l.type === "warn" ? C.amber : l.type === "success" ? C.green : l.type === "phase" ? C.cyan : l.type === "agent" ? C.sub : C.sub;
                return (
                  <div key={l.id} className="text-xs flex items-start gap-2" style={{ fontSize: "10.5px", lineHeight: "1.4" }}>
                    <span style={{ color: C.faint, flexShrink: 0 }}>{l.time}</span>
                    <span style={{ color }}>{l.type === "phase" ? "▶ " : l.type === "agent" ? "◉ " : l.type === "success" ? "" : ""}{l.text}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}