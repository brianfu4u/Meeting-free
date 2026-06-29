// Mock data for 今天我来当店长 - Optometry Clinic Operations Dashboard
// 18 physical/functional zones — full operations matrix

export const CLINIC_NAME = "明视眼科诊所";

export const STAFF = {
  manager:    { id: "L",  name: "院长L",     role: "院长",     status: "在岗",  area: "院长指挥台" },
  frontR:     { id: "R",  name: "前台R",     role: "前台",     status: "忙碌",  area: "前台接待区" },
  frontR2:    { id: "R2", name: "前台R2",    role: "前台",     status: "忙碌",  area: "前台接待区" },
  nurseN1:    { id: "N1", name: "护士长N1",  role: "护士长",   status: "在岗",  area: "预诊分流区" },
  nurseN2:    { id: "N2", name: "护士N2",    role: "护士",     status: "忙碌",  area: "治疗区" },
  nurseN3:    { id: "N3", name: "护士N3",    role: "护士",     status: "忙碌",  area: "康复功能区" },
  doctorD:    { id: "D",  name: "眼科医生D", role: "眼科医生", status: "诊疗中",area: "医生问诊区" },
  doctorD2:   { id: "D2", name: "眼科医生D2",role: "眼科医生", status: "诊疗中",area: "手术室" },
  optU:       { id: "U",  name: "视光师U",   role: "视光师",   status: "忙碌",  area: "检查区" },
  optV:       { id: "V",  name: "视光师V",   role: "视光师",   status: "忙碌",  area: "检查区" },
  optW:       { id: "W",  name: "视光师W",   role: "视光师",   status: "忙碌",  area: "检查区" },
  optX:       { id: "X",  name: "视光师X",   role: "视光师",   status: "空闲",  area: "休息室" },
  cashierC:   { id: "C",  name: "出纳C",     role: "出纳",     status: "忙碌",  area: "付款结算区" },
  financeF:   { id: "F",  name: "财务F",     role: "财务",     status: "在岗",  area: "财务部" },
  financeF2:  { id: "F2", name: "财务F2",    role: "财务",     status: "在岗",  area: "财务部" },
  purchaseJ:  { id: "J",  name: "采购J",     role: "采购",     status: "在岗",  area: "采购部" },
  marketM:    { id: "M",  name: "市场M",     role: "市场",     status: "外出",  area: "市场开拓部" },
  onlineO1:   { id: "O1", name: "线上运营O1",role: "线上运营", status: "在岗",  area: "市场开拓部" },
  logisticsA: { id: "A",  name: "后勤A",     role: "后勤",     status: "在岗",  area: "后勤办公室" },
  logisticsA2:{ id: "A2", name: "后勤A2",    role: "后勤",     status: "在岗",  area: "库房" },
  itT:        { id: "T",  name: "IT保障T",   role: "IT保障",   status: "远程",  area: "信息中心" },
  productP:   { id: "P",  name: "产品专员P", role: "产品",     status: "在岗",  area: "产品陈列区" },
  emergencyE: { id: "E",  name: "急救护士E", role: "急救护士", status: "待命",  area: "急救中心" },
};

// ─── 18区域面板数据 ────────────────────────────────────────────────────────────

export const INITIAL_PANELS = {

  // ══════════════ 阵列A：一线诊疗 ══════════════

  // A1 前台接待区
  reception: {
    id: "reception",
    title: "前台接待区",
    icon: "ConciergeBell",
    status: "amber",
    zoneCode: "A1",
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
        { label: "登记平均耗时", value: "4.2分钟" },
      ],
      staffInvolved: ["前台R", "前台R2"],
      alerts: ["当前排队7人，建议开启自助签到屏分流", "有3位预约患者超时未到，建议电话确认"],
    },
  },

  // A2 预诊分流区
  triage: {
    id: "triage",
    title: "预诊分流区",
    icon: "GitBranch",
    status: "green",
    zoneCode: "A2",
    metrics: [
      { label: "今日预诊", value: "41", unit: "人" },
      { label: "分流等待", value: "3", unit: "人" },
      { label: "分流准确率", value: "96", unit: "%" },
      { label: "平均预诊时长", value: "6", unit: "分钟" },
    ],
    liveNote: "预诊分流顺畅，护士长N1主导，流程高效",
    detail: {
      subMetrics: [
        { label: "分配至检查区", value: "28人" },
        { label: "分配至问诊区", value: "9人" },
        { label: "分配至治疗区", value: "4人" },
        { label: "绿色通道启用", value: "0次" },
        { label: "今日分流完成", value: "41人" },
        { label: "平均排队时间", value: "6分钟" },
      ],
      staffInvolved: ["护士长N1"],
      alerts: ["分流进度正常，暂无异常情况"],
    },
  },

  // A3 检查区
  examination: {
    id: "examination",
    title: "检查区",
    icon: "Microscope",
    status: "red",
    zoneCode: "A3",
    metrics: [
      { label: "当前等待", value: "14", unit: "人" },
      { label: "平均等待时长", value: "28", unit: "分钟" },
      { label: "超时等待", value: "4", unit: "人" },
      { label: "拥堵指数", value: "87", unit: "/100" },
    ],
    liveNote: "⚠️ 拥堵超阈值，视光师X空闲待调配支援",
    detail: {
      subMetrics: [
        { label: "检查区1（视光师U）", value: "高负荷" },
        { label: "检查区2（视光师V）", value: "高负荷" },
        { label: "检查区3（视光师W）", value: "高负荷" },
        { label: "最长等待", value: "52分钟" },
        { label: "检查完成", value: "34例" },
        { label: "超限率", value: "28.6%" },
      ],
      staffInvolved: ["视光师U", "视光师V", "视光师W", "视光师X"],
      alerts: ["检查区均值超阈值8分钟", "视光师X空闲20分钟，建议立即调配", "若不处理，30分钟后投诉风险升高"],
    },
  },

  // A4 医生问诊区
  consultation: {
    id: "consultation",
    title: "医生问诊区",
    icon: "Stethoscope",
    status: "amber",
    zoneCode: "A4",
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

  // A5 治疗区
  treatment: {
    id: "treatment",
    title: "治疗区",
    icon: "Activity",
    status: "green",
    zoneCode: "A5",
    metrics: [
      { label: "今日治疗", value: "16", unit: "次" },
      { label: "当前在治", value: "3", unit: "人" },
      { label: "治疗室占用", value: "2", unit: "间" },
      { label: "平均治疗时长", value: "22", unit: "分钟" },
    ],
    liveNote: "治疗区运行平稳，无异常情况",
    detail: {
      subMetrics: [
        { label: "雾视训练", value: "8次" },
        { label: "视觉训练", value: "5次" },
        { label: "热敷护理", value: "3次" },
        { label: "今日完成", value: "13次" },
        { label: "治疗室利用率", value: "67%" },
        { label: "预约下午治疗", value: "4人" },
      ],
      staffInvolved: ["护士N2", "视光师V"],
      alerts: ["下午治疗预约4人，需提前准备器械"],
    },
  },

  // A6 手术室
  operatingRoom: {
    id: "operatingRoom",
    title: "手术室",
    icon: "Syringe",
    status: "green",
    zoneCode: "A6",
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

  // ══════════════ 阵列B：后勤支撑 ══════════════

  // B1 病房
  ward: {
    id: "ward",
    title: "病房",
    icon: "BedDouble",
    status: "green",
    zoneCode: "B1",
    metrics: [
      { label: "当前住院", value: "4", unit: "人" },
      { label: "床位占用率", value: "50", unit: "%" },
      { label: "今日出院", value: "1", unit: "人" },
      { label: "今日入院", value: "2", unit: "人" },
    ],
    liveNote: "病房运行平稳，床位充裕，护理正常",
    detail: {
      subMetrics: [
        { label: "VIP病房", value: "2间/4间使用中" },
        { label: "普通病房", value: "2间/4间使用中" },
        { label: "今日护理记录", value: "已完成" },
        { label: "用药执行", value: "准时" },
        { label: "患者满意度", value: "4.9/5" },
        { label: "今日查房", value: "08:00 已完成" },
      ],
      staffInvolved: ["眼科医生D", "护士长N1", "护士N3"],
      alerts: ["14:00有2名术后患者需复查用药，护士N3请提前准备"],
    },
  },

  // B2 康复功能区
  rehabilitation: {
    id: "rehabilitation",
    title: "康复功能区",
    icon: "HeartPulse",
    status: "green",
    zoneCode: "B2",
    metrics: [
      { label: "今日康复人次", value: "11", unit: "人" },
      { label: "当前在康", value: "3", unit: "人" },
      { label: "设备运行", value: "正常", unit: "" },
      { label: "训练完成率", value: "91", unit: "%" },
    ],
    liveNote: "康复训练进度正常，儿童视觉训练参与度高",
    detail: {
      subMetrics: [
        { label: "儿童视觉训练", value: "6人次" },
        { label: "成人低视力康复", value: "3人次" },
        { label: "术后康复训练", value: "2人次" },
        { label: "康复仪器使用率", value: "75%" },
        { label: "下午预约", value: "5人" },
        { label: "训练评估完成", value: "9份" },
      ],
      staffInvolved: ["护士N3", "视光师W"],
      alerts: ["下午5名康复预约请提前准备训练方案"],
    },
  },

  // B3 库房
  warehouse: {
    id: "warehouse",
    title: "库房",
    icon: "Warehouse",
    status: "amber",
    zoneCode: "B3",
    metrics: [
      { label: "库存预警品项", value: "2", unit: "项" },
      { label: "今日出库", value: "38", unit: "件" },
      { label: "待收货订单", value: "1", unit: "单" },
      { label: "库存健康度", value: "78", unit: "%" },
    ],
    liveNote: "渐变镜片库存临近低位，补货单已在途",
    detail: {
      subMetrics: [
        { label: "近视镜片", value: "142片 ⚠️" },
        { label: "渐变镜片", value: "23片 ⚠️" },
        { label: "镜框", value: "充足（>200副）" },
        { label: "验光耗材", value: "充足" },
        { label: "眼药水", value: "充足" },
        { label: "预计到货", value: "今日14:00" },
      ],
      staffInvolved: ["后勤A2", "采购J"],
      alerts: ["渐变镜片仅剩23片，已发起补货", "预计14:00到货，请安排人员清点收货"],
    },
  },

  // B4 付款结算区
  billing: {
    id: "billing",
    title: "付款结算区",
    icon: "CreditCard",
    status: "green",
    zoneCode: "B4",
    metrics: [
      { label: "今日营收", value: "¥34,820", unit: "" },
      { label: "待结算", value: "¥6,200", unit: "" },
      { label: "收款完成率", value: "85", unit: "%" },
      { label: "退款申请", value: "1", unit: "单" },
    ],
    liveNote: "收款进度正常，完成目标85%，退款1单待处理",
    detail: {
      subMetrics: [
        { label: "今日营收目标", value: "¥41,000" },
        { label: "检查收入", value: "¥18,200" },
        { label: "配镜收入", value: "¥12,400" },
        { label: "药品收入", value: "¥4,220" },
        { label: "待结算保险", value: "¥3,800" },
        { label: "退款金额", value: "¥450" },
      ],
      dailyRevenue: [4200, 6800, 8100, 9200, 34820],
      staffInvolved: ["出纳C"],
      alerts: ["退款申请需财务F在2小时内处理", "医保结算单3份待提交"],
    },
  },

  // B5 财务部
  finance: {
    id: "finance",
    title: "财务部",
    icon: "CircleDollarSign",
    status: "green",
    zoneCode: "B5",
    metrics: [
      { label: "本月营收", value: "¥182,400", unit: "" },
      { label: "月度目标达成", value: "78", unit: "%" },
      { label: "待审核单据", value: "5", unit: "份" },
      { label: "异常账单", value: "0", unit: "单" },
    ],
    liveNote: "财务运营正常，月度目标完成78%，无异常",
    detail: {
      subMetrics: [
        { label: "本月支出", value: "¥94,200" },
        { label: "净利润（月）", value: "¥88,200" },
        { label: "毛利率", value: "48.4%" },
        { label: "待报销单据", value: "3份" },
        { label: "保险结算待提交", value: "3份" },
        { label: "下月预算审核", value: "待启动" },
      ],
      staffInvolved: ["财务F", "财务F2"],
      alerts: ["保险结算单3份需在本周五前提交", "本月支出分析报告需在月底前完成"],
    },
  },

  // B6 采购部
  procurement: {
    id: "procurement",
    title: "采购部",
    icon: "ShoppingCart",
    status: "green",
    zoneCode: "B6",
    metrics: [
      { label: "本月采购单", value: "12", unit: "单" },
      { label: "在途订单", value: "3", unit: "单" },
      { label: "今日到货", value: "1", unit: "单" },
      { label: "采购预算余额", value: "¥18,000", unit: "" },
    ],
    liveNote: "采购计划正常推进，镜片补货在途",
    detail: {
      subMetrics: [
        { label: "镜片采购单（在途）", value: "预计今日" },
        { label: "设备耗材采购", value: "待审批" },
        { label: "药品采购", value: "已到货" },
        { label: "本月超预算风险", value: "低" },
        { label: "供应商评分", value: "4.3/5" },
        { label: "紧急采购权限", value: "¥5,000以内" },
      ],
      staffInvolved: ["采购J"],
      alerts: ["镜片供应商月底调价，建议本周完成下月备货采购"],
    },
  },

  // ══════════════ 阵列C：管理与赋能 ══════════════

  // C1 后勤办公室
  logistics: {
    id: "logistics",
    title: "后勤办公室",
    icon: "Wrench",
    status: "green",
    zoneCode: "C1",
    metrics: [
      { label: "设施状态", value: "正常", unit: "" },
      { label: "今日消毒", value: "2", unit: "次" },
      { label: "候诊室温度", value: "24", unit: "℃" },
      { label: "待处理报修", value: "0", unit: "项" },
    ],
    liveNote: "环境整洁，设施正常，候诊区舒适",
    detail: {
      subMetrics: [
        { label: "前台接待区", value: "整洁" },
        { label: "候诊区座位利用率", value: "82%" },
        { label: "卫生间", value: "正常" },
        { label: "空调系统", value: "正常" },
        { label: "下次消毒计划", value: "12:30" },
        { label: "设施巡检", value: "今日08:00已完成" },
      ],
      staffInvolved: ["后勤A", "后勤A2"],
      alerts: ["候诊区利用率82%，高峰期建议引导至副候诊区"],
    },
  },

  // C2 市场开拓部
  marketing: {
    id: "marketing",
    title: "市场开拓部",
    icon: "Megaphone",
    status: "green",
    zoneCode: "C2",
    metrics: [
      { label: "今日新线索", value: "18", unit: "条" },
      { label: "预约转化率", value: "61", unit: "%" },
      { label: "线上咨询", value: "34", unit: "条" },
      { label: "进行中活动", value: "2", unit: "项" },
    ],
    liveNote: "线上转化良好，市场M外出拓展，O1驻守",
    detail: {
      subMetrics: [
        { label: "微信公众号线索", value: "11条" },
        { label: "小红书线索", value: "8条" },
        { label: "美团到访", value: "6人" },
        { label: "自然客流", value: "3人" },
        { label: "未回复咨询", value: "2条 ⚠️" },
        { label: "活动「暑期护眼季」", value: "核销11单" },
      ],
      staffInvolved: ["市场M", "线上运营O1"],
      alerts: ["小红书2条咨询超1小时未回复，请立即跟进", "市场M外出，预计12:30返回"],
    },
  },

  // C3 院长指挥台（超级仪表盘）
  commandCenter: {
    id: "commandCenter",
    title: "院长指挥台",
    icon: "LayoutDashboard",
    status: "amber",
    zoneCode: "C3",
    metrics: [
      { label: "全院健康评分", value: "78", unit: "/100" },
      { label: "待决策事项", value: "3", unit: "项" },
      { label: "当前在岗", value: "22", unit: "人" },
      { label: "今日接诊", value: "47", unit: "人" },
    ],
    liveNote: "检查区拥堵需立即处置，其余区域运行正常",
    detail: {
      subMetrics: [
        { label: "紧急区域数", value: "1个（检查区）" },
        { label: "注意区域数", value: "4个" },
        { label: "正常区域数", value: "13个" },
        { label: "今日营收进度", value: "85%（¥34,820）" },
        { label: "患者满意度均值", value: "4.7/5" },
        { label: "下午班就绪状态", value: "已确认15人" },
      ],
      staffInvolved: ["院长L"],
      alerts: ["检查区拥堵需立即处置 [紧急]", "视光师X空闲，建议调配支援", "下午手术14:30需提前30分钟准备"],
    },
  },

  // C4 产品陈列区
  productDisplay: {
    id: "productDisplay",
    title: "产品陈列区",
    icon: "ShoppingBag",
    status: "green",
    zoneCode: "C4",
    metrics: [
      { label: "今日产品咨询", value: "22", unit: "次" },
      { label: "当场成交", value: "8", unit: "单" },
      { label: "转化率", value: "36", unit: "%" },
      { label: "主推产品库存", value: "充足", unit: "" },
    ],
    liveNote: "产品咨询活跃，主推镜框转化良好",
    detail: {
      subMetrics: [
        { label: "镜框咨询", value: "14次" },
        { label: "隐形眼镜咨询", value: "5次" },
        { label: "护理产品咨询", value: "3次" },
        { label: "今日销售额（产品）", value: "¥4,800" },
        { label: "陈列区客流", value: "38人次" },
        { label: "主推款库存", value: "够用3天" },
      ],
      staffInvolved: ["产品专员P", "出纳C"],
      alerts: ["主推镜框款式库存约剩3天，建议通知采购部补货"],
    },
  },

  // C5 信息中心
  infoCenter: {
    id: "infoCenter",
    title: "信息中心",
    icon: "Server",
    status: "green",
    zoneCode: "C5",
    metrics: [
      { label: "系统在线率", value: "99.8", unit: "%" },
      { label: "设备联网率", value: "100", unit: "%" },
      { label: "待完善档案", value: "3", unit: "份" },
      { label: "今日备份", value: "已完成", unit: "" },
    ],
    liveNote: "所有系统运行正常，IT远程驻守",
    detail: {
      subMetrics: [
        { label: "HIS系统", value: "正常" },
        { label: "预约系统", value: "正常" },
        { label: "收费系统", value: "正常" },
        { label: "监控系统", value: "正常" },
        { label: "待补全患者档案", value: "3份" },
        { label: "网络延迟", value: "< 10ms" },
      ],
      staffInvolved: ["IT保障T"],
      alerts: ["前台R有3份患者档案待补全联系方式，建议下午前完成"],
    },
  },

  // C6 急救中心
  emergency: {
    id: "emergency",
    title: "急救中心",
    icon: "Ambulance",
    status: "green",
    zoneCode: "C6",
    metrics: [
      { label: "当前状态", value: "待命", unit: "" },
      { label: "今日启动", value: "0", unit: "次" },
      { label: "急救设备", value: "就绪", unit: "" },
      { label: "急救响应时间", value: "< 3", unit: "分钟" },
    ],
    liveNote: "急救中心待命状态，设备完好，人员就位",
    detail: {
      subMetrics: [
        { label: "AED设备", value: "已检测/正常" },
        { label: "急救药品", value: "齐全" },
        { label: "急救担架", value: "就位" },
        { label: "院外急救联系", value: "120已存档" },
        { label: "最近演练", value: "6月20日" },
        { label: "本月培训计划", value: "7月4日" },
      ],
      staffInvolved: ["急救护士E", "护士长N1"],
      alerts: ["下次急救培训7月4日，请确认全员参与安排"],
    },
  },
};

// 分组化布局结构
export const PANEL_GROUPS = [
  {
    groupId: "clinical",
    groupLabel: "一线诊疗阵列",
    groupColor: "#00C7D9",
    panels: ["reception", "triage", "examination", "consultation", "treatment", "operatingRoom"],
  },
  {
    groupId: "support",
    groupLabel: "后勤支撑阵列",
    groupColor: "#16A34A",
    panels: ["ward", "rehabilitation", "warehouse", "billing", "finance", "procurement"],
  },
  {
    groupId: "management",
    groupLabel: "管理赋能阵列",
    groupColor: "#D97706",
    panels: ["logistics", "marketing", "commandCenter", "productDisplay", "infoCenter", "emergency"],
  },
];

// 兼容旧的 PANEL_ORDER（平铺顺序）
export const PANEL_ORDER = PANEL_GROUPS.flatMap((g) => g.panels);

export const EVENT_STREAM_INITIAL = [
  {
    id: 1,
    time: "09:42",
    type: "critical",
    icon: "AlertTriangle",
    message: "【检查区A3】等待时间超过阈值，当前均值28分钟，拥堵指数87，建议立即补位。",
    actionRequired: true,
  },
  {
    id: 2,
    time: "09:39",
    type: "info",
    icon: "User",
    message: "【信息中心C5】前台R有3份患者资料待补齐联系信息，影响后续回访。",
    actionRequired: false,
  },
  {
    id: 3,
    time: "09:35",
    type: "warning",
    icon: "Clock",
    message: "【检查区A3】视光师U本场已接诊14人，超出额定上限，高负荷运行中。",
    actionRequired: false,
  },
  {
    id: 4,
    time: "09:31",
    type: "success",
    icon: "CheckCircle",
    message: "【付款结算B4】今日营收完成目标85%（¥34,820），收款进度正常。",
    actionRequired: false,
  },
  {
    id: 5,
    time: "09:28",
    type: "info",
    icon: "Package",
    message: "【库房B3】渐变镜片仅剩23片，采购J已发起补货，预计今日14:00到货。",
    actionRequired: false,
  },
];

export const EVENT_STREAM_QUEUE = [
  {
    id: 10,
    type: "critical",
    icon: "Zap",
    message: "【AI建议】视光师X当前空闲已20分钟，可立即支援A3检查区，预计等待时间降至15分钟。",
    actionRequired: true,
    suggestion: true,
  },
  {
    id: 11,
    type: "warning",
    icon: "AlertCircle",
    message: "请院长确认是否调整排班：将视光师X调入检查区3号位支援。",
    actionRequired: true,
    awaitConfirm: true,
  },
  {
    id: 12,
    type: "info",
    icon: "Megaphone",
    message: "【市场开拓C2】小红书今日新增8条咨询，2条超过1小时未回复，请O1尽快处理。",
    actionRequired: false,
  },
  {
    id: 13,
    type: "info",
    icon: "Users",
    message: "【前台接待A1】下午13:30有12名患者预约到诊，建议13:00完成中午班次交接。",
    actionRequired: false,
  },
  {
    id: 14,
    type: "warning",
    icon: "Clock",
    message: "【医生问诊A4】眼科医生D已连续工作3.5小时，建议在11:30安排短暂休息。",
    actionRequired: false,
  },
  {
    id: 15,
    type: "success",
    icon: "CheckCircle",
    message: "【库房B3】库存补货订单已确认发货，后勤A2请于14:00前准备收货区域。",
    actionRequired: false,
  },
];

export const NAV_ITEMS = [
  { id: "overview",      label: "总览",     icon: "LayoutDashboard" },
  // 一线诊疗
  { id: "reception",     label: "前台接待", icon: "ConciergeBell",  group: "clinical" },
  { id: "triage",        label: "预诊分流", icon: "GitBranch",      group: "clinical" },
  { id: "examination",   label: "检查区",   icon: "Microscope",     group: "clinical" },
  { id: "consultation",  label: "医生问诊", icon: "Stethoscope",    group: "clinical" },
  { id: "treatment",     label: "治疗区",   icon: "Activity",       group: "clinical" },
  { id: "operatingRoom", label: "手术室",   icon: "Syringe",        group: "clinical" },
  // 后勤支撑
  { id: "ward",          label: "病房",     icon: "BedDouble",      group: "support" },
  { id: "rehabilitation",label: "康复功能", icon: "HeartPulse",     group: "support" },
  { id: "warehouse",     label: "库房",     icon: "Warehouse",      group: "support" },
  { id: "billing",       label: "付款结算", icon: "CreditCard",     group: "support" },
  { id: "finance",       label: "财务部",   icon: "CircleDollarSign",group: "support"},
  { id: "procurement",   label: "采购部",   icon: "ShoppingCart",   group: "support" },
  // 管理赋能
  { id: "logistics",     label: "后勤办公", icon: "Wrench",         group: "management" },
  { id: "marketing",     label: "市场开拓", icon: "Megaphone",      group: "management" },
  { id: "commandCenter", label: "院长指挥台",icon: "LayoutDashboard",group: "management" },
  { id: "productDisplay",label: "产品陈列", icon: "ShoppingBag",    group: "management" },
  { id: "infoCenter",    label: "信息中心", icon: "Server",         group: "management" },
  { id: "emergency",     label: "急救中心", icon: "Ambulance",      group: "management" },
];