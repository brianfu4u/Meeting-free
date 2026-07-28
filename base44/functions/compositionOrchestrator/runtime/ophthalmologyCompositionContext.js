// GENERATED_PHASE2_MIRROR source=src/lib/composition/ophthalmologyCompositionContext.js blob=70bfef2a873ce0b86d48d3a76b6c8c12decf13d9
// Do not edit manually; parity test pins the canonical source blob.
/**
 * Fixed ophthalmology baseline for Workflow composition.
 *
 * Relationship reference only: not a ScenarioPolicy, evidence checklist,
 * closure rule, or quality-control rule.
 */
export const OPHTHALMOLOGY_COMPOSITION_CONTEXT_VERSION =
  "ophthalmology-composition-context-v1";

export const OPHTHALMOLOGY_COMPOSITION_CONTEXT = [
  "【眼科诊所典型业务流程参考】",
  "一般门诊常见顺序为：挂号→预检分诊（红/黄/绿分级）→候诊→医生接诊；基础检查可包括视力、眼压、裂隙灯和眼底照相，医生开具特检后，患者通常完成检查并返回诊室复核，之后收费、取药或离院。",
  "儿童青少年验配常见顺序为：问询接待→眼生物学参数测量→验光（按适用原则考虑散瞳）→双眼视功能检查→处方→定配→校配与检测→交付→售后。",
  "0～6岁儿童眼保健通常结合年龄进行眼外观、红光反射、眼位、遮盖厌恶等检查，发现高危线索时转诊。",
  "门诊病历常见信息包括主诉、现病史、既往史、体检、辅助检查、诊断和处理意见。器械与物品通常按高度、中度、低度危险性选择相应消毒或灭菌方式。",
  "以上内容仅用于辅助判断证据片段之间的因果衔接、时间顺序和部门交接是否合理，不代表必需证据清单，不用于判断 Workflow 是否完整、缺少哪些证据或能否闭环。",
].join("\n");
