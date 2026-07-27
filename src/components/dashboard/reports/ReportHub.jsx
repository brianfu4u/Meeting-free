/**
 * Clinic OS — 经营报告中心
 * 店长/投资人视图：人 / 流 / 钱 / 物 四维度统计，支持日/周/月/季时间筛选。
 * 嵌入 ManagerPanelDrawer 使用。
 */

import React, { useState } from "react";
import { useTheme } from "@/lib/ThemeContext";
import { RANGE_PRESETS, computeRange } from "@/lib/reportRange";
import StaffReport from "./StaffReport";
import FlowReport from "./FlowReport";
import RevenueReport from "./RevenueReport";
import AssetReport from "./AssetReport";

const TABS = [
  { id: "flow", label: "流 · 患者流转", color: "#00C7D9", Comp: FlowReport },
  { id: "revenue", label: "钱 · 营收品类", color: "#FBBF24", Comp: RevenueReport },
  { id: "asset", label: "物 · 仪器品牌", color: "#A78BFA", Comp: AssetReport },
  { id: "staff", label: "人 · 员工效能", color: "#4ade80", Comp: StaffReport },
];

export default function ReportHub() {
  const { theme } = useTheme();
  const [tab, setTab] = useState("flow");
  const [preset, setPreset] = useState("day");
  const range = computeRange(preset);
  const Active = TABS.find((t) => t.id === tab)?.Comp || FlowReport;

  return (
    <div>
      {/* 时间范围筛选器 */}
      <div className="flex items-center gap-1.5 px-1 py-3 border-b" style={{ borderColor: theme.border }}>
        <span className="text-[10px] mr-1 font-semibold" style={{ color: theme.textMuted }}>时间范围</span>
        {RANGE_PRESETS.map((p) => {
          const active = p.id === preset;
          return (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition"
              style={{
                background: active ? "rgba(0,199,217,0.15)" : "transparent",
                color: active ? "#00C7D9" : theme.textMuted,
                border: `1px solid ${active ? "rgba(0,199,217,0.3)" : theme.border}`,
              }}
            >
              {p.label}
            </button>
          );
        })}
        <span className="ml-auto text-[10px] tabular-nums" style={{ color: theme.textMuted }}>
          {range.start} ~ {range.end}
        </span>
      </div>

      {/* 维度标签页 */}
      <div className="flex items-center gap-1 px-1 overflow-x-auto">
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold whitespace-nowrap transition border-b-2"
              style={{ borderColor: active ? t.color : "transparent", color: active ? t.color : theme.textMuted }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* 报表内容 */}
      <div className="px-1 py-3">
        <Active range={range} />
      </div>
    </div>
  );
}