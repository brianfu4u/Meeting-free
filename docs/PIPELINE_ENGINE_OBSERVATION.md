# pipelineEngine 调用观察备忘（疑似废弃代码 · 观察中）

**状态：** 疑似废弃代码，观察中（DEPRECATED · UNDER OBSERVATION）  
**建观察日期：** 2026-07-24  
**观察窗口：** 2026-07-24 → 2026-08-23（30 天）  
**关联 Bug：** `pipelineEngine/entry.ts:263` — `arrival_time` 缺失时回退 `Date.now()`，导致 `totalElapsedMinutes≈0`、`isStalled` 恒为 false，卡诊检测静默失效。

---

## 一、已查清的证据链（代码层，本轮可复现）

1. **零内部调用者** — 全仓库搜索：无其他后端函数调用它（`specLoaderService` 仅有一行文档注释提及）；无前端 fetch（`src/lib/phase3/contract.js` 仅一行注释写"legacy 不动"）；无生效的定时自动化（唯一自动化 `phase4_composition_scan` 调的是 `compositionOrchestrator` 且 `is_active=false`）；`base44/workflows` 与 `base44/config.jsonc` 均无引用。
2. **扫码入口不经过它** — `src/lib/scanGate.js` 是真实扫码处理入口：创建 `ScanEvent`、更新 `PatientSession`、发布事件后直接返回，**从不调用 pipelineEngine**。
3. **Integrations 页面** — 仅有 GitHub API 一条集成，与 pipelineEngine 无关（注：此项为控制台侧观察，非代码可证）。

## 二、唯一未确认的路径

扫码终端固件 / PDA 设备是否绕过本仓库、直接对 pipelineEngine 的 HTTP endpoint 发 POST 请求。  
此路径**无法通过代码或现有日志排除**——它发生在 Base44 平台外部，需平台控制台侧（Logs Explorer 调用日志 / Function URL + Integrations 比对 / 外部 curl 验证）才能确认，上述控制台操作本轮均无法由代码侧完成。

## 三、观察机制

对 pipelineEngine 的调用进行告警监控，30 天观察窗口内：
- **告警响了哪怕一次** → 仍有活跃调用来源，立刻升级处理，重新评估 `arrival_time` 回退 bug 的紧急程度。
- **30 天零告警** → 获得"确实无人调用"的扎实证据，正式归档为 `deprecated`，bug 降级为低优先级技术债处理。

### 告警实现方式（待确认，见下文权衡）

两种可行方案，各有覆盖面差异，需确认后落实。

## 四、Bug 修复原则（暂不动代码）

已定通用原则：**"缺失"必须能被系统识别并展示为独立状态，不得随便挑一个看似安全的默认值顶替。**  
因此 `arrival_time` 缺失时回退 `Date.now()` 这一行的修复，需按此原则重新设计（如回退 `seated_time`、再缺则标记为"到达时间未知"独立态并转店长关注），不是现场想一个新兜底值了事。  
**在观察期结束、调用情况明确前，不改动 pipelineEngine 任何代码。**

## 五、观察期结论模板（30 天后填写）

- [ ] 30 天内告警触发次数：___
- [ ] 触发来源（若有）：___
- [ ] 最终处置：☐ 正式 deprecated ☐ 升级修复 bug
- [ ] 处置日期：___  处置人：___