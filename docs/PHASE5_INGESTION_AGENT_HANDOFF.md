# Phase 5 解析站 → Agent 报到契约对齐说明

**作者**：解析站（fragmentIngestionService）开发方
**致**：Composition Agent / compositionOrchestrator 开发方
**日期**：2026-07-20
**状态**：待 Agent 评审 → 达成一致后立即开发

---

## 一、背景与问题

Phase 5 解析站已独立为单一职能 Skill（fragmentIngestionService），负责将多模态原始输入转化为 `EvidenceFactCard`。目前解析站产出的"车厢"已具备数据库层唯一性，但存在两处缺陷，导致 Agent 无法可靠接收与编组判断：

### 缺陷 1：`source_event_id` 字段已定义但从未填充
- `Artifact.jsonc` 第 42 行定义了 `source_event_id`（"产出本碎片的 AuditLog event_id，溯源链入口"）。
- 但 `fragmentIngestionService/entry.ts` 在创建 Artifact 时**未写入此字段**。
- **后果**：Phase 5 车厢与 `staffReportService` 产出的 AuditLog 事件链之间断链，Agent 无法回溯到原始员工上报事件。

### 缺陷 2：缺少人类可读的复合标号
- 现有 `ingestion_key` 格式为 `clinic_id::client_request_id`，其中 `client_request_id` 是前端随机 UUID，不含语义信息。
- Agent 看到车厢时无法直接"读出"这是哪家店、谁操作的、什么时间、什么部门的车厢，必须反查多张表才能判断编组归属。

---

## 二、我方负责补齐的开发项

### 开发项 A：强制填充 `source_event_id`
**改动文件**：`base44/functions/fragmentIngestionService/entry.ts`

在 `captureFragment` 函数中，创建 Artifact 之前，先写入一条 AuditLog 事件，将返回的 `event_id` 固化进 `Artifact.source_event_id`。

- AuditLog 事件 `trigger_type`：`phase5_fragment_captured`
- AuditLog payload：`{ clinic_id, fragment_type, source_staff_id, client_request_id, ingestion_key, captured_at }`
- Artifact 创建时 `source_event_id` 必填，缺失则整批回滚。

**收益**：车厢与全链路审计日志打通，Agent 可通过 `source_event_id` 回溯到员工上报时刻的完整上下文。

### 开发项 B：引入 `event_gene_code` 复合标号
**改动文件**：`base44/entities/Artifact.jsonc` + `EvidenceFactCard.jsonc`（新增字段）+ `fragmentIngestionService/entry.ts`

在 Artifact 与 EvidenceFactCard 上新增 `event_gene_code` 字段，格式：

```
{clinic_id}/{business_date}/{department}/{staff_short_id}/{fragment_type}/{seq}
```

- `clinic_id`：诊所标号（如 `clinic-001`）
- `business_date`：业务日期（`yyyy-mm-dd`，Asia/Tokyo）
- `department`：部门职能编码（如 `reception`/`optometry`/`medical`）
- `staff_short_id`：员工 ID 后 6 位（脱敏，如 `a1b2c3`）
- `fragment_type`：碎片类型（`image`/`document`/`audio`/`text`）
- `seq`：当日同维度递增序号（4 位补零，如 `0001`）

示例：`clinic-001/2026-07-20/optometry/a1b2c3/image/0003`

**收益**：Agent 扫一眼标号即可知车厢归属（哪家店、谁、何时、何部门、何类型），无需反查多表，编组判断效率显著提升。

**幂等性**：`event_gene_code` 不作为唯一性索引（仍由 `ingestion_key` 承担），仅作语义铭牌。重复请求命中幂等时返回既有车厢，不递增 seq。

---

## 三、Agent 工程师需要配合的事项

### 配合项 1：确认接收契约（Agent 订阅源）

解析站不主动通知 Agent，Agent 需自行订阅 `EvidenceFactCard` 实体变更：

```js
// Agent 侧建议订阅逻辑
base44.entities.EvidenceFactCard.subscribe((event) => {
  if (event.type === 'create' && event.data.assembly_eligible === true) {
    // 进入 Agent 排队队列
  }
});
```

**请 Agent 工程师确认**：当前 compositionOrchestrator 是否已实现此订阅？若无，需同步开发。

### 配合项 2：确认编组判断字段依赖

Agent 在排队报到时，应优先读取以下字段进行列车匹配（这些字段解析站已保证产出）：

| 字段 | 用途 | 解析站保证 |
|------|------|-----------|
| `event_gene_code` | 人类可读归属铭牌 | ✅ 开发项 B 补齐后保证 |
| `source_event_id` | 回溯员工上报事件 | ✅ 开发项 A 补齐后保证 |
| `clinic_id` | 租户隔离 | ✅ 已保证 |
| `subject_type` | 主体类型（patient/staff/…） | ✅ 已保证 |
| `subject_fingerprint.name` | 主体指纹 | ✅ 已保证 |
| `occurred_at` + `time_uncertain` | 业务发生时间 | ✅ 已保证 |
| `workflow_family_hint` | 业务族提示 | ✅ 已保证 |
| `assembly_eligible` | Agent 取货标志 | ✅ 已保证 |
| `ingestion_key` | 幂等校验基准 | ✅ 已保证 |

**请 Agent 工程师确认**：上述字段是否覆盖 Agent 编组所需的全部语义锚点？若需补充，请回执告知。

### 配合项 3：确认"报到完成"回执协议

Agent 完成编组挂载后，需回写 `EvidenceFactCard.assembly_eligible = false` 以标记该车厢已被消费，防止重复挂载。

**请 Agent 工程师确认**：此回写逻辑是否已纳入 compositionOrchestrator 的 commit/dispatch 流程？若无，需同步开发。

### 配合项 4：`event_gene_code` 字段 schema 同步

由于 `event_gene_code` 是新增字段，需 Agent 工程师确认 compositionOrchestrator 在读取 Artifact/EvidenceFactCard 时对新增字段兼容（不报 schema 缺失错误）。

---

## 四、协同时间表与验收标准

### 阶段 1：契约对齐（双方评审本文档）
- Agent 工程师回执确认第三节的 4 项配合内容。
- 确认 `event_gene_code` 字段命名与格式双方一致。

### 阶段 2：解析站开发（我方独立）
- 补齐开发项 A（source_event_id）与开发项 B（event_gene_code）。
- 在 `phase5-it-*` 隔离测试诊所完成自测。
- 自测通过后通知 Agent 工程师。

### 阶段 3：联调验收（双方协同）
- Agent 工程师在隔离测试诊所订阅 `EvidenceFactCard`，验证：
  1. 能收到 `assembly_eligible=true` 的报到事件。
  2. 能正确解析 `event_gene_code` 并完成编组判断。
  3. 能通过 `source_event_id` 回溯到 AuditLog 原始上报。
  4. 挂载成功后回写 `assembly_eligible=false` 不产生重复挂载。
- 联调通过后双方签署契约确认，正式接入 clinic-001 生产环境。

### 验收标准（mock_mode 限定）
- ✅ 解析站产出 Artifact 必含 `source_event_id`（非空）
- ✅ 解析站产出 Artifact/EvidenceFactCard 必含 `event_gene_code`（格式合规）
- ✅ Agent 能订阅到报到事件并完成一次完整挂载闭环
- ⚠️ 本阶段验收标注 `mock_mode=true`、`synthetic_multimodal_e2e=true`，真实多模态输入验收另行安排

---

## 五、风险与边界

1. **不动 Agent 既有逻辑**：本对齐仅新增字段与订阅契约，不修改 compositionOrchestrator 现有编组规则（attach/new_train/orphan）。
2. **租户隔离不受影响**：`event_gene_code` 仅作语义铭牌，`clinic_id` 仍是唯一租户隔离字段。
3. **幂等性由 `ingestion_key` 承担**：`event_gene_code` 不参与幂等判定，重复请求返回既有车厢，不递增 seq。
4. **生产数据保护**：联调阶段仅在 `phase5-it-*` 隔离诊所进行，确认前不触碰 clinic-001。

---

## 六、回执请求

请 Agent 工程师就以下三点明确回执：
1. 第三节 4 项配合内容是否全部认可？如有异议请标注。
2. `event_gene_code` 字段命名与格式是否接受？如需调整请提出。
3. 预计何时可完成 Agent 侧订阅逻辑开发，以便双方对齐联调时间。

回执后，我方立即启动阶段 2 开发。