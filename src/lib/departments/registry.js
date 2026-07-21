/**
 * Clinic OS — 眼科诊所部门-岗位-标签-关键词 映射注册表（唯一真理源）
 * 依据《中国标准版眼科诊所：部门/岗位与标签关键词映射规范》v1.2026-07-21
 *
 * 业务族（Business Family）：clinical / non_clinical / fallback
 * 部门（Department）：11 个标准化部门
 * 岗位（Role）：27 个角色
 * 标签（Category）：上传弹窗一级标签（供前端自适应渲染）
 * 关键词（Keywords）：后端 Agent Layer2 关键词加权词库
 *
 * 所有涉及"部门/岗位"的前端与终端注册逻辑均应从此注册表派生，禁止散落硬编码。
 */

export const REGISTRY_VERSION = "v1.2026-07-21";

// ─── 业务族 ────────────────────────────────────────────────────────────
export const BUSINESS_FAMILIES = {
  clinical:     { id: "clinical",     label: "临床与诊疗", color: "#00C7D9" },
  non_clinical: { id: "non_clinical", label: "运营与支持", color: "#16A34A" },
  fallback:     { id: "fallback",     label: "兜底与例外", color: "#D97706" },
};

// ─── 11 个部门定义 ──────────────────────────────────────────────────────
export const DEPARTMENTS = [
  // ═══ 1. 临床与诊疗业务族 ═══
  {
    id: "outpatient",
    code: "01",
    name: "门诊/专科诊室",
    name_en: "Outpatient Clinics",
    family: "clinical",
    roles: [
      { id: "doctor",          label: "医师" },
      { id: "physician_asst",  label: "医师助理" },
    ],
    categories: [
      { id: "clinical_consultation", label: "门诊诊察/病例" },
      { id: "prescription_order",    label: "处方/医嘱" },
    ],
    keywords: [
      "门诊病历", "诊断证明", "医生处方", "病例记录", "主诉",
      "复诊预约单", "术后复查单", "转诊单", "医嘱单", "眼压记录", "裂隙灯检查记录",
    ],
  },
  {
    id: "refraction",
    code: "02",
    name: "视光中心与视觉训练",
    name_en: "Refraction & Vision Training",
    family: "clinical",
    roles: [
      { id: "optometrist",     label: "视光师" },
      { id: "optician",        label: "配镜师" },
      { id: "vision_trainer",  label: "视觉训练师" },
    ],
    categories: [
      { id: "refraction_optometry", label: "验光/屈光检查" },
      { id: "ok_lens_fitting",      label: "OK镜/角膜塑形镜" },
      { id: "vision_therapy",       label: "视觉训练/斜弱视" },
      { id: "glasses_dispensing",    label: "框架镜/隐形配镜" },
    ],
    keywords: [
      "电脑验光单", "主观验光", "综合验光", "生物测量", "角膜地形图",
      "OK镜试戴记录", "角膜塑形镜订单", "视觉功能检查表", "双眼视觉参数",
      "训练处方", "配镜单", "镜片加工单", "瞳距测量", "瞳高测量",
    ],
  },
  {
    id: "diagnostics",
    code: "03",
    name: "特检/医技检查",
    name_en: "Diagnostics & Imaging",
    family: "clinical",
    roles: [
      { id: "imaging_tech",     label: "特检技师" },
      { id: "diagnostic_staff", label: "医技人员" },
    ],
    categories: [
      { id: "ophthalmic_imaging", label: "眼科特检/影像" },
      { id: "lab_test",           label: "化验/实验室检查" },
    ],
    keywords: [
      "OCT", "光学相干断层扫描", "黄斑OCT", "视网膜OCT", "眼底彩照",
      "广角眼底照相", "视野检查", "Humphrey", "Octopus", "UBM",
      "眼超声生物显微镜", "AB超", "泪液分泌测试", "BOT", "干眼分析仪", "眼压曲线",
    ],
  },
  {
    id: "surgery",
    code: "04",
    name: "日间手术室/处置室",
    name_en: "Day Surgery & OR",
    family: "clinical",
    roles: [
      { id: "surgeon",           label: "手术医生" },
      { id: "or_nurse",           label: "手术室护士" },
      { id: "anesthesiologist",  label: "麻醉师" },
    ],
    categories: [
      { id: "surgery_record",   label: "手术记录/知情同意" },
      { id: "intraocular_lens", label: "人工晶体/植入物" },
      { id: "minor_procedure",   label: "注药/处置记录" },
    ],
    keywords: [
      "手术知情同意书", "术前核对单", "麻醉记录单", "手术记录单",
      "玻璃体腔注药单", "飞秒", "全飞秒", "ICL参数表",
      "人工晶体计算单", "IOL", "晶体退货单", "晶体调换单", "消毒供应追溯单",
    ],
  },
  {
    id: "nursing",
    code: "05",
    name: "护理与导诊分诊",
    name_en: "Nursing & Triage",
    family: "clinical",
    roles: [
      { id: "nurse",         label: "护士" },
      { id: "triage_staff",  label: "导诊/分诊人员" },
    ],
    categories: [
      { id: "triage_precheck", label: "导诊/预检" },
      { id: "nursing_care",    label: "护理/冲洗/点药" },
    ],
    keywords: [
      "裸眼视力表", "预检分诊单", "测眼压记录", "泪道冲洗记录",
      "结膜囊冲洗", "散瞳知情同意", "散瞳记录", "皮试记录",
      "体温测量单", "血压测量单",
    ],
  },
  // ═══ 2. 非临床与运营支持业务族 ═══
  {
    id: "front_desk",
    code: "06",
    name: "前台导诊与客户服务",
    name_en: "Front Desk & Customer Service",
    family: "non_clinical",
    roles: [
      { id: "reception",     label: "前台" },
      { id: "crm_staff",     label: "客服/回访专员" },
      { id: "patient_guide", label: "导诊" },
    ],
    categories: [
      { id: "patient_registration", label: "挂号/建档" },
      { id: "followup_crm",         label: "随访/投诉/回访" },
    ],
    keywords: [
      "新建档案表", "挂号小票", "患者满意度问卷", "术后回访记录单",
      "流失患者激活表", "投诉处理单", "会员卡记录", "储值卡记录",
    ],
  },
  {
    id: "marketing",
    code: "07",
    name: "市场渠道与校园筛查",
    name_en: "Marketing & School Screening",
    family: "non_clinical",
    roles: [
      { id: "marketing",        label: "市场专员" },
      { id: "channel_dev",      label: "渠道专员" },
      { id: "screening_team",   label: "筛查队人员" },
    ],
    categories: [
      { id: "school_screening",     label: "入校/入园视力筛查" },
      { id: "mkt_event",             label: "市场活动/义诊" },
      { id: "channel_cooperation",  label: "渠道/转诊合作" },
    ],
    keywords: [
      "校园视力筛查表", "近视防控档案登记簿", "科普讲座签到表",
      "活动核销券", "体验券", "异业合作协议", "筛查回诊卡", "活动费用报销单",
    ],
  },
  {
    id: "finance",
    code: "08",
    name: "财务与医保办",
    name_en: "Finance & Medical Insurance",
    family: "non_clinical",
    roles: [
      { id: "cashier",           label: "出纳/收费员" },
      { id: "insurance_officer",  label: "医保办专员" },
      { id: "accountant",         label: "会计" },
    ],
    categories: [
      { id: "medical_insurance",    label: "医保报销/审核" },
      { id: "retail_invoice",       label: "收费小票/发票" },
      { id: "financial_settlement", label: "对账/退款单" },
    ],
    keywords: [
      "医保结算单", "门诊收费收据", "自费同意书", "镜片零售发票",
      "镜框零售发票", "退费申请单", "日结对账单", "医保扣款通知单",
      "医保审核通知单", "POS刷卡存根",
    ],
  },
  {
    id: "logistics",
    code: "09",
    name: "医疗物资与药房/后勤",
    name_en: "Pharmacy, Supply & Logistics",
    family: "non_clinical",
    roles: [
      { id: "pharmacist",       label: "药师" },
      { id: "equipment_admin", label: "设备/后勤管理员" },
      { id: "inventory_staff",  label: "库管" },
    ],
    categories: [
      { id: "pharmacy_dispensing", label: "药品调配/发药" },
      { id: "supply_purchase",     label: "耗材/晶体/镜片采购" },
      { id: "facility_repair",     label: "设备维修/计量校准" },
    ],
    keywords: [
      "处方领药单", "麻精药品登记簿", "镜片入库单", "晶体盘点表",
      "验光仪校准报告", "裂隙灯校准报告", "设备报修单", "消杀记录表",
      "医疗废弃物转运单",
    ],
  },
  {
    id: "admin",
    code: "10",
    name: "行政与质量监督",
    name_en: "Admin & Quality Assurance",
    family: "non_clinical",
    roles: [
      { id: "clinic_director",   label: "院长/诊所经理" },
      { id: "qa_officer",         label: "质控专员" },
      { id: "sanitation_staff",  label: "院感员" },
    ],
    categories: [
      { id: "admin_inspection", label: "行政/卫生监督" },
      { id: "quality_control",  label: "医疗质控/院感" },
    ],
    keywords: [
      "卫生监督检查单", "消防整改单", "医疗废弃物转运单",
      "执业人员变更申请", "质量考核记录", "院感抽检报告",
    ],
  },
  // ═══ 3. 兜底与例外 ═══
  {
    id: "supplemental",
    code: "11",
    name: "兜底与特殊上下文",
    name_en: "Supplemental & Exception Context",
    family: "fallback",
    roles: [], // 全员通用，无专属岗位
    categories: [
      { id: "other_supplemental", label: "其他补充（代理录入/追溯标记）" },
    ],
    keywords: [
      "手写备注文本", "外院病历带入", "临时补充说明", "语音转文字短评",
    ],
    flags: {
      is_proxy: "代传：如前台帮扫医生的纸质处方",
      is_retroactive: "补传：补录历史档案",
    },
  },
];

// ─── 派生索引（供前端/后端快速查询） ──────────────────────────────────

/** 全部岗位列表（扁平） */
export const ALL_ROLES = DEPARTMENTS.flatMap((d) =>
  d.roles.map((r) => ({ ...r, department_id: d.id, family: d.family }))
);

/** 岗位ID → 中文标签 */
export const ROLE_LABELS = Object.fromEntries(
  ALL_ROLES.map((r) => [r.id, r.label])
);

/** 岗位ID → 所属业务族（clinical / non_clinical） */
export const ROLE_GROUPS = Object.fromEntries(
  ALL_ROLES.map((r) => [r.id, r.family])
);

/** 岗位ID → 所属部门ID */
export const ROLE_TO_DEPARTMENT = Object.fromEntries(
  ALL_ROLES.map((r) => [r.id, r.department_id])
);

/** 部门ID → 部门对象 */
export const DEPARTMENT_BY_ID = Object.fromEntries(
  DEPARTMENTS.map((d) => [d.id, d])
);

/** 业务族ID → 该族下的部门列表 */
export const DEPARTMENTS_BY_FAMILY = DEPARTMENTS.reduce((acc, d) => {
  (acc[d.family] = acc[d.family] || []).push(d);
  return acc;
}, {});

/**
 * 根据岗位ID获取上传弹窗应展示的一级标签（Category）列表。
 * 兜底部门（supplemental）的标签对所有岗位可见。
 * @param {string} roleId
 * @returns {Array<{id:string,label:string}>}
 */
export function getCategoriesForRole(roleId) {
  const deptId = ROLE_TO_DEPARTMENT[roleId];
  const dept = deptId ? DEPARTMENT_BY_ID[deptId] : null;
  const fallback = DEPARTMENT_BY_ID["supplemental"];
  if (!dept) return fallback ? fallback.categories : [];
  // 本部门标签 + 兜底标签（"其他补充"始终可选）
  const merged = [...dept.categories];
  if (fallback && !merged.some((c) => c.id === "other_supplemental")) {
    merged.push(...fallback.categories);
  }
  return merged;
}

/**
 * 根据岗位ID获取后端关键词加权词库（本部门 + 兜底）。
 * @param {string} roleId
 * @returns {string[]}
 */
export function getKeywordsForRole(roleId) {
  const deptId = ROLE_TO_DEPARTMENT[roleId];
  const dept = deptId ? DEPARTMENT_BY_ID[deptId] : null;
  const fallback = DEPARTMENT_BY_ID["supplemental"];
  const kw = dept ? [...dept.keywords] : [];
  if (fallback) kw.push(...fallback.keywords);
  return kw;
}

/** 获取部门完整定义（含标签/关键词），供配置页/弹窗使用 */
export function getDepartment(deptId) {
  return DEPARTMENT_BY_ID[deptId] || null;
}