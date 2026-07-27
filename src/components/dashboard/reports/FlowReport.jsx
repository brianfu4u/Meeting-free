/**
 * 经营报告 · 流 — 患者流转
 * 来院总人次 / 业务线分布 / 新客·老客·复诊·转介绍 四象限
 * 新老客标签来自挂号单事实卡（EvidenceFactCard.workflow_family_hint=patient_registration）字段级抽取。
 */

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useTheme } from "@/lib/ThemeContext";
import { inRangeDate, inRangeISO } from "@/lib/reportRange";
import { Activity, UserPlus, RefreshCw, Share2 } from "lucide-react";

const CLINIC_ID = "clinic-001";
const LINE_LABEL = { optometry: "验光配镜", medical: "眼科医疗", vision_training: "视觉训练" };
const LINE_COLOR = { optometry: "#00C7D9", medical: "#4ade80", vision_training: "#A78BFA" };

// 患者类型关键词识别（从字段名+值推断）
function classifyPatient(card) {
  const fields = card.fields || [];
  const hit = (re) => fields.find((f) => re.test(f.field_name) || re.test(String(f.value || "")));
  const typeField = fields.find((f) => /type|visit|customer|new_old|老客|新客|复诊|初诊|转介|source/i.test(f.field_name));
  const raw = String(typeField?.value || "").toLowerCase();
  if (/referral|转介|介绍|推荐|friend/.test(raw) || hit(/referral|转介|介绍|推荐/)) return "referral";
  if (/repeat|复诊|复查|return|老客|复访/.test(raw) || hit(/repeat|复诊|复查/)) return "repeat";
  if (/new|新客|初诊|首次|first/.test(raw) || hit(/new|新客|初诊/)) return "new";
  if (/old|老客|会员|member|vip/.test(raw) || hit(/old|老客|会员/)) return "old";
  return "unknown";
}

const PTYPES = [
  { key: "new", label: "新增", color: "#00C7D9", icon: UserPlus },
  { key: "old", label: "老客", color: "#4ade80", icon: Activity },
  { key: "repeat", label: "复诊", color: "#FBBF24", icon: RefreshCw },
  { key: "referral", label: "转介绍", color: "#A78BFA", icon: Share2 },
];

export default function FlowReport({ range }) {
  const { theme } = useTheme();
  const regQ = useQuery({
    queryKey: ["reportRegCards", CLINIC_ID, range.start, range.end],
    queryFn: () => base44.entities.EvidenceFactCard.filter({ clinic_id: CLINIC_ID, workflow_family_hint: "patient_registration" }, "-extracted_at", 500),
    refetchInterval: 30000,
  });
  const sessQ = useQuery({
    queryKey: ["reportSessions", CLINIC_ID, range.start, range.end],
    queryFn: () => base44.entities.PatientSession.filter({ clinic_id: CLINIC_ID }, "-arrival_time", 500),
    refetchInterval: 30000,
  });

  const regCards = (regQ.data || []).filter((c) => inRangeDate(c.business_date, range));
  const sessions = (sessQ.data || []).filter((s) => inRangeISO(s.arrival_time || s.created_date, range));

  const totalVisitors = regCards.length || sessions.length;

  // 业务线分布（优先 PatientSession.business_line）
  const lineCount = { optometry: 0, medical: 0, vision_training: 0 };
  for (const s of sessions) if (lineCount[s.business_line] !== undefined) lineCount[s.business_line] += 1;
  const lineTotal = Object.values(lineCount).reduce((a, b) => a + b, 0) || 1;

  // 患者类型四象限
  const ptypeCount = { new: 0, old: 0, repeat: 0, referral: 0, unknown: 0 };
  for (const c of regCards) ptypeCount[classifyPatient(c)] += 1;
  const tagged = ptypeCount.new + ptypeCount.old + ptypeCount.repeat + ptypeCount.referral;

  return (
    <div className="space-y-3">
      {/* 总人次 */}
      <div className="rounded-xl p-3 flex items-center gap-3" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
        <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "rgba(0,199,217,0.15)", border: "1px solid rgba(0,199,217,0.33)" }}>
          <Activity size={18} style={{ color: "#00C7D9" }} />
        </div>
        <div>
          <div className="text-[10px]" style={{ color: theme.textMuted }}>来院总人次</div>
          <div className="text-2xl font-bold tabular-nums" style={{ color: "#00C7D9" }}>{totalVisitors}</div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-[10px]" style={{ color: theme.textMuted }}>挂号单解析</div>
          <div className="text-xs font-semibold" style={{ color: theme.text }}>{regCards.length} 张</div>
        </div>
      </div>

      {/* 业务线分布 */}
      <div className="rounded-xl p-3" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
        <div className="text-xs font-bold mb-2" style={{ color: theme.text }}>业务线分布</div>
        <div className="space-y-1.5">
          {Object.keys(lineCount).map((k) => {
            const v = lineCount[k];
            const pct = Math.round((v / lineTotal) * 100);
            return (
              <div key={k} className="flex items-center gap-2">
                <span className="text-[10px] w-16" style={{ color: theme.textMuted }}>{LINE_LABEL[k]}</span>
                <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: LINE_COLOR[k] }} />
                </div>
                <span className="text-[10px] tabular-nums w-10 text-right" style={{ color: theme.text }}>{v} · {pct}%</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 患者四象限 */}
      <div className="rounded-xl p-3" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
        <div className="flex items-center mb-2">
          <span className="text-xs font-bold" style={{ color: theme.text }}>客源结构</span>
          <span className="ml-auto text-[10px]" style={{ color: theme.textFaint }}>
            {tagged > 0 ? `已标记 ${tagged} / 未标记 ${ptypeCount.unknown}` : "挂号单未含客源标签"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {PTYPES.map((p) => {
            const Icon = p.icon;
            const v = ptypeCount[p.key];
            const pct = tagged ? Math.round((v / tagged) * 100) : 0;
            return (
              <div key={p.key} className="rounded-lg p-2.5" style={{ background: theme.canvas, border: `1px solid ${theme.border}`, borderLeft: `3px solid ${p.color}` }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon size={12} style={{ color: p.color }} />
                  <span className="text-[10px]" style={{ color: theme.textMuted }}>{p.label}</span>
                  <span className="ml-auto text-xs font-bold tabular-nums" style={{ color: p.color }}>{v}</span>
                </div>
                <div className="text-[9.5px]" style={{ color: theme.textFaint }}>占比 {pct}%</div>
              </div>
            );
          })}
        </div>
        {tagged === 0 && (
          <div className="mt-2 text-[10px] px-2 py-1.5 rounded-lg" style={{ background: "rgba(251,191,36,0.08)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.2)" }}>
            提示：当前挂号单未抽取客源标签。建议在证据解析中补充 patient_type / visit_type 字段以启用四象限统计。
          </div>
        )}
      </div>
    </div>
  );
}