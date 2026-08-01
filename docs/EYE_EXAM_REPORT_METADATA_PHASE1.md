# 眼科检查报告元数据解析框架 — Phase 1

## 1. 目标与边界

本层只把眼科检查报告转成统一、可追溯的**检查数据记录**。它不承担医学诊断，不判断数值正常或异常，也不产生治疗、用药或手术建议。

固定声明：

> 仅为检查数据记录，不构成医学诊断或治疗建议。

数据流：

```text
员工上传图片/PDF
  → EvidenceItem 原始存档
  → evidenceArtifactBridge
  → Artifact
  → OCR / 文本提取（FragmentProcessingResult.extracted_text）
  → eyeExamMetadata dispatch
       1. 设备/格式规则解析
       2. 规则结果不完整时，受 JSON Schema 约束的 LLM 补全
       3. 未适配格式进入 fallback
  → EyeExamReportMetadata
  → 关键字段追加到 EvidenceFactCard.fields
  → 工作流详情“检查报告元数据”区域
```

元数据派生失败不会回滚 EvidenceItem、Artifact 或员工汇报。原始证据链优先保存。

## 2. 统一元数据模型

Schema 版本：`eye-exam-report-metadata.v1`

| 字段 | 含义 |
|---|---|
| `clinic_id` | 服务端校验后的诊所 ID |
| `patient_id` | 可选的 PatientSession/患者关联；Phase 1 不从报告猜患者身份 |
| `raw_artifact_id` | 来源 Artifact，解析幂等锚点 |
| `origin_evidence_item_id` | 来源 EvidenceItem |
| `evidence_fact_card_id` | 关联 FactCard |
| `record_kind` | 固定为 `exam_data_record` |
| `exam_type` | 检查大类，如眼压检查、屈光验光、OCT |
| `exam_item_name` | 具体项目，如 Tono Data、Macular Cube 512x128 |
| `device_vendor` | 设备厂商，如 TOPCON、ZEISS |
| `device_model` | 设备型号，如 CT-800、CIRRUS HD-OCT 5000 |
| `measured_at` | 报告中的检查日期时间 |
| `eye_side_results.right` | 右眼原文与 `key_values` |
| `eye_side_results.left` | 左眼原文与 `key_values` |
| `parser_id` / `parser_version` | 命中的格式解析器与版本 |
| `parse_status` | `parsed` / `partial` / `fallback` |
| `parse_confidence` | 元数据解析置信度，不是医学判断置信度 |
| `warnings` | 格式未适配、字段缺失等技术提示 |
| `raw_text_excerpt` | OCR/文本摘录，用于溯源 |
| `disclaimer` | 非诊断固定声明 |

### FactCard 投影

为兼容现有编组和查询逻辑，关键值同时扁平写入 `EvidenceFactCard.fields`：

```text
eye_exam.exam_type
eye_exam.exam_item_name
eye_exam.device_vendor
eye_exam.device_model
eye_exam.measured_at
eye_exam.right.average_iop_mmhg
eye_exam.left.average_iop_mmhg
...
```

完整结构保存在 `EyeExamReportMetadata`，FactCard 只保存工作流常用投影。

## 3. 中央 dispatch

`base44/shared/eyeExamMetadata/dispatch.ts` 维护统一解析器注册表。

选择过程：

1. 所有解析器对 OCR 文本计算检测分数。
2. 得分最高且达到阈值的模块负责规则解析。
3. 没有模块达到阈值，但文本明显属于眼科检查报告时，进入 fallback。
4. 非眼科运营文件直接返回 `null`，不创建元数据记录。
5. 规则结果为 `partial`、缺少设备/日期/关键值时，才调用 LLM 补全。

LLM 的 JSON Schema 只允许元数据字段。即使模型返回 `diagnosis`、`treatment_recommendation` 等额外字段，也不会合并或保存。

## 4. Phase 1 已支持模块

### 4.1 `topcon_tono_parser`

用途：TOPCON 眼压小票、Tono Data。

输入示例：

```text
TOPCON CT-800
TONO DATA
2026/08/01 09:35
OD AVG: 19 mmHg
OS AVG: 17 mmHg
```

输出摘要：

```json
{
  "exam_type": "眼压检查",
  "exam_item_name": "Tono Data",
  "device_vendor": "TOPCON",
  "device_model": "CT-800",
  "measured_at": "2026-08-01T09:35:00",
  "eye_side_results": {
    "right": { "key_values": { "average_iop_mmhg": 19 } },
    "left": { "key_values": { "average_iop_mmhg": 17 } }
  }
}
```

### 4.2 `topcon_refraction_parser`

用途：TOPCON 自动验光/角膜曲率小票。

输入示例：

```text
TOPCON KR-800
REF DATA
OD SPH -2.50 CYL -0.75 AXIS 90
OS SPH -3.00 CYL -0.50 AXIS 85
```

输出摘要：

```json
{
  "exam_type": "屈光验光",
  "exam_item_name": "Ref Data",
  "eye_side_results": {
    "right": { "key_values": { "sphere_d": -2.5, "cylinder_d": -0.75, "axis_deg": 90 } },
    "left": { "key_values": { "sphere_d": -3, "cylinder_d": -0.5, "axis_deg": 85 } }
  }
}
```

### 4.3 `zeiss_oct_parser`

用途：ZEISS Cirrus OCT，首期识别 Macular Cube、Optic Disc Cube、RNFL 标题和常见厚度/信号字段。

输入示例：

```text
ZEISS CIRRUS HD-OCT 5000
Macular Cube 512x128
OD Central Subfield Thickness: 248 um Signal Strength: 8
OS Central Subfield Thickness: 251 um Signal Strength: 9
```

输出摘要：

```json
{
  "exam_type": "OCT",
  "exam_item_name": "Macular Cube 512x128",
  "device_vendor": "ZEISS",
  "eye_side_results": {
    "right": { "key_values": { "central_subfield_thickness_um": 248, "signal_strength": 8 } },
    "left": { "key_values": { "central_subfield_thickness_um": 251, "signal_strength": 9 } }
  }
}
```

### 4.4 `generic_fundus_photo_parser`

用途：通用眼底照相报告，支持 CANON/KOWA/TOPCON/NIDEK/ZEISS 等厂商提示。

输入示例：

```text
CANON CR-2
Color Fundus Photography
OD image captured
OS image captured
```

输出摘要：

```json
{
  "exam_type": "眼底照相",
  "exam_item_name": "Color Fundus Photography",
  "device_vendor": "CANON",
  "warnings": ["image_findings_are_not_interpreted_in_phase1"]
}
```

Phase 1 不分析眼底图像病变。

### 4.5 `generic_corneal_endothelium_parser`

用途：角膜内皮细胞/非接触式角膜显微镜报告。

输入示例：

```text
TOMEY EM-4000
Corneal Endothelial Cell Analysis
OD CD 2780 CCT 532 CV 31 HEX 56
OS CD 2690 CCT 528 CV 33 HEX 54
```

输出摘要：

```json
{
  "exam_type": "角膜内皮细胞检查",
  "eye_side_results": {
    "right": { "key_values": { "cell_density_cells_mm2": 2780, "cct_um": 532, "cv": 31, "hex_percent": 56 } },
    "left": { "key_values": { "cell_density_cells_mm2": 2690, "cct_um": 528, "cv": 33, "hex_percent": 54 } }
  }
}
```

### 4.6 `generic_ocular_ultrasound_parser`

用途：眼科 A 型、B 型或 A/B 型超声文本报告。

输入示例：

```text
NIDEK US-4000
Ocular Ultrasound A/B Scan
OD Axial Length 24.12 mm ACD 3.21 mm Lens Thickness 4.35 mm
OS Axial Length 23.98 mm ACD 3.18 mm Lens Thickness 4.30 mm
```

输出摘要：

```json
{
  "exam_type": "眼科超声",
  "exam_item_name": "Ocular Ultrasound A/B Scan",
  "eye_side_results": {
    "right": { "key_values": { "axial_length_mm": 24.12, "anterior_chamber_depth_mm": 3.21 } },
    "left": { "key_values": { "axial_length_mm": 23.98, "anterior_chamber_depth_mm": 3.18 } }
  }
}
```

### 4.7 `fallback_eye_exam_parser`

未知但明显属于眼科检查的格式会保留：

- `exam_type = 未识别眼科检查报告`
- 首个有效标题行
- 可识别的厂商/型号
- 日期时间
- OD/OS、R/L、右眼/左眼原始分区
- 完整 OCR 摘录
- `warnings = ["format_not_fully_adapted"]`

它不会猜测未知数值的含义。

## 5. 租户与溯源安全

`eyeExamMetadataService` 必须同时验证：

- 当前用户已登录；
- 用户存在当前诊所 Staff 绑定；
- Artifact、EvidenceItem、FactCard 的 `clinic_id` 与当前诊所一致；
- FactCard 必须确实属于该 Artifact；
- 客户端提交的关联 ID 不得与服务端已有关系冲突。

元数据中的 clinic、患者、Artifact、EvidenceItem、FactCard 关联字段由服务端上下文控制，LLM 无权修改。

## 6. UI

工作流快照详情新增“检查报告元数据”区域：

- 报告类型与项目名称；
- 设备厂商、型号、检查时间；
- 右眼和左眼的关键数值；
- fallback 技术提示；
- 固定非诊断声明。

当前区域是只读数据展示，不提供医学解释按钮。

## 7. 扩展新格式

后续增加具体设备时：

1. 在 `base44/shared/eyeExamMetadata/parsers/` 新增模块。
2. 实现稳定的 `id`、`version`、`detect(text)`、`parse(text, context)`。
3. 只输出 `createEyeExamMetadata()` 接受的统一结构。
4. 将模块加入 `EYE_EXAM_PARSER_REGISTRY`。
5. 添加真实样例脱敏后的文本 fixture 和边界测试。
6. 不在 parser 中加入诊断、正常值判断或治疗建议。

医院名称不作为解析器边界。解析器始终按设备厂商、设备型号、报告标题和格式特征划分。

## 8. Phase 1 非范围

- 不承诺覆盖所有设备字段；
- 不做图像病变识别；
- 不做正常/异常判断；
- 不生成诊断、风险分层或治疗建议；
- 不替代医生签署的检查结论；
- 不进行历史 EvidenceItem 批量回填；
- 不改变现有 Workflow 编组、闭环或经理审批权限。
