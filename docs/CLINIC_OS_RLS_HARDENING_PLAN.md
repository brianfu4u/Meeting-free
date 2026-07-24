# Clinic OS — 多租户行级权限（RLS）加固专项方案

> 阶段：**评估与方案阶段（Phase A），不立即上线**  
> 日期：2026-07-25  
> 前提确认：本文档不修改任何 `base44/entities/*.jsonc` 的 `rls` 配置；待方案确认后再逐实体灰度上线。  
> 编写依据：Base44 RLS 编写指南（已加载为本轮权威指引）

---

## 第一步：摸底

### 1.1 实体 clinic_id 字段矩阵（34 实体）

扫描结果：**33 个实体含 `clinic_id` 字段，1 个不含**。

| 含 clinic_id（33） | 不含 clinic_id（1） |
| :--- | :--- |
| AgentAttachIntent, Alert, Artifact, AttachDecisionLog, AttentionItem, AuditLog, BusinessLineFlow, ClinicConfig, CompositionRun, CorrectionCapture, DailyReport, EvidenceFactCard, EvidenceItem, FragmentProcessingResult, GuessPolicy, HardLinkShareLedger, InventoryItem, ManagerDecision, NegativeConstraint, OperationalTask, PatientSession, RevenueRecord, RevenueTarget, ScanEvent, Staff, StaffRequest, SystemSpec, UndoListItem, Workflow, WorkflowArtifactLink, WorkflowCommitIntent, WorkflowHypothesis, WorkflowSnapshot | **User** |

**User 不含 clinic_id 的原因**：User 是平台内置实体，由平台自有权限管理（仅 admin 可管理其他用户），且按 RLS 指南，`User` 上的顶层 `rls` 不被平台应用——应依赖内置权限而非自定义 RLS。User 当前 schema 仅有 `role`（admin/user）。

### 1.2 关键前置缺口：User 无 `clinic_id` 自定义字段

租户级 RLS 的标准规则形态是：
```jsonc
{ "data.clinic_id": "{{user.data.clinic_id}}" }
```
模板 `{{user.data.clinic_id}}` 取当前用户的 `clinic_id` 自定义字段。**当前 User 实体无此字段** → 模板解析为 `null` → 匹配 `clinic_id == null` 的记录 → **所有真实记录（clinic_id 非空）对所有人不可见 → 全员锁死**。

**这是任何 RLS 上线前的硬前置**：必须先给 User 增 `clinic_id` 自定义字段并为每位用户填充（绑定/入职时 `base44.auth.updateMe({ clinic_id })`，存量用户一次性回填）。未完成此前置，任何 `data.clinic_id` 规则都会锁死。

当前应用通过 `Staff.user_id → Staff.clinic_id` 间接解析用户所属诊所（见 `src/lib/staffPad/useStaffSelf.js`、`base44/shared/clinicActor.ts`），而非 user 属性。RLS 需将该关系"固化"到 User 上。

### 1.3 前端"裸调用"清单（57 处，16 实体）

> 定义：前端 `src/` 内直接调用 `base44.entities.X.<op>()`、未经后端函数做 clinic_id 校验的位置。  
> 这些是**真正暴露跨租户风险**的地方：绕过后端函数的 `assertTenantScope`，直连数据库，平台默认开放。  
> 注：后端函数用 `asServiceRole` 调用实体，**asServiceRole 绕过 RLS**——故 RLS 仅约束"前端 app-user 直连"，对后端逻辑无影响。

| 实体 | 调用数 | 操作 | 前端文件 |
| :--- | :---: | :--- | :--- |
| Staff | 12 | filter×7, delete×2, create×2, update×1 | StaffManagement, StaffOnboarding, PerformanceReport, Phase5Smoke, intelligenceHub.js, useStaffSelf.js, useClinicData.js, BindingScreen.jsx, ClockBar.jsx |
| PatientSession | 7 | filter×5, get×1, update×1 | AnalyticsDashboard, scanGate.js, intelligenceHub.js, useClinicData.js, DailyReviewPanel |
| AttentionItem | 7 | create×3, filter×3, update×1 | intelligenceHub.js, useClinicData.js, AttentionQueue.jsx |
| OperationalTask | 6 | filter×5, create×1 | AnalyticsDashboard, PerformanceReport, useClinicData.js, DailyReviewPanel, AttentionQueue.jsx, EventStreamMarquee |
| ClinicConfig | 5 | filter×3, update×1, create×1 | ClinicSettings, Phase5Smoke, useClinicData.js, CompositionSchedulerHealth |
| WorkflowSnapshot | 5 | filter×3, update×2 | useClinicData.js, WorkflowClosureView, WorkflowSnapshotPanel |
| BusinessLineFlow | 2 | filter×1, update×1 | ClinicSettings |
| RevenueRecord | 2 | filter×2 | AnalyticsDashboard, DailyReviewPanel |
| AuditLog | 2 | create×1, filter×1 | eventBus.js, useClinicData.js |
| InventoryItem | 2 | filter×2 | intelligenceHub.js, useClinicData.js |
| EvidenceItem | 2 | filter×1, update×1 | intelligenceHub.js |
| ScanEvent | 1 | create×1 | scanGate.js |
| Alert | 1 | filter×1 | useClinicData.js |
| RevenueTarget | 1 | filter×1 | useClinicData.js |
| UndoListItem | 1 | filter×1 | useClinicData.js |
| EvidenceFactCard | 1 | filter×1 | EventStreamMarquee |

**其余 18 个实体**（Artifact, AttachDecisionLog, CompositionRun, CorrectionCapture, DailyReport, FragmentProcessingResult, GuessPolicy, HardLinkShareLedger, ManagerDecision, NegativeConstraint, SystemSpec, Workflow, WorkflowArtifactLink, WorkflowCommitIntent, WorkflowHypothesis, AgentAttachIntent 等）**无前端裸调用**——仅经后端函数（asServiceRole）访问。对它们加 RLS 对当前行为**零影响**（asServiceRole 绕过 RLS），属纯防御纵深，锁定风险极低。

---

## 第二步：分级方案

### 2.1 分级原则

| 档位 | 含义 | 错配后果 |
| :--- | :--- | :--- |
| **P0** | 患者与财务数据；跨租户泄露=合规/隐私事故 | 锁死=店长看不到患者/营收，业务停摆 |
| **P1** | 运营核心（员工/任务/工作流/审计）；跨租户=运营混乱 | 锁死=看板空白、调度失能 |
| **P2** | 诊所配置与策略；错配锁死本店店长自身 | 锁死=店长无法改自家配置 |
| **P3** | 审计/埋点账本（只追加、读为主）；错配影响观测非业务 | 锁定=观测盲区，不影响业务 |

### 2.2 前置依赖（所有档位共用，必须先完成）

**D0. User.clinic_id 字段与回填**（P0 上线前的硬门禁）
1. `base44/entities/User.jsonc` 增 `clinic_id` 字段（string，非必填过渡期）。
2. 入职绑定流程（`BindingScreen.jsx` / `StaffOnboarding`）在绑定 Staff 成功后调 `base44.auth.updateMe({ clinic_id })` 写入。
3. 存量用户一次性回填脚本：按 `Staff.user_id → clinic_id` 反查，逐用户 `updateMe`。
4. **门禁**：抽样确认每位活跃用户的 `me().clinic_id` 非空后，才允许进入 P0。

### 2.3 各档 RLS 规则草案

> 统一形态（33 个含 clinic_id 实体通用）：
> ```jsonc
> "rls": {
>   "read":   { "data.clinic_id": "{{user.data.clinic_id}}" },
>   "create": { "data.clinic_id": "{{user.data.clinic_id}}" },
>   "update": { "data.clinic_id": "{{user.data.clinic_id}}" },
>   "delete": { "data.clinic_id": "{{user.data.clinic_id}}" }
> }
> ```
> 说明：按 RLS 指南多租户模式，read/update/delete + create 全覆盖，防止跨租户读、跨租户植记录。平台 `user.role=admin` 为构建者级 admin，本产品无"跨诊所管理员"角色，故**不加 admin 绕过分支**（加则店长间互相可见，违背初衷）。

#### P0 — 患者与财务（8 实体，第一批）

| 实体 | 前端裸调用 | 错配锁死影响 | 受影响页面 |
| :--- | :--- | :--- | :--- |
| PatientSession | 有（7处） | 看板无患者、看板空 | Dashboard, AnalyticsDashboard, DailyReviewPanel, scanGate |
| ScanEvent | 有（create） | 扫码不入库 | scanGate（StaffPad） |
| Artifact | **无**（仅后端） | 零业务影响（asServiceRole 绕过） | 无（纯纵深） |
| EvidenceFactCard | 有（filter） | 走马灯无证据 | EventStreamMarquee |
| EvidenceItem | 有（filter+update） | 证据评估失效 | intelligenceHub |
| RevenueRecord | 有（filter） | 营收看板空 | AnalyticsDashboard, DailyReviewPanel |
| RevenueTarget | 有（filter） | 目标不显示 | useClinicData（Dashboard） |
| DailyReport | **无**（仅后端） | 零业务影响 | 无（纯纵深） |

**锁死风险评估**：8 个全部依赖 D0 完成。PatientSession/RevenueRecord/RevenueTarget 锁死会让看板直接空白——最高可见度，也是最高优先级。Artifact/DailyReport 无前端调用，锁定风险≈0。

#### P1 — 运营核心（17 实体，第二批）

| 实体 | 前端裸调用 | 错配锁死影响 | 受影响页面 |
| :--- | :--- | :--- | :--- |
| Staff | 有（12处，最多） | 终端绑定失败、人员看板空 | StaffManagement, StaffOnboarding, BindingScreen, ClockBar, PerformanceReport |
| OperationalTask | 有（6处） | 任务流空、AttentionQueue 创建任务失败 | AttentionQueue, AnalyticsDashboard, DailyReviewPanel |
| AttentionItem | 有（7处） | 注意力队列空 | AttentionQueue |
| WorkflowSnapshot | 有（5处，含 update×2） | 闭环视图空、闭环按钮失败 | WorkflowClosureView, WorkflowSnapshotPanel |
| AuditLog | 有（create+filter） | 事件流空 | EventStream, useClinicData |
| Alert | 有（filter） | 告警面板空 | useClinicData |
| InventoryItem | 有（filter） | 库存面板空 | FourDimensionsPanel（经 useClinicData） |
| StaffRequest | 有（经 intelligenceHub） | 员工请求不可见 | StaffPad |
| UndoListItem | 有（filter） | 孤儿结案区空 | AttentionQueue（Phase 2b） |
| Workflow | 无（仅后端） | 零业务影响 | 无 |
| WorkflowHypothesis | 无 | 零 | 无 |
| WorkflowArtifactLink | 无 | 零 | 无 |
| WorkflowCommitIntent | 无 | 零 | 无 |
| AgentAttachIntent | 无 | 零 | 无 |
| ManagerDecision | 无 | 零 | 无 |
| CompositionRun | 无 | 零 | 无 |
| FragmentProcessingResult | 无 | 零 | 无 |

**锁死风险评估**：Staff（12 处）锁死=员工无法登录绑定，影响面最大；WorkflowSnapshot 的 update×2（闭环按钮）若锁死，店长无法闭环——需重点验证。无前端调用的 8 个实体（Workflow/Hypothesis/Link/CommitIntent/AgentAttachIntent/ManagerDecision/CompositionRun/FragmentProcessingResult）锁定风险≈0，可随 P1 一并上线作纵深。

#### P2 — 诊所配置与策略（4 实体，第三批）

| 实体 | 前端裸调用 | 错配锁死影响 | 受影响页面 |
| :--- | :--- | :--- | :--- |
| ClinicConfig | 有（filter×3, update×1, create×1） | 店长改不了自家配置、调度健康面板空 | ClinicSettings, CompositionSchedulerHealth |
| BusinessLineFlow | 有（filter+update） | 业务线配置不可改 | ClinicSettings |
| GuessPolicy | 无（仅后端 guessPolicyService） | 零业务影响 | 无（纯纵深） |
| SystemSpec | 无（仅后端 specLoaderService） | 零业务影响 | 无（纯纵深） |

**锁死风险评估**：ClinicConfig 锁死=店长无法管理本店设置（最痛），但只影响本店店长自己，不跨租户。GuessPolicy/SystemSpec 无前端调用，风险≈0。

#### P3 — 审计与埋点账本（4 实体，第四批）

| 实体 | 前端裸调用 | 错配锁死影响 |
| :--- | :--- | :--- |
| AttachDecisionLog | 无 | 零（仅后端写入） |
| CorrectionCapture | 无 | 零 |
| NegativeConstraint | 无 | 零 |
| HardLinkShareLedger | 无 | 零 |

**锁死风险评估**：4 个全部无前端调用、仅后端 asServiceRole 写入。加 RLS 对当前行为零影响，纯防未来直连。可最后批量上线。

### 2.4 不上 RLS 的实体

- **User**：平台内置，顶层 `rls` 不被应用，依赖平台内置权限（admin 管理其他用户）。**不加 RLS**。

---

## 第三步：验证与回滚

### 3.1 通用验证矩阵（每条规则上线前必跑）

| 用例 | 预期 |
| :--- | :--- |
| 本店店长/员工读自己诊所记录 | 正常返回（非空） |
| 本店店长/员工尝试传 `clinic_id=他人诊所` filter | 返回空（RLS 服务端再过滤） |
| 本店用户 create 时不带 clinic_id 或带他人 clinic_id | 记录写入被拒或被改写为本店 clinic_id（依 create 规则 `data.clinic_id: {{user.data.clinic_id}}`，不匹配则拒） |
| 本店用户 update/delete 他人诊所记录（构造他人 id） | 拒绝（update/delete 规则按 existing record 的 clinic_id 比对） |
| 跨诊所用户（模拟第二家诊所用户）看不到 clinic-001 数据 | 返回空 |
| 后端函数（asServiceRole）行为不变 | 不受 RLS 影响，逻辑全绿 |

### 3.2 各档专属验证用例

**P0**
- PatientSession：clinic-001 店长看到 clinic-001 患者；模拟 clinic-002 用户 filter 返回空。
- RevenueRecord/Target：同上。营收看板数字不串店。
- ScanEvent：clinic-001 StaffPad 扫码入库成功；clinic-002 用户扫码被拒。
- Artifact/DailyReport（无前端）：后端 compositionOrchestrator/DailyReport 生成逻辑不变（asServiceRole 绕过）。

**P1**
- Staff：clinic-001 新员工绑定 BindingScreen 成功（create 通过）；clinic-002 用户无法 filter 到 clinic-001 员工。
- WorkflowSnapshot update（闭环按钮）：clinic-001 店长能闭环自家快照；构造 clinic-002 snapshot_id update 被拒。
- AttentionItem：clinic-001 AttentionQueue 显示本店项；create 时 clinic_id 不符被拒。

**P2**
- ClinicConfig：clinic-001 店长能改自家配置；看不到 clinic-002 配置。
- GuessPolicy/SystemSpec（无前端）：后端服务逻辑不变。

**P3**：无前端，仅验证后端日志/账本写入不变。

### 3.3 回滚方案

**核心机制**：RLS 配置在 `base44/entities/<Name>.jsonc` 保存后**立即生效**。回滚=移除该实体的 `rls` 段（或将四操作改回 `{}`/省略），保存即恢复开放。

**逐实体回滚（精确，不影响其他已生效规则）**：
1. 编辑 `base44/entities/<受影响实体>.jsonc`，删除其 `rls` 整段（或置 `rls: {}`）。
2. 保存——该单实体立刻恢复平台默认开放，其余实体 RLS 不动。
3. 因 RLS 仅约束前端 app-user，回滚后前端该实体恢复全量可见；后端逻辑全程不受影响（asServiceRole）。

**全量紧急回滚**：如多条规则同时出问题，逐实体删除 `rls` 段即可；无需"全局开关"。

**回滚触发条件**（任一即立即回滚该实体）：
- 店长/员工反馈"看板空白"且确认 user.data.clinic_id 已正确填充；
- 验证矩阵中"本店用户读自己诊所"返回空；
- 任一受影响页面核心功能因 RLS 报错。

**回滚演练**：每档上线前，先在受影响实体上预演一次"加规则→验证失败→删规则恢复"全流程，确认回滚路径通畅再正式加。

---

## 第四步：交付物清单

| 交付物 | 状态 | 位置 |
| :--- | :--- | :--- |
| 实体 clinic_id 字段矩阵（34） | ✓ 完成 | 本文档 §1.1 |
| 关键前置缺口（User.clinic_id） | ✓ 已识别 | 本文档 §1.2 |
| 前端裸调用清单（57 处/16 实体） | ✓ 完成 | 本文档 §1.3 |
| 分级方案（P0/P1/P2/P3 + 规则草案 + 锁死影响 + 受影响页面） | ✓ 完成 | 本文档 §2 |
| 验证用例（通用 + 各档专属） | ✓ 完成 | 本文档 §3.1–3.2 |
| 回滚方案（逐实体 + 触发条件 + 演练） | ✓ 完成 | 本文档 §3.3 |
| 实体 RLS 配置修改 | **未执行**（Phase A 不动配置） | — |

---

## 建议上线顺序与门禁

```
[D0: User.clinic_id 字段 + 回填 + 验证 me().clinic_id 全员非空]
   └─ 门禁：抽样确认每位活跃用户 clinic_id 已填充
        ↓
[P0: 8 实体（患者+财务）]  ← 风险最高，先小批量验证
   └─ 门禁：§3.1 通用矩阵 + P0 专属全绿，店长看板正常
        ↓
[P1: 17 实体（运营核心）]  ← Staff 12 处需重点验证绑定流
   └─ 门禁：Staff 绑定、WorkflowSnapshot 闭环 update 全绿
        ↓
[P2: 4 实体（配置+策略）]
   └─ 门禁：ClinicConfig 店长改自家设置正常
        ↓
[P3: 4 实体（审计账本）]  ← 无前端调用，批量上线
```

**每档上线建议**：单档内先上"无前端裸调用"的实体（锁定风险≈0），再上"有前端调用"的实体（逐个验证）。每条规则上线后留 24h 观察窗再进下一条。

**待决策项（需用户确认后进入实施）**：
1. 是否同意增 `User.clinic_id` 自定义字段 + 回填（D0 前置）？
2. 平台 `user.role=admin` 是否需要跨诊所可见？（当前方案：否，不加 admin 绕过）
3. P0 优先上哪 1–2 个实体做试点？（建议 PatientSession + RevenueRecord，因风险最高且前端调用密集）