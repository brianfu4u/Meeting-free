/**
 * Clinic OS V9 — 员工终端（PAD）身份与绑定钩子
 * 宪法①：所有读取强制 clinic_id 隔离。终端使用人 = 平台登录账号 → Staff.user_id 绑定。
 */
import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useClinicId } from "@/lib/ClinicContext";

export const ROLE_LABELS = {
  doctor: "眼科医生", optometrist: "视光师", vision_trainer: "视觉训练师",
  head_nurse: "护士长", nurse: "护士", reception: "前台接待",
  customer_service: "客服", sales: "销售", logistics: "后勤",
  marketing: "市场", finance: "财务", it: "IT", compliance: "合规",
  procurement: "采购", field_ops: "外勤", equipment_maint: "设备维护", cleaning: "保洁",
};

export const ROLE_GROUPS = {
  doctor: "medical_core", optometrist: "medical_core", vision_trainer: "medical_core",
  head_nurse: "medical_core", nurse: "medical_core",
  reception: "front_sales", customer_service: "front_sales", sales: "front_sales", marketing: "front_sales",
  logistics: "back_support", finance: "back_support", it: "back_support", compliance: "back_support",
  procurement: "back_support", field_ops: "back_support", equipment_maint: "back_support", cleaning: "back_support",
};

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
  const [state, setState] = useState({ loading: true, user: null, staff: null });

  const refresh = useCallback(async () => {
    let me = null;
    try { me = await base44.auth.me(); } catch (e) { me = null; }
    if (!me) { setState({ loading: false, user: null, staff: null }); return; }
    let staff = null;
    try {
      const list = await base44.entities.Staff.filter({ clinic_id: clinicId, user_id: me.id }, "-created_date", 1);
      staff = list[0] || null;
    } catch (e) { staff = null; }
    setState({ loading: false, user: me, staff });
  }, [clinicId]);

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

  return { ...state, refresh, clinicId };
}