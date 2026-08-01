import {
  EYE_EXAM_LLM_SCHEMA,
  EYE_EXAM_PARSE_STATUS,
  createEyeExamMetadata,
  hasEyeSideKeyValues,
  mergeRuleAndLlmMetadata,
} from "./model.ts";
import { isLikelyEyeExamReport, normalizeExamText } from "./common.ts";
import { topconTonoParser } from "./parsers/topconTonoParser.ts";
import { topconRefractionParser } from "./parsers/topconRefractionParser.ts";
import { zeissOctParser } from "./parsers/zeissOctParser.ts";
import { genericFundusPhotoParser } from "./parsers/genericFundusPhotoParser.ts";
import { genericCornealEndotheliumParser } from "./parsers/genericCornealEndotheliumParser.ts";
import { genericOcularUltrasoundParser } from "./parsers/genericOcularUltrasoundParser.ts";
import { fallbackEyeExamParser } from "./parsers/fallbackEyeExamParser.ts";

export const EYE_EXAM_PARSER_REGISTRY = Object.freeze([
  topconTonoParser,
  topconRefractionParser,
  zeissOctParser,
  genericFundusPhotoParser,
  genericCornealEndotheliumParser,
  genericOcularUltrasoundParser,
]);

export const EYE_EXAM_DISPATCH_MIN_SCORE = 0.45;

export function scoreEyeExamParsers(rawText: unknown) {
  return EYE_EXAM_PARSER_REGISTRY
    .map((parser) => ({ parser, score: Number(parser.detect(rawText) || 0) }))
    .sort((a, b) => b.score - a.score || a.parser.id.localeCompare(b.parser.id));
}

export function selectEyeExamParser(rawText: unknown) {
  const [best] = scoreEyeExamParsers(rawText);
  if (!best || best.score < EYE_EXAM_DISPATCH_MIN_SCORE) return null;
  return best;
}

function needsLlmCompletion(metadata: any) {
  return metadata.parse_status !== EYE_EXAM_PARSE_STATUS.parsed
    || !metadata.exam_item_name
    || !metadata.device_vendor
    || !metadata.measured_at
    || !hasEyeSideKeyValues(metadata);
}

const COMPLETION_PROMPT = `你是眼科检查报告“元数据补全器”，不是诊断系统。

严格边界：
- 只补全来源文本中明确出现的检查数据。
- 不生成疾病诊断、风险判断、异常判断、治疗建议或用药建议。
- 不解释数值是否正常。
- 不改变 clinic_id、patient_id、Artifact/EvidenceItem/FactCard 关联 ID 或 parser_id。
- 不确定的字段保持空值，并在 warnings 标记。
- 输出只能符合给定 JSON Schema。

规则解析初稿：
`;

export async function dispatchEyeExamReportMetadata({
  rawText,
  context = {},
  deps = {},
}: {
  rawText: unknown;
  context?: Record<string, unknown>;
  deps?: Record<string, any>;
}) {
  const text = normalizeExamText(rawText);
  if (!text) return null;

  const selected = selectEyeExamParser(text);
  const likelyEyeExam = selected != null || isLikelyEyeExamReport(text, context);
  if (!likelyEyeExam) return null;

  const parser = selected?.parser || fallbackEyeExamParser;
  const ruleMetadata = createEyeExamMetadata(parser.parse(text, context));

  const canUseLlm = typeof deps.invokeLLM === "function" && deps.mock !== true && deps.mock !== "true";
  if (!canUseLlm || !needsLlmCompletion(ruleMetadata)) return ruleMetadata;

  try {
    const llmResult = await deps.invokeLLM({
      prompt: `${COMPLETION_PROMPT}${JSON.stringify(ruleMetadata)}\n\n原始 OCR/文本：\n${text.slice(0, 8000)}`,
      response_json_schema: EYE_EXAM_LLM_SCHEMA,
      model: "automatic",
    });
    return mergeRuleAndLlmMetadata(ruleMetadata, llmResult);
  } catch {
    return createEyeExamMetadata({
      ...ruleMetadata,
      warnings: [...(ruleMetadata.warnings || []), "llm_completion_failed"],
    });
  }
}
