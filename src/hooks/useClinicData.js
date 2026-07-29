/**
 * Clinic OS V9 M2 — 实时态势数据钩子
 * 宪法①：所有查询强制携带 clinic_id，禁止无隔离的全量读取。
 * 基于 React Query 自动轮询刷新，驱动看板实时联动。
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { resolveRuntimeClinicId } from "@/lib/runtimeClinicScope";

export const CLINIC_ID = resolveRuntimeClinicId();
const POLL_MS = 15000;

// 收银台解析结果：今日收款事实卡（金额 / 收费类目来源）
export function usePaymentFactCards() {
  return useQuery({
    queryKey: ["paymentFactCards", CLINIC_ID],
    queryFn: async () => {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const list = await base44.entities.EvidenceFactCard.filter(
        { clinic_id: CLINIC_ID, business_date: today, workflow_family_hint: "payment" },
        "-extracted_at",
        100
      );
      return list;
    },
    refetchInterval: POLL_MS,
  });
}

// 挂号单解析结果：今日来院患者登记事实卡（就诊目的来源）
export function useRegistrationFactCards() {
  return useQuery({
    queryKey: ["registrationFactCards", CLINIC_ID],
    queryFn: async () => {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const list = await base44.entities.EvidenceFactCard.filter(
        { clinic_id: CLINIC_ID, business_date: today, workflow_family_hint: "patient_registration" },
        "-extracted_at",
        100
      );
      return list;
    },
    refetchInterval: POLL_MS,
  });
}

export function usePatientSessions() {
  return useQuery({
    queryKey: ["patientSessions", CLINIC_ID],
    queryFn: async () => {
      const list = await base44.entities.PatientSession.filter({ clinic_id: CLINIC_ID }, "-arrival_time", 50);
      return list;
    },
    refetchInterval: POLL_MS,
  });
}

export function useStaff() {
  return useQuery({
    queryKey: ["staff", CLINIC_ID],
    queryFn: async () => {
      const list = await base44.entities.Staff.filter({ clinic_id: CLINIC_ID }, "-checked_in_at", 50);
      return list;
    },
    refetchInterval: POLL_MS,
  });
}

export function useOperationalTasks() {
  return useQuery({
    queryKey: ["tasks", CLINIC_ID],
    queryFn: async () => {
      const list = await base44.entities.OperationalTask.filter({ clinic_id: CLINIC_ID }, "-created_date", 50);
      return list;
    },
    refetchInterval: POLL_MS,
  });
}

export function useAlerts() {
  return useQuery({
    queryKey: ["alerts", CLINIC_ID],
    queryFn: async () => {
      const list = await base44.entities.Alert.filter({ clinic_id: CLINIC_ID, status: "triggered" }, "-created_at", 30);
      return list;
    },
    refetchInterval: POLL_MS,
  });
}

export function useInventory() {
  return useQuery({
    queryKey: ["inventory", CLINIC_ID],
    queryFn: async () => {
      const list = await base44.entities.InventoryItem.filter({ clinic_id: CLINIC_ID }, "-updated_date", 100);
      return list;
    },
    refetchInterval: 30000,
  });
}

// 今日特检报告单据（来源 diagnostics 部门）。每张单据算一次设备使用。
// 通过 Artifact.source_region="diagnostics" join EvidenceFactCard 识别；设备序号 device_serial 用于归属具体设备。
export function useExamReportFactCards() {
  return useQuery({
    queryKey: ["examReportFactCards", CLINIC_ID],
    queryFn: async () => {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const [cards, artifacts] = await Promise.all([
        base44.entities.EvidenceFactCard.filter({ clinic_id: CLINIC_ID, business_date: today }, "-extracted_at", 200),
        base44.entities.Artifact.filter({ clinic_id: CLINIC_ID, business_date: today }, "-created_date", 200),
      ]);
      const regionByArt = {};
      for (const a of artifacts) regionByArt[a.id] = a.source_region;
      return cards.filter((c) => regionByArt[c.artifact_id] === "diagnostics");
    },
    refetchInterval: POLL_MS,
  });
}

// V10.1 已闭环但尚未核销入库的工作流快照（status=closed 且 reconciled !== true）
export function usePendingReconcileSnapshots() {
  return useQuery({
    queryKey: ["pendingReconcileSnapshots", CLINIC_ID],
    queryFn: async () => {
      const list = await base44.entities.WorkflowSnapshot.filter(
        { clinic_id: CLINIC_ID, status: "closed" },
        "-manager_closed_at",
        100
      );
      return list.filter((s) => !s.reconciled);
    },
    refetchInterval: 15000,
  });
}

export function useRevenueTargets() {
  return useQuery({
    queryKey: ["revenueTargets", CLINIC_ID],
    queryFn: async () => {
      const list = await base44.entities.RevenueTarget.filter({ clinic_id: CLINIC_ID }, "-target_date", 10);
      return list;
    },
    refetchInterval: 60000,
  });
}

export function useAttentionItems() {
  return useQuery({
    queryKey: ["attentionItems", CLINIC_ID],
    queryFn: async () => {
      const list = await base44.entities.AttentionItem.filter({ clinic_id: CLINIC_ID, status: "open" }, "-generated_at", 30);
      return list;
    },
    refetchInterval: 10000,
  });
}

export function useAuditLog(limit = 20) {
  return useQuery({
    queryKey: ["auditLog", CLINIC_ID, limit],
    queryFn: async () => {
      const list = await base44.entities.AuditLog.filter({ clinic_id: CLINIC_ID }, "-timestamp", limit);
      return list;
    },
    refetchInterval: 8000,
  });
}

export function useWorkflowSnapshots(status = "active") {
  return useQuery({
    queryKey: ["workflowSnapshots", CLINIC_ID, status],
    queryFn: async () => {
      const query = status === "all" ? { clinic_id: CLINIC_ID } : { clinic_id: CLINIC_ID, status };
      const list = await base44.entities.WorkflowSnapshot.filter(query, "-generated_at", 20);
      return list;
    },
    refetchInterval: 15000,
  });
}

export function useClinicConfig() {
  return useQuery({
    queryKey: ["clinicConfig", CLINIC_ID],
    queryFn: async () => {
      const list = await base44.entities.ClinicConfig.filter({ clinic_id: CLINIC_ID }, "-updated_date", 1);
      return list[0] || null;
    },
    refetchInterval: 60000,
  });
}

// 派生统计：全院健康评分 + 状态计数
export function deriveHealthScore(sessions, tasks, alerts, inventory) {
  let score = 100;
  // 红色告警 -15/条，黄色 -5/条
  if (alerts) {
    alerts.forEach((a) => { score -= a.urgency === "red" ? 15 : 5; });
  }
  // 候诊卡滞患者 -8/人
  if (sessions) {
    const stalled = sessions.filter((s) => s.status === "stalled").length;
    score -= stalled * 8;
  }
  // 待审批任务堆积 -3/条
  if (tasks) {
    const pending = tasks.filter((t) => t.status === "pending_approval").length;
    score -= pending * 3;
  }
  // 库存低于阈值 -4/项
  if (inventory) {
    const lowStock = inventory.filter((i) => i.below_threshold).length;
    score -= lowStock * 4;
  }
  return Math.max(0, Math.min(100, score));
}

// Phase 2b：孤儿待结案（UndoListItem pending）— 供 AttentionQueue 店长一键 accept_orphan。
export function usePendingUndoItems() {
  return useQuery({
    queryKey: ["pendingUndoItems", CLINIC_ID],
    queryFn: async () => {
      const list = await base44.entities.UndoListItem.filter({ clinic_id: CLINIC_ID, status: "pending" }, "-bounced_at", 30);
      return list;
    },
    refetchInterval: 15000,
  });
}

// 店长判定：ClinicConfig.manager_id 匹配当前 user.id（legacy 直存）或其 Staff.id。
// 与后端 accept_orphan 的 ClinicConfig.manager_id 显式比对口径一致。
export function useIsClinicManager() {
  const { user } = useAuth();
  const { data: config } = useClinicConfig();
  const { data: staffList = [] } = useStaff();
  return useMemo(() => {
    if (!user?.id || !config?.manager_id) return false;
    if (config.manager_id === user.id) return true;
    const myStaff = (staffList || []).find((s) => s.user_id === user.id);
    return !!myStaff && myStaff.id === config.manager_id;
  }, [user, config, staffList]);
}
