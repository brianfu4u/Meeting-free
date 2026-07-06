import React, { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Layers, Activity, Brain, ClipboardCheck, LayoutDashboard, Boxes } from "lucide-react";

const COLORS = {
  cyan: "#00C7D9",
  green: "#16A34A",
  amber: "#D97706",
  red: "#DC2626",
  text: "#F1F5F9",
  sub: "#94A3B8",
  faint: "#64748B",
  card: "#1E293B",
  cardHover: "#263347",
  border: "#334155",
  canvas: "#0D1B2A",
};

const MODULES = {
  m1: {
    id: "m1", code: "M1", name: "基建与数据标准层", icon: Layers, color: COLORS.cyan,
    role: "核心层", desc: "实体定义 / clinic_id 多店隔离 / 节点链配置",
    skills: ["ClinicDataSkill", "Entity Schema", "Admin Config"],
    x: 80, y: 90, w: 260, h: 130,
  },
  m3: {
    id: "m3", code: "M3", name: "智能神经中枢", icon: Brain, color: COLORS.cyan,
    role: "核心层", desc: "因果链验证 / LLM 巡检 / 分级告警",
    skills: ["CrossVerificationSkill", "LLM Task Draft", "Alert Engine"],
    x: 80, y: 280, w: 260, h: 130,
  },
  m2: {
    id: "m2", code: "M2", name: "态势感知引擎", icon: Activity, color: COLORS.green,
    role: "执行层", desc: "状态机 / 全岗快照 / 心跳检测",
    skills: ["StationScanSkill", "PatientStateMachine", "HeartbeatCheck"],
    x: 460, y: 90, w: 260, h: 130,
  },
  m4: {
    id: "m4", code: "M4", name: "执行与证据闭环", icon: ClipboardCheck, color: COLORS.green,
    role: "执行层", desc: "证据核销 / 三选一决策 / 任务下发",
    skills: ["EvidenceEvalSkill", "ManagerDecision", "DispatchSkill"],
    x: 460, y: 280, w: 260, h: 130,
  },
  m5: {
    id: "m5", code: "M5", name: "店长总控台与培训库", icon: LayoutDashboard, color: COLORS.amber,
    role: "管理层", desc: "实时看板 / 决策画像 / 日报周报",
    skills: ["Dashboard", "DecisionAuditSkill", "ReportEngine"],
    x: 270, y: 480, w: 260, h: 130,
  },
};

// Flow arrows: [from, to, label, color, dashed]
const FLOWS = [
  ["m1", "m2", "实体标准 / 配置", COLORS.cyan, false],
  ["m1", "m3", "数据支撑", COLORS.cyan, false],
  ["m2", "m3", "实时状态 / 断链告警", COLORS.green, false],
  ["m3", "m5", "建议 / 报告", COLORS.amber, false],
  ["m3", "m4", "告警 / 任务草案", COLORS.red, true],
  ["m4", "m5", "决策记录 / 闭环反馈", COLORS.amber, false],
  ["m1", "m5", "数据查询", COLORS.cyan, true],
  ["m2", "m5", "监控数据", COLORS.green, true],
];

function getEdge(a, b) {
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2;
  const by = b.y + b.h / 2;
  // anchor to nearest edge midpoint-ish
  const dx = bx - ax;
  const dy = by - ay;
  let sx = ax, sy = ay, ex = bx, ey = by;
  if (Math.abs(dx) > Math.abs(dy)) {
    sx = dx > 0 ? a.x + a.w : a.x;
    ex = dx > 0 ? b.x : b.x + b.w;
    sy = ay; ey = by;
  } else {
    sy = dy > 0 ? a.y + a.h : a.y;
    ey = dy > 0 ? b.y : b.y + b.h;
    sx = ax; ex = bx;
  }
  return { sx, sy, ex, ey };
}

const REGIONAL_AGENTS = [
  "咨询接待", "验光检查", "眼科诊疗", "配镜交付",
  "收费结算", "库存补给", "设备维护", "人事调度",
];

export default function ArchitectureMap() {
  const [hover, setHover] = useState(null);

  return (
    <div className="min-h-screen" style={{ background: COLORS.canvas }}>
      {/* Header */}
      <div className="sticky top-0 z-20 px-4 py-3 flex items-center gap-3 border-b" style={{ background: "rgba(13,27,42,0.92)", backdropFilter: "blur(8px)", borderColor: COLORS.border }}>
        <Link to="/" className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "rgba(0,199,217,0.1)", color: COLORS.cyan, border: "1px solid rgba(0,199,217,0.25)" }}>
          <ArrowLeft size={13} /> 返回看板
        </Link>
        <div>
          <div className="text-sm font-bold" style={{ color: COLORS.text }}>Clinic OS V8 · 开发逻辑总图</div>
          <div className="text-xs" style={{ color: COLORS.faint }}>五大模块 · 因果链驱动 · 区域 Agent 协同</div>
        </div>
        <div className="ml-auto flex items-center gap-3 text-xs" style={{ color: COLORS.sub }}>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: COLORS.cyan }} />核心层</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: COLORS.green }} />执行层</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: COLORS.amber }} />管理层</span>
        </div>
      </div>

      <div className="p-4 md:p-6 max-w-[1100px] mx-auto">
        {/* SVG Diagram */}
        <div className="rounded-2xl p-3 md:p-5" style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}>
          <svg viewBox="0 0 820 650" className="w-full h-auto" style={{ display: "block" }}>
            <defs>
              <marker id="arrow-solid" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L8,3 L0,6 Z" fill={COLORS.sub} />
              </marker>
              <marker id="arrow-red" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L8,3 L0,6 Z" fill={COLORS.red} />
              </marker>
              <marker id="arrow-amber" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L8,3 L0,6 Z" fill={COLORS.amber} />
              </marker>
              <marker id="arrow-cyan" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L8,3 L0,6 Z" fill={COLORS.cyan} />
              </marker>
              <marker id="arrow-green" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L8,3 L0,6 Z" fill={COLORS.green} />
              </marker>
            </defs>

            {/* Layer bands */}
            <rect x="40" y="60" width="740" height="190" rx="14" fill="rgba(0,199,217,0.04)" stroke="rgba(0,199,217,0.15)" strokeDasharray="4 4" />
            <text x="54" y="54" fill={COLORS.cyan} fontSize="11" fontWeight="700" letterSpacing="2">核心层 · CORE</text>
            <rect x="40" y="250" width="740" height="190" rx="14" fill="rgba(22,163,74,0.04)" stroke="rgba(22,163,74,0.15)" strokeDasharray="4 4" />
            <text x="54" y="244" fill={COLORS.green} fontSize="11" fontWeight="700" letterSpacing="2">执行层 · EXECUTION</text>

            {/* Flow arrows (drawn before cards so cards overlay endpoints nicely) */}
            {FLOWS.map(([fromKey, toKey, label, color, dashed], i) => {
              const a = MODULES[fromKey];
              const b = MODULES[toKey];
              const { sx, sy, ex, ey } = getEdge(a, b);
              const mx = (sx + ex) / 2;
              const my = (sy + ey) / 2;
              const markerId = color === COLORS.red ? "arrow-red" : color === COLORS.amber ? "arrow-amber" : color === COLORS.cyan ? "arrow-cyan" : "arrow-green";
              return (
                <g key={i}>
                  <path
                    d={`M${sx},${sy} L${ex},${ey}`}
                    fill="none"
                    stroke={color}
                    strokeWidth={dashed ? 1.6 : 2}
                    strokeDasharray={dashed ? "5 4" : "none"}
                    markerEnd={`url(#${markerId})`}
                    opacity={hover && hover !== fromKey && hover !== toKey ? 0.25 : 0.85}
                  />
                  <rect x={mx - label.length * 3.2 - 6} y={my - 9} width={label.length * 6.4 + 12} height={16} rx={8} fill={COLORS.canvas} stroke={color} strokeWidth="0.6" opacity="0.95" />
                  <text x={mx} y={my + 3} textAnchor="middle" fill={color} fontSize="9.5" fontWeight="600">{label}</text>
                </g>
              );
            })}

            {/* Module cards */}
            {Object.values(MODULES).map((m) => {
              const Icon = m.icon;
              const isHover = hover === m.id;
              return (
                <g
                  key={m.id}
                  onMouseEnter={() => setHover(m.id)}
                  onMouseLeave={() => setHover(null)}
                  style={{ cursor: "pointer" }}
                >
                  <rect
                    x={m.x} y={m.y} width={m.w} height={m.h} rx={12}
                    fill={isHover ? COLORS.cardHover : COLORS.card}
                    stroke={m.color}
                    strokeWidth={isHover ? 2 : 1.4}
                    opacity={hover && !isHover ? 0.55 : 1}
                    style={{ transition: "all 0.2s" }}
                  />
                  <rect x={m.x} y={m.y} width={4} height={m.h} rx={2} fill={m.color} />
                  <foreignObject x={m.x + 14} y={m.y + 12} width={m.w - 28} height={m.h - 24}>
                    <div xmlns="http://www.w3.org/1999/xhtml" style={{ fontFamily: "'Noto Sans SC', sans-serif" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                        <div style={{ width: "26px", height: "26px", borderRadius: "7px", background: `${m.color}22`, border: `1px solid ${m.color}55`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <span style={{ color: m.color, fontSize: "13px", fontWeight: 700 }}>{m.code}</span>
                        </div>
                        <div style={{ color: m.color, fontSize: "9px", fontWeight: 700, letterSpacing: "1px" }}>{m.role.toUpperCase()}</div>
                      </div>
                      <div style={{ color: COLORS.text, fontSize: "13px", fontWeight: 700, lineHeight: "1.25", marginBottom: "4px" }}>{m.name}</div>
                      <div style={{ color: COLORS.sub, fontSize: "10px", lineHeight: "1.4", marginBottom: "6px" }}>{m.desc}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                        {m.skills.map((s) => (
                          <span key={s} style={{ fontSize: "8.5px", padding: "1px 5px", borderRadius: "4px", background: "rgba(148,163,184,0.12)", color: COLORS.sub, border: "1px solid rgba(148,163,184,0.2)" }}>{s}</span>
                        ))}
                      </div>
                    </div>
                  </foreignObject>
                </g>
              );
            })}

            {/* Reality source node */}
            <g>
              <rect x="760" y="95" width="50" height="120" rx="10" fill="rgba(148,163,184,0.06)" stroke="rgba(148,163,184,0.25)" strokeDasharray="3 3" />
              <text x="785" y="118" textAnchor="middle" fill={COLORS.sub} fontSize="9" fontWeight="700">现实</text>
              <text x="785" y="132" textAnchor="middle" fill={COLORS.faint} fontSize="8">扫码/动作</text>
              <line x1="760" y1="155" x2="720" y2="155" stroke={COLORS.green} strokeWidth="2" markerEnd="url(#arrow-green)" />
              <line x1="760" y1="180" x2="720" y2="345" stroke={COLORS.green} strokeWidth="1.4" strokeDasharray="5 4" markerEnd="url(#arrow-green)" />
              <text x="740" y="150" textAnchor="middle" fill={COLORS.green} fontSize="8.5">事件流</text>
            </g>
          </svg>
        </div>

        {/* Regional Agents strip */}
        <div className="mt-5 rounded-2xl p-4" style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}>
          <div className="flex items-center gap-2 mb-3">
            <Boxes size={15} style={{ color: COLORS.cyan }} />
            <span className="text-xs font-bold tracking-widest" style={{ color: COLORS.cyan, letterSpacing: "0.1em" }}>区域 AGENT · 18 个职能区域（标准接口克隆）</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {REGIONAL_AGENTS.map((name, i) => (
              <div key={name} className="rounded-lg px-3 py-2 flex items-center gap-2" style={{ background: "rgba(0,199,217,0.05)", border: "1px solid rgba(0,199,217,0.18)" }}>
                <span className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold" style={{ background: "rgba(0,199,217,0.15)", color: COLORS.cyan }}>{String(i + 1).padStart(2, "0")}</span>
                <span className="text-xs" style={{ color: COLORS.text }}>{name}</span>
              </div>
            ))}
            <div className="rounded-lg px-3 py-2 flex items-center justify-center" style={{ background: "rgba(148,163,184,0.06)", border: "1px dashed rgba(148,163,184,0.25)" }}>
              <span className="text-xs" style={{ color: COLORS.faint }}>+ 10 个待克隆</span>
            </div>
          </div>
          <div className="mt-3 text-xs leading-relaxed" style={{ color: COLORS.sub }}>
            每个区域 Agent 复用 M1 实体标准、通过 M2 订阅状态、经 M3 分析、由 M4 执行核销，最终汇聚到 M5 总控台。
          </div>
        </div>

        {/* Dev priority legend */}
        <div className="mt-5 rounded-2xl p-4" style={{ background: COLORS.card, border: `1px solid ${COLORS.border}` }}>
          <div className="text-xs font-bold mb-3" style={{ color: COLORS.text }}>开发优先级与验收要点</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              { phase: "第一波", color: COLORS.green, items: ["M1 实体定义完成", "M2 态势感知跑通", "M4 证据闭环最小循环"] },
              { phase: "第二波", color: COLORS.cyan, items: ["M3 LLM 巡检集成", "因果链验证引擎", "分级告警触发"] },
              { phase: "第三波", color: COLORS.amber, items: ["M5 总控大屏", "决策画像沉淀", "18 区域克隆铺开"] },
            ].map((p) => (
              <div key={p.phase} className="rounded-lg p-3" style={{ background: "rgba(148,163,184,0.04)", border: `1px solid ${p.color}33` }}>
                <div className="text-xs font-bold mb-2" style={{ color: p.color }}>{p.phase}</div>
                {p.items.map((it) => (
                  <div key={it} className="text-xs flex items-start gap-1.5 mb-1" style={{ color: COLORS.sub }}>
                    <span style={{ color: p.color }}>•</span> {it}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}