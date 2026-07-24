# Phase 2b — accepted_orphan 终结状态 技术方案（待确认，未实现）

> 版本：Proposal v1  
> 日期：2026-07-25  
> 上游：`docs/CLINIC_OS_V12.md` V12.3（V9.L4 declared-not-enforced → enforcing artifact = accepted_orphan 终结状态）、`docs/CLINIC_OS_PHASE2_7_ROADMAP.md`  
> 状态：**方案待业务确认，未动手写代码**。  
> 核查基础：`base44/functions/compositionOrchestrator/runtime/attachmentProjection.js`、`runtimeAdapter.ts`、`src/lib/phase3/contract.js`、`base44/functions/undoListService/entry.ts`、`compositionOrchestrator/entry.ts`

---

## 一、核心结论：实际风险下调（high → medium）

路线图初判 Phase 2b 为 high（碰状态机 + 碰 parity：UndoListItem projection 在 attachmentProjection.js / runtimeAdapter.ts）。**经代码核查，parity 触碰实际为零**：

| 担心点 | 核查结果 |
| :--- | :--- |
| `reconcileUndoFromAttachmentLink`（parity 镜像）会写新状态 | 函数仅写 `status: "resolved"`，且 `if (row.status !== "pending") continue` 守卫——`accepted_orphan` 终态被自动跳过，**函数无需改动** |
| `runtimeAdapter.ts` executeCompositionRuntime 处理终态 | 该函数只产 hypothesis/undo，不消费 UndoListItem 状态机，**无需改动** |
| `contract.js` / `phase3Contract.js` 状态机 | UndoListItem **不在** contract 状态机注册表（transitionMachines 仅 workflow/hypothesis/commit_intent）。加枚举值不碰 contract parity |
| ManagerDecision.target_type 需新增 | 复用现有 `artifact_exception`（已有 exception 隔离语义），**不碰 contract MANAGER_TARGET_TYPES** |

**下调后风险：medium**。残余 medium 因素：UndoListItem.status 实体级枚举变更（新终态 + 新流转）+ `compositionOrchestrator/entry.ts` executePipeline 需跳过已 accept 的 artifact（改现有行为，但 entry.ts 非 parity 镜像）。

---

## 二、accepted_orphan 加在哪：UndoListItem（非 Workflow.status）

**结论：加在 `UndoListItem.status`，不加在 Workflow.status。**

**依据**：
- V12 哲学：Workflow = 长期业务根对象；orphan（孤立车厢）**本就没有 Workflow**。run 收尾时 orphan 仅产 `UndoListItem`（`bounce_reason: "not_assembled_by_cutoff"`），从不创建 Workflow。
- 给 Workflow 加 `accepted_orphan` 语义错误——orphan 无 Workflow 可挂该状态，且会污染 Workflow 状态机（Workflow.status 当前 `active/stalled/pending_manager_closure/closed`，`closed` 已是终态）。
- V9.L4「无可追溯不结案」要求的是：**orphan 记录有一个可追溯的终结锚点**。这个记录就是 UndoListItem，锚点是店长的 accept 决策（ManagerDecision）。

**枚举定义**（UndoListItem.status）：
```
现状: ["pending", "resolved", "manager_cleared"]
新增: ["pending", "resolved", "manager_cleared", "accepted_orphan"]
```
- `accepted_orphan` = 终态：店长确认此车厢为永久孤儿，结案可追溯，不再期待挂接，不再次日回流。
- 与现有 `manager_cleared` 区别：`manager_cleared` 语义模糊（"clear，不删记录"）；`accepted_orphan` 是 V12 要求的**明确终态**，遵循"缺失/模糊须可识别为独立状态，不得用模糊默认顶替"原则。`manager_cleared` 保留不动（向后兼容）。

**复用现有审计字段**（UndoListItem 已有）：`cleared_by_manager_id`、`cleared_at`——accept 时写入，无需新增字段。

---

## 三、状态流转规则：店长手动确认（非自动）

**结论：仅店长（admin）手动流转 `pending → accepted_orphan`。AI 不得自动流转。**

**依据**：
- V12「AI recommends; humans decide」+ V9.L4 要求可追溯的**人为**锚点事件。自动流转无人类决策锚点，违宪。
- 流转由店长在 UndoList 管理界面（或 AttentionQueue 下钻）触发 `accept_orphan` 动作。

**流转表**：
| from | to | 触发 | 锚点 |
| :--- | :--- | :--- | :--- |
| pending | resolved | attachment reconciliation / 员工 self_supplement / handoff（既有路径） | WorkflowArtifactLink / resolve 动作 |
| pending | manager_cleared | （既有，保留） | — |
| **pending** | **accepted_orphan** | **店长手动确认** | **ManagerDecision(target_type=artifact_exception, decision=approved)** |

**终态守卫**：`accepted_orphan` 不可逆。后到的挂接匹配不会把它翻回 `resolved`——`reconcileUndoFromAttachmentLink` 的 `status !== "pending"` 守卫已天然保证（无需改该 parity 函数）。后到匹配会作为新 orphan 在下一 run 重新产生（可接受：终态即终态）。

**待业务确认**：「店长手动确认永久孤儿」在诊所实际操作中是否可行——店长是否有足够信息/意愿对一张始终匹配不上的车厢下"接受为永久孤儿"的判断。若不可行，备选方案见第六节。

**锚点 ManagerDecision 复用 artifact_exception**：
- `target_type`: `artifact_exception`（复用，不碰 contract）
- `target_id`: `artifact_id`（与现有 `findManagerExceptionDecision(artifactId)` 查询口径一致）
- `decision`: `approved`
- `decision_scope`: `exception_archive_only`、`exception_class`: `manager_approved_exception`、`normal_rule_learning_eligible`: `false`（异常隔离，不进入正常规则学习——与 accept-orphan 语义一致）

---

## 四、parity 同步方案：零同步

**需同步改动的镜像文件：无。**

| 文件 | 是否改动 | 说明 |
| :--- | :--- | :--- |
| `runtime/attachmentProjection.js` ↔ `src/lib/agentV11/attachmentProjection.js` | **不改** | reconcile 仅写 `resolved`，`pending` 守卫跳过终态 |
| `runtimeAdapter.ts` | **不改** | 不消费 UndoListItem 状态机 |
| `contracts.ts` / `src/lib/phase3/contract.js` / `phase3Contract.js` | **不改** | UndoListItem 不在 contract 状态机；ManagerDecision.target_type 复用 artifact_exception |
| `UndoListItem.jsonc` | **改**（实体 schema） | status enum += accepted_orphan |
| `undoListService/entry.ts` | **改**（非 parity） | 新增 `accept_orphan` action |
| `compositionOrchestrator/entry.ts` | **改**（非 parity） | executePipeline 跳过已 accept 的 artifact，避免重复 bounce |
| `ManagerDecision.jsonc` | **不改** | 复用现有字段 |

**保证 parity 测试不破**：
- `runtimeParity.test.js` / `commitRuntimeParity.test.js` / `agentAutoAttachRuntimeMirror.test.js` / `contract.parity.test.js`：被 pin 的 runtime/contract/agentV11/composition 文件均不动 → 断言不破。
- `schema.test.js`：需在实现时跑一次确认未对 UndoListItem.status 做 parity pin（据快照摘要，该测试覆盖 Workflow/WorkflowHypothesis/WorkflowCommitIntent/Artifact/CompositionRun，未列 UndoListItem）。

---

## 五、回归影响面

| 既有逻辑 | 影响 | 处理 |
| :--- | :--- | :--- |
| `reconcileUndoFromAttachmentLink`（attachmentProjection） | 无——`pending` 守卫跳过终态 | 无需改 |
| `undoListService.list_undo_items` | filter `status: "pending"` → accepted_orphan 不进员工待补清单 | 符合预期（已结案不展示），无需改 |
| StaffPad UndoList UI（只展示 pending） | accepted_orphan 不可见 | 若店长需查看已结案孤儿，另起视图（可选，非阻塞） |
| `executePipeline` undo 创建循环（entry.ts） | 现仅查 `status: "pending"` 的既有项去重；已 accept 的 artifact 会被下一 run 重新 bounce 成新 pending | **需改**：跳过已有 accepted_orphan UndoListItem 或已有 artifact_exception ManagerDecision 的 artifact |
| `findManagerExceptionDecision(artifactId)`（service.ts） | accept-orphan 写入后，该 artifact 会被查到为 exception | 语义一致（accept 即异常隔离），需确认消费点不产生非预期阻断 |
| `phase1CiAssertion`（unattended_audit_count） | 查 AttentionItem，不查 UndoListItem | 无影响 |
| HardLinkShareLedger / 负约束 | 与 orphan 终态无关 | 无影响 |

**新增 executePipeline 跳过逻辑的边界**：仅跳过"本 artifact 已有 accepted_orphan 终态项 OR 已有 target_id=artifact_id 的 artifact_exception ManagerDecision"。不跳过 `resolved`/`manager_cleared`（它们不是"永久孤儿"语义）。

---

## 六、回退方案

1. **枚举回退**：UndoListItem.status 移除 `accepted_orphan`。
2. **数据回退迁移**：`updateMany({status: "accepted_orphan"}, {$set: {status: "manager_cleared"}})`——把已结案孤儿降级回既有 `manager_cleared`（向后兼容的最近语义），并清除对应 ManagerDecision（或标记 decision_note 回退）。
3. **代码回退**：移除 `undoListService` 的 `accept_orphan` action + `executePipeline` 的跳过逻辑。
4. **回退无 parity 风险**：未碰任何 parity 镜像文件，回退纯增量代码删除。
5. **回退开关**：可选——accept_orphan action 内查 `Deno.env.get("ACCEPTED_ORPHAN_ENABLED") !== "true"` 则拒绝（默认上线时开，紧急回退关）。

---

## 七、待业务确认项（动手前必须拍板）

1. **店长手动确认可行性**：店长在诊所实际操作中，是否有足够信息/意愿对"始终匹配不上的车厢"下"接受为永久孤儿"的判断？若不可行 → 备选：AI 预推荐（AttentionItem 建议 accept_orphan）+ 店长一键确认，但仍需人为锚点。
2. **accept 的入口位置**：UndoList 管理视图 vs AttentionQueue 下钻 vs 新独立页——取决于店长日常在哪看孤儿。
3. **后到匹配处理**：终态不可逆，后到匹配作新 orphan 重新产生——是否接受？或需"复活"机制（突破终态）？建议保持不可逆（V12 终态语义），业务确认。
4. **是否需展示已结案孤儿**：店长是否需要回看历史 accepted_orphan 记录（审计/复盘）？若需要，加只读视图。

---

## 八、交付清单（确认后实现，非现在）

| 项 | 文件 | 性质 |
| :--- | :--- | :--- |
| UndoListItem.status += accepted_orphan | `base44/entities/UndoListItem.jsonc` | 实体 schema |
| accept_orphan action + ManagerDecision 锚点 | `base44/functions/undoListService/entry.ts` | 非 parity |
| executePipeline 跳过已 accept artifact | `base44/functions/compositionOrchestrator/entry.ts` | 非 parity，改现有行为 |
| 单测：终态不可逆 + 跳过去重 + 锚点写入 | `src/lib/phase1/__tests__/`（或新增） | 纯逻辑 |
| 交付说明（Phase 1 格式） | `docs/CLINIC_OS_PHASE2B_DELIVERY.md` | 文档 |

---

## 九、完成标准验证方式（确认后实现时填）

1. UndoListItem 存在 accepted_orphan 终态项时，`reconcileUndoFromAttachmentLink` 不将其翻为 resolved（既有 `pending` 守卫验证）。
2. 店长 accept 后，下一 run 不为该 artifact 重新创建 pending UndoListItem（executePipeline 跳过逻辑验证）。
3. accept 产生 ManagerDecision(target_type=artifact_exception, target_id=artifact_id)，`findManagerExceptionDecision(artifactId)` 可查到。
4. `phase1CiAssertion` 不受影响（unattended_audit_count 仍只查 AttentionItem）。
5. parity 全套断言（runtimeParity / commitRuntimeParity / agentAutoAttachRuntimeMirror / contract.parity / schema）全绿。

---

## 十、已知缺口

- 若业务要求"AI 预推荐 accept_orphan"：属 Phase 5（AttentionItem 新类型），本 phase 不含。
- `manager_cleared` 既有路径若实际未实现，本 phase 不补（仅加 accepted_orphan，不动的状态不动）。
- 已结案孤儿的店长回看视图：若业务需要，另起 UI 任务，不阻塞本 phase。

---

*本文件为 Phase 2b 技术方案，待业务确认第七节后动手。关键决定：accepted_orphan 加在 UndoListItem.status、店长手动流转、复用 artifact_exception 锚点、parity 零同步、回退为增量删除。*