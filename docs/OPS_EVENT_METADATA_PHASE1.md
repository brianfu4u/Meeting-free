# OpsEventMetadata Phase 1

## 1. 范围

OpsEventMetadata 将诊所运营/行政汇报统一保存为两层数据：

- `core_routing_fields`：基础工作流编组、岗位分配、优先级和 SLA 提示。
- `value_add_fields`：运营分析与质量报表使用的详细指标。

固定声明：

> 仅为诊所运营事件记录与业务分类，不构成医疗诊断、治疗建议或自动管理决定。

## 2. 当前事件类型

```text
complaint
training
equipment_failure
resource_request
progress_update
completion
staff_coordination
other
```

## 3. 基础编组层

必需字段：

```text
event_type
event_title
clinic_id
occurred_at
basic_summary
```

可选字段：

```text
patient_id
department
role
reported_at
item_tag
priority_hint
sla_target_minutes
```

员工汇报即使 LLM 失败，也会以原始文本摘要和汇报类型生成基础记录；详细指标缺失不阻断基础编组。

## 4. 增值详细层

| 事件 | 详细字段 |
|---|---|
| 培训 | `training_duration_minutes`、`participant_count`、`training_topic` |
| 投诉 | `complaint_severity_score`、`involved_process_nodes`、`complaint_channel` |
| 设备故障 | `equipment_failure_count`、`downtime_minutes`、`equipment_id` |
| 其他 | `additional_metrics`，仅保存证据明确出现的指标 |

解析器不得猜测不存在的数值。

## 5. 员工汇报数据流

```text
StaffReportService
  → EvidenceItem
  → Artifact / EvidenceFactCard 实时桥接
  → 运营事件结构化解析
  → OpsEventMetadata 保存 core + value-add
  → core 投影为 FactCard routing.*
  → 编组 Agent 只读取 routing.*
```

OpsEventMetadata 写入失败不会回滚员工原始汇报、EvidenceItem 或 Artifact；失败会写入审计事件。

## 6. 状态示例

投诉内容明确，但没有严重程度评分：

```json
{
  "routing_status": "routing_ready",
  "value_add_status": "value_add_partial",
  "core_routing_fields": {
    "event_type": "complaint",
    "event_title": "患者等待时间投诉",
    "clinic_id": "clinic-001",
    "department": "前台",
    "role": "RECEPTION",
    "occurred_at": "2026-08-01T11:00:00Z",
    "basic_summary": "患者反映候诊等待时间过长"
  },
  "value_add_fields": {
    "involved_process_nodes": ["挂号", "候诊"]
  }
}
```

这条记录可以正常进入投诉处理 Workflow；增值报表应说明投诉评分尚未解析。

## 7. 租户与权限

- `clinic_id` 必须与来源员工、事件、EvidenceItem、Artifact 和 FactCard 一致。
- 投影 FactCard 前再次验证租户。
- 运营详细指标不直接创建、完成或重新分配任务。
- AttentionItem 和任务状态变更仍遵守现有 Human Authority 规则。
