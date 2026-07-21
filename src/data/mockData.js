// Mock data for 今天我来当店长 — Optometry Clinic Operations Dashboard
// 看板对齐 Clinic OS 11 部门规范（src/lib/departments/registry.js）
// 18 物理区域阵列已重排为 11 个标准化部门面板，按 3 业务族分组。

export const CLINIC_NAME = "明视眼科诊所";

// ─── 员工示例（展示用，可被实体库实时数据覆盖） ─────────────────────────────
export const STAFF = {
  manager:    { id: "L",  name: "院长L",     role: "clinic_director", department_id: "admin",      status: "在岗",  area: "行政与质量监督" },
  doctorD:    { id: "D",  name: "眼科医生D", role: "doctor",          department_id: "outpatient", status: "诊疗中",area: "门诊/专科诊室" },
  doctorD2:   { id: "D2", name: "眼科医生D2",role: "surgeon",         department_id: "surgery",    status: "诊疗中",area: "日间手术室" },
  optU:       { id: "U",  name: "视光师U",   role: "optometrist",     department_id: "refraction", status: "忙碌",  area: "视光中心" },
  optV:       { id: "V",  name: "视光师V",   role: "optometrist",     department_id: "refraction", status: "忙碌",  area: "视光中心" },
  optW:       { id: "W",  name: "视光师W",   role: "vision_trainer",  department_id: "refraction", status: "忙碌",  area: "视觉训练" },
  optX:       { id: "X",  name: "视光师X",   role: "optician",        department_id: "refraction", status: "空闲",  area: "配镜区" },
  imgT:       { id: "T2", name: "特检技师T2",role: "imaging_tech",    department_id: "diagnostics",status: "忙碌",  area: "特检/医技" },
  nurseN1:    { id: "N1", name: "护士长N1",  role: "nurse",           department_id: "nursing",     status: "在岗",  area: "导诊分诊" },
  nurseN2:    { id: "N2", name: "护士N2",    role: "nurse",           department_id: "nursing",     status: "忙碌",  area: "护理/处置" },
  nurseN3:    { id: "N3", name: "护士N3",    role: "nurse",           department_id: "nursing",     status: "忙碌",  area: "病房" },
  emergencyE: { id: "E",  name: "急救护士E", role: "nurse",           department_id: "nursing",     status: "待命",  area: "急救待命" },
  frontR:     { id: "R",  name: "前台R",     role: "reception",       department_id: "front_desk", status: "忙碌",  area: "前台导诊" },
  frontR2:    { id: "R2", name: "前台R2",    role: "crm_staff",       department_id: "front_desk", status: "忙碌",  area: "客户服务" },
  marketM:    { id: "M",  name: "市场M",     role: "marketing",       department_id: "marketing", status: "外出",  area: "渠道拓展" },
  onlineO1:   { id: "O1", name: "线上运营O1",role: "channel_dev",     department_id: "marketing", status: "在岗",  area: "线上渠道" },
  cashierC:   { id: "C",  name: "出纳C",     role: "cashier",          department_id: "finance",   status: "忙碌",  area: "收费/结算" },
  financeF:   { id: "F",  name: "财务F",     role: "accountant",       department_id: "finance",   status: "在岗",  area: "财务/医保" },
  purchaseJ:  { id: "J",  name: "采购J",     role: "inventory_staff",  department_id: "logistics", status: "在岗",  area: "医疗物资" },
  logisticsA: { id: "A",  name: "后勤A",     role: "equipment_admin",  department_id: "logistics", status: "在岗",  area: "设备/后勤" },
  logisticsA2:{ id: "A2", name: "库管A2",    role: "inventory_staff",  department_id: "logistics", status: "在岗",  area: "库房" },
  pharmaK:    { id: "K",  name: "药师K",     role: "pharmacist",       department_id: "logistics", status: "在岗",  area: "药房" },
  qaQ:       { id: "Q",  name: "质控Q",     role: "qa_officer",       department_id: "admin",     status: "在岗",  area: "质控/院感" },
  itT:       { id: "T",  name: "IT保障T",   role: "clinic_director", department_id: "admin",     status: "远程",  area: "信息中心" },
};

// ─── 11 部门面板数据 ────────────────────────────────────────────────────────────

export const INITIAL_PANELS = {

  // ═══ 1. 临床与诊疗业务族 ═══

  // 01 门诊/专科诊室
  outpatient: {
    id: "outpatient",
    title: "门诊/专科诊室",
    icon: "Stethoscope",
    status: "amber",
    zoneCode: "01",
    family: "clinical",
    metrics: [
      { label: "今日门诊量", value: "29", unit: "人" },
      { label: "诊室占用", value: "3", unit: "间" },
      { label: "候诊超时", value: "2", unit: "人" },
      { label: "平均诊时", value: "11", unit: "分钟" },
    ],
    liveNote: "医生D连续工作3.5小时，候诊区有2人超时",
    detail: {
      subMetrics: [
        { label: "诊室1（医生D）", value: "使用中" },
        { label: "诊室2", value: "空闲" },
        { label: "诊室3", value: "清洁中" },
        { label: "今日目标门诊", value: "40人" },
        { label: "完成进度", value: "72.5%" },
        { label: "待复核病例", value: "5例" },
      ],
      staffInvolved: ["眼科医生D", "护士长N1"],
      alerts: ["医生D已连续工作3.5小时，建议11:30安排短暂休息", "诊室3清洁约10分钟后可用"],
    },
  },

  // 02 视光中心与视觉训练
  refraction: {
    id: "refraction",
    title: "视光中心与视觉训练",
    icon: "Glasses",
    status: "red",
    zoneCode: "02",
    family: "clinical",
    metrics: [
      { label: "验光等待", value: "14", unit: "人" },
      { label: "平均等待", value: "28", unit: "分钟" },
      { label: "今日配镜", value: "8", unit: "单" },
      { label: "训练人次", value: "11", unit: "人" },
    ],
    liveNote: "⚠️ 验光拥堵超阈值，配镜师X空闲待调配支援",
    detail: {
      subMetrics: [
        { label: "验光区1（视光师U）", value: "高负荷" },
        { label: "验光区2（视光师V）", value: "高负荷" },
        { label: "视觉训练（视光师W）", value: "进行中" },
        { label: "配镜区（配镜师X）", value: "空闲" },
        { label: "最长等待", value: "52分钟" },
        { label: "今日配镜成交", value: "8单 / ¥12,400" },
      ],
      staffInvolved: ["视光师U", "视光师V", "视光师W", "配镜师X"],
      alerts: ["验光均值超阈值8分钟", "配镜师X空闲20分钟，建议调配支援验光", "儿童视觉训练下午5人预约"],
    },
  },

  // 03 特检/医技检查
  diagnostics: {
    id: "diagnostics",
    title: "特检/医技检查",
    icon: "Microscope",
    status: "amber",
    zoneCode: "03",
    family: "clinical",
    metrics: [
      { label: "特检等待", value: "6", unit: "人" },
      { label: "设备利用率", value: "82", unit: "%" },
      { label: "今日完成", value: "21", unit: "例" },
      { label: "报告待出", value: "4", unit: "份" },
    ],
    liveNote: "OCT与眼底照相高负荷，4份报告待出具",
    detail: {
      subMetrics: [
        { label: "OCT设备", value: "使用中" },
        { label: "眼底照相", value: "使用中" },
        { label: "视野检查", value: "空闲" },
        { label: "UBM/AB超", value: "空闲" },
        { label: "干眼分析", value: "待维护" },
        { label: "最长等待", value: "18分钟" },
      ],
      staffInvolved: ["特检技师T2"],
      alerts: ["干眼分析仪需今日校准，建议联系后勤A", "4份特检报告需在12:00前出具"],
    },
  },

  // 04 日间手术室/处置室
  surgery: {
    id: "surgery",
    title: "日间手术室/处置室",
    icon: "Syringe",
    status: "green",
    zoneCode: "04",
    family: "clinical",
    metrics: [
      { label: "今日手术", value: "2", unit: "台" },
      { label: "当前状态", value: "空闲", unit: "" },
      { label: "下台手术", value: "14:30", unit: "" },
      { label: "设备就绪率", value: "100", unit: "%" },
    ],
    liveNote: "上午手术已完成，下午14:30一台白内障手术",
    detail: {
      subMetrics: [
        { label: "白内障手术", value: "1台（已完成）" },
        { label: "翼状胬肉切除", value: "1台（已完成）" },
        { label: "下午手术", value: "白内障 ×1（14:30）" },
        { label: "手术室消毒", value: "已完成" },
        { label: "器械就绪", value: "100%" },
        { label: "麻醉师确认", value: "已到位" },
      ],
      staffInvolved: ["眼科医生D2", "护士长N1", "护士N2"],
      alerts: ["14:30手术前需提前30分钟完成患者准备工作"],
    },
  },

  // 05 护理与导诊分诊
  nursing: {
    id: "nursing",
    title: "护理与导诊分诊",
    icon: "HeartPulse",
    status: "green",
    zoneCode: "05",
    family: "clinical",
    metrics: [
      { label: "今日预诊分流", value: "41", unit: "人" },
      { label: "当前在治", value: "3", unit: "人" },
      { label: "床位占用", value: "50", unit: "%" },
      { label: "急救待命", value: "就绪", unit: "" },
    ],
    liveNote: "分流顺畅，护理与病房运行平稳，急救待命",
    detail: {
      subMetrics: [
        { label: "分流准确率", value: "96%" },
        { label: "治疗区占用", value: "2间" },
        { label: "住院人数", value: "4人" },
        { label: "今日出院", value: "1人" },
        { label: "急救设备", value: "已检测/正常" },
        { label: "用药执行", value: "准时" },
      ],
      staffInvolved: ["护士长N1", "护士N2", "护士N3", "急救护士E"],
      alerts: ["14:00有2名术后患者需复查用药，护士N3请提前准备"],
    },
  },

  // ═══ 2. 非临床与运营支持业务族 ═══

  // 06 前台导诊与客户服务
  front_desk: {
    id: "front_desk",
    title: "前台导诊与客户服务",
    icon: "ConciergeBell",
    status: "amber",
    zoneCode: "06",
    family: "non_clinical",
    metrics: [
      { label: "今日到诊", value: "47", unit: "人" },
      { label: "当前排队", value: "7", unit: "人" },
      { label: "平均等待", value: "12", unit: "分钟" },
      { label: "爽约未到", value: "8", unit: "人" },
    ],
    liveNote: "到诊高峰，前台双人接待中，队伍稍长",
    detail: {
      subMetrics: [
        { label: "今日预约总数", value: "55人" },
        { label: "已完成登记", value: "47人" },
        { label: "新患者占比", value: "31%" },
        { label: "复诊患者", value: "32人" },
        { label: "电话接听", value: "23通" },
        { label: "待补全档案", value: "3份" },
      ],
      staffInvolved: ["前台R", "前台R2"],
      alerts: ["当前排队7人，建议开启自助签到屏分流", "有3位预约患者超时未到，建议电话确认"],
    },
  },

  // 07 市场渠道与校园筛查
  marketing: {
    id: "marketing",
    title: "市场渠道与校园筛查",
    icon: "Megaphone",
    status: "green",
    zoneCode: "07",
    family: "non_clinical",
    metrics: [
      { label: "今日新线索", value: "18", unit: "条" },
      { label: "预约转化率", value: "61", unit: "%" },
      { label: "线上咨询", value: "34", unit: "条" },
      { label: "筛查活动", value: "2", unit: "项" },
    ],
    liveNote: "线上转化良好，市场M外出拓展，O1驻守",
    detail: {
      subMetrics: [
        { label: "微信公众号线索", value: "11条" },
        { label: "小红书线索", value: "8条" },
        { label: "美团到访", value: "6人" },
        { label: "自然客流", value: "3人" },
        { label: "未回复咨询", value: "2条 ⚠️" },
        { label: "暑期护眼季活动", value: "核销11单" },
      ],
      staffInvolved: ["市场M", "线上运营O1"],
      alerts: ["小红书2条咨询超1小时未回复，请立即跟进", "市场M外出，预计12:30返回"],
    },
  },

  // 08 财务与医保办
  finance: {
    id: "finance",
    title: "财务与医保办",
    icon: "CircleDollarSign",
    status: "green",
    zoneCode: "08",
    family: "non_clinical",
    metrics: [
      { label: "今日营收", value: "¥34,820", unit: "" },
      { label: "待结算", value: "¥6,200", unit: "" },
      { label: "医保待审", value: "3", unit: "份" },
      { label: "月度达成", value: "78", unit: "%" },
    ],
    liveNote: "收款进度正常，完成目标85%，医保3份待审",
    detail: {
      subMetrics: [
        { label: "今日营收目标", value: "¥41,000" },
        { label: "检查收入", value: "¥18,200" },
        { label: "配镜收入", value: "¥12,400" },
        { label: "药品收入", value: "¥4,220" },
        { label: "待结算保险", value: "¥3,800" },
        { label: "本月净利润", value: "¥88,200" },
      ],
      dailyRevenue: [4200, 6800, 8100, 9200, 34820],
      staffInvolved: ["出纳C", "财务F"],
      alerts: ["医保结算单3份需在本周五前提交", "退款申请1单需财务F在2小时内处理"],
    },
  },

  // 09 医疗物资与药房/后勤
  logistics: {
    id: "logistics",
    title: "医疗物资与药房/后勤",
    icon: "Warehouse",
    status: "amber",
    zoneCode: "09",
    family: "non_clinical",
    metrics: [
      { label: "库存预警", value: "2", unit: "项" },
      { label: "今日出库", value: "38", unit: "件" },
      { label: "待收货", value: "1", unit: "单" },
      { label: "设施状态", value: "正常", unit: "" },
    ],
    liveNote: "渐变镜片库存临近低位，补货单已在途",
    detail: {
      subMetrics: [
        { label: "近视镜片", value: "142片 ⚠️" },
        { label: "渐变镜片", value: "23片 ⚠️" },
        { label: "镜框", value: "充足（>200副）" },
        { label: "药品库存", value: "充足" },
        { label: "预计到货", value: "今日14:00" },
        { label: "设备校准", value: "待排期" },
      ],
      staffInvolved: ["库管A2", "采购J", "后勤A", "药师K"],
      alerts: ["渐变镜片仅剩23片，已发起补货", "干眼分析仪需校准，请后勤A排期"],
    },
  },

  // 10 行政与质量监督
  admin: {
    id: "admin",
    title: "行政与质量监督",
    icon: "ShieldCheck",
    status: "amber",
    zoneCode: "10",
    family: "non_clinical",
    metrics: [
      { label: "全院健康评分", value: "78", unit: "/100" },
      { label: "待决策事项", value: "3", unit: "项" },
      { label: "在岗人数", value: "22", unit: "人" },
      { label: "系统在线率", value: "99.8", unit: "%" },
    ],
    liveNote: "视光中心拥堵需处置，其余部门运行正常",
    detail: {
      subMetrics: [
        { label: "紧急部门数", value: "1个（视光）" },
        { label: "注意部门数", value: "4个" },
        { label: "正常部门数", value: "6个" },
        { label: "今日营收进度", value: "85%（¥34,820）" },
        { label: "患者满意度", value: "4.7/5" },
        { label: "质控抽检", value: "本周1次" },
      ],
      staffInvolved: ["院长L", "质控Q", "IT保障T"],
      alerts: ["视光中心拥堵需立即处置 [紧急]", "下午手术14:30需提前30分钟准备", "质控Q本周需完成院感抽检"],
    },
  },

  // ═══ 3. 兜底与例外 ═══

  // 11 兜底与特殊上下文
  supplemental: {
    id: "supplemental",
    title: "兜底与特殊上下文",
    icon: "Boxes",
    status: "green",
    zoneCode: "11",
    family: "fallback",
    metrics: [
      { label: "代传碎片", value: "3", unit: "条" },
      { label: "补传记录", value: "1", unit: "条" },
      { label: "待对齐", value: "2", unit: "条" },
      { label: "异常碎片", value: "0", unit: "条" },
    ],
    liveNote: "兜底通道正常，代传/补传均已留痕可追溯",
    detail: {
      subMetrics: [
        { label: "前台代传处方", value: "2条" },
        { label: "导诊代传预检", value: "1条" },
        { label: "补传历史档案", value: "1条" },
        { label: "待 LLM 对齐", value: "2条" },
        { label: "驳回/异常", value: "0条" },
        { label: "溯源标记完整率", value: "100%" },
      ],
      staffInvolved: ["前台R", "护士长N1"],
      alerts: ["2条兜底碎片需店长确认归属部门后再对齐"],
    },
  },
};

// 3 业务族分组（与 registry.js BUSINESS_FAMILIES 对齐）
export const PANEL_GROUPS = [
  {
    groupId: "clinical",
    groupLabel: "临床与诊疗",
    groupColor: "#00C7D9",
    panels: ["outpatient", "refraction", "diagnostics", "surgery", "nursing"],
  },
  {
    groupId: "non_clinical",
    groupLabel: "运营与支持",
    groupColor: "#16A34A",
    panels: ["front_desk", "marketing", "finance", "logistics", "admin"],
  },
  {
    groupId: "fallback",
    groupLabel: "兜底与例外",
    groupColor: "#D97706",
    panels: ["supplemental"],
  },
];

// 兼容平铺顺序
export const PANEL_ORDER = PANEL_GROUPS.flatMap((g) => g.panels);

// 侧边栏导航项（11 部门 + 总览），group = 业务族 id
export const NAV_ITEMS = [
  { id: "overview",    label: "总览",       icon: "LayoutDashboard" },
  // 临床与诊疗
  { id: "outpatient",  label: "门诊/专科诊室", icon: "Stethoscope",    group: "clinical" },
  { id: "refraction",  label: "视光与训练",   icon: "Glasses",         group: "clinical" },
  { id: "diagnostics", label: "特检/医技",    icon: "Microscope",      group: "clinical" },
  { id: "surgery",     label: "日间手术室",   icon: "Syringe",         group: "clinical" },
  { id: "nursing",     label: "护理与导诊",   icon: "HeartPulse",      group: "clinical" },
  // 运营与支持
  { id: "front_desk",  label: "前台与客服",   icon: "ConciergeBell",   group: "non_clinical" },
  { id: "marketing",   label: "市场与筛查",   icon: "Megaphone",       group: "non_clinical" },
  { id: "finance",     label: "财务与医保",   icon: "CircleDollarSign",group: "non_clinical" },
  { id: "logistics",   label: "物资与药房",   icon: "Warehouse",      group: "non_clinical" },
  { id: "admin",       label: "行政与质控",   icon: "ShieldCheck",     group: "non_clinical" },
  // 兜底与例外
  { id: "supplemental",label: "兜底与例外",   icon: "Boxes",           group: "fallback" },
];

// 事件流示例（看板走马灯已由实体库实时驱动，此为展示备用）
export const EVENT_STREAM_INITIAL = [
  { id: 1, time: "09:42", type: "critical", icon: "AlertTriangle",
    message: "【02 视光中心】验光等待超过阈值，当前均值28分钟，建议立即补位。", actionRequired: true },
  { id: 2, time: "09:39", type: "info", icon: "User",
    message: "【06 前台导诊】3份患者档案待补齐联系信息，影响后续回访。", actionRequired: false },
  { id: 3, time: "09:35", type: "warning", icon: "Clock",
    message: "【02 视光中心】视光师U本场已接诊14人，超出额定上限，高负荷运行中。", actionRequired: false },
  { id: 4, time: "09:31", type: "success", icon: "CheckCircle",
    message: "【08 财务医保】今日营收完成目标85%（¥34,820），收款进度正常。", actionRequired: false },
  { id: 5, time: "09:28", type: "info", icon: "Package",
    message: "【09 物资药房】渐变镜片仅剩23片，采购J已发起补货，预计14:00到货。", actionRequired: false },
];

export const EVENT_STREAM_QUEUE = [
  { id: 10, type: "critical", icon: "Zap",
    message: "【AI建议】配镜师X当前空闲已20分钟，可立即支援02视光中心，预计等待降至15分钟。",
    actionRequired: true, suggestion: true },
  { id: 11, type: "warning", icon: "AlertCircle",
    message: "请院长确认是否调整排班：将配镜师X调入视光中心验光区支援。",
    actionRequired: true, awaitConfirm: true },
  { id: 12, type: "info", icon: "Megaphone",
    message: "【07 市场筛查】小红书今日新增8条咨询，2条超过1小时未回复，请O1尽快处理。",
    actionRequired: false },
  { id: 13, type: "info", icon: "Users",
    message: "【06 前台导诊】下午13:30有12名患者预约到诊，建议13:00完成中午班次交接。",
    actionRequired: false },
  { id: 14, type: "warning", icon: "Clock",
    message: "【01 门诊诊室】眼科医生D已连续工作3.5小时，建议11:30安排短暂休息。",
    actionRequired: false },
  { id: 15, type: "success", icon: "CheckCircle",
    message: "【09 物资药房】库存补货订单已确认发货，库管A2请于14:00前准备收货区域。",
    actionRequired: false },
];