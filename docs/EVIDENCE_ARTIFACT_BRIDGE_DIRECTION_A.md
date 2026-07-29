# EvidenceItem → Artifact Bridge（方向 A：实时桥接）

## Scope

本实现只处理 `staffReportService` 当前请求中新创建的 `EvidenceItem`：

`EvidenceItem → Artifact → FragmentProcessingResult → EvidenceFactCard → Composition scheduled scan pool`

历史 `EvidenceItem` 批量回填明确不在本 PR 范围内，待实时链路验证通过后单独排期。

## Idempotency and state

- `Artifact.origin_evidence_item_id` 是应用层幂等键；同一 `clinic_id + EvidenceItem.id` 复跑复用既有链路。
- `EvidenceItem.bridge_status`: `pending → processing → converted | failed`
- `EvidenceItem.attempt_count`: 最多 3 次。
- `EvidenceItem.last_error_code`: 仅保存 allowlist 脱敏错误码，成功后清空。
- `FragmentProcessingResult` 和 `EvidenceFactCard` 同步保存 `origin_evidence_item_id`，形成完整追踪链。

## Failure isolation

桥接在 `staffReportService` 内部以隔离边界调用：

- 桥接成功或失败都不改变员工汇报主流程的成功语义。
- 第 1、2 次失败仅写 `AuditLog`。
- 第 3 次失败才创建 `attention_type=evidence_missing` 的去重 `AttentionItem`。
- 去重键：`evidence-bridge-failed::{clinic_id}::{evidence_item_id}`。

## Composition boundary

桥接只生成 `assembly_eligible=true`、`alignment_status=aligned` 且带有限 `Artifact.ingestion_seq` 的 FactCard，等待现有定时扫描读取。

本 PR 不修改：

- 七条推断轨道
- CandidateFinder 排序
- GuardrailValidator
- Workflow Assembly
- review / commit / closure 权限
