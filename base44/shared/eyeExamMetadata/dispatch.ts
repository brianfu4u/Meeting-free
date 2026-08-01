import {
  EYE_EXAM_LLM_SCHEMA,
  EYE_EXAM_PARSE_STATUS,
  createEyeExamMetadata,
  hasEyeSideKeyValues,
  mergeRuleAndLlmMetadata,
} from "./model.ts";
import { isLikelyEyeExamReport, normalizeExamText } from "./common.ts";
import {
  formatTemplateForLlm,
  selectEyeExamFormatTemplate,
} from "./templateRegistry.ts";
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
    .map((parser) => {
      const ruleScore = Number(parser.detect(rawText) || 0);
      const templateMatch = selectEyeExamFormatTemplate(rawText, parser.id);
      const templateScore = Number(templateMatch?.score || 0);
      // A format template may rescue a layout variation that uses the same
      // vocabulary but no longer matches the parser's original title regex.
      // It never selects a different parser family than template.parser_id.
      const score = Math.max(ruleScore, templateScore * 0.95);
      return {
        parser,
        score: Math.round(score * 1000) / 1000,
        rule_score: ruleScore,
        template_score: templateScore,
        template: templateMatch?.template || null,
      };
    })
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

const COMPLETION_PROMPT = `你是眼科检查报告“格式级元数据补全器”，不是诊断系统。

严格边界：
- 只补全来源文本中明确出现的检查数据。
- 固定格式模板描述的是一类报告，不是某一位患者或某一张小票。
- 不生成疾病诊断、风险判断、异常判断、治疗建议、配镜建议或用药建议。
- 不解释数值是否正常。
- 不改变 clinic_id、patient_id、Artifact/EvidenceItem/FactCard 关联 ID、parser_id 或 template_id。
- 不确定的字段保持空值，并在 warnings 标记。
- 输出只能符合给定 JSON Schema。
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
  const template = selected?.template || selectEyeExamFormatTemplate(text, parser.id)?.template || null;
  const templateScore = selected?.template_score
    || (template ? selectEyeExamFormatTemplate(text, parser.id)?.score : 0)
    || 0;
  const ruleMetadata = createEyeExamMetadata({
    ...parser.parse(text, context),
    template_id: template?.id || null,
    template_version: template?.version || null,
    template_match_score: templateScore,
  });

  const canUseLlm = typeof deps.invokeLLM === "function" && deps.mock !== true && deps.mock !== "true";
  if (!canUseLlm || !needsLlmCompletion(ruleMetadata)) return ruleMetadata;

  try {
    const llmResult = await deps.invokeLLM({
      prompt: [
        COMPLETION_PROMPT,
        "固定格式模板：",
        JSON.stringify(formatTemplateForLlm(template)),
        "规则解析初稿：",
        JSON.stringify(ruleMetadata),
        "原始 OCR/文本：",
        text.slice(0, 8000),
      ].join("\n\n"),
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
