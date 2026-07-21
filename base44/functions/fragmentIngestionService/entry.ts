// FragmentIngestionService Entry — Clinic OS Phase 5
// Multimodal ingestion: image / document / audio / text → Artifact → Adapter → Alignment → EvidenceFactCard.
// Does NOT modify Phase 1–4 composition rules. Does NOT auto-call review/commit.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.38";
import {
  ACTIONS,
  ADAPTER_VERSION,
  ALIGNMENT_VERSION,
  DEFAULT_UPLOAD_DOMAINS,
  MAX_RETRY_ATTEMPTS,
  PROCESSING_STATUS,
  ALIGNMENT_STATUS,
  ATTENTION_TYPE_EVIDENCE_MISSING,
  computeIngestionKey,
  isTestClinic,
  makeResponse,
  mapFragmentTypeToArtifactType,
  sanitizeErrorCode,
} from "./contract.ts";
import {
  assertTenantScope,
  isNonEmptyString,
  sanitizeFilename,
  validateClientRequestId,
  validateFilename,
  validateFileSize,
  validateFragmentType,
  validateMimeType,
  validateTextContent,
  validateUploadUrl,
} from "./security.ts";
import { runAdapter } from "./adapters.ts";
import { alignExtraction, evaluateAlignment } from "./alignment.ts";
import { reconstruct } from "../../shared/semanticReconstructionSkill.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json(makeResponse(405, { error_code: "method_not_allowed" }), { status: 405 });
  }
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    return Response.json(await handleRequest(base44, body), { status: 200 });
  } catch {
    return Response.json(
      makeResponse(500, { error_code: "internal_error" }),
      { status: 500 }
    );
  }
});

async function handleRequest(base44, body) {
  const action = body?.action;
  if (!ACTIONS.has(action)) return makeResponse(400, { error_code: "action_invalid" });

  const user = await base44.auth.me();
  if (!user) return makeResponse(401, { error_code: "unauthenticated" });

  const actor = await resolveActor(base44, user, body.clinic_id);
  if (!actor) return makeResponse(403, { error_code: "tenant_scope_violation" });

  if (action === "captureFragment") return captureFragment(base44, body, actor);
  if (action === "getFragmentStatus") return getFragmentStatus(base44, body, actor);
  if (action === "listFragments") return listFragments(base44, body, actor);
  if (action === "retryFragment") return retryFragment(base44, body, actor);
  if (action === "processFragment") return makeResponse(403, { error_code: "action_not_allowed" });
  if (action === "dispatchToComposition") return dispatchToComposition(base44, body, actor);
  return makeResponse(400, { error_code: "action_invalid" });
}

async function resolveActor(base44, user, requestedClinicId) {
  if (!isNonEmptyString(requestedClinicId)) return null;
  const svc = base44.asServiceRole;
  const staffRows = await svc.entities.Staff.filter({ user_id: user.id });
  const staff = (staffRows || []).find((s) =>
    s && s.clinic_id === requestedClinicId && s.status !== "off_duty"
  );
  if (!staff) {
    if (user.role === "admin") {
      const configs = await svc.entities.ClinicConfig.filter({ clinic_id: requestedClinicId });
      const config = configs?.[0];
      if (config && config.manager_id === user.id) {
        return { user_id: user.id, clinic_id: requestedClinicId, staff_id: user.id, role: "admin" };
      }
    }
    return null;
  }
  return {
    user_id: user.id,
    clinic_id: requestedClinicId,
    staff_id: staff.id,
    role: "admin",
  };
}

function buildDeps(base44) {
  const svc = base44.asServiceRole;
  const mock = readMockFlag();
  return {
    mock,
    invokeLLM: (input) => svc.integrations.Core.InvokeLLM({ ...input, model: input.model || "automatic" }),
    transcribeAudio: (input) => svc.integrations.Core.TranscribeAudio(input),
    extractDataFromFile: (input) => svc.integrations.Core.ExtractDataFromUploadedFile(input),
    uploadDomains: readUploadDomains(),
  };
}

function readMockFlag() {
  const v = (typeof Deno !== "undefined" ? Deno.env.get("FRAGMENT_INGESTION_MOCK") : undefined);
  if (v == null) return true;
  return v === "true" || v === "1";
}

function readUploadDomains() {
  const v = (typeof Deno !== "undefined" ? Deno.env.get("BASE44_UPLOAD_DOMAIN") : undefined);
  if (isNonEmptyString(v)) return v.split(",").map((d) => d.trim()).filter(Boolean);
  return DEFAULT_UPLOAD_DOMAINS;
}

async function captureFragment(base44, body, actor) {
  const ft = validateFragmentType(body.fragment_type);
  if (!ft.ok) return makeResponse(400, { error_code: ft.reason });
  const cr = validateClientRequestId(body.client_request_id);
  if (!cr.ok) return makeResponse(400, { error_code: cr.reason });
  if (!body.source || typeof body.source !== "object") {
    return makeResponse(400, { error_code: "source_required" });
  }

  const fragmentType = body.fragment_type;
  const ingestionKey = computeIngestionKey(actor.clinic_id, body.client_request_id);

  const existing = await findExisting(base44, actor.clinic_id, ingestionKey, fragmentType, body.source.checksum);
  if (existing.conflict) {
    return makeResponse(409, { error_code: "idempotency_conflict" });
  }
  if (existing.artifact) {
    return makeResponse(200, await buildCaptureResponse(base44, existing.artifact, true));
  }

  const validation = validateSource(base44, fragmentType, body.source, actor);
  if (validation.error) return validation.error;

  const now = new Date().toISOString();
  const capturedAt = isNonEmptyString(body.captured_at) ? body.captured_at : now;
  const businessDate = computeBusinessDate(capturedAt, actor.clinic_id);
  const artifactDescriptor = {
    clinic_id: actor.clinic_id,
    artifact_type: mapFragmentTypeToArtifactType(fragmentType),
    fragment_type: fragmentType,
    file_url: body.source.file_url || "",
    source_staff_id: actor.staff_id,
    source_session_id: body.context?.patient_session_id || null,
    source_region: body.context?.department || null,
    business_date: businessDate,
    captured_at: capturedAt,
    interpreted: false,
    client_request_id: body.client_request_id,
    ingestion_key: ingestionKey,
    mime_type: body.source.mime_type || null,
    original_filename: sanitizeFilename(body.source.original_filename),
    file_size: body.source.file_size ?? null,
    checksum: body.source.checksum || null,
    received_at: now,
    source_channel: body.context?.device_id ? "staff_pad" : "web",
    original_metadata: sanitizeContextMetadata(body.context, body.source, fragmentType),
    adapter_name: fragmentType,
    adapter_version: ADAPTER_VERSION,
  };

  const artifact = await base44.asServiceRole.entities.Artifact.create(artifactDescriptor);

  // Post-create dedup against concurrent requests sharing ingestion_key.
  const dedup = await findExisting(base44, actor.clinic_id, ingestionKey);
  if (dedup.artifact && dedup.artifact.id !== artifact.id) {
    await safeDelete(base44, "Artifact", artifact.id);
    await safeDeleteProcessingByArtifact(base44, actor.clinic_id, artifact.id);
    return makeResponse(200, await buildCaptureResponse(base44, dedup.artifact, true));
  }
  if (dedup.conflict) {
    await safeDelete(base44, "Artifact", artifact.id);
    return makeResponse(409, { error_code: "idempotency_conflict" });
  }

  const processing = await base44.asServiceRole.entities.FragmentProcessingResult.create({
    clinic_id: actor.clinic_id,
    artifact_id: artifact.id,
    client_request_id: body.client_request_id,
    ingestion_key: ingestionKey,
    fragment_type: fragmentType,
    adapter_name: fragmentType,
    adapter_version: ADAPTER_VERSION,
    status: PROCESSING_STATUS.pending,
    attempt_count: 1,
    started_at: now,
  });

  const deps = buildDeps(base44);
  const result = await processFragment(base44, artifact, processing, deps);
  return makeResponse(201, await buildCaptureResponse(base44, result.artifact, false, result.processing));
}

async function findExisting(base44, clinicId, ingestionKey, newFragmentType, newChecksum) {
  const rows = await base44.asServiceRole.entities.Artifact.filter({
    clinic_id: clinicId,
    ingestion_key: ingestionKey,
  });
  if (!rows || rows.length === 0) return { artifact: null };
  const sorted = rows.slice().sort((a, b) =>
    String(a.created_date || a.id).localeCompare(String(b.created_date || b.id))
  );
  const earliest = sorted[0];
  // Conflict: new request's fragment_type/checksum diverges from the stored artifact.
  const conflictVsNew =
    (isNonEmptyString(newFragmentType) && earliest.fragment_type && newFragmentType !== earliest.fragment_type) ||
    (isNonEmptyString(newChecksum) && earliest.checksum && newChecksum !== earliest.checksum);
  // Divergence among multiple stored rows (race-condition dedup).
  const divergent = sorted.some((r) =>
    r.fragment_type !== earliest.fragment_type ||
    (r.checksum && earliest.checksum && r.checksum !== earliest.checksum)
  );
  if (conflictVsNew || divergent) return { artifact: earliest, conflict: true };
  return { artifact: earliest };
}

function validateSource(base44, fragmentType, source, actor) {
  const deps = buildDeps(base44);
  if (fragmentType === "text") {
    const text = validateTextContent(source.text);
    if (!text.ok) return { error: makeResponse(400, { error_code: text.reason }) };
    return { text: text.normalized };
  }
  const url = validateUploadUrl(source.file_url, deps.uploadDomains);
  if (!url.ok) return { error: makeResponse(400, { error_code: url.reason }) };
  const mime = validateMimeType(fragmentType, source.mime_type);
  if (!mime.ok) return { error: makeResponse(400, { error_code: mime.reason }) };
  const fname = validateFilename(source.original_filename);
  if (!fname.ok) return { error: makeResponse(400, { error_code: fname.reason }) };
  const size = validateFileSize(fragmentType, source.file_size);
  if (!size.ok) return { error: makeResponse(400, { error_code: size.reason }) };
  return {};
}

function sanitizeContextMetadata(context, source, fragmentType) {
  const ctx = context || {};
  const meta = {
    device_id: typeof ctx.device_id === "string" ? ctx.device_id.slice(0, 128) : null,
    location_id: typeof ctx.location_id === "string" ? ctx.location_id.slice(0, 128) : null,
    patient_session_id_hint: typeof ctx.patient_session_id === "string" ? ctx.patient_session_id.slice(0, 128) : null,
    department: typeof ctx.department === "string" ? ctx.department.slice(0, 64) : null,
    language_hint: typeof ctx.language_hint === "string" ? ctx.language_hint.slice(0, 16) : null,
    fragment_type: fragmentType,
  };
  if (fragmentType === "text" && typeof source.text === "string") {
    meta.client_text = source.text.slice(0, 8000);
  }
  // modal-v2: 透传弹窗人工标签，供 Agent 编组层读取提升火车编组准确度
  if (ctx.user_interactive_meta && typeof ctx.user_interactive_meta === "object") {
    meta.user_interactive_meta = sanitizeUserInteractiveMeta(ctx.user_interactive_meta);
  }
  return meta;
}

function sanitizeUserInteractiveMeta(m) {
  return {
    schema_version: typeof m.schema_version === "string" ? m.schema_version.slice(0, 32) : null,
    role_id: typeof m.role_id === "string" ? m.role_id.slice(0, 64) : null,
    dept_id: typeof m.dept_id === "string" ? m.dept_id.slice(0, 64) : null,
    category_id: typeof m.category_id === "string" ? m.category_id.slice(0, 64) : null,
    category_label: typeof m.category_label === "string" ? m.category_label.slice(0, 64) : null,
    is_manual_tag: m.is_manual_tag === true,
    note: typeof m.note === "string" ? m.note.slice(0, 2000) : null,
    captured_at: typeof m.captured_at === "string" ? m.captured_at.slice(0, 32) : null,
    capture_latency_ms: Number.isFinite(Number(m.capture_latency_ms)) ? Number(m.capture_latency_ms) : null,
    was_prefill: m.was_prefill === true,
    source: typeof m.source === "string" ? m.source.slice(0, 32) : null,
  };
}

async function processFragment(base44, artifact, processing, deps) {
  try {
    await base44.asServiceRole.entities.FragmentProcessingResult.update(processing.id, {
      status: PROCESSING_STATUS.processing,
    });
    const extraction = await runAdapter({ artifact, deps });
    const aligned = await alignExtraction({ artifact, extraction, deps });
    const gate = evaluateAlignment(aligned);

    // V11 解析站 Skill：语义重构 → 双通道 Payload（走马灯 + Agent）
    const skillResult = reconstruct({ artifact, aligned: { ...aligned, alignment_status: gate.status }, extraction });

    const factCardIds = [];
    let factCardId = null;
    if (gate.status === ALIGNMENT_STATUS.aligned) {
      const factCard = await createFactCard(base44, artifact, aligned, processing, extraction, deps, skillResult);
      factCardId = factCard.id;
      factCardIds.push(factCard.id);
      await base44.asServiceRole.entities.Artifact.update(artifact.id, {
        interpreted: true,
        evidence_fact_card_id: factCard.id,
      });
    } else if (gate.status === ALIGNMENT_STATUS.needs_clarification) {
      await ensureClarificationAttention(base44, artifact, processing, gate.issues);
    }

    const completedAt = new Date().toISOString();
    await base44.asServiceRole.entities.FragmentProcessingResult.update(processing.id, {
      status: gate.status,
      extracted_text: (extraction.normalized_text || "").slice(0, 4000),
      transcript: extraction.transcript ? String(extraction.transcript).slice(0, 4000) : null,
      language: extraction.language || null,
      duration_ms: extraction.duration_ms ?? null,
      evidence_spans: extraction.evidence_spans || [],
      parser_warnings: extraction.warnings || [],
      quality_issues: gate.issues || [],
      fact_card_ids: factCardIds,
      assembly_eligible: gate.assembly_eligible,
      completed_at: completedAt,
    });

    const updatedArtifact = await base44.asServiceRole.entities.Artifact.get(artifact.id);
    const updatedProcessing = await base44.asServiceRole.entities.FragmentProcessingResult.get(processing.id);
    return { artifact: updatedArtifact, processing: updatedProcessing };
  } catch (err) {
    const code = sanitizeErrorCode(err?.code || "adapter_failed");
    await base44.asServiceRole.entities.FragmentProcessingResult.update(processing.id, {
      status: PROCESSING_STATUS.failed,
      error_code: code,
      completed_at: new Date().toISOString(),
    }).catch(() => undefined);
    const updatedArtifact = await base44.asServiceRole.entities.Artifact.get(artifact.id);
    const updatedProcessing = await base44.asServiceRole.entities.FragmentProcessingResult.get(processing.id);
    return { artifact: updatedArtifact, processing: updatedProcessing };
  }
}

async function createFactCard(base44, artifact, aligned, processing, extraction, deps, skillResult) {
  const marqueeLabel = skillResult?.marquee_payload?.label || null;
  const marqueeUrgency = skillResult?.marquee_payload?.urgency || null;
  const descriptor = {
    clinic_id: artifact.clinic_id,
    artifact_id: artifact.id,
    marquee_label: marqueeLabel,
    marquee_urgency: marqueeUrgency,
    fields: aligned.fields.map((f) => ({
      field_name: f.field_name,
      value: f.value,
      source_artifact_id: artifact.id,
      source_region: extraction.evidence_spans?.[0]?.region || null,
      source_quote: f.source_quote,
      extraction_quality: f.extraction_quality,
      extraction_method: f.extraction_method,
    })),
    business_date: artifact.business_date,
    extracted_at: new Date().toISOString(),
    model_version: deps?.mock ? "mock" : "automatic",
    prompt_version: aligned.prompt_version,
    stale: false,
    explicit_workflow_id: artifact.source_workflow_id || null,
    workflow_family_hint: aligned.workflow_family_hint,
    subject_type: aligned.subject_type,
    subject_fingerprint: aligned.subject_fingerprint,
    subject_quality: aligned.subject_quality,
    occurred_at: aligned.occurred_at,
    confidence: aligned.confidence,
    evidence_spans: aligned.evidence_spans,
    contradictions: aligned.contradictions,
    unsupported_assumptions: aligned.unsupported_assumptions,
    interpreter_version: aligned.interpreter_version,
    time_uncertain: aligned.time_uncertain,
    alignment_status: ALIGNMENT_STATUS.aligned,
    assembly_eligible: true,
    processing_result_id: processing.id,
  };
  return base44.asServiceRole.entities.EvidenceFactCard.create(descriptor);
}

async function ensureClarificationAttention(base44, artifact, processing, issues) {
  const existing = await base44.asServiceRole.entities.AttentionItem.filter({
    clinic_id: artifact.clinic_id,
    attention_type: ATTENTION_TYPE_EVIDENCE_MISSING,
    status: "open",
    artifact_ids: { $in: [artifact.id] },
  });
  if (existing && existing.length > 0) return existing[0];
  return base44.asServiceRole.entities.AttentionItem.create({
    clinic_id: artifact.clinic_id,
    attention_type: ATTENTION_TYPE_EVIDENCE_MISSING,
    urgency: "yellow",
    title: "证据需要补充",
    reasoning: `Fragment ${artifact.fragment_type} 需要人工补充。质量门槛告警: ${(issues || []).join(", ")}`,
    recommendation: "请补充原始证据或手动录入结构化字段。",
    status: "open",
    generated_at: new Date().toISOString(),
    artifact_ids: [artifact.id],
    evidence_fact_card_ids: [],
    audit_event_ids: [],
    source_proposal_id: `phase5-clarify::${artifact.id}`,
    shadow_mode_snapshot: true,
  });
}

async function buildCaptureResponse(base44, artifact, idempotent, processingArg) {
  const processing = processingArg || await findProcessing(base44, artifact.clinic_id, artifact.id);
  // V11 双通道：从 FactCard 取出走马灯与 Agent 编组 Payload
  let marquee = null;
  let agentHandoff = null;
  if (processing && processing.status === PROCESSING_STATUS.aligned) {
    for (const fcId of processing.fact_card_ids || []) {
      const fc = await base44.asServiceRole.entities.EvidenceFactCard.get(fcId).catch(() => null);
      if (!fc || fc.clinic_id !== artifact.clinic_id) continue;
      marquee = fc.marquee_label ? {
        label: fc.marquee_label,
        urgency: fc.marquee_urgency || "green",
        fact_card_id: fc.id,
        timestamp: fc.occurred_at || artifact.captured_at || null,
      } : null;
      agentHandoff = {
        fact_card_id: fc.id,
        assembly_eligible: fc.assembly_eligible === true,
        workflow_family_hint: fc.workflow_family_hint || null,
        subject_type: fc.subject_type || "unknown",
        occurred_at: fc.occurred_at || null,
      };
      break;
    }
  }
  return {
    idempotent,
    artifact: {
      id: artifact.id,
      clinic_id: artifact.clinic_id,
      fragment_type: artifact.fragment_type,
      artifact_type: artifact.artifact_type,
    },
    processing: processing ? {
      id: processing.id,
      status: processing.status,
      adapter: processing.adapter_name,
      adapter_version: processing.adapter_version,
      retryable: isRetryable(processing),
    } : null,
    alignment: processing ? {
      status: processing.status === PROCESSING_STATUS.aligned ? ALIGNMENT_STATUS.aligned : processing.status,
      fact_card_ids: processing.fact_card_ids || [],
      assembly_eligible: processing.assembly_eligible === true,
      quality_issues: processing.quality_issues || [],
    } : null,
    // V11 解析站双通道输出
    marquee,
    agent_handoff: agentHandoff,
  };
}

function isRetryable(processing) {
  if (!processing) return false;
  if (processing.status === PROCESSING_STATUS.failed) return true;
  if (processing.status === PROCESSING_STATUS.needs_clarification) return false;
  return false;
}

async function findProcessing(base44, clinicId, artifactId) {
  const rows = await base44.asServiceRole.entities.FragmentProcessingResult.filter({
    clinic_id: clinicId,
    artifact_id: artifactId,
  });
  if (!rows || rows.length === 0) return null;
  return rows.slice().sort((a, b) =>
    String(a.created_date || a.id).localeCompare(String(b.created_date || b.id))
  )[0];
}

async function getFragmentStatus(base44, body, actor) {
  if (!isNonEmptyString(body.artifact_id) && !isNonEmptyString(body.client_request_id)) {
    return makeResponse(400, { error_code: "artifact_not_found" });
  }
  let artifact = null;
  if (isNonEmptyString(body.artifact_id)) {
    artifact = await base44.asServiceRole.entities.Artifact.get(body.artifact_id).catch(() => null);
    if (artifact && !assertTenantScope(actor.clinic_id, artifact)) {
      return makeResponse(403, { error_code: "tenant_scope_violation" });
    }
  }
  if (!artifact && isNonEmptyString(body.client_request_id)) {
    const ingestionKey = computeIngestionKey(actor.clinic_id, body.client_request_id);
    const rows = await base44.asServiceRole.entities.Artifact.filter({
      clinic_id: actor.clinic_id,
      ingestion_key: ingestionKey,
    });
    artifact = rows?.[0] || null;
  }
  if (!artifact) return makeResponse(404, { error_code: "artifact_not_found" });
  return makeResponse(200, await buildCaptureResponse(base44, artifact, true));
}

async function listFragments(base44, body, actor) {
  const limit = Math.min(Math.max(Number(body.limit) || 20, 1), 100);
  const query = { clinic_id: actor.clinic_id };
  if (isNonEmptyString(body.fragment_type)) query.fragment_type = body.fragment_type;
  if (isNonEmptyString(body.status)) {
    query.status = body.status;
    const rows = await base44.asServiceRole.entities.FragmentProcessingResult.filter(query);
    return makeResponse(200, { fragments: (rows || []).slice(0, limit), limit });
  }
  const rows = await base44.asServiceRole.entities.Artifact.filter(query);
  const fragments = (rows || []).slice(0, limit).map((a) => ({
    artifact_id: a.id,
    fragment_type: a.fragment_type,
    captured_at: a.captured_at,
    received_at: a.received_at,
  }));
  return makeResponse(200, { fragments, limit });
}

async function retryFragment(base44, body, actor) {
  if (!isNonEmptyString(body.artifact_id)) {
    return makeResponse(400, { error_code: "artifact_not_found" });
  }
  const artifact = await base44.asServiceRole.entities.Artifact.get(body.artifact_id).catch(() => null);
  if (!artifact) return makeResponse(404, { error_code: "artifact_not_found" });
  if (!assertTenantScope(actor.clinic_id, artifact)) {
    return makeResponse(403, { error_code: "tenant_scope_violation" });
  }
  const processing = await findProcessing(base44, actor.clinic_id, artifact.id);
  if (!processing) return makeResponse(404, { error_code: "processing_not_found" });
  if (processing.status === PROCESSING_STATUS.aligned) {
    return makeResponse(409, { error_code: "fragment_not_retryable" });
  }
  if ((processing.attempt_count || 0) >= MAX_RETRY_ATTEMPTS) {
    return makeResponse(409, { error_code: "retry_limit_reached" });
  }
  await base44.asServiceRole.entities.FragmentProcessingResult.update(processing.id, {
    status: PROCESSING_STATUS.pending,
    attempt_count: (processing.attempt_count || 0) + 1,
    error_code: null,
    started_at: new Date().toISOString(),
    completed_at: null,
  });
  const deps = buildDeps(base44);
  const result = await processFragment(base44, artifact, processing, deps);
  return makeResponse(200, await buildCaptureResponse(base44, result.artifact, true, result.processing));
}

async function dispatchToComposition(base44, body, actor) {
  if (!isTestClinic(actor.clinic_id)) {
    return makeResponse(403, { error_code: "dispatch_test_clinic_required" });
  }
  if (!Array.isArray(body.artifact_ids) || body.artifact_ids.length === 0) {
    return makeResponse(400, { error_code: "artifact_not_found" });
  }
  const artifactIds = body.artifact_ids.filter(isNonEmptyString);
  const factCards = [];
  const blocked = [];
  for (const id of artifactIds) {
    const artifact = await base44.asServiceRole.entities.Artifact.get(id).catch(() => null);
    if (!artifact || !assertTenantScope(actor.clinic_id, artifact)) {
      blocked.push({ artifact_id: id, reason: "artifact_not_found" });
      continue;
    }
    const processing = await findProcessing(base44, actor.clinic_id, artifact.id);
    if (!processing || !processing.assembly_eligible) {
      blocked.push({
        artifact_id: id,
        reason: processing?.status || "processing_not_found",
      });
      continue;
    }
    for (const fcId of processing.fact_card_ids || []) {
      const fc = await base44.asServiceRole.entities.EvidenceFactCard.get(fcId).catch(() => null);
      if (fc && assertTenantScope(actor.clinic_id, fc)) {
        factCards.push({
          fact_card_id: fc.id,
          artifact_id: fc.artifact_id,
          subject_type: fc.subject_type,
          occurred_at: fc.occurred_at,
          assembly_eligible: fc.assembly_eligible === true,
        });
      }
    }
  }
  return makeResponse(200, {
    dispatched: false,
    reason: "batch1_bridge_validation_only",
    aligned: factCards.length > 0,
    fact_card_ids: factCards.map((f) => f.fact_card_id),
    blocked_artifact_ids: blocked,
    quality_issues: [],
  });
}

function computeBusinessDate(capturedAtIso, clinicId) {
  try {
    const d = new Date(capturedAtIso);
    const tz = "Asia/Tokyo";
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    return fmt.format(d);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

async function safeDelete(base44, entityName, id) {
  if (!id) return;
  try { await base44.asServiceRole.entities[entityName].delete(id); } catch {}
}

async function safeDeleteProcessingByArtifact(base44, clinicId, artifactId) {
  try {
    const rows = await base44.asServiceRole.entities.FragmentProcessingResult.filter({
      clinic_id: clinicId, artifact_id: artifactId,
    });
    for (const r of rows || []) {
      await safeDelete(base44, "FragmentProcessingResult", r.id);
    }
  } catch {}
}