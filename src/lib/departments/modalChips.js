/**
 * Clinic OS — 弹窗人工标签 Chip 配置（11 部门自适应）
 * 依据《眼科诊所部门-岗位映射规范》+ 店长确认的中文标签标准。
 *
 * 数据源分层：
 * - 部门/岗位归属 → registry.js（唯一真理源）
 * - Chip 标签文案 → 本文件（modal 专用展示层）
 *
 * 每个部门的 chips 第一个 is_default:true 为预高亮项。
 * "其他xx补充" 始终作为兜底选项，id 统一前缀 other_。
 */

import { ROLE_TO_DEPARTMENT } from "./registry";

export const MODAL_CHIPS_BY_DEPARTMENT = {
  outpatient: {
    role_name: "门诊/专科诊室",
    chips: [
      { id: "clinical_consultation", label: "门诊诊察/病例", is_default: true },
      { id: "prescription_order", label: "处方/医嘱" },
      { id: "other_clinical", label: "其他临床补充" },
    ],
  },
  refraction: {
    role_name: "验光师/检查科",
    chips: [
      { id: "refraction_optometry", label: "验光/预检", is_default: true },
      { id: "visual_field", label: "视野/双眼视觉" },
      { id: "oct_imaging", label: "眼底照相/OCT" },
      { id: "other_clinical", label: "其他临床补充" },
    ],
  },
  diagnostics: {
    role_name: "特检/医技检查",
    chips: [
      { id: "ophthalmic_imaging", label: "眼底照相/OCT", is_default: true },
      { id: "lab_test", label: "化验/实验室检查" },
      { id: "other_clinical", label: "其他临床补充" },
    ],
  },
  surgery: {
    role_name: "日间手术室/处置室",
    chips: [
      { id: "surgery_record", label: "手术记录/知情同意", is_default: true },
      { id: "intraocular_lens", label: "人工晶体/植入物" },
      { id: "minor_procedure", label: "注药/处置记录" },
      { id: "other_clinical", label: "其他临床补充" },
    ],
  },
  nursing: {
    role_name: "护理与导诊分诊",
    chips: [
      { id: "triage_precheck", label: "导诊/预检", is_default: true },
      { id: "nursing_care", label: "护理/冲洗/点药" },
      { id: "other_clinical", label: "其他临床补充" },
    ],
  },
  front_desk: {
    role_name: "前台导诊与客户服务",
    chips: [
      { id: "patient_registration", label: "挂号/建档", is_default: true },
      { id: "followup_crm", label: "随访/投诉/回访" },
      { id: "other_supplemental", label: "其他补充" },
    ],
  },
  marketing: {
    role_name: "市场部/企划",
    chips: [
      { id: "mkt_event", label: "活动/地推资料", is_default: true },
      { id: "mkt_ad_invoice", label: "投放/宣传请款" },
      { id: "channel_cooperation", label: "渠道合作协议" },
      { id: "other_mkt", label: "其他市场补充" },
    ],
  },
  finance: {
    role_name: "财务与医保办",
    chips: [
      { id: "medical_insurance", label: "医保报销/审核", is_default: true },
      { id: "retail_invoice", label: "收费小票/发票" },
      { id: "financial_settlement", label: "对账/退款单" },
      { id: "other_supplemental", label: "其他补充" },
    ],
  },
  logistics: {
    role_name: "后勤行政部",
    chips: [
      { id: "facility_repair", label: "设备/报修单据", is_default: true },
      { id: "supplies_procure", label: "耗材/行政采购" },
      { id: "lease_utility", label: "水电气/房租账单" },
      { id: "other_admin", label: "其他行政补充" },
    ],
  },
  admin: {
    role_name: "行政与质量监督",
    chips: [
      { id: "admin_inspection", label: "行政/卫生监督", is_default: true },
      { id: "quality_control", label: "医疗质控/院感" },
      { id: "other_admin", label: "其他行政补充" },
    ],
  },
  supplemental: {
    role_name: "其他部门",
    chips: [
      { id: "other_supplemental", label: "其他补充（代理录入/追溯标记）", is_default: true },
    ],
  },
};

/**
 * 根据岗位 ID 获取该岗位弹窗应展示的 chips（本部门 + 兜底）。
 * @param {string} roleId  岗位 ID（来自 registry ALL_ROLES）
 * @returns {{role_name:string, chips:Array<{id:string,label:string,is_default?:boolean}>}}
 */
export function getChipsForRole(roleId) {
  const deptId = ROLE_TO_DEPARTMENT[roleId] || "supplemental";
  const cfg = MODAL_CHIPS_BY_DEPARTMENT[deptId] || MODAL_CHIPS_BY_DEPARTMENT.supplemental;
  return { role_name: cfg.role_name, chips: cfg.chips };
}

/**
 * 根据部门 ID 直接取 chips（供 BindingScreen 等场景使用）。
 */
export function getChipsForDepartment(deptId) {
  const cfg = MODAL_CHIPS_BY_DEPARTMENT[deptId] || MODAL_CHIPS_BY_DEPARTMENT.supplemental;
  return { role_name: cfg.role_name, chips: cfg.chips };
}