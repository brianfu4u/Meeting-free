import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useTheme, ThemeProvider } from "@/lib/ThemeContext";
import { useClinicId } from "@/lib/ClinicContext";
import PageShell from "@/components/PageShell";
import { Settings, Loader, Save, CheckCircle2, ToggleLeft, ToggleRight, ShieldCheck, Building2 } from "lucide-react";

const ROLE_PERMISSIONS = [
  { role: "doctor", label: "医生", perms: ["就诊全流程", "开具处方", "证据提交", "查看患者档案"] },
  { role: "optometrist", label: "验光师", perms: ["验光流程", "配镜跟进", "证据提交", "患者档案"] },
  { role: "reception", label: "前台", perms: ["到店登记", "叫号引导", "收费结算", "客咨录入"] },
  { role: "nurse", label: "护士", perms: ["叫号引导", "辅助检查", "证据提交", "患者陪护"] },
  { role: "sales", label: "销售", perms: ["配镜推荐", "收银结算", "客户跟进", "营收录入"] },
  { role: "logistics", label: "后勤", perms: ["库存盘点", "物品领用", "报修申请", "采购申请"] },
];

function Inner() {
  const { theme } = useTheme();
  const clinicId = useClinicId();
  const qc = useQueryClient();

  const configQ = useQuery({
    queryKey: ["clinicConfig", clinicId],
    queryFn: () => base44.entities.ClinicConfig.filter({ clinic_id: clinicId }, "-updated_date", 1),
    refetchInterval: 60000,
  });
  const flowQ = useQuery({
    queryKey: ["businessFlows", clinicId],
    queryFn: () => base44.entities.BusinessLineFlow.filter({ clinic_id: clinicId }, "-created_date", 20),
    refetchInterval: 30000,
  });

  const cfg = configQ.data?.[0] || null;
  const flows = flowQ.data || [];

  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);

  useEffect(() => {
    if (cfg) {
      setForm({
        clinic_name: cfg.clinic_name || "",
        city: cfg.city || "",
        contact: cfg.contact || "",
        wait_timeout_yellow_minutes: cfg.wait_timeout_yellow_minutes ?? 15,
        wait_timeout_red_minutes: cfg.wait_timeout_red_minutes ?? 30,
        stall_timeout_minutes: cfg.stall_timeout_minutes ?? 60,
        inventory_check_times: cfg.inventory_check_times || ["08:00", "20:00"],
      });
    }
  }, [cfg]);

  const upd = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const updCheckTime = (i, v) => setForm((f) => {
    const arr = [...(f.inventory_check_times || [])];
    arr[i] = v;
    return { ...f, inventory_check_times: arr };
  });

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      await base44.entities.ClinicConfig.update(cfg.id, {
        clinic_name: form.clinic_name,
        city: form.city,
        contact: form.contact,
        wait_timeout_yellow_minutes: Number(form.wait_timeout_yellow_minutes),
        wait_timeout_red_minutes: Number(form.wait_timeout_red_minutes),
        stall_timeout_minutes: Number(form.stall_timeout_minutes),
        inventory_check_times: form.inventory_check_times,
      });
      qc.invalidateQueries({ queryKey: ["clinicConfig", clinicId] });
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 2500);
    } finally { setSaving(false); }
  };

  const toggleFlow = async (f) => {
    await base44.entities.BusinessLineFlow.update(f.id, { active: !f.active });
    qc.invalidateQueries({ queryKey: ["businessFlows", clinicId] });
  };

  const fieldStyle = { background: theme.canvas, border: `1px solid ${theme.border}`, color: theme.text };
  const inputCls = "w-full text-sm rounded-lg px-3 py-2 outline-none";

  return (
    <PageShell icon={Settings} title="系统配置中心" subtitle={`${clinicId} · 基础信息 / 流程开关 / 角色权限`} maxWidth="max-w-5xl">
      {configQ.isLoading || !form ? (
        <div className="py-16 flex justify-center"><Loader className="animate-spin" style={{ color: theme.textSub }} /></div>
      ) : (
        <>
          {/* 基础信息 */}
          <div className="rounded-xl p-4 mb-4" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
            <div className="flex items-center gap-2 mb-3">
              <Building2 size={15} style={{ color: "#00C7D9" }} />
              <span className="text-sm font-bold" style={{ color: theme.text }}>诊所基础信息</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] mb-1 block" style={{ color: theme.textSub }}>门店名称</label>
                <input value={form.clinic_name} onChange={(e) => upd("clinic_name", e.target.value)} className={inputCls} style={fieldStyle} />
              </div>
              <div>
                <label className="text-[10px] mb-1 block" style={{ color: theme.textSub }}>所在城市</label>
                <input value={form.city} onChange={(e) => upd("city", e.target.value)} className={inputCls} style={fieldStyle} />
              </div>
              <div>
                <label className="text-[10px] mb-1 block" style={{ color: theme.textSub }}>联系人</label>
                <input value={form.contact} onChange={(e) => upd("contact", e.target.value)} className={inputCls} style={fieldStyle} />
              </div>
            </div>
          </div>

          {/* 运营阈值 */}
          <div className="rounded-xl p-4 mb-4" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
            <div className="flex items-center gap-2 mb-3">
              <Settings size={15} style={{ color: "#fbbf24" }} />
              <span className="text-sm font-bold" style={{ color: theme.text }}>运营阈值（分钟）</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] mb-1 block" style={{ color: theme.textSub }}>候诊黄色告警</label>
                <input type="number" value={form.wait_timeout_yellow_minutes} onChange={(e) => upd("wait_timeout_yellow_minutes", e.target.value)} className={inputCls} style={fieldStyle} />
              </div>
              <div>
                <label className="text-[10px] mb-1 block" style={{ color: theme.textSub }}>候诊红色告警</label>
                <input type="number" value={form.wait_timeout_red_minutes} onChange={(e) => upd("wait_timeout_red_minutes", e.target.value)} className={inputCls} style={fieldStyle} />
              </div>
              <div>
                <label className="text-[10px] mb-1 block" style={{ color: theme.textSub }}>节点卡滞超时</label>
                <input type="number" value={form.stall_timeout_minutes} onChange={(e) => upd("stall_timeout_minutes", e.target.value)} className={inputCls} style={fieldStyle} />
              </div>
            </div>
            <div className="mt-3">
              <label className="text-[10px] mb-1 block" style={{ color: theme.textSub }}>库存双节点检查时间</label>
              <div className="flex items-center gap-2">
                {(form.inventory_check_times || []).map((t, i) => (
                  <input key={i} type="time" value={t} onChange={(e) => updCheckTime(i, e.target.value)} className="text-sm rounded-lg px-3 py-2 outline-none" style={fieldStyle} />
                ))}
              </div>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button onClick={save} disabled={saving}
                className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold disabled:opacity-50"
                style={{ background: "linear-gradient(135deg,#00C7D9,#00A8BD)", color: "#0D1B2A" }}>
                {saving ? <Loader size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? "保存中…" : "保存配置"}
              </button>
              {savedMsg && (
                <span className="flex items-center gap-1 text-xs" style={{ color: "#4ade80" }}>
                  <CheckCircle2 size={13} /> 配置已保存
                </span>
              )}
            </div>
          </div>

          {/* 业务流程节点开关 */}
          <div className="rounded-xl p-4 mb-4" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
            <div className="flex items-center gap-2 mb-3">
              <ToggleRight size={15} style={{ color: "#A78BFA" }} />
              <span className="text-sm font-bold" style={{ color: theme.text }}>业务流程节点开关</span>
            </div>
            {flowQ.isLoading ? (
              <div className="py-4 flex justify-center"><Loader className="animate-spin" style={{ color: theme.textSub }} /></div>
            ) : flows.length === 0 ? (
              <div className="py-4 text-center text-xs" style={{ color: theme.textFaint }}>暂无业务线流程配置</div>
            ) : (
              <div className="space-y-2">
                {flows.map((f) => (
                  <div key={f.id} className="flex items-center gap-3 p-3 rounded-lg" style={{ background: theme.canvas, border: `1px solid ${theme.borderSubtle}` }}>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold" style={{ color: theme.text }}>{f.line_name}</div>
                      <div className="text-[10px] mt-0.5 flex flex-wrap gap-1" style={{ color: theme.textSub }}>
                        {(f.nodes || []).map((n, i) => (
                          <span key={i} className="px-1.5 py-0.5 rounded" style={{ background: "rgba(0,199,217,0.06)", color: "#00C7D9" }}>{n}</span>
                        ))}
                      </div>
                    </div>
                    <button onClick={() => toggleFlow(f)} className="flex items-center gap-1.5 text-xs font-semibold flex-shrink-0"
                      style={{ color: f.active ? "#4ade80" : theme.textFaint }}>
                      {f.active ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                      {f.active ? "启用" : "停用"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 角色操作权限矩阵 */}
          <div className="rounded-xl p-4" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
            <div className="flex items-center gap-2 mb-3">
              <ShieldCheck size={15} style={{ color: "#4ade80" }} />
              <span className="text-sm font-bold" style={{ color: theme.text }}>角色操作权限配置</span>
              <span className="text-[10px] ml-auto" style={{ color: theme.textFaint }}>V10 默认权限基线 · 按角色枚举</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
                    <th className="text-left py-2 px-2" style={{ color: theme.textSub }}>角色</th>
                    <th className="text-left py-2 px-2" style={{ color: theme.textSub }}>可执行操作</th>
                  </tr>
                </thead>
                <tbody>
                  {ROLE_PERMISSIONS.map((r) => (
                    <tr key={r.role} style={{ borderBottom: `1px solid ${theme.borderSubtle}` }}>
                      <td className="py-2.5 px-2 align-top whitespace-nowrap">
                        <span className="text-sm font-semibold" style={{ color: theme.text }}>{r.label}</span>
                        <div className="text-[9px]" style={{ color: theme.textFaint }}>{r.role}</div>
                      </td>
                      <td className="py-2.5 px-2">
                        <div className="flex flex-wrap gap-1">
                          {r.perms.map((p) => (
                            <span key={p} className="text-[10px] px-2 py-1 rounded" style={{ background: "rgba(74,222,128,0.08)", color: "#4ade80", border: "1px solid rgba(74,222,128,0.2)" }}>{p}</span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </PageShell>
  );
}

export default function ClinicSettings() {
  return <ThemeProvider><Inner /></ThemeProvider>;
}