import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useClinicId } from "@/lib/ClinicContext";
import { useTheme } from "@/lib/ThemeContext";
import { ROLE_LABELS, ROLE_GROUPS, ROLE_TO_DEPARTMENT, DEPARTMENT_BY_ID } from "@/lib/staffPad/useStaffSelf";
import { DEPARTMENTS, BUSINESS_FAMILIES } from "@/lib/departments/registry";
import { UserPlus, Loader } from "lucide-react";

export default function BindingScreen({ user, onBound }) {
  const clinicId = useClinicId();
  const { theme } = useTheme();
  const [name, setName] = useState(user?.full_name || "");
  const [role, setRole] = useState("optometrist");
  const [zone, setZone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (!name.trim()) { setErr("请填写姓名"); return; }
    setSubmitting(true); setErr("");
    try {
      await base44.entities.Staff.create({
        clinic_id: clinicId,
        staff_name: name.trim(),
        role,
        role_group: ROLE_GROUPS[role],
        department_id: ROLE_TO_DEPARTMENT[role],
        status: "off_duty",
        pad_online: true,
        user_id: user.id,
        assigned_zone: zone.trim(),
      });
      onBound();
    } catch (e) {
      setErr(e.message || "绑定失败");
    } finally { setSubmitting(false); }
  };

  const currentDept = DEPARTMENT_BY_ID[ROLE_TO_DEPARTMENT[role]];

  return (
    <div className="min-h-screen flex items-center justify-center p-5" style={{ background: theme.canvas }}>
      <div className="w-full max-w-sm rounded-2xl p-5" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(0,199,217,0.15)", border: "1px solid rgba(0,199,217,0.35)" }}>
            <UserPlus size={18} style={{ color: "#00C7D9" }} />
          </div>
          <div>
            <div className="text-base font-bold" style={{ color: theme.text }}>终端绑定</div>
            <div className="text-xs" style={{ color: theme.textMuted }}>登录账号 → 员工身份</div>
          </div>
        </div>
        <div className="text-xs mb-4" style={{ color: theme.textSub }}>已登录：{user?.email}</div>

        <label className="text-xs font-medium mb-1 block" style={{ color: theme.textSub }}>姓名</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="请输入姓名"
          className="w-full rounded-lg px-3 py-2.5 text-sm mb-3 outline-none"
          style={{ background: theme.canvas, border: `1px solid ${theme.border}`, color: theme.text }} />

        <label className="text-xs font-medium mb-1 block" style={{ color: theme.textSub }}>岗位角色</label>
        <select value={role} onChange={(e) => setRole(e.target.value)}
          className="w-full rounded-lg px-3 py-2.5 text-sm mb-2 outline-none"
          style={{ background: theme.canvas, border: `1px solid ${theme.border}`, color: theme.text }}>
          {DEPARTMENTS.filter((d) => d.roles.length > 0).map((d) => (
            <optgroup key={d.id} label={`${d.code} · ${d.name}`} style={{ color: "#000" }}>
              {d.roles.map((r) => (
                <option key={r.id} value={r.id} style={{ color: "#000" }}>{r.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
        {currentDept && (
          <div className="text-[11px] mb-3 flex items-center gap-1.5" style={{ color: theme.textMuted }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: BUSINESS_FAMILIES[currentDept.family].color }} />
            所属部门：{currentDept.name}
          </div>
        )}

        <label className="text-xs font-medium mb-1 block" style={{ color: theme.textSub }}>所属区域（选填）</label>
        <input value={zone} onChange={(e) => setZone(e.target.value)} placeholder="如：检查区3号位"
          className="w-full rounded-lg px-3 py-2.5 text-sm mb-4 outline-none"
          style={{ background: theme.canvas, border: `1px solid ${theme.border}`, color: theme.text }} />

        {err && <div className="text-xs mb-3" style={{ color: "#f87171" }}>{err}</div>}

        <button onClick={submit} disabled={submitting}
          className="w-full rounded-lg py-2.5 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
          style={{ background: "linear-gradient(135deg,#00C7D9,#00A8BD)", color: "#0D1B2A" }}>
          {submitting ? <Loader size={15} className="animate-spin" /> : <UserPlus size={15} />}
          {submitting ? "绑定中…" : "确认绑定"}
        </button>
      </div>
    </div>
  );
}