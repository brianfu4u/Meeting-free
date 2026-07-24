# Clinic OS V12 宪法（正式发布版）

> **版本：V12.0**  
> **采纳日期：2026-07-24**  
> **前序版本：V9 / V10 / V11（均按 V12.1 处置表归位）**  
> **本版核心：两轴分离（Authority / Latency）、条款状态标记、数据永不丢弃**  
> **发布阶段：Phase 0（仅文档，零代码、零 schema、零配置）**

---

## V12.1 Supersession（总纲）

V12 是 Clinic OS 从采纳之日起唯一的治理宪法。V12 与 V9、V10、V11 任何一点冲突，V12 无条件优先。旧版本条款不得在设计评审、代码评审或事故复盘中被单独引用为权威依据，除非已被本文档收录。V9/V10/V11 每一条条款必须落入以下三种处置之一：**INCORPORATED**（原样并入 V12，继续生效）、**AMENDED**（以修改后形式并入，原文作废）、**VOID**（彻底失效，实现它的代码就是缺陷）。任何未列入下方处置表的条款，默认即为 VOID——沉默不构成生效依据。日后发现任何未收录的条款，必须先经修正案纳入表格才能被引用。

---

## V9 处置表

| 条款 | 处置 | 备注 |
| :--- | :--- | :--- |
| V9.0 核心原则：无触发锚点不改状态 | INCORPORATED | 保持为骨干规则 |
| V9.A1 交叉验证锚点 | AMENDED（见 V12.4） | 锁定语义收窄，interim/final 路由拆分 |
| V9.A2 患者流程追踪锚点（流程违规） | AMENDED（见 V12.5） | 重新归类为非评价性序列异常 |
| V9.A3 系统逻辑触发锚点 | INCORPORATED | 时间阈值模式触发保持不变 |
| V9.L1 无触发不行动 | INCORPORATED | — |
| V9.L2 无闭环不留存 | AMENDED（见 V12.7） | 与临时工作流/隔离区直接冲突，见下 |
| V9.L3 无证据不裁决 | INCORPORATED | — |
| V9.L4 无可追溯不结案 | INCORPORATED | 扩展覆盖 accepted_orphan 结案 |
| V9.X 漂浮数据不合宪，丢弃并告警 | **VOID**（由 V12.6 取代） | 丢弃行为违反 L3、L4 |

### 关于 V9.L2 的特别说明

这条未列入原始矛盾清单，但它恰恰是唯一会彻底堵死"临时工作流"修复方案的条款。按原文，"无闭环不留存"恰好禁止了 V12 所要求的——为 open、unconfirmed、unresolvable 状态保留持久记录。必须在 Phase 3 上线前完成修正，否则会有工程师正确地指出 Phase 3 不合宪。

---

## V10 处置表

| 条款 | 处置 | 备注 |
| :--- | :--- | :--- |
| V10.1 AI 永不改变诊所状态 | INCORPORATED | 提升为 V12.2 的权限轴基石 |
| V10.2 推理不触碰原始证据（Evidence Normalizer） | INCORPORATED | Phase 4 扩展为逐字段置信度 |
| V10.3 只展示值得关注的内容 | INCORPORATED | 只约束数量，不约束延迟，不授权拖延（见 V12.2） |
| V10.4 每条建议须可解释（evidence_ids/event_ids/reasoning_chain） | INCORPORATED | 临时工作流扩展携带 hypothesis_id 血缘 |
| V10.5 AI 建议、人类决策（三种 manager 动作） | INCORPORATED | — |
| V10.6 AttentionItem 实体 | INCORPORATED | 扩展新 attention_type 值，不破坏 schema |
| V10.7 终端隔离，禁止 agent 对 agent 握手 | INCORPORATED | — |
| V10.8 三秒感知达标标准 | INCORPORATED（重新归类） | 归类为延迟指标（见 V12.2），不是权限主张 |

---

## V11 处置表

| 条款 | 处置 | 备注 |
| :--- | :--- | :--- |
| V11 标题「运营监控指挥中心，实时数据驱动管理」 | **VOID**（由 V12.2 取代） | "指挥"一词本身即缺陷 |
| V11.1 流体化运营 | INCORPORATED | — |
| V11.2 证据化 Artifact/EvidenceFactCard 可追溯 | INCORPORATED | — |
| V11.3 仲裁架构（AI 检测、manager 决策，AI 永不触发排程） | INCORPORATED | — |
| V11.4 两阶段异步协议（Ingestion/Composition） | INCORPORATED | — |
| V11.5 needs_manager_dispatch=false 预审门 | AMENDED（见 V12.4） | 在 interim 状态下暂停，Phase 5 退出条件满足后恢复 |
| V11.6 数据回流 linked_undo_artifact_id 硬链接 | INCORPORATED（扩展） | 补充软链接交接路径，此前遗漏属文档缺陷而非设计缺陷 |
| V11.7 undoListService 每日截止 | INCORPORATED（标注为 declared-not-enforced） | 描述行为与代码不符，Phase 2 退出后转为 enforced |
| V11.8（列出 reflow service、audit queue 为 V11 稳定期的对照表） | **VOID** | 发布内容与事实不符，不得继续沿用 |

---

## V12.2 系统本质

Clinic OS 是一个没有运营权限的实时见证者。两个此前被混为一谈的属性被明确拆分为独立维度，每个设计决策必须声明自己涉及的是哪一轴：

**权限轴（Axis A）**：谁能改变诊所状态。这一轴上系统的立场绝对且不变——**零权限**。系统只负责组合、排序、提议、拦截、记录，绝不排程、指派、指令、结案、批准或升级。任何带有运营后果的状态改变，都需要人类的主动行为。这一轴的默认立场是拒绝——任何扩大机器权限的提案都需要正式的宪法修正案，而非一次设计决策就能通过。

**延迟轴（Axis B）**：人类多快能知道系统已经知道的事。这一轴上系统的立场是"尽可能快，且不慢于证据允许的程度"。延迟是一种服务属性，不是安全控制手段。**拖延永远不能替代克制**。这一轴的默认立场是更快——任何增加延迟的提案都必须说明这个延迟具体防止了什么伤害。

由此，V9 与 V11 之间"安静的记录者"与"指挥中心"的框架冲突被彻底化解，而非折中——两个立场原本就是在讨论不同的轴，都是对的。具体而言："安静"描述的是权限轴，不是延迟轴，系统安静是因为它不发号施令，不是因为它藏着信息不给看；V10.3 只约束数量，不约束速度，它授权过滤，不授权对已知冲突坐视不管；一个开放或未完成的工作流是正常状态，不是异常，**经过的时间永远不能作为评判一个人的依据**。

**唯一的例外**：一份封闭、明确列举的安全关键型开放环列表，每一项都带有一个由临床规则定义的预期关闭窗口。名单成员资格由临床规则决定，且必须保持精简——只能由具名的临床签字修改，工程团队无权自行决定。窗口挂钩的是事件类型，绝不挂钩到具体员工；窗口到期只产生可见性，绝不产生评价，也绝不触发自动动作。

**初始名单（V12 采纳时）**：左右眼冲突（同日检查与处方/操作之间）、玻璃体内注射后随访、术后第一天未到诊、危急影像/检验结果未确认、散瞳期间或之后的药物不良反应。

---

## V12.3 条款状态标记

本宪法及未来任何版本的每一条条款，必须携带且只能携带一个状态标记。未标注状态的条款无效，不得依赖。

- **enforced**：所描述行为已在代码中实现，且受一个具名的测试、不变量或断言保护，条款必须指名该 artifact。若该 artifact 被删除、禁用或开始失败，条款自动退回 declared-not-enforced，不得默默保持 enforced。
- **declared-not-enforced**：所描述行为已达成意图和共识，但尚未实现，或实现了但没有保护。条款必须指名（a）会让它转正的 enforcing artifact，以及（b）该 artifact 上线的具体 phase。一条条款可以合法地长期停留在这个状态——这是被允许的，且正是这个标记存在的意义。不被允许的是"悄悄"停留在这里。
- **deprecated**：所描述行为曾经生效，正在被移除。实现它的代码在声明的移除日期之前被容忍，之后即视为缺陷。

**两条硬性规则：**

**规则一——未被强制执行的控制不得对外引用。** 一条标注为 declared-not-enforced 的条款，不得在任何对外场合（监管申报、审计回应、客户或合作伙伴文档、投资材料、临床治理审查）被呈现为一项真实控制。一个"文档记录在案却从未真正执行过"的控制，比一个完全没有文档记录的缺口，是更严重的法律责任。

**规则二——抵制第四种状态。** 不得新增"部分强制执行"、"预发布环境已强制执行"或类似说法。关于哪些控制是真实的这种渐进式模糊，正是 V12 存在的目的就是要消除的那种缺陷。

> **传阅提示**：有人可能会把"declared-not-enforced"误读成"承认工程失职"，进而想把它藏起来——这个理解反了，这个标记本身就是控制手段。写清楚"这事还没做"比假装做了但实际没做要安全得多。

---

## 已有条款的完整状态标记应用

### V9 部分

| 条款 | 状态 | 执行 artifact / 缺口 |
| :--- | :--- | :--- |
| V9.0 触发锚点要求 | enforced | 核心决策引擎中已有的触发验证 |
| V9.A1 交叉验证冲突检测 | 检测部分 enforced，裁决部分 declared-not-enforced | 检测生效，但被拦截的卡片没有下游消费者，见 Phase 1b |
| V9.A2 序列追踪 | 捕获部分 enforced，违规语义部分 deprecated | QR 捕获生效；"process violation/处理违规/流程违规"全仓库 grep 零命中（Codex），违规分类无代码实现，仅文档措辞待按 V12.5 改为 sequence_anomaly 语义，见 Phase 6 |
| V9.A3 系统逻辑触发 | enforced | 定时扫描已在运行 |
| V9.L1 无触发不行动 | enforced | — |
| V9.L2 无闭环不留存 | deprecated | 于 Phase 3 上线时移除，见 V12.7 |
| V9.L3 无证据不裁决 | enforced | — |
| V9.L4 无可追溯不结案 | declared-not-enforced | 目前尚无可供追溯的终结状态存在，enforcing artifact：accepted_orphan 终结状态（Phase 2b） |
| V9.X 漂浮数据不合宪，丢弃并告警 | VOID | 由 V12.6 取代；实现"丢弃"的代码即缺陷 |

### V10 部分

| 条款 | 状态 | 执行 artifact / 缺口 |
| :--- | :--- | :--- |
| V10.1 AI 永不改变诊所状态 | enforced | manager 确认路径 |
| V10.2 Evidence Normalizer 先于推理 | enforced | ingestion 层的 normalizer |
| V10.3 仅通过 Attention Queue 展示 | enforced | — |
| V10.4 建议血缘可追溯 | 建议部分 enforced，工作流创建（new_train 假设）部分 declared-not-enforced | new_train 假设携带血缘但没有持久记录可挂载，enforcing artifact：临时工作流状态（Phase 3） |
| V10.5 三种 manager 动作 | enforced | — |
| V10.6 AttentionItem | enforced | — |
| V10.7 终端隔离 | enforced | — |
| V10.8 三秒感知 | declared-not-enforced | 尚无任何测量存在，需要一条延迟断言，enforcing artifact：延迟断言（Phase 6） |

### V11 部分

| 条款 | 状态 | 执行 artifact / 缺口 |
| :--- | :--- | :--- |
| V11.1 流体化运营 | enforced | — |
| V11.2 证据化可追溯 | enforced | — |
| V11.3 仲裁架构 | enforced | — |
| V11.4 两阶段异步协议 | enforced | Ingestion/Composition 解耦已在生产环境运行 |
| V11.5a guardrail 判断逻辑（needs_manager_dispatch 贯穿 guardrailValidator→orchestratorCore→service） | enforced | 真实决定 autoAttachGateReasons、review.required 等下游判断；23 处测试验证，artifact：orchestratorCore.test.js 等测试套件 |
| V11.5b 预审队列消费者（队列实体/消费者/状态机） | declared-not-enforced | 无队列实体、消费者、状态机；由 V12.4 interim 规则暂停，enforcing artifact：审计队列完整状态机（Phase 5） |
| V11.6 硬链接回流 | enforced | — |
| V11.6b 软链接交接回流 | enforced | 代码中已 enforced，但 V11 文档从未记载；纯属文档缺陷，已写入 V12 |
| V11.7 每日截止 undo 触发 | declared-not-enforced | 目前任何失败运行都会触发，包括班次中途，enforcing artifact：undo 队列时序修复（Phase 2a） |
| V11.8 reflow/audit 对照表 | VOID | 发布内容与事实不符，不得继续沿用 |
| new_train 权威性创建 | declared-not-enforced | 目前仅有假设，没有工作流记录，enforcing artifact：临时工作流状态（Phase 3） |
| 左右眼冲突检测 | 尚不存在 | V12 新增，enforcing artifact：左右眼冲突检测（Phase 4） |
| Undo 终结状态 | 尚不存在 | V12 新增，enforcing artifact：accepted_orphan 终结状态（Phase 2b） |
| 聚合报表层 | 尚不存在 | V12 新增，enforcing artifact：聚合报表层（Phase 6） |

---

## V12.4 冲突路由（修正 V9.A1、V11.5）

一张事实卡若未通过硬冲突校验（角色/类别不匹配、主体冲突、设备身份不匹配、或左右眼冲突），会被阻止自动挂接——这条保持不变、继续 enforced。

**锁定语义收窄**：V9.A1 原有的实体锁被收窄为——冲突只阻止"确认"和"跨系统导出"这两件事，不阻止继续采集证据、不阻止临床活动、不阻止患者在诊所内的流转。一个能把患者中途冻结的系统，就已经越界闯入了权限轴。具体而言，一个有冲突的实体不得被提升为 confirmed，不得被引用在任何对外声明、财务记录或库存变动中，但可以正常继续累积事实卡。

**临时规则**（从 V12 采纳起生效，直到 Phase 5 退出条件满足；将在 Phase 1b 上线时标注为 enforced）：needs_manager_dispatch=false 暂停执行，每一张被阻止的事实卡立即物化为一条 AttentionItem，attention_type 为 `pre_attach_conflict`，status 为 `open`，安全关键型冲突（见豁免清单）urgency 为 red，其余为 yellow，携带 evidence_ids、event_ids、reasoning_chain（按 V10.4 要求）。

**理由**（记录在案，避免以后重复争论）：一个没建成的门，不是门。在 V9.A1"立即展示给人看"和 V11.5"暂存等待预审"之间，目前只有 V9.A1 可执行，因为 V11.5 的预审者根本不存在。现有代码执行的是 V11.5 的拦截逻辑，却没有 V11.5 的消费者，这是两者组合里唯一真正不安全的情形——冲突既没人裁决，也没人看见。

**终局规则**（Phase 5 退出后生效）：needs_manager_dispatch=false 恢复。被拦截的事实卡进入预挂接审计队列，必须在一个有界窗口内到达三种终态之一：`resolved_attach`、`resolved_separate`、`escalate_human`，只有 `escalate_human` 会物化为 AttentionItem。执行 artifact：unconsumed-tag 不变量（Phase 5 退出条件）。

**永久豁免**：同日检查卡与处方/操作卡之间的左右眼冲突，无论 interim 还是终局状态，都绕过队列，立即以 urgency=red 物化为 AttentionItem。这条豁免不受任何未来修正案的批处理、限流或预审影响，除非经过临床签字。

---

## V12.5 流程序列观察（修正 V9.A2）

乱序 QR 扫描记录为 `sequence_anomaly`。"流程违规"这个术语连同挂在它身上的所有行为一并作废。sequence_anomaly 不锁定实体、不升级到 A1、不生成 AttentionItem、不出现在任何个人记录上、不在 manager 可见的任何界面上关联到具名员工。sequence_anomaly 只汇入聚合层（仅限 Phase 6），作为一个按日期/分支/领域/序列对统计的计数，目的是定位哪里的采集环节断了，绝不是刻画某个人或某个班次。

**理由**：乱序扫描绝大多数是合法的临床变化——重复测量、紧急插队、临时到诊、患者返回前一站点。把这些归类为违规会在最忙的时刻产生大量误报，隐含地点名当时在场的人，直接违反"经过的时间和序列是证据、不是评价"这条原则。

**边界**：如果一个扫描序列同时暗示患者身份或左右眼冲突，它就不是 sequence_anomaly，而是硬冲突，按 V12.4 路由。

---

## V12.6 隔离而非丢弃（作废 V9.X）

任何 artifact、事实卡或事件都绝不被丢弃。没有治理触发锚点的到达数据被写入一个隔离分区，永久保留。隔离记录被排除在组合和一切运营报表之外，保留完整血缘和摄入来源，如果后续出现治理触发锚点，可无损重新纳入组合，并作为数据质量信号被计入聚合层。

**理由**：V9.L3（无证据不裁决）和 V9.L4（无可追溯不结案）都要求证据必须留存，一条强制销毁证据的条款不可能和它们共存。在一个受监管的临床和计费环境里，销毁还是唯一一种事后无法补救的行为。

---

## V12.7 留存（修正 V9.L2）

将"无闭环不留存"改为"无闭环不确认"。留存在每一个未确认状态下都是被允许的、且是必须的——provisional、quarantined、orphan、accepted_orphan。只有晋升为 confirmed，以及（按 V12.4）跨出系统边界的导出，才需要一个闭合、可追溯的环。

**理由**：原始条款正是"new_train 缺口在代码评审中看起来说得过去"的原因。它站不住脚——它强迫系统忘记一切尚未理解完的东西，这会让记录偏向"延续已知"、排斥"新出现的情况"。留存和确认是两个不同的保证，不该共用一条规则。

---

## 分阶段执行计划（依赖图）

- **Phase 0**：仅文档，零代码、零 schema、零配置
- **Phase 1**：埋点 + interim A1 安全路由激活
- **Phase 2**：undo 队列时序修复 + 终结状态（必须同时上线，见下方专家判断）
- **Phase 3**：临时工作流状态（与 Phase 4 并行，互不依赖）
- **Phase 4**：左右眼冲突检测（与 Phase 3 并行，只依赖 Phase 1b）
- **Phase 5**：审计队列完整状态机（部分依赖 Phase 3）
- **Phase 6**：聚合报表层
- **Phase 7**：阈值调优（最后，且必须有数据支撑才能做）
- **Track G**：黄金标准数据集构建（从 Phase 1 开始，持续到 Phase 7，日历时间工作，是 Phase 7 最可能延误的长杆）

### 关于"undo 时序修复是否该提前"的判断

是的，但有两个前提。第一，埋点必须最先做——如果先修时序再埋点，就丢失了"修复前后对比"的基线，没法证明这个修复到底起没起作用；埋点是零成本、纯增量、不阻塞任何东西，永远排在第一位。第二，时序修复必须和 accepted_orphan 终结状态一起上线，不能先上时序修复。原因是：时序修复会让 undo 队列变深（原本班次中途就能清掉的条目，现在要等到日结才清），而一个没有合法退出口的更深队列，恰恰会加大"伪造记录"的压力——这正是时序修复本来想解决的问题。单独先上时序修复而不同时上终结状态，会在几周内让你最在意的那个维度变得更糟。这两者是一个阶段，不是两个。

---

## Phase 0 完成状态

- [x] V12 正式文本发布，一字不差收录 Part 1、Part 2 全部内容
- [x] V9、V10 每一条条款均携带且仅携带一个状态标记（见上方状态表，已照抄至 V9/V10 源文档）
- [x] 每一条 declared-not-enforced 条款均写明 enforcing artifact 名称与对应 phase
- [x] V9.X 在源文档 `docs/CLINIC_OS_V9.md` 中被标注为 VOID
- [x] V11.8 / V11 标题的 VOID 判定记录于本 V12 文本（V11 处置表与 V11 状态表）——不补建 V11 源文档
- [x] 未改动任何代码、schema、配置

### 关于 V11 源文档缺失（已决，非阻塞）

`docs/CLINIC_OS_V11.md` 在仓库中不存在。经决定：**不再要求补一份 V11 源文件，接受 V11.8 与 V11 标题的 VOID 判定只记录在 V12 正文里。** 理由：事后补写的 V11 文件不是当年真实存在过的文本，若被当历史依据引用，会造成"V11 当年到底怎么规定"被追溯性篡改的假象，与 V12"如实记录状态、不掩盖缺口"的精神相反。V12 本身是唯一治理权威，V9/V10/V11 条款一旦被 V12 处置表收录即生效，无需回头改动旧文件才算数。V9 能"改源文件"只因 V9 文件恰好仍在仓库，属偶然条件，不构成 V11 必须凑齐该动作的义务。

### grep 待办（用户已另派 Codex，此处不重复）

`needsManagerDispatch` 与 `process violation` 两字符串的代码命中位置清单由 Codex 只读搜索产出后同步，Phase 0 不在本轮重复执行。

---

*本文件为 Clinic OS V12 正式宪法，自采纳之日起为唯一治理权威。V9/V10/V11 任何与之冲突的条款，按 V12.1 处置表归位，不得单独引用。*