/**
 * Clinic OS V10 — Workflow Assembly（修订版 R2）
 *
 * R2：
 * - 输出含 target_snapshot_id / target_snapshot_version / target_workflow_id（可空）；
 * - 删除 Math.random()，hypothesis ID = proposal_id + candidate_index（确定性，重试稳定）；
 * - 不再返回 LLM 自报 needs_manager_dispatch；最终 needs_manager_dispatch 由 Guardrail 校验结果唯一决定。
 */

import {
  PROMPT_VERSIONS,
  REASONING_TRACKS,
  TRACK_IDS,
  buildAssemblyPrompt,
  ASSEMBLY_JSON_SCHEMA,
} from "./prompts";
import { computeProposalIdempotencyKey } from "../tenant/tenantContext";

export async function assembleWorkflow({
  cluster,
  compositionType,
  factCards,
  candidateWorkflows = [],
  workflow = null,
  snapshot = null,
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

  const sortedArtifactIds = [...(cluster.artifact_ids || [])].sort();
  // R2.7：source_proposal_id 缺失时禁止生成 hypothesis（删除 hyp-0 兜底）
  if (!clinicId || sortedArtifactIds.length === 0 || policyVersion == null) {
    throw new Error(
      "assembleWorkflow: source_proposal_id requires clinic_id + sorted artifact_ids + policy_version"
    );
  }
  const source_proposal_id = computeProposalIdempotencyKey({
    clinicId,
    sortedArtifactIds,
    policyVersion,
  });

  const prompt = buildAssemblyPrompt({
    factCards: cardsForCluster,
    candidateWorkflows,
    compositionContext: { compositionType, workflow, snapshot },
    sopDigest,
    policyTracks: guessPolicy.tracks,
  });

  const raw = await invokeLLM({
    prompt,
    response_json_schema: ASSEMBLY_JSON_SCHEMA,
    model: "automatic",
  });

  const hypotheses = (raw.hypotheses || []).map((h, idx) =>
    normalizeHypothesis(h, {
      clinicId,
      policyVersion,
      assemblyRunId,
      cluster,
      sourceProposalId: source_proposal_id,
      idx,
      workflow,
      snapshot,
    })
  );

  // 注意：不返回 raw.needs_manager_dispatch；最终 needs_manager_dispatch 由 validateHypotheses 决定。
  return {
    hypotheses,
    unexplained_artifact_ids: raw.unexplained_artifact_ids || [],
    source_proposal_id,
    prompt_version: PROMPT_VERSIONS.WORKFLOW_ASSEMBLY,
    model_version: "automatic",
  };
}

function buildHypothesisId(sourceProposalId, idx) {
  // 确定性 ID：proposal_id + candidate_index；source_proposal_id 缺失时禁止生成（见 assembleWorkflow 守卫）
  return `${sourceProposalId}#h${idx}`;
}

function normalizeHypothesis(h, { clinicId, policyVersion, assemblyRunId, cluster, sourceProposalId, idx, workflow, snapshot }) {
  const tracks = h.reasoning_tracks && typeof h.reasoning_tracks === "object" && !Array.isArray(h.reasoning_tracks)
    ? h.reasoning_tracks
    : {};
  const reasoning_tracks = Object.fromEntries(
    TRACK_IDS.map((id) => [id, Array.isArray(tracks[id]) ? tracks[id] : []])
  );

  return {
    workflow_hypothesis_id: buildHypothesisId(sourceProposalId, idx),
    workflow_family: h.workflow_family || cluster?.workflow_family_hint || null,
    composition_type: h.composition_type || cluster?.composition_type || "orphan",
    target_workflow_id: h.target_workflow_id || null,
    target_snapshot_id: snapshot?.id || workflow?.snapshot_id || null,
    target_snapshot_version: snapshot?.snapshot_version ?? workflow?.snapshot_version ?? null,
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