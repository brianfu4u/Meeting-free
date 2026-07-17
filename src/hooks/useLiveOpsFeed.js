/**
 * Clinic OS V9 — 中央指挥台实时订阅钩子
 * 1) 订阅 Event Bus 全局事件 → 秒级注入「实时事件流」
 * 2) 订阅实体实时变更 → 即时 invalidate React Query，四维卡片即时刷新（取代 15s 轮询滞后）
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { subscribe } from "@/lib/eventBus";
import { base44 } from "@/api/base44Client";

const STATUS_LABEL = { off_duty: "下班", on_duty: "上班", busy: "忙碌", break: "休息", awaiting_confirm: "待确认" };
const REPORT_LABEL = { new_event: "新事件", progress: "进度汇报", completion: "完成提交" };

// TriggerType → 事件流展示元数据（type/icon 需与 EventStream 的 TYPE_CONFIG/ICON_MAP 对齐）
const TRIGGER_TO_EVENT = {
  STAFF_STATUS_CHANGED: { type: "success", icon: "User", label: "员工打卡" },
  STAFF_REPORT_SUBMITTED: { type: "info", icon: "Zap", label: "员工汇报" },
  NODE_SCANNED: { type: "info", icon: "User", label: "扫码流转" },
  SCAN_GATE_REJECTED: { type: "warning", icon: "AlertTriangle", label: "扫码拦截" },
  TASK_DRAFTED: { type: "info", icon: "Zap", label: "任务草案" },
  TASK_ASSIGNED: { type: "info", icon: "Zap", label: "任务指派" },
  TASK_COMPLETED: { type: "success", icon: "CheckCircle", label: "任务完成" },
  EVIDENCE_SUBMITTED: { type: "info", icon: "CheckCircle", label: "证据提交" },
  EVIDENCE_EVALUATED: { type: "info", icon: "CheckCircle", label: "证据评估" },
  ALERT_TRIGGERED: { type: "warning", icon: "AlertTriangle", label: "告警触发" },
  ALERT_ESCALATED: { type: "critical", icon: "AlertTriangle", label: "告警升级" },
  INVENTORY_BELOW_THRESHOLD: { type: "warning", icon: "Package", label: "库存预警" },
};

// 实体实时变更 → 刷新对应 React Query 聚合卡片
const ENTITY_KEYS = {
  Staff: ["staff"],
  PatientSession: ["patientSessions"],
  OperationalTask: ["tasks"],
  Alert: ["alerts"],
  InventoryItem: ["inventory"],
  RevenueTarget: ["revenueTargets"],
  StaffRequest: ["staffRequests"],
  EvidenceItem: ["evidence"],
};

function formatMessage(event) {
  const p = event.payload || {};
  switch (event.trigger_type) {
    case "STAFF_STATUS_CHANGED":
      return `${p.staff_name || "员工"} 切换为「${STATUS_LABEL[p.new_status] || p.new_status}」`;
    case "STAFF_REPORT_SUBMITTED":
      return `${p.staff_name || "员工"} 提交「${REPORT_LABEL[p.report_type] || p.report_type}」${p.parsed?.summary ? "：" + p.parsed.summary : ""}`;
    case "NODE_SCANNED":
      return `${p.node_name || "节点"} → ${p.new_status || ""}`;
    case "SCAN_GATE_REJECTED":
      return `${p.node_name || ""}：${p.reject_reason || "拦截"}`;
    case "TASK_DRAFTED":
      return `${p.priority || ""}：${p.description || ""}`;
    case "TASK_COMPLETED":
      return `任务 ${p.task_id || ""} 完成`;
    case "EVIDENCE_SUBMITTED":
      return `任务 ${p.task_id || ""} 证据已上传`;
    case "ALERT_TRIGGERED":
    case "ALERT_ESCALATED":
      return `${p.alert_type || ""}${p.urgency ? "（" + p.urgency + "）" : ""}`;
    case "INVENTORY_BELOW_THRESHOLD":
      return `${p.item_name || "物品"} 库存低于阈值`;
    default:
      return event.trigger_type || "系统事件";
  }
}

export function useLiveOpsFeed(onEvent) {
  const qc = useQueryClient();

  useEffect(() => {
    // 1. Event Bus 全局订阅 → 注入事件流
    const unsubBus = subscribe("*", (event) => {
      const meta = TRIGGER_TO_EVENT[event.trigger_type];
      if (!meta) return;
      onEvent({
        id: event.event_id,
        time: new Date(event.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
        type: meta.type,
        icon: meta.icon,
        message: `${meta.label}：${formatMessage(event)}`,
        actionRequired: false,
        awaitConfirm: false,
        real: true,
      });
    });

    // 2. 实体实时订阅 → 即时刷新四维聚合卡片
    const entityUnsubs = Object.keys(ENTITY_KEYS).map((name) => {
      const entity = base44.entities[name];
      if (!entity || typeof entity.subscribe !== "function") return null;
      return entity.subscribe(() => {
        ENTITY_KEYS[name].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      });
    });

    return () => {
      unsubBus();
      entityUnsubs.forEach((u) => u && u());
    };
  }, [onEvent, qc]);
}