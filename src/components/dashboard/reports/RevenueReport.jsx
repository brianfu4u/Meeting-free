/**
 * 经营报告 · 钱 — 营收品类
 * 总收款 / 业务线收入 / 支付方式分布 / 每日趋势
 * 数据来源：RevenueRecord（结构化）+ 收银小票事实卡（EvidenceFactCard.workflow_family_hint=payment）
 */

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useTheme } from "@/lib/ThemeContext";
import { inRangeISO, inRangeDate } from "@/lib/reportRange";
import { TrendingUp, Wallet, CreditCard, BarChart3 } from "lucide-react";

const CLINIC_ID = "clinic-001";
const LINE_LABEL = { optometry: "验光配镜", medical: "眼科医疗", vision_training: "视觉训练" };
const PAY_LABEL = { cash: "现金", card: "刷卡", wechat: "微信", alipay: "支付宝", insurance: "医保" };
const PAY_COLOR = { cash: "#94A3B8", card: "#00C7D9", wechat: "#4ade80", alipay: "#3B82F6", insurance: "#FBBF24" };

const fmtYuan = (n) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Metric({ icon: Icon, value, label, color, theme }) {
  return (
    <div className="rounded-xl p-3" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon size={13} style={{ color }} />
        <span className="text-[10px]" style={{ color: theme.textMuted }}>{label}</span>
      </div>
      <div className="text-lg font-bold tabular-nums" style={{ color }}>{value}</div>
    </div>
  );
}

export default function RevenueReport({ range }) {
  const { theme } = useTheme();
  const revQ = useQuery({
    queryKey: ["reportRevenue", CLINIC_ID, range.start, range.end],
    queryFn: () => base44.entities.RevenueRecord.filter({ clinic_id: CLINIC_ID }, "-recorded_at", 500),
    refetchInterval: 30000,
  });
  const payQ = useQuery({
    queryKey: ["reportPayCards", CLINIC_ID, range.start, range.end],
    queryFn: () => base44.entities.EvidenceFactCard.filter({ clinic_id: CLINIC_ID, workflow_family_hint: "payment" }, "-extracted_at", 500),
    refetchInterval: 30000,
  });

  const revs = (revQ.data || []).filter((r) => inRangeISO(r.recorded_at, range));
  const payCards = (payQ.data || []).filter((c) => inRangeDate(c.business_date, range));

  // 总收款：优先 RevenueRecord.amount 求和；其次从小票事实卡 amount 字段求和
  const fromRecords = revs.reduce((s, r) => s + (r.amount || 0), 0);
  const fromCards = payCards.reduce((s, c) => {
    const v = (c.fields || []).find((f) => f.field_name === "amount")?.value;
    return s + (v ? parseFloat(v) || 0 : 0);
  }, 0);
  const total = fromRecords || fromCards;
  const txCount = revs.length || payCards.length;

  // 业务线收入
  const lineRev = { optometry: 0, medical: 0, vision_training: 0 };
  for (const r of revs) if (lineRev[r.business_line] !== undefined) lineRev[r.business_line] += r.amount || 0;
  const lineTotal = Object.values(lineRev).reduce((a, b) => a + b, 0) || 1;

  // 支付方式分布
  const payCount = {};
  for (const r of revs) payCount[r.payment_method] = (payCount[r.payment_method] || 0) + 1;

  // 每日趋势（RevenueRecord）
  const byDay = {};
  for (const r of revs) {
    const d = new Date(r.recorded_at);
    if (Number.isNaN(d.getTime())) continue;
    const k = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    byDay[k] = (byDay[k] || 0) + (r.amount || 0);
  }
  const dayEntries = Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0])).slice(-14);
  const maxDay = Math.max(1, ...dayEntries.map((e) => e[1]));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2.5">
        <Metric icon={Wallet} value={fmtYuan(total)} label="总收款" color="#FBBF24" theme={theme} />
        <Metric icon={CreditCard} value={txCount} label="交易笔数" color="#00C7D9" theme={theme} />
      </div>

      {/* 业务线收入 */}
      <div className="rounded-xl p-3" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
        <div className="text-xs font-bold mb-2" style={{ color: theme.text }}>业务线收入</div>
        {lineTotal === 0 && revs.length === 0 ? (
          <div className="py-4 text-center text-xs" style={{ color: theme.textFaint }}>范围内无结构化收入记录，改用小票事实卡 {payCards.length} 张</div>
        ) : (
          <div className="space-y-1.5">
            {Object.keys(lineRev).map((k) => {
              const v = lineRev[k];
              const pct = Math.round((v / lineTotal) * 100);
              return (
                <div key={k} className="flex items-center gap-2">
                  <span className="text-[10px] w-16" style={{ color: theme.textMuted }}>{LINE_LABEL[k]}</span>
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "#FBBF24" }} />
                  </div>
                  <span className="text-[10px] tabular-nums w-20 text-right" style={{ color: theme.text }}>{fmtYuan(v)} · {pct}%</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 支付方式 */}
      {Object.keys(payCount).length > 0 && (
        <div className="rounded-xl p-3" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
          <div className="text-xs font-bold mb-2" style={{ color: theme.text }}>支付方式分布</div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(payCount).map(([k, v]) => (
              <span key={k} className="text-[10px] px-2 py-1 rounded-lg" style={{ background: `${PAY_COLOR[k]}1a`, color: PAY_COLOR[k], border: `1px solid ${PAY_COLOR[k]}33` }}>
                {PAY_LABEL[k] || k} · {v}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 每日趋势 */}
      {dayEntries.length > 0 && (
        <div className="rounded-xl p-3" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 size={13} style={{ color: "#00C7D9" }} />
            <span className="text-xs font-bold" style={{ color: theme.text }}>每日收款趋势</span>
          </div>
          <div className="flex items-end gap-1 h-24">
            {dayEntries.map(([d, v]) => (
              <div key={d} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                <div className="w-full rounded-t" style={{ height: `${(v / maxDay) * 100}%`, background: "linear-gradient(180deg,#FBBF24,#f59e0b)", minHeight: "2px" }} />
                <span className="text-[8.5px] tabular-nums truncate w-full text-center" style={{ color: theme.textFaint }}>{d.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}