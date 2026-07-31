/*
 * Phase 5 isolated E2E — four-modality ingestion + idempotency + tenant + dispatch bridge.
 * Run via: cat scripts/phase5-isolated-e2e.mjs | npx base44@latest exec
 *
 * Uses a randomized phase5-it-<uuid> clinic. NEVER touches clinic-001.
 * Records all created Entity IDs and cleans them up via exact-ID deletion at the end.
 */

const TEST_PREFIX = "phase5-it-";
const FORBIDDEN = new Set(["clinic-001"]);
const clinicId = `${TEST_PREFIX}${crypto.randomUUID()}`;
const cleanupOrder = [
  "AttentionItem",
  "ManagerDecision",
  "WorkflowCommitIntent",
  "WorkflowHypothesis",
  "CompositionRun",
  "WorkflowSnapshot",
  "Workflow",
  "FragmentProcessingResult",
  "EvidenceFactCard",
  "Artifact",
  "Staff",
  "ClinicConfig",
];
const exactIds = new Map(cleanupOrder.map((n) => [n, new Set()]));

function assert(cond, msg) {
  if (!cond) throw new Error(`phase5_e2e_assertion_failed:${msg}`);
}

function nowIso() { return new Date().toISOString(); }

function businessDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

async function create(name, payload) {
  const rec = await base44.entities[name].create(payload);
  assert(rec?.id, `${name}_create_failed`);
  exactIds.get(name).add(String(rec.id));
  return rec;
}

async function filterCount(name, q) {
  const rows = await base44.entities[name].filter(q);
  return (rows || []).length;
}

async function invokeFragmentIngestion(payload) {
  const res = await base44.functions.invoke("fragmentIngestionService", payload);
  return res?.data ?? res;
}

async function setupClinic() {
  const config = await create("ClinicConfig", {
    clinic_id: clinicId,
    clinic_name: "Phase5 IT Clinic",
    city: "Tokyo",
    contact: "phase5-it",
    manager_id: "phase5-manager",
    timezone: "Asia/Tokyo",
    activation_status: "active",
    cold_start_completed: true,
    shadow_mode: true,
  });
  const me = await base44.auth.me();
  assert(me?.id, "current_user_missing");
  const staff = await create("Staff", {
    clinic_id: clinicId,
    user_id: me.id,
    staff_name: "Phase5 IT Staff",
    role: "doctor",
    role_group: "medical_core",
    status: "on_duty",
    pad_online: true,
    assigned_zone: "optometry",
    checked_in_at: nowIso(),
  });
  return { config, staff, me };
}

async function captureFragment(fragmentType, source, context, clientRequestId) {
  return invokeFragmentIngestion({
    action: "captureFragment",
    clinic_id: clinicId,
    fragment_type: fragmentType,
    client_request_id: clientRequestId,
    captured_at: nowIso(),
    source,
    context: context || {},
  });
}

async function runModalityTest(label, fragmentType, source, context) {
  const clientRequestId = `e2e-${fragmentType}-${crypto.randomUUID()}`;
  const res = await captureFragment(fragmentType, source, context, clientRequestId);
  assert(res?.ok === true, `${label}_capture_failed:${JSON.stringify(res)}`);
  assert(res.artifact?.clinic_id === clinicId, `${label}_tenant_leak`);
  assert(res.processing?.status !== undefined, `${label}_processing_missing`);
  assert(Number.isFinite(Number(res.artifact?.ingestion_seq)), `${label}_ingestion_seq_missing`);
  return { label, clientRequestId, response: res };
}

async function runIdempotencyTest(imageSource) {
  const clientRequestId = `e2e-idempotency-${crypto.randomUUID()}`;
  const first = await captureFragment("image", imageSource, {}, clientRequestId);
  const firstArtifactId = first.artifact?.id;
  const second = await captureFragment("image", imageSource, {}, clientRequestId);
  assert(second.idempotent === true, "idempotent_flag_missing");
  assert(second.artifact?.id === firstArtifactId, "idempotent_artifact_mismatch");
  const count = await filterCount("Artifact", {
    clinic_id: clinicId, client_request_id: clientRequestId,
  });
  assert(count === 1, `idempotent_duplicate_artifacts:${count}`);
  return { first, second, count };
}

async function runConflictTest(imageSource) {
  const clientRequestId = `e2e-conflict-${crypto.randomUUID()}`;
  const first = await captureFragment("image", imageSource, {}, clientRequestId);
  // Same client_request_id but different fragment_type
  const second = await invokeFragmentIngestion({
    action: "captureFragment",
    clinic_id: clinicId,
    fragment_type: "document",
    client_request_id: clientRequestId,
    captured_at: nowIso(),
    source: { file_url: "https://files.base44.com/test.pdf", mime_type: "application/pdf", file_size: 1024 },
    context: {},
  });
  assert(second?.http_status === 409, `conflict_not_detected:${JSON.stringify(second)}`);
  return { first, second };
}

async function runTenantViolationTest(imageSource) {
  const res = await invokeFragmentIngestion({
    action: "captureFragment",
    clinic_id: "phase5-it-other-tenant",
    fragment_type: "image",
    client_request_id: `e2e-tenant-${crypto.randomUUID()}`,
    source: imageSource,
    context: {},
  });
  assert(res?.http_status === 403, `tenant_violation_not_blocked:${JSON.stringify(res)}`);
  return res;
}

async function runUnsupportedMimeTest() {
  const res = await invokeFragmentIngestion({
    action: "captureFragment",
    clinic_id: clinicId,
    fragment_type: "image",
    client_request_id: `e2e-mime-${crypto.randomUUID()}`,
    source: { file_url: "https://files.base44.com/test.exe", mime_type: "application/x-msdownload", file_size: 1024 },
    context: {},
  });
  assert(res?.http_status === 400, `unsupported_mime_not_rejected:${JSON.stringify(res)}`);
  assert(res?.error_code === "mime_forbidden" || res?.error_code === "mime_not_supported",
    `unsupported_mime_wrong_code:${res?.error_code}`);
  return res;
}

async function runExternalUrlTest() {
  const res = await invokeFragmentIngestion({
    action: "captureFragment",
    clinic_id: clinicId,
    fragment_type: "image",
    client_request_id: `e2e-url-${crypto.randomUUID()}`,
    source: { file_url: "https://evil.example.com/steal.png", mime_type: "image/png", file_size: 1024 },
    context: {},
  });
  assert(res?.http_status === 400, `external_url_not_blocked:${JSON.stringify(res)}`);
  assert(res?.error_code === "url_not_whitelisted", `external_url_wrong_code:${res?.error_code}`);
  return res;
}

async function runDispatchBridgeTest(alignedArtifactIds) {
  const res = await invokeFragmentIngestion({
    action: "dispatchToComposition",
    clinic_id: clinicId,
    artifact_ids: alignedArtifactIds,
  });
  assert(res?.ok === true, `dispatch_failed:${JSON.stringify(res)}`);
  assert(Array.isArray(res.fact_card_ids), "dispatch_fact_cards_missing");
  assert(res.fact_card_ids.length > 0, "dispatch_no_aligned_fact_cards");
  assert(res.dispatched === false, "dispatch_should_not_auto_run_batch1");
  return res;
}

async function cleanupExactIds() {
  assert(clinicId.startsWith(TEST_PREFIX), "unsafe_test_prefix");
  assert(!FORBIDDEN.has(clinicId), "production_clinic_forbidden");
  // Re-discover any records created (in case some weren't tracked)
  for (const name of cleanupOrder) {
    const rows = await base44.entities[name].filter({ clinic_id: clinicId });
    for (const r of rows || []) if (r?.id) exactIds.get(name).add(String(r.id));
  }
  const deleted = {};
  for (const name of cleanupOrder) {
    deleted[name] = 0;
    for (const id of exactIds.get(name)) {
      try {
        await base44.entities[name].delete(id);
        deleted[name] += 1;
      } catch (err) {
        console.error(`cleanup_delete_failed:${name}:${id}`, err?.message || err);
      }
    }
  }
  // Verify zero remaining
  const remaining = {};
  for (const name of cleanupOrder) {
    remaining[name] = await filterCount(name, { clinic_id: clinicId });
  }
  return { deleted, remaining };
}

async function verifyClinic001Untouched() {
  const artifacts = await base44.entities.Artifact.filter({ clinic_id: "clinic-001" });
  return { clinic_001_artifact_count: (artifacts || []).length };
}

async function main() {
  const summary = { clinic_id: clinicId, started_at: nowIso() };
  try {
    const { staff } = await setupClinic();
    summary.staff_id = staff.id;

    const imageSource = { file_url: "https://files.base44.com/phase5-test-fixture.png", mime_type: "image/png", original_filename: "fixture.png", file_size: 102400, checksum: "test-image-checksum" };
    const docSource = { file_url: "https://files.base44.com/phase5-test-fixture.xlsx", mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", original_filename: "fixture.xlsx", file_size: 51200 };
    const audioSource = { file_url: "https://files.base44.com/phase5-test-fixture.m4a", mime_type: "audio/m4a", original_filename: "fixture.m4a", file_size: 2048000 };
    const textSource = { text: "TEST FIXTURE: 备忘 - TEST_FIXTURE_C 来电咨询镜片库存。" };

    const imageTest = await runModalityTest("image", "image", imageSource, { department: "optometry" });
    const docTest = await runModalityTest("document", "document", docSource, { department: "reception" });
    const audioTest = await runModalityTest("audio", "audio", audioSource, { department: "optometry" });
    const textTest = await runModalityTest("text", "text", textSource, { department: "reception" });

    const idempotencyTest = await runIdempotencyTest(imageSource);
    const conflictTest = await runConflictTest(imageSource);
    const tenantTest = await runTenantViolationTest(imageSource);
    const mimeTest = await runUnsupportedMimeTest();
    const urlTest = await runExternalUrlTest();

    const alignedIds = [
      imageTest.response.artifact?.id,
      docTest.response.artifact?.id,
      audioTest.response.artifact?.id,
      textTest.response.artifact?.id,
    ].filter(Boolean);

    const dispatchTest = await runDispatchBridgeTest(alignedIds);

    for (const name of ["CompositionRun", "WorkflowHypothesis", "Workflow", "WorkflowSnapshot", "WorkflowCommitIntent", "ManagerDecision"]) {
      assert(await filterCount(name, { clinic_id: clinicId }) === 0, `${name}_must_not_be_created_by_ingestion`);
    }

    summary.tests = {
      image: { status: imageTest.response.processing?.status, artifact_id: imageTest.response.artifact?.id },
      document: { status: docTest.response.processing?.status, artifact_id: docTest.response.artifact?.id },
      audio: { status: audioTest.response.processing?.status, artifact_id: audioTest.response.artifact?.id },
      text: { status: textTest.response.processing?.status, artifact_id: textTest.response.artifact?.id },
    };
    summary.idempotency = { artifact_count: idempotencyTest.count, idempotent_flag: idempotencyTest.second.idempotent };
    summary.conflict = { http_status: conflictTest.second.http_status };
    summary.tenant_violation = { http_status: tenantTest.http_status };
    summary.unsupported_mime = { http_status: mimeTest.http_status, error_code: mimeTest.error_code };
    summary.external_url = { http_status: urlTest.http_status, error_code: urlTest.error_code };
    summary.dispatch = {
      fact_card_count: dispatchTest.fact_card_ids.length,
      blocked_count: (dispatchTest.blocked_artifact_ids || []).length,
      dispatched: dispatchTest.dispatched,
    };

    // Entity counts before cleanup
    summary.counts_before = {};
    for (const name of cleanupOrder) {
      summary.counts_before[name] = await filterCount(name, { clinic_id: clinicId });
    }
  } catch (err) {
    summary.error = err?.message || String(err);
  } finally {
    summary.clinic_001_check = await verifyClinic001Untouched();
    summary.cleanup = await cleanupExactIds();
    summary.finished_at = nowIso();
    console.log(JSON.stringify(summary, null, 2));
  }
}

await main();
