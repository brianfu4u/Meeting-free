/**
 * Clinic OS V10 — GuessPolicy 发布面板
 * 唯一发布入口：调用后端 guessPolicyService（publish），前端不直接写 GuessPolicy 库。
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useClinicId } from "@/lib/ClinicContext";
import { useTheme } from "@/lib/ThemeContext";
import { ShieldCheck, Loader, Rocket } from "lucide-react";

const DEFAULT_GUARDRAILS = [
  { rule_code: "subject_conflict" },
  { rule_code: "time_impossible", max_gap_minutes: 1440 },
  { rule_code: "attach_to_closed_workflow" },
];

const DEFAULT_TRACKS = [
  "subject_fingerprint", "causal_chain", "temporal_continuity", "department_handoff",
  "actor_device_location", "document_lineage", "open_loop_closure",
].map((t) => ({ track_id: t, name: t, guardrails: [] }));

export default function GuessPolicyPanel() {
  const { theme } = useTheme();
  const clinicId = useClinicId();
  const qc = useQueryClient();
  const [version, setVersion] = useState(2);
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const activeQ = useQuery({
    queryKey: ["guessPolicyActive", clinicId],
    queryFn: () => base44.entities.GuessPolicy.filter({ clinic_id: clinicId, status: "published" }, "-published_at", 1),
    refetchInterval: 30000,
  });
  const cfgQ = useQuery({
    queryKey: ["clinicConfig", clinicId],
    queryFn: () => base44.entities.ClinicConfig.filter({ clinic_id: clinicId }, "-updated_date", 1),
    refetchInterval: 30000,
  });

  const active = activeQ.data?.[0] || null;
  const activeConfigured = cfgQ.data?.[0]?.active_policy_version ?? null;

  const publish = async () => {
    setPublishing(true);
    setError(null);
    setResult(null);
    try {
      const res = await base44.functions.invoke("guessPolicyService", {
        action: "publish",
        clinic_id: clinicId,
        policy_version: Number(version),
        hard_guardrails: DEFAULT_GUARDRAILS,
        tracks: DEFAULT_TRACKS,
        decision_rules: {},
      });
      if (res?.ok === false || (res && res.error)) {
        setError(res?.error || res?.errors?.join("; ") || "发布失败");
      } else {
        setResult(res);
        qc.invalidateQueries({ queryKey: ["guessPolicyActive", clinicId] });
        qc.invalidateQueries({ queryKey: ["clinicConfig", clinicId] });
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
        <span className="text-[10px] ml-auto" style={{ color: theme.textFaint }}>R2.4 · 前端不直接写库</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3 text-xs">
        <div className="rounded-lg p-2" style={{ background: theme.canvas, border: `1px solid ${theme.border}` }}>
          <div style={{ color: theme.textSub }}>当前生效版本</div>
          <div className="font-bold" style={{ color: "#00C7D9" }}>{activeConfigured ?? "—"}</div>
        </div>
        <div className="rounded-lg p-2" style={{ background: theme.canvas, border: `1px solid ${theme.border}` }}>
          <div style={{ color: theme.textSub }}>已发布记录</div>
          <div className="font-bold" style={{ color: theme.text }}>
            {active ? `v${active.policy_version}` : "无"} {active ? `· ${active.published_at?.slice(0, 16)}` : ""}
          </div>
        </div>
        <div className="rounded-lg p-2" style={{ background: theme.canvas, border: `1px solid ${theme.border}` }}>
          <div style={{ color: theme.textSub }}>硬护栏规则</div>
          <div className="font-bold" style={{ color: theme.text }}>{DEFAULT_GUARDRAILS.length} 条结构化</div>
        </div>
      </div>
      <div className="flex items-end gap-3">
        <div>
          <label className="text-[10px] mb-1 block" style={{ color: theme.textSub }}>发布新版本号</label>
          <input type="number" value={version} onChange={(e) => setVersion(e.target.value)}
            className="text-sm rounded-lg px-3 py-2 outline-none w-32"
            style={{ background: theme.canvas, border: `1px solid ${theme.border}`, color: theme.text }} />
        </div>
        <button onClick={publish} disabled={publishing}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50"
          style={{ background: "linear-gradient(135deg,#00C7D9,#00A8BD)", color: "#0D1B2A" }}>
          {publishing ? <Loader size={14} className="animate-spin" /> : <Rocket size={14} />}
          {publishing ? "发布中…" : "发布新版本"}
        </button>
        {result && (
          <span className="text-xs flex items-center gap-1" style={{ color: "#4ade80" }}>
            已发布 v{result.policy?.policy_version} {result.warnings?.length ? `（${result.warnings.length} 警告）` : ""}
          </span>
        )}
        {error && <span className="text-xs" style={{ color: "#f87171" }}>{error}</span>}
      </div>
      <div className="text-[10px] mt-2" style={{ color: theme.textFaint }}>
        调用 base44.functions.invoke("guessPolicyService", {`{action:"publish"}`}) — 后端校验租户授权 + 迁移 + 发布，前端仅触发。
      </div>
    </div>
  );
}