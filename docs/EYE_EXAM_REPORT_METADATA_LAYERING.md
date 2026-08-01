# EyeExamReportMetadata v1.3 数据分层

## 1. 版本变化

EyeExamReportMetadata 从 v1.2 升级到：

```text
eye-exam-report-metadata.v1.3
```

原有平铺字段继续保留为兼容镜像，但新代码必须遵守：

- 编组读取 `core_routing_fields`；
- 电子病历、结果纵览和分析读取 `value_add_fields`。

## 2. 基础编组字段

```json
{
  "metadata_domain": "eye_exam",
  "exam_type": "屈光验光",
  "exam_item_name": "自动验光 / Ref Data",
  "clinic_id": "clinic-001",
  "patient_id": "patient-001",
  "department": "特检室",
  "role": "OPTOMETRIST",
  "occurred_at": "2026-08-01T10:34:00Z",
  "reported_at": "2026-08-01T10:35:00Z",
  "basic_summary": "屈光验光：自动验光 / Ref Data",
  "item_tag": "refraction",
  "priority_hint": "P3",
  "requires_reupload": false
}
```

这一层不包含检查结果数值，也不包含医学结论。

## 3. 增值详细字段

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
      },
      "raw_measurements": []
    },
    "left": {
      "key_values": {
        "sphere_d": -2.5,
        "cylinder_d": -1.25,
        "axis_deg": 140
      },
      "raw_measurements": []
    }
  }
}
```

OCT 厚度、信号强度、眼压、角膜内皮 CD/CCT、眼科超声参数等均位于此层。

## 4. FactCard 投影变化

v1.2 及以前会将部分详细数值写入：

```text
eye_exam.right.*
eye_exam.left.*
eye_exam.pd_mm
```

v1.3 新记录不再把这些详细值投影到 FactCard。新投影仅包括：

```text
routing.*
```

并暂时保留以下眼科基础别名用于历史兼容：

```text
eye_exam.exam_type
eye_exam.exam_item_name
eye_exam.exam_item_suggested_tag
eye_exam.exam_item_manual_tag
eye_exam.exam_item_manual_label
eye_exam.match_exam_item
eye_exam.measured_at
eye_exam.routing_status
eye_exam.value_add_status
```

这些别名仍然只属于基础路由，不包含检查数值。

## 5. 不完整解析

例如 OCR 可以识别：

- 这是屈光验光报告；
- 患者、门店和检查时间明确；
- 但左右眼数值无法可靠提取。

结果可以是：

```json
{
  "routing_status": "routing_ready",
  "value_add_status": "value_add_unavailable"
}
```

编组 Agent 仍可将报告路由到验光 Workflow。增值服务显示：

> 此记录目前仅存储为基础记录，未解析详细数值。

如果 OCR 质量为 `poor`，记录仍保存，但：

```text
requires_reupload = true
```

基础摘要标记等待重新上传，详细 parser/LLM 不运行。

## 6. 人工项目确认

员工确认的 `exam_item_manual_tag` 会成为：

```text
core_routing_fields.item_tag
```

并优先于自动识别项目参与候选排序。它只是业务分类，不产生诊断或治疗建议。

## 7. 增值读取

增值服务必须检查套餐开关和 `value_add_status`：

- 未启用套餐：不返回详细字段；
- `value_add_unavailable`：提示仅存基础记录；
- `value_add_partial`：提示详细数据部分可用；
- `value_add_complete`：可供电子病历、纵览、趋势和分析使用。

完整总线规则见：

```text
docs/METADATA_CORE_VS_VALUE_ADD_LAYER_ALIGNMENT.md
```
