import { interpretArtifact } from "./runtime/evidenceInterpreter.js";
import { resolveWorkflowLink } from "./runtime/candidateFinder.js";
import { buildCompositionClusters } from "./runtime/clustering.js";
import { assembleWorkflow } from "./runtime/workflowAssembly.js";
import { validateHypotheses } from "./runtime/guardrailValidator.js";

export const PHASE2_RUNTIME_SOURCES = {
  "src/lib/composition/prompts.js": "92d7d741dffc41e6859e2a4bbf4ecbced327c559",
  "src/lib/composition/evidenceInterpreter.js": "1fe84faf2f7be6ed9ba4f5ab121e19a651d1a9f2",
  "src/lib/composition/candidateFinder.js": "cd2264b4aa5417c667b922482221562f01b6f996",
  "src/lib/composition/clustering.js": "bcdf4db155bd85d493106236531f3300216a1770",
  "src/lib/composition/workflowAssembly.js": "66898b0c45511f99051b187f859a241bfccd3cfe",
  "src/lib/composition/guardrailValidator.js": "1207e1ccce1365c025a53586aa4e0d5233fc089f",
  "src/lib/tenant/tenantContext.js": "b7504dcf1c9fb86ff2ec30bc4f0b9a439cf4a82c",
};

function byId(items) {
  return new Map((items || []).map((item) => [item.id, item]));
}

function snapshotForWorkflow(workflow, snapshots) {
  if (!workflow) return null;
  return (
    (snapshots || []).find((item) => item.id === workflow.current_snapshot_id) ||
    (snapshots || []).find((item) => item.workflow_id === workflow.id) ||
    null
  );
}

export async function interpretArtifactRuntime({
  artifact,
  policyVersion,
  invokeLLM,
  sopDigest = "",
  businessLine = "unknown",
}) {
  return interpretArtifact({
    artifact,
    policyVersion,
    invokeLLM,
    sopDigest,
    businessLine,
  });
}

export async function executeCompositionRuntime({
  clinicId,
  compositionRunId,
  policyVersion,
  artifacts,
  factCards,
  workflows,
  snapshots,
  guessPolicy,
  invokeLLM,
  committedArtifactIds = [],
  now = Date.now(),
}) {
  if (!clinicId) throw new Error("clinicId required");
  if (!compositionRunId) throw new Error("compositionRunId required");
  if (!invokeLLM) throw new Error("invokeLLM required");

  const artifactMap = byId(artifacts);
  const scopedWorkflows = (workflows || []).filter((item) => item.clinic_id === clinicId);
  const resolvedCards = [];

  for (const card of factCards || []) {
    if (card.clinic_id !== clinicId) throw new Error("fact_card_cross_tenant");
    const artifact = artifactMap.get(card.artifact_id);
    if (!artifact || artifact.clinic_id !== clinicId) throw new Error("artifact_cross_tenant");
    const link = await resolveWorkflowLink({
      artifact,
      factCard: card,
      workflows: scopedWorkflows,
      invokeLLM,
      clinicId,
    });
    resolvedCards.push({
      ...card,
      _resolvedWorkflowId: link.linkedWorkflowId,
      _linkMethod: link.method,
      _candidateWorkflowIds: link.candidates.map((item) => item.workflow_id),
      _invalidCandidates: link.invalid_candidates || [],
    });
  }

  const clusters = await buildCompositionClusters({
    factCards: resolvedCards,
    workflows: scopedWorkflows,
    invokeLLM,
  });

  const hypotheses = [];
  const validationIssues = [...(clusters.validation_issues || [])];

  for (const cluster of clusters.attachTrains || []) {
    const workflow = scopedWorkflows.find((item) => item.id === cluster.workflow_id) || null;
    const snapshot = snapshotForWorkflow(workflow, snapshots);
    const assembled = await assembleWorkflow({
      cluster,
      compositionType: "attach",
      factCards: resolvedCards,
      workflow,
      snapshot,
      candidateWorkflows: scopedWorkflows,
      invokeLLM,
      clinicId,
      policyVersion,
      assemblyRunId: compositionRunId,
      guessPolicy: guessPolicy || {},
    });
    hypotheses.push(...assembled.hypotheses);
  }

  for (const cluster of clusters.newTrainCandidates || []) {
    const assembled = await assembleWorkflow({
      cluster,
      compositionType: "new_train",
      factCards: resolvedCards,
      candidateWorkflows: scopedWorkflows,
      invokeLLM,
      clinicId,
      policyVersion,
      assemblyRunId: compositionRunId,
      guessPolicy: guessPolicy || {},
    });
    hypotheses.push(...assembled.hypotheses);
  }

  if ((clusters.remainingOrphans || []).length > 0) {
    validationIssues.push({
      type: "remaining_orphans",
      fact_card_ids: clusters.remainingOrphans.map((item) => item.fact_card_id),
    });
  }

  const guardrailResult = validateHypotheses(hypotheses, {
    artifacts,
    workflows: scopedWorkflows,
    snapshots,
    factCards: resolvedCards,
    clinicId,
    guessPolicy: guessPolicy || {},
    committedArtifactIds,
    validationIssues,
    now,
  });

  return {
    hypotheses,
    guardrailResult,
    validationIssues,
    artifactIds: [...new Set(hypotheses.flatMap((item) => item.ordered_artifact_ids || []))],
    factCardIds: resolvedCards.map((item) => item.id).filter(Boolean),
  };
}
