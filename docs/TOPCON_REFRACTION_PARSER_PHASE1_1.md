# TOPCON 自动验光小票解析 — Phase 1.1

## 目标

在既有 `EyeExamReportMetadata` Phase 1 框架内，把 TOPCON `REF. DATA` 多行小票稳定转换为可供工作流检索和界面展示的检查数据记录。

本解析器不判断检查结果是否正常，不生成诊断、配镜、治疗或用药建议。

> 仅为检查数据记录，不构成医学诊断或治疗建议。

## 输入样例

```text
NAME
2026_08_01 AM 10:34
NO.0465
SN:4694190
REF. DATA
VD: 12.00 CYL: (-)
<R> S C A
 - 2.25 - 1.25 163
 - 2.25 - 1.00 164
 - 2.25 - 1.00 163
 - 2.25 - 1.00 163
 S. E. - 2.75
<L> S C A
 - 2.50 - 1.25 14
 - 2.50 - 1.00 14
 - 2.25 - 1.25 14
 - 2.50 - 1.25 14
 S. E. - 3.25
PD: 61.5
TOPCON
```

## 解析策略

### 1. 眼别和逐行测量

解析器先以 `<R>/<L>`、`OD/OS`、`R/L` 标记拆分左右眼，再逐行识别 `S C A` 三列。

OCR 中负号与数字之间存在空格时仍可解析，例如：

```text
- 2.25 - 1.25 163
```

所有有效测量行保存在：

```text
eye_side_results.right.raw_measurements
eye_side_results.left.raw_measurements
```

每行保留 `sphere_d`、`cylinder_d`、`axis_raw_deg`、最终 `axis_deg` 和 `source_line`，用于审计和后续设备精细适配。

### 2. 代表值

- `sphere_d`：报告打印了 `S.E.` 时，按当前工作流合同使用 `S.E.` 作为代表球镜值，并同时写入 `spherical_equivalent_d`。原始 S 列仍完整保存在 `raw_measurements`。
- `cylinder_d`：对所有 C 列取众数；如果众数并列，取最后一行对应值。
- `axis_deg`：对所有 A 列取众数；如果众数并列，取最后一行对应值。
- `PD`、`VD`：作为双眼共享的报告级字段写入 `report_key_values.pd_mm` 和 `report_key_values.vd_mm`。

本例右眼 C 的众数为 `-1.00`，A 的众数为 `163`；左眼 C 的众数为 `-1.25`。

### 3. 轴位 OCR 尾零容错

`14°` 本身处于合法轴位范围，因此不能仅因为数值较小就任意改写。Phase 1.1 只在以下条件全部满足时应用 TOPCON 小票专用尾零恢复：

1. 至少存在三行有效 S/C/A 测量；
2. 所有行的原始轴位完全相同；
3. 原始轴位为整数 `10–18`；
4. 乘以 10 后处于 `100–180`。

满足时：

- `axis_deg` 写入恢复后的值，例如 `140`；
- `axis_original_ocr_deg` 保留原始 `14`；
- `axis_correction_applied = true`；
- warning 写入 `left_axis_trailing_zero_ocr_recovered`；
- 每条 `raw_measurements` 同时保留原始轴位和恢复后轴位。

不满足上述条件时，解析器不会猜测或修改轴位。该规则只修复 OCR 格式，不代表医学判断。

## 输出示例

```json
{
  "schema_version": "eye-exam-report-metadata.v1.1",
  "exam_type": "屈光验光",
  "exam_item_name": "自动验光 / Ref Data",
  "device_vendor": "TOPCON",
  "measured_at": "2026-08-01T10:34:00",
  "report_key_values": {
    "pd_mm": 61.5,
    "vd_mm": 12.0
  },
  "eye_side_results": {
    "right": {
      "key_values": {
        "sphere_d": -2.75,
        "cylinder_d": -1.0,
        "axis_deg": 163,
        "spherical_equivalent_d": -2.75
      },
      "raw_measurements": ["4 rows retained"]
    },
    "left": {
      "key_values": {
        "sphere_d": -3.25,
        "cylinder_d": -1.25,
        "axis_deg": 140,
        "spherical_equivalent_d": -3.25,
        "axis_original_ocr_deg": 14,
        "axis_correction_applied": true
      },
      "raw_measurements": ["4 rows retained"]
    }
  },
  "parse_status": "parsed",
  "warnings": [
    "left_axis_trailing_zero_ocr_recovered"
  ]
}
```

## 状态约定

统一模型继续使用既有成功状态 `parsed`，不新增同义的 `parsed_success`，避免破坏 Phase 1 API。

当左右眼 S/C/A 均完整，且报告中明确出现的 PD、VD、日期均成功解析时，本格式返回 `parsed`。只有眼别缺失、S/C/A 不完整、单位或报告结构严重不确定时才返回 `partial`；未知眼科格式仍进入 `fallback`。

通用 Fragment 工作流对齐状态与眼科报告元数据状态是两套不同状态。上传预览会优先显示眼科元数据的 `parsed`，不会再把通用工作流的 `needs_clarification` 误显示为本报告元数据未解析。

## FactCard 投影

以下工作流字段会写入 `EvidenceFactCard.fields`：

```text
eye_exam.pd_mm
eye_exam.vd_mm
eye_exam.right.sphere_d
eye_exam.right.cylinder_d
eye_exam.right.axis_deg
eye_exam.left.sphere_d
eye_exam.left.cylinder_d
eye_exam.left.axis_deg
```

轴位原始 OCR 值也保留为审计字段，但工作流详情默认只展示最终 `axis_deg`。
