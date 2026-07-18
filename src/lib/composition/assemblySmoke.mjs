/**
 * Clinic OS V10 — Assembly Schema Smoke（R2.3 项7）
 *
 * 真实 LLM smoke 运行器：导入实际 ASSEMBLY_JSON_SCHEMA（不得手工复制）。
 * invokeLLM 由调用方注入（exec_tool 注入真实 base44.asServiceRole.integrations.Core.InvokeLLM；
 * 单测注入 mock）。返回结构化校验结果。
 */

import {
  ASSEMBLY_JSON_SCHEMA,
  TRACK_IDS,
  buildAssemblyPrompt,
} from "./prompts.js";

export async function runAssemblySmoke({ invokeLLM }) {
  if (!invokeLLM) throw new Error("runAssemblySmoke: invokeLLM required");

  const factCards = [
    {
      artifact_id: "a1",
      subject_type: "supplier",
      subject_fingerprint: { name: "供应商A" },
      occurred_at: "2026-07-18T09:00:00Z",
      fields: [{ field_name: "po_number", value: "PO-77" }],
    },
    {
      artifact_id: "a2",
      subject_type: "supplier",
      subject_fingerprint: { name: "供应商A" },
      occurred_at: "2026-07-18T10:00:00Z",
      fields: [{ field_name: "received_qty", value: "50" }],
    },
  ];

  const prompt = buildAssemblyPrompt({
    factCards,
    candidateWorkflows: [],
    compositionContext: { compositionType: "new_train" },
  });

  // 直接使用导入的真实 Schema 对象，禁止手工复制
  const res = await invokeLLM({
    prompt,
    response_json_schema: ASSEMBLY_JSON_SCHEMA,
    model: "automatic",
  });

  const checks = {};
  const hyps = res?.hypotheses;
  checks.hypotheses_is_array = Array.isArray(hyps) && hyps.length >= 1;
  const h = hyps?.[0] || {};
  const requiredKeys = [
    "workflow_hypothesis_id",
    "workflow_family",
    "composition_type",
    "target_workflow_id",
    "target_snapshot_id",
    "target_snapshot_version",
    "ordered_artifact_ids",
    "reasoning_tracks",
    "unsupported_assumptions",
    "contradictions",
    "unexplained_artifact_ids",
  ];
  const missing = requiredKeys.filter((k) => !(k in h));
  checks.required_keys_present = missing.length === 0;
  checks.target_workflow_id_is_null = h.target_workflow_id === null;
  checks.target_snapshot_id_is_null = h.target_snapshot_id === null;
  checks.target_snapshot_version_is_null = h.target_snapshot_version === null;
  checks.composition_type_new_train = h.composition_type === "new_train";
  const trackKeys = h.reasoning_tracks ? Object.keys(h.reasoning_tracks) : [];
  checks.seven_tracks_present = TRACK_IDS.every((id) => trackKeys.includes(id));
  checks.unexplained_artifact_ids_present = Array.isArray(h.unexplained_artifact_ids);
  const ok = Object.values(checks).every(Boolean) && missing.length === 0;

  return {
    ok,
    checks,
    missing,
    schema_imported: true,
    schema_is_imported_ref: ASSEMBLY_JSON_SCHEMA,
    sample: {
      workflow_family: h.workflow_family,
      composition_type: h.composition_type,
      target_workflow_id: h.target_workflow_id,
      target_snapshot_id: h.target_snapshot_id,
      track_keys: trackKeys,
    },
  };
}