/**
 * Clinic OS V9 M2 — 实时态势数据钩子
 * 宪法①：所有查询强制携带 clinic_id，禁止无隔离的全量读取。
 * 基于 React Query 自动轮询刷新，驱动看板实时联动。
 */

import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

export const CLINIC_ID = "clinic-001";
const POLL_MS = 15000;

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
      const list = await base44.entities.InventoryItem.filter({ clinic_id: CLINIC_ID }, "-updated_date", 50);
      return list;
    },
    refetchInterval: 30000,
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