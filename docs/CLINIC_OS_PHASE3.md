# Clinic OS Phase 3 — 运行时集成契约与状态机

> 基线：main `0fad753533feacc652a63257e5f243d62f815a4d` → 分支 `phase3/runtime-integration`
> Phase 2 已冻结。本文件为 Phase 3 新增契约，不改 Phase 2 语义。

## 1. 范围

将 Phase 2 纯逻辑编组能力（CandidateFinder / Clustering / Assembly / Guardrail / GuessPolicy 契约）接入真实运行链路：**只读编组 → 人工审核 → Saga 提交 → 审计闭环**。

## 2. 已确认决策（Batch 1）

| # | 决策 | 结论 |
|---|---|---|
| 1 | Workflow 持久化 | 新建独立 `Workflow` 实体；`WorkflowSnapshot` 为版本化投影，仅关联 `workflow_id`，不承担业务根职责 |
| 2 | 自动提交边界 | 一律人工审核；即使唯一最佳仍生成 shadow proposal，禁止 `auto`/`system` ManagerDecision |
| 3 | 编排触发 | 手动 + 定时（按 `ClinicConfig.schedule_times`）；不接入 Artifact 入站即时触发 |
| 4 | Hypothesis 持久化 | 新建独立 `WorkflowHypothesis` 实体；不内嵌 AttentionItem |
| 5 | 测试 clinic | 隔离 `phase3-it-<uuid>`，cleanup manifest + 精确 ID 删除，`remaining=0` 校验；禁止 clinic-001 |
| 6 | 分支 | `phase3/runtime-integration`，Phase 2 文件只读引用 |
| A | 快照版本 | 不可变：提交创建 `snapshot_version+1` 新 Snapshot；CAS 更新 `Workflow.current_snapshot_*` |
| B | 多实体提交 | 无跨 Entity 事务 → Saga `WorkflowCommitIntent` + reconciliation |
| C | 不重复存储关系 | `WorkflowHypothesis.composition_run_id` 为关系宿主；`CompositionRun` 不存 `hypothesis_ids`；`AttentionItem` 仅存 `selected_hypothesis_id` |
| D | 权限 | `clinic_id` 来自 `user.id → Staff/ClinicConfig` 授权；admin 才能 commit；跨租户返回 403/404 不读内容 |
| E | 旧 pipelineEngine | 会话压缩模式保留不改；compose 模式标记 legacy/deprecated；不与 `compositionOrchestrator` 并列为生产入口 |

## 3. 实体关系

```
Workflow (业务根)
  ├─ clinic_id, workflow_family, subject_type, subject_fingerprint
  ├─ status (权威状态机), temporal_anchors, started_at, last_event_at, open_loops
  ├─ current_snapshot_id ──▶ WorkflowSnapshot (不可变版本投影)
  └─ current_snapshot_version (CAS 指针)
        │
        WorkflowSnapshot
        ├─ workflow_id (必关联 Workflow)
        ├─ snapshot_version (乐观并发)
        └─ artifact_ids / evidence_fact_card_ids / audit_event_ids

CompositionRun (编组运行水位)
  ├─ idempotency_key = clinic_id::business_date::slot::pv<ver>::seq<cutoff>
  └─ (不反向存 hypothesis_ids — 关系宿主在 WorkflowHypothesis)
        │
        WorkflowHypothesis (1:N CompositionRun)
        ├─ composition_run_id (关系宿主)
        ├─ source_proposal_id (幂等键)
        ├─ workflow_hypothesis_id (确定性 ID)
        ├─ composition_type, target_workflow_id, target_snapshot_id, target_snapshot_version
        ├─ reasoning_tracks (七轨道), unsupported_assumptions, contradictions, unexplained_artifact_ids
        ├─ validation_blocks (Guardrail 阻断项)
        ├─ rank, alternative_group
        └─ status (状态机)

AttentionItem (review/dispatch 载体, 非 Hypothesis 数据库)
  ├─ source_proposal_id, composition_run_id, selected_hypothesis_id
  ├─ target_snapshot_id (审核时看到的快照)
  ├─ manager_action (execute/ignore/escalate)
  └─ commit_outcome (committed/stale/failed), committed_workflow_id

WorkflowCommitIntent (Saga 句柄)
  ├─ manager_execution_idempotency_key (幂等键)
  ├─ attention_item_id, selected_hypothesis_id
  ├─ target_workflow_id, expected_snapshot_id, expected_snapshot_version
  ├─ new_snapshot_id, new_snapshot_version
  ├─ status (Saga 状态机), reconciliation (失败对账)
  └─ manager_decision_id

ManagerDecision
  ├─ target_type ∈ {task,alert,staff_request,hypothesis,proposal}
  ├─ commit_intent_id (Phase 3 提交型决策关联)
  └─ decision ∈ {approved,rejected,ignored}
```

## 4. 状态机

### Workflow
```
active ⇄ stalled
active/stalled → pending_manager_closure → closed
pending_manager_closure → active (重新激活)
closed (终态)
```
驱动唯一来源：店长审核提交。AI 不得直接流转。

### WorkflowHypothesis
```
pending_review → selected → dispatched → committed (终态)
                                    ↘ stale (终态)
pending_review/selected → rejected (终态) / ignored (终态)
```

### WorkflowCommitIntent (Saga)
```
pending → committing → committed (终态)
                     ↘ stale (终态)
                     ↘ compensation_failed → pending (幂等重放补偿)
pending → stale (pre-check 即拦截)
```
**无跨 Entity 事务**：任何中段失败输出 `reconciliation`（已执行步骤 + 待补偿项），支持幂等重放，不得静默吞掉补偿失败，不得仅声称“原子提交”。

## 5. 提交 Saga 顺序（决策 B + A）

```
1. 以 computeManagerExecutionIdempotencyKey 创建/命中 WorkflowCommitIntent(pending)
2. 写入 pending ManagerDecision (approved)
3. CAS Workflow.current_snapshot_version (expected → +1)
   ├─ 不一致 → Intent.stale，AttentionItem.commit_outcome=stale，不创建快照
4. 创建新不可变 WorkflowSnapshot(version = expected+1, workflow_id, manager_decision_id, composition_run_id)
5. 更新 Workflow.current_snapshot_id / current_snapshot_version / status / last_event_at
6. 写 AuditLog(COMMIT 事件, 含 intent_id / decision_id / hypothesis_id)
7. finalize: ManagerDecision, AttentionItem(commit_outcome=committed, committed_workflow_id),
            WorkflowHypothesis(committed), CompositionRun(收尾), Intent(committed)
```
任一步骤失败：
- 记录 `reconciliation` 到 Intent；
- 标记 `compensation_failed`；
- 幂等重放从 `pending` 重新进入；
- **不得** 静默回退已提交快照；`committed` 为终态不可逆。

## 6. 不可变快照与 stale proposal（决策 A）

- 提交时 `expected_snapshot_id` + `expected_snapshot_version` 必须同时匹配 `Workflow.current_snapshot_*`。
- 不匹配 → `WorkflowCommitIntent.stale`，`AttentionItem.commit_outcome=stale`，通知重编组。
- 历史快照永不原地覆盖；`snapshot_version` 单调递增。

## 7. 权限模型（决策 D）

| action | role |
|---|---|
| interpret / run / query / listRuns | staff, admin |
| commit | admin |

- `clinic_id` 由服务端 `base44.auth.me()` → `Staff`/`ClinicConfig` 授权关系解析，客户端传入仅作一致性校验。
- 跨租户 ID 即使真实存在 → 403/404，不读取内容。
- `assertNoAutoManager`：`manager_id` 禁止 `auto`/`system`。

## 8. 租户隔离

- 复用 Phase 2 `scopedQuery` / `tenantContext`（不改）。
- 提交链路经 `assertCommitTenantScope` 校验 workflow/snapshot/hypothesis/intent 的 `clinic_id` 一致。

## 9. 测试隔离（决策 5）

- 测试 clinic：`phase3-it-<uuid>`（每次唯一）。
- 所有写入 ID 进入 cleanup manifest；finally 精确 ID 删除；删除后按 `clinic_id` 查询 `remaining=0`。
- 永禁 `clinic-001`。

## 10. Legacy（决策 E）

- `pipelineEngine` 会话压缩模式（trigger != compose）保留不改。
- `pipelineEngine` compose 模式标记 `legacy/deprecated`，不与 `compositionOrchestrator` 并列为生产入口。
- 本 Batch 不删除任何 legacy 代码。

## 11. Batch 1 范围（本批次）

- 新增 Entity：`Workflow`, `WorkflowHypothesis`, `WorkflowCommitIntent`
- 追加字段：`Artifact.source_workflow_id`；`EvidenceFactCard` 6 字段；`WorkflowSnapshot.workflow_id`；`AttentionItem` 4 字段；`ManagerDecision` target_type 扩展 + `commit_intent_id`
- 契约模块：`src/lib/phase3/contract.js`
- 纯 Schema 测试：`src/lib/phase3/__tests__/schema.test.js`
- **不**实现后端编排；**不**写业务/测试数据；**不**改 Phase 2 文件；**不**触碰 clinic-001。

## 12. 后续 Batch（待审核）

- B2: `compositionOrchestrator` 后端函数（interpret/run/query/listRuns）
- B3: commit Saga 实现（含 CAS / reconciliation / 幂等重放）
- B4: 前端（CompositionRun 列表 / Hypothesis 对比 / validation_issues / Manager Dispatch / 审计链）
- B5: 测试与 CI（租户隔离 / 幂等 / stale / manager_required / 并发审核 / E2E）