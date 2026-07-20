import React, { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Trash2,
  ShieldCheck,
  Loader,
  ArrowLeft,
  FlaskConical,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import { ThemeProvider, useTheme } from "@/lib/ThemeContext";
import MultimodalIngestionPanel from "@/components/phase5/MultimodalIngestionPanel";

// 隔离测试诊所：必须以 phase5-it- 开头；后端 resolveActor 仍强制 Staff 绑定 + 租户校验。
const PHASE5_PREFIX = "phase5-it-";
const CLEANUP_ORDER = [
  "AttentionItem",
  "FragmentProcessingResult",
  "EvidenceFactCard",
  "Artifact",
  "Staff",
  "ClinicConfig",
];

function newClinicId() {
  const u =
    crypto?.randomUUID?.() ||
    `it-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${PHASE5_PREFIX}${u}`;
}

function Phase5SmokeInner() {
  const { theme } = useTheme();
  const [clinicId, setClinicId] = useState(null);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState(null);
  const [cleanupReport, setCleanupReport] = useState(null);
  const [cleaning, setCleaning] = useState(false);

  const provision = useCallback(async () => {
    setProvisioning(true);
    setProvisionError(null);
    setCleanupReport(null);
    try {
      const me = await base44.auth.me();
      if (!me) {
        setProvisionError("未登录，请先登录后再启动隔离测试");
        return;
      }
      const id = newClinicId();
      await base44.entities.ClinicConfig.create({
        clinic_id: id,
        clinic_name: "Phase5 Smoke Clinic",
        city: "Tokyo",
        contact: "smoke",
        manager_id: me.id,
        timezone: "Asia/Tokyo",
        activation_status: "active",
        cold_start_completed: true,
        shadow_mode: true,
      });
      await base44.entities.Staff.create({
        clinic_id: id,
        user_id: me.id,
        staff_name: "Phase5 Smoke Staff",
        role: "doctor",
        role_group: "medical_core",
        status: "on_duty",
        pad_online: true,
        assigned_zone: "optometry",
        checked_in_at: new Date().toISOString(),
      });
      setClinicId(id);
    } catch (e) {
      setProvisionError(String(e?.message || e));
    } finally {
      setProvisioning(false);
    }
  }, []);

  const cleanup = useCallback(async () => {
    if (!clinicId) return;
    setCleaning(true);
    try {
      const report = { clinic_id: clinicId, deleted: {}, remaining: {} };
      for (const name of CLEANUP_ORDER) {
        report.deleted[name] = 0;
        const rows = await base44.entities[name].filter({ clinic_id: clinicId });
        for (const r of rows || []) {
          try {
            await base44.entities[name].delete(r.id);
            report.deleted[name] += 1;
          } catch {}
        }
      }
      for (const name of CLEANUP_ORDER) {
        const rows = await base44.entities[name].filter({ clinic_id: clinicId });
        report.remaining[name] = (rows || []).length;
      }
      const allZero = CLEANUP_ORDER.every((n) => report.remaining[n] === 0);
      report.all_zero = allZero;
      setCleanupReport(report);
      if (allZero) setClinicId(null);
    } finally {
      setCleaning(false);
    }
  }, [clinicId]);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: theme.canvas }}>
      <header
        className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
        style={{ borderBottom: `1px solid ${theme.border}` }}
      >
        <Link
          to="/"
          className="p-1.5 rounded-lg"
          style={{ background: "rgba(255,255,255,0.04)" }}
        >
          <ArrowLeft size={16} style={{ color: theme.textSub }} />
        </Link>
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: "rgba(0,199,217,0.15)", border: "1px solid rgba(0,199,217,0.35)" }}
        >
          <FlaskConical size={17} style={{ color: "#00C7D9" }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold" style={{ color: theme.text }}>
            Phase 5 多模态碎片采集 · 隔离测试
          </div>
          <div className="text-xs truncate" style={{ color: theme.textMuted }}>
            mock_mode=true · 合成 UI smoke · 禁止触碰 clinic-001
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 max-w-2xl w-full mx-auto">
        {!clinicId && !cleanupReport && (
          <div
            className="rounded-xl p-6 text-center"
            style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}
          >
            <ShieldCheck size={28} className="mx-auto mb-3" style={{ color: "#4ade80" }} />
            <div className="text-sm font-bold mb-1.5" style={{ color: theme.text }}>
              隔离测试未启动
            </div>
            <div className="text-xs mb-4 leading-relaxed" style={{ color: theme.textMuted }}>
              点击下方按钮将生成一个随机的 <span style={{ color: "#00C7D9" }}>phase5-it-*</span> 隔离诊所，
              并为当前登录账号绑定在岗 Staff。所有采集仅调用 UploadFile + fragmentIngestionService，
              后端强制租户校验；不会触发 CompositionRun / review / commit。
            </div>
            <button
              onClick={provision}
              disabled={provisioning}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50 mx-auto"
              style={{ background: "linear-gradient(135deg,#00C7D9,#00A8BD)", color: "#0D1B2A" }}
            >
              {provisioning ? <Loader size={15} className="animate-spin" /> : <FlaskConical size={15} />}
              初始化隔离测试诊所
            </button>
            {provisionError && (
              <div className="mt-3 text-xs" style={{ color: "#f87171" }}>
                {provisionError}
              </div>
            )}
          </div>
        )}

        {clinicId && (
          <>
            <div
              className="rounded-xl p-3 mb-3 flex items-center gap-2"
              style={{ background: "rgba(0,199,217,0.08)", border: "1px solid rgba(0,199,217,0.25)" }}
            >
              <ShieldCheck size={14} style={{ color: "#00C7D9" }} />
              <div className="flex-1 min-w-0">
                <div className="text-[10px]" style={{ color: theme.textMuted }}>隔离诊所（后端强制 Staff 绑定 + 租户校验）</div>
                <div className="text-[11px] font-mono truncate" style={{ color: "#00C7D9" }}>{clinicId}</div>
              </div>
            </div>
            <div className="h-[calc(100vh-220px)] min-h-[420px]">
              <MultimodalIngestionPanel clinicId={clinicId} />
            </div>
            <button
              onClick={cleanup}
              disabled={cleaning}
              className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
              style={{ background: "rgba(220,38,38,0.12)", border: "1px solid rgba(220,38,38,0.3)", color: "#f87171" }}
            >
              {cleaning ? <Loader size={15} className="animate-spin" /> : <Trash2 size={15} />}
              精确清理测试数据并核验归零
            </button>
          </>
        )}

        {cleanupReport && (
          <div
            className="rounded-xl p-4 mt-3"
            style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}
          >
            <div className="flex items-center gap-2 mb-3">
              {cleanupReport.all_zero ? (
                <CheckCircle2 size={18} style={{ color: "#4ade80" }} />
              ) : (
                <AlertTriangle size={18} style={{ color: "#fbbf24" }} />
              )}
              <span className="text-sm font-bold" style={{ color: theme.text }}>
                清理报告 · {cleanupReport.all_zero ? "全部归零" : "存在残留"}
              </span>
            </div>
            <div className="text-[11px] font-mono mb-2" style={{ color: theme.textMuted }}>
              {cleanupReport.clinic_id}
            </div>
            <div className="space-y-1">
              {CLEANUP_ORDER.map((name) => (
                <div key={name} className="flex items-center justify-between text-xs">
                  <span style={{ color: theme.textSub }}>{name}</span>
                  <span style={{ color: theme.textMuted }}>
                    删除 {cleanupReport.deleted[name] ?? 0} · 剩余 {cleanupReport.remaining[name] ?? 0}
                  </span>
                </div>
              ))}
            </div>
            <button
              onClick={provision}
              disabled={provisioning}
              className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50 mx-auto"
              style={{ background: "linear-gradient(135deg,#00C7D9,#00A8BD)", color: "#0D1B2A" }}
            >
              <FlaskConical size={14} /> 重新启动一轮隔离测试
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Phase5Smoke() {
  return (
    <ThemeProvider>
      <Phase5SmokeInner />
    </ThemeProvider>
  );
}