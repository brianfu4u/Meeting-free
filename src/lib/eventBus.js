/**
 * Clinic OS V9 — Event Bus 全局数据总线
 * 宪法③：所有 Agent 间通讯必须通过 Event Bus 发布/订阅，严禁内部模块直接耦合。
 * 标准事件包协议：{ EventID, Timestamp, SourceAgent, TriggerType, Payload: { clinic_id, ... } }
 * 所有事件写入 AuditLog 永久留存，实现全链路因果溯源。
 */

import { base44 } from "@/api/base44Client";

// 核心事件类型枚举（TriggerType）
export const TRIGGER_TYPES = {
  PATIENT_ARRIVED: "PATIENT_ARRIVED",
  PATIENT_SEATED: "PATIENT_SEATED",
  NODE_SCANNED: "NODE_SCANNED",
  SCAN_GATE_REJECTED: "SCAN_GATE_REJECTED",
  NODE_STALLED: "NODE_STALLED",
  STAFF_CHECKED_IN: "STAFF_CHECKED_IN",
  STAFF_STATUS_CHANGED: "STAFF_STATUS_CHANGED",
  STAFF_REPORT_SUBMITTED: "STAFF_REPORT_SUBMITTED",
  TASK_DRAFTED: "TASK_DRAFTED",
  TASK_APPROVED: "TASK_APPROVED",
  TASK_ASSIGNED: "TASK_ASSIGNED",
  TASK_COMPLETED: "TASK_COMPLETED",
  EVIDENCE_SUBMITTED: "EVIDENCE_SUBMITTED",
  EVIDENCE_EVALUATED: "EVIDENCE_EVALUATED",
  EVIDENCE_ESCALATED: "EVIDENCE_ESCALATED",
  ALERT_TRIGGERED: "ALERT_TRIGGERED",
  ALERT_ESCALATED: "ALERT_ESCALATED",
  ALERT_RESOLVED: "ALERT_RESOLVED",
  ATTENTION_GENERATED: "ATTENTION_GENERATED",
  ATTENTION_EXECUTED: "ATTENTION_EXECUTED",
  ATTENTION_IGNORED: "ATTENTION_IGNORED",
  MANAGER_DECIDED: "MANAGER_DECIDED",
  PAD_HEARTBEAT_MISSED: "PAD_HEARTBEAT_MISSED",
  INVENTORY_BELOW_THRESHOLD: "INVENTORY_BELOW_THRESHOLD",
  STATION_SCAN_TRIGGERED: "STATION_SCAN_TRIGGERED",
  REPORT_TRIGGERED: "REPORT_TRIGGERED",
  REPORT_GENERATED: "REPORT_GENERATED",
  AGENT_HEALTH_CHANGED: "AGENT_HEALTH_CHANGED",
};

// 三大触发锚点（宪法⑤：无锚点不触发，triggered_by: A1|A2|A3）
export const ANCHOR_TYPES = {
  A1: "A1", // 交叉验证锚点（纠错 / 证据）
  A2: "A2", // 患者路径扫码锚点（流转 / 实时）
  A3: "A3", // 系统逻辑预警锚点（态势 / 预防）
};

// 内存订阅器（前端实时联动）
const subscribers = new Map(); // TriggerType -> Set<callback>

function generateEventId() {
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 发布事件到 Event Bus
 * @param {string} sourceAgent - 发布方 Agent 名称
 * @param {string} triggerType - 事件类型（TRIGGER_TYPES 枚举）
 * @param {object} payload - 业务数据（必须含 clinic_id）
 * @returns {object} 事件包
 */
export async function publish(sourceAgent, triggerType, payload) {
  if (!payload || !payload.clinic_id) {
    throw new Error(`[EventBus] 宪法违规：Payload 必须包含 clinic_id。TriggerType=${triggerType}`);
  }

  // 宪法⑤：事件触发源标签 triggered_by 必须为 A1/A2/A3（若提供则校验，缺失暂不阻断，待 M2/M3 全量补全）
  if (payload.triggered_by && !ANCHOR_TYPES[payload.triggered_by]) {
    throw new Error(`[EventBus] 宪法违规：triggered_by 必须为 A1/A2/A3，实际 ${payload.triggered_by}`);
  }

  const event = {
    event_id: generateEventId(),
    timestamp: new Date().toISOString(),
    source_agent: sourceAgent,
    trigger_type: triggerType,
    payload,
  };

  // 1. 写入 AuditLog 永久留存（宪法级留痕）
  try {
    await base44.entities.AuditLog.create({
      clinic_id: payload.clinic_id,
      event_id: event.event_id,
      timestamp: event.timestamp,
      source_agent: sourceAgent,
      trigger_type: triggerType,
      payload,
    });
  } catch (err) {
    console.error(`[EventBus] AuditLog 写入失败:`, err);
  }

  // 2. 通知内存订阅者（前端实时联动）
  const callbacks = subscribers.get(triggerType);
  if (callbacks) {
    callbacks.forEach((cb) => {
      try {
        cb(event);
      } catch (e) {
        console.error(`[EventBus] 订阅者回调异常:`, e);
      }
    });
  }

  // 3. 通知全局订阅者
  const globalCallbacks = subscribers.get("*");
  if (globalCallbacks) {
    globalCallbacks.forEach((cb) => {
      try {
        cb(event);
      } catch (e) {
        console.error(`[EventBus] 全局订阅者回调异常:`, e);
      }
    });
  }

  return event;
}

/**
 * 订阅事件
 * @param {string} triggerType - 事件类型，或 "*" 订阅全部
 * @param {function} callback - 回调函数，接收事件包
 * @returns {function} 取消订阅函数
 */
export function subscribe(triggerType, callback) {
  if (!subscribers.has(triggerType)) {
    subscribers.set(triggerType, new Set());
  }
  subscribers.get(triggerType).add(callback);

  return () => {
    const set = subscribers.get(triggerType);
    if (set) {
      set.delete(callback);
      if (set.size === 0) subscribers.delete(triggerType);
    }
  };
}

/**
 * 构造标准事件包（供测试或日志预览用）
 */
export function buildEvent(sourceAgent, triggerType, payload) {
  return {
    event_id: generateEventId(),
    timestamp: new Date().toISOString(),
    source_agent: sourceAgent,
    trigger_type: triggerType,
    payload,
  };
}