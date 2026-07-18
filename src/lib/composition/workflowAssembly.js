/**
 * Clinic OS V10 — Workflow Assembly
 *
 * 职责：对一个编组列车（cluster）调用 LLM 产出 AttentionItem 提案。
 * 提案经 Guardrail Validator 校验后返回，仍为只读草案，不写入核心状态。
 *
 * 输入契约：
 *   { train, factCards, snapshot, sopDigest, guessPolicy, invokeLLM }
 * 输出：{ proposal, validation }
 *   proposal = AttentionItem 草案字段集合（含 source_proposal_id 占位由调用方填）
 */

import {
  PROMPT_VERSIONS,
  REASONING_TRACKS,
  buildAssemblyPrompt,
  ASSEMBLY_JSON_SCHEMA,
} from "./prompts";
import { validateProposal } from "./guardrailValidator";
import { computeProposalIdempotencyKey } from "../tenant/tenantContext";

export async function assembleWorkflow({
  train,
  factCards,
  snapshot = null,
  sopDigest = "",
  guessPolicy = {},
  invokeLLM,
  clinicId,
  policyVersion,
}) {
  if (!train) throw new Error("assembleWorkflow: train required");
  if (!invokeLLM) throw new Error("assembleWorkflow: invokeLLM required");

  const cardsForTrain = (factCards || []).filter((c) =>
    (train.fact_card_ids || []).includes(c.id)
  );

  const prompt = buildAssemblyPrompt({
    factCards: cardsForTrain,
    snapshot,
    sopDigest,
    policyTracks: guessPolicy.tracks?.length ? guessPolicy.tracks : REASONING_TRACKS,
  });

  const raw = await invokeLLM({
    prompt,
    response_json_schema: ASSEMBLY_JSON_SCHEMA,
    model: "automatic",
  });

  // 规范化七条轨道：补齐缺失轨道为空
  const tracksById = new Map((raw.reasoning_tracks || []).map((t) => [t.track_id, t]));
  const reasoning_tracks = REASONING_TRACKS.map((def) => ({
    track_id: def.track_id,
    supporting_evidence: tracksById.get(def.track_id)?.supporting_evidence || [],
    opposing_evidence: tracksById.get(def.track_id)?.opposing_evidence || [],
    information_gaps: tracksById.get(def.track_id)?.information_gaps || [],
  }));

  const proposal = {
    clinic_id: clinicId,
    session_id: train.session_id,
    attention_type: raw.attention_type,
    urgency: raw.urgency,
    title: raw.title,
    reasoning: raw.reasoning || "",
    recommendation: raw.recommendation,
    artifact_ids: train.artifact_ids || [],
    evidence_fact_card_ids: train.fact_card_ids || [],
    reasoning_tracks,
    unsupported_assumptions: raw.unsupported_assumptions || [],
    alternative_hypotheses: raw.alternative_hypotheses || [],
    terminal_signal_detected: !!raw.terminal_signal_detected,
    proposed_workflow_status: raw.proposed_workflow_status || null,
    proposed_handoff_department: raw.proposed_handoff_department || null,
    proposed_handoff_role: raw.proposed_handoff_role || null,
    handoff_evidence_ids: raw.handoff_evidence_ids || [],
    target_snapshot_id: snapshot?.id || null,
    policy_version: policyVersion,
    prompt_version: PROMPT_VERSIONS.WORKFLOW_ASSEMBLY,
    model_version: "automatic",
    shadow_mode_snapshot: true,
  };

  const sortedArtifactIds = [...(train.artifact_ids || [])].sort();
  if (clinicId && sortedArtifactIds.length > 0 && policyVersion != null) {
    proposal.source_proposal_id = computeProposalIdempotencyKey({
      clinicId,
      sortedArtifactIds,
      policyVersion,
    });
  }

  const validation = validateProposal(proposal, guessPolicy);
  return { proposal, validation };
}