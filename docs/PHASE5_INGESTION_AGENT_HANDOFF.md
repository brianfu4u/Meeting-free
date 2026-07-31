# Phase 5 解析站 → Composition Agent 异步交接契约

状态：实现候选（handoff.v2）  
边界：本契约只定义多模态解析站与 Agent 的接口；不改变 Phase 1–4 推理规则、经理职责、Workflow closure 语义或生产运行时段。

## 1. 两段式流程

### Stage 1：解析站即时处理

1. 用户上传 image / document / audio / text。
2. `fragmentIngestionService` 完成解析与结构化。
3. 创建 Artifact、FragmentProcessingResult、EvidenceFactCard。
4. 只有 `alignment_status=aligned` 且质量门通过的 FactCard 才设置 `assembly_eligible=true`。
5. 此阶段不得创建 CompositionRun、WorkflowHypothesis、Workflow、WorkflowSnapshot、WorkflowCommitIntent 或 ManagerDecision，也不得调用 review/commit。

### Stage 2：Agent 定时取货

1. 真实 `compositionOrchestrator scheduled_scan` 在现有固定时段运行。
2. 以诊所、cutoff 水位和已完成 Run 的处理集合选取候选。
3. 生成 CompositionRun、待审核 WorkflowHypothesis 与必要 AttentionItem。
4. 不自动审批、不自动 commit、不创建权威 Workflow。
5. 同一 slot 重放必须命中同一 Run，且 Run/Hypothesis/AttentionItem 数量零增长。

## 2. 权威结构化字段

Agent 的取货和编组只能依赖结构化字段：

- `clinic_id`
- `artifact_id`
- `assembly_eligible=true`
- `alignment_status=aligned`
- `Artifact.ingestion_seq <= CompositionRun.cutoff_event_seq`
- `subject_type` / `subject_fingerprint`
- `occurred_at` / `time_uncertain`
- `workflow_family_hint`
- 已完成 Run 的 `artifact_ids_processed`

`needs_clarification`、`failed`、`rejected`、`assembly_eligible!=true` 的 FactCard 不得进入编组池。

## 3. event_gene_code

格式：

```
{clinic_id}/{business_date}/{department}/{fragment_type}/{artifact_short_id}
```

规则：

- 仅用于 UI 展示、日志检索和人工追溯。
- 不包含员工身份，不依赖可竞争的“当日递增序号”。
- 不得用于租户鉴权、编组判断、幂等键或业务逻辑解析。
- 租户隔离仍只由服务端认证上下文与 `clinic_id` 决定。

## 4. ingestion_seq 与防重

- `fragmentIngestionService` 必须在创建 Artifact 时由服务端生成有限数值 `ingestion_seq`。
- 测试不得更新或补写 `ingestion_seq` 来伪造可扫描数据。
- `ingestion_key=clinic_id::client_request_id` 负责入站幂等。
- CompositionRun 的 `idempotency_key`、`cutoff_event_seq`、`policy_version` 与 `artifact_ids_processed` 负责 Agent 防重。
- 不得通过回写 `EvidenceFactCard.assembly_eligible=false` 标记“已消费”；该字段表示证据本身是否具备编组资格。

## 5. 溯源 ID

- `source_event_id`：真实上游业务事件，可空。
- `ingestion_event_id`：本次上传/采集审计事件，可空，待审计入口正式接入后填充。
- 两者都不是编组唯一依据，也不得替代 Artifact/FactCard 的结构化证据字段。

## 6. 错误与人工边界

- 对齐失败或信息不足：保持不可编组，并可创建 `evidence_missing` AttentionItem。
- Agent 只提出候选；经理在后续 closure 语义明确后处理 Workflow 结束确认。
- 本契约不把“经理逐条确认编组”写入当前流程，也不提前修改 closure 规则。

## 7. 隔离验收

### 解析站 E2E

```bash
cat scripts/phase5-isolated-e2e.mjs | npx base44@latest exec
```

必须证明：

- 四类接口可产生结构化结果（当前标注 `mock_mode=true`、`synthetic_multimodal_e2e=true`）。
- Artifact 自创建起即有有限 `ingestion_seq`。
- 入站阶段没有任何 CompositionRun 或权威 Workflow 副作用。
- 幂等、冲突、租户隔离、MIME/URL 安全及精确清理均成立。

### 定时交接 Pilot

```bash
bash scripts/phase5-scheduler-handoff-pilot.sh
```

Pilot 必须：

- 使用随机 `phase5-it-handoff-<uuid>` 诊所。
- 拒绝覆盖既有 scheduler secrets。
- 临时设置单诊所 scheduler 开关和白名单。
- 通过真实 `scheduled_scan` 执行首次扫描与同槽重放。
- 硬断言只有一个 scheduled Run、重放零增长、Hypothesis 保持 `pending_review`。
- 硬断言 Workflow / WorkflowSnapshot / WorkflowCommitIntent / ManagerDecision 均为 0。
- 硬断言 composition lock 已释放。
- 无论成功或失败，必须先删除 scheduler 开关与白名单，再精确清理测试诊所全部数据。
- 禁止触碰 `clinic-001`。

## 8. 当前验收措辞

在真实图片、文档和语音解析尚未执行前，只能标记：

- `mock_mode=true`
- `synthetic_multimodal_e2e=true`

不得使用“真实四模态全部通过”或“Phase 5 全部完成”。

