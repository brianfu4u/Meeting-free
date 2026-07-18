/**
 * Clinic OS V10 — Workflow Assembly（修订版）
 *
 * 修订要点：
 * - 输出回归编组目标：hypotheses 含 composition_type / workflow_family /
 *   ordered_artifact_ids / reasoning_tracks(七条) / unsupported_assumptions /
 *   contradictions / unexplained_artifact_ids；
 * - 移除运营预警型输出（attention_type/urgency/resource_risk 等）；
 * - 通用 Workflow 模型，不再硬编码 PatientSession；
 * - reasoning_tracks 以 track_id 为键，未使用轨道允许空数组。
 */

import {
  PROMPT_VERSIONS,
  REASONING_TRACKS,
  TRACK_IDS,
  buildAssemblyPrompt,
  ASSEMBLY_JSON_SCHEMA,
} from "./prompts";
import { computeProposalIdempotencyKey } from "../tenant/tenantContext";

/**
 * 对一个编组列车 / new_train 候选调用 LLM 产出 1~3 个 Workflow 假设。
 * 影子模式：仅产出草案，不修改核心状态。
 *
 * @param {Object} cluster - { fact_card_ids, artifact_ids, composition_type, workflow_id?, workflow_family_hint? }
 * @param {String} compositionType - attach | new_train | orphan
 * @returns { hypotheses, unexplained_artifact_ids, needs_manager_dispatch, source_proposal_id, ... }
 */
export async function assembleWorkflow({
  cluster,
  compositionType,
  factCards,
  candidateWorkflows = [],
  workflow = null,
  sopDigest = "",
  guessPolicy = {},
  invokeLLM,
  clinicId,
  policyVersion,
  assemblyRunId,
}) {
  if (!cluster) throw new Error("assembleWorkflow: cluster required");
  if (!invokeLLM) throw new Error("assembleWorkflow: invokeLLM required");

  const cardsForCluster = (factCards || []).filter((c) =>
    (cluster.fact_card_ids || []).includes(c.id)
  );

  const prompt = buildAssemblyPrompt({
    factCards: cardsForCluster,
    candidateWorkflows,
    compositionContext: { compositionType, workflow },
    sopDigest,
    policyTracks: guessPolicy.tracks?.length ? guessPolicy.tracks : REASONING_TRACKS,
  });

  const raw = await invokeLLM({
    prompt,
    response_json_schema: ASSEMBLY_JSON_SCHEMA,
    model: "automatic",
  });

  const hypotheses = (raw.hypotheses || []).map((h) =>
    normalizeHypothesis(h, { clinicId, policyVersion, assemblyRunId, cluster })
  );

  // 幂等键：基于本簇 artifact 集合
  const sortedArtifactIds = [...(cluster.artifact_ids || [])].sort();
  let source_proposal_id = null;
  if (clinicId && sortedArtifactIds.length > 0 && policyVersion != null) {
    source_proposal_id = computeProposalIdempotencyKey({
      clinicId,
      sortedArtifactIds,
      policyVersion,
    });
  }

  return {
    hypotheses,
    unexplained_artifact_ids: raw.unexplained_artifact_ids || [],
    needs_manager_dispatch: !!raw.needs_manager_dispatch,
    source_proposal_id,
    prompt_version: PROMPT_VERSIONS.WORKFLOW_ASSEMBLY,
    model_version: "automatic",
  };
}

function normalizeHypothesis(h, { clinicId, policyVersion, assemblyRunId, cluster }) {
  const tracks = h.reasoning_tracks && typeof h.reasoning_tracks === "object" && !Array.isArray(h.reasoning_tracks)
    ? h.reasoning_tracks
    : {};
  const reasoning_tracks = Object.fromEntries(
    TRACK_IDS.map((id) => [id, Array.isArray(tracks[id]) ? tracks[id] : []])
  );

  return {
    workflow_hypothesis_id: h.workflow_hypothesis_id || `hyp-${Math.random().toString(36).slice(2, 8)}`,
    workflow_family: h.workflow_family || cluster?.workflow_family_hint || null,
    composition_type: h.composition_type || cluster?.composition_type || "orphan",
    target_workflow_id: h.target_workflow_id || null,
    ordered_artifact_ids: h.ordered_artifact_ids || [],
    reasoning_tracks,
    unsupported_assumptions: h.unsupported_assumptions || [],
    contradictions: h.contradictions || [],
    unexplained_artifact_ids: h.unexplained_artifact_ids || [],
    clinic_id: clinicId || null,
    policy_version: policyVersion ?? null,
    assembly_run_id: assemblyRunId || null,
  };
}