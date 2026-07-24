import React, { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft, ClipboardCheck, AlertTriangle, CheckCircle2, Clock,
  TrendingUp, Activity, GitBranch, FileText,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";

const C = {
  cyan: "#00C7D9", green: "#16A34A", amber: "#D97706", red: "#DC2626", purple: "#8B5CF6",
  text: "#F1F5F9", sub: "#94A3B8", faint: "#64748B",
  card: "#1E293B", border: "#334155", canvas: "#0D1B2A", hover: "#263347",
};

// Mock daily abnormal events + manager handling records (simulating a full day)
const DAILY_EVENTS = [
  { id: "E001", time: "08:42", zone: "examination", zoneName: "验光检查", group: "一线", chain: "标准就诊流", severity: "amber", desc: "检查区3号位拥堵指数升至78，超时等待2人", action: "调度视光师X前往支援", resolvedAt: "08:51", status: "closed", responseMins: 9 },
  { id: "E002", time: "09:15", zone: "reception", zoneName: "咨询接待", group: "一线", chain: "标准就诊流", severity: "amber", desc: "前台排队达8人，新到诊患者等待超10分钟", action: "开放2号接待位分流", resolvedAt: "09:23", status: "closed", responseMins: 8 },
  { id: "E003", time: "09:48", zone: "inventory", zoneName: "库存补给", group: "后勤", chain: "后勤保障流", severity: "red", desc: "高折射镜片库存跌破安全线，仅剩3片", action: "紧急下单补货并锁定预留", resolvedAt: "10:05", status: "closed", responseMins: 17 },
  { id: "E004", time: "10:22", zone: "equipment", zoneName: "设备维护", group: "后勤", chain: "后勤保障流", severity: "amber", desc: "眼底照相机3号自检报错，镜头校准偏移", action: "通知设备工程师上门校准", resolvedAt: "11:10", status: "closed", responseMins: 48 },
  { id: "E005", time: "10:55", zone: "billing", zoneName: "收费结算", group: "一线", chain: "标准就诊流", severity: "amber", desc: "医保接口响应超时，3笔结算挂起", action: "切换备用结算通道并报修", resolvedAt: "11:12", status: "closed", responseMins: 17 },
  { id: "E006", time: "11:30", zone: "marketing", zoneName: "营销获客", group: "管理", chain: "获客转化流", severity: "amber", desc: "上午获客成本环比上升22%，转化率下降", action: "暂停低效渠道投放", resolvedAt: "12:00", status: "closed", responseMins: 30 },
  { id: "E007", time: "12:08", zone: "examination", zoneName: "验光检查", group: "一线", chain: "标准就诊流", severity: "red", desc: "视光师Y突感不适离岗，2号位停摆", action: "抽调档案岗持证人员顶岗", resolvedAt: "12:20", status: "closed", responseMins: 12 },
  { id: "E008", time: "12:35", zone: "fitting", zoneName: "配镜交付", group: "一线", chain: "标准就诊流", severity: "amber", desc: "加急订单交付延迟，3名患者滞留", action: "启用快加工通道并补偿代金券", resolvedAt: "12:52", status: "closed", responseMins: 17 },
  { id: "E009", time: "12:48", zone: "compliance", zoneName: "合规质控", group: "管理", chain: "合规质控流", severity: "red", desc: "抽查发现2份病历签名缺失，质控不达标", action: "补签并启动病历整改流程", resolvedAt: null, status: "pending", responseMins: null },
  { id: "E010", time: "12:55", zone: "followup", zoneName: "术后随访", group: "一线", chain: "标准就诊流", severity: "amber", desc: "当日随访完成率仅68%，低于85%红线", action: "延长随访班次至14:00", resolvedAt: null, status: "pending", responseMins: null },
];

const DECISION_LOG = [
  { time: "08:51", action: "确认调度", target: "视光师X → 检查区3号位", outcome: "拥堵指数回落至54", chain: "标准就诊流" },
  { time: "09:23", action: "分流指令", target: "开放2号接待位", outcome: "排队降至3人", chain: "标准就诊流" },
  { time: "10:05", action: "紧急采购", target: "高折射镜片补货", outcome: "库存恢复安全线", chain: "后勤保障流" },
  { time: "11:12", action: "通道切换", target: "收费备用通道", outcome: "3笔挂起结算完成", chain: "标准就诊流" },
  { time: "12:00", action: "渠道调整", target: "暂停低效投放", outcome: "获客成本停止上行", chain: "获客转化流" },
  { time: "12:20", action: "人员顶岗", target: "档案岗 → 2号位", outcome: "检查位恢复运转", chain: "标准就诊流" },
  { time: "12:52", action: "加急加工", target: "快加工通道", outcome: "3名患者完成交付", chain: "标准就诊流" },
];

const SEVERITY_CFG = {
  red: { label: "紧急", color: C.red, bg: "rgba(220,38,38,0.12)", border: "rgba(220,38,38,0.3)" },
  amber: { label: "注意", color: C.amber, bg: "rgba(217,119,6,0.12)", border: "rgba(217,119,6,0.3)" },
};
const STATUS_CFG = {
  closed: { label: "已闭环", color: C.green, icon: CheckCircle2 },
  pending: { label: "待处理", color: C.red, icon: Clock },
};

export default function DailyReview() {
  const [groupFilter, setGroupFilter] = useState("all");
  const [generated, setGenerated] = useState(false);

  const stats = useMemo(() => {
    const total = DAILY_EVENTS.length;
    const closed = DAILY_EVENTS.filter((e) => e.status === "closed").length;
    const pending = total - closed;
    const redCount = DAILY_EVENTS.filter((e) => e.severity === "red").length;
    const avgResp = Math.round(
      DAILY_EVENTS.filter((e) => e.responseMins).reduce((s, e) => s + e.responseMins, 0) /
      DAILY_EVENTS.filter((e) => e.responseMins).length
    );
    const closureRate = Math.round((closed / total) * 100);
    return { total, closed, pending, redCount, avgResp, closureRate };
  }, []);

  const groupStats = useMemo(() => {
    const groups = ["一线", "后勤", "管理"];
    return groups.map((g) => {
      const items = DAILY_EVENTS.filter((e) => e.group === g);
      const closed = items.filter((e) => e.status === "closed").length;
      return { group: g, total: items.length, closed, pending: items.length - closed };
    });
  }, []);

  const chainStats = useMemo(() => {
    const map = {};
    DAILY_EVENTS.forEach((e) => {
      if (!map[e.chain]) map[e.chain] = { chain: e.chain, total: 0, closed: 0 };
      map[e.chain].total++;
      if (e.status === "closed") map[e.chain].closed++;
    });
    return Object.values(map);
  }, []);

  const filteredEvents = groupFilter === "all" ? DAILY_EVENTS : DAILY_EVENTS.filter((e) => e.group === groupFilter);

  const metricCards = [
    { label: "异常事件总数", value: stats.total, unit: "起", icon: AlertTriangle, color: C.amber },
    { label: "已闭环", value: stats.closed, unit: "起", icon: CheckCircle2, color: C.green },
    { label: "待处理", value: stats.pending, unit: "起", icon: Clock, color: C.red },
    { label: "闭环率", value: stats.closureRate, unit: "%", icon: TrendingUp, color: C.cyan },
    { label: "平均响应", value: stats.avgResp, unit: "分钟", icon: Activity, color: C.purple },
  ];

  return (
    <div className="min-h-screen" style={{ background: C.canvas }}>
      {/* Header */}
      <div className="sticky top-0 z-20 px-4 py-3 flex items-center gap-3 border-b" style={{ background: "rgba(13,27,42,0.92)", backdropFilter: "blur(8px)", borderColor: C.border }}>
        <Link to="/" className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "rgba(0,199,217,0.1)", color: C.cyan, border: "1px solid rgba(0,199,217,0.25)" }}>
          <ArrowLeft size={13} /> 返回看板
        </Link>
        <div className="flex items-center gap-2">
          <ClipboardCheck size={16} style={{ color: C.cyan }} />
          <div>
            <div className="text-sm font-bold" style={{ color: C.text }}>每日经营复盘</div>
            <div className="text-xs" style={{ color: C.faint }}>2026年7月6日 · 上午班 08:00–13:00 · 闭环效果总览</div>
          </div>
        </div>
        <button
          onClick={() => setGenerated(true)}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95"
          style={{ background: generated ? "rgba(22,163,74,0.12)" : "rgba(0,199,217,0.12)", color: generated ? "#4ade80" : C.cyan, border: `1px solid ${generated ? "rgba(22,163,74,0.3)" : "rgba(0,199,217,0.25)"}` }}
        >
          <FileText size={13} /> {generated ? "复盘报告已生成" : "生成当日复盘报告"}
        </button>
      </div>

      <div className="max-w-[1200px] mx-auto p-4 md:p-6 space-y-5">
        {/* Metric cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {metricCards.map((m) => {
            const Icon = m.icon;
            return (
              <div key={m.label} className="rounded-xl p-3.5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs" style={{ color: C.faint, fontSize: "10px" }}>{m.label}</span>
                  <Icon size={13} style={{ color: m.color }} />
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold" style={{ color: m.color, lineHeight: 1 }}>{m.value}</span>
                  <span className="text-xs" style={{ color: C.sub }}>{m.unit}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Group closure chart */}
          <div className="rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-3.5 rounded-full" style={{ background: C.cyan }} />
              <span className="text-xs font-bold" style={{ color: C.text }}>各职能组闭环情况</span>
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={groupStats} barGap={2}>
                <XAxis dataKey="group" tick={{ fill: C.sub, fontSize: 10 }} axisLine={{ stroke: C.border }} tickLine={false} />
                <YAxis tick={{ fill: C.faint, fontSize: 9 }} axisLine={false} tickLine={false} width={20} />
                <Tooltip cursor={{ fill: "rgba(148,163,184,0.06)" }} contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11 }} />
                <Bar dataKey="closed" name="已闭环" stackId="a" fill={C.green} radius={[0, 0, 0, 0]} />
                <Bar dataKey="pending" name="待处理" stackId="a" fill={C.red} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="flex items-center gap-3 mt-2 text-xs" style={{ fontSize: "10px" }}>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: C.green }} /><span style={{ color: C.sub }}>已闭环</span></span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: C.red }} /><span style={{ color: C.sub }}>待处理</span></span>
            </div>
          </div>

          {/* Chain closure */}
          <div className="rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <div className="flex items-center gap-2 mb-3">
              <GitBranch size={13} style={{ color: C.purple }} />
              <span className="text-xs font-bold" style={{ color: C.text }}>因果链闭环率</span>
            </div>
            <div className="space-y-2.5">
              {chainStats.map((c) => {
                const rate = Math.round((c.closed / c.total) * 100);
                return (
                  <div key={c.chain}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs" style={{ color: C.sub, fontSize: "10.5px" }}>{c.chain}</span>
                      <span className="text-xs font-semibold" style={{ color: rate === 100 ? "#4ade80" : rate >= 80 ? C.cyan : C.amber, fontSize: "10px" }}>{c.closed}/{c.total} · {rate}%</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(148,163,184,0.1)" }}>
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${rate}%`, background: rate === 100 ? C.green : rate >= 80 ? C.cyan : C.amber }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Manager decision log */}
          <div className="rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <div className="flex items-center gap-2 mb-3">
              <ClipboardCheck size={13} style={{ color: C.amber }} />
              <span className="text-xs font-bold" style={{ color: C.text }}>店长处置记录</span>
              <span className="ml-auto text-xs" style={{ color: C.faint, fontSize: "9px" }}>{DECISION_LOG.length} 条</span>
            </div>
            <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
              {DECISION_LOG.map((d, i) => (
                <div key={i} className="flex items-start gap-2 pb-2 border-b" style={{ borderColor: "rgba(51,65,85,0.4)", fontSize: "10.5px" }}>
                  <span style={{ color: C.faint, flexShrink: 0, fontSize: "9.5px" }}>{d.time}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="px-1.5 py-0.5 rounded font-semibold" style={{ background: "rgba(0,199,217,0.12)", color: C.cyan, fontSize: "9px" }}>{d.action}</span>
                    </div>
                    <div className="mt-0.5" style={{ color: C.text }}>{d.target}</div>
                    <div className="mt-0.5" style={{ color: C.green, fontSize: "9.5px" }}>→ {d.outcome}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Abnormal events table */}
        <div className="rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={14} style={{ color: C.amber }} />
            <span className="text-xs font-bold" style={{ color: C.text }}>异常事件明细 · 因果链溯源</span>
            <div className="ml-auto flex items-center gap-1">
              {["all", "一线", "后勤", "管理"].map((g) => (
                <button key={g} onClick={() => setGroupFilter(g)}
                  className="px-2 py-1 rounded text-xs font-semibold transition-all"
                  style={{
                    background: groupFilter === g ? "rgba(0,199,217,0.12)" : "transparent",
                    color: groupFilter === g ? C.cyan : C.sub,
                    border: `1px solid ${groupFilter === g ? "rgba(0,199,217,0.3)" : C.border}`,
                    fontSize: "10px",
                  }}>
                  {g === "all" ? "全部" : g}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  {["时间", "区域", "因果链", "级别", "事件描述", "店长处置", "响应", "状态"].map((h) => (
                    <th key={h} className="text-left px-2 py-2 text-xs font-semibold" style={{ color: C.faint, fontSize: "10px", letterSpacing: "0.03em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredEvents.map((e) => {
                  const sev = SEVERITY_CFG[e.severity];
                  const st = STATUS_CFG[e.status];
                  const StIcon = st.icon;
                  return (
                    <tr key={e.id} style={{ borderBottom: `1px solid rgba(51,65,85,0.4)` }}>
                      <td className="px-2 py-2.5 text-xs" style={{ color: C.sub, fontSize: "10px", fontFamily: "var(--font-mono)" }}>{e.time}</td>
                      <td className="px-2 py-2.5 text-xs" style={{ color: C.text, fontSize: "10.5px" }}>{e.zoneName}</td>
                      <td className="px-2 py-2.5">
                        <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(139,92,246,0.12)", color: "#A78BFA", border: "1px solid rgba(139,92,246,0.25)", fontSize: "9px" }}>{e.chain}</span>
                      </td>
                      <td className="px-2 py-2.5">
                        <span className="text-xs px-1.5 py-0.5 rounded font-semibold" style={{ background: sev.bg, color: sev.color, border: `1px solid ${sev.border}`, fontSize: "9px" }}>{sev.label}</span>
                      </td>
                      <td className="px-2 py-2.5 text-xs max-w-[220px]" style={{ color: C.sub, fontSize: "10px" }}>{e.desc}</td>
                      <td className="px-2 py-2.5 text-xs" style={{ color: C.text, fontSize: "10px" }}>{e.action}</td>
                      <td className="px-2 py-2.5 text-xs" style={{ color: e.responseMins > 30 ? C.amber : C.sub, fontSize: "10px" }}>{e.responseMins ? `${e.responseMins}分` : "—"}</td>
                      <td className="px-2 py-2.5">
                        <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: st.color, fontSize: "10px" }}>
                          <StIcon size={11} /> {st.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* AI review summary */}
        {generated && (
          <div className="rounded-2xl p-5 animate-slide-in-top" style={{ background: "linear-gradient(135deg, rgba(0,199,217,0.08), rgba(139,92,246,0.06))", border: `1px solid rgba(0,199,217,0.25)` }}>
            <div className="flex items-center gap-2 mb-3">
              <FileText size={15} style={{ color: C.cyan }} />
              <span className="text-sm font-bold" style={{ color: C.text }}>AI 经营复盘报告 · 2026-07-06</span>
              <span className="ml-auto text-xs" style={{ color: C.faint, fontSize: "10px" }}>基于因果链交叉验证</span>
            </div>
            <div className="space-y-3 text-xs" style={{ color: C.sub, fontSize: "11px", lineHeight: 1.7 }}>
              <p>
                <span style={{ color: C.cyan, fontWeight: 600 }}>▸ 整体闭环效果：</span>
                今日共触发异常事件 {stats.total} 起（其中紧急 {stats.redCount} 起），已闭环 {stats.closed} 起，闭环率 {stats.closureRate}%，平均响应时长 {stats.avgResp} 分钟。整体运营韧性达标，但仍有 {stats.pending} 起待处理事项需在下午班跟进。
              </p>
              <p>
                <span style={{ color: C.green, fontWeight: 600 }}>▸ 闭环表现优秀：</span>
                标准就诊流闭环率最高，店长在验光检查拥堵、人员离岗等突发事件中响应迅速（9–12分钟内完成调度），因果链校验通过率 100%，未发生患者流失。
              </p>
              <p>
                <span style={{ color: C.amber, fontWeight: 600 }}>▸ 需重点关注：</span>
                合规质控流存在签名缺失问题尚未闭环，建议下午班启动病历整改专项；术后随访完成率低于红线，需评估随访人力配置。后勤保障流平均响应偏长（设备校准48分钟），建议建立设备故障分级响应机制。
              </p>
              <p>
                <span style={{ color: C.purple, fontWeight: 600 }}>▸ 明日建议：</span>
                ① 预排验光师机动岗应对高峰拥堵；② 高折射镜片建立安全库存预警阈值；③ 病历签名质控纳入晨会必检项；④ 随访人力扩编或启用 AI 外呼辅助。
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}