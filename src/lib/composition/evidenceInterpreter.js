/**
 * Clinic OS V10 — Evidence Interpreter
 *
 * 职责：将一个 Artifact 解读为结构化 EvidenceFactCard（字段级溯源 + 抽取质量）。
 * 作为 LLM 分析缓存层：源 Artifact 变更后置 stale=true 重新解读。
 *
 * 输入契约：
 *   { artifact, sopDigest, businessLine, policyVersion, invokeLLM }
 * 输出：EvidenceFactCard 草案（未持久化），调用方负责写入与回填 artifact.evidence_fact_card_id。
 *
 * invokeLLM 为可注入的 LLM 调用器，签名同 base44.integrations.Core.InvokeLLM，
 * 便于单元测试以 mock 替换。
 */

import {
  PROMPT_VERSIONS,
  buildInterpreterPrompt,
  INTERPRETER_JSON_SCHEMA,
} from "./prompts";

function pickModel(artifactType) {
  // 图像/截图走视觉模型；语音先转写（调用方应已 TranscribeAudio 并落 file_url 为文本时再进来）；
  // 文件类走通用文本模型。默认 automatic 以节省积分。
  if (artifactType === "image" || artifactType === "screenshot") return "gemini_3_flash";
  return "automatic";
}

export async function interpretArtifact({
  artifact,
  sopDigest = "",
  businessLine = "unknown",
  policyVersion,
  invokeLLM,
}) {
  if (!artifact || !artifact.file_url) throw new Error("interpretArtifact: artifact.file_url required");
  if (!invokeLLM) throw new Error("interpretArtifact: invokeLLM required");

  const prompt = buildInterpreterPrompt({ artifact, sopDigest, businessLine });
  const model = pickModel(artifact.artifact_type);

  const result = await invokeLLM({
    prompt,
    file_urls: [artifact.file_url],
    response_json_schema: INTERPRETER_JSON_SCHEMA,
    model,
  });

  const fields = (result?.fields || []).map((f) => ({
    field_name: f.field_name,
    value: f.value,
    source_artifact_id: artifact.id,
    source_region: f.source_region || artifact.source_region || null,
    source_quote: f.source_quote || null,
    extraction_quality: f.extraction_quality,
    extraction_method: f.extraction_method || inferMethod(artifact.artifact_type),
  }));

  return {
    clinic_id: artifact.clinic_id,
    artifact_id: artifact.id,
    fields,
    business_date: artifact.business_date,
    session_id: null, // 解读阶段不绑定，交由 Candidate Finder
    extracted_at: new Date().toISOString(),
    model_version: model,
    prompt_version: PROMPT_VERSIONS.EVIDENCE_INTERPRETER,
    policy_version: policyVersion ?? null,
    stale: false,
    // 候选匹配辅助线索
    _interpreter_session_hint: result?.session_hint || null,
  };
}

function inferMethod(artifactType) {
  switch (artifactType) {
    case "image":
    case "screenshot":
      return "ocr";
    case "voice":
      return "voice_transcribe";
    case "file":
      return "llm_parse";
    default:
      return "llm_parse";
  }
}