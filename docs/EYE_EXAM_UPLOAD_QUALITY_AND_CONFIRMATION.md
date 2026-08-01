# 眼科检查报告上传质量与检查项目确认

## 1. 目标

本功能在既有 EyeExamReportMetadata 解析框架之前和之后增加两道业务门槛：

```text
员工上传报告
  → 原始 Artifact / EvidenceItem 保存
  → OCR / 文本提取
  → OCR 质量评估
      ├─ poor：保存最小元数据 → 提示重新上传 → 不做详细 parser / LLM 解析
      └─ good / borderline：进入原有眼科 parser / 模板 / 受限 LLM
  → 识别为眼科报告
  → 上传人员确认具体检查项目
  → exam_item_manual_tag 落库并投影到 FactCard
  → Workflow 候选匹配优先使用人工标签
```

固定边界：

> 质量判断只评价 OCR 是否足以可靠提取，不评价检查结果；人工项目标签只用于业务分类和编组，不产生诊断或治疗建议。

## 2. OCR 质量分数

实现文件：

```text
base44/shared/eyeExamMetadata/ocrQuality.ts
```

`ocr_quality_score` 为 0–100，综合：

- OCR 提取出的非空字符数量；
- 至少包含三个可识别字符的有效行数量；
- 中文、日文、英文、数字和常用报告符号的可识别字符比例；
- 可识别 token 的多样性；
- OCR 服务返回的字符/页面平均置信度（若存在）；
- 乱码字符、过长重复字符和标点占比的扣分。

### 阈值

```text
poor:       score < 45，或命中硬性低质量条件
borderline: 45–69
 good:      70–100
```

选择 45 作为 poor 阈值，是为了避免误杀短小但完整的设备小票。正常五行 TOPCON Tono 小票通常可达到 70 分以上；仅一两行、主要是乱码、重复符号或 OCR 置信度低于 35% 的内容会被标记为 poor。

硬性低质量条件包括：

- 提取字符少于 16；
- 有效行少于 2；
- 可识别字符比例低于 45%；
- 乱码比例过高；
- 多段连续重复字符；
- OCR provider confidence 低于 35%；
- 标点/符号占据绝大多数内容。

## 3. poor 报告处理

当 `ocr_quality_flag = poor`：

1. Artifact、EvidenceItem 和已有 FactCard 不删除、不回滚；
2. 写入最小化 `EyeExamReportMetadata`：
   - `parser_id = low_quality_eye_exam_gate`
   - `parse_status = partial`
   - `ocr_quality_score`
   - `ocr_quality_flag = poor`
   - `requires_reupload = true`
3. 不调用具体设备 parser，也不调用 LLM 补全；
4. 返回：

```text
eye_exam_upload_needs_reupload_due_to_low_quality
```

前端文案：

> 这张检查报告照片过于模糊，系统无法可靠识别关键信息，请重新拍照并上传。

员工点击“重新拍照或上传”后，当前模糊附件从待提交列表中移除，但后台已生成的原始证据记录继续保留，用于审计和追溯。

## 4. 检查项目候选列表

统一来源：

```text
base44/shared/eyeExamMetadata/examItemCatalog.ts
```

| ID | 前端名称 | 对应范围 |
|---|---|---|
| `tono` | 眼压检查（Tono） | Tono / IOP / mmHg 报告 |
| `refraction` | 屈光/验光 | REF DATA、S/C/A、SPH/CYL/AXIS |
| `macular_oct` | 黄斑 OCT | Macular Cube、Central Subfield |
| `optic_nerve_oct` | 视神经 OCT | Optic Disc、RNFL、Optic Nerve |
| `fundus_photo` | 眼底照相 | Fundus / Retina Photography |
| `corneal_endothelium` | 角膜内皮细胞检查 | Cell Density、CCT、CV、HEX |
| `ocular_ultrasound` | 眼科 A/B 超声 | A-scan、B-scan、A/B Scan |
| `other_eye_exam` | 其他眼科检查 | 必须填写简短说明 |

解析器根据 `exam_type`、`exam_item_name`、template 和 parser 给出 `exam_item_suggested_tag`，仅作为前端预选。最终业务分类必须由上传人员确认。

## 5. 人工确认字段

Schema：`eye-exam-report-metadata.v1.2`

| 字段 | 含义 |
|---|---|
| `requires_exam_item_confirmation` | 是否等待上传人员确认 |
| `exam_item_suggested_tag` | 系统建议的候选 ID |
| `exam_item_manual_tag` | 人工确认的候选 ID |
| `exam_item_manual_label` | 人工确认的显示名称 |
| `exam_item_manual_note` | “其他眼科检查”的说明 |
| `exam_item_confirmed_at` | 确认时间 |
| `exam_item_confirmed_by_staff_id` | 服务端确认的员工 ID |

确认接口：

```json
{
  "action": "confirmExamItem",
  "clinic_id": "clinic-001",
  "artifact_id": "artifact-001",
  "evidence_fact_card_id": "fact-001",
  "exam_item_manual_tag": "macular_oct",
  "exam_item_manual_note": null
}
```

接口继续验证 Staff、clinic、Artifact、Metadata 和 FactCard 的租户归属。poor 报告不能直接确认项目，必须先重新上传。

## 6. FactCard 与编组优先级

人工确认后，EyeExamReportMetadata 会重新投影以下字段：

```text
eye_exam.exam_item_manual_tag
eye_exam.exam_item_manual_label
eye_exam.exam_item_manual_note
eye_exam.match_exam_item
```

其中：

```text
eye_exam.match_exam_item = exam_item_manual_tag
```

字段来源使用：

```text
extraction_quality = high
extraction_method = user_confirmed
```

Candidate Finder 的优先级：

1. 显式 Workflow ID 仍然最高，行为不变；
2. 在时空候选范围内，匹配人工确认项目的 Workflow 排在最前；
3. 没有人工标签时，才使用 `exam_item_suggested_tag / exam_item_name` 辅助排序；
4. 人工标签不会单独创造候选，不突破候选白名单，也不会触发自动挂接；
5. LLM 候选 prompt 明确把 manual tag 作为第一业务依据，最终仍需经理复核。

Workflow 可使用下列字段声明预期项目：

```text
expected_exam_item_tag
exam_item_tag
expected_exam_item_tags[]
exam_item_tags[]
```

## 7. 端到端示例

### 7.1 模糊报告

```text
员工拍摄 OCT 报告，严重反光，只识别出：TOPCON / OCT / ����
  → Artifact、EvidenceItem 保存
  → OCR score 21 / poor
  → 生成最小 EyeExamReportMetadata
  → 不运行 OCT parser，不调用 LLM
  → 返回 eye_exam_upload_needs_reupload_due_to_low_quality
  → 前端显示重新上传提示
```

### 7.2 清晰报告

```text
员工上传清晰 ZEISS Macular Cube 报告
  → OCR score 91 / good
  → zeiss_oct_parser + zeiss_cirrus_oct_v1
  → exam_type = OCT
  → exam_item_name = Macular Cube 512x128
  → exam_item_suggested_tag = macular_oct
  → requires_exam_item_confirmation = true
  → 前端预选“黄斑 OCT”
  → 员工确认
  → exam_item_manual_tag = macular_oct
  → FactCard.eye_exam.match_exam_item = macular_oct
  → 黄斑 OCT Workflow 候选优先于其他同时段检查任务
```

## 8. 自动化测试

测试文件：

```text
src/lib/eyeExamMetadata/__tests__/uploadQualityAndConfirmation.test.js
```

覆盖：

- 低质量乱码、过短文本和低 provider confidence 被标记为 poor；
- 清晰 Tono 与 Refraction 报告不会误判；
- poor 元数据包含 reupload code 且不要求项目确认；
- 当前候选列表与 parser/template 支持范围一致；
- 黄斑 OCT 与视神经 OCT 可分别建议；
- “其他眼科检查”必须填写说明；
- 清晰解析结果设置 `requires_exam_item_confirmation`；
- 人工 tag 正确写入 FactCard；
- 人工 tag 优先影响 Workflow 候选排序与 LLM prompt；
- 前端包含明确重新上传文案和确认交互。
