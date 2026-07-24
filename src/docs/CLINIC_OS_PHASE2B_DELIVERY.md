# Phase 2b — accepted_orphan 终结状态 交付说明

> 版本：Delivery v1  
> 交付日期：2026-07-25  
> 上游方案：`docs/CLINIC_OS_PHASE2B_PROPOSAL.md`（已确认）  
> 宪法依据：`docs/CLINIC_OS_V12.md` V12.3（V9.L4 declared-not-enforced → enforcing artifact = accepted_orphan 终结状态）  
> 业务确认（四条）：① 店长一键确认、不要求重新调查；② 入口放 AttentionQueue（UI 后续接，本交付含后端 action）；③ 终态不可逆；④ 暂不做回看视图。

---

## 一、关键决定与取舍

### 决定 1：accepted_orphan 加在 UndoListItem.status（非 Workflow.status）
- orphan 无 Workflow；加在 Workflow 会污染 Workflow 状态机且语义错误。
- UndoListItem 不在 contract 状态机注册表（transitionMachines 仅 workflow/hypothesis/commit_intent）→ 枚举变更不碰 contract parity。

### 决定 2：店长手动流转，AI 不自动
- V12「AI recommends; humans decide」+ V9.L4 需人类锚点。
- 流转 `pending → accepted_orphan`，仅 pending 可流转；终态不可逆。
- 后到挂接匹配不会把终态翻回 resolved——`reconcileUndoFromAttachmentLink` 的 `status !== "pending"` 守卫天然跳过（parity 函数零改动）。

### 决定 3：复用 artifact_exception 作 ManagerDecision 锚点
- `target_type=artifact_exception`、`target_id=artifact_id`，与既有 `findManagerExceptionDecision(artifactId)` 查询口径一致。
- 异常隔离语义一致：`decision_scope=exception_archive_only`、`normal_rule_learning_eligible=false`（accept 即异常隔离，不进正常规则学习）。
- 不碰 contract `MANAGER_TARGET_TYPES`。

### 决定 4：店长判定用 ClinicConfig.manager_id 显式比对，不依赖 actor.role
- `resolveClinicActor`（staffRole="staff"）对"有 Staff 行的店长"返回 role="staff"——admin 信号不可靠。
- accept_orphan 内显式查 ClinicConfig，`manager_id === actor.user_id || manager_id === actor.staff_id` 判定店长（兼容 Staff 行与 legacy 直存两种映射）。

### 取舍代价
- accept_orphan 多一次 ClinicConfig 读取（可接受）。
- 后到匹配对终态 artifact 作新 orphan 重新产生（终态即终态，业务已确认接受）。

---

## 二、交付清单

| 项 | 文件 | 性质 | parity |
| :--- | :--- | :--- | :--- |
| status enum += accepted_orphan | `base44/entities/UndoListItem.jsonc` | 实体 schema | 无 |
| accept_orphan 纯逻辑（patch + 锚点 + 判定） | `base44/shared/phase1Instrumentation.ts` | 共享 | 无 |
| accept_orphan action + 店长守卫 + 锚点写入 | `base44/functions/undoListService/entry.ts` | 非 parity | 无 |
| executePipeline 跳过已结案孤儿 | `base44/functions/compositionOrchestrator/entry.ts` | 非 parity，改现有行为 | 无 |
| 单测 | `src/lib/phase1/__tests__/acceptedOrphan.test.js` | 纯逻辑 | 无 |

**未改动（parity 零同步）**：`runtime/attachmentProjection.js`、`src/lib/agentV11/attachmentProjection.js`、`runtimeAdapter.ts`、`contracts.ts`、`src/lib/phase3/contract.js`、`phase3Contract.js`、`ManagerDecision.jsonc`。

---

## 三、完成标准验证方式与结果

| # | 标准 | 验证 |
| :--- | :--- | :--- |
| 1 | accepted_orphan 终态项不被 reconcile 翻为 resolved | 单测 `reconcileGuard(accepted)===false` ✓（pending 守卫天然跳过） |
| 2 | 店长 accept 后，下一 run 不为该 artifact 重新创建 pending | executePipeline 改为查任意状态 existing，`status==="pending"\|\|"accepted_orphan"` 即跳过 ✓ |
| 3 | accept 产生 ManagerDecision(target_type=artifact_exception, target_id=artifact_id) | 单测 `buildAcceptOrphanManagerDecision` ✓ |
| 4 | 非店长不可 accept | 后端测试 `accept_orphan`（非店长用户）→ 403 manager_only ✓ |
| 5 | 既有 action 不受影响 | 后端测试 `list_undo_items` → 200 ✓ |
| 6 | parity 全套断言不破 | 未碰任何 parity 镜像文件；待 CI 跑 runtimeParity/commitRuntimeParity/agentAutoAttachRuntimeMirror/contract.parity/schema 确认 |

**端到端验证（2026-07-25）**：
- `undoListService` accept_orphan（非店长）→ 403 manager_only（守卫生效，未触碰数据）✓
- `undoListService` list_undo_items → 200（既有路径未回归）✓
- vitest acceptedOrphan.test.js 已写入，覆盖 patch/锚点/判定/reconcile 相容性。

---

## 四、已知缺口

- **AttentionQueue 入口 UI**：本交付仅含后端 action；店长在 AttentionQueue 下钻触发 accept_orphan 的前端按钮待 UI 任务接入（业务确认入口在 AttentionQueue）。
- **回看视图**：按业务确认暂不做；后续需要时另起只读视图任务。
- **AI 预推荐**：若后续要求 AI 对长期 pending 孤儿主动建议 accept，属 Phase 5（AttentionItem 新类型），本 phase 不含。
- **`manager_cleared` 既有路径**：未补实现（仅加 accepted_orphan，不动的状态不动）。

---

## 五、回退方案

1. 移除 UndoListItem.status 的 `accepted_orphan` 枚举值。
2. 数据回退：`updateMany({status:"accepted_orphan"}, {$set:{status:"manager_cleared"}})`（降级回最近语义的既有终态）。
3. 移除 undoListService 的 accept_orphan action + executePipeline 跳过逻辑。
4. 未碰 parity 镜像，回退为纯增量代码删除，无 parity 风险。

---

*本文件为 Phase 2b 交付追溯。V9.L4（无可追溯不结案）由 declared-not-enforced 转 enforced 的 enforcing artifact 即 accepted_orphan 终结状态。*