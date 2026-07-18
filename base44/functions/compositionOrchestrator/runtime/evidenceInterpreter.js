// GENERATED_PHASE2_MIRROR source=src/lib/composition/evidenceInterpreter.js blob=1fe84faf2f7be6ed9ba4f5ab121e19a651d1a9f2
// Do not edit manually; parity test pins the canonical source blob.
/**
 * Clinic OS V10 — Evidence Interpreter（修订版 R2）
 *
 * R2：统一通用 Workflow 契约。
 * - 删除 session_id / _interpreter_session_hint；
 * - 输出 explicit_workflow_id / workflow_family_hint / subject_type / subject_fingerprint；
 * - 业务时间用 occurred_at（= artifact.captured_at 兜底），extracted_at 仅记录解读时刻。
 */

import {
  PROMPT_VERSIONS,
  buildInterpreterPrompt,
  INTERPRETER_JSON_SCHEMA,
} from "./prompts.js";

function pickModel(artifactType) {
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
    // 通用 Workflow 契约
    explicit_workflow_id: artifact.source_workflow_id || null,
    workflow_family_hint: result?.workflow_family_hint || null,
    subject_type: result?.subject_type || null,
    subject_fingerprint: result?.subject_fingerprint || null,
    subject_quality: result?.subject_quality || "medium",
    // 业务发生时间：证物 captured_at 兜底，禁止用 extracted_at 作为业务时间
    occurred_at: result?.occurred_at || artifact.captured_at || null,
    // 解读时刻（仅记录，非业务时间）
    extracted_at: new Date().toISOString(),
    model_version: model,
    prompt_version: PROMPT_VERSIONS.EVIDENCE_INTERPRETER,
    policy_version: policyVersion ?? null,
    stale: false,
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