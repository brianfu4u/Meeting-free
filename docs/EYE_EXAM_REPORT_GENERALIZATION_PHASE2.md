# 眼科检查报告自动泛化与解析质量闭环 — Phase 2

## 1. 目标

Phase 2 将 Phase 1 的“统一模型 + 独立 parser”扩展为可持续优化的工程闭环：

```text
新报告
  → parser 规则检测
  → 格式模板匹配
  → 确定性规则解析
  → 仅在不完整时使用格式级、Schema 受限的 LLM 补全
  → EyeExamReportMetadata
  → 幂等解析质量事件
  → 7 天质量概览
  → 按报告类型选择下一批 1–2 份代表样本优化
```

系统不承诺在没有任何依据时自动理解所有新设备。它的目标是：

1. 同一报告族的数值变化、空格变化和有限布局变化可自动泛化；
2. 新厂商、新模板或长期低成功率类型自动进入优化清单；
3. 用户只需按“类型”提供少量代表样本，不需逐张反馈。

固定安全边界不变：

> 仅为检查数据记录，不构成医学诊断或治疗建议。

## 2. 格式模板注册表

文件：`base44/shared/eyeExamMetadata/templateRegistry.ts`

模板按“设备厂商 + 报告族”定义，不包含患者姓名、固定日期或固定检查数值。每个模板包括：

- `template_id` / `template_version`
- 对应 `parser_id`
- `exam_type` 和默认项目名称
- 厂商信号
- 标题模式
- 结构模式
- 必需输出字段
- 常见单位
- 固定布局说明
- 少量去身份化的代表格式示例

中央 dispatch 同时计算：

- parser 原有规则检测分数；
- 同 parser 家族的模板匹配分数。

两者取较高值，但模板不能跨 parser 家族选择其他解析模块。

### 当前模板覆盖

| 模板 | 解析器 | 当前泛化边界 |
|---|---|---|
| `topcon_tono_data_v1` | `topcon_tono_parser` | R/L、OD/OS、AVG、重复眼压值和 mmHg 布局 |
| `topcon_ref_data_v1` | `topcon_refraction_parser` | S/C/A、S.E.、PD、VD 和单行/多行验光布局 |
| `zeiss_cirrus_oct_v1` | `zeiss_oct_parser` | Macular Cube、Optic Disc Cube、RNFL、厚度和信号强度表 |
| `generic_fundus_photo_v1` | `generic_fundus_photo_parser` | 厂商、拍摄眼别、日期和图像记录元数据 |
| `generic_corneal_endothelium_v1` | `generic_corneal_endothelium_parser` | CD、AVG、CCT、CV、HEX 字段族 |
| `generic_ocular_ultrasound_v1` | `generic_ocular_ultrasound_parser` | AL、ACD、晶状体厚度、玻璃体腔长度等 mm 数值 |

“当前覆盖”代表框架具备稳定格式策略，不代表每个厂商的每个固件版本均已验证。

## 3. 格式级 LLM 补全

LLM 不负责自由判断报告含义。调用条件仍是规则结果不完整，并且调用时收到：

1. 命中的固定格式模板；
2. 该报告族的字段和单位；
3. 版式说明；
4. 去身份化代表格式；
5. 规则解析初稿；
6. 当前 OCR 文本；
7. 固定 EyeExamReportMetadata JSON Schema。

禁止 LLM 修改：

- `clinic_id`、`patient_id`
- Artifact / EvidenceItem / FactCard 关联 ID
- `parser_id`
- `template_id` / `template_version`

诊断、异常判断、配镜建议、治疗和用药字段不在 Schema 中，也不会保存。

## 4. 解析质量事件

实体：`EyeExamParserQualityEvent`

每次成功生成 EyeExamReportMetadata 后，服务尝试写入一条质量事件。事件写入为非阻断步骤，统计服务故障不会回滚原始证据或元数据。

幂等键：

```text
clinic_id + raw_artifact_id + parser_version
```

同一 Artifact 重试相同 parser 版本时更新原事件，避免重试次数导致失败统计虚高。parser 升级后可记录新的质量结果，用于观察版本改善。

保存字段：

- exam_type / exam_item_name
- device_vendor / device_model
- parser 和模板 ID/版本
- 原始 metadata parse status
- 统一 quality status
- parse confidence
- 技术 warning codes
- 是否使用 LLM 补全

不会保存：

- OCR 原文
- 患者姓名或患者 ID
- 报告图像内容
- 诊断或治疗结论

### 状态映射

| Metadata 状态 | 质量状态 |
|---|---|
| `parsed` / `parsed_success` | `success` |
| `partial` 或其他不完整状态 | `needs_clarification` |
| `fallback` | `fallback` |

## 5. 解析质量概览接口

后端 action：

```json
{
  "action": "getQualityOverview",
  "clinic_id": "clinic-001",
  "days": 7,
  "top_n": 10
}
```

约束：

- `days`：1–90，默认 7；
- `top_n`：1–50，默认 10；
- 仅诊所管理员、`clinic_director` 或 `qa_officer` 可读取；
- 数据严格按 `clinic_id` 聚合；
- Phase 2 不新增前端 UI。

前端/内部工具客户端：

```text
src/lib/eyeExamMetadata/qualityClient.js
```

### 聚合维度

主分组：

```text
device_vendor + exam_item_name
```

同时汇总：

- exam_type
- 设备型号集合
- parser / template 集合
- 总次数
- success / needs_clarification / fallback 次数
- 各状态比例
- 平均解析置信度
- LLM 补全次数
- 覆盖状态
- 优化优先级分数

### 覆盖状态

- `stable`：至少 3 次，成功率 ≥90%，且无 fallback；
- `optimize`：存在 fallback，或 needs_clarification 比例 ≥25%；
- `watch`：样本仍少或尚未达到稳定阈值，但暂未表现出明显失败集中。

## 6. 示例质量概览

```json
{
  "window_days": 7,
  "total_events": 42,
  "totals": {
    "success": 34,
    "needs_clarification": 6,
    "fallback": 2
  },
  "overall_success_rate": 0.81,
  "stable_coverage": [
    {
      "exam_type": "眼压检查",
      "exam_item_name": "Tono Data",
      "device_vendor": "TOPCON",
      "total_count": 18,
      "success_count": 18,
      "success_rate": 1,
      "coverage_state": "stable"
    }
  ],
  "optimization_candidates": [
    {
      "exam_type": "OCT",
      "exam_item_name": "Wide Field OCT",
      "device_vendor": "NEWVENDOR",
      "total_count": 5,
      "success_count": 0,
      "needs_clarification_count": 2,
      "fallback_count": 3,
      "success_rate": 0,
      "coverage_state": "optimize",
      "recommendation": "优先提供该设备/项目 1–2 份代表样本，新增或增强格式模板。"
    },
    {
      "exam_type": "屈光验光",
      "exam_item_name": "Ref Data",
      "device_vendor": "TOPCON",
      "total_count": 9,
      "success_count": 6,
      "needs_clarification_count": 3,
      "fallback_count": 0,
      "success_rate": 0.667,
      "coverage_state": "optimize"
    }
  ]
}
```

用户后续只需从 `optimization_candidates` 中选择一类，提供 1–2 份代表样本并提出一次“按类型增强”需求。

## 7. 安全与非范围

- fallback 始终保留，模板不足时不强行猜测；
- 不以质量成功率替代医学审核；
- 不自动学习并发布新的生产规则；
- 不把 OCR 原文或患者信息写入质量事件；
- 不修改 Workflow 编组、经理审批或租户隔离规则；
- 自动生成 parser 代码和自动上线属于后续阶段，需要独立审核与 CI 门槛。
