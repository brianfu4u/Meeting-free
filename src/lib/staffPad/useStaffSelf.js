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
      list = await base44.entities.Staff.filter({ clinic_id: clinicId, user_id: me.id }, "-created_date", 50);
      if (!Array.isArray(list)) list = [];
    } catch (e) { list = []; }
    const picked = (list.find((s) => s.id === selectedId) || list[0] || null);
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