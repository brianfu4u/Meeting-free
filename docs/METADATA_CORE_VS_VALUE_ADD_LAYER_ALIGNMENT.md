# 解析元数据总线分层：基础编组 vs 增值详细

## 1. 目的

解析服务在一次处理内同时保存两类数据，但两类消费者必须严格分开：

```text
原始证据
  → 解析服务
  → core_routing_fields  ──→ EvidenceFactCard routing.* ──→ 编组 Agent
  → value_add_fields     ──→ 元数据实体                 ──→ 增值服务
```

基础编组不能因为详细数值缺失而停止；增值服务不能把未解析的详细数据假装为完整结果。

统一契约版本：

```text
metadata-layer-contract.v1
```

## 2. `core_routing_fields`

这是基础版产品和编组 Agent 使用的唯一元数据层。

通用字段：

| 字段 | 用途 |
|---|---|
| `metadata_domain` | `eye_exam` 或 `ops_event` |
| `exam_type` / `event_type` | 主要类别 |
| `exam_item_name` / `event_title` | 具体项目或事件名称 |
| `clinic_id` | 门店租户范围 |
| `patient_id` | 可选患者关联；不得从报告内容猜测身份 |
| `department` | 负责部门或发生区域 |
| `role` | 来源或建议处理岗位 |
| `occurred_at` | 业务发生时间 |
| `reported_at` | 汇报或上传时间 |
| `basic_summary` | 不含诊疗结论的简短摘要 |
| `item_tag` | 人工确认优先的项目/事件标签 |
| `priority_hint` | 基础优先级提示 |
| `sla_target_minutes` | SLA 提示，不自动产生任务决定 |
| `requires_reupload` | 是否需要重新上传清晰证据 |

### FactCard 总线投影

只有基础层会投影为：

```text
routing.metadata_domain
routing.exam_type
routing.exam_item_name
routing.event_type
routing.event_title
routing.clinic_id
routing.patient_id
routing.department
routing.role
routing.occurred_at
routing.reported_at
routing.basic_summary
routing.item_tag
routing.priority_hint
routing.sla_target_minutes
routing.routing_status
routing.value_add_status
routing.requires_reupload
```

详细测量值和运营指标不得写入 `routing.*`。

## 3. `value_add_fields`

这一层在解析阶段同步保存，但不进入基础编组总线。

### 眼科检查

```json
{
  "device_context": {
    "device_vendor": "TOPCON",
    "device_model": "KR-800"
  },
  "report_key_values": {
    "pd_mm": 61.5,
    "vd_mm": 12
  },
  "eye_side_results": {
    "right": {
      "key_values": {
        "sphere_d": -2.25,
        "cylinder_d": -1,
        "axis_deg": 163
      }
    },
    "left": {
      "key_values": {
        "sphere_d": -2.5,
        "cylinder_d": -1.25,
        "axis_deg": 140
      }
    }
  }
}
```

用途：电子病历/病程记录合成、检查结果纵览、趋势分析和质量报表。

### 运营事件

```json
{
  "training_duration_minutes": 90,
  "participant_count": 8,
  "complaint_severity_score": 4,
  "involved_process_nodes": ["挂号", "候诊"],
  "equipment_failure_count": 2,
  "downtime_minutes": 45
}
```

用途：运营分析、质量分析和增值报表。

## 4. 双状态模型

### 基础编组状态

- `routing_ready`：基础字段足够编组。
- `routing_partial`：已有部分基础信息，但仍缺关键字段。
- `routing_blocked`：无法形成可用基础记录。

### 增值详细状态

- `value_add_complete`：该类型预期的详细字段完整。
- `value_add_partial`：存在部分详细字段。
- `value_add_unavailable`：没有可靠详细字段。

合法组合示例：

```text
routing_ready + value_add_partial
routing_ready + value_add_unavailable
```

这两种记录都可以进入基础编组。

## 5. 编组 Agent 读取规则

Candidate Finder R2.6 只读取：

1. `routing.*`；
2. 为兼容合并前历史记录保留的少量眼科 core aliases。

明确禁止读取：

- `value_add_fields`；
- 左右眼度数、眼压、厚度、信号强度等；
- 设备型号和报告参数；
- 投诉评分、培训时长、参与人数；
- 故障次数和停机时长。

编组候选仍受以下原有护栏约束：

- 同诊所租户隔离；
- 显式 Workflow ID 优先；
- 时间窗口候选；
- 候选白名单；
- 经理复核及自动挂接门槛不变。

基础层可为候选附带：

```json
{
  "assignment_role_hint": "EQUIPMENT_ADMIN",
  "department_hint": "特检室",
  "priority_hint": "P1",
  "sla_target_minutes": 15
}
```

这些只是路由提示，不直接修改系统状态。

## 6. 增值服务读取规则

增值服务必须通过产品套餐开关访问 `value_add_fields`。

未启用套餐：

> 当前套餐未启用增值详细数据服务。

已启用但没有详细数据：

> 此记录目前仅存储为基础记录，未解析详细数值。

部分数据：

> 详细数据仅部分可用。

增值服务不得回退使用 `core_routing_fields` 伪造详细数值。

## 7. 完整示例：验光检查

### 保存结果

```json
{
  "routing_status": "routing_ready",
  "value_add_status": "value_add_complete",
  "core_routing_fields": {
    "metadata_domain": "eye_exam",
    "exam_type": "屈光验光",
    "exam_item_name": "自动验光 / Ref Data",
    "clinic_id": "clinic-001",
    "patient_id": "patient-001",
    "department": "特检室",
    "role": "OPTOMETRIST",
    "occurred_at": "2026-08-01T10:34:00Z",
    "basic_summary": "屈光验光：自动验光 / Ref Data",
    "item_tag": "refraction"
  },
  "value_add_fields": {
    "device_context": {
      "device_vendor": "TOPCON",
      "device_model": "KR-800"
    },
    "report_key_values": {
      "pd_mm": 61.5
    },
    "eye_side_results": {
      "right": { "key_values": { "sphere_d": -2.25, "axis_deg": 163 } },
      "left": { "key_values": { "sphere_d": -2.5, "axis_deg": 140 } }
    }
  }
}
```

编组 Agent 使用患者、项目、门店、部门和时间选择候选 Workflow；电子病历或纵览服务在套餐启用后读取左右眼数值。

## 8. 完整示例：患者投诉

```json
{
  "routing_status": "routing_ready",
  "value_add_status": "value_add_complete",
  "core_routing_fields": {
    "metadata_domain": "ops_event",
    "event_type": "complaint",
    "event_title": "患者等待时间投诉",
    "clinic_id": "clinic-001",
    "department": "前台",
    "role": "RECEPTION",
    "occurred_at": "2026-08-01T11:00:00Z",
    "basic_summary": "患者反映候诊等待时间过长",
    "priority_hint": "P2",
    "sla_target_minutes": 30
  },
  "value_add_fields": {
    "complaint_severity_score": 4,
    "involved_process_nodes": ["挂号", "候诊"]
  }
}
```

编组 Agent 使用 `complaint + 前台 + RECEPTION + 时间` 路由；质量报表使用严重程度和流程节点分析投诉原因。

## 9. 安全边界

- 两层数据继续遵守 `clinic_id` 租户隔离。
- 基础摘要不得包含自动诊断或治疗建议。
- 眼科详细字段只记录检查数据，不评价正常/异常。
- 运营详细字段只记录明确证据，不自动作出人员处分或管理决定。
- 套餐开关只控制增值读取和展示，不删除已保存的详细数据。
