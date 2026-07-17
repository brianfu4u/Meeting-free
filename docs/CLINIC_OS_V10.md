# Clinic OS V10 — 架构升级宪法

**升级日期：** 2026-07-17  
**基础哲学文件：** ClinicOSSystemPhilosophy.pdf (2026-07-17)  
**版本变更原因：** V9 存在 AI 越权与推理层直接操作原始证据两大宪法冲突，V10 进行根本性修正。

---

## 与哲学文件的差异对照（V9 vs V10）

| 哲学原则 | V9 违规点 | V10 修正 |
|---------|----------|---------|
| AI never changes clinic state | staffReportService 自动创建 Task 并改变 status | AI 仅生成 Recommendation，Manager 确认后系统才变更状态 |
| Reasoning never operates on raw evidence | LLM 直接接收附件 URL 进行分析 | 附件必须先经 Evidence Normalizer 转为结构化 Event，再进入推理层 |
| The objective is surfacing only what deserves attention | Dashboard 展示所有事件流 | Dashboard 仅展示 Attention Queue（需要店长介入的情境） |
| Every recommendation must be explainable | AI 建议无溯源链 | 每条建议必须携带 evidence_ids + event_ids + reasoning_chain |
| AI recommends; humans decide | LLM 自动触发 StaffRequest 创建 | LLM 输出建议卡片，店长三选一（执行/忽略/升级）后才产生动作 |

---

## V10 三层架构

```
【采集层 Collection Layer】
  原始证据（照片/语音/扫码/文字）
       ↓ EvidenceNormalizer
  结构化 Event（clinic_id + event_type + timestamp + entity_refs）
       ↓ 存入 AuditLog（不可变）

【推理层 Reasoning Layer】
  Events → JourneyMapper（患者旅程拼接）
       ↓
  JourneyMapper → GapDetector（缺失节点检测）
       ↓
  GapDetector → AttentionEngine（LLM 生成建议）
       ↓
  输出：AttentionItem（建议卡片，含完整溯源链）

【展示层 Presentation Layer】
  AttentionQueue（仅展示 open 状态的 AttentionItem）
  店长动作：execute / ignore / escalate
  动作确认后 → 产生实际的 Task / Alert 变更
```

---

## V10 核心实体变更

### 新增：AttentionItem（注意力队列项）

```json
{
  "clinic_id": "string — 宪法级隔离",
  "session_id": "string? — 关联患者旅程（可空）",
  "attention_type": "journey_gap | evidence_missing | contradiction | resource_risk | wait_timeout",
  "urgency": "yellow | red",
  "title": "string — 一句话标题（≤20字）",
  "reasoning": "string — LLM 推理过程（可展开查看）",
  "evidence_ids": ["string"] — 支撑本建议的 EvidenceItem ID 列表",
  "event_ids": ["string"] — 支撑本建议的 AuditLog event_id 列表",
  "recommendation": "string — AI 建议的具体行动",
  "status": "open | executed | ignored | escalated",
  "manager_action": "execute | ignore | escalate | null",
  "manager_note": "string?",
  "decided_at": "datetime?",
  "generated_at": "datetime"
}
```

### 修改：OperationalTask
- 移除：AI 自动创建路径
- 新增：`attention_item_id` — 每个 Task 必须溯源到一个被店长批准的 AttentionItem
- `dispatched_by` 枚举移除 `llm_agent`，仅保留 `manager` / `staff_self`

### 修改：StaffRequest
- 移除：AI 自动创建路径（staffReportService 不再直接创建 StaffRequest）
- 新增：`attention_item_id` — 溯源字段

---

## V10 数据流：员工汇报的正确路径

```
员工汇报（文字/语音/图片）
  → staffReportService（采集层）
  → 附件上传到 Storage（不可变存储）
  → EvidenceItem 创建（evidence_type + file_url + 转写文字）
  → LLM 将 EvidenceItem 转化为结构化 Event（写入 AuditLog）
  → JourneyMapper 更新对应 PatientSession 的旅程图
  → GapDetector 检测是否出现缺口
  → 若有缺口 → AttentionEngine 生成 AttentionItem
  → Dashboard AttentionQueue 展示（店长看到）
  → 店长选择 execute → 系统创建 Task（此刻才改变 clinic state）
```

---

## V10 终端执行模型（Sub-Agent Isolation & Stream Processing）

### 原则 1：逻辑上的完全封闭（Sub-Agent Isolation）

每一个终端（StaffPad）背后服务的 Agent 是该终端的**专属代理**，它只负责：
- 接收该终端发来的流（Stream）
- 处理该终端的数据
- **不感知其他终端的状态**

这与 Clinic OS "分级治理"思想一致，避免单体系统的逻辑耦合与资源争抢。

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  StaffPad A  │     │  StaffPad B  │     │  StaffPad C  │
│  (视光师X)   │     │  (护士N1)    │     │  (前台R2)    │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
   ┌───▼───┐           ┌───▼───┐           ┌───▼───┐
   │Agent A│           │Agent B│           │Agent C│   ← 沙箱隔离，互不通信
   └───┬───┘           └───┬───┘           └───┬───┘
       │                   │                   │
       └───────────┬───────┴───────────┬────────┘
                   │  Event Bus       │
              ┌────▼─────────────────▼────┐
              │   共享数据库层（Entities）    │  ← 唯一同步通道
              │   AuditLog / PatientSession │
              └────────────────────────────┘
```

**硬约束：**
- ❌ Agent 之间禁止直接握手或函数调用
- ❌ Agent A 不能查询 Agent B 的内部状态
- ✅ 所有状态同步必须通过 Entities 订阅（Subscription）实现

### 原则 2：数据流的去中心化（Stream Processing）

终端产出的不是"指令"，而是"事件流"（Event Stream）。后端服务（`staffReportService` 及未来相关逻辑）是**高性能监听器（Listener / Event Processor）**，只负责：

1. **标准化入库** — 将 Stream 转化为统一格式的 AuditLog
2. **即时触发** — 流中出现特定特征（异常、求援）时，立即调用对应因果链技能（检查 ScanEvent、触发告警）
3. **无状态处理** — Sub-Agent 间不沟通，所有状态同步通过共享数据库层（Entities）实现

### 原则 3：Event Bus 命名空间（解耦设计）

所有终端事件采用分层命名空间，确保中央指挥台能监听，各 Sub-Agent 互不干扰：

```
命名格式：{clinic_id}/{terminal_type}/{staff_id}/{event_type}

示例：
  clinic-001/staff-pad/staff-001/report_submitted
  clinic-001/staff-pad/staff-001/status_changed
  clinic-001/scan-gate/qr-20260717-0001/node_scanned
  clinic-001/manager-console/attention/resolved
```

- 中央指挥台订阅 `clinic-001/*` 全量（用于 Dashboard 汇总）
- 各 Sub-Agent 仅订阅自己的命名空间（`clinic-001/staff-pad/staff-001/*`）
- Agent 之间永远不直接订阅对方的命名空间

### 原则 4：Pipeline 编排（轻量级检查点框架）

每个进入系统的 Stream 自动"流过"预设检查点，基于 AuditLog 触发器实现：

```
Stream 进入
  → ① 解析（Parse）：非结构化 → 结构化 Event
  → ② 校验（Validate）：clinic_id 隔离 + 身份绑定校验
  → ③ 归档（Persist）：写入 AuditLog（不可变）
  → ④ 关联（Connect）：关联到 PatientSession 旅程
  → ⑤ 告警判断（Detect）：检测异常特征 → 生成 AttentionItem
  → ⑥ 自动反馈（Notify）：向终端推送确认回执
```

**Pipeline 触发规则（V10 阶段）：**
- 检查点 ①~④：所有 Stream 必经（采集层 + 推理层基础）
- 检查点 ⑤：仅关键业务 Stream 触发（基于 PatientSession 锚点），避免对简单打卡等非关键流进行无谓的语义压缩
- 检查点 ⑥：所有 Stream 必经（终端需感知"系统已收到"）

### V10 实施约束（写入代码的硬规则）

| 约束 | 实现方式 | 验证点 |
|-----|---------|-------|
| Sub-Agent 隔离 | `staffReportService` 只处理传入的 `staff_id` 对应数据，不查询其他 Staff 记录 | 代码中无跨 staff_id 的查询 |
| 无状态处理 | service 函数不持有跨请求的状态变量，每次调用独立 | 无模块级可变状态 |
| Event Bus 命名 | AuditLog.event_id 遵循 `{clinic}/{terminal}/{staff}/{type}` 格式 | event_id 生成规则统一 |
| 唯一同步通道 | 终端感知其他终端变化只能通过 `base44.entities.X.subscribe()` | 无 Agent 间直接调用 |
| Pipeline 检查点 | staffReportService 内部按 6 步顺序执行，每步独立可测 | 步骤间无跳过 |

---

## V10 AI 四项职责（严格对应哲学文件）

1. **观察证据（Observe）** — 接收原始汇报，上传存储，不做任何判断
2. **转化结构（Normalize）** — 将非结构化证据转为标准 Event（只做格式转换，不做推理）
3. **连接旅程（Connect）** — 将 Events 关联到 PatientSession，识别旅程节点
4. **推荐关注（Recommend）** — 检测缺口，生成 AttentionItem，附完整溯源链

**AI 绝对禁止的操作（V10 硬约束）：**
- ❌ 创建或修改 OperationalTask
- ❌ 创建或修改 StaffRequest
- ❌ 修改 PatientSession 状态
- ❌ 修改 Staff 状态
- ❌ 生成没有 evidence_ids 的建议

---

## V10 Dashboard 核心原则：注意力优先

**展示规则：**
- 默认视图：仅展示 `status: open` 的 AttentionItem（按 urgency 排序）
- 红色 = 需要立即响应（15分钟内）
- 黄色 = 需要今日内关注
- 灰色背景 = 系统正常运行中（无需展示细节）
- 店长可下钻：点击 AttentionItem → 展示完整溯源链（evidence → event → journey gap → recommendation）

**禁止的展示行为：**
- ❌ 展示所有原始事件流（太多 = 噪音）
- ❌ 展示 AI 自动执行的动作（违反 Human Authority）
- ❌ 展示没有溯源链的建议

---

## V10 成功标准（继承哲学文件）

```
店长在任何时刻都能回答这一个问题：
"我的诊所现在发生了什么，我应该把注意力放在哪里？"

当这个问题能被 AttentionQueue 在 3 秒内清晰回答时，V10 成功。
```

---

## V10 开发优先级（Phase 1 目标）

| 优先级 | 任务 | 对应哲学原则 |
|-------|-----|------------|
| P1 | AttentionItem 实体创建 | Manager Attention |
| P1 | staffReportService 重构：AI 不再自动创建 Task | Human Authority |
| P1 | AttentionQueue 组件（Dashboard 核心视图替换） | Manager Attention |
| P2 | EvidenceNormalizer：证据 → Event 两步分离 | Evidence First |
| P2 | AttentionItem 下钻视图（溯源链展示） | Explainability |
| P3 | JourneyMapper：患者旅程图谱 | Progressive Intelligence Phase 2 |

---

*本文件为 Clinic OS V10 的最高执行依据。任何代码与本文件冲突时，以本文件为准，直至新 ADR 取代。*