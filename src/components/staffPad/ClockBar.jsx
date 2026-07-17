import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useTheme } from "@/lib/ThemeContext";
import { publish, TRIGGER_TYPES } from "@/lib/eventBus";
import { Loader } from "lucide-react";

const STATES = [
  { key: "on_duty", label: "上班", color: "#16A34A", bg: "rgba(22,163,74,0.15)", border: "rgba(22,163,74,0.45)" },
  { key: "busy", label: "忙碌", color: "#3B82F6", bg: "rgba(59,130,246,0.15)", border: "rgba(59,130,246,0.45)" },
  { key: "break", label: "休息", color: "#D97706", bg: "rgba(217,119,6,0.15)", border: "rgba(217,119,6,0.45)" },
  { key: "off_duty", label: "下班", color: "#94A3B8", bg: "rgba(148,163,184,0.15)", border: "rgba(148,163,184,0.45)" },
];

export default function ClockBar({ staff, clinicId, onChanged }) {
  const { theme } = useTheme();
  const [busy, setBusy] = useState(false);

  const tap = async (s) => {
    if (busy || staff.status === s.key) return;
    setBusy(true);
    try {
      const patch = { status: s.key };
      if (s.key === "on_duty" && !staff.checked_in_at) patch.checked_in_at = new Date().toISOString();
      await base44.entities.Staff.update(staff.id, patch);
      // 即时反馈到中央看板：经事件总线留痕 + 内存订阅者联动
      await publish("StaffPad", TRIGGER_TYPES.STAFF_STATUS_CHANGED, {
        clinic_id: clinicId,
        staff_id: staff.id,
        staff_name: staff.staff_name,
        new_status: s.key,
      });
      onChanged?.();
    } catch (e) {
      console.error("[ClockBar] 打卡失败", e);
    } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="text-xs font-bold mb-2" style={{ color: theme.textSub }}>一键打卡</div>
      <div className="grid grid-cols-4 gap-2">
        {STATES.map((s) => {
          const active = staff.status === s.key;
          return (
            <button key={s.key} onClick={() => tap(s)} disabled={busy}
              className="rounded-xl py-3 flex flex-col items-center gap-1 transition-all active:scale-95 disabled:opacity-60"
              style={{
                background: active ? s.bg : theme.cardBg,
                border: `1px solid ${active ? s.border : theme.border}`,
                boxShadow: active ? `0 0 0 1px ${s.border}` : "none",
              }}>
              {busy && staff.status !== s.key ? (
                <Loader size={16} className="animate-spin" style={{ color: theme.textFaint }} />
              ) : (
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color, boxShadow: active ? `0 0 8px ${s.color}` : "none" }} />
              )}
              <span className="text-xs font-semibold" style={{ color: active ? s.color : theme.textSub }}>{s.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}