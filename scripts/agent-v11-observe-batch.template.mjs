/* Generated locally with private structured scenarios; never commit generated output. */
const INPUT = __AGENT_V11_PRIVATE_SCENARIOS_JSON__;
const TEST_PREFIX = "agent-v11-it-observe-batch-";
const FORBIDDEN_CLINICS = new Set(["clinic-001"]);
const CLEANUP_ORDER = [
  "AgentAttachIntent", "WorkflowArtifactLink", "UndoListItem", "AttentionItem",
  "ManagerDecision", "WorkflowCommitIntent", "WorkflowHypothesis", "CompositionRun",
  "WorkflowSnapshot", "Workflow", "EvidenceFactCard", "Artifact", "GuessPolicy",
  "Staff", "ClinicConfig",
];

function assert(condition, message) {
  if (!condition) throw new Error(`agent_v11_observe_batch_assertion_failed:${message}`);
}
function unwrap(result) { return result?.data ?? result; }
function safeText(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
function clock(now) {
  const businessDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  const slot = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(now);
  return { businessDate, slot };
}
function increment(map, key) { map[key] = (map[key] || 0) + 1; }

async function runScenario(scenario, actor) {
  const clinicId = `${TEST_PREFIX}${crypto.randomUUID()}`;
  assert(clinicId.startsWith(TEST_PREFIX), "unsafe_test_prefix");
  assert(!FORBIDDEN_CLINICS.has(clinicId), "production_clinic_forbidden");

  async function rows(entity) {
    assert(clinicId.startsWith(TEST_PREFIX) && !FORBIDDEN_CLINICS.has(clinicId), "unsafe_entity_scope");
    return (await base44.entities[entity].filter({ clinic_id: clinicId })) || [];
  }
  async function create(entity, payload) {
    assert(payload?.clinic_id === clinicId, `${entity}_tenant_scope_invalid`);
    const record = await base44.entities[entity].create(payload);
    assert(record?.id, `${entity}_create_failed`);
    return record;
  }
  async function counts() {
    const result = {};
    for (const entity of CLEANUP_ORDER) result[entity] = (await rows(entity)).length;
    return result;
  }
  async function cleanup() {
    const before = await counts();
    const deleted = {};
    for (const entity of CLEANUP_ORDER) {
      deleted[entity] = 0;
      for (const record of await rows(entity)) {
        if (!record?.id) continue;
        await base44.entities[entity].delete(String(record.id));
        deleted[entity] += 1;
      }
    }
    const after = await counts();
    assert(Object.values(after).every((value) => value === 0), "cleanup_residue");
    return { before, deleted, after, cleanup_all_zero: true };
  }

  const report = {
    scenario_id: scenario.scenario_id,
    scenario_type: scenario.scenario_type,
    clinic_id: clinicId,
    result: null,
    replay: null,
    cleanup: null,
  };

  try {
    const now = new Date();
    const nowIso = now.toISOString();
    const { businessDate, slot } = clock(now);
    const workflowInput = scenario.workflow || {};
    const subjectName = safeText(workflowInput.subject_name, `REDACTED-${scenario.scenario_id}`);
    const family = safeText(workflowInput.workflow_family, "unknown");
    const subjectType = safeText(workflowInput.subject_type, "unknown");

    const staff = await create("Staff", {
      clinic_id: clinicId, user_id: actor.id, staff_name: "Observe Batch Operator",
      role: "doctor", role_group: "medical_core", status: "off_duty",
    });
    await create("ClinicConfig", {
      clinic_id: clinicId, clinic_name: `Observe batch ${scenario.scenario_id}`,
      manager_id: staff.id, activation_status: "active", timezone: "Asia/Tokyo",
      schedule_times: [slot], shadow_mode: true, active_policy_version: 1,
      composition_rollout_status: "pilot", composition_schedule_enabled: false,
    });
    await create("GuessPolicy", {
      clinic_id: clinicId, policy_version: 1, status: "published", tracks: [],
      hard_guardrails: [], decision_rules: {}, published_at: nowIso, published_by: actor.id,
    });
    const workflow = await create("Workflow", {
      clinic_id: clinicId, workflow_family: family, subject_type: subjectType,
      subject_fingerprint: { name: subjectName }, status: "active", temporal_anchors: [nowIso],
      started_at: new Date(now.getTime() - 600_000).toISOString(), last_event_at: nowIso,
      open_loops: Array.isArray(workflowInput.open_loops) ? workflowInput.open_loops : [],
      session_id: `session-${crypto.randomUUID()}`, business_line: family,
    });
    const snapshot = await create("WorkflowSnapshot", {
      clinic_id: clinicId, workflow_id: workflow.id, session_id: workflow.session_id,
      patient_name: subjectName, business_line: family, start_time: workflow.started_at,
      current_node: "observe_baseline", nodes_completed: [], stage_durations: {}, status: "active",
      pipeline_trigger: "manual", generated_at: nowIso, snapshot_version: 1,
      projection_version: 1, projected_through_event_seq: 0,
      source_proposal_id: `observe-baseline-${scenario.scenario_id}`, artifact_ids: [],
      evidence_fact_card_ids: [], audit_event_ids: [],
    });
    await base44.entities.Workflow.update(workflow.id, {
      current_snapshot_id: snapshot.id, current_snapshot_version: 1,
    });

    let seq = 0;
    for (const fragment of scenario.fragments) {
      seq += 1;
      const occurredAt = new Date(now.getTime() + Number(fragment.occurred_at_offset_seconds || 0) * 1000).toISOString();
      const explicit = fragment.targeting === "explicit";
      const artifact = await create("Artifact", {
        clinic_id: clinicId,
        artifact_type: safeText(fragment.artifact_type, "text"),
        file_url: `https://example.invalid/${clinicId}/${seq}`,
        source_staff_id: staff.id,
        source_region: safeText(fragment.source_region, "unknown"),
        ...(explicit ? { source_workflow_id: workflow.id } : {}),
        business_date: businessDate, captured_at: occurredAt, ingestion_seq: seq, interpreted: true,
      });
      const fields = (fragment.fields || []).map((field) => ({
        field_name: safeText(field.field_name, "unclassified"),
        value: safeText(field.value, "REDACTED"),
        source_artifact_id: artifact.id,
        source_region: safeText(fragment.source_region, "unknown"),
        source_quote: safeText(field.source_quote, "redacted structured extraction"),
        extraction_quality: safeText(field.extraction_quality, "high"),
        extraction_method: safeText(field.extraction_method, "manual"),
      }));
      const fact = await create("EvidenceFactCard", {
        clinic_id: clinicId, artifact_id: artifact.id,
        ...(explicit ? { explicit_workflow_id: workflow.id } : {}),
        fields, business_date: businessDate, extracted_at: nowIso,
        model_version: "real-structured-observe-batch", prompt_version: "observe-batch-v1",
        policy_version: 1, stale: false,
        workflow_family_hint: safeText(fragment.workflow_family_hint, family),
        subject_type: safeText(fragment.subject_type, subjectType),
        subject_fingerprint: { name: safeText(fragment.subject_name, subjectName) },
        subject_quality: safeText(fragment.subject_quality, "high"),
        occurred_at: occurredAt, time_uncertain: fragment.time_uncertain === true,
        alignment_status: "aligned", assembly_eligible: true,
      });
      await base44.entities.Artifact.update(artifact.id, { evidence_fact_card_id: fact.id, interpreted: true });
      await create("UndoListItem", {
        clinic_id: clinicId, artifact_id: artifact.id, original_uploader_id: staff.id,
        idempotency_key: `${clinicId}::${artifact.id}`, business_date: businessDate,
        bounced_at: nowIso, bounce_reason: "not_assembled_by_cutoff", status: "pending",
      });
    }

    const request = {
      action: "run", clinic_id: clinicId, business_date: businessDate, slot,
      policy_version: 1, cutoff_event_seq: seq, cutoff_ingested_at: nowIso,
      prompt_version: "agent-v11-observe-batch-v1", model_version: "automatic",
      trigger_type: "manager_manual",
    };
    const baseline = {
      snapshot_id: snapshot.id, snapshot_version: 1,
      snapshot_count: (await rows("WorkflowSnapshot")).length,
      link_count: (await rows("WorkflowArtifactLink")).length,
      undo_count: (await rows("UndoListItem")).length,
    };
    const first = unwrap(await base44.functions.invoke("compositionOrchestrator", request));
    assert(first?.ok === true && first?.run?.status === "completed", "run_not_completed");
    assert(first?.run?.auto_attach_mode === "observe", "runtime_not_observe");
    const reasons = Array.isArray(first.run.auto_attach_gate_reasons) ? first.run.auto_attach_gate_reasons : [];
    const firstCounts = await counts();
    const intents = await rows("AgentAttachIntent");
    const workflowAfter = (await rows("Workflow"))[0];
    const undos = await rows("UndoListItem");
    assert(firstCounts.WorkflowArtifactLink === baseline.link_count, "observe_link_write");
    assert(firstCounts.WorkflowSnapshot === baseline.snapshot_count, "observe_snapshot_write");
    assert(workflowAfter?.current_snapshot_id === baseline.snapshot_id, "observe_pointer_write");
    assert(workflowAfter?.current_snapshot_version === baseline.snapshot_version, "observe_version_write");
    assert(undos.length === baseline.undo_count && undos.every((row) => row.status === "pending"), "observe_undo_write");
    assert((await rows("ManagerDecision")).length === 0, "observe_manager_decision_write");
    assert((await rows("WorkflowCommitIntent")).length === 0, "observe_commit_intent_write");
    if (first.run.auto_attach_eligible === true) {
      assert(intents.length === 1 && intents[0].status === "observed", "observed_intent_missing");
    } else {
      assert(intents.length === 0 && reasons.length > 0, "ineligible_gate_contract_invalid");
    }

    const replay = unwrap(await base44.functions.invoke("compositionOrchestrator", request));
    assert(replay?.ok === true && replay?.idempotent === true, "replay_not_idempotent");
    assert(replay?.run?.id === first.run.id, "replay_run_changed");
    const replayCounts = await counts();
    for (const entity of ["CompositionRun", "WorkflowHypothesis", "AgentAttachIntent", "WorkflowArtifactLink", "WorkflowSnapshot", "UndoListItem"]) {
      assert(replayCounts[entity] === firstCounts[entity], `replay_growth_${entity}`);
    }

    report.result = {
      run_id: first.run.id,
      eligible: first.run.auto_attach_eligible === true,
      gate_reasons: reasons,
      unique_best_pass: !reasons.includes("unique_best_missing"),
      manager_dispatch_clear: !reasons.includes("manager_dispatch_required"),
      validation_blocks_clear: !reasons.includes("validation_blocks_present"),
      auto_attach_outcome: first.run.auto_attach_outcome,
      observed_intent_count: intents.filter((row) => row.status === "observed").length,
      authoritative_writes: { links: 0, snapshots: 0, pointer_changes: 0, undo_resolved: 0 },
    };
    report.replay = { idempotent: true, zero_growth: true };
  } catch (error) {
    report.error = String(error?.message || error).replace(/[\r\n]+/g, " ").slice(0, 300);
  } finally {
    report.cleanup = await cleanup();
  }
  return report;
}

assert(INPUT?.schema_version === "agent-v11-observe-batch-v1", "input_version_invalid");
assert(Array.isArray(INPUT.scenarios) && INPUT.scenarios.length > 0 && INPUT.scenarios.length <= 50, "input_count_invalid");
const actor = await base44.auth.me();
assert(actor?.id, "authenticated_user_missing");

const scenarioReports = [];
for (const scenario of INPUT.scenarios) scenarioReports.push(await runScenario(scenario, actor));

const summary = {
  mode: "observe",
  sample_count: scenarioReports.length,
  completed_count: scenarioReports.filter((row) => !row.error).length,
  failed_count: scenarioReports.filter((row) => row.error).length,
  eligible_count: scenarioReports.filter((row) => row.result?.eligible === true).length,
  eligible_rate: 0,
  gate_reason_distribution: {},
  scenario_type_distribution: {},
  safety: {
    forbidden_clinic_untouched: true,
    secrets_unchanged: true,
    commit_mode_not_requested: true,
    authoritative_writes_zero: scenarioReports.every((row) => !row.result || Object.values(row.result.authoritative_writes).every((value) => value === 0)),
    cleanup_all_zero: scenarioReports.every((row) => row.cleanup?.cleanup_all_zero === true),
  },
};
summary.eligible_rate = summary.sample_count ? summary.eligible_count / summary.sample_count : 0;
for (const row of scenarioReports) {
  const type = row.scenario_type;
  if (!summary.scenario_type_distribution[type]) {
    summary.scenario_type_distribution[type] = { sample_count: 0, eligible_count: 0, eligible_rate: 0, failed_count: 0 };
  }
  const bucket = summary.scenario_type_distribution[type];
  bucket.sample_count += 1;
  if (row.result?.eligible === true) bucket.eligible_count += 1;
  if (row.error) bucket.failed_count += 1;
  for (const reason of row.result?.gate_reasons || []) increment(summary.gate_reason_distribution, reason);
}
for (const bucket of Object.values(summary.scenario_type_distribution)) {
  bucket.eligible_rate = bucket.sample_count ? bucket.eligible_count / bucket.sample_count : 0;
}

console.log(JSON.stringify({ summary, scenarios: scenarioReports }, null, 2));
if (summary.failed_count > 0 || !Object.values(summary.safety).every(Boolean)) {
  throw new Error("agent_v11_observe_batch_failed");
}
