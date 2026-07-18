/**
 * Clinic OS V10 — GuessPolicy 发布面板
 * 唯一发布入口：调用后端 guessPolicyService（publish）。
 * 前端不复制任何规则码/轨道/参数/迁移/校验逻辑：
 * - 规则与轨道全部从后端 metadata 的 rule_descriptors / track_descriptors 渲染；
 * - 提交体按描述符的 params.default 构造，前端不识别具体 rule_code、不设业务默认值；
 * - 幂等键一次发布意图内稳定：失败重试复用同一 key，成功或用户主动放弃后才生成新 key。
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useClinicId } from "@/lib/ClinicContext";
import { useTheme } from "@/lib/ThemeContext";
import { ShieldCheck, Loader, Rocket, RotateCcw } from "lucide-react";

export default function GuessPolicyPanel() {
  const { theme } = useTheme();
  const clinicId = useClinicId();
  const qc = useQueryClient();
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  // 一次发布意图的稳定幂等键：失败重试复用，成功后清空（下次点击生成新 key）
  const [idemKey, setIdemKey] = useState(null);

  // 后端 metadata 是规则/轨道/版本的唯一来源；前端不硬编码
  const metaQ = useQuery({
    queryKey: ["guessPolicyMetadata", clinicId],
    queryFn: () => base44.functions.invoke("guessPolicyService", { action: "metadata", clinic_id: clinicId }),
    refetchInterval: 30000,
  });

  const meta = metaQ.data;
  const ruleDescriptors = meta?.rule_descriptors || [];
  const trackDescriptors = meta?.track_descriptors || [];
  const nextVersion = meta?.next_policy_version ?? null;
  const activeVersion = meta?.active_policy_version ?? null;
  const maxVersion = meta?.max_policy_version ?? null;

  // 按后端描述符构造 guardrails；前端不识别具体 rule_code，仅套用 params.default
  const buildGuardrails = () =>
    ruleDescriptors.map((rd) => {
      const g = { rule_code: rd.rule_code };
      for (const p of rd.params || []) {
        if (p.default !== undefined) g[p.name] = p.default;
      }
      return g;
    });
  // 按后端轨道描述符构造 tracks
  const buildTracks = () =>
    trackDescriptors.map((td) => ({ track_id: td.track_id, name: td.name, guardrails: [] }));

  const publish = async () => {
    setPublishing(true);
    setError(null);
    setResult(null);
    try {
      // 一次发布意图：复用既有 key，仅在无 key 时生成
      const key = idemKey || crypto.randomUUID();
      if (!idemKey) setIdemKey(key);
      const res = await base44.functions.invoke("guessPolicyService", {
        action: "publish",
        clinic_id: clinicId,
        idempotency_key: key,
        policy_version: nextVersion,
        hard_guardrails: buildGuardrails(),
        tracks: buildTracks(),
        decision_rules: {},
      });
      if (res?.ok === false || (res && res.error)) {
        setError(res?.error || res?.errors?.join("; ") || "发布失败");
        // 保留 idemKey 供重试复用
      } else {
        setResult(res);
        setIdemKey(null); // 成功：清空，下次点击为全新发布意图
        qc.invalidateQueries({ queryKey: ["guessPolicyMetadata", clinicId] });
      }
    } catch (e) {
      setError(e?.message || "调用失败");
      // 网络失败/超时：保留 idemKey 供重试复用同一发布请求
    } finally {
      setPublishing(false);
    }
  };

  const abortIntent = () => {
    setIdemKey(null);
    setResult(null);
    setError(null);
  };

  const fieldStyle = { background: theme.canvas, border: `1px solid ${theme.border}`, color: theme.text };

  return (
    <div className="rounded-xl p-4 mb-4" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
      <div className="flex items-center gap-2 mb-3">
        <ShieldCheck size={15} style={{ color: "#00C7D9" }} />
        <span className="text-sm font-bold" style={{ color: theme.text }}>GuessPolicy 发布（唯一后端入口）</span>
        <span className="text-[10px] ml-auto" style={{ color: theme.textFaint }}>
          契约 {meta?.contract_version ?? "—"} · 前端不复制规则/轨道
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

      {/* 规则与轨道描述符：来自后端 metadata，前端只渲染不识别 */}
      <div className="text-[11px] mb-2" style={{ color: theme.textSub }}>
        可发布规则（来自后端描述符）：{ruleDescriptors.length ? ruleDescriptors.map((rd) => rd.label).join("、") : "—"}
      </div>
      <div className="text-[11px] mb-3" style={{ color: theme.textSub }}>
        固定七轨道（来自后端描述符）：{trackDescriptors.length ? trackDescriptors.map((td) => td.name).join("、") : "—"}
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <label className="text-[10px] mb-1 block" style={{ color: theme.textSub }}>将发布版本号（服务端单调校验）</label>
          <input type="number" value={nextVersion ?? ""} readOnly
            className="text-sm rounded-lg px-3 py-2 outline-none w-32 opacity-80" style={fieldStyle} />
        </div>
        <button onClick={publish} disabled={publishing || !nextVersion}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50"
          style={{ background: "linear-gradient(135deg,#00C7D9,#00A8BD)", color: "#0D1B2A" }}>
          {publishing ? <Loader size={14} className="animate-spin" /> : <Rocket size={14} />}
          {publishing ? "发布中…" : `发布 v${nextVersion ?? ""}`}
        </button>
        {idemKey && (
          <button onClick={abortIntent} title="放弃本次发布意图并重置幂等键"
            className="flex items-center gap-1 text-xs px-2 py-2 rounded-lg"
            style={{ color: theme.textSub, border: `1px solid ${theme.border}` }}>
            <RotateCcw size={12} /> 放弃本次发布
          </button>
        )}
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
        幂等键：{idemKey ? `${idemKey.slice(0, 8)}…（重试复用，成功后自动重置）` : "下次点击生成新 key"}；
        规则与轨道来自后端描述符，前端不识别 rule_code、不设业务默认值。
      </div>
    </div>
  );
}