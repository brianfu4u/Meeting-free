import React from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock3, ShieldCheck } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useClinicId } from "@/lib/ClinicContext";
import { deriveSchedulerHealth } from "@/lib/phase4/schedulerHealth";

const COLORS = {
  neutral: "#94A3B8",
  healthy: "#4ade80",
  warning: "#fbbf24",
  critical: "#f87171",
};

const LABELS = {
  disabled: "已关闭",
  not_configured: "未配置",
  waiting: "等待首轮",
  healthy: "健康",
  delayed: "延迟",
  degraded: "异常",
  stale_lock: "过期锁",
};

function displayTime(value) {
  if (!value) return "暂无";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "暂无" : date.toLocaleString("zh-CN");
}

export default function CompositionSchedulerHealth() {
  const clinicId = useClinicId();
  const configQ = useQuery({
    queryKey: ["compositionSchedulerHealth", clinicId],
    enabled: Boolean(clinicId),
    queryFn: async () => {
      const rows = await base44.entities.ClinicConfig.filter(
        { clinic_id: clinicId },
        "-updated_date",
        1
      );
      return rows?.[0] || null;
    },
    refetchInterval: 30000,
  });

  if (configQ.isLoading) {
    return <div className="mx-3 mt-3 text-[11px] text-slate-500">读取调度健康状态…</div>;
  }

  const config = configQ.data;
  const health = deriveSchedulerHealth({ config, now: new Date() });
  const color = COLORS[health.severity] || COLORS.neutral;
  const Icon =
    health.severity === "healthy"
      ? CheckCircle2
      : health.severity === "critical"
        ? AlertTriangle
        : health.severity === "warning"
          ? Clock3
          : ShieldCheck;

  return (
    <div className="mx-3 mt-3 rounded-lg p-3" style={{ border: `1px solid ${color}55`, background: `${color}0d` }}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Icon size={14} style={{ color }} />
        <b className="text-slate-100">Phase 4 · 调度健康</b>
        <span className="rounded px-2 py-0.5 font-semibold" style={{ color, border: `1px solid ${color}66` }}>
          {LABELS[health.state] || health.state}
        </span>
        <span className="text-slate-500">灰度：{config?.composition_rollout_status || "disabled"}</span>
      </div>
      <div className="mt-2 grid gap-1 text-[11px] text-slate-400 sm:grid-cols-2">
        <div>最近成功：{displayTime(config?.composition_last_schedule_success_at)}</div>
        <div>最近失败：{displayTime(config?.composition_last_schedule_failure_at)}</div>
        <div>最近时段：{config?.composition_last_schedule_slot || "暂无"}</div>
        <div>运行 ID：{config?.composition_last_schedule_run_id || "暂无"}</div>
        {health.lagMinutes != null && <div>距最近成功：{health.lagMinutes} 分钟</div>}
        {health.errorCode && <div style={{ color }}>安全错误码：{health.errorCode}</div>}
      </div>
      <div className="mt-2 text-[11px]" style={{ color }}>{health.guidance}</div>
      <div className="mt-1 text-[10px] text-slate-500">只读监控；AI 不会在此审核或提交假设。</div>
    </div>
  );
}
