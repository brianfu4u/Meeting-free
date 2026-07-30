/**
 * Clinic OS V9 M2 — 实时态势数据钩子
 * 宪法①：所有查询强制携带 clinic_id，禁止无隔离的全量读取。
 * 基于 React Query 自动轮询刷新，驱动看板实时联动。
 *
 * 静态托管时 /api 常返回 HTML：SDK 可能给出非数组结果，统一用 asList 兜底，避免 .filter 崩溃。
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { resolveRuntimeClinicId } from "@/lib/runtimeClinicScope";

export const CLINIC_ID = resolveRuntimeClinicId();
const POLL_MS = 15000;

/** Normalize entity list responses (HTML/object/null → []). */
export function asList(value) {
  return Array.isArray(value) ? value : [];
}

async function fetchList(promise) {
  try {
    return asList(await promise);
  } catch (err) {
    console.warn("[useClinicData] entity list failed:", err?.message || err);
    return [];
  }
}

function todayBusinessDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// 收银台解析结果：今日收款事实卡（金额 / 收费类目来源）
export function usePaymentFactCards() {
  return useQuery({
    queryKey: ["paymentFactCards", CLINIC_ID],
    queryFn: () =>
      fetchList(
        base44.entities.EvidenceFactCard.filter(
          { clinic_id: CLINIC_ID, business_date: todayBusinessDate(), workflow_family_hint: "payment" },
          "-extracted_at",
          100
        )
      ),
    refetchInterval: POLL_MS,
  });
}

// 挂号单解析结果：今日来院患者登记事实卡（就诊目的来源）
export function useRegistrationFactCards() {
  return useQuery({
    queryKey: ["registrationFactCards", CLINIC_ID],
    queryFn: () =>
      fetchList(
        base44.entities.EvidenceFactCard.filter(
          { clinic_id: CLINIC_ID, business_date: todayBusinessDate(), workflow_family_hint: "patient_registration" },
          "-extracted_at",
          100
        )
      ),
    refetchInterval: POLL_MS,
  });
}

export function usePatientSessions() {
  return useQuery({
    queryKey: ["patientSessions", CLINIC_ID],
    queryFn: () => fetchList(base44.entities.PatientSession.filter({ clinic_id: CLINIC_ID }, "-arrival_time", 50)),
    refetchInterval: POLL_MS,
  });
}

export function useStaff() {
  return useQuery({
    queryKey: ["staff", CLINIC_ID],
    queryFn: () => fetchList(base44.entities.Staff.filter({ clinic_id: CLINIC_ID }, "-checked_in_at", 50)),
    refetchInterval: POLL_MS,
  });
}

export function useOperationalTasks() {
  return useQuery({
    queryKey: ["tasks", CLINIC_ID],
    queryFn: () => fetchList(base44.entities.OperationalTask.filter({ clinic_id: CLINIC_ID }, "-created_date", 50)),
    refetchInterval: POLL_MS,
  });
}

export function useAlerts() {
  return useQuery({
    queryKey: ["alerts", CLINIC_ID],
    queryFn: () =>
      fetchList(base44.entities.Alert.filter({ clinic_id: CLINIC_ID, status: "triggered" }, "-created_at", 30)),
    refetchInterval: POLL_MS,
  });
}

export function useInventory() {
  return useQuery({
    queryKey: ["inventory", CLINIC_ID],
    queryFn: () => fetchList(base44.entities.InventoryItem.filter({ clinic_id: CLINIC_ID }, "-updated_date", 100)),
    refetchInterval: 30000,
  });
}

// 今日特检报告单据（来源 diagnostics 部门）。每张单据算一次设备使用。
export function useExamReportFactCards() {
  return useQuery({
    queryKey: ["examReportFactCards", CLINIC_ID],
    queryFn: async () => {
      const today = todayBusinessDate();
      const [cards, artifacts] = await Promise.all([
        fetchList(base44.entities.EvidenceFactCard.filter({ clinic_id: CLINIC_ID, business_date: today }, "-extracted_at", 200)),
        fetchList(base44.entities.Artifact.filter({ clinic_id: CLINIC_ID, business_date: today }, "-created_date", 200)),
      ]);
      const regionByArt = {};
      for (const a of artifacts) regionByArt[a.id] = a.source_region;
      return cards.filter((c) => regionByArt[c.artifact_id] === "diagnostics");
    },
    refetchInterval: POLL_MS,
  });
}

// V10.1 已闭环但尚未核销入库的工作流快照
export function usePendingReconcileSnapshots() {
  return useQuery({
    queryKey: ["pendingReconcileSnapshots", CLINIC_ID],
    queryFn: async () => {
      const list = await fetchList(
        base44.entities.WorkflowSnapshot.filter({ clinic_id: CLINIC_ID, status: "closed" }, "-manager_closed_at", 100)
      );
      return list.filter((s) => !s.reconciled);
    },
    refetchInterval: 15000,
  });
}

export function useRevenueTargets() {
  return useQuery({
    queryKey: ["revenueTargets", CLINIC_ID],
    queryFn: () => fetchList(base44.entities.RevenueTarget.filter({ clinic_id: CLINIC_ID }, "-target_date", 10)),
    refetchInterval: 60000,
  });
}

export function useAttentionItems() {
  return useQuery({
    queryKey: ["attentionItems", CLINIC_ID],
    queryFn: () =>
      fetchList(base44.entities.AttentionItem.filter({ clinic_id: CLINIC_ID, status: "open" }, "-generated_at", 30)),
    refetchInterval: 10000,
  });
}

export function useAuditLog(limit = 20) {
  return useQuery({
    queryKey: ["auditLog", CLINIC_ID, limit],
    queryFn: () => fetchList(base44.entities.AuditLog.filter({ clinic_id: CLINIC_ID }, "-timestamp", limit)),
    refetchInterval: 8000,
  });
}

export function useWorkflowSnapshots(status = "active") {
  return useQuery({
    queryKey: ["workflowSnapshots", CLINIC_ID, status],
    queryFn: () => {
      const query = status === "all" ? { clinic_id: CLINIC_ID } : { clinic_id: CLINIC_ID, status };
      return fetchList(base44.entities.WorkflowSnapshot.filter(query, "-generated_at", 20));
    },
    refetchInterval: 15000,
  });
}

export function useClinicConfig() {
  return useQuery({
    queryKey: ["clinicConfig", CLINIC_ID],
    queryFn: async () => {
      const list = await fetchList(base44.entities.ClinicConfig.filter({ clinic_id: CLINIC_ID }, "-updated_date", 1));
      return list[0] || null;
    },
    refetchInterval: 60000,
  });
}

// 派生统计：全院健康评分 + 状态计数
export function deriveHealthScore(sessions, tasks, alerts, inventory) {
  let score = 100;
  const alertList = asList(alerts);
  const sessionList = asList(sessions);
  const taskList = asList(tasks);
  const inventoryList = asList(inventory);

  alertList.forEach((a) => {
    score -= a.urgency === "red" ? 15 : 5;
  });
  score -= sessionList.filter((s) => s.status === "stalled").length * 8;
  score -= taskList.filter((t) => t.status === "pending_approval").length * 3;
  score -= inventoryList.filter((i) => i.below_threshold).length * 4;
  return Math.max(0, Math.min(100, score));
}

export function usePendingUndoItems() {
  return useQuery({
    queryKey: ["pendingUndoItems", CLINIC_ID],
    queryFn: () =>
      fetchList(base44.entities.UndoListItem.filter({ clinic_id: CLINIC_ID, status: "pending" }, "-bounced_at", 30)),
    refetchInterval: 15000,
  });
}

export function useIsClinicManager() {
  const { user } = useAuth();
  const { data: config } = useClinicConfig();
  const { data: staffList } = useStaff();
  return useMemo(() => {
    if (!user?.id || !config?.manager_id) return false;
    if (config.manager_id === user.id) return true;
    const myStaff = asList(staffList).find((s) => s.user_id === user.id);
    return !!myStaff && myStaff.id === config.manager_id;
  }, [user, config, staffList]);
}
