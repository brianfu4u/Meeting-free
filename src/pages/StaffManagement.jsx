import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useTheme, ThemeProvider } from "@/lib/ThemeContext";
import { useClinicId } from "@/lib/ClinicContext";
import { ROLE_LABELS, ROLE_TO_DEPARTMENT, STAFF_STATUS_LABELS, STAFF_STATUS_COLORS } from "@/lib/staffPad/useStaffSelf";
import { DEPARTMENTS, BUSINESS_FAMILIES } from "@/lib/departments/registry";
import { ArrowLeft, UserPlus, Users, Loader, Trash2, Mail, Link2, CheckCircle2, AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";

function Stat({ label, value, color, theme }) {
  return (
    <div className="rounded-xl p-3" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
      <div className="text-lg font-bold" style={{ color }}>{value}</div>
      <div className="text-[10px] mt-0.5" style={{ color: theme.textSub }}>{label}</div>
    </div>
  );
}

function StaffMgmtInner() {
  const { theme } = useTheme();
  const clinicId = useClinicId();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("user");
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState(null);
  const [removingId, setRemovingId] = useState(null);

  const staffQ = useQuery({
    queryKey: ["staff", clinicId],
    queryFn: () => base44.entities.Staff.filter({ clinic_id: clinicId }, "-created_date", 100),
    refetchInterval: 15000,
  });
  const staff = staffQ.data || [];

  const onInvite = async () => {
    if (!email.trim()) { setInviteResult({ ok: false, msg: "请输入员工邮箱" }); return; }
    setInviting(true); setInviteResult(null);
    try {
      await base44.users.inviteUser(email.trim(), role);
      setInviteResult({ ok: true, msg: `已向 ${email.trim()} 发送邀请邮件，对方注册登录后在「员工终端」绑定身份即可上线。` });
      setEmail("");
    } catch (e) {
      setInviteResult({ ok: false, msg: e?.response?.data?.error || e?.message || "邀请失败" });
    } finally { setInviting(false); }
  };

  const onRemove = async (s) => {
    if (!window.confirm(`确定移除「${s.staff_name}」的员工档案？此操作仅删除门店员工绑定，不影响其登录账号。`)) return;
    setRemovingId(s.id);
    try { await base44.entities.Staff.delete(s.id); }
    catch (e) {}
    finally { setRemovingId(null); qc.invalidateQueries({ queryKey: ["staff", clinicId] }); }
  };

  const total = staff.length;
  const onDuty = staff.filter((s) => s.status === "on_duty" || s.status === "busy").length;
  const bound = staff.filter((s) => !!s.user_id).length;

  return (
    <div className="min-h-screen" style={{ background: theme.canvas }}>
      <header className="fixed top-0 left-0 right-0 z-40 flex items-center gap-3 px-4 h-14" style={{ background: theme.topbar, borderBottom: `1px solid ${theme.borderSubtle}` }}>
        <Link to="/" className="p-1.5 rounded-lg" style={{ background: "rgba(255,255,255,0.04)" }}><ArrowLeft size={16} style={{ color: theme.textSub }} /></Link>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(0,199,217,0.15)", border: "1px solid rgba(0,199,217,0.35)" }}><Users size={15} style={{ color: "#00C7D9" }} /></div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold" style={{ color: theme.text }}>员工管理</div>
          <div className="text-[11px] truncate" style={{ color: theme.textMuted }}>{clinicId} · 邀请注册 / 花名册</div>
        </div>
      </header>

      <div className="pt-16 px-4 pb-10 max-w-4xl mx-auto">
        {/* 邀请卡片 */}
        <div className="rounded-xl p-4 mb-4" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
          <div className="flex items-center gap-2 mb-3">
            <UserPlus size={15} style={{ color: "#00C7D9" }} />
            <span className="text-sm font-bold" style={{ color: theme.text }}>邀请新员工注册</span>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: theme.textFaint }} />
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="员工邮箱（用于注册登录）"
                className="w-full text-sm rounded-lg pl-9 pr-3 py-2.5 outline-none" style={{ background: theme.canvas, border: `1px solid ${theme.border}`, color: theme.text }} />
            </div>
            <select value={role} onChange={(e) => setRole(e.target.value)}
              className="text-sm rounded-lg px-3 py-2.5 outline-none" style={{ background: theme.canvas, border: `1px solid ${theme.border}`, color: theme.text }}>
              <option value="user">普通员工</option>
              <option value="admin">管理员</option>
            </select>
            <button onClick={onInvite} disabled={inviting}
              className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold disabled:opacity-50"
              style={{ background: "linear-gradient(135deg,#00C7D9,#00A8BD)", color: "#0D1B2A" }}>
              {inviting ? <Loader size={15} className="animate-spin" /> : <UserPlus size={15} />}
              {inviting ? "发送中…" : "发送邀请"}
            </button>
          </div>
          {inviteResult && (
            <div className="mt-3 flex items-start gap-2 rounded-lg p-2.5 text-xs leading-relaxed" style={inviteResult.ok ? { background: "rgba(22,163,74,0.1)", border: "1px solid rgba(22,163,74,0.3)" } : { background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.3)" }}>
              {inviteResult.ok ? <CheckCircle2 size={14} style={{ color: "#4ade80", marginTop: 1, flexShrink: 0 }} /> : <AlertCircle size={14} style={{ color: "#f87171", marginTop: 1, flexShrink: 0 }} />}
              <span style={{ color: inviteResult.ok ? "#4ade80" : "#f87171" }}>{inviteResult.msg}</span>
            </div>
          )}
          <div className="mt-3 flex items-start gap-2 rounded-lg p-2.5 text-[11px] leading-relaxed" style={{ background: theme.canvas, border: `1px dashed ${theme.border}` }}>
            <Link2 size={13} style={{ color: theme.textSub, marginTop: 1, flexShrink: 0 }} />
            <span style={{ color: theme.textSub }}>流程：店长邀请 → 员工收到注册邮件并登录 → 打开「员工终端」<code style={{ color: "#00C7D9" }}>/staff-pad</code> → 填写姓名 / 岗位 / 区域完成身份绑定即上线。</span>
          </div>
        </div>

        {/* 统计 */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <Stat label="在册员工" value={total} color="#00C7D9" theme={theme} />
          <Stat label="在岗 / 忙碌" value={onDuty} color="#4ade80" theme={theme} />
          <Stat label="已绑定账号" value={bound} color="#A78BFA" theme={theme} />
        </div>

        {/* 花名册 */}
        <div className="rounded-xl overflow-hidden" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
          <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: `1px solid ${theme.border}` }}>
            <span className="text-sm font-bold" style={{ color: theme.text }}>员工花名册</span>
            {staffQ.isLoading ? <Loader size={14} className="animate-spin" style={{ color: theme.textSub }} /> : <span className="text-[11px]" style={{ color: theme.textFaint }}>{staff.length} 人</span>}
          </div>
          {staffQ.isLoading ? (
            <div className="p-6 flex justify-center"><Loader className="animate-spin" style={{ color: theme.textSub }} /></div>
          ) : staff.length === 0 ? (
            <div className="p-6 text-center text-xs" style={{ color: theme.textFaint }}>暂无员工，先邀请注册吧</div>
          ) : (
            (() => {
              const byDept = {};
              staff.forEach((s) => {
                const deptId = s.department_id || ROLE_TO_DEPARTMENT[s.role] || "supplemental";
                (byDept[deptId] = byDept[deptId] || []).push(s);
              });
              return DEPARTMENTS.map((dept) => {
                const list = byDept[dept.id] || [];
                const fam = BUSINESS_FAMILIES[dept.family];
                return (
                  <div key={dept.id} style={{ borderBottom: `1px solid ${theme.borderSubtle}` }}>
                    <div className="px-4 py-2 flex items-center gap-2" style={{ background: "rgba(128,128,128,0.04)" }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: fam.color }} />
                      <span className="text-[10px] font-bold tracking-wider" style={{ color: fam.color }}>{dept.code}</span>
                      <span className="text-xs font-semibold" style={{ color: theme.text }}>{dept.name}</span>
                      <span className="text-[10px] ml-auto" style={{ color: theme.textFaint }}>{list.length} 人</span>
                    </div>
                    {list.length === 0 ? (
                      <div className="px-4 py-2 text-[11px]" style={{ color: theme.textFaint }}>暂无员工</div>
                    ) : list.map((s) => (
                      <div key={s.id} className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${theme.borderSubtle}` }}>
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${STAFF_STATUS_COLORS[s.status]}18` }}>
                          <span className="text-xs font-bold" style={{ color: STAFF_STATUS_COLORS[s.status] }}>{(s.staff_name || "?").slice(0, 1)}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold truncate" style={{ color: theme.text }}>{s.staff_name || "未命名"}</span>
                            {s.user_id
                              ? <span className="text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1 flex-shrink-0" style={{ background: "rgba(167,139,250,0.12)", color: "#A78BFA" }}><Link2 size={9} />已绑定</span>
                              : <span className="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: "rgba(148,163,184,0.12)", color: "#94A3B8" }}>未绑定</span>}
                          </div>
                          <div className="text-[11px] mt-0.5 flex items-center gap-2 flex-wrap" style={{ color: theme.textSub }}>
                            <span>{ROLE_LABELS[s.role] || s.role}</span>
                            <span style={{ color: theme.textFaint }}>·</span>
                            <span className="truncate">{s.assigned_zone || "未分配区域"}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.pad_online ? "#4ade80" : "#475569" }} title={s.pad_online ? "终端在线" : "终端离线"} />
                          <span className="text-[10px] px-2 py-1 rounded-full font-semibold" style={{ background: `${STAFF_STATUS_COLORS[s.status]}1a`, color: STAFF_STATUS_COLORS[s.status] }}>{STAFF_STATUS_LABELS[s.status] || s.status}</span>
                          <button onClick={() => onRemove(s)} disabled={removingId === s.id} className="p-1.5 rounded-lg disabled:opacity-50" style={{ background: "rgba(220,38,38,0.08)" }}>
                            {removingId === s.id ? <Loader size={13} className="animate-spin" style={{ color: "#f87171" }} /> : <Trash2 size={13} style={{ color: "#f87171" }} />}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              });
            })()
          )}
        </div>
      </div>
    </div>
  );
}

export default function StaffManagement() {
  return <ThemeProvider><StaffMgmtInner /></ThemeProvider>;
}