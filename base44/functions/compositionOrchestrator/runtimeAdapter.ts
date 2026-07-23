import { interpretArtifact } from "./runtime/evidenceInterpreter.js";
import { resolveWorkflowLink } from "./runtime/candidateFinder.js";
import { buildCompositionClusters } from "./runtime/clustering.js";
import { assembleWorkflow } from "./runtime/workflowAssembly.js";
import { validateHypotheses } from "./runtime/guardrailValidator.js";
import {
  clusterMultiPage,
  propagateGroupResolution,
  buildMultipageVetoIssue,
} from "./runtime/factCardCluster.js";

export const PHASE2_RUNTIME_SOURCES = {
  "src/lib/composition/prompts.js": "92d7d741dffc41e6859e2a4bbf4ecbced327c559",
  "src/lib/composition/evidenceInterpreter.js": "1fe84faf2f7be6ed9ba4f5ab121e19a651d1a9f2",
  "src/lib/composition/candidateFinder.js": "cd2264b4aa5417c667b922482221562f01b6f996",
  "src/lib/composition/clustering.js": "bcdf4db155bd85d493106236531f3300216a1770",
  "src/lib/composition/workflowAssembly.js": "223c1d41b963d21f330a05d66c4fcd7605a80a4f",
  "src/lib/composition/guardrailValidator.js": "39275606474fe379c5bd3370eea90ba6b4284770",
  "src/lib/tenant/tenantContext.js": "b7504dcf1c9fb86ff2ec30bc4f0b9a439cf4a82c",
};

// Deploy-time provenance for Agent v1.1 mirrors. These pins are deliberately
// separate from the legacy Phase 2 map so older parity contracts stay stable.
export const AGENT_V11_RUNTIME_SOURCES = {
  "src/lib/agentV11/attachmentProjection.js": "f9383ef747eb6b61e52cf1b7623ff46b62cc649d",
  "src/lib/agentV11/authoritativeAttachSaga.js": "d9cb0aab76a06cf967fee98d613f740ef83dfa2d",
  "src/lib/agentV11/agentAutoAttachSaga.js": "aa048d94e9e1919fab16ceef504f71d6bb54780d",
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

function deviceSerial(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const ROLE_BUSINESS_FAMILY = {
  DOCTOR: "CLINICAL", PHYSICIAN_ASST: "CLINICAL", SURGEON: "CLINICAL",
  OR_NURSE: "CLINICAL", ANESTHESIOLOGIST: "CLINICAL", NURSE: "CLINICAL",
  TRIAGE_STAFF: "CLINICAL", OPTOMETRIST: "CLINICAL", OPTICIAN: "CLINICAL",
  VISION_TRAINER: "CLINICAL", IMAGING_TECH: "CLINICAL", DIAGNOSTIC_STAFF: "CLINICAL",
  RECEPTION: "CLINICAL", CRM_STAFF: "CLINICAL", PATIENT_GUIDE: "CLINICAL",
  MARKETING: "MARKETING", CHANNEL_DEV: "MARKETING", SCREENING_TEAM: "MARKETING",
  CASHIER: "FINANCE", INSURANCE_OFFICER: "FINANCE", ACCOUNTANT: "FINANCE",
  PHARMACIST: "LOGISTICS", EQUIPMENT_ADMIN: "LOGISTICS", INVENTORY_STAFF: "LOGISTICS",
  CLINIC_DIRECTOR: "ADMIN", QA_OFFICER: "ADMIN", SANITATION_STAFF: "ADMIN",
};

const CATEGORY_BUSINESS_FAMILY = {
  clinical_consultation: "CLINICAL", prescription_order: "CLINICAL",
  refraction_optometry: "CLINICAL", ok_lens_fitting: "CLINICAL",
  vision_therapy: "CLINICAL", glasses_dispensing: "CLINICAL",
  ophthalmic_imaging: "CLINICAL", lab_test: "CLINICAL", surgery_record: "CLINICAL",
  intraocular_lens: "CLINICAL", minor_procedure: "CLINICAL",
  triage_precheck: "CLINICAL", nursing_care: "CLINICAL",
  patient_registration: "CLINICAL", followup_crm: "CLINICAL",
  school_screening: "MARKETING", mkt_event: "MARKETING", channel_cooperation: "MARKETING",
  medical_insurance: "FINANCE", retail_invoice: "FINANCE", financial_settlement: "FINANCE",
  pharmacy_dispensing: "LOGISTICS", supply_purchase: "LOGISTICS", facility_repair: "LOGISTICS",
  admin_inspection: "ADMIN", quality_control: "ADMIN",
};

function isDeclaredProxy(artifact) {
  return artifact?.is_proxy === true ||
    artifact?.user_interactive_meta?.proxy?.is_proxy === true ||
    artifact?.user_interactive_meta?.execution_context?.is_proxy === true;
}

export function collectManagerExceptionValidationIssues(resolvedCards = [], artifacts = []) {
  const artifactMap = byId(artifacts);
  const issues = [];
  for (const card of resolvedCards) {
    const artifact = artifactMap.get(card.artifact_id);
    if (!artifact) continue;
    if (artifact.exception_class !== "manager_approved_exception" &&
        artifact.normal_rule_learning_eligible !== false) continue;
    issues.push({
      type: "manager_exception_archive_only",
      semantic_class: "hard_exception_isolation",
      artifact_id: artifact.id || card.artifact_id,
      fact_card_id: card.id || null,
      normal_rule_learning_eligible: false,
    });
  }
  return issues;
}

export function collectSourceContextValidationIssues(resolvedCards = [], artifacts = []) {
  const artifactMap = byId(artifacts);
  const issues = [];
  for (const card of resolvedCards) {
    const artifact = artifactMap.get(card.artifact_id);
    if (!artifact || isDeclaredProxy(artifact)) continue;
    const role = String(artifact.source_role || "").toUpperCase();
    const category = String(artifact.category_id || "").toLowerCase();
    const roleFamily = ROLE_BUSINESS_FAMILY[role] || null;
    const categoryFamily = CATEGORY_BUSINESS_FAMILY[category] || null;
    if (!roleFamily || !categoryFamily || roleFamily === categoryFamily) continue;
    issues.push({
      type: categoryFamily === "CLINICAL" ? "source_role_conflict" : "business_family_conflict",
      semantic_class: "hard_source_context_conflict",
      artifact_id: artifact.id || card.artifact_id,
      fact_card_id: card.id || null,
      source_role: role,
      role_business_family: roleFamily,
      category_id: category,
      category_business_family: categoryFamily,
    });
  }
  return issues;
}

function factField(card, name) {
  const field = (card?.fields || []).find((item) => item?.field_name === name);
  return typeof field?.value === "string" ? field.value.trim() : null;
}

export function collectFinanceExpectedMissingProjections(resolvedCards = [], artifacts = []) {
  const artifactMap = byId(artifacts);
  const projections = [];
  for (const card of resolvedCards) {
    const artifact = artifactMap.get(card.artifact_id);
    if (!artifact || artifact.category_id !== "financial_settlement") continue;
    const paymentCategory = String(factField(card, "payment_category") || "").toUpperCase();
    if (paymentCategory.includes("OCT")) {
      projections.push({
        status: "expected_missing",
        expected_artifact_type: "ophthalmic_imaging",
        rule_code: "REVERSE_INFER_FINANCE_01",
        source_artifact_id: artifact.id,
        source_fact_card_id: card.id || null,
        evidence_field: "payment_category",
      });
    }
  }
  return projections;
}

export function collectDeviceIdentityValidationIssues(resolvedCards = [], workflows = []) {
  const workflowMap = byId(workflows);
  const issues = [];
  for (const card of resolvedCards) {
    const observed = deviceSerial(card?.device_serial || card?.subject_fingerprint?.device_serial);
    const resolvedCandidateIds = Array.isArray(card?._candidateWorkflowIds)
      ? card._candidateWorkflowIds
      : [];
    const candidateIds = resolvedCandidateIds.length > 0
      ? resolvedCandidateIds
      : workflows
          .filter((workflow) =>
            workflow.workflow_family === card.workflow_family_hint &&
            !["closed", "archived"].includes(String(workflow.status || "").toLowerCase())
          )
          .map((workflow) => workflow.id);
    if (!observed || candidateIds.length === 0) continue;
    const declared = candidateIds
      .map((id) => {
        const workflow = workflowMap.get(id);
        return deviceSerial(workflow?.device_serial || workflow?.subject_fingerprint?.device_serial);
      })
      .filter(Boolean);
    if (declared.length > 0 && declared.length === candidateIds.length &&
        declared.every((serial) => serial !== observed)) {
      issues.push({
        type: "device_identity_conflict",
        semantic_class: "hard_identity_conflict",
        fact_card_id: card.id || null,
        candidate_workflow_ids: candidateIds,
      });
    }
  }
  return issues;
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
  let resolvedCards = [];

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
    // V11 FactCardCluster：注入 session_hint（来自 Artifact.original_metadata），
    // 供 candidateFinder 之后的聚合同源分组使用。零回归：无 hint 时为 null。
    const sessionHint =
      artifact?.original_metadata?.patient_session_id_hint || null;
    resolvedCards.push({
      ...card,
      _resolvedWorkflowId: link.linkedWorkflowId,
      _linkMethod: link.method,
      _candidateWorkflowIds: link.candidates.map((item) => item.workflow_id),
      _invalidCandidates: link.invalid_candidates || [],
      _session_hint: sessionHint,
    });
  }

  // V11 多页证据聚合：同 session_hint + business_date 的卡片识别为同一事件。
  // 一票否决合并 alignment_status，最小值合并 confidence；纯内存态，不改 FactCard 实体。
  const multipageResult = clusterMultiPage(resolvedCards);
  const multipageClusters = multipageResult.clusters || [];
  // 组内传播已解析 workflow，使同组卡片归入同一 attach train（候选匹配增强）。
  resolvedCards = propagateGroupResolution(resolvedCards, multipageClusters);
  const multipageVetoIssues = buildMultipageVetoIssue(multipageClusters);

  const clusters = await buildCompositionClusters({
    factCards: resolvedCards,
    workflows: scopedWorkflows,
    invokeLLM,
  });

  const hypotheses = [];
  const validationIssues = [
    ...(clusters.validation_issues || []),
    ...multipageVetoIssues,
    ...collectSourceContextValidationIssues(resolvedCards, artifacts),
    ...collectManagerExceptionValidationIssues(resolvedCards, artifacts),
    ...collectDeviceIdentityValidationIssues(resolvedCards, scopedWorkflows),
  ];

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

  const expectedMissingProjections =
    collectFinanceExpectedMissingProjections(resolvedCards, artifacts);

  return {
    hypotheses,
    guardrailResult,
    validationIssues,
    expectedMissingProjections,
    artifactIds: [...new Set(hypotheses.flatMap((item) => item.ordered_artifact_ids || []))],
    factCardIds: resolvedCards.map((item) => item.id).filter(Boolean),
    // V11 多页证据聚合结果（纯内存态，供看板/审计展示，不落库）
    multipageClusters,
  };
}