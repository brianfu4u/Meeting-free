// Mock data for 今天我来当店长 - Optometry Clinic Operations Dashboard
// Simulating a busy Saturday morning scenario — 18-panel full operations matrix

export const CLINIC_NAME = "明视眼科诊所";

export const STAFF = {
  manager: { id: "L", name: "店长L", role: "店长", status: "在岗", area: "管理区" },
  frontDesk: { id: "R", name: "前台R", role: "前台", status: "忙碌", area: "前台接待" },
  optU: { id: "U", name: "视光师U", role: "视光师", status: "忙碌", area: "检查区1" },
  optV: { id: "V", name: "视光师V", role: "视光师", status: "忙碌", area: "检查区2" },
  optW: { id: "W", name: "视光师W", role: "视光师", status: "忙碌", area: "检查区3" },
  optX: { id: "X", name: "视光师X", role: "视光师", status: "空闲", area: "休息室" },
  doctorD: { id: "D", name: "眼科医生D", role: "眼科医生", status: "诊疗中", area: "诊室" },
  nurseN1: { id: "N1", name: "护士长N1", role: "护士长", status: "在岗", area: "护理站" },
  nurseN2: { id: "N2", name: "护士N2", role: "护士", status: "忙碌", area: "检查区" },
  financeF: { id: "F", name: "财务F", role: "财务", status: "在岗", area: "财务室" },
  cashierC: { id: "C", name: "出纳C", role: "出纳", status: "忙碌", area: "收银台" },
  purchaseJ: { id: "J", name: "采购J", role: "采购", status: "在岗", area: "仓库" },
  marketM: { id: "M", name: "市场M", role: "市场", status: "外出", area: "合作医院" },
  onlineO1: { id: "O1", name: "线上运营O1", role: "线上运营", status: "在岗", area: "运营室" },
  offlineO2: { id: "O2", name: "线下运营O2", role: "线下运营", status: "在岗", area: "大厅" },
  itT: { id: "T", name: "IT保障T", role: "IT保障", status: "远程", area: "技术室" },
  logisticsA: { id: "A", name: "后勤A", role: "后勤", status: "在岗", area: "后台" },
  trainingK: { id: "K", name: "培训专员K", role: "培训", status: "在岗", area: "培训室" },
};

export const INITIAL_PANELS = {

  // ── 区域 01：患者流转 ─────────────────────────────
  patientFlow: {
    id: "patientFlow",
    title: "患者流转",
    icon: "Users",
    status: "amber",
    metrics: [
      { label: "今日已接诊", value: "47", unit: "人" },
      { label: "当前在院", value: "23", unit: "人" },
      { label: "预约未到", value: "8", unit: "人" },
      { label: "平均停留", value: "38", unit: "分钟" },
    ],
    liveNote: "患者量快速上升，较上周同期 +18%",
    detail: {
      subMetrics: [
        { label: "上午场次目标", value: "60人" },
        { label: "当前完成率", value: "78%" },
        { label: "走动患者数", value: "12人" },
        { label: "爽约率", value: "4.2%" },
        { label: "新患占比", value: "31%" },
        { label: "复诊患者", value: "32人" },
      ],
      hourlyFlow: [8, 14, 19, 26, 32, 41, 47],
      staffInvolved: ["前台R", "视光师U", "视光师V", "视光师W", "眼科医生D"],
      alerts: ["8:30–9:00 到诊高峰，前台压力集中", "预约患者中有3人超时未到，建议电话确认"],
    },
  },

  // ── 区域 02：排队拥堵 ─────────────────────────────
  queueCongestion: {
    id: "queueCongestion",
    title: "排队拥堵",
    icon: "AlertTriangle",
    status: "red",
    metrics: [
      { label: "当前等待人数", value: "14", unit: "人" },
      { label: "平均等待时长", value: "28", unit: "分钟" },
      { label: "超时等待", value: "4", unit: "人" },
      { label: "拥堵指数", value: "87", unit: "/100" },
    ],
    liveNote: "⚠️ 检查区拥堵超阈值，建议立即补位",
    detail: {
      subMetrics: [
        { label: "前台等待", value: "3人" },
        { label: "检查区等待", value: "8人" },
        { label: "取镜等待", value: "3人" },
        { label: "最长等待", value: "52分钟" },
        { label: "阈值上限", value: "20分钟" },
        { label: "超限率", value: "28.6%" },
      ],
      staffInvolved: ["视光师U", "视光师V", "视光师W", "视光师X"],
      alerts: ["检查区等待均值已超阈值8分钟", "视光师X空闲，建议立即调配支援检查区", "若不处理，预计30分钟后患者投诉风险升高"],
    },
  },

  // ── 区域 03：员工实时状态 ──────────────────────────
  staffStatus: {
    id: "staffStatus",
    title: "员工实时状态",
    icon: "UserCheck",
    status: "amber",
    metrics: [
      { label: "在岗人员", value: "14", unit: "人" },
      { label: "外出执行", value: "1", unit: "人" },
      { label: "空闲可调配", value: "1", unit: "人" },
      { label: "超负荷预警", value: "3", unit: "人" },
    ],
    liveNote: "视光师X空闲，视光师U/V/W超负荷",
    detail: {
      staffList: Object.values(STAFF),
      alerts: ["视光师U本场已接诊14人，超出额定上限", "视光师V/W均在高负荷运行", "视光师X已空闲20分钟，建议立即调配"],
    },
  },

  // ── 区域 04：临床执行 ─────────────────────────────
  clinicalExec: {
    id: "clinicalExec",
    title: "临床执行",
    icon: "Stethoscope",
    status: "amber",
    metrics: [
      { label: "检查完成", value: "34", unit: "例" },
      { label: "配镜完成", value: "12", unit: "例" },
      { label: "待复核", value: "5", unit: "例" },
      { label: "异常记录", value: "2", unit: "条" },
    ],
    liveNote: "2例待复核需医生介入，流程轻度受阻",
    detail: {
      subMetrics: [
        { label: "屈光检查", value: "21例" },
        { label: "裂隙灯检查", value: "9例" },
        { label: "眼压测量", value: "13例" },
        { label: "视野检测", value: "4例" },
        { label: "配镜处方完成", value: "12例" },
        { label: "待医生复核", value: "5例" },
      ],
      staffInvolved: ["视光师U", "视光师V", "视光师W", "眼科医生D", "护士长N1"],
      alerts: ["视光师W有2例结果异常，等待医生D复核", "配镜配方完成率低于预期，关注产能"],
    },
  },

  // ── 区域 05：运营调度 ─────────────────────────────
  operations: {
    id: "operations",
    title: "运营调度",
    icon: "Zap",
    status: "amber",
    metrics: [
      { label: "待调度任务", value: "3", unit: "项" },
      { label: "已执行指令", value: "7", unit: "条" },
      { label: "响应延迟", value: "4.2", unit: "分钟" },
      { label: "班次覆盖率", value: "92", unit: "%" },
    ],
    liveNote: "有1项紧急调度等待店长确认",
    detail: {
      subMetrics: [
        { label: "今日计划任务", value: "12项" },
        { label: "已完成", value: "7项" },
        { label: "进行中", value: "2项" },
        { label: "待执行", value: "3项" },
        { label: "超时未完成", value: "1项" },
        { label: "平均响应时间", value: "4.2分钟" },
      ],
      staffInvolved: ["店长L", "线上运营O1", "线下运营O2", "后勤A"],
      alerts: ["检查区补位调度等待确认 [紧急]", "下午班人员到岗提醒需提前发出", "外出市场M未回报进度"],
    },
  },

  // ── 区域 06：财务收款 ─────────────────────────────
  finance: {
    id: "finance",
    title: "财务收款",
    icon: "CircleDollarSign",
    status: "green",
    metrics: [
      { label: "今日营收", value: "¥34,820", unit: "" },
      { label: "待收款", value: "¥6,200", unit: "" },
      { label: "收款完成率", value: "85", unit: "%" },
      { label: "退款申请", value: "1", unit: "单" },
    ],
    liveNote: "营收进度正常，较目标完成85%",
    detail: {
      subMetrics: [
        { label: "今日目标", value: "¥41,000" },
        { label: "检查收入", value: "¥18,200" },
        { label: "配镜收入", value: "¥12,400" },
        { label: "药品收入", value: "¥4,220" },
        { label: "待结算保险", value: "¥3,800" },
        { label: "退款金额", value: "¥450" },
      ],
      dailyRevenue: [4200, 6800, 8100, 9200, 34820],
      staffInvolved: ["财务F", "出纳C"],
      alerts: ["退款申请需财务F在2小时内处理", "保险结算单3份待提交"],
    },
  },

  // ── 区域 07：采购库存 ─────────────────────────────
  inventory: {
    id: "inventory",
    title: "采购库存",
    icon: "Package",
    status: "green",
    metrics: [
      { label: "库存预警品项", value: "2", unit: "项" },
      { label: "待收货订单", value: "1", unit: "单" },
      { label: "今日出库", value: "38", unit: "件" },
      { label: "库存健康度", value: "91", unit: "%" },
    ],
    liveNote: "镜片存量接近低位，采购J已处理",
    detail: {
      subMetrics: [
        { label: "近视镜片库存", value: "142片 ⚠️" },
        { label: "渐变镜片库存", value: "23片 ⚠️" },
        { label: "镜框库存", value: "充足" },
        { label: "验光耗材", value: "充足" },
        { label: "眼药水", value: "充足" },
        { label: "今日待收货", value: "1单（预计14:00到）" },
      ],
      staffInvolved: ["采购J", "后勤A"],
      alerts: ["渐变镜片仅剩23片，已发起补货", "预计今日14:00到货，注意安排收货人员"],
    },
  },

  // ── 区域 08：市场线索 ─────────────────────────────
  marketing: {
    id: "marketing",
    title: "市场线索",
    icon: "TrendingUp",
    status: "green",
    metrics: [
      { label: "今日新线索", value: "18", unit: "条" },
      { label: "预约转化率", value: "61", unit: "%" },
      { label: "线上咨询", value: "34", unit: "条" },
      { label: "线下到访", value: "9", unit: "人" },
    ],
    liveNote: "线上转化表现良好，市场M外出开拓中",
    detail: {
      subMetrics: [
        { label: "微信公众号线索", value: "11条" },
        { label: "小红书线索", value: "8条" },
        { label: "美团到访", value: "6人" },
        { label: "自然客流", value: "3人" },
        { label: "线索跟进率", value: "78%" },
        { label: "今日目标转化", value: "25条" },
      ],
      staffInvolved: ["市场M", "线上运营O1", "线下运营O2"],
      alerts: ["市场M外出中，预计12:30返回", "小红书有2条未回复咨询超过1小时"],
    },
  },

  // ── 区域 09：后台支撑 ─────────────────────────────
  backendSupport: {
    id: "backendSupport",
    title: "后台支撑",
    icon: "Server",
    status: "green",
    metrics: [
      { label: "系统在线率", value: "99.8", unit: "%" },
      { label: "待完善资料", value: "3", unit: "份" },
      { label: "设备运行", value: "正常", unit: "" },
      { label: "IT响应时间", value: "< 5", unit: "分钟" },
    ],
    liveNote: "前台有3份患者资料待补全，其余系统正常",
    detail: {
      subMetrics: [
        { label: "HIS系统", value: "正常" },
        { label: "预约系统", value: "正常" },
        { label: "收费系统", value: "正常" },
        { label: "设备联网率", value: "100%" },
        { label: "待补全档案", value: "3份" },
        { label: "今日数据备份", value: "已完成" },
      ],
      staffInvolved: ["IT保障T", "后勤A", "前台R"],
      alerts: ["前台R有3份患者档案待补全联系方式", "建议下午班前完成资料归档"],
    },
  },

  // ── 区域 10：诊室管理 ─────────────────────────────
  consultRoom: {
    id: "consultRoom",
    title: "诊室管理",
    icon: "ClipboardList",
    status: "amber",
    metrics: [
      { label: "今日门诊量", value: "29", unit: "人" },
      { label: "当前诊室占用", value: "3", unit: "间" },
      { label: "医生平均诊时", value: "11", unit: "分钟" },
      { label: "候诊超时", value: "2", unit: "人" },
    ],
    liveNote: "医生D诊室占用率高，候诊区有2人超15分钟",
    detail: {
      subMetrics: [
        { label: "诊室1（医生D）", value: "使用中" },
        { label: "诊室2", value: "空闲" },
        { label: "诊室3", value: "清洁中" },
        { label: "单次平均诊时", value: "11分钟" },
        { label: "今日目标门诊", value: "40人" },
        { label: "完成进度", value: "72.5%" },
      ],
      staffInvolved: ["眼科医生D", "护士长N1", "护士N2"],
      alerts: ["候诊区2人等待超过15分钟", "诊室3清洁预计10:10完成，可提前准备下一轮"],
    },
  },

  // ── 区域 11：检查设备 ─────────────────────────────
  equipment: {
    id: "equipment",
    title: "检查设备",
    icon: "Microscope",
    status: "green",
    metrics: [
      { label: "在线设备", value: "12", unit: "台" },
      { label: "故障设备", value: "0", unit: "台" },
      { label: "今日使用次数", value: "186", unit: "次" },
      { label: "设备利用率", value: "78", unit: "%" },
    ],
    liveNote: "所有设备运行正常，利用率处于健康区间",
    detail: {
      subMetrics: [
        { label: "综合验光仪", value: "正常 ×3" },
        { label: "裂隙灯", value: "正常 ×2" },
        { label: "眼压计", value: "正常 ×2" },
        { label: "视野分析仪", value: "正常 ×1" },
        { label: "OCT", value: "正常 ×1" },
        { label: "角膜地形图", value: "正常 ×1" },
      ],
      staffInvolved: ["IT保障T", "视光师U", "视光师V"],
      alerts: ["设备耗材：裂隙灯2号灯泡使用时长已达2000小时，建议本周更换"],
    },
  },

  // ── 区域 12：配镜中心 ─────────────────────────────
  opticalCenter: {
    id: "opticalCenter",
    title: "配镜中心",
    icon: "Glasses",
    status: "amber",
    metrics: [
      { label: "今日配镜单", value: "15", unit: "单" },
      { label: "制作中", value: "6", unit: "单" },
      { label: "待取镜", value: "4", unit: "单" },
      { label: "平均制作时长", value: "45", unit: "分钟" },
    ],
    liveNote: "待取镜4单，其中1单客户等待超30分钟",
    detail: {
      subMetrics: [
        { label: "单光镜片", value: "9单" },
        { label: "渐变镜片", value: "4单" },
        { label: "隐形眼镜", value: "2单" },
        { label: "当日完成单", value: "9单" },
        { label: "超时制作", value: "1单" },
        { label: "退单数", value: "0单" },
      ],
      staffInvolved: ["视光师V", "视光师W", "出纳C"],
      alerts: ["1单渐变镜片超时，客户已等候32分钟，建议主动告知进度", "渐变镜片库存低，影响后续接单能力"],
    },
  },

  // ── 区域 13：患者体验 ─────────────────────────────
  patientExperience: {
    id: "patientExperience",
    title: "患者体验",
    icon: "Heart",
    status: "green",
    metrics: [
      { label: "今日满意度", value: "4.7", unit: "/5" },
      { label: "投诉受理", value: "0", unit: "件" },
      { label: "好评收集", value: "8", unit: "条" },
      { label: "回访完成率", value: "82", unit: "%" },
    ],
    liveNote: "患者满意度良好，暂无投诉，好评持续增加",
    detail: {
      subMetrics: [
        { label: "等待时长满意度", value: "3.8/5 ⚠️" },
        { label: "医生服务满意度", value: "4.9/5" },
        { label: "环境满意度", value: "4.6/5" },
        { label: "本周差评", value: "0件" },
        { label: "待回访患者", value: "12人" },
        { label: "主动好评引导率", value: "67%" },
      ],
      staffInvolved: ["前台R", "护士长N1", "线上运营O1"],
      alerts: ["等待时长满意度评分偏低，需结合拥堵改善", "有12名复诊患者待电话回访，建议下午班完成"],
    },
  },

  // ── 区域 14：儿童视力专区 ──────────────────────────
  pediatricVision: {
    id: "pediatricVision",
    title: "儿童视力专区",
    icon: "Baby",
    status: "green",
    metrics: [
      { label: "今日儿童接诊", value: "11", unit: "人" },
      { label: "OK镜复诊", value: "4", unit: "人" },
      { label: "角膜塑形适配", value: "2", unit: "人" },
      { label: "家长候诊", value: "8", unit: "人" },
    ],
    liveNote: "儿童专区运行平稳，OK镜随访进度正常",
    detail: {
      subMetrics: [
        { label: "6~12岁", value: "7人" },
        { label: "12~18岁", value: "4人" },
        { label: "近视度数>200°", value: "6人" },
        { label: "今日新建档", value: "3人" },
        { label: "OK镜验配进度", value: "按时" },
        { label: "家长满意度", value: "4.8/5" },
      ],
      staffInvolved: ["视光师V", "视光师W", "眼科医生D"],
      alerts: ["建议为3名新建档儿童安排专项生长档案录入"],
    },
  },

  // ── 区域 15：营销活动 ─────────────────────────────
  campaigns: {
    id: "campaigns",
    title: "营销活动",
    icon: "Megaphone",
    status: "green",
    metrics: [
      { label: "进行中活动", value: "2", unit: "项" },
      { label: "活动核销", value: "14", unit: "单" },
      { label: "到期提醒", value: "1", unit: "项" },
      { label: "活动转化率", value: "54", unit: "%" },
    ],
    liveNote: "「暑期护眼季」活动核销表现好，转化率达54%",
    detail: {
      subMetrics: [
        { label: "暑期护眼季（线下）", value: "核销11单" },
        { label: "小红书暑期套餐", value: "核销3单" },
        { label: "活动预算已用", value: "62%" },
        { label: "剩余有效期", value: "12天" },
        { label: "本周目标核销", value: "30单" },
        { label: "本周已完成", value: "14单" },
      ],
      staffInvolved: ["市场M", "线上运营O1", "线下运营O2"],
      alerts: ["「美团夏日套餐」将于7月5日到期，需确认续期或下架"],
    },
  },

  // ── 区域 16：排班与出勤 ──────────────────────────
  scheduling: {
    id: "scheduling",
    title: "排班与出勤",
    icon: "CalendarClock",
    status: "green",
    metrics: [
      { label: "今日应到人员", value: "17", unit: "人" },
      { label: "实际到岗", value: "16", unit: "人" },
      { label: "迟到/缺勤", value: "1", unit: "人" },
      { label: "加班预警", value: "2", unit: "人" },
    ],
    liveNote: "护士N2迟到已处理，下午班排班已就位",
    detail: {
      subMetrics: [
        { label: "上午班到岗", value: "16/17人" },
        { label: "下午班确认", value: "15人已确认" },
        { label: "今日请假", value: "1人（已补岗）" },
        { label: "加班预计时长", value: "视光师U +1.5h" },
        { label: "班次交接时间", value: "13:00" },
        { label: "下午班开始", value: "13:30" },
      ],
      staffInvolved: ["店长L", "护士长N1"],
      alerts: ["视光师U预计加班1.5小时，建议提前协调晚班替补", "下午班交接前需提前30分钟通知所有当班人员"],
    },
  },

  // ── 区域 17：培训与合规 ──────────────────────────
  training: {
    id: "training",
    title: "培训与合规",
    icon: "GraduationCap",
    status: "green",
    metrics: [
      { label: "本月培训完成", value: "4", unit: "场" },
      { label: "待完成培训", value: "1", unit: "场" },
      { label: "合规检查项", value: "12", unit: "项" },
      { label: "未达标项", value: "0", unit: "项" },
    ],
    liveNote: "合规检查全部达标，月度培训进度正常",
    detail: {
      subMetrics: [
        { label: "视光技能培训", value: "已完成" },
        { label: "客户服务培训", value: "已完成" },
        { label: "急救知识培训", value: "本周五待完成" },
        { label: "证件有效期检查", value: "全部有效" },
        { label: "感染控制检查", value: "达标" },
        { label: "医疗废物记录", value: "规范" },
      ],
      staffInvolved: ["培训专员K", "护士长N1", "店长L"],
      alerts: ["急救培训（7月4日）需提前通知全员参与，请确认场地预订"],
    },
  },

  // ── 区域 18：环境与设施 ──────────────────────────
  facilityEnv: {
    id: "facilityEnv",
    title: "环境与设施",
    icon: "Building2",
    status: "green",
    metrics: [
      { label: "环境整洁度", value: "优", unit: "" },
      { label: "候诊区温度", value: "24", unit: "℃" },
      { label: "今日消毒记录", value: "2", unit: "次" },
      { label: "设施故障", value: "0", unit: "项" },
    ],
    liveNote: "环境状态良好，已完成上午消毒，候诊区舒适",
    detail: {
      subMetrics: [
        { label: "前台接待区", value: "整洁" },
        { label: "候诊区座位使用率", value: "82%" },
        { label: "卫生间状态", value: "正常" },
        { label: "空调运行", value: "正常" },
        { label: "照明设备", value: "正常" },
        { label: "下次消毒计划", value: "12:30" },
      ],
      staffInvolved: ["后勤A", "线下运营O2"],
      alerts: ["候诊区座位利用率82%，高峰期建议引导患者到副候诊区等待"],
    },
  },
};

export const PANEL_ORDER = [
  "patientFlow",
  "queueCongestion",
  "staffStatus",
  "clinicalExec",
  "operations",
  "finance",
  "inventory",
  "marketing",
  "backendSupport",
  "consultRoom",
  "equipment",
  "opticalCenter",
  "patientExperience",
  "pediatricVision",
  "campaigns",
  "scheduling",
  "training",
  "facilityEnv",
];

export const EVENT_STREAM_INITIAL = [
  {
    id: 1,
    time: "09:42",
    type: "critical",
    icon: "AlertTriangle",
    message: "检查区等待时间已超过阈值，当前均值28分钟，建议立即补位。",
    actionRequired: true,
  },
  {
    id: 2,
    time: "09:39",
    type: "info",
    icon: "User",
    message: "前台R有 3 份患者资料待补齐联系信息，影响后续回访。",
    actionRequired: false,
  },
  {
    id: 3,
    time: "09:35",
    type: "warning",
    icon: "Clock",
    message: "视光师U本场已接诊14人，超出额定上限，当前高负荷运行。",
    actionRequired: false,
  },
  {
    id: 4,
    time: "09:31",
    type: "success",
    icon: "CheckCircle",
    message: "今日营收已完成目标85%（¥34,820），收款进度正常。",
    actionRequired: false,
  },
  {
    id: 5,
    time: "09:28",
    type: "info",
    icon: "Package",
    message: "渐变镜片库存仅剩23片，采购J已发起补货，预计今日14:00到货。",
    actionRequired: false,
  },
];

export const EVENT_STREAM_QUEUE = [
  {
    id: 10,
    type: "critical",
    icon: "Zap",
    message: "视光师X当前空闲已20分钟，可立即支援检查区，预计等待时间降至15分钟。",
    actionRequired: true,
    suggestion: true,
  },
  {
    id: 11,
    type: "warning",
    icon: "AlertCircle",
    message: "请店长确认是否调整排班：将视光师X调入检查区3号位支援。",
    actionRequired: true,
    awaitConfirm: true,
  },
  {
    id: 12,
    type: "info",
    icon: "TrendingUp",
    message: "线上运营O1报告：小红书今日新增8条咨询，2条超过1小时未回复。",
    actionRequired: false,
  },
  {
    id: 13,
    type: "info",
    icon: "Users",
    message: "预约提醒：下午13:30有12名患者预约到诊，建议13:00完成中午交接。",
    actionRequired: false,
  },
  {
    id: 14,
    type: "warning",
    icon: "Clock",
    message: "眼科医生D已连续工作3.5小时，建议在11:30安排短暂休息。",
    actionRequired: false,
  },
  {
    id: 15,
    type: "success",
    icon: "CheckCircle",
    message: "库存补货订单已确认发货，后勤A请于14:00前准备收货区域。",
    actionRequired: false,
  },
];

export const NAV_ITEMS = [
  { id: "overview", label: "总览", icon: "LayoutDashboard" },
  { id: "patientFlow", label: "患者流转", icon: "Users" },
  { id: "queueCongestion", label: "排队拥堵", icon: "AlertTriangle" },
  { id: "staffStatus", label: "员工状态", icon: "UserCheck" },
  { id: "clinicalExec", label: "临床执行", icon: "Stethoscope" },
  { id: "operations", label: "运营调度", icon: "Zap" },
  { id: "finance", label: "财务收款", icon: "CircleDollarSign" },
  { id: "inventory", label: "采购库存", icon: "Package" },
  { id: "marketing", label: "市场线索", icon: "TrendingUp" },
  { id: "backendSupport", label: "后台支撑", icon: "Server" },
  { id: "consultRoom", label: "诊室管理", icon: "ClipboardList" },
  { id: "equipment", label: "检查设备", icon: "Microscope" },
  { id: "opticalCenter", label: "配镜中心", icon: "Glasses" },
  { id: "patientExperience", label: "患者体验", icon: "Heart" },
  { id: "pediatricVision", label: "儿童视力", icon: "Baby" },
  { id: "campaigns", label: "营销活动", icon: "Megaphone" },
  { id: "scheduling", label: "排班出勤", icon: "CalendarClock" },
  { id: "training", label: "培训合规", icon: "GraduationCap" },
  { id: "facilityEnv", label: "环境设施", icon: "Building2" },
];