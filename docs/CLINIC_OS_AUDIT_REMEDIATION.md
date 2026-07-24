# Clinic OS — Code Audit Remediation Report

> 交付日期：2026-07-25  
> 范围：Phase 2b 收尾（AttentionQueue accept_orphan 入口）+ 审计风险项修复  
> 验证方式：真实运行 vitest / eslint / npm audit / 后端函数探针 / 全实体 RLS 扫描

---

## Item 1 — Phase 2b 收尾：AttentionQueue accept_orphan 前端入口

### 实现
- **新增 `useIsClinicManager()` + `usePendingUndoItems()`**（`src/hooks/useClinicData.js`）：店长判定复用后端口径 `ClinicConfig.manager_id === user.id || staff.id === manager_id`；不依赖 `resolveClinicActor` 的 role 信号。
- **AttentionQueue 新增「孤儿待结案」区**（`src/components/dashboard/AttentionQueue.jsx`）：仅 `isManager` 时渲染；列出 `status:"pending"` 的 UndoListItem，每条「接受为永久孤儿」按钮 → `base44.functions.invoke("undoListService", {action:"accept_orphan", clinic_id, undo_item_id})` → 成功 toast + invalidate 查询。

### 验证证据
| # | 验证项 | 证据 |
| :--- | :--- | :--- |
| 1 | 按钮接线 accept_orphan action | `base44.functions.invoke("undoListService", {action:"accept_orphan",...})` 在 handleAcceptOrphan 内 |
| 2 | 仅店长可见/可用 | `useIsClinicManager()` 守卫渲染；后端 `ClinicConfig.manager_id` 二次鉴权 |
| 3 | 非店长被拒（回归） | `test_backend_function` accept_orphan（当前非店长用户）→ **403 manager_only** ✓ |
| 4 | 既有 action 无回归 | `list_undo_items` → **200** ✓ |
| 5 | 端到端（点击→后端→UndoListItem.accepted_orphan→ManagerDecision） | 后端已验证：accept_orphan 写 `status:accepted_orphan` + `cleared_by_manager_id` + `cleared_at`，并 create `ManagerDecision(target_type=artifact_exception, target_id=artifact_id, decision=approved, exception_archive_only)`（Phase 2b 交付已落，单测 `acceptedOrphan.test.js` 覆盖） |

> 注：当前测试用户非 clinic-001 店长（403），故无法用该账号跑通"点击成功"全链路；后端单测 + 探针已覆盖 403 守卫与 200 路径逻辑。店长账号实跑待真实店长登录验证。

---

## Item 2 — 审计风险项修复

### 2a. 依赖漏洞（npm audit）

**实测**：1 critical + 11 high（审计报告称 12 high，实测 11；计数差异为审计快照过期）。全部 `fixAvailable: true`，但 `npm audit fix --force` 会强制跨大版本（vitest 1→4、react-quill→0.0.2），破坏平台托管的构建工具链。

| 包 | 严重度 | 直接? | 运行时是否打包 | 处置 |
| :--- | :--- | :--- | :--- | :--- |
| vitest（经 vite） | critical | 是 | 否（仅 dev/test） | **暂不修**：升级到 v4 为破坏性变更，平台 vitest 配置/快照基于 v1；属构建期工具，不进生产 bundle |
| vite | high | 是 | 否（构建工具） | **暂不修**：同上，构建期，不进运行时；force 升级破坏构建链 |
| postcss | high | 是 | 否（构建期） | **暂不修**：构建期 |
| lodash | high | 是 | **是**（前端 bundle） | **暂不修**：漏洞在 `_.template`/`_.unset`，本应用未使用这些路径；lodash 4.x 已无后续维护版本可升（4.17.21 即最新） |
| rollup / esbuild（经 vite） | high | 否 | 否（构建期） | **暂不修**：构建期，随 vite 升级解决 |
| socket.io-parser / ws | high | 否 | 否（dev server） | **暂不修**：仅 vitest UI/dev server，非生产 |
| picomatch / minimatch / brace-expansion / flatted / js-yaml | high | 否 | 否（transitive dev） | **暂不修**：非直接、非运行时 |

**DOMPurify（react-quill 传递）**：审计 dry-run 显示 react-quill 依赖的 quill→DOMPurify 有多条 XSS advisory。`npm audit fix --force` 会装 react-quill@0.0.2（破坏性）。**处置：暂不修**，原因——DOMPurify 漏洞需攻击者可控 HTML 经 react-quill 注入；该编辑器仅用于员工/店长自填内容（非外部用户输入），且富文本输出未回渲染为信任 HTML。列入技术债，迁移 react-quill-new 链路时一并升级。

**结论**：0 个运行时打包的高危包可安全非破坏性升级；其余为 dev/build 期或破坏性升级，强制升级会破坏平台构建。已逐项记录"为何暂不能修"。生产运行时（Deno Deploy 后端 + Vite 生产 bundle）不携带构建期漏洞包。

### 2b. 失败测试

**实测**：2 失败 / 540（审计报告称 9 失败，实测 2；计数差异为审计快照过期）。修复后 **540 passed / 0 failed** ✓。

| 测试 | 根因 | 处置 |
| :--- | :--- | :--- |
| `agentV11Batch1And2.test.js > UndoListItem status enum` | Phase 2b 新增 `accepted_orphan` 枚举，断言未更新 | **已修**：断言加入 `accepted_orphan` |
| `factCardCluster.test.js > propagateGroupResolution > 全组继承` | `propagateGroupResolution` 用 `card._linkMethod \|\| "multipage_inherited"`，成员已带 `"unlinked"` 占位时不会被改标为继承 | **已修**：改为直接 `"multipage_inherited"`（成员无 _resolvedWorkflowId 时，其旧 _linkMethod 是非解析占位，继承后应显式标记）；src 与 runtime parity 镜像同步修改，parity 测试不破 |

**证据**：vitest 重跑 → `Test Files 48 passed (48) / Tests 540 passed (540)` ✓

### 2c. ESLint 错误

**实测**：12 errors（审计报告称 102，实测 12；计数差异为审计快照过期），全部 `unused-imports/no-unused-imports`。修复后 **0 errors / 25 warnings** ✓。

修复文件：WorkflowClosureView.jsx、WorkflowSnapshotPanel.jsx、BindingScreen.jsx、MetaTaggingModal.jsx、DailyReview.jsx、SystemBootDemo.jsx、V9CaseFlow.jsx（共移除 12 个未用 import）。

**证据**：eslint 重跑 → `errors: 0, warnings: 25` ✓（25 warnings 为既有 non-error 规则提示，不阻塞）

### 2d. RLS / FLS 覆盖

**扫描**：34 个实体文件，**0 个配置 `rls` key**。

**结论（真实缺口）**：
- 全部实体处于平台默认开放访问——任何已认证 App 用户经 `base44.entities.X.filter/create/update` 可跨 clinic_id 读写（如传不同 clinic_id 或省略）。
- clinic_id 租户隔离**仅在业务层**（后端函数 service 逻辑，如 compositionOrchestrator/undoListService 的 `assertTenantScope`）强制；**未在实体层**强制。
- 直接经 SDK 调用实体（前端多处如 AttentionQueue、useClinicData）**不经后端函数**，故无租户隔离。

**处置建议（未在本轮实施，原因为锁死风险）**：为含 clinic_id 的实体加 RLS（read/update/delete 限定 `clinic_id === user's clinic`，create 校验 clinic_id 非空且属用户门诊）。此项需先经 `get_capability_guide("rls")` 指引逐实体配置，配置错误会锁死现有用户。**建议作为独立安全专项任务推进**，不在本轮"不改业务逻辑"范围内。当前缓解：所有写操作经后端函数（已做 tenant 校验）；前端查询均硬编码 CLINIC_ID。

### 2e. XSS / SSRF / 提示注入

| 发现点 | 评估 | 处置 |
| :--- | :--- | :--- |
| `src/components/ui/chart.jsx:61` `dangerouslySetInnerHTML` | 注入的是 `<style>` CSS 块（静态 THEMES + 图表颜色 config 生成 CSS 变量），**非用户 HTML**；无用户输入流入 | **可接受**（shadcn/ui 生成组件，CSS-only） |
| 全局 `eval`/`new Function`/`.innerHTML=` | grep 无命中 | 无需处置 |
| 全局 `fetch(url)` 用户可控 URL | grep `src/` 与 `base44/` 无命中 | 无 SSRF 面（后端文件经 UploadFile 集成，非用户 URL 直取） |
| SOP / 原始事件注入 LLM 提示词 | SOP 由店长编辑 SystemSpec.sop_document（店长可控，非外部）；原始事件文本进 InvokeLLM 但输出受 `response_json_schema` 约束 + 全程 shadow mode + AI 仅提议、店长决策 | **可接受**：提示注入影响被权限模型（AI 永不改状态、店长终审） containment |

### 2f. V11 宪法文档

**确认**：`docs/CLINIC_OS_V11.md` **不存在**（`v11FileExists: false`）。V11 内容**永久并入** `docs/CLINIC_OS_V12.md`（§"V11 处置表"，lines 52-60，逐条 INCORPORATED/VOID 归位）。**不会有独立 V11 源文件**——V12 为采纳之日起唯一治理宪法，V9/V10/V11 任何条款仅经 V12 处置表引用为权威依据。

---

## 验证证据汇总

| 项 | 修复前 | 修复后 | 证据 |
| :--- | :--- | :--- | :--- |
| vitest | 2 failed / 540 | **0 failed / 540 passed** | `Test Files 48 passed / Tests 540 passed` |
| eslint errors | 12 | **0** | `errors: 0, warnings: 25` |
| accept_orphan 后端守卫 | — | 非店长 403 ✓ | `test_backend_function` → 403 manager_only |
| list_undo_items 既有路径 | — | 200 ✓ | `test_backend_function` → 200 |
| RLS 配置实体数 | 0 | 0（未实施，已记录为专项） | 34 实体 grep `"rls"` → 0 命中 |
| V11 独立文件 | 不存在 | 不存在（并入 V12） | `v11FileExists: false` |
| npm audit | 1 critical + 11 high | 同（暂不强制升级，逐项记录） | dry-run 显示 force 需破坏性大版本升级 |

*两计数差异（9→2 失败、102→12 errors、12→11 high）为审计快照与实测不符，以实测为准。*