import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useTheme, ThemeProvider } from "@/lib/ThemeContext";
import { useClinicId } from "@/lib/ClinicContext";
import PageShell from "@/components/PageShell";
import {
  UserPlus, Mail, Loader, KeyRound, Copy, CheckCircle2, AlertCircle,
  Link2, UserCheck, Trash2, Clock,
} from "lucide-react";

function Inner() {
  const { theme } = useTheme();
  const clinicId = useClinicId();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("user");
  const [inviting, setInviting] = useState(false);
  const [result, setResult] = useState(null);
  const [code, setCode] = useState(null);
  const [copied, setCopied] = useState(false);

  const pendingQ = useQuery({
    queryKey: ["staff", clinicId, "pending"],
    queryFn: () => base44.entities.Staff.filter({ clinic_id: clinicId }, "-created_date", 100),
    refetchInterval: 15000,
  });
  const pending = (pendingQ.data || []).filter((s) => !s.user_id);
  const bound = (pendingQ.data || []).filter((s) => !!s.user_id).length;

  const genCode = () => {
    const c = Math.random().toString(36).slice(2, 8).toUpperCase();
    setCode(c);
    setCopied(false);
  };
  const regLink = code ? `${window.location.origin}/register?code=${code}` : "";
  const copyLink = () => {
    if (!regLink) return;
    navigator.clipboard?.writeText(regLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const onInvite = async () => {
    if (!email.trim()) { setResult({ ok: false, msg: "请输入员工邮箱" }); return; }
    setInviting(true); setResult(null);
    try {
      await base44.users.inviteUser(email.trim(), role);
      setResult({ ok: true, msg: `已向 ${email.trim()} 发送邀请邮件，员工登录后在「员工终端」绑定身份即上线` });
      setEmail("");
    } catch (e) {
      setResult({ ok: false, msg: e?.response?.data?.error || e?.message || "邀请失败" });
    } finally { setInviting(false); }
  };

  const onReject = async (s) => {
    if (!window.confirm(`拒绝「${s.staff_name}」的入职申请？将删除该待审记录（不影响其登录账号）。`)) return;
    await base44.entities.Staff.delete(s.id);
    qc.invalidateQueries({ queryKey: ["staff", clinicId, "pending"] });
  };

  const fieldStyle = { background: theme.canvas, border: `1px solid ${theme.border}`, color: theme.text };

  return (
    <PageShell icon={UserPlus} title="员工入职邀请" subtitle={`${clinicId} · 邀请码 / 注册链接 / 待审核申请`} maxWidth="max-w-4xl">
      {/* 两种邀请方式 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {/* 邮箱邀请 */}
        <div className="rounded-xl p-4" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
          <div className="flex items-center gap-2 mb-3">
            <Mail size={15} style={{ color: "#00C7D9" }} />
            <span className="text-sm font-bold" style={{ color: theme.text }}>邮箱邀请注册</span>
          </div>
          <div className="space-y-2">
            <div className="relative">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: theme.textFaint }} />
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="员工邮箱"
                className="w-full text-sm rounded-lg pl-9 pr-3 py-2.5 outline-none" style={fieldStyle} />
            </div>
            <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full text-sm rounded-lg px-3 py-2.5 outline-none" style={fieldStyle}>
              <option value="user">普通员工</option>
              <option value="admin">管理员</option>
            </select>
            <button onClick={onInvite} disabled={inviting}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold disabled:opacity-50"
              style={{ background: "linear-gradient(135deg,#00C7D9,#00A8BD)", color: "#0D1B2A" }}>
              {inviting ? <Loader size={15} className="animate-spin" /> : <UserPlus size={15} />}
              {inviting ? "发送中…" : "发送邀请邮件"}
            </button>
          </div>
          {result && (
            <div className="mt-3 flex items-start gap-2 rounded-lg p-2.5 text-xs leading-relaxed"
              style={result.ok ? { background: "rgba(22,163,74,0.1)", border: "1px solid rgba(22,163,74,0.3)" } : { background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.3)" }}>
              {result.ok ? <CheckCircle2 size={14} style={{ color: "#4ade80", marginTop: 1, flexShrink: 0 }} /> : <AlertCircle size={14} style={{ color: "#f87171", marginTop: 1, flexShrink: 0 }} />}
              <span style={{ color: result.ok ? "#4ade80" : "#f87171" }}>{result.msg}</span>
            </div>
          )}
        </div>

        {/* 邀请码 */}
        <div className="rounded-xl p-4" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
          <div className="flex items-center gap-2 mb-3">
            <KeyRound size={15} style={{ color: "#A78BFA" }} />
            <span className="text-sm font-bold" style={{ color: theme.text }}>邀请码 / 注册链接</span>
          </div>
          <button onClick={genCode}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold"
            style={{ background: "rgba(139,92,246,0.15)", color: "#A78BFA", border: "1px solid rgba(139,92,246,0.3)" }}>
            <KeyRound size={15} /> 生成一次性邀请码
          </button>
          {code && (
            <div className="mt-3 space-y-2 animate-fade-in">
              <div className="flex items-center gap-2">
                <span className="text-[11px]" style={{ color: theme.textSub }}>邀请码</span>
                <span className="text-base font-bold tracking-widest px-3 py-1 rounded-lg" style={{ background: "rgba(139,92,246,0.12)", color: "#A78BFA", border: "1px dashed rgba(139,92,246,0.4)" }}>{code}</span>
              </div>
              <div className="flex items-center gap-2">
                <input readOnly value={regLink} className="flex-1 text-[11px] rounded-lg px-2.5 py-2 outline-none" style={fieldStyle} />
                <button onClick={copyLink} className="p-2 rounded-lg" style={{ background: "rgba(0,199,217,0.1)", border: "1px solid rgba(0,199,217,0.25)" }}>
                  {copied ? <CheckCircle2 size={14} style={{ color: "#4ade80" }} /> : <Copy size={14} style={{ color: "#00C7D9" }} />}
                </button>
              </div>
              <div className="flex items-start gap-2 text-[11px]" style={{ color: theme.textSub }}>
                <Link2 size={12} style={{ marginTop: 1, flexShrink: 0 }} />
                <span>将此链接发给员工，其注册登录后打开「员工终端」/staff-pad 填写姓名/岗位/区域完成绑定。</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 统计 */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="rounded-xl p-3" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
          <div className="text-lg font-bold" style={{ color: "#fbbf24" }}>{pending.length}</div>
          <div className="text-[10px] mt-0.5" style={{ color: theme.textSub }}>待审核申请</div>
        </div>
        <div className="rounded-xl p-3" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
          <div className="text-lg font-bold" style={{ color: "#A78BFA" }}>{bound}</div>
          <div className="text-[10px] mt-0.5" style={{ color: theme.textSub }}>已绑定账号</div>
        </div>
        <div className="rounded-xl p-3" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
          <div className="text-lg font-bold" style={{ color: "#00C7D9" }}>{(pendingQ.data || []).length}</div>
          <div className="text-[10px] mt-0.5" style={{ color: theme.textSub }}>在册总数</div>
        </div>
      </div>

      {/* 待审核列表 */}
      <div className="rounded-xl overflow-hidden" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
        <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: `1px solid ${theme.border}` }}>
          <UserCheck size={15} style={{ color: "#fbbf24" }} />
          <span className="text-sm font-bold" style={{ color: theme.text }}>待审核入职申请</span>
          <span className="text-[11px] ml-auto" style={{ color: theme.textFaint }}>{pending.length} 条 · 员工尚未绑定账号</span>
        </div>
        {pendingQ.isLoading ? (
          <div className="p-6 flex justify-center"><Loader className="animate-spin" style={{ color: theme.textSub }} /></div>
        ) : pending.length === 0 ? (
          <div className="p-6 text-center text-xs" style={{ color: theme.textFaint }}>暂无待审核申请</div>
        ) : (
          pending.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${theme.borderSubtle}` }}>
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(251,191,36,0.12)" }}>
                <span className="text-xs font-bold" style={{ color: "#fbbf24" }}>{(s.staff_name || "?").slice(0, 1)}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate" style={{ color: theme.text }}>{s.staff_name || "未命名"}</div>
                <div className="text-[11px] mt-0.5 flex items-center gap-2 flex-wrap" style={{ color: theme.textSub }}>
                  <span>{s.role}</span>
                  <span style={{ color: theme.textFaint }}>·</span>
                  <span>{s.assigned_zone || "未分配区域"}</span>
                  <span style={{ color: theme.textFaint }}>·</span>
                  <Clock size={10} />
                  <span>{s.created_date ? new Date(s.created_date).toLocaleDateString("zh-CN") : "—"}</span>
                </div>
              </div>
              <span className="text-[10px] px-2 py-1 rounded-full font-semibold flex-shrink-0" style={{ background: "rgba(251,191,36,0.12)", color: "#fbbf24" }}>待绑定</span>
              <button onClick={() => onReject(s)} className="p-1.5 rounded-lg flex-shrink-0" style={{ background: "rgba(220,38,38,0.08)" }} title="拒绝并删除">
                <Trash2 size={13} style={{ color: "#f87171" }} />
              </button>
            </div>
          ))
        )}
      </div>
    </PageShell>
  );
}

export default function StaffOnboarding() {
  return <ThemeProvider><Inner /></ThemeProvider>;
}