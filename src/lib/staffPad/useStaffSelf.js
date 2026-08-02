/**
 * Clinic OS V9 — 员工终端（PAD）身份与绑定钩子
 * 宪法①：所有读取强制 clinic_id 隔离。终端使用人 = 平台登录账号 → Staff.user_id 绑定。
 */
import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useClinicId } from "@/lib/ClinicContext";

// 角色/部门定义统一从部门注册表派生（唯一真理源：src/lib/departments/registry.js）
import {
  ROLE_LABELS as REGISTRY_ROLE_LABELS,
  ROLE_GROUPS as REGISTRY_ROLE_GROUPS,
  ROLE_TO_DEPARTMENT,
  DEPARTMENT_BY_ID,
  getCategoriesForRole,
} from "@/lib/departments/registry";

export const ROLE_LABELS = REGISTRY_ROLE_LABELS;
export const ROLE_GROUPS = REGISTRY_ROLE_GROUPS;
export { ROLE_TO_DEPARTMENT, DEPARTMENT_BY_ID, getCategoriesForRole };

export const STAFF_STATUS_LABELS = {
  off_duty: "下班", on_duty: "在岗", busy: "忙碌", break: "休息", awaiting_confirm: "待确认",
};

export const STAFF_STATUS_COLORS = {
  off_duty: "#94A3B8", on_duty: "#4ade80", busy: "#60a5fa", break: "#fbbf24", awaiting_confirm: "#fbbf24",
};

export const TASK_STATUS_LABELS = {
  pending_approval: "待审批", assigned: "已指派", in_progress: "进行中",
  pending_evidence: "待补证据", under_review: "审核中", exception: "异常", completed: "已完成",
};

export function useStaffSelf() {
  const clinicId = useClinicId();
  const [state, setState] = useState({ loading: true, user: null, staff: null, staffList: [] });
  const [selectedId, setSelectedId] = useState(null);

  const refresh = useCallback(async () => {
    let me = null;
    try { me = await base44.auth.me(); } catch (e) { me = null; }
    if (!me) { setState({ loading: false, user: null, staff: null, staffList: [] }); return; }
    let list = [];
    try {
      const all = await base44.entities.Staff.filter({ clinic_id: clinicId }, "-created_date", 100);
      if (Array.isArray(all)) {
        // 终端可切换本门店所有已绑定登录账号的员工（不限当前账号）
        list = all.filter((s) => s.user_id);
      }
    } catch (e) { list = []; }
    // 当前登录用户必须在本门店有自己的员工绑定记录，方可使用终端。
    // 无自身绑定时 staff=null → 显示 BindingScreen 引导绑定，而非冒用他人身份。
    // 有自身绑定后，可在切换器中选择本门店任意已绑定员工代采。
    const myBindings = list.filter((s) => s.user_id === me.id);
    if (myBindings.length === 0) {
      setState({ loading: false, user: me, staff: null, staffList: list });
      return;
    }
    const picked = list.find((s) => s.id === selectedId) || myBindings[0];
    setState({ loading: false, user: me, staff: picked, staffList: list });
  }, [clinicId, selectedId]);

  useEffect(() => { refresh(); }, [refresh]);

  // 实时订阅自己的员工记录（打卡状态即时回显）
  useEffect(() => {
    if (!state.staff) return;
    const unsub = base44.entities.Staff.subscribe((event) => {
      if (event.data?.id === state.staff.id) {
        setState((s) => (event.type === "delete"
          ? { ...s, staff: null }
          : { ...s, staff: { ...s.staff, ...event.data } }));
      }
    });
    return unsub;
  }, [state.staff?.id]);

  const switchStaff = useCallback((id) => { setSelectedId(id); }, []);
  return { ...state, refresh, clinicId, switchStaff };
}