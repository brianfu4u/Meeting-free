/**
 * Clinic OS V10 — GuessPolicy 发布面板
 * 唯一发布入口：调用后端 guessPolicyService（publish）。
 * 前端不复制任何规则码/轨道/迁移/校验逻辑：全部从后端 metadata 获取，
 * 仅负责展示、收集输入与调用后端。
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useClinicId } from "@/lib/ClinicContext";
import { useTheme } from "@/lib/ThemeContext";
import { ShieldCheck, Loader, Rocket } from "lucide-react";

export default function GuessPolicyPanel() {
  const { theme } = useTheme();
  const clinicId = useClinicId();
  const qc = useQueryClient();
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  // 后端 metadata 是规则/轨道/版本的唯一来源；前端不硬编码
  const metaQ = useQuery({
    queryKey: ["guessPolicyMetadata", clinicId],
    queryFn: () => base44.functions.invoke("guessPolicyService", { action: "metadata", clinic_id: clinicId }),
    refetchInterval: 30000,
  });

  const meta = metaQ.data;
  const publishable = meta?.publishable_rule_codes || [];
  const trackIds = meta?.track_ids || [];
  const nextVersion = meta?.next_policy_version ?? null;
  const activeVersion = meta?.active_policy_version ?? null;
  const maxVersion = meta?.max_policy_version ?? null;

  const buildGuardrails = () =>
    publishable.map((code) =>
      code === "time_impossible" ? { rule_code: code, max_gap_minutes: 1440 } : { rule_code: code }
    );
  const buildTracks = () =>
    trackIds.map((t) => ({ track_id: t, name: t, guardrails: [] }));

  const publish = async () => {
    setPublishing(true);
    setError(null);
    setResult(null);
    try {
      const res = await base44.functions.invoke("guessPolicyService", {
        action: "publish",
        clinic_id: clinicId,
        policy_version: nextVersion,
        idempotency_key: crypto.randomUUID(),
        hard_guardrails: buildGuardrails(),
        tracks: buildTracks(),
        decision_rules: {},
      });
      if (res?.ok === false || (res && res.error)) {
        setError(res?.error || res?.errors?.join("; ") || "发布失败");
      } else {
        setResult(res);
        qc.invalidateQueries({ queryKey: ["guessPolicyMetadata", clinicId] });
      }
    } catch (e) {
      setError(e?.message || "调用失败");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="rounded-xl p-4 mb-4" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
      <div className="flex items-center gap-2 mb-3">
        <ShieldCheck size={15} style={{ color: "#00C7D9" }} />
        <span className="text-sm font-bold" style={{ color: theme.text }}>GuessPolicy 发布（唯一后端入口）</span>
        <span className="text-[10px] ml-auto" style={{ color: theme.textFaint }}>
          契约 {meta?.contract_version ?? "—"} · 前端不复制规则
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3 text-xs">
        <div className="rounded-lg p-2" style={{ background: theme.canvas, border: `1px solid ${theme.border}` }}>
          <div style={{ color: theme.textSub }}>当前生效版本</div>
          <div className="font-bold" style={{ color: "#00C7D9" }}>{activeVersion ?? "—"}</div>
        </div>
        <div className="rounded-lg p-2" style={{ background: theme.canvas, border: `1px solid ${theme.border}` }}>
          <div style={{ color: theme.textSub }}>历史最大版本</div>
          <div className="font-bold" style={{ color: theme.text }}>{maxVersion ?? "无"}</div>
        </div>
        <div className="rounded-lg p-2" style={{ background: theme.canvas, border: `1px solid ${theme.border}` }}>
          <div style={{ color: theme.textSub }}>下一可发布版本（服务端计算）</div>
          <div className="font-bold" style={{ color: "#00C7D9" }}>{nextVersion ?? "—"}</div>
        </div>
      </div>
      <div className="text-[11px] mb-3" style={{ color: theme.textSub }}>
        可发布规则码（来自后端 metadata）：{publishable.length ? publishable.join("、") : "—"}；
        固定七轨道：{trackIds.length ? trackIds.join("、") : "—"}
      </div>
      <div className="flex items-end gap-3">
        <div>
          <label className="text-[10px] mb-1 block" style={{ color: theme.textSub }}>将发布版本号（服务端单调校验）</label>
          <input type="number" value={nextVersion ?? ""} readOnly
            className="text-sm rounded-lg px-3 py-2 outline-none w-32 opacity-80"
            style={{ background: theme.canvas, border: `1px solid ${theme.border}`, color: theme.text }} />
        </div>
        <button onClick={publish} disabled={publishing || !nextVersion}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50"
          style={{ background: "linear-gradient(135deg,#00C7D9,#00A8BD)", color: "#0D1B2A" }}>
          {publishing ? <Loader size={14} className="animate-spin" /> : <Rocket size={14} />}
          {publishing ? "发布中…" : `发布 v${nextVersion ?? ""}`}
        </button>
        {result?.idempotent && (
          <span className="text-xs flex items-center gap-1" style={{ color: "#fbbf24" }}>
            幂等命中 v{result.policy?.policy_version}
          </span>
        )}
        {result && !result.idempotent && (
          <span className="text-xs flex items-center gap-1" style={{ color: "#4ade80" }}>
            已发布 v{result.policy?.policy_version}
          </span>
        )}
        {error && <span className="text-xs" style={{ color: "#f87171" }}>{error}</span>}
      </div>
      <div className="text-[10px] mt-2" style={{ color: theme.textFaint }}>
        调用 base44.functions.invoke("guessPolicyService", {`{action:"publish", idempotency_key}`}) —
        版本由服务端 next_version 决定；规则与轨道来自 metadata；前端不复制常量。
      </div>
    </div>
  );
}