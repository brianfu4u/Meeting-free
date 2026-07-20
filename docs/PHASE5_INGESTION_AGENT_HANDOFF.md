# Phase 5 解析站 → Agent 报到契约对齐说明（两段式异步版）

**作者**：解析站（fragmentIngestionService）开发方
**致**：Composition Agent / compositionOrchestrator 开发方
**日期**：2026-07-20
**状态**：双方已确认采用两段式异步流程 → 进入契约编码阶段
**适用范围**：`mock_mode=true`、`synthetic_multimodal_e2e=true`

---

## 0. 两段式异步流程总览（双方已确认）

1. **Stage 1 解析站（上传即解析，不等待 Agent）**
   - 用户上传后，`fragmentIngestionService` 立即完成多模态解析，生成标准 `Artifact` 与 `EvidenceFactCard`。
   - 解析站**不主动触发** `CompositionRun`，**不创建、挂载或关闭** `Workflow`。
   - 解析成功且质量门通过（`alignment_status="aligned"`）的 FactCard 标记 `assembly_eligible=true`，**等待** Agent 在固定时段扫描取货。

2. **Stage 2 Agent（定时扫描取货，不实时订阅）**
   - Composition Agent 按既定时段运行；到点后扫描新的合格 FactCard，完成编组判断。
   - Agent 是否已处理某张 FactCard，由 `CompositionRun` 的 `artifact_ids_processed`、`cutoff`、`policy_version` 与 `idempotency_key` 判定；**不得**通过把 `assembly_eligible` 改为 `false` 表示消费。
   - 无需实现实时订阅，无需改变 Agent 当前定时表。

3. **本轮交付边界**
   - 此轮**只更新**：handoff 契约、契约测试、隔离联调脚本。
   - 此轮**不得修改**：Phase 1–4 推理规则、经理职责、Workflow closure 语义、生产运行时段。

---

## 一、背景与遗留缺陷（待 Stage 2 启用前补齐）

### 缺陷 1：`source_event_id` 已定义但未填充
- `Artifact.jsonc` 定义了 `source_event_id`（产出本碎片的 AuditLog event_id，溯源链入口）。
- `fragmentIngestionService/entry.ts` 创建 Artifact 时**未写入**。
- 后果：车厢与 `staffReportService` 的 AuditLog 事件链断链。

### 缺陷 2：缺少人类可读复合标号
- 现有 `ingestion_key` 为 `clinic_id::client_request_id`，`client_request_id` 是随机 UUID，无语义。
- 无复合标号导致人工追溯与日志检索成本高。

### 缺陷 3：`ingestion_seq` 未填充（调度取货前置）
- `buildScheduledRunRequest` 要求 Artifact 具备有限 `ingestion_seq` 才能计算 `cutoff_event_seq`；当前解析站未填充该字段。
- **后果**：定时扫描将因 `no_artifacts` 跳过，Stage 2 无法取货。
- **处置**：Stage 2 启用前，解析站必须在创建 Artifact 时写入 `ingestion_seq`（当日同诊所递增水位）。本轮隔离脚本以"测试数据补齐"方式模拟该水位，并在文档中标记为 Stage 2 启用前置项。

---

## 二、我方负责补齐的开发项（Stage 2 启用前）

### 开发项 A：填充两类溯源事件 ID（语义分离）
**改动文件**：`base44/functions/fragmentIngestionService/entry.ts` + `Artifact.jsonc` + `EvidenceFactCard.jsonc`

引入两个语义独立字段：

| 字段 | 语义 | 可空 | 用途 |
|------|------|------|------|
| `source_event_id` | 真实上游业务事件（如员工上报事件） | 可空 | 回溯到业务发生时刻上下文 |
| `ingestion_event_id` | 本次上传/采集审计事件 | 非空 | 追溯到本次入站操作 |

- 创建 Artifact 前先写一条 AuditLog（`trigger_type: "phase5_fragment_captured"`），其 `event_id` 固化为 `ingestion_event_id`。
- `source_event_id` 仅当存在真实上游业务事件时填充，否则留空。
- **约束**：Agent 可用于溯源，但**不得**将二者作为编组唯一依据（见第三节约束 6）。

### 开发项 B：引入 `event_gene_code` 复合标号（仅展示/日志/追溯）
**改动文件**：`Artifact.jsonc` + `EvidenceFactCard.jsonc`（新增字段）+ `fragmentIngestionService/entry.ts`

格式：`{clinic_id}/{business_date}/{department}/{staff_short_id}/{fragment_type}/{seq}`

示例：`clinic-001/2026-07-20/optometry/a1b2c3/image/0003`

- `staff_short_id`：员工 ID 后 6 位（脱敏）。
- `seq`：当日同维度递增序号（4 位补零）。
- **幂等性**：`event_gene_code` 不作唯一性索引（仍由 `ingestion_key` 承担），仅作语义铭牌；重复请求命中幂等时返回既有车厢，不递增 seq。
- **使用约束（硬性）**：`event_gene_code` **只用于展示、日志检索和人工追溯**。Agent 的编组判断**必须使用结构化字段**，**不得解析该字符串作为业务判断依据**（见第三节约束 1）。

### 开发项 C：填充 `ingestion_seq` 水位
- 解析站创建 Artifact 时写入 `ingestion_seq`（当日同诊所递增），使定时扫描可计算 cutoff。
- 本轮不实现，标记为 Stage 2 启用前置项；隔离脚本以测试数据补齐方式模拟。

---

## 三、Agent 工程师须遵守的硬性约束

### 约束 1：`event_gene_code` 不得作为编组判断依据
- `event_gene_code` 仅用于展示、日志检索、人工追溯。
- Agent 编组判断**必须使用结构化字段**（见第四节字段表），**不得**解析该字符串作为业务判断依据。

### 约束 2：定时取货范围（必须同时满足全部）
Agent 到点扫描的取货集合必须**同时**满足：
1. 当前 `clinic_id`（租户隔离）；
2. `assembly_eligible === true`；
3. 解析状态 `alignment_status === "aligned"`；
4. Artifact/FactCard 时间**不晚于本轮 cutoff**（`ingestion_seq <= run.cutoff_event_seq`）；
5. **不属于**已经成功完成的 `CompositionRun` 的处理集合（`artifact_ids_processed`）。

### 约束 3：防重规则需区分运行结果
| Run 结果 | 防重行为 |
|----------|----------|
| `completed` | 对应 Artifact/FactCard 视为本轮已处理，后续定时扫描**不得重复生成假设** |
| `running`/`pending` | 同一幂等键返回既有 run |
| `failed` | 允许用同一幂等键**安全重试**，**不得永久丢失车厢** |

新增证据到达后，下一时段可形成新的 cutoff/run，但**不得把旧证据重复当作新车厢**。

### 约束 4：解析异常不进入编组池
- `needs_clarification`、`failed`、`assembly_eligible=false` 一律**不进入** Agent 编组池。
- 保留 `FragmentProcessingResult` 与 `AttentionItem` 供前端处理。
- Agent **不负责修复解析错误**，也**不应把解析失败转化为 Workflow 假设**。

### 约束 5：不得以 `assembly_eligible=false` 表示消费
- Agent 完成编组后**不得**回写 `assembly_eligible=false` 作为消费标记。
- 消费判定由 `CompositionRun` 的 `artifact_ids_processed`、`cutoff`、`policy_version`、`idempotency_key` 承担。

### 约束 6：`source_event_id` 与 `ingestion_event_id` 语义分离
- `source_event_id`：真实上游业务事件，可为空。
- `ingestion_event_id`：本次上传/采集审计事件，非空。
- Agent 可用于溯源，但**不得**将二者作为编组唯一依据。

---

## 四、编组判断字段依赖（结构化字段表）

Agent 在取货与编组时，应使用以下结构化字段（解析站保证产出）：

| 字段 | 用途 | 解析站保证 |
|------|------|-----------|
| `clinic_id` | 租户隔离 | ✅ 已保证 |
| `assembly_eligible` | 取货资格标志 | ✅ 已保证 |
| `alignment_status` | 对齐状态（取货门槛） | ✅ 已保证 |
| `ingestion_seq` | cutoff 水位比较 | ⚠️ 开发项 C 补齐 |
| `subject_type` | 主体类型 | ✅ 已保证 |
| `subject_fingerprint.name` | 主体指纹 | ✅ 已保证 |
| `occurred_at` + `time_uncertain` | 业务发生时间 | ✅ 已保证 |
| `workflow_family_hint` | 业务族提示 | ✅ 已保证 |
| `ingestion_key` | 幂等校验基准 | ✅ 已保证 |
| `source_event_id` | 业务事件溯源（可空） | ⚠️ 开发项 A 补齐 |
| `ingestion_event_id` | 入站审计溯源 | ⚠️ 开发项 A 补齐 |
| `event_gene_code` | 展示/日志/追溯铭牌（**不作判断依据**） | ⚠️ 开发项 B 补齐 |

---

## 五、协同时间表与验收标准

### 阶段 1：契约编码（本轮，双方独立）
- 我方：更新 handoff 契约、契约测试、隔离联调脚本（本文件 + `agentHandoffContract.js` + `contract.test.js` + `phase5-isolated-e2e.mjs`）。
- Agent 方：按本文件约束评审；如有异议回执。
- **双方均不得**在本轮修改 Phase 1–4 推理规则、经理职责、Workflow closure 语义、生产运行时段。

### 阶段 2：解析站开发（下一轮，我方独立）
- 补齐开发项 A（溯源 ID）、B（event_gene_code）、C（ingestion_seq）。
- 在 `phase5-it-*` 隔离测试诊所完成自测后通知 Agent 工程师。

### 阶段 3：联调验收（双方协同）
使用随机 `phase5-it-*` 诊所 + 临时单诊所白名单验证：
1. 上传后立即产生标准 FactCard，**不产生** CompositionRun；
2. 到点扫描后发现它 → **只生成待编组建议**（`WorkflowHypothesis.status="pending_review"`）；
3. 同槽重跑幂等、数量零增长；
4. **不自动** review/commit，不生成权威 `Workflow`；
5. 解析失败内容**不进入** run；
6. 验证后**先关闭 scheduler、移除白名单**，再精确清理测试数据；
7. **禁止触碰 clinic-001**。

### 验收标准（mock_mode 限定）
- ✅ 上传产出 Artifact/EvidenceFactCard，无 CompositionRun（Stage 1 解耦）
- ✅ 定时扫描（真实 `scheduled_scan` 路径）产出 CompositionRun + 待审核假设
- ✅ 同槽重跑 idempotent，假设数量零增长
- ✅ 无自动 review/commit，无权威 Workflow
- ✅ 解析失败内容 `assembly_eligible=false`，不进 run（Agent 侧过滤待约束 2 落地后生效）
- ⚠️ 本阶段标注 `mock_mode=true`、`synthetic_multimodal_e2e=true`，真实多模态输入验收另行安排

---

## 六、风险与边界

1. **不动 Agent 既有推理**：本轮仅新增字段与订阅契约，不修改 compositionOrchestrator 编组规则（attach/new_train/orphan）。
2. **租户隔离不变**：`event_gene_code` 仅作语义铭牌，`clinic_id` 仍是唯一租户隔离字段。
3. **幂等性由 `ingestion_key` 承担**：`event_gene_code` 不参与幂等判定。
4. **生产数据保护**：联调仅在 `phase5-it-*` 隔离诊所进行；确认前不触碰 clinic-001。
5. **调度门控**：定时扫描受 `COMPOSITION_SCHEDULER_ENABLED` + `COMPOSITION_SCHEDULER_CLINICS` 服务端环境门控；隔离测试需临时配置单诊所白名单，验证后立即移除。
6. **`ingestion_seq` 前置缺口**：当前解析站未填充 `ingestion_seq`，定时扫描会因 `no_artifacts` 跳过；Stage 2 启用前必须由开发项 C 补齐。本轮隔离脚本以测试数据补齐方式模拟该水位。

---

## 七、回执请求

请 Agent 工程师就以下明确回执：
1. 第三节 6 项约束是否全部认可？如有异议请标注。
2. 第四节结构化字段表是否覆盖 Agent 编组所需全部语义锚点？若需补充请提出。
3. 预计何时可落地"约束 2 取货过滤"（`assembly_eligible=true` + `alignment_status=aligned` + cutoff + 排除已完成集合）于 compositionOrchestrator。

回执后，我方立即启动阶段 2 开发。