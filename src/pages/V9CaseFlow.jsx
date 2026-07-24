import React, { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft, Play, RotateCcw, ChevronRight,
  ScanLine, Camera, Stethoscope, Glasses, Pill, Receipt, CreditCard,
  Building2, Activity, Brain, Workflow, ShieldCheck, Crown,
  CheckCircle2, AlertTriangle, Zap, Clock, User,
} from "lucide-react";

const C = {
  cyan: "#00C7D9", green: "#16A34A", amber: "#D97706", red: "#DC2626",
  purple: "#8B5CF6", blue: "#3B82F6",
  text: "#F1F5F9", sub: "#94A3B8", faint: "#64748B",
  card: "#1E293B", cardHi: "#263347", border: "#334155", canvas: "#0D1B2A",
};

/* M1-M5 五层定义：核心2层(M1/M2) + 执行2层(M3/M4) + 管理1层(M5) */
const LAYERS = [
  { code: "M1", name: "基建层", tier: "核心", role: "数据采集 · 物理留痕", color: C.blue,
    desc: "扫码/拍照动作录入，静默记录，不汇报。Clinic ID 隔离。" },
  { code: "M2", name: "态势层", tier: "核心", role: "状态联动 · 看板同步", color: C.cyan,
    desc: "指针与计数器更新，Agent 间状态自动同步。" },
  { code: "M3", name: "中枢层", tier: "执行", role: "因果链交叉验证", color: C.purple,
    desc: "系统自动逻辑校验，异常自动修复，不惊动人。" },
  { code: "M4", name: "闭环层", tier: "执行", role: "异常路由 · 协同触达", color: C.amber,
    desc: "发起跨岗位协同，向责任人 Agent 发起呼叫。" },
  { code: "M5", name: "总控层", tier: "管理", role: "院长决策 · 宪法仲裁", color: C.red,
    desc: "仅宪法违规/严重滞留，强制穿透触达院长。" },
];

/* 三大锚点 */
const ANCHORS = {
  A1: { code: "A1", name: "交叉验证", color: C.purple, icon: ShieldCheck },
  A2: { code: "A2", name: "患者扫码", color: C.cyan, icon: ScanLine },
  A3: { code: "A3", name: "系统预警", color: C.amber, icon: AlertTriangle },
};

/* 18 Agent 简表 */
const AGENTS = {
  1: { name: "咨询接待", group: "一线" }, 2: { name: "验光检查", group: "一线" },
  3: { name: "眼科诊疗", group: "一线" }, 4: { name: "配镜交付", group: "一线" },
  5: { name: "收费结算", group: "一线" }, 7: { name: "预约分诊", group: "一线" },
  8: { name: "档案管理", group: "后勤" }, 9: { name: "库存补给", group: "后勤" },
  10: { name: "设备维护", group: "后勤" }, 13: { name: "人事调度", group: "后勤" },
  14: { name: "财务核算", group: "管理" }, 15: { name: "合规质控", group: "管理" },
  18: { name: "院长决策台", group: "管理" },
};

/* 张小姐案例：9 个步骤，每步标注锚点 / 涉及Agent / 路由到的M层 / 是否触达院长 */
const CASE_STEPS = [
  {
    id: 0, time: "09:00", title: "前台小王打卡上班",
    icon: User, anchor: "A1", agents: [1, 13], layer: "M1",
    routing: "auto", toBoss: false,
    detail: "小王手机终端点击打卡。A1 交叉验证：打卡定位/Wi-Fi 与 Clinic ID 匹配 → 标记岗位在岗。M1 静默留痕，不上报。",
    artifacts: ["打卡记录", "在岗状态"],
  },
  {
    id: 1, time: "10:02", title: "张小姐携子 walk-in 挂号",
    icon: Building2, anchor: "A2", agents: [1, 7, 8], layer: "M1",
    routing: "auto", toBoss: false,
    detail: "前台扫码建立 PatientSession，分配 patient_id + 物理病历码。M1 落库，M2 接待区排队 +1，分诊 Agent 7 排入队列。",
    artifacts: ["PatientSession 建立", "病历码生成", "排队 +1"],
  },
  {
    id: 2, time: "10:08", title: "刘主任裂隙灯检查眼内",
    icon: Stethoscope, anchor: "A2", agents: [3, 10], layer: "M2",
    routing: "auto", toBoss: false,
    detail: "刘主任扫患者病历码签到诊室。裂隙灯资产卡拍照上传。M2 状态机：待检查 → 检查中。设备 Agent 10 记录使用时长。",
    artifacts: ["诊室签到", "裂隙灯拍照", "状态→检查中"],
  },
  {
    id: 3, time: "10:25", title: "开出视力检查单",
    icon: Receipt, anchor: "A3", agents: [3], layer: "M3",
    routing: "auto", toBoss: false,
    detail: "刘主任开视力检查单。M3 因果校验：裂隙灯数据已上传 → 校验通过，单据生效，流转至验光师小李。",
    artifacts: ["视力检查单", "因果校验通过"],
  },
  {
    id: 4, time: "10:35", title: "验光师小李 · 4 台仪器检查",
    icon: Activity, anchor: "A2", agents: [2, 10], layer: "M1",
    routing: "auto", toBoss: false,
    detail: "小李依次扫 4 台仪器资产卡（视力表/角膜地形图/眼压/视功能），每台拍照上传。M1 留痕，M2 检查区计数联动。",
    artifacts: ["视力表数据", "角膜地形图", "眼压数据", "视功能数据"],
  },
  {
    id: 5, time: "11:10", title: "回刘主任复诊 · 开处方",
    icon: Pill, anchor: "A3", agents: [3, 15], layer: "M3",
    routing: "auto", toBoss: false,
    detail: "刘主任复诊开方：低度阿托品 1 盒 + 近视配镜 1 副。M3 校验：4 台仪器数据齐备 → 通过。合规 Agent 15 归档处方。",
    artifacts: ["处方单", "4 仪器数据齐备", "处方归档"],
  },
  {
    id: 6, time: "11:40", title: "验光师小杜完成验配",
    icon: Glasses, anchor: "A2", agents: [4, 9], layer: "M2",
    routing: "auto", toBoss: false,
    detail: "小杜扫患者码确认验配完成。M2 状态：检查中 → 待结算。库存 Agent 9 预扣镜片库存。",
    artifacts: ["验配完成", "镜片预扣库存", "状态→待结算"],
  },
  {
    id: 7, time: "12:05", title: "前台结账 · 阿托品扣库存",
    icon: CreditCard, anchor: "A2", agents: [5, 9, 14], layer: "M4",
    routing: "auto", toBoss: false,
    detail: "小王扫码结算。M4 触发跨岗协同：库存 Agent 9 扣减阿托品 -1，财务 Agent 14 记录营收流水。若库存低于安全线，M4 自动向采购 Agent 12 下单（仅留痕）。",
    artifacts: ["结算完成", "阿托品 -1", "营收流水", "取镜回执单"],
  },
  {
    id: 8, time: "12:08", title: "客户离店 · 闭环校验",
    icon: CheckCircle2, anchor: "A1", agents: [5, 15, 18], layer: "M5",
    routing: "boss", toBoss: true,
    detail: "A1 交叉验证：结算已完成 vs 回执单已交付 vs 阿托品已取走。三项一致 → 闭环成功，PatientSession 归档。若任一缺失，M5 强制穿透触达院长。",
    artifacts: ["闭环校验", "PatientSession 归档", "回执单已交付"],
  },
];

const STEP_ICON = {
  scan: ScanLine, photo: Camera, verify: ShieldCheck, alert: AlertTriangle,
  dispatch: Zap, wait: Clock, check: CheckCircle2,
};

export default function V9CaseFlow() {
  const [stepIdx, setStepIdx] = useState(-1); // -1 idle
  const [running, setRunning] = useState(false);
  const [activeLayers, setActiveLayers] = useState(new Set());
  const [activeAgents, setActiveAgents] = useState(new Set());
  const [log, setLog] = useState([]);
  const [bossAlerts, setBossAlerts] = useState([]);
  const timersRef = useRef([]);

  const clearTimers = () => { timersRef.current.forEach(clearTimeout); timersRef.current = []; };
  useEffect(() => () => clearTimers(), []);

  const addLog = (entry) => {
    setLog((prev) => [{ id: Date.now() + Math.random(), time: entry.time || new Date().toLocaleTimeString("zh-CN", { hour12: false }), ...entry }, ...prev].slice(0, 30));
  };

  const reset = useCallback(() => {
    clearTimers();
    setStepIdx(-1); setRunning(false);
    setActiveLayers(new Set()); setActiveAgents(new Set());
    setLog([]); setBossAlerts([]);
  }, []);

  const runStep = useCallback((idx) => {
    const step = CASE_STEPS[idx];
    if (!step) return;
    setStepIdx(idx);

    // activate layer + agents
    setActiveLayers(new Set([step.layer]));
    setActiveAgents(new Set(step.agents));

    const anchor = ANCHORS[step.anchor];
    addLog({
      time: step.time,
      type: "step",
      color: anchor.color,
      text: `[${step.time}] ${step.title}`,
    });
    addLog({
      time: step.time,
      type: "anchor",
      color: anchor.color,
      text: `▸ 锚点 ${step.anchor} · ${anchor.name} 触发`,
    });
    addLog({
      time: step.time,
      type: "layer",
      color: LAYERS.find((l) => l.code === step.layer).color,
      text: `▸ 路由至 ${step.layer} · ${LAYERS.find((l) => l.code === step.layer).name}`,
    });

    step.agents.forEach((aid) => {
      addLog({
        time: step.time,
        type: "agent",
        color: AGENTS[aid] ? (AGENTS[aid].group === "一线" ? C.cyan : AGENTS[aid].group === "后勤" ? C.green : C.amber) : C.sub,
        text: `  ◉ Agent ${String(aid).padStart(2, "0")} · ${AGENTS[aid]?.name || "未知"} 激活`,
      });
    });

    addLog({
      time: step.time,
      type: step.toBoss ? "boss" : "auto",
      color: step.toBoss ? C.red : C.green,
      text: step.toBoss
        ? `  ⚡ 强制穿透触达院长端（M5 宪法层）`
        : `  ✓ 系统自动处理，不打扰院长`,
    });

    if (step.toBoss) {
      setBossAlerts((prev) => [...prev, { id: Date.now(), stepIdx: idx, title: step.title, detail: step.detail, time: step.time }]);
    }
  }, []);

  const start = useCallback(() => {
    clearTimers();
    setLog([]); setBossAlerts([]);
    setRunning(true);
    setStepIdx(-1);
    setActiveLayers(new Set()); setActiveAgents(new Set());

    let delay = 600;
    CASE_STEPS.forEach((_, i) => {
      const t = setTimeout(() => {
        runStep(i);
        if (i === CASE_STEPS.length - 1) setRunning(false);
      }, delay);
      timersRef.current.push(t);
      delay += 2600;
    });
  }, [runStep]);

  const next = useCallback(() => {
    if (stepIdx >= CASE_STEPS.length - 1) return;
    runStep(stepIdx + 1);
  }, [stepIdx, runStep]);

  const prev = useCallback(() => {
    if (stepIdx <= 0) { setStepIdx(-1); setActiveLayers(new Set()); setActiveAgents(new Set()); return; }
    runStep(stepIdx - 1);
  }, [stepIdx, runStep]);

  const currentStep = stepIdx >= 0 ? CASE_STEPS[stepIdx] : null;
  const progress = stepIdx >= 0 ? ((stepIdx + 1) / CASE_STEPS.length) * 100 : 0;

  return (
    <div className="min-h-screen" style={{ background: C.canvas }}>
      {/* Header */}
      <div className="sticky top-0 z-20 px-4 py-3 flex items-center gap-3 border-b" style={{ background: "rgba(13,27,42,0.92)", backdropFilter: "blur(8px)", borderColor: C.border }}>
        <Link to="/" className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "rgba(0,199,217,0.1)", color: C.cyan, border: "1px solid rgba(0,199,217,0.25)" }}>
          <ArrowLeft size={13} /> 返回看板
        </Link>
        <div>
          <div className="text-sm font-bold" style={{ color: C.text }}>Clinic OS V9 · 案例闭环演练</div>
          <div className="text-xs" style={{ color: C.faint }}>张小姐验光配镜流 · M1-M5 五层 + 三大锚点 + 18 Agent 路由</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={start} disabled={running} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40" style={{ background: running ? "rgba(148,163,184,0.1)" : "rgba(22,163,74,0.12)", color: running ? C.sub : "#4ade80", border: `1px solid ${running ? "rgba(148,163,184,0.2)" : "rgba(22,163,74,0.3)"}` }}>
            <Play size={13} /> {running ? "运行中…" : "自动演练"}
          </button>
          <button onClick={next} disabled={stepIdx >= CASE_STEPS.length - 1} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40" style={{ background: "rgba(0,199,217,0.1)", color: C.cyan, border: "1px solid rgba(0,199,217,0.25)" }}>
            <ChevronRight size={13} /> 下一步
          </button>
          <button onClick={reset} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "rgba(220,38,38,0.1)", color: "#f87171", border: "1px solid rgba(220,38,38,0.25)" }}>
            <RotateCcw size={13} /> 重置
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 p-4 md:p-6 max-w-[1280px] mx-auto">
        {/* Left: Case timeline + current step */}
        <div className="w-full lg:w-[300px] flex-shrink-0 flex flex-col gap-4">
          {/* Current step card */}
          <div className="rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${currentStep ? ANCHORS[currentStep.anchor].color + "44" : C.border}` }}>
            <div className="text-xs font-bold mb-2" style={{ color: C.text }}>当前环节</div>
            {currentStep ? (
              <div className="animate-fade-in">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(148,163,184,0.12)", color: C.sub }}>{currentStep.time}</span>
                  <currentStep.icon size={14} style={{ color: ANCHORS[currentStep.anchor].color }} />
                  <span className="text-xs font-bold" style={{ color: C.text }}>{currentStep.title}</span>
                </div>
                <p className="text-xs leading-relaxed mb-3" style={{ color: C.sub, fontSize: "11px" }}>{currentStep.detail}</p>
                <div className="flex flex-wrap gap-1">
                  {currentStep.artifacts.map((a) => (
                    <span key={a} className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(0,199,217,0.1)", color: C.cyan, border: "1px solid rgba(0,199,217,0.25)", fontSize: "9.5px" }}>{a}</span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-xs py-4 text-center" style={{ color: C.faint }}>点击「自动演练」或「下一步」开始</div>
            )}
          </div>

          {/* Timeline */}
          <div className="rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <div className="text-xs font-bold mb-3" style={{ color: C.text }}>案例时间线</div>
            <div className="space-y-1.5">
              {CASE_STEPS.map((s, i) => {
                const done = stepIdx > i;
                const active = stepIdx === i;
                const anchor = ANCHORS[s.anchor];
                const Icon = s.icon;
                return (
                  <button key={s.id} onClick={() => runStep(i)} className="w-full text-left rounded-lg px-2.5 py-2 transition-all" style={{
                    background: active ? `${anchor.color}14` : done ? "rgba(22,163,74,0.05)" : "rgba(148,163,184,0.03)",
                    border: `1px solid ${active ? anchor.color + "44" : done ? "rgba(22,163,74,0.2)" : C.border}`,
                  }}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono" style={{ color: C.faint, fontSize: "9.5px" }}>{s.time}</span>
                      <Icon size={11} style={{ color: active ? anchor.color : done ? "#4ade80" : C.faint }} />
                      <span className="text-xs flex-1 truncate" style={{ color: active ? C.text : done ? C.sub : C.faint, fontSize: "10.5px" }}>{s.title}</span>
                      {s.toBoss && <Crown size={10} style={{ color: C.red }} />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Center: M1-M5 five-layer stack */}
        <div className="flex-1 min-w-0">
          <div className="rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold" style={{ color: C.text }}>M1-M5 五层作战架构</span>
              <span className="text-xs" style={{ color: C.faint, fontSize: "10px" }}>核心 2 层 · 执行 2 层 · 管理 1 层</span>
            </div>

            {/* Layer stack: M5 at top (management), M1 at bottom (core) */}
            <div className="space-y-2">
              {[...LAYERS].reverse().map((layer) => {
                const active = activeLayers.has(layer.code);
                const isCurrent = currentStep?.layer === layer.code;
                return (
                  <div key={layer.code} className="rounded-xl px-4 py-3 transition-all duration-300" style={{
                    background: active ? `${layer.color}14` : "rgba(148,163,184,0.04)",
                    border: `1px solid ${active ? layer.color + "55" : C.border}`,
                    boxShadow: active ? `0 0 20px ${layer.color}22` : "none",
                    transform: active ? "translateX(4px)" : "none",
                  }}>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{
                        background: active ? `${layer.color}22` : "rgba(148,163,184,0.08)",
                        border: `1px solid ${active ? layer.color : C.border}`,
                      }}>
                        {layer.code === "M1" && <Building2 size={16} style={{ color: active ? layer.color : C.faint }} />}
                        {layer.code === "M2" && <Activity size={16} style={{ color: active ? layer.color : C.faint }} />}
                        {layer.code === "M3" && <Brain size={16} style={{ color: active ? layer.color : C.faint }} />}
                        {layer.code === "M4" && <Workflow size={16} style={{ color: active ? layer.color : C.faint }} />}
                        {layer.code === "M5" && <Crown size={16} style={{ color: active ? layer.color : C.faint }} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold" style={{ color: active ? layer.color : C.text }}>{layer.code}</span>
                          <span className="text-xs font-semibold" style={{ color: active ? C.text : C.sub }}>{layer.name}</span>
                          <span className="text-xs px-1.5 py-0.5 rounded" style={{
                            background: layer.tier === "核心" ? "rgba(59,130,246,0.12)" : layer.tier === "执行" ? "rgba(139,92,246,0.12)" : "rgba(220,38,38,0.12)",
                            color: layer.tier === "核心" ? "#60a5fa" : layer.tier === "执行" ? "#a78bfa" : "#f87171",
                            fontSize: "9px", fontWeight: 600,
                          }}>{layer.tier}</span>
                          {isCurrent && <span className="w-1.5 h-1.5 rounded-full" style={{ background: layer.color, animation: "pulseGreen 2s ease-in-out infinite" }} />}
                        </div>
                        <div className="text-xs mt-0.5" style={{ color: active ? C.sub : C.faint, fontSize: "10px" }}>{layer.role}</div>
                        <div className="text-xs mt-0.5" style={{ color: C.faint, fontSize: "9.5px", lineHeight: "1.3" }}>{layer.desc}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Progress */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs" style={{ color: C.faint }}>案例进度</span>
                <span className="text-xs font-mono" style={{ color: C.cyan }}>{Math.round(progress)}%</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(148,163,184,0.12)" }}>
                <div style={{ height: "100%", width: `${progress}%`, background: `linear-gradient(to right, ${C.blue}, ${C.cyan}, ${C.purple}, ${C.amber}, ${C.red})`, transition: "width 0.4s ease" }} />
              </div>
            </div>
          </div>

          {/* Anchor + routing summary */}
          <div className="mt-4 grid grid-cols-3 gap-3">
            {Object.values(ANCHORS).map((a) => {
              const Icon = a.icon;
              const isCurrent = currentStep?.anchor === a.code;
              return (
                <div key={a.code} className="rounded-xl px-3 py-2.5 transition-all" style={{
                  background: isCurrent ? `${a.color}14` : "rgba(148,163,184,0.04)",
                  border: `1px solid ${isCurrent ? a.color + "55" : C.border}`,
                }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Icon size={12} style={{ color: isCurrent ? a.color : C.faint }} />
                    <span className="text-xs font-bold" style={{ color: isCurrent ? a.color : C.sub }}>{a.code}</span>
                  </div>
                  <div className="text-xs" style={{ color: isCurrent ? C.text : C.faint, fontSize: "10px" }}>{a.name}</div>
                </div>
              );
            })}
          </div>

          {/* Active agents */}
          <div className="mt-4 rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <div className="text-xs font-bold mb-3" style={{ color: C.text }}>本环节激活 Agent</div>
            <div className="flex flex-wrap gap-2">
              {currentStep ? (
                currentStep.agents.map((aid) => {
                  const a = AGENTS[aid];
                  if (!a) return null;
                  const col = a.group === "一线" ? C.cyan : a.group === "后勤" ? C.green : C.amber;
                  return (
                    <div key={aid} className="rounded-lg px-2.5 py-1.5 flex items-center gap-1.5 animate-fade-in" style={{ background: `${col}12`, border: `1px solid ${col}33` }}>
                      <span className="text-xs font-bold font-mono" style={{ color: col, fontSize: "10px" }}>{String(aid).padStart(2, "0")}</span>
                      <span className="text-xs" style={{ color: C.text, fontSize: "10px" }}>{a.name}</span>
                    </div>
                  );
                })
              ) : (
                <span className="text-xs" style={{ color: C.faint }}>等待案例启动…</span>
              )}
            </div>
          </div>
        </div>

        {/* Right: Event log + boss alerts */}
        <div className="w-full lg:w-[320px] flex-shrink-0 flex flex-col gap-4">
          {/* Boss alerts (M5) */}
          <div className="rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${bossAlerts.length > 0 ? C.red + "44" : C.border}` }}>
            <div className="flex items-center gap-2 mb-3">
              <Crown size={14} style={{ color: bossAlerts.length > 0 ? C.red : C.faint }} />
              <span className="text-xs font-bold" style={{ color: C.text }}>院长触达 (M5)</span>
              {bossAlerts.length > 0 && <span className="ml-auto text-xs px-1.5 py-0.5 rounded-full" style={{ background: "rgba(220,38,38,0.15)", color: "#f87171", fontSize: "9px", fontWeight: 700 }}>{bossAlerts.length}</span>}
            </div>
            {bossAlerts.length === 0 ? (
              <div className="text-xs py-4 text-center" style={{ color: C.faint }}>系统在 M1-M4 自动消化，不打扰院长</div>
            ) : (
              <div className="space-y-2">
                {bossAlerts.map((b) => (
                  <div key={b.id} className="rounded-lg px-3 py-2 animate-slide-in-right" style={{ background: "rgba(220,38,38,0.1)", border: `1px solid ${C.red}33`, borderLeft: `3px solid ${C.red}` }}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-xs font-mono" style={{ color: C.faint, fontSize: "9px" }}>{b.time}</span>
                      <span className="text-xs font-bold" style={{ color: "#f87171", fontSize: "10px" }}>⚡ 强制触达</span>
                    </div>
                    <div className="text-xs font-semibold mb-1" style={{ color: C.text, fontSize: "11px" }}>{b.title}</div>
                    <div className="text-xs" style={{ color: C.sub, fontSize: "10px", lineHeight: "1.4" }}>{b.detail}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Event log */}
          <div className="rounded-2xl p-4 flex-1" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <div className="flex items-center gap-2 mb-3">
              <Zap size={14} style={{ color: C.cyan }} />
              <span className="text-xs font-bold" style={{ color: C.text }}>执行日志</span>
              <span className="ml-auto w-1.5 h-1.5 rounded-full" style={{ background: C.green, animation: "pulseGreen 3s ease-in-out infinite" }} />
            </div>
            <div className="space-y-1 max-h-[420px] overflow-y-auto">
              {log.length === 0 ? (
                <div className="text-xs py-6 text-center" style={{ color: C.faint }}>等待案例启动…</div>
              ) : log.map((l) => (
                <div key={l.id} className="text-xs flex items-start gap-1.5 animate-fade-in" style={{ fontSize: "10px", lineHeight: "1.45" }}>
                  <span style={{ color: C.faint, flexShrink: 0, fontFamily: "var(--font-mono)" }}>{l.time}</span>
                  <span style={{ color: l.color || C.sub }}>{l.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}