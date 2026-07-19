/*
 * Phase 4 isolated scheduler pilot helper.
 *
 * Run only through scripts/phase4-scheduler-pilot.sh. The shell wrapper owns
 * server-secret rollback; this helper owns a randomized phase4-it-* fixture,
 * scheduled-scan assertions and exact-id tenant cleanup.
 */

const TEST_PREFIX = "phase4-it-scheduler-";
const FORBIDDEN_CLINICS = new Set(["clinic-001"]);
const MODES = new Set(["setup", "scan", "verify", "cleanup"]);
const cleanupOrder = [
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

const mode = Deno.env.get("PHASE4_PILOT_MODE") || "";
const clinicId = Deno.env.get("PHASE4_TEST_CLINIC_ID") || "";
const scanExpectation = Deno.env.get("PHASE4_SCAN_EXPECTATION") || "";

function assert(condition, message) {
  if (!condition) throw new Error(`phase4_scheduler_pilot_assertion_failed:${message}`);
}

function unwrap(result) {
  return result?.data ?? result;
}

function assertSafeClinic() {
  assert(MODES.has(mode), "mode_invalid");
  assert(clinicId.startsWith(TEST_PREFIX), "unsafe_test_prefix");
  assert(/^phase4-it-scheduler-[0-9a-f-]{36}$/.test(clinicId), "test_clinic_format_invalid");
  assert(!FORBIDDEN_CLINICS.has(clinicId), "production_clinic_forbidden");
}

async function rows(entityName) {
  return (await base44.entities[entityName].filter({ clinic_id: clinicId })) ?? [];
}

async function counts() {
  const result = {};
  for (const entityName of cleanupOrder) result[entityName] = (await rows(entityName)).length;
  return result;
}

async function create(entityName, payload) {
  const record = await base44.entities[entityName].create(payload);
  assert(record?.id, `${entityName}_id_missing`);
  return record;
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

async function setup() {
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
    staff_name: "Phase 4 Scheduler Pilot Manager",
    role: "doctor",
    role_group: "medical_core",
    status: "off_duty",
  });

  await create("ClinicConfig", {
    clinic_id: clinicId,
    clinic_name: `Phase 4 scheduler pilot ${clinicId.slice(-8)}`,
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
    tracks: [],
    hard_guardrails: [],
    decision_rules: {},
    published_at: nowIso,
    published_by: me.id,
  });

  for (let index = 1; index <= 3; index += 1) {
    const occurredAt = new Date(now.getTime() + index * 60_000).toISOString();
    const artifact = await create("Artifact", {
      clinic_id: clinicId,
      artifact_type: "file",
      file_url: `https://example.invalid/${clinicId}/scheduler-evidence-${index}.txt`,
      source_staff_id: staff.id,
      source_region: "phase4_scheduler_pilot",
      business_date: businessDate,
      captured_at: occurredAt,
      ingestion_seq: index,
      interpreted: true,
    });
    const factCard = await create("EvidenceFactCard", {
      clinic_id: clinicId,
      artifact_id: artifact.id,
      fields: [{
        field_name: index === 1 ? "po_number" : index === 2 ? "received_qty" : "inspection_status",
        value: index === 1 ? `PO-${clinicId.slice(-6)}` : index === 2 ? "50" : "accepted",
        source_artifact_id: artifact.id,
        source_region: "phase4_scheduler_pilot",
        source_quote: `scheduler pilot fixture ${index}`,
        extraction_quality: "high",
        extraction_method: "manual",
      }],
      business_date: businessDate,
      extracted_at: nowIso,
      model_version: "phase4-scheduler-pilot-fixture",
      prompt_version: "phase4-scheduler-pilot-fixture",
      policy_version: 1,
      stale: false,
      workflow_family_hint: "procurement",
      subject_type: "supplier",
      subject_fingerprint: { name: "Phase 4 Scheduler Test Supplier" },
      subject_quality: "high",
      occurred_at: occurredAt,
    });
    await base44.entities.Artifact.update(artifact.id, {
      evidence_fact_card_id: factCard.id,
      interpreted: true,
    });
  }

  return { mode, clinic_id: clinicId, business_date: businessDate, slot, counts: await counts() };
}

async function scan() {
  assert(scanExpectation === "first" || scanExpectation === "replay", "scan_expectation_invalid");
  const result = unwrap(await base44.functions.invoke("compositionOrchestrator", {
    args: { mode: "scheduled_scan" },
  }));
  const item = result?.results?.find((row) => row.clinic_id === clinicId);
  assert(result?.ok === true, "scan_not_ok");
  assert(result?.scheduler_enabled === true, "scheduler_not_enabled");
  assert(result?.scanned === 1, "allowlist_not_single_clinic");
  assert(result?.processed === 1, "scan_not_processed");
  assert(item?.status === "processed", "clinic_not_processed");
  assert(item?.run_id, "scheduled_run_id_missing");
  assert(item?.idempotent === (scanExpectation === "replay"), "scan_idempotency_unexpected");
  return { mode, expectation: scanExpectation, clinic_id: clinicId, result };
}

async function verify() {
  const all = {};
  for (const entityName of cleanupOrder) all[entityName] = await rows(entityName);
  const config = all.ClinicConfig[0] ?? null;
  const run = all.CompositionRun[0] ?? null;

  assert(all.ClinicConfig.length === 1, "clinic_config_count_unexpected");
  assert(all.CompositionRun.length === 1, "composition_run_count_unexpected");
  assert(run?.status === "completed", "scheduled_run_not_completed");
  assert(run?.trigger_type === "scheduled", "run_not_scheduled");
  assert(all.WorkflowHypothesis.length >= 1, "hypothesis_missing");
  assert(all.WorkflowHypothesis.every((row) => row.status === "pending_review"), "hypothesis_not_pending_review");
  assert(all.AttentionItem.length >= 1, "attention_item_missing");
  assert(all.ManagerDecision.length === 0, "manager_decision_created");
  assert(all.WorkflowCommitIntent.length === 0, "commit_intent_created");
  assert(all.WorkflowSnapshot.length === 0, "snapshot_created");
  assert(all.Workflow.length === 0, "workflow_created");
  assert(config?.composition_last_schedule_status === "idempotent", "scheduler_health_not_idempotent");
  assert(config?.composition_last_schedule_run_id === run.id, "scheduler_health_run_mismatch");
  assert(config?.composition_last_schedule_success_at, "scheduler_success_timestamp_missing");
  assert(config?.composition_last_schedule_error_code == null, "scheduler_error_code_present");
  assert(config?.composition_run_lock_owner_id == null, "composition_lock_not_released");

  return {
    mode,
    clinic_id: clinicId,
    counts: Object.fromEntries(Object.entries(all).map(([name, records]) => [name, records.length])),
    run: { id: run.id, status: run.status, trigger_type: run.trigger_type },
    scheduler_health: {
      status: config.composition_last_schedule_status,
      run_id: config.composition_last_schedule_run_id,
      slot: config.composition_last_schedule_slot,
      success_at: config.composition_last_schedule_success_at,
      error_code: config.composition_last_schedule_error_code ?? null,
    },
    assertions: {
      single_scheduled_run: true,
      idempotent_replay_zero_growth: true,
      pending_human_review: true,
      no_authoritative_workflow_side_effects: true,
      lock_released: true,
    },
  };
}

async function cleanup() {
  const before = await counts();
  const deleted = {};
  for (const entityName of cleanupOrder) {
    deleted[entityName] = 0;
    const exactIds = (await rows(entityName)).map((record) => String(record.id)).filter(Boolean);
    for (const id of exactIds) {
      await base44.entities[entityName].delete(id);
      deleted[entityName] += 1;
    }
  }
  const after = await counts();
  assert(Object.values(after).every((count) => count === 0), "cleanup_residue");
  return { mode, clinic_id: clinicId, before, deleted, after, cleanup_all_zero: true };
}

assertSafeClinic();

let result;
if (mode === "setup") result = await setup();
if (mode === "scan") result = await scan();
if (mode === "verify") result = await verify();
if (mode === "cleanup") result = await cleanup();
console.log(JSON.stringify(result, null, 2));
