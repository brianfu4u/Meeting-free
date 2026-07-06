/**
 * Clinic OS V9 — ScanGate 扫码路径准入校验器
 * 宪法③补充：扫码路径必须经 ScanGate 校验 PatientSession 状态后方可流转。
 * 校验规则：节点扫码要求 PatientSession.status 必须为 seated 或 in_progress，
 *   否则拦截并报错，发布 SCAN_GATE_REJECTED 事件，写入 AuditLog。
 */

import { base44 } from "@/api/base44Client";
import { publish, TRIGGER_TYPES } from "./eventBus";

// 三条业务线节点链（与 BusinessLineFlow 实体一致）
export const BUSINESS_LINES = {
  optometry: {
    label: "验光配镜线",
    nodes: ["到店", "就座", "验光叫号", "验光开始", "验光完成", "配镜跟进", "收费结算"],
  },
  medical: {
    label: "眼科医疗线",
    nodes: ["到店", "就座", "诊室叫号", "诊室开始", "检查治疗", "诊室完成", "收费结算"],
  },
  vision_training: {
    label: "视觉训练线",
    nodes: ["到店", "就座", "训练叫号", "训练开始", "阶段检查", "训练完成", "收费结算"],
  },
};

// 节点准入状态要求
const NODE_GATE_RULES = {
  "到店": ["arrived"],           // 到店节点：仅 arrived 状态可扫（创建会话）
  "就座": ["arrived"],           // 就座确认：arrived → seated
  "验光叫号": ["seated", "in_progress"],
  "验光开始": ["seated", "in_progress"],
  "验光完成": ["in_progress"],
  "配镜跟进": ["in_progress"],
  "诊室叫号": ["seated", "in_progress"],
  "诊室开始": ["seated", "in_progress"],
  "检查治疗": ["in_progress"],
  "诊室完成": ["in_progress"],
  "训练叫号": ["seated", "in_progress"],
  "训练开始": ["seated", "in_progress"],
  "阶段检查": ["in_progress"],
  "训练完成": ["in_progress"],
  "收费结算": ["in_progress", "completed"],
};

// 节点流转后的目标状态
const NODE_TRANSITIONS = {
  "到店": "arrived",
  "就座": "seated",
  "验光叫号": "in_progress",
  "验光开始": "in_progress",
  "验光完成": "in_progress",
  "配镜跟进": "in_progress",
  "诊室叫号": "in_progress",
  "诊室开始": "in_progress",
  "检查治疗": "in_progress",
  "诊室完成": "in_progress",
  "训练叫号": "in_progress",
  "训练开始": "in_progress",
  "阶段检查": "in_progress",
  "训练完成": "in_progress",
  "收费结算": "completed",
};

/**
 * ScanGate 准入校验 + 状态机流转
 * @param {string} clinicId - 门店ID
 * @param {string} sessionId - PatientSession ID
 * @param {string} nodeName - 当前扫码节点名
 * @param {string} staffId - 执行扫码员工ID
 * @param {string} qrCode - 扫码内容
 * @returns {object} { passed: boolean, reason?: string, session?: object }
 */
export async function scanGateValidate(clinicId, sessionId, nodeName, staffId, qrCode) {
  let session;
  try {
    session = await base44.entities.PatientSession.get(sessionId);
  } catch (err) {
    return { passed: false, reason: `PatientSession 不存在: ${sessionId}` };
  }

  // 宪法①：ClinicID 物理隔离校验
  if (session.clinic_id !== clinicId) {
    return { passed: false, reason: "宪法违规：跨租户数据访问被拦截（clinic_id 不匹配）" };
  }

  const allowedStatuses = NODE_GATE_RULES[nodeName];
  if (!allowedStatuses) {
    return { passed: false, reason: `未知节点: ${nodeName}，未配置准入规则` };
  }

  // 准入校验
  if (!allowedStatuses.includes(session.status)) {
    const reason = `患者状态为「${session.status}」，节点「${nodeName}」要求状态为「${allowedStatuses.join("或")}」`;
    // 发布 SCAN_GATE_REJECTED 事件（写入 AuditLog）
    await publish("ScanGate", TRIGGER_TYPES.SCAN_GATE_REJECTED, {
      clinic_id: clinicId,
      session_id: sessionId,
      node_name: nodeName,
      staff_id: staffId,
      qr_code: qrCode,
      current_status: session.status,
      required_statuses: allowedStatuses,
      reject_reason: reason,
    });
    return { passed: false, reason, session };
  }

  // 校验通过 → 发布 NODE_SCANNED + 状态机流转
  const newStatus = NODE_TRANSITIONS[nodeName] || session.status;
  const now = new Date().toISOString();
  const scanTimestamps = { ...(session.node_scan_timestamps || {}), [nodeName]: now };

  await base44.entities.PatientSession.update(sessionId, {
    current_node: nodeName,
    status: newStatus,
    node_scan_timestamps: scanTimestamps,
    seated_time: nodeName === "就座" ? now : session.seated_time,
  });

  // 记录 ScanEvent
  await base44.entities.ScanEvent.create({
    clinic_id: clinicId,
    session_id: sessionId,
    qr_code: qrCode,
    node_name: nodeName,
    scan_time: now,
    staff_id: staffId,
    gate_result: "passed",
  });

  // 发布 NODE_SCANNED 事件
  await publish(staffId || "PAD", TRIGGER_TYPES.NODE_SCANNED, {
    clinic_id: clinicId,
    session_id: sessionId,
    node_name: nodeName,
    new_status: newStatus,
    staff_id: staffId,
    qr_code: qrCode,
  });

  return { passed: true, session: { ...session, status: newStatus, current_node: nodeName } };
}