/*
 * Phase 4 isolated runtime E2E.
 * Run only through: cat scripts/phase4-isolated-e2e.mjs | npx base44@latest exec
 * The script refuses production clinic ids, never calls review/commit, and deletes
 * only exact record ids discovered inside its randomized phase4-it-* tenant.
 */

const TEST_PREFIX = "phase4-it-";
const FORBIDDEN_CLINICS = new Set(["clinic-001"]);
const clinicId = `${TEST_PREFIX}${crypto.randomUUID()}`;
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
const exactIds = new Map(cleanupOrder.map((name) => [name, new Set()]));

function assert(condition, message) {
  if (!condition) throw new Error(`phase4_e2e_assertion_failed:${message}`);
}

function unwrap(result) {
  return result?.data ?? result;
}

async function remember(entityName, record) {
  assert(record?.id, `${entityName}_id_missing`);
  exactIds.get(entityName).add(String(record.id));
  return record;
}

async function create(entityName, payload) {
  return remember(entityName, await base44.entities[entityName].create(payload));
}

async function discoverExactIds() {
  assert(clinicId.startsWith(TEST_PREFIX), "unsafe_test_prefix");
  assert(!FORBIDDEN_CLINICS.has(clinicId), "production_clinic_forbidden");
  for (const entityName of cleanupOrder) {
    const records = await base44.entities[entityName].filter({ clinic_id: clinicId });
    for (const record of records ?? []) {
      if (record?.id) exactIds.get(entityName).add(String(record.id));
    }
  }
}

async function counts() {
  const result = {};
  for (const entityName of cleanupOrder) {
    const records = await base44.entities[entityName].filter({ clinic_id: clinicId });
    result[entityName] = (records ?? []).length;
  }
  return result;
}

async function cleanupExactIds() {
  await discoverExactIds();
  const deleted = {};
  for (const entityName of cleanupOrder) {
    deleted[entityName] = 0;
    for (const id of exactIds.get(entityName)) {
      await base44.entities[entityName].delete(id);
      deleted[entityName] += 1;
    }
  }
  return deleted;
}

const now = new Date();
const nowIso = now.toISOString();
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

const report = {
  clinic_id: clinicId,
  first_run: null,
  replay_run: null,
  before_cleanup: null,
  deleted: null,
  after_cleanup: null,
  assertions: {},
};

assert(clinicId.startsWith(TEST_PREFIX), "unsafe_test_prefix");
assert(!FORBIDDEN_CLINICS.has(clinicId), "production_clinic_forbidden");

try {
  const me = await base44.auth.me();
  assert(me?.id, "authenticated_user_missing");

  const staff = await create("Staff", {
    clinic_id: clinicId,
    user_id: me.id,
    staff_name: "Phase 4 Isolated Manager",
    role: "doctor",
    role_group: "medical_core",
    status: "off_duty",
  });

  await create("ClinicConfig", {
    clinic_id: clinicId,
    clinic_name: `Phase 4 isolated ${clinicId.slice(-8)}`,
    manager_id: staff.id,
    activation_status: "active",
    timezone: "Asia/Tokyo",
    schedule_times: [slot],
    shadow_mode: true,
    active_policy_version: 1,
    composition_rollout_status: "pilot",
    composition_schedule_enabled: false,
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
      file_url: `https://example.invalid/${clinicId}/evidence-${index}.txt`,
      source_staff_id: staff.id,
      source_region: "phase4_isolated_e2e",
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
        source_region: "phase4_isolated_e2e",
        source_quote: `isolated fixture ${index}`,
        extraction_quality: "high",
        extraction_method: "manual",
      }],
      business_date: businessDate,
      extracted_at: nowIso,
      model_version: "phase4-isolated-fixture",
      prompt_version: "phase4-isolated-fixture",
      policy_version: 1,
      stale: false,
      workflow_family_hint: "procurement",
      subject_type: "supplier",
      subject_fingerprint: { name: "Phase 4 Test Supplier" },
      subject_quality: "high",
      occurred_at: occurredAt,
    });
    await base44.entities.Artifact.update(artifact.id, {
      evidence_fact_card_id: factCard.id,
      interpreted: true,
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
    prompt_version: "phase4-isolated-e2e",
    model_version: "automatic",
    trigger_type: "manual",
  };

  const first = unwrap(await base44.functions.invoke("compositionOrchestrator", request));
  report.first_run = first;
  await discoverExactIds();
  assert(first?.ok === true, "first_run_not_ok");
  assert(first?.run?.id, "first_run_id_missing");
  assert(first?.run?.status === "completed", "first_run_not_completed");

  const firstCounts = await counts();
  const replay = unwrap(await base44.functions.invoke("compositionOrchestrator", request));
  report.replay_run = replay;
  await discoverExactIds();
  const replayCounts = await counts();

  assert(replay?.ok === true, "replay_not_ok");
  assert(replay?.idempotent === true, "replay_not_idempotent");
  assert(replay?.run?.id === first.run.id, "replay_run_id_changed");
  assert(replayCounts.CompositionRun === firstCounts.CompositionRun, "run_count_grew_on_replay");
  assert(replayCounts.WorkflowHypothesis === firstCounts.WorkflowHypothesis, "hypothesis_count_grew_on_replay");
  assert(replayCounts.AttentionItem === firstCounts.AttentionItem, "attention_count_grew_on_replay");

  const hypotheses = await base44.entities.WorkflowHypothesis.filter({ clinic_id: clinicId });
  assert(hypotheses.length >= 1, "no_hypothesis_generated");
  assert(hypotheses.every((row) => row.status === "pending_review"), "hypothesis_not_pending_review");
  assert(replayCounts.ManagerDecision === 0, "manager_decision_created_without_review");
  assert(replayCounts.WorkflowCommitIntent === 0, "commit_intent_created_without_commit");
  assert(replayCounts.WorkflowSnapshot === 0, "snapshot_created_without_commit");
  assert(replayCounts.Workflow === 0, "workflow_created_without_commit");

  report.assertions.run_completed = true;
  report.assertions.idempotent_replay = true;
  report.assertions.human_review_boundary = true;
  report.before_cleanup = replayCounts;
} catch (error) {
  report.error = String(error?.message ?? error).replace(/[\r\n]+/g, " ").slice(0, 300);
} finally {
  report.deleted = await cleanupExactIds();
  report.after_cleanup = await counts();
  report.assertions.cleanup_all_zero = Object.values(report.after_cleanup).every((count) => count === 0);
  console.log(JSON.stringify(report, null, 2));
}

if (report.error || !Object.values(report.assertions).every(Boolean)) {
  throw new Error("phase4_isolated_e2e_failed");
}
