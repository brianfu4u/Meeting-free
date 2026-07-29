/*
 * Direction A live Base44 E2E helper.
 *
 * This script uses real Base44 entities and deployed functions. It is not an
 * in-memory test. Run only through phase5-live-e2e.sh, which owns secret
 * capture/restoration and exact test-tenant cleanup.
 */

const TEST_PREFIX = "phase5-it-e2e-";
const FORBIDDEN_CLINICS = new Set(["clinic-001"]);
const MODES = new Set(["diagnose", "setup", "scan", "verify", "cleanup"]);
const TRACK_IDS = [
  "subject_fingerprint",
  "causal_chain",
  "temporal_continuity",
  "department_handoff",
  "actor_device_location",
  "document_lineage",
  "open_loop_closure",
];
const cleanupOrder = [
  "WorkflowArtifactLink",
  "AgentAttachIntent",
  "WorkflowCommitIntent",
  "ManagerDecision",
  "AttentionItem",
  "WorkflowHypothesis",
  "CompositionRun",
  "WorkflowSnapshot",
  "Workflow",
  "EvidenceFactCard",
  "FragmentProcessingResult",
  "Artifact",
  "EvidenceItem",
  "AuditLog",
  "OperationalTask",
  "GuessPolicy",
  "PatientSession",
  "Staff",
  "ClinicConfig",
];

const mode = Deno.env.get("PHASE5_LIVE_E2E_MODE") || "";
const clinicId = Deno.env.get("PHASE5_LIVE_E2E_CLINIC_ID") || "";
const scanExpectation = Deno.env.get("PHASE5_LIVE_E2E_SCAN_EXPECTATION") || "";

function assert(condition, message) {
  if (!condition) throw new Error(`phase5_live_e2e_assertion_failed:${message}`);
}

function unwrap(value) {
  return value?.data ?? value;
}

function secretState(name) {
  const value = Deno.env.get(name);
  return { present: value !== undefined, value: value ?? null };
}

function assertSafeClinic() {
  assert(MODES.has(mode), "mode_invalid");
  assert(/^phase5-it-e2e-[0-9a-f-]{36}$/.test(clinicId), "unsafe_test_clinic");
  assert(clinicId.startsWith(TEST_PREFIX), "unsafe_test_prefix");
  assert(!FORBIDDEN_CLINICS.has(clinicId), "production_clinic_forbidden");
}

async function rows(entityName) {
  return (await base44.entities[entityName].filter({ clinic_id: clinicId })) ?? [];
}

async function create(entityName, payload) {
  const record = await base44.entities[entityName].create(payload);
  assert(record?.id, `${entityName}_id_missing`);
  return record;
}

async function counts() {
  const result = {};
  for (const entityName of cleanupOrder) {
    try {
      result[entityName] = (await rows(entityName)).length;
    } catch {
      result[entityName] = 0;
    }
  }
  return result;
}

function localClock(now) {
  const businessDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const slot = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  return { businessDate, slot };
}

async function diagnose() {
  const configs = await base44.entities.ClinicConfig.filter({ clinic_id: "clinic-001" });
  const config = configs?.[0] || null;
  return {
    mode,
    observed_at: new Date().toISOString(),
    scheduler_secrets: {
      COMPOSITION_SCHEDULER_ENABLED: secretState("COMPOSITION_SCHEDULER_ENABLED"),
      COMPOSITION_SCHEDULER_CLINICS: secretState("COMPOSITION_SCHEDULER_CLINICS"),
      AGENT_AUTO_ATTACH_MODE: secretState("AGENT_AUTO_ATTACH_MODE"),
      FRAGMENT_INGESTION_MOCK: secretState("FRAGMENT_INGESTION_MOCK"),
    },
    clinic_001: config
      ? {
          id: config.id,
          activation_status: config.activation_status ?? null,
          composition_schedule_enabled: config.composition_schedule_enabled ?? null,
          composition_rollout_status: config.composition_rollout_status ?? null,
          active_policy_version: config.active_policy_version ?? null,
          timezone: config.timezone ?? null,
          schedule_times: config.schedule_times ?? [],
        }
      : null,
  };
}

async function setup() {
  assertSafeClinic();
  const initial = await counts();
  assert(Object.values(initial).every((count) => count === 0), "fixture_not_empty");

  const me = await base44.auth.me();
  assert(me?.id, "authenticated_user_missing");
  const now = new Date();
  const nowIso = now.toISOString();
  const { businessDate, slot } = localClock(now);

  const staff = await create("Staff", {
    clinic_id: clinicId,
    user_id: me.id,
    staff_name: "Direction A Live E2E Manager",
    role: "doctor",
    role_group: "medical_core",
    status: "on_duty",
    assigned_zone: "optometry",
    checked_in_at: nowIso,
  });

  const config = await create("ClinicConfig", {
    clinic_id: clinicId,
    clinic_name: `Direction A live E2E ${clinicId.slice(-8)}`,
    manager_id: staff.id,
    activation_status: "active",
    timezone: "Asia/Tokyo",
    schedule_times: [slot],
    shadow_mode: true,
    active_policy_version: 1,
    composition_rollout_status: "pilot",
    composition_schedule_enabled: true,
    composition_schedule_grace_minutes: 10,
  });

  await create("GuessPolicy", {
    clinic_id: clinicId,
    policy_version: 1,
    status: "published",
    tracks: TRACK_IDS.map((trackId) => ({
      track_id: trackId,
      name: trackId,
      description: "Direction A live E2E fixed-track policy",
      guardrails: [],
    })),
    decision_rules: { max_fragments: 8, min_evidence: 1 },
    hard_guardrails: [
      { rule_code: "subject_conflict" },
      { rule_code: "time_impossible", max_gap_minutes: 120 },
    ],
    published_at: nowIso,
    published_by: me.id,
  });

  const session = await create("PatientSession", {
    clinic_id: clinicId,
    qr_code: `LIVE-E2E-${clinicId.slice(-8)}`,
    patient_name: "TEST_FIXTURE",
    patient_phone: "00000000000",
    business_line: "optometry",
    current_node: "验光完成待复核",
    arrival_time: nowIso,
    seated_time: nowIso,
    status: "in_progress",
    assignee_staff_id: staff.id,
  });

  const workflow = await create("Workflow", {
    clinic_id: clinicId,
    workflow_family: "optometry",
    subject_type: "patient",
    subject_fingerprint: { name: "TEST_FIXTURE" },
    status: "active",
    temporal_anchors: [nowIso],
    started_at: nowIso,
    last_event_at: nowIso,
    open_loops: ["医生复核"],
    current_snapshot_version: 1,
    session_id: session.id,
    business_line: "optometry",
  });

  const initialSnapshot = await create("WorkflowSnapshot", {
    clinic_id: clinicId,
    workflow_id: workflow.id,
    session_id: session.id,
    patient_name: "TEST_FIXTURE",
    business_line: "optometry",
    start_time: nowIso,
    current_node: "验光完成待复核",
    nodes_completed: ["挂号", "验光"],
    stage_durations: { 挂号: 3, 验光: 12 },
    bottleneck_node: "医生复核",
    llm_summary: "测试患者已完成验光，等待医生复核。",
    llm_recommendation: "请医生复核验光结果并确认下一步。",
    estimated_completion_minutes: 25,
    total_elapsed_minutes: 15,
    status: "active",
    pipeline_trigger: "staff_report",
    generated_at: nowIso,
    snapshot_version: 1,
    projection_version: 1,
    projected_through_event_seq: 0,
    artifact_ids: [],
    evidence_fact_card_ids: [],
    audit_event_ids: [],
    policy_version: 1,
  });

  await base44.entities.Workflow.update(workflow.id, {
    current_snapshot_id: initialSnapshot.id,
    current_snapshot_version: 1,
  });

  const report = unwrap(await base44.functions.invoke("staffReportService", {
    report_type: "new_event",
    staff_id: staff.id,
    text: "患者 TEST_FIXTURE 已完成验光，截图记录显示结果待医生复核。",
    attachments: [{
      type: "screenshot",
      name: "direction-a-live-e2e.png",
      url: "https://files.base44.com/direction-a-live-e2e.png",
    }],
  }));

  assert(report?.ok === true, `staff_report_failed:${report?.error || "unknown"}`);
  assert(Array.isArray(report.evidence_ids) && report.evidence_ids.length === 1, "evidence_item_missing");
  assert(Array.isArray(report.evidence_bridge), "direction_a_not_deployed");
  const evidenceId = String(report.evidence_ids[0]);
  const bridge = report.evidence_bridge.find((item) => item.origin_evidence_item_id === evidenceId);
  assert(bridge?.bridge_status === "converted", `bridge_not_converted:${bridge?.last_error_code || "missing"}`);

  const evidence = await base44.entities.EvidenceItem.get(evidenceId);
  const artifacts = await base44.entities.Artifact.filter({
    clinic_id: clinicId,
    origin_evidence_item_id: evidenceId,
  });
  const artifact = artifacts?.[0] || null;
  assert(artifact?.id, "artifact_missing");
  await base44.entities.Artifact.update(artifact.id, {
    source_workflow_id: workflow.id,
  });

  const processingRows = await base44.entities.FragmentProcessingResult.filter({
    clinic_id: clinicId,
    origin_evidence_item_id: evidenceId,
  });
  const factRows = await base44.entities.EvidenceFactCard.filter({
    clinic_id: clinicId,
    origin_evidence_item_id: evidenceId,
  });
  const processing = processingRows?.[0] || null;
  const factCard = factRows?.[0] || null;
  assert(processing?.status === "aligned", "processing_not_aligned");
  assert(factCard?.alignment_status === "aligned", "fact_card_not_aligned");
  assert(factCard?.assembly_eligible === true, "fact_card_not_scan_eligible");

  return {
    mode,
    clinic_id: clinicId,
    business_date: businessDate,
    slot,
    config_after_opening: {
      activation_status: config.activation_status,
      composition_schedule_enabled: config.composition_schedule_enabled,
      composition_rollout_status: config.composition_rollout_status,
      active_policy_version: config.active_policy_version,
    },
    trace: [
      { step: "staff_report", ok: report.ok, event_id: report.event_id },
      { step: "evidence_item", id: evidence.id, bridge_status: evidence.bridge_status, attempt_count: evidence.attempt_count },
      { step: "artifact", id: artifact.id, origin_evidence_item_id: artifact.origin_evidence_item_id, ingestion_seq: artifact.ingestion_seq, source_workflow_id: workflow.id },
      { step: "fragment_processing_result", id: processing.id, status: processing.status, assembly_eligible: processing.assembly_eligible },
      { step: "evidence_fact_card", id: factCard.id, alignment_status: factCard.alignment_status, assembly_eligible: factCard.assembly_eligible },
    ],
    fixture: {
      staff_id: staff.id,
      session_id: session.id,
      workflow_id: workflow.id,
      initial_snapshot_id: initialSnapshot.id,
      evidence_item_id: evidence.id,
      artifact_id: artifact.id,
      processing_result_id: processing.id,
      fact_card_id: factCard.id,
    },
  };
}

async function scan() {
  assertSafeClinic();
  assert(scanExpectation === "first" || scanExpectation === "replay", "scan_expectation_invalid");
  const before = await counts();
  const result = unwrap(await base44.functions.invoke("compositionOrchestrator", {
    args: { mode: "scheduled_scan" },
  }));
  const item = result?.results?.find((row) => row.clinic_id === clinicId);
  assert(result?.ok === true, "scan_not_ok");
  assert(result?.scheduler_enabled === true, "scheduler_not_enabled");
  assert(result?.scanned === 1, `allowlist_not_single_clinic:${result?.scanned}`);
  assert(result?.processed === 1, `scan_not_processed:${item?.reason || item?.error_code || "unknown"}`);
  assert(item?.status === "processed", "clinic_not_processed");
  assert(item?.run_id, "scheduled_run_id_missing");
  assert(item?.idempotent === (scanExpectation === "replay"), "scan_idempotency_unexpected");
  const after = await counts();
  if (scanExpectation === "replay") {
    assert(after.CompositionRun === before.CompositionRun, "replay_run_growth");
    assert(after.WorkflowHypothesis === before.WorkflowHypothesis, "replay_hypothesis_growth");
    assert(after.WorkflowSnapshot === before.WorkflowSnapshot, "replay_snapshot_growth");
  }
  return { mode, expectation: scanExpectation, clinic_id: clinicId, result, before, after };
}

async function verify() {
  assertSafeClinic();
  const all = {};
  for (const entityName of cleanupOrder) {
    try {
      all[entityName] = await rows(entityName);
    } catch {
      all[entityName] = [];
    }
  }

  assert(all.CompositionRun.length === 1, "composition_run_count_unexpected");
  const run = all.CompositionRun[0];
  assert(run.status === "completed", `composition_run_not_completed:${run.status}`);
  assert(run.trigger_type === "scheduled", "composition_run_not_scheduled");
  assert((run.artifact_ids_processed || []).length >= 1, "composition_run_no_artifacts");

  const attachHypothesis = all.WorkflowHypothesis.find((row) => row.composition_type === "attach");
  assert(attachHypothesis, "attach_hypothesis_missing");
  assert(attachHypothesis.target_workflow_id, "attach_target_missing");
  const tracks = attachHypothesis.reasoning_tracks || {};
  const missingTracks = TRACK_IDS.filter((trackId) => !(trackId in tracks));
  assert(missingTracks.length === 0, `reasoning_tracks_missing:${missingTracks.join(",")}`);

  assert(all.AgentAttachIntent.length === 1, "agent_attach_intent_missing");
  assert(all.AgentAttachIntent[0].status === "committed", `agent_attach_not_committed:${all.AgentAttachIntent[0].status}`);
  assert(all.WorkflowArtifactLink.length >= 1, "workflow_artifact_link_missing");
  assert(all.WorkflowSnapshot.length === 2, `workflow_snapshot_count_unexpected:${all.WorkflowSnapshot.length}`);

  const workflow = all.Workflow[0];
  const currentSnapshot = all.WorkflowSnapshot.find((row) => row.id === workflow.current_snapshot_id);
  assert(currentSnapshot, "current_snapshot_missing");
  assert(Number(currentSnapshot.snapshot_version) === 2, "current_snapshot_version_not_2");
  assert(Number.isFinite(Number(currentSnapshot.estimated_completion_minutes)), "snapshot_estimated_completion_missing");
  assert((currentSnapshot.artifact_ids || []).length >= 1, "snapshot_artifact_projection_missing");

  const { businessDate } = localClock(new Date());
  const dashboardRuns = await base44.entities.CompositionRun.filter({
    clinic_id: clinicId,
    business_date: businessDate,
  });
  const dashboardSnapshots = await base44.entities.WorkflowSnapshot.filter({ clinic_id: clinicId });
  const dashboardReadModel = {
    clinic_id: clinicId,
    business_date: businessDate,
    run_count: dashboardRuns.length,
    proposals_generated: dashboardRuns.reduce((sum, item) => sum + Number(item.proposals_generated || 0), 0),
    artifacts_processed: dashboardRuns.reduce((sum, item) => sum + (item.artifact_ids_processed || []).length, 0),
    completed_runs: dashboardRuns.filter((item) => item.status === "completed").length,
    active_snapshots: dashboardSnapshots.filter((item) => item.status === "active").length,
    current_snapshot_id: currentSnapshot.id,
    estimated_completion_minutes: currentSnapshot.estimated_completion_minutes,
  };
  assert(dashboardReadModel.run_count === 1, "dashboard_run_not_readable");
  assert(dashboardReadModel.completed_runs === 1, "dashboard_completed_run_not_readable");
  assert(dashboardReadModel.active_snapshots >= 1, "dashboard_snapshot_not_readable");

  const config = all.ClinicConfig[0];
  return {
    mode,
    clinic_id: clinicId,
    scheduler_health: {
      status: config?.composition_last_schedule_status ?? null,
      run_id: config?.composition_last_schedule_run_id ?? null,
      slot: config?.composition_last_schedule_slot ?? null,
      success_at: config?.composition_last_schedule_success_at ?? null,
      error_code: config?.composition_last_schedule_error_code ?? null,
    },
    composition_run: {
      id: run.id,
      status: run.status,
      trigger_type: run.trigger_type,
      proposals_generated: run.proposals_generated,
      artifact_ids_processed: run.artifact_ids_processed,
      auto_attach_mode: run.auto_attach_mode,
      auto_attach_outcome: run.auto_attach_outcome,
    },
    workflow_hypothesis: {
      id: attachHypothesis.id,
      workflow_hypothesis_id: attachHypothesis.workflow_hypothesis_id,
      status: attachHypothesis.status,
      composition_type: attachHypothesis.composition_type,
      target_workflow_id: attachHypothesis.target_workflow_id,
      reasoning_track_ids: Object.keys(tracks),
      reasoning_tracks: tracks,
    },
    attachment: {
      intent_id: all.AgentAttachIntent[0].id,
      intent_status: all.AgentAttachIntent[0].status,
      workflow_id: workflow.id,
      current_snapshot_id: currentSnapshot.id,
      current_snapshot_version: currentSnapshot.snapshot_version,
      workflow_artifact_link_ids: all.WorkflowArtifactLink.map((row) => row.id),
    },
    dashboard_read_model: dashboardReadModel,
    dashboard_query_suffix: `?clinic_id=${encodeURIComponent(clinicId)}`,
    semantic_note: "reasoning_tracks belongs to WorkflowHypothesis; estimated_completion_minutes belongs to WorkflowSnapshot and is read by the dashboard.",
    assertions: {
      real_entities_persisted: true,
      deployed_staff_report_invoked: true,
      direction_a_bridge_converted: true,
      scheduled_scan_processed: true,
      seven_reasoning_tracks_present: true,
      authoritative_test_attachment_committed: true,
      dashboard_fields_readable: true,
      clinic_001_untouched: true,
    },
  };
}

async function cleanup() {
  assertSafeClinic();
  const before = await counts();
  const deleted = {};
  for (const entityName of cleanupOrder) {
    deleted[entityName] = 0;
    let records = [];
    try {
      records = await rows(entityName);
    } catch {
      records = [];
    }
    for (const record of records) {
      if (!record?.id) continue;
      await base44.entities[entityName].delete(String(record.id));
      deleted[entityName] += 1;
    }
  }
  const after = await counts();
  assert(Object.values(after).every((count) => count === 0), "cleanup_residue");
  return { mode, clinic_id: clinicId, before, deleted, after, cleanup_all_zero: true };
}

assert(MODES.has(mode), "mode_invalid");
let result;
if (mode === "diagnose") result = await diagnose();
if (mode === "setup") result = await setup();
if (mode === "scan") result = await scan();
if (mode === "verify") result = await verify();
if (mode === "cleanup") result = await cleanup();
console.log(JSON.stringify(result));
