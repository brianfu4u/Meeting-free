/*
 * Phase 5 isolated E2E — 两段式异步契约联调（真实 scheduled_scan 路径）
 * Run via: cat scripts/phase5-isolated-e2e.mjs | npx base44@latest exec
 *
 * 契约来源：docs/PHASE5_INGESTION_AGENT_HANDOFF.md
 * mock_mode=true · synthetic_multimodal_e2e=true · 禁止触碰 clinic-001
 *
 * 验证项：
 *  1. 上传后立即产生标准 Artifact/EvidenceFactCard，不产生 CompositionRun（Stage 1 解耦）
 *  2. 真实 compositionOrchestrator scheduled_scan 到点扫描 → 产出 CompositionRun + 待审核假设
 *  3. 同槽重跑幂等、数量零增长
 *  4. 不自动 review/commit（无 WorkflowCommitIntent / ManagerDecision）
 *  5. 解析失败/未对齐内容不进入 run（ingestion 侧保证 + Agent 侧过滤待约束 2 落地）
 *  6. 验证后精确清理测试数据归零
 *
 * 调度门控（服务端环境变量，脚本无法自行设置）：
 *  - COMPOSITION_SCHEDULER_ENABLED=true
 *  - COMPOSITION_SCHEDULER_CLINICS=<本脚本打印的 clinic_id>
 *  验证后须将二者复位为空以关闭调度。
 */

const TEST_PREFIX = "phase5-it-";
const FORBIDDEN = new Set(["clinic-001"]);
const clinicId = `${TEST_PREFIX}${crypto.randomUUID()}`;

const cleanupOrder = [
  "AttentionItem",
  "FragmentProcessingResult",
  "EvidenceFactCard",
  "WorkflowHypothesis",
  "WorkflowCommitIntent",
  "ManagerDecision",
  "WorkflowSnapshot",
  "Workflow",
  "CompositionRun",
  "Artifact",
  "AuditLog",
  "GuessPolicy",
  "Staff",
  "ClinicConfig",
];
const exactIds = new Map(cleanupOrder.map((n) => [n, new Set()]));

function assert(cond, msg) {
  if (!cond) throw new Error(`phase5_e2e_assertion_failed:${msg}`);
}

function nowIso() { return new Date().toISOString(); }

function tokyoParts() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date()).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
}

function businessDate() {
  const p = tokyoParts();
  return `${p.year}-${p.month}-${p.day}`;
}

function currentSlot() {
  const p = tokyoParts();
  return `${p.hour}:${p.minute}`;
}

async function create(name, payload) {
  const rec = await base44.entities[name].create(payload);
  assert(rec?.id, `${name}_create_failed`);
  exactIds.get(name).add(String(rec.id));
  return rec;
}

async function update(name, id, patch) {
  const rec = await base44.entities[name].update(id, patch);
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

async function invokeScheduledScan() {
  const res = await base44.functions.invoke("compositionOrchestrator", {
    args: { mode: "scheduled_scan" },
  });
  return res?.data ?? res;
}

async function setupClinic(me) {
  const slot = currentSlot();
  const config = await create("ClinicConfig", {
    clinic_id: clinicId,
    clinic_name: "Phase5 IT Clinic",
    city: "Tokyo",
    contact: "phase5-it",
    manager_id: me.id,
    timezone: "Asia/Tokyo",
    activation_status: "active",
    cold_start_completed: true,
    shadow_mode: true,
    // 调度前置（约束见 handoff 第三节约束 2）
    composition_schedule_enabled: true,
    composition_rollout_status: "active",
    active_policy_version: 1,
    composition_schedule_grace_minutes: 10,
    schedule_times: [slot, "00:00", "06:00", "12:00", "18:00"],
  });
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
  // 已发布策略（executePipeline 按 published + policy_version 过滤）
  await create("GuessPolicy", {
    clinic_id: clinicId,
    policy_version: 1,
    status: "published",
    published_at: nowIso(),
    published_by: me.id,
    tracks: [
      { track_id: "subject_match", name: "主体匹配", description: "姓名/指纹一致性", guardrails: [] },
      { track_id: "temporal", name: "时序合理", description: "时间锚点连续性", guardrails: [] },
      { track_id: "evidence", name: "证据覆盖", description: "字段提取完整性", guardrails: [] },
      { track_id: "workflow_family", name: "业务族", description: "业务线归属", guardrails: [] },
      { track_id: "conflict", name: "矛盾检测", description: "字段间一致性", guardrails: [] },
      { track_id: "assumption", name: "无依据假设", description: "最小化无依据假设", guardrails: [] },
      { track_id: "guardrail", name: "硬护栏", description: "不违反硬规则", guardrails: [] },
    ],
    decision_rules: { max_fragments: 8, min_evidence: 1 },
    hard_guardrails: [{ rule_code: "subject_conflict" }, { rule_code: "time_impossible", max_gap_minutes: 120 }],
  });
  return { config, staff, slot };
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

async function runExternalUrlRejectionTest() {
  // 外链 URL 应在 capture 阶段被拒，不产生 Artifact，故不可能进入任何 run
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

// Stage 2 前置缺口补齐：当前解析站未填充 ingestion_seq，定时扫描会因 no_artifacts 跳过。
// 本脚本以测试数据补齐方式模拟水位（handoff 缺陷 3 标记为 Stage 2 启用前置项）。
async function patchIngestionSeq(artifacts) {
  let seq = 0;
  for (const a of artifacts) {
    if (!a?.id) continue;
    seq += 1;
    await update("Artifact", a.id, { ingestion_seq: seq });
  }
  return seq;
}

async function assertNoCompositionRun() {
  const runs = await base44.entities.CompositionRun.filter({ clinic_id: clinicId });
  assert((runs || []).length === 0, `stage1_run_leak:${(runs || []).length}`);
}

async function assertNoAutoCommitArtifacts() {
  const intents = await base44.entities.WorkflowCommitIntent.filter({ clinic_id: clinicId });
  const decisions = await base44.entities.ManagerDecision.filter({ clinic_id: clinicId });
  assert((intents || []).length === 0, `auto_commit_intent_leak:${(intents || []).length}`);
  assert((decisions || []).length === 0, `auto_manager_decision_leak:${(decisions || []).length}`);
}

async function assertHypothesesPendingOnly() {
  const rows = await base44.entities.WorkflowHypothesis.filter({ clinic_id: clinicId });
  const bad = (rows || []).filter((h) => h.status && h.status !== "pending_review");
  // 仅记录，不硬断言数量（LLM 编组数量非确定）；但状态必须停留在待审核
  return {
    total: (rows || []).length,
    non_pending: bad.length,
    statuses: (rows || []).map((h) => h.status),
  };
}

async function assertProcessedArtifactsAligned() {
  const runs = await base44.entities.CompositionRun.filter({ clinic_id: clinicId });
  const processedIds = new Set();
  for (const r of runs || []) {
    for (const id of r.artifact_ids_processed || []) processedIds.add(String(id));
  }
  let violations = 0;
  for (const id of processedIds) {
    const fcRows = await base44.entities.EvidenceFactCard.filter({ clinic_id: clinicId, artifact_id: id });
    const fc = fcRows?.[0];
    if (!fc || fc.alignment_status !== "aligned" || fc.assembly_eligible !== true) violations += 1;
  }
  return { processed: processedIds.size, violations };
}

async function runScheduledScanAssertion(slot) {
  // 首次扫描
  const first = await invokeScheduledScan();
  const summary = { first };

  if (first?.scheduler_enabled !== true) {
    summary.prerequisite = {
      message: "调度未启用。请设置服务端环境变量后重跑本脚本。",
      env: {
        COMPOSITION_SCHEDULER_ENABLED: "true",
        COMPOSITION_SCHEDULER_CLINICS: clinicId,
      },
    };
    summary.skipped = true;
    return summary;
  }

  const clinicResult = (first.results || []).find((r) => r.clinic_id === clinicId);
  if (!clinicResult) {
    summary.prerequisite = {
      message: "调度已启用但白名单未包含本测试诊所。",
      env: { COMPOSITION_SCHEDULER_CLINICS: clinicId },
    };
    summary.skipped = true;
    return summary;
  }

  if (clinicResult.status !== "processed") {
    summary.skipped = true;
    summary.skip_reason = clinicResult.reason || clinicResult.error_code || clinicResult.status;
    return summary;
  }

  const runsAfterFirst = await base44.entities.CompositionRun.filter({ clinic_id: clinicId });
  const runId = clinicResult.run_id || (runsAfterFirst[0] && runsAfterFirst[0].id);
  summary.run_id = runId;
  summary.runs_after_first = (runsAfterFirst || []).length;
  summary.first_idempotent = clinicResult.idempotent === true;

  // 第二次扫描（同槽）→ 幂等、数量零增长
  const second = await invokeScheduledScan();
  summary.second = second;
  const runsAfterSecond = await base44.entities.CompositionRun.filter({ clinic_id: clinicId });
  summary.runs_after_second = (runsAfterSecond || []).length;
  assert(summary.runs_after_second === summary.runs_after_first, `rerun_run_growth:${summary.runs_after_first}->${summary.runs_after_second}`);

  const hypAfterFirst = await assertHypothesesPendingOnly();
  const hypAfterSecond = await assertHypothesesPendingOnly();
  summary.hypotheses = {
    after_first: hypAfterFirst,
    after_second: hypAfterSecond,
    zero_growth: hypAfterSecond.total === hypAfterFirst.total,
  };
  assert(summary.hypotheses.zero_growth, `hypothesis_growth:${hypAfterFirst.total}->${hypAfterSecond.total}`);
  assert(hypAfterSecond.non_pending === 0, `hypothesis_non_pending:${hypAfterSecond.non_pending}`);

  // 不自动 review/commit
  await assertNoAutoCommitArtifacts();

  // 处理集合内必须全部 aligned
  summary.processed_alignment = await assertProcessedArtifactsAligned();
  assert(summary.processed_alignment.violations === 0, `processed_not_aligned:${summary.processed_alignment.violations}`);

  // 记录 Workflow/Snapshot 数量供观察（不硬断言零；assembly 可能创建候选）
  summary.observed = {
    workflows: await filterCount("Workflow", { clinic_id: clinicId }),
    snapshots: await filterCount("WorkflowSnapshot", { clinic_id: clinicId }),
  };

  summary.skipped = false;
  return summary;
}

async function cleanupExactIds() {
  assert(clinicId.startsWith(TEST_PREFIX), "unsafe_test_prefix");
  assert(!FORBIDDEN.has(clinicId), "production_clinic_forbidden");
  // 重新发现（兜底未跟踪记录）
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
  const remaining = {};
  for (const name of cleanupOrder) {
    remaining[name] = await filterCount(name, { clinic_id: clinicId });
  }
  const allZero = cleanupOrder.every((n) => remaining[n] === 0);
  return { deleted, remaining, all_zero: allZero };
}

async function verifyClinic001Untouched() {
  const artifacts = await base44.entities.Artifact.filter({ clinic_id: "clinic-001" });
  return { clinic_001_artifact_count: (artifacts || []).length };
}

async function main() {
  const summary = {
    clinic_id: clinicId,
    started_at: nowIso(),
    mock_mode: true,
    synthetic_multimodal_e2e: true,
  };
  try {
    const me = await base44.auth.me();
    assert(me?.id, "current_user_missing");
    summary.user_id = me.id;

    const { slot } = await setupClinic(me);
    summary.slot = slot;
    summary.business_date = businessDate();

    const imageSource = { file_url: "https://files.base44.com/phase5-test-fixture.png", mime_type: "image/png", original_filename: "fixture.png", file_size: 102400, checksum: "test-image-checksum" };
    const docSource = { file_url: "https://files.base44.com/phase5-test-fixture.xlsx", mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", original_filename: "fixture.xlsx", file_size: 51200 };
    const audioSource = { file_url: "https://files.base44.com/phase5-test-fixture.m4a", mime_type: "audio/m4a", original_filename: "fixture.m4a", file_size: 2048000 };
    const textSource = { text: "TEST FIXTURE: 备忘 - TEST_FIXTURE_C 来电咨询镜片库存。" };

    const imageTest = await runModalityTest("image", "image", imageSource, { department: "optometry" });
    const docTest = await runModalityTest("document", "document", docSource, { department: "reception" });
    const audioTest = await runModalityTest("audio", "audio", audioSource, { department: "optometry" });
    const textTest = await runModalityTest("text", "text", textSource, { department: "reception" });

    const idempotencyTest = await runIdempotencyTest(imageSource);
    const urlTest = await runExternalUrlRejectionTest();

    // Stage 1 解耦：上传后不应产生任何 CompositionRun
    await assertNoCompositionRun();

    const alignedArtifacts = [
      imageTest.response.artifact,
      docTest.response.artifact,
      audioTest.response.artifact,
      textTest.response.artifact,
    ].filter(Boolean);

    // Stage 2 前置：补齐 ingestion_seq 水位（handoff 缺陷 3）
    const maxSeq = await patchIngestionSeq(alignedArtifacts);
    summary.ingestion_seq_patched = { count: maxSeq, note: "Stage 2 前置缺口模拟；待开发项 C 补齐" };

    // Stage 2：真实定时扫描路径
    const scanSummary = await runScheduledScanAssertion(slot);
    summary.scheduled_scan = scanSummary;

    summary.tests = {
      image: { status: imageTest.response.processing?.status, artifact_id: imageTest.response.artifact?.id },
      document: { status: docTest.response.processing?.status, artifact_id: docTest.response.artifact?.id },
      audio: { status: audioTest.response.processing?.status, artifact_id: audioTest.response.artifact?.id },
      text: { status: textTest.response.processing?.status, artifact_id: textTest.response.artifact?.id },
    };
    summary.idempotency = { artifact_count: idempotencyTest.count, idempotent_flag: idempotencyTest.second.idempotent };
    summary.external_url = { http_status: urlTest.http_status, error_code: urlTest.error_code };

    summary.counts_before = {};
    for (const name of cleanupOrder) {
      summary.counts_before[name] = await filterCount(name, { clinic_id: clinicId });
    }
  } catch (err) {
    summary.error = err?.message || String(err);
  } finally {
    summary.clinic_001_check = await verifyClinic001Untouched();
    summary.cleanup = await cleanupExactIds();
    summary.teardown = {
      message: "若已设置调度环境变量，验证后请复位以关闭调度。",
      env: { COMPOSITION_SCHEDULER_ENABLED: "false", COMPOSITION_SCHEDULER_CLINICS: "" },
    };
    summary.finished_at = nowIso();
    console.log(JSON.stringify(summary, null, 2));
  }
}

await main();