/*
 * Agent v1.1 authoritative-attach observation pilot.
 * Run only through: cat scripts/agent-v11-observe-pilot.mjs | npx base44@latest exec
 *
 * Preconditions:
 * - AGENT_AUTO_ATTACH_MODE=observe
 * - never runs against clinic-001
 * - never changes secrets
 * - deletes only rows scoped to its randomized agent-v11-it-* tenant
 */

const TEST_PREFIX = "agent-v11-it-observe-";
const FORBIDDEN_CLINICS = new Set(["clinic-001"]);
const clinicId = `${TEST_PREFIX}${crypto.randomUUID()}`;
const cleanupOrder = [
  "AgentAttachIntent",
  "WorkflowArtifactLink",
  "UndoListItem",
  "AttentionItem",
  "ManagerDecision",
  "WorkflowCommitIntent",
  "WorkflowHypothesis",
  "CompositionRun",
  "WorkflowSnapshot",
  "Workflow",
  "EvidenceFactCard",
  "Artifact",
  "GuessPolicy",
  "Staff",
  "ClinicConfig",
];

function assert(condition, message) {
  if (!condition) throw new Error(`agent_v11_observe_assertion_failed:${message}`);
}

function unwrap(result) {
  return result?.data ?? result;
}

function assertSafeClinic() {
  assert(clinicId.startsWith(TEST_PREFIX), "unsafe_test_prefix");
  assert(/^agent-v11-it-observe-[0-9a-f-]{36}$/.test(clinicId), "test_clinic_format_invalid");
  assert(!FORBIDDEN_CLINICS.has(clinicId), "production_clinic_forbidden");
}

async function rows(entityName) {
  assertSafeClinic();
  return (await base44.entities[entityName].filter({ clinic_id: clinicId })) ?? [];
}

async function counts() {
  const result = {};
  for (const entityName of cleanupOrder) result[entityName] = (await rows(entityName)).length;
  return result;
}

async function create(entityName, payload) {
  assert(payload?.clinic_id === clinicId, `${entityName}_tenant_scope_invalid`);
  const record = await base44.entities[entityName].create(payload);
  assert(record?.id, `${entityName}_id_missing`);
  return record;
}

async function cleanup() {
  const before = await counts();
  const deleted = {};
  for (const entityName of cleanupOrder) {
    deleted[entityName] = 0;
    for (const record of await rows(entityName)) {
      if (!record?.id) continue;
      await base44.entities[entityName].delete(String(record.id));
      deleted[entityName] += 1;
    }
  }
  const after = await counts();
  assert(Object.values(after).every((count) => count === 0), "cleanup_residue");
  return { before, deleted, after, cleanup_all_zero: true };
}

function localClock(now) {
  const businessDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  const slot = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(now);
  return { businessDate, slot };
}

function gateSummary(run) {
  const reasons = Array.isArray(run?.auto_attach_gate_reasons)
    ? run.auto_attach_gate_reasons
    : [];
  return {
    sample_size: 1,
    eligible_count: run?.auto_attach_eligible === true ? 1 : 0,
    eligible_rate: run?.auto_attach_eligible === true ? 1 : 0,
    unique_best_pass_count: reasons.includes("unique_best_missing") ? 0 : 1,
    guardrail_clean_count: reasons.includes("manager_dispatch_required") ? 0 : 1,
    validation_clear_count: reasons.includes("validation_blocks_present") ? 0 : 1,
    gate_reasons: reasons,
  };
}

assertSafeClinic();

const report = {
  clinic_id: clinicId,
  mode_expected: "observe",
  first_run: null,
  replay_run: null,
  observation: null,
  cleanup: null,
  assertions: {},
};

try {
  const me = await base44.auth.me();
  assert(me?.id, "authenticated_user_missing");
  const now = new Date();
  const nowIso = now.toISOString();
  const { businessDate, slot } = localClock(now);

  const staff = await create("Staff", {
    clinic_id: clinicId,
    user_id: me.id,
    staff_name: "Agent v1.1 Observe Pilot Manager",
    role: "doctor",
    role_group: "medical_core",
    status: "off_duty",
  });

  await create("ClinicConfig", {
    clinic_id: clinicId,
    clinic_name: `Agent v1.1 observe ${clinicId.slice(-8)}`,
    manager_id: staff.id,
    activation_status: "active",
    timezone: "Asia/Tokyo",
    schedule_times: [slot],
    shadow_mode: true,
    active_policy_version: 1,
    composition_rollout_status: "pilot",
    composition_schedule_enabled: false,
  });

  await create("GuessPolicy", {
    clinic_id: clinicId,
    policy_version: 1,
    status: "published",
    tracks: [],
    hard_guardrails: [],
    decision_rules: {},
    published_at: nowIso,
    published_by: me.id,
  });

  const workflow = await create("Workflow", {
    clinic_id: clinicId,
    workflow_family: "optometry",
    subject_type: "patient",
    subject_fingerprint: { name: "Agent Observe Test Patient" },
    status: "active",
    temporal_anchors: [nowIso],
    started_at: new Date(now.getTime() - 10 * 60_000).toISOString(),
    last_event_at: nowIso,
    open_loops: ["clinical_review"],
    session_id: `session-${clinicId.slice(-8)}`,
    business_line: "optometry",
  });

  const snapshot = await create("WorkflowSnapshot", {
    clinic_id: clinicId,
    workflow_id: workflow.id,
    session_id: workflow.session_id,
    patient_name: "Agent Observe Test Patient",
    business_line: "optometry",
    start_time: workflow.started_at,
    current_node: "refraction",
    nodes_completed: ["registration"],
    stage_durations: {},
    status: "active",
    pipeline_trigger: "manual",
    generated_at: nowIso,
    snapshot_version: 1,
    projection_version: 1,
    projected_through_event_seq: 0,
    source_proposal_id: `observe-baseline-${clinicId}`,
    artifact_ids: [],
    evidence_fact_card_ids: [],
    audit_event_ids: [],
  });

  await base44.entities.Workflow.update(workflow.id, {
    current_snapshot_id: snapshot.id,
    current_snapshot_version: 1,
  });

  const artifactIds = [];
  for (let index = 1; index <= 3; index += 1) {
    const occurredAt = new Date(now.getTime() + index * 30_000).toISOString();
    const artifact = await create("Artifact", {
      clinic_id: clinicId,
      artifact_type: "file",
      file_url: `https://example.invalid/${clinicId}/observe-${index}.txt`,
      source_staff_id: staff.id,
      source_region: "agent_v11_observe_pilot",
      source_workflow_id: workflow.id,
      business_date: businessDate,
      captured_at: occurredAt,
      ingestion_seq: index,
      interpreted: true,
    });
    artifactIds.push(artifact.id);
    const factCard = await create("EvidenceFactCard", {
      clinic_id: clinicId,
      artifact_id: artifact.id,
      explicit_workflow_id: workflow.id,
      fields: [{
        field_name: index === 1 ? "patient_name" : index === 2 ? "refraction_result" : "review_note",
        value: index === 1 ? "Agent Observe Test Patient" : index === 2 ? "OD -2.00 OS -1.75" : "follow-up recorded",
        source_artifact_id: artifact.id,
        source_region: "agent_v11_observe_pilot",
        source_quote: `observe fixture ${index}`,
        extraction_quality: "high",
        extraction_method: "manual",
      }],
      business_date: businessDate,
      extracted_at: nowIso,
      model_version: "agent-v11-observe-fixture",
      prompt_version: "agent-v11-observe-fixture",
      policy_version: 1,
      stale: false,
      workflow_family_hint: "optometry",
      subject_type: "patient",
      subject_fingerprint: { name: "Agent Observe Test Patient" },
      subject_quality: "high",
      occurred_at: occurredAt,
      assembly_eligible: true,
    });
    await base44.entities.Artifact.update(artifact.id, {
      evidence_fact_card_id: factCard.id,
      interpreted: true,
    });
    await create("UndoListItem", {
      clinic_id: clinicId,
      artifact_id: artifact.id,
      original_uploader_id: staff.id,
      idempotency_key: `${clinicId}::${artifact.id}`,
      business_date: businessDate,
      bounced_at: nowIso,
      bounce_reason: "not_assembled_by_cutoff",
      status: "pending",
    });
  }

  const request = {
    action: "run",
    clinic_id: clinicId,
    business_date: businessDate,
    slot,
    policy_version: 1,
    cutoff_event_seq: 3,
    cutoff_ingested_at: nowIso,
    prompt_version: "agent-v11-observe-pilot",
    model_version: "automatic",
    trigger_type: "manager_manual",
  };

  const baseline = {
    workflow_snapshot_id: snapshot.id,
    workflow_snapshot_version: 1,
    snapshot_count: (await rows("WorkflowSnapshot")).length,
    link_count: (await rows("WorkflowArtifactLink")).length,
    undo_count: (await rows("UndoListItem")).length,
  };

  const first = unwrap(await base44.functions.invoke("compositionOrchestrator", request));
  report.first_run = first;
  assert(first?.ok === true, "first_run_not_ok");
  assert(first?.run?.status === "completed", "first_run_not_completed");
  assert(first?.run?.auto_attach_mode === "observe", "runtime_not_observe");
  assert(first?.auto_attach_gate?.mode === "observe", "response_gate_not_observe");

  const afterFirstCounts = await counts();
  const workflowAfterFirst = (await rows("Workflow"))[0];
  const undoAfterFirst = await rows("UndoListItem");
  const intentsAfterFirst = await rows("AgentAttachIntent");

  assert(afterFirstCounts.WorkflowArtifactLink === baseline.link_count, "link_created_in_observe");
  assert(afterFirstCounts.WorkflowSnapshot === baseline.snapshot_count, "snapshot_created_in_observe");
  assert(workflowAfterFirst?.current_snapshot_id === baseline.workflow_snapshot_id, "workflow_pointer_changed");
  assert(workflowAfterFirst?.current_snapshot_version === baseline.workflow_snapshot_version, "workflow_version_changed");
  assert(undoAfterFirst.length === baseline.undo_count, "undo_count_changed");
  assert(undoAfterFirst.every((row) => row.status === "pending"), "undo_resolved_in_observe");
  if (first.run.auto_attach_eligible === true) {
    assert(intentsAfterFirst.length === 1, "observed_intent_missing");
    assert(intentsAfterFirst[0].status === "observed", "intent_not_observed");
    assert(first.authoritative_attachment?.outcome === "observed", "observation_outcome_missing");
  } else {
    assert(intentsAfterFirst.length === 0, "intent_created_for_ineligible_gate");
    assert((first.run.auto_attach_gate_reasons || []).length > 0, "ineligible_reasons_missing");
  }

  const replay = unwrap(await base44.functions.invoke("compositionOrchestrator", request));
  report.replay_run = replay;
  assert(replay?.ok === true, "replay_not_ok");
  assert(replay?.idempotent === true, "replay_not_idempotent");
  assert(replay?.run?.id === first.run.id, "replay_run_changed");

  const afterReplayCounts = await counts();
  const workflowAfterReplay = (await rows("Workflow"))[0];
  const undoAfterReplay = await rows("UndoListItem");
  assert(afterReplayCounts.CompositionRun === afterFirstCounts.CompositionRun, "run_grew_on_replay");
  assert(afterReplayCounts.WorkflowHypothesis === afterFirstCounts.WorkflowHypothesis, "hypothesis_grew_on_replay");
  assert(afterReplayCounts.AgentAttachIntent === afterFirstCounts.AgentAttachIntent, "intent_grew_on_replay");
  assert(afterReplayCounts.WorkflowArtifactLink === baseline.link_count, "link_created_on_replay");
  assert(afterReplayCounts.WorkflowSnapshot === baseline.snapshot_count, "snapshot_created_on_replay");
  assert(workflowAfterReplay?.current_snapshot_id === baseline.workflow_snapshot_id, "replay_pointer_changed");
  assert(workflowAfterReplay?.current_snapshot_version === baseline.workflow_snapshot_version, "replay_version_changed");
  assert(undoAfterReplay.every((row) => row.status === "pending"), "undo_resolved_on_replay");
  assert((await rows("ManagerDecision")).length === 0, "manager_decision_created");
  assert((await rows("WorkflowCommitIntent")).length === 0, "manager_commit_intent_created");

  report.observation = {
    baseline,
    counts_after_first: afterFirstCounts,
    counts_after_replay: afterReplayCounts,
    gate_metrics: gateSummary(first.run),
    intent_statuses: intentsAfterFirst.map((row) => row.status),
    workflow_pointer_unchanged: true,
    undo_pending_count: undoAfterReplay.filter((row) => row.status === "pending").length,
    artifact_ids: artifactIds,
  };
  report.assertions = {
    runtime_observe: true,
    gate_telemetry_persisted: true,
    authoritative_links_zero_growth: true,
    snapshots_zero_growth: true,
    workflow_pointer_stable: true,
    undo_not_resolved: true,
    idempotent_replay_zero_growth: true,
    manager_authority_untouched: true,
  };
} catch (error) {
  report.error = String(error?.message ?? error).replace(/[\r\n]+/g, " ").slice(0, 500);
} finally {
  report.cleanup = await cleanup();
  report.assertions.cleanup_all_zero = report.cleanup.cleanup_all_zero;
  console.log(JSON.stringify(report, null, 2));
}

if (report.error || !Object.values(report.assertions).every(Boolean)) {
  throw new Error("agent_v11_observe_pilot_failed");
}
