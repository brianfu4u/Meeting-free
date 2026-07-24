# Clinic OS Phase 2–7 总路线图 + 分级加速执行原则

> 版本：Roadmap v1  
> 制定日期：2026-07-25  
> 上游：`docs/CLINIC_OS_V12.md`（V12.1 处置表 / V12.3 状态表 / V12.4 interim A1 路由 / V12.6 隔离不丢弃 / V12.7 L2 移除）  
> 前置：Phase 0（宪法背书）✓、Phase 1a/1b（埋点 + interim A1 路由）✓（见 `docs/CLINIC_OS_PHASE1_DELIVERY.md`）  
> 关联观察：`docs/PIPELINE_ENGINE_OBSERVATION.md`（pipelineEngine 观察期至 2026-08-23）

---

## 〇、风险分级判定标准（本次路线图统一口径）

| 信号 | 风险 | 说明 |
| :--- | :--- | :--- |
| 碰**阈值**（首次引入数值判定 / 改判定阈值） | 高 | 改变「result 如何得出」的语义 |
| 碰 **parity 锁定核心文件** | 高 | 见下方清单；改动破坏前后端一致性断言 |
| **状态机变更**（枚举增删 / 流转规则改） | 中高 | 影响生命周期，需同步 contract + parity + 测试 |
| **改变现有行为**（非新增，改既有路径输出） | 中 | 需回归验证 |
| 纯新增 / 不碰既有行为 / 不碰阈值 / 不碰状态机 | 低 | 可自主一次性交付 |

**parity 锁定核心文件清单**（改动即触发 parity 断言失败）：
- `base44/functions/compositionOrchestrator/runtime/*` ↔ `src/lib/phase3/*`（`runtimeParity.test.js`、`commitRuntimeParity.test.js` pin）
- `base44/functions/compositionOrchestrator/contracts.ts` ↔ `src/lib/phase3/contract.js`（`contract.parity.test.js` pin）
- `base44/functions/compositionOrchestrator/runtime/agentAutoAttachSaga.js` ↔ `src/lib/agentV11/*`（`agentAutoAttachRuntimeMirror.test.js` pin）
- `src/lib/composition/*`（前端镜像，`contract.parity.test.js` 等多组 pin）
- **非 parity**（可安全编辑）：`compositionOrchestrator/service.ts`、`compositionOrchestrator/entry.ts`、`scanGate.js`、各 entity jsonc、新增函数/实体

---

## 一、Phase 2 — 终结状态 + 硬链接占比基线

> 宪法依据：V12.3 状态表 V9.L4（无可追溯不结案）declared-not-enforced → enforcing artifact = accepted_orphan 终结状态（Phase 2b）。

### Phase 2a — 硬链接占比基线积累（低风险）
- **范围**：被动等待真实 WorkflowArtifactLink 发生，使 `phase1CiAssertion.hard_link_share_7d` 产出非空基线；记录首个基线快照。
- **依赖**：Phase 1 hardLinkShareCounter 已就位；需真实编组运行产生链接（当前 ledger 为空）。
- **风险**：低。纯观测，无代码改动。
- **判断依据**：不碰阈值、不碰 parity、不改行为、不改状态机。
- **执行**：自主；基线形成后按 Phase 1 格式出交付说明。

### Phase 2b — accepted_orphan 终结状态（高风险）
- **范围**：给 orphan（孤立车厢）一个被店长 accept 的终结状态，使 V9.L4「无可追溯不结案」由 declared-not-enforced → enforced。当前 orphan 仅 bounce 到 UndoListItem（status=pending，无终态）。
- **依赖**：Phase 1 负约束 + UndoListItem 已存在；Phase 2a 基线非硬依赖但建议先有。
- **风险**：高。
- **判断依据**：碰状态机（UndoListItem.status 或 Workflow.status 新增 accepted_orphan 枚举 + 流转规则）；碰 parity（UndoListItem projection 在 `runtime/attachmentProjection.js` 与 `runtimeAdapter.ts`——parity 镜像）；需同步 `contract.js`/`phase3Contract.js` 状态机定义。
- **执行**：**先出技术方案 + 影响面评估**（枚举加在哪、流转由谁驱动、parity 同步点、是否需 ManagerDecision 新 target_type），确认后动手。

---

## 二、Phase 3 — 临时工作流状态（new_train 持久化）+ V9.L2 移除

> 宪法依据：V12.3 V10.4（new_train 建议可解释）declared-not-enforced → enforcing artifact = 临时工作流状态（Phase 3）；V12.7 V9.L2（无闭环不留存）deprecated → Phase 3 上线时移除。

- **范围**：new_train 假设提交后创建的 Workflow 赋予持久「临时」语义与终态，使 new_train 假设携带血缘并有持久记录；移除 V9.L2「丢弃未闭环」的残留行为（若有）。
- **依赖**：Phase 2b accepted_orphan 终态就位（new_train 同需终态收口）。
- **风险**：高。
- **判断依据**：碰状态机（Workflow.status 增临时/终态枚举 + 流转）；碰 parity（`runtime/commitRuntime.js`、`commitSaga.js`——parity 镜像）；碰现有行为（V9.L2 丢弃行为移除）。
- **执行**：**先出技术方案**（临时状态枚举值、生命周期、与 accepted_orphan 的关系、L2 残留代码定位），确认后动手。

---

## 三、Phase 4 — composition rollout 推进 + safety-critical 检测

> 宪法依据：V12.4 interim A1 路由在 safety-critical（如左右眼冲突）场景须 urgency=red，Phase 4 检测上线前统一 yellow。

### Phase 4a — per-clinic rollout 推进（中风险）
- **范围**：将 ClinicConfig.composition_rollout_status 由 disabled/shadow 推进至 pilot/active（已有字段 + schedulerCore + pilotReadiness）。
- **依赖**：Phase 1 决策日志可观测；Phase 2b/3 终态就位（active 意味着 AI 提交真正落库，需终态收口）。
- **风险**：中。
- **判断依据**：改变现有行为（shadow→active = AI 提交开始改 Workflow 状态）；不碰 parity（rollout 字段非 parity）；不碰阈值。
- **执行**：**先出推进 runbook**（目标 clinic、gate 判据、回滚开关 AGENT_AUTO_ATTACH_MODE / COMPOSITION_SCHEDULER_ENABLED），确认后推进。

### Phase 4b — safety-critical 检测（urgency=red）（高风险）
- **范围**：对 V12.4 safety-critical 冲突（左右眼等）赋 urgency=red，引入检测规则。
- **依赖**：Phase 1b 路由已就位；red urgency 的完整消费依赖 Phase 5 三态队列（可先标记后消费）。
- **风险**：高。
- **判断依据**：碰 parity（urgency 在 `runtime/orchestratorCore.js` buildAttentionDescriptor——parity 镜像）；引入新检测规则（改现有输出）。
- **执行**：**先出技术方案**（safety-critical 判定规则来源、检测点放 parity 核心还是 service.ts 装配层、parity 同步方案），确认后动手。

---

## 四、Phase 5 — pre_attach_conflict 三态队列

> 宪法依据：Phase 1 交付缺口——pre_attach_conflict 从单终态 escalate_human 升级为三态（flagged / confirmed / manager-visible）。

- **范围**：pre_attach_conflict AttentionItem 增加 flagged→confirmed→manager-visible 生命周期；复用 CompositionRun.llm_audit_status 已有枚举（queued/confirmed/flagged/rejected/correction_proposed）。
- **依赖**：Phase 1b 路由已就位；Phase 4b red 标记（red 项优先消费）。
- **风险**：中。
- **判断依据**：碰状态机（llm_audit_status 流转 + AttentionItem 显隐规则）；**不碰 parity**（pre_attach_conflict 是 Phase 1 新增路径，无 parity 镜像）；不改既有行为（只给单终态加前序态）。
- **执行**：**先出技术方案**（流转驱动方、confirmed 的判定依据、manager-visible 闸门），确认后动手。

---

## 五、Phase 6 — V9.A2 违规语义移除 + 延迟断言（三秒感知）

> 宪法依据：V12.3 V9.A2（违规语义）deprecated → Phase 6 移除；V12.3 V10.8（三秒感知）declared-not-enforced → enforcing artifact = 延迟断言（Phase 6）。

### Phase 6a — V9.A2 违规语义移除（中风险）
- **范围**：移除 `src/lib/scanGate.js` 中 process-violation 分类逻辑（QR 捕获保留，违规分类已 deprecated）。
- **依赖**：无硬依赖；确认违规分类无下游消费者。
- **风险**：中。
- **判断依据**：改变现有行为（scanGate.js 既有输出）；不碰 parity（scanGate 非 parity）；不碰状态机。
- **执行**：**先出影响面评估**（违规分类的下游消费者清查、移除后 QR 流是否完整），确认后动手。

### Phase 6b — 延迟断言测量基建（低风险）
- **范围**：新增端到端延迟埋点（入站事件→AttentionQueue 可见时延），产出三秒感知达标度量。
- **依赖**：Phase 1 决策日志时间戳可作参照。
- **风险**：低。
- **判断依据**：纯新增观测，不改现有行为，不碰阈值/parity/状态机。
- **执行**：自主一次性交付。

---

## 六、Phase 7 — 阈值调优 / 数值聚合填充

> 宪法依据：Phase 1 决定 1——aggregate_score/threshold/margin 留 null，Phase 7 填充。

- **范围**：将推理协议（reasoning protocol）升级为加权打分模型；填充 AttachDecisionLog 的 aggregate_score/threshold/margin；result 判定由「gate 字段确定性推导」改为「数值阈值比较」。
- **依赖**：Phase 1 决策日志积累足够 track_scores 样本（需真实 run 持续产出）。
- **风险**：高。
- **判断依据**：碰阈值（首次引入数值判定）；碰现有行为（deriveResult 语义改变）；碰 parity（`runtime/orchestratorCore.js` deriveDispatchDecision——parity 镜像）。
- **执行**：**必须先出技术方案**（打分模型、阈值来源、灰度策略、parity 同步、回退路径），确认后动手。

---

## 七、分级加速执行原则

### 低风险（可自主一次性交付）
- 适用：Phase 2a、Phase 6b；以及任何纯新增观测/文档/非 parity 装配层增量。
- 执行：**工程师自主拍板，一次性做完，不需每步回来确认**。交付时按 `docs/CLINIC_OS_PHASE1_DELIVERY.md` 格式出交付说明（关键决定与取舍 / 交付清单 / 完成标准验证方式 / 已知缺口）。
- 安全边界：不得借「低风险」之名夹带中高风险改动；判定存疑时按中高处理。

### 中高风险（先方案后动手）
- 适用：碰阈值、碰 parity 核心、碰状态机、改变现有行为——Phase 2b、Phase 3、Phase 4a/4b、Phase 5、Phase 6a、Phase 7。
- 执行：**先产出技术方案 + 影响面评估**（改哪些文件、是否碰 parity、状态机变更点、回归面、回退路径），**等确认后再动手**。不得一次性做完再汇报。
- 交付：同样按 Phase 1 格式出交付说明，并附「方案确认记录」引用。

### 通用安全边界（不因求快放松）
1. **parity 核心不得绕过**：任何对 `runtime/*`、`contracts.ts`/`contract.js`、`agentV11/*`、`composition/*` 的改动必须同步镜像并跑 parity 断言。
2. **阈值不得即兴**：Phase 7 前不得在任何字段填入随意数值顶替缺失（遵循「缺失须可识别为独立状态」原则）。
3. **状态机变更必须经 contract**：枚举增删先改 `contract.js`/`phase3Contract.js`，再同步实体 schema，再跑状态机断言。
4. **rollout 推进可回退**：Phase 4a 推进必须保留 AGENT_AUTO_ATTACH_MODE / COMPOSITION_SCHEDULER_ENABLED 回退开关。
5. **观察期未满不动 pipelineEngine**：2026-08-23 前 pipelineEngine 业务逻辑冻结（仅观察探针）。

---

## 八、阶段依赖图

```
Phase 1 ✓ ──┬─→ Phase 2a（基线积累，低，自主）
            └─→ Phase 2b（accepted_orphan 终态，高，先方案）
                      │
                      └─→ Phase 3（new_train 持久化 + L2 移除，高，先方案）
                                │
                                └─→ Phase 4a（rollout 推进，中，先 runbook）
                                          │
                                          └─→ Phase 7（阈值调优，高，先方案，需样本积累）

Phase 1b ✓ ──┬─→ Phase 4b（safety-critical red，高，先方案）
             └─→ Phase 5（三态队列，中，先方案，消费 4b red）

Phase 6a（V9.A2 移除，中，先评估） ─ 独立
Phase 6b（延迟断言，低，自主） ─ 独立
```

---

## 九、本次目标重申

加快整体节奏：**低风险工程师自决、减少来回确认**；**安全边界（阈值、状态机、parity 核心）不因求快放松验证**。本路线图为后续每个阶段交付的索引基准。

*本文件为 Phase 2–7 路线图与执行原则。各阶段启动时以此为准绳判定风险分级与执行方式。*