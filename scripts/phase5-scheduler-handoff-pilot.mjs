/*
 * Phase 5 parser → Agent scheduled handoff pilot helper.
 * Run only through scripts/phase5-scheduler-handoff-pilot.sh.
 */
const TEST_PREFIX = "phase5-it-handoff-";
const MODES = new Set(["setup", "scan", "verify", "cleanup"]);
const cleanupOrder = [
  "AttentionItem", "ManagerDecision", "WorkflowCommitIntent",
  "WorkflowHypothesis", "CompositionRun", "WorkflowSnapshot", "Workflow",
  "FragmentProcessingResult", "EvidenceFactCard", "Artifact",
  "GuessPolicy", "Staff", "ClinicConfig",
];

const mode = Deno.env.get("PHASE5_HANDOFF_MODE") || "";
const clinicId = Deno.env.get("PHASE5_HANDOFF_CLINIC_ID") || "";
const scanExpectation = Deno.env.get("PHASE5_HANDOFF_SCAN_EXPECTATION") || "";

function assert(value, message) {
  if (!value) throw new Error(`phase5_handoff_pilot_assertion_failed:${message}`);
}
function unwrap(value) { return value?.data ?? value; }
function safeClinic() {
  assert(MODES.has(mode), "mode_invalid");
  assert(/^phase5-it-handoff-[0-9a-f-]{36}$/.test(clinicId), "unsafe_test_clinic");
  assert(clinicId !== "clinic-001", "production_clinic_forbidden");
}
async function rows(name) {
  return (await base44.entities[name].filter({ clinic_id: clinicId })) ?? [];
}
async function counts() {
  const out = {};
  for (const name of cleanupOrder) out[name] = (await rows(name)).length;
  return out;
}
async function create(name, data) {
  const row = await base44.entities[name].create(data);
  assert(row?.id, `${name}_create_failed`);
  return row;
}
function localClock(now) {
  const options = { timeZone: "Asia/Tokyo", hour12: false };
  const businessDate = new Intl.DateTimeFormat("en-CA", {
    ...options, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  const slot = new Intl.DateTimeFormat("en-GB", {
    ...options, hour: "2-digit", minute: "2-digit",
  }).format(now);
  return { businessDate, slot };
}
async function capture(text, index, now) {
  const response = unwrap(await base44.functions.invoke("fragmentIngestionService", {
    action: "captureFragment",
    clinic_id: clinicId,
    fragment_type: "text",
    client_request_id: `phase5-handoff-${index}-${crypto.randomUUID()}`,
    captured_at: new Date(now.getTime() + index * 60_000).toISOString(),
    source: { text },
    context: { department: "procurement", device_id: "phase5-handoff-pilot" },
  }));
  assert(response?.ok === true, `capture_${index}_failed`);
  assert(response?.processing?.status === "aligned", `capture_${index}_not_aligned`);
  assert(Number.isFinite(Number(response?.artifact?.ingestion_seq)), `capture_${index}_ingestion_seq_missing`);
  return response;
}

async function setup() {
  const initial = await counts();
  assert(Object.values(initial).every((count) => count === 0), "fixture_not_empty");
  const me = await base44.auth.me();
  assert(me?.id, "authenticated_user_missing");
  const now = new Date();
  const { businessDate, slot } = localClock(now);

  const staff = await create("Staff", {
    clinic_id: clinicId, user_id: me.id, staff_name: "Phase 5 Handoff Pilot",
    role: "doctor", role_group: "medical_core", status: "on_duty",
    assigned_zone: "procurement", checked_in_at: now.toISOString(),
  });
  await create("ClinicConfig", {
    clinic_id: clinicId, clinic_name: `Phase 5 handoff ${clinicId.slice(-8)}`,
    manager_id: staff.id, activation_status: "active", timezone: "Asia/Tokyo",
    schedule_times: [slot], shadow_mode: true, active_policy_version: 1,
    composition_rollout_status: "pilot", composition_schedule_enabled: true,
    composition_schedule_grace_minutes: 10,
  });
  await create("GuessPolicy", {
    clinic_id: clinicId, policy_version: 1, status: "published",
    tracks: [], hard_guardrails: [], decision_rules: {},
    published_at: now.toISOString(), published_by: me.id,
  });

  await capture(`采购单 PO-${clinicId.slice(-6)} 已创建，供应商 Phase 5 Test Supplier。`, 1, now);
  await capture("本次到货 50 件，收货单已核对。", 2, now);
  await capture("质检完成，结果 accepted。", 3, now);

  const artifacts = await rows("Artifact");
  const cards = await rows("EvidenceFactCard");
  assert(artifacts.length === 3, "artifact_count_unexpected");
  assert(cards.length === 3, "fact_card_count_unexpected");
  assert(cards.every((row) => row.assembly_eligible === true && row.alignment_status === "aligned"),
    "fact_card_not_pickup_ready");
  assert((await rows("CompositionRun")).length === 0, "upload_triggered_composition_run");
  for (const name of ["Workflow", "WorkflowSnapshot", "WorkflowCommitIntent", "ManagerDecision"]) {
    assert((await rows(name)).length === 0, `${name}_created_during_ingestion`);
  }
  return { mode, clinic_id: clinicId, business_date: businessDate, slot, counts: await counts() };
}

async function scan() {
  assert(scanExpectation === "first" || scanExpectation === "replay", "scan_expectation_invalid");
  const before = await counts();
  const result = unwrap(await base44.functions.invoke("compositionOrchestrator", {
    args: { mode: "scheduled_scan" },
  }));
  const item = result?.results?.find((row) => row.clinic_id === clinicId);
  assert(result?.ok === true, "scan_not_ok");
  assert(result?.scheduler_enabled === true, "scheduler_not_enabled");
  assert(result?.scanned === 1, "allowlist_not_single_clinic");
  assert(result?.processed === 1, "scan_not_processed");
  assert(item?.status === "processed" && item?.run_id, "clinic_not_processed");
  assert(item.idempotent === (scanExpectation === "replay"), "scan_idempotency_unexpected");
  const after = await counts();
  if (scanExpectation === "replay") {
    assert(after.CompositionRun === before.CompositionRun, "replay_run_growth");
    assert(after.WorkflowHypothesis === before.WorkflowHypothesis, "replay_hypothesis_growth");
    assert(after.AttentionItem === before.AttentionItem, "replay_attention_growth");
  }
  return { mode, expectation: scanExpectation, clinic_id: clinicId, result, before, after };
}

async function verify() {
  const all = {};
  for (const name of cleanupOrder) all[name] = await rows(name);
  const config = all.ClinicConfig[0];
  const run = all.CompositionRun[0];
  assert(all.CompositionRun.length === 1, "composition_run_count_unexpected");
  assert(run?.status === "completed" && run?.trigger_type === "scheduled", "scheduled_run_invalid");
  assert(all.WorkflowHypothesis.length >= 1, "hypothesis_missing");
  assert(all.WorkflowHypothesis.every((row) => row.status === "pending_review"), "auto_review_detected");
  assert(all.ManagerDecision.length === 0, "manager_decision_created");
  assert(all.WorkflowCommitIntent.length === 0, "commit_intent_created");
  assert(all.WorkflowSnapshot.length === 0, "snapshot_created");
  assert(all.Workflow.length === 0, "workflow_created");
  assert(config?.composition_last_schedule_status === "idempotent", "scheduler_health_not_idempotent");
  assert(config?.composition_last_schedule_run_id === run.id, "scheduler_health_run_mismatch");
  assert(config?.composition_run_lock_owner_id == null, "composition_lock_not_released");
  return {
    mode, clinic_id: clinicId,
    counts: Object.fromEntries(Object.entries(all).map(([name, value]) => [name, value.length])),
    run: { id: run.id, status: run.status, trigger_type: run.trigger_type },
    assertions: {
      parser_did_not_auto_trigger: true,
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
  for (const name of cleanupOrder) {
    deleted[name] = 0;
    for (const row of await rows(name)) {
      await base44.entities[name].delete(String(row.id));
      deleted[name] += 1;
    }
  }
  const after = await counts();
  assert(Object.values(after).every((count) => count === 0), "cleanup_residue");
  return { mode, clinic_id: clinicId, before, deleted, after, cleanup_all_zero: true };
}

safeClinic();
let result;
if (mode === "setup") result = await setup();
if (mode === "scan") result = await scan();
if (mode === "verify") result = await verify();
if (mode === "cleanup") result = await cleanup();
console.log(JSON.stringify(result, null, 2));

