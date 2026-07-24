# Clinic OS Phase 1 交付说明（V12 Phase 1a/1b）

> 版本：Phase 1  
> 交付日期：2026-07-24  
> 上游宪法：`docs/CLINIC_OS_V12.md`（V12.1 处置表、V12.3 状态表、V12.4 interim A1 路由）  
> 关联观察：`docs/PIPELINE_ENGINE_OBSERVATION.md`

---

## 一、关键决定与取舍（追溯依据）

### 决定 1：决策分数字段先留 null，标注 Phase 7 补全

**背景**：决策日志（AttachDecisionLog）要求记录「每条 track 的分数、聚合分数、阈值、距阈值的 margin、结果」。

**现状**：Clinic OS 的七条推断轨道是**推理协议（reasoning protocol），非加权打分模块**（见 AttentionItem.reasoning_tracks 描述、GuessPolicy.tracks 描述）。当前架构不产出数值聚合 / 阈值 / margin；track 级仅有 supporting / opposing 证据计数，net = supporting − opposing。

**取舍**：
- `track_scores` 字段当前记录每条 track 的 `{ supporting, opposing, net }`（已有数据，非空）。
- `aggregate_score` / `threshold` / `margin` 三个纯数值字段当前记录为 **null**，并在实体 description 与共享模块注释中显式标注「Phase 7 阈值调优时填充」。
- 不为 Phase 1 临时捏造数值或随意挑默认值顶替——遵循「缺失必须能被识别并展示为独立状态，不得随便挑一个看似安全的默认值顶替」的通用原则（见 `docs/PIPELINE_ENGINE_OBSERVATION.md` 第四节）。
- `result`（attach/new_train/orphan/blocked）由 run 的持久化字段（auto_attach_eligible / llm_audit_required / auto_attach_gate_reasons + 最佳假设 composition_type）确定性推导，**当前即有值**。

**取舍代价**：Phase 7 阈值调优上线前，决策日志无数值分可用于直接画分布；但 `track_scores` 的证据计数 + `result` 已构成完整的决策可观测面，且字段 schema 已就位，Phase 7 填充时无需迁移。

### 决定 2：架构改为 entity automation 解耦，不动 parity 核心

**背景**：四类埋点（决策日志 / 修正捕获 / 负约束 / 硬链接占比）本可做成 orchestrator 运行时内的 inline 副作用。

**现状**：compositionOrchestrator 的核心运行时逻辑（`runtime/orchestratorCore.js`、`runtime/phase3Contract.js`、`runtime/*Saga.js`、`runtime/attachmentProjection.js`）与 `src/lib/phase3/*`、`src/lib/agentV11/*` 存在 **parity 镜像 pin 测试**（`runtimeParity.test.js`、`commitRuntimeParity.test.js`、`agentAutoAttachRuntimeMirror.test.js`）。任何对这些文件的改动都会破坏前后端一致性断言。

**取舍**：将四类埋点全部实现为**实体自动化（entity automation）+ 后端投影函数**，副作用由 CompositionRun / WorkflowArtifactLink 的 create/update 事件触发，从已持久化数据重建记录，**完全不触碰 parity 核心**：
- `attachDecisionLogger` ← CompositionRun update（status→completed）
- `correctionAndNegativeConstraintLogger` ← WorkflowArtifactLink update（attached→superseded）
- `hardLinkShareCounter` ← WorkflowArtifactLink create（status=attached）
- `preAttachConflictRouter` ← scheduled（10min）

**例外（唯一一处核心接入）**：负约束**抑制**（un-attach 黏性）必须在候选提议路径生效。该接入点放在 `service.ts`（`run()` 中 buildHypotheses→createHypotheses 之间），以 guarded optional op `listActiveNegativeConstraints` 形式过滤。`service.ts` 本身**不是 parity 镜像**（无 `src/lib/phase3/service.js` 对应物），可安全编辑；guarded 写法保证 mock ops（现有测试）不受影响（op 不存在 → 不过滤 → 行为不变）。

**取舍代价**：
- 决策日志的 track 分数从持久化的 WorkflowHypothesis.reasoning_tracks 重建，而非运行时内存中的 guardrailResult 直采——两者等价（hypothesis 持久化即 guardrail 产出），但多一次 WorkflowHypothesis 读取。
- entity automation 至少一次投递，靠函数内幂等键（composition_run_id / link_id / idempotency_key）兜底去重。

---

## 二、交付清单

### 新增实体（4）
| 实体 | 用途 | 幂等键 |
| :--- | :--- | :--- |
| AttachDecisionLog | 每次 composition 决策一行 | composition_run_id |
| CorrectionCapture | un-attach 误挂接标注 | link_id |
| NegativeConstraint | 禁止 (artifact, workflow) 对再次挂接 | clinic_id::workflow_id::artifact_id |
| HardLinkShareLedger | 硬链接占比计数器（per-link ledger 行，聚合算占比） | link_id |

### 修改实体（1）
- AttentionItem.attention_type 新增 `pre_attach_conflict`（Phase 1b interim A1 路由终态）。未碰 Workflow schema、未建三态队列。

### 共享纯逻辑（1）
- `base44/shared/phase1Instrumentation.ts`：构造器、deriveResult、buildTrackScores、isSuppressed / filterByNegativeConstraints（黏性）、computeHardLinkShare、buildPreAttachConflictAttention。不依赖 SDK，供后端函数与 vitest 共用。

### 后端函数（5，全部 asServiceRole，系统/CI 调用）
| 函数 | 触发 | 职责 |
| :--- | :--- | :--- |
| attachDecisionLogger | CompositionRun update 自动化 | 投影决策日志 |
| correctionAndNegativeConstraintLogger | WorkflowArtifactLink update 自动化 | 写 CorrectionCapture + 建/激活 NegativeConstraint |
| hardLinkShareCounter | WorkflowArtifactLink create 自动化 | 写 HardLinkShareLedger 行（hard/soft 判定依据 UndoListItem.resolution_type） |
| preAttachConflictRouter | scheduled 10min | 扫 llm_audit_required=true run → 幂等物化 pre_attach_conflict AttentionItem |
| phase1CiAssertion | CI / 按需 | 返回四项完成标准指标 |

### 自动化（4）
- entity：CompositionRun[update] → attachDecisionLogger
- entity：WorkflowArtifactLink[update] → correctionAndNegativeConstraintLogger
- entity：WorkflowArtifactLink[create] → hardLinkShareCounter
- scheduled：every 10 min → preAttachConflictRouter

### 核心接入（1，guarded）
- `compositionOrchestrator/service.ts`：负约束抑制过滤（`isSuppressed` + 可选 `ops.listActiveNegativeConstraints`）
- `compositionOrchestrator/entry.ts` makeOps：实现 `listActiveNegativeConstraints` op

### 单测（1）
- `src/lib/phase1/__tests__/instrumentation.test.js`：覆盖 deriveResult、buildTrackScores、负约束抑制黏性、computeHardLinkShare、buildPreAttachConflictAttention

---

## 三、四项完成标准与验证方式

| # | 标准 | 验证 |
| :--- | :--- | :--- |
| 1 | AttentionQueue 不得有 age>1h 未处理的 llm_audit_required 项 | `phase1CiAssertion.assertions.unattended_audit_count` 必须 === 0 |
| 2 | 过去 24h 每次 composition 决策都有 decision-log 行，数量可对账 | `decision_log_coverage.match` 必须 true（runs_completed_24h === decision_logs_matched） |
| 3 | un-attach 一对组合后重新跑 composition，断言这对组合不会被再次提议 | 单测 `filterByNegativeConstraints` 验证抑制逻辑；生产黏性由 NegativeConstraint + service.ts 过滤联合保证 |
| 4 | 硬链接占比（7d）可查询，Phase 2 有基线 | `hard_link_share_7d.share` + `byBranchDomain` |

**端到端验证（2026-07-24）**：
- preAttachConflictRouter 首跑扫到 **9 条历史 llm_audit_required=true 积压**，全部物化为 pre_attach_conflict AttentionItem（正是 V12.4 预警的「假性倒退」——被静默拦截的冲突首次变可见）；二跑 `skipped=9, created=0` 幂等。
- phase1CiAssertion：积压清空后 `unattended_audit_count=0` ✓；`hard_link_share_7d` 基线已记录（当前 null，待真实链接发生填充）。
- attachDecisionLogger 正确忽略非 completed 事件。

---

## 四、待办与已知缺口

- **Phase 2**：硬链接占比基线对照（当前 ledger 为空，待真实链接发生）。
- **Phase 5**：pre_attach_conflict 从单终态 escalate_human 升级为三态队列（flagged / confirmed / manager-visible）。
- **Phase 7**：填充 aggregate_score / threshold / margin 数值（需先确立加权打分模型，当前为推理协议）。
- **V12.4 safety-critical（左右眼等）urgency=red 分级**：Phase 4 检测上线前，pre_attach_conflict 统一 yellow（不加 SLA 分级）。
- **pipelineEngine arrival_time 回退 bug**：观察期（2026-08-23 截止）内不动业务逻辑。

*本文件为 Phase 1 交付追溯依据。两条关键决定（分数字段留 null + Phase 7、entity automation 解耦）即上。*