# 眼科检查报告元数据解析框架 — Phase 1

## 1. 目标与边界

本层只把眼科检查报告转成统一、可追溯的**检查数据记录**。它不承担医学诊断，不判断数值正常或异常，也不产生治疗、配镜、用药或手术建议。

固定声明：

> 仅为检查数据记录，不构成医学诊断或治疗建议。

当前数据流：

```text
员工上传图片/PDF
  → EvidenceItem / Artifact 原始存档
  → OCR / 文本提取
  → OCR 可用性质量评估
      ├─ poor：保存最小元数据，提示重新上传，不做详细解析
      └─ good / borderline：进入 eyeExamMetadata dispatch
  → 设备/格式规则 + 格式模板
  → 仅在规则不完整时使用 Schema 受限 LLM
  → EyeExamReportMetadata
  → 上传人员确认具体检查项目
  → 关键字段追加到 EvidenceFactCard.fields
  → 工作流候选匹配优先使用人工确认项目
```

元数据派生或质量统计失败不会回滚 EvidenceItem、Artifact 或员工汇报。原始证据链优先保存。

## 2. 统一元数据模型

Schema 版本：`eye-exam-report-metadata.v1.2`

### 2.1 基础与溯源字段

| 字段 | 含义 |
|---|---|
| `clinic_id` | 服务端校验后的诊所 ID |
| `patient_id` | 可选 PatientSession/患者关联；不从报告猜患者身份 |
| `raw_artifact_id` | 来源 Artifact，解析幂等锚点 |
| `origin_evidence_item_id` | 来源 EvidenceItem |
| `evidence_fact_card_id` | 关联 FactCard |
| `record_kind` | 固定为 `exam_data_record` |
| `schema_version` | 当前为 `eye-exam-report-metadata.v1.2` |

### 2.2 自动解析字段

| 字段 | 含义 |
|---|---|
| `exam_type` | 检查大类，如眼压检查、屈光验光、OCT |
| `exam_item_name` | parser 自动识别的具体项目 |
| `device_vendor` / `device_model` | 设备厂商与型号 |
| `measured_at` | 报告中的检查日期时间 |
| `report_key_values` | PD、VD 等报告级值 |
| `eye_side_results.right/left` | 左右眼原文、关键值和逐行原始测量 |
| `parser_id` / `parser_version` | 命中的解析器与版本 |
| `template_id` / `template_version` | 命中的格式模板与版本 |
| `template_match_score` | 工程模板匹配分数，不是医学置信度 |
| `parse_status` | `parsed` / `partial` / `fallback` |
| `parse_confidence` | 元数据解析置信度，不是医学判断置信度 |
| `warnings` | 技术性提示 |
| `raw_text_excerpt` | OCR/文本摘录，用于溯源 |

### 2.3 OCR 上传质量字段

| 字段 | 含义 |
|---|---|
| `ocr_quality_score` | 0–100 的 OCR 可用性分数 |
| `ocr_quality_flag` | `good` / `borderline` / `poor` |
| `ocr_quality_reasons` | 过短、有效行太少、乱码、低 provider confidence 等技术原因 |
| `requires_reupload` | 是否需要重新拍照或上传更清晰文件 |

poor 阈值为 45。命中硬性低质量条件时，即使计算分数略高也仍标记为 poor。详细规则见 `docs/EYE_EXAM_UPLOAD_QUALITY_AND_CONFIRMATION.md`。

### 2.4 检查项目人工确认字段

| 字段 | 含义 |
|---|---|
| `requires_exam_item_confirmation` | 是否等待上传人员确认具体项目 |
| `exam_item_suggested_tag` | 系统建议的项目 ID，只用于前端预选 |
| `exam_item_manual_tag` | 上传人员人工确认的项目 ID |
| `exam_item_manual_label` | 人工确认项目的显示名称 |
| `exam_item_manual_note` | “其他眼科检查”的简短说明 |
| `exam_item_confirmed_at` | 确认时间 |
| `exam_item_confirmed_by_staff_id` | 服务端确认的员工 ID |

候选项目：

1. 眼压检查（Tono）
2. 屈光/验光
3. 黄斑 OCT
4. 视神经 OCT
5. 眼底照相
6. 角膜内皮细胞检查
7. 眼科 A/B 超声
8. 其他眼科检查（必须填写说明）

## 3. FactCard 投影与编组

关键值扁平写入 `EvidenceFactCard.fields`：

```text
eye_exam.exam_type
eye_exam.exam_item_name
eye_exam.exam_item_suggested_tag
eye_exam.exam_item_manual_tag
eye_exam.exam_item_manual_label
eye_exam.match_exam_item
eye_exam.ocr_quality_score
eye_exam.ocr_quality_flag
eye_exam.requires_reupload
eye_exam.requires_exam_item_confirmation
eye_exam.right.*
eye_exam.left.*
```

当存在人工确认时：

```text
eye_exam.match_exam_item = exam_item_manual_tag
extraction_quality = high
extraction_method = user_confirmed
```

没有人工确认且报告质量可用时，`eye_exam.match_exam_item` 才使用系统建议或自动项目名称。

Candidate Finder 的行为：

- 显式 Workflow ID 规则不变；
- 仍然先生成同诊所、同时间窗口的候选；
- 在候选范围内，匹配人工项目标签的 Workflow 优先；
- 自动识别项目只作为辅助；
- 不因项目标签直接自动挂接；
- 不突破候选白名单和经理复核门槛。

## 4. 中央 dispatch

`base44/shared/eyeExamMetadata/dispatch.ts` 维护统一解析器注册表。

选择过程：

1. OCR 质量门槛先于中央 dispatch；
2. 所有解析器计算检测分数；
3. 同 parser 家族的格式模板同时计算匹配分数；
4. 得分最高且达到阈值的模块负责规则解析；
5. 没有模块达到阈值，但文本明显属于眼科报告时进入 fallback；
6. 非眼科运营文件返回 `null`；
7. 规则结果不完整时才调用受 Schema 限制的 LLM。

LLM 无权修改 clinic、患者、Artifact、EvidenceItem、FactCard、parser/template、OCR 质量或人工确认身份字段。

## 5. 已支持解析模块

### 5.1 `topcon_tono_parser`

用途：TOPCON 眼压小票、Tono Data。典型输出为左右眼 `average_iop_mmhg` 和原始测量值。

### 5.2 `topcon_refraction_parser`

用途：TOPCON 自动验光小票。支持：

- 多行 S/C/A；
- S.E.；
- PD、VD；
- 每眼 `raw_measurements`；
- 受限的重复两位轴位尾零 OCR 恢复，并保留原始值供审计。

### 5.3 `zeiss_oct_parser`

用途：ZEISS Cirrus OCT。首期识别：

- Macular Cube；
- Optic Disc Cube；
- RNFL；
- 常见厚度和 Signal Strength。

项目确认阶段会区分“黄斑 OCT”和“视神经 OCT”。

### 5.4 `generic_fundus_photo_parser`

用途：通用眼底照相报告。记录厂商、眼别、时间和图像记录元数据，不分析病变。

### 5.5 `generic_corneal_endothelium_parser`

用途：角膜内皮细胞报告。支持 Cell Density、Average Cell Area、CCT、CV、HEX 等字段族。

### 5.6 `generic_ocular_ultrasound_parser`

用途：眼科 A 型、B 型或 A/B 型超声。支持 AL、ACD、晶状体厚度、玻璃体腔长度等 mm 数值。

### 5.7 `fallback_eye_exam_parser`

未知但明显属于眼科检查的格式会保留标题、厂商/型号、时间、眼别原文和 OCR 摘录，并标记 `format_not_fully_adapted`。它不会猜测未知数值含义。

## 6. 上传端交互

员工端 `MetaTaggingModal` 的眼科流程：

1. 上传图片或文件并完成通用资料标签；
2. 后端保存 Artifact/EvidenceItem 并进行 OCR 质量评估；
3. poor：显示重新上传提示，当前模糊附件从待提交列表移除，原始证据记录保留；
4. good/borderline：进入解析；
5. 被识别为眼科报告后，显示统一检查项目候选；
6. 上传人员确认项目；
7. `confirmExamItem` 将人工项目写入元数据并重新投影 FactCard；
8. 只有确认完成后，新事件模式才继续自动提交。

固定重新上传文案：

> 这张检查报告照片过于模糊，系统无法可靠识别关键信息，请重新拍照并上传。

工作流详情的“检查报告元数据”区域显示：

- OCR 质量分数/标志；
- poor 报告重新上传状态；
- 人工确认项目优先于自动项目名称；
- 待确认状态；
- 左右眼关键数据；
- 固定非诊断声明。

## 7. 租户与溯源安全

`eyeExamMetadataService` 验证：

- 当前用户已登录并绑定当前诊所 Staff；
- Artifact、EvidenceItem、FactCard、Metadata 的 `clinic_id` 完全一致；
- FactCard 必须确实属于该 Artifact；
- 客户端关联 ID 不得与服务端关系冲突；
- 确认员工 ID 只从服务端 actor 写入；
- poor 元数据不能绕过重新上传直接确认项目。

## 8. 扩展新格式与新项目

新增设备格式时：

1. 在 `base44/shared/eyeExamMetadata/parsers/` 新增 parser；
2. 注册到 `EYE_EXAM_PARSER_REGISTRY`；
3. 必要时增加格式模板；
4. 只输出统一元数据结构；
5. 添加脱敏 fixture 和边界测试；
6. 若属于新的业务项目分类，同时更新 `examItemCatalog.ts` 和候选列表测试。

医院名称不作为 parser 边界。解析器始终按设备厂商、型号、报告标题和格式特征划分。

## 9. 非范围

- 不承诺覆盖所有设备字段；
- 不做图像病变识别；
- 不做正常/异常判断；
- 不生成诊断、风险分层或治疗建议；
- 不替代医生签署的检查结论；
- 不因人工项目标签直接自动挂接 Workflow；
- 不进行历史 EvidenceItem 批量回填；
- 不改变经理审批与租户隔离权限。
