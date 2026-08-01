import { createClientFromRequest } from "npm:@base44/sdk@0.8.38";
import { resolveClinicActor } from "../../shared/clinicActor.ts";
import {
  dispatchEyeExamReportMetadata,
  selectEyeExamParser,
} from "../../shared/eyeExamMetadata/dispatch.ts";
import {
  createEyeExamMetadata,
  metadataToFactCardFields,
} from "../../shared/eyeExamMetadata/model.ts";
import { isLikelyEyeExamReport } from "../../shared/eyeExamMetadata/common.ts";
import {
  getEyeExamItemCandidates,
  inferEyeExamItemTag,
  validateEyeExamItemConfirmation,
} from "../../shared/eyeExamMetadata/examItemCatalog.ts";
import {
  assessEyeExamOcrQuality,
  LOW_QUALITY_REUPLOAD_CODE,
} from "../../shared/eyeExamMetadata/ocrQuality.ts";
import {
  aggregateParsingQuality,
  buildParsingQualityEvent,
} from "../../shared/eyeExamMetadata/quality.ts";
import { assertTenantScope, isNonEmptyString } from "../fragmentIngestionService/security.ts";

const ACTION_PARSE_AND_PERSIST = "parseAndPersist";
const ACTION_CONFIRM_EXAM_ITEM = "confirmExamItem";
const ACTION_GET_QUALITY_OVERVIEW = "getQualityOverview";
const QUALITY_OVERVIEW_ROLES = new Set(["clinic_director", "qa_officer"]);

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ ok: false, error_code: "method_not_allowed" }, { status: 405 });
  }

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ ok: false, error_code: "unauthenticated" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    if (!isNonEmptyString(body.clinic_id)) {
      return Response.json({ ok: false, error_code: "clinic_context_required" }, { status: 400 });
    }

    if (body.action === ACTION_PARSE_AND_PERSIST) {
      if (!isNonEmptyString(body.artifact_id)) {
        return Response.json({ ok: false, error_code: "artifact_context_required" }, { status: 400 });
      }
      const actor = await resolveClinicActor(base44.asServiceRole, user, body.clinic_id, {
        requireOnDuty: true,
        staffRole: "staff",
      });
      if (!actor) return Response.json({ ok: false, error_code: "tenant_scope_violation" }, { status: 403 });
      const result = await parseAndPersist(base44.asServiceRole, body, actor);
      return Response.json({ ok: true, ...result }, { status: 200 });
    }

    if (body.action === ACTION_CONFIRM_EXAM_ITEM) {
      if (!isNonEmptyString(body.artifact_id) || !isNonEmptyString(body.exam_item_manual_tag)) {
        return Response.json({ ok: false, error_code: "eye_exam_item_confirmation_required" }, { status: 400 });
      }
      const validation = validateEyeExamItemConfirmation(
        body.exam_item_manual_tag,
        body.exam_item_manual_note,
      );
      if (!validation.ok) {
        return Response.json({ ok: false, error_code: validation.error_code }, { status: 400 });
      }
      const actor = await resolveClinicActor(base44.asServiceRole, user, body.clinic_id, {
        requireOnDuty: true,
        staffRole: "staff",
      });
      if (!actor) return Response.json({ ok: false, error_code: "tenant_scope_violation" }, { status: 403 });
      const result = await confirmExamItem(base44.asServiceRole, body, actor, validation);
      return Response.json({ ok: true, ...result }, { status: 200 });
    }

    if (body.action === ACTION_GET_QUALITY_OVERVIEW) {
      const actor = await resolveQualityOverviewActor(base44.asServiceRole, user, body.clinic_id);
      if (!actor) return Response.json({ ok: false, error_code: "quality_overview_forbidden" }, { status: 403 });
      const overview = await getQualityOverview(base44.asServiceRole, body, actor);
      return Response.json({ ok: true, overview }, { status: 200 });
    }

    return Response.json({ ok: false, error_code: "action_invalid" }, { status: 400 });
  } catch (error: any) {
    const code = typeof error?.code === "string" ? error.code : "internal_error";
    const status = code === "tenant_scope_violation" ? 403 : 500;
    return Response.json({ ok: false, error_code: code }, { status });
  }
});

async function resolveQualityOverviewActor(svc, user, clinicId) {
  if (user.role === "admin") {
    const configs = await svc.entities.ClinicConfig.filter({ clinic_id: clinicId });
    if (configs?.[0]?.manager_id === user.id) {
      return { user_id: user.id, clinic_id: clinicId, staff_id: user.id, role: "admin" };
    }
  }

  const actor = await resolveClinicActor(svc, user, clinicId, {
    requireOnDuty: false,
    staffRole: "staff",
  });
  if (!actor) return null;
  const staff = await svc.entities.Staff.get(actor.staff_id).catch(() => null);
  if (!staff || staff.clinic_id !== clinicId || !QUALITY_OVERVIEW_ROLES.has(staff.role)) return null;
  return { ...actor, role: "quality_manager" };
}

function buildEyeExamContext(artifact, evidenceItem, factCard, actor) {
  return {
    clinic_id: actor.clinic_id,
    patient_id: artifact.source_session_id || null,
    raw_artifact_id: artifact.id,
    origin_evidence_item_id: evidenceItem?.id || artifact.origin_evidence_item_id || null,
    evidence_fact_card_id: factCard?.id || null,
    measured_at_hint: artifact.captured_at || null,
    source_filename: artifact.original_filename || null,
    category_label: artifact.original_metadata?.user_interactive_meta?.category_label || null,
    device_vendor: artifact.original_metadata?.device_vendor || null,
    device_model: artifact.original_metadata?.device_model || null,
  };
}

async function parseAndPersist(svc, body, actor) {
  const artifact = await svc.entities.Artifact.get(body.artifact_id).catch(() => null);
  if (!artifact || !assertTenantScope(actor.clinic_id, artifact)) {
    throw Object.assign(new Error("tenant_scope_violation"), { code: "tenant_scope_violation" });
  }

  const evidenceItem = await resolveEvidenceItem(svc, artifact, body.origin_evidence_item_id, actor.clinic_id);
  const factCard = await resolveFactCard(svc, artifact, body.evidence_fact_card_id, actor.clinic_id);
  const processing = await resolveProcessing(svc, artifact, actor.clinic_id);
  const ocrSource = await resolveOcrSource(svc, artifact, processing, body);
  const context = buildEyeExamContext(artifact, evidenceItem, factCard, actor);
  const likelyEyeExam = selectEyeExamParser(ocrSource.text) != null
    || isLikelyEyeExamReport(ocrSource.text, context);

  if (!likelyEyeExam) {
    return {
      metadata: null,
      skipped_reason: ocrSource.text ? "not_eye_exam_report" : "source_text_unavailable",
    };
  }

  const ocrQuality = assessEyeExamOcrQuality(ocrSource.text, {
    provider_confidence: ocrSource.provider_confidence,
  });

  let metadata;
  if (ocrQuality.flag === "poor") {
    // Preserve Artifact/EvidenceItem and a minimal technical metadata record,
    // but stop before device parsers or LLM completion because detailed values
    // would not be reliable enough for business matching.
    metadata = createEyeExamMetadata({
      ...context,
      exam_type: "眼科检查报告（待重新上传）",
      exam_item_name: null,
      parser_id: "low_quality_eye_exam_gate",
      parser_version: "upload-quality.v1",
      parse_status: "partial",
      parse_confidence: 0,
      ocr_quality_score: ocrQuality.score,
      ocr_quality_flag: ocrQuality.flag,
      ocr_quality_reasons: ocrQuality.reasons,
      requires_reupload: true,
      requires_exam_item_confirmation: false,
      warnings: [LOW_QUALITY_REUPLOAD_CODE, ...ocrQuality.reasons],
      raw_text_excerpt: ocrSource.text,
    });
  } else {
    const deps = {
      mock: false,
      invokeLLM: (input) => svc.integrations.Core.InvokeLLM({ ...input, model: input.model || "automatic" }),
    };
    const parsed = await dispatchEyeExamReportMetadata({ rawText: ocrSource.text, context, deps });
    if (!parsed) return { metadata: null, skipped_reason: "not_eye_exam_report" };
    const suggestedTag = inferEyeExamItemTag(parsed);
    metadata = createEyeExamMetadata({
      ...parsed,
      ocr_quality_score: ocrQuality.score,
      ocr_quality_flag: ocrQuality.flag,
      ocr_quality_reasons: ocrQuality.reasons,
      requires_reupload: false,
      exam_item_suggested_tag: suggestedTag,
      requires_exam_item_confirmation: true,
    });
  }

  const record = await upsertMetadataRecord(svc, metadata, actor.clinic_id);
  if (factCard) await appendMetadataToFactCard(svc, factCard, metadata, artifact.id);

  // Quality telemetry is intentionally non-blocking. A statistics storage
  // failure must never roll back the original evidence or metadata record.
  const qualityEvent = await upsertQualityEvent(svc, metadata, actor.clinic_id, artifact.id)
    .catch(() => null);

  return {
    metadata: record,
    artifact_id: artifact.id,
    origin_evidence_item_id: evidenceItem?.id || null,
    evidence_fact_card_id: factCard?.id || null,
    quality_event_recorded: qualityEvent != null,
    warning_code: metadata.requires_reupload ? LOW_QUALITY_REUPLOAD_CODE : null,
    requires_reupload: metadata.requires_reupload === true,
    requires_exam_item_confirmation: metadata.requires_exam_item_confirmation === true,
    exam_item_candidates: metadata.requires_exam_item_confirmation
      ? getEyeExamItemCandidates()
      : [],
    exam_item_suggested_tag: metadata.exam_item_suggested_tag || null,
  };
}

async function confirmExamItem(svc, body, actor, validation) {
  const artifact = await svc.entities.Artifact.get(body.artifact_id).catch(() => null);
  if (!artifact || !assertTenantScope(actor.clinic_id, artifact)) {
    throw Object.assign(new Error("tenant_scope_violation"), { code: "tenant_scope_violation" });
  }

  const rows = await svc.entities.EyeExamReportMetadata.filter({
    clinic_id: actor.clinic_id,
    raw_artifact_id: artifact.id,
  });
  const existing = Array.isArray(rows) ? rows[0] : null;
  if (!existing) {
    throw Object.assign(new Error("eye_exam_metadata_not_found"), { code: "eye_exam_metadata_not_found" });
  }
  if (existing.requires_reupload === true || existing.ocr_quality_flag === "poor") {
    throw Object.assign(new Error("eye_exam_metadata_not_confirmable"), { code: "eye_exam_metadata_not_confirmable" });
  }

  const metadata = createEyeExamMetadata({
    ...existing,
    exam_item_manual_tag: validation.candidate.id,
    exam_item_manual_label: validation.candidate.label,
    exam_item_manual_note: validation.note,
    exam_item_confirmed_at: new Date().toISOString(),
    exam_item_confirmed_by_staff_id: actor.staff_id,
    requires_exam_item_confirmation: false,
  });
  const record = await svc.entities.EyeExamReportMetadata.update(existing.id, {
    ...metadata,
    clinic_id: actor.clinic_id,
    created_at: existing.created_at || new Date().toISOString(),
  });

  const factCard = await resolveFactCard(
    svc,
    artifact,
    existing.evidence_fact_card_id || body.evidence_fact_card_id,
    actor.clinic_id,
  );
  if (factCard) await appendMetadataToFactCard(svc, factCard, metadata, artifact.id);

  return {
    metadata: record,
    artifact_id: artifact.id,
    evidence_fact_card_id: factCard?.id || null,
    exam_item_manual_tag: validation.candidate.id,
    exam_item_manual_label: validation.candidate.label,
    requires_exam_item_confirmation: false,
  };
}

async function getQualityOverview(svc, body, actor) {
  const rows = await svc.entities.EyeExamParserQualityEvent.filter({
    clinic_id: actor.clinic_id,
  });
  return aggregateParsingQuality(Array.isArray(rows) ? rows : [], {
    days: body.days,
    limit: body.top_n,
  });
}

async function upsertQualityEvent(svc, metadata, clinicId, artifactId) {
  const descriptor = buildParsingQualityEvent(metadata, {
    clinic_id: clinicId,
    raw_artifact_id: artifactId,
    recorded_at: new Date().toISOString(),
  });
  const existing = await svc.entities.EyeExamParserQualityEvent.filter({
    clinic_id: clinicId,
    raw_artifact_id: artifactId,
    parser_version: descriptor.parser_version,
  });
  const row = Array.isArray(existing) ? existing[0] : null;
  if (row) return svc.entities.EyeExamParserQualityEvent.update(row.id, descriptor);
  return svc.entities.EyeExamParserQualityEvent.create(descriptor);
}

function firstFinite(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

async function resolveOcrSource(svc, artifact, processing, body) {
  const existing = String(body.raw_text || processing?.extracted_text || "").trim();
  const processingWarnings = Array.isArray(processing?.parser_warnings) ? processing.parser_warnings : [];
  const warningConfidence = processingWarnings.includes("low_ocr_confidence") ? 0.25 : null;
  const providerConfidence = firstFinite(
    body.ocr_confidence,
    processing?.ocr_confidence,
    processing?.average_confidence,
    warningConfidence,
  );
  if (existing) {
    return { text: existing.slice(0, 12000), provider_confidence: providerConfidence };
  }
  if (!artifact.file_url || !["image", "document"].includes(artifact.fragment_type)) {
    return { text: "", provider_confidence: providerConfidence };
  }

  try {
    const extracted = await svc.integrations.Core.ExtractDataFromUploadedFile({
      file_url: artifact.file_url,
      json_schema: {
        type: "object",
        properties: {
          text: { type: "string" },
          ocr_confidence: { type: "number" },
          average_confidence: { type: "number" },
          confidence: { type: "number" },
          pages: {
            type: "array",
            items: {
              type: "object",
              properties: {
                page_number: { type: "number" },
                text: { type: "string" },
                confidence: { type: "number" },
              },
            },
          },
          rows: { type: "array", items: { type: "object", additionalProperties: true } },
        },
      },
    });
    if (!extracted || extracted.status !== "success") {
      return { text: "", provider_confidence: 0 };
    }
    const output = extracted.output || {};
    const pages = Array.isArray(output.pages)
      ? output.pages.map((page) => page?.text).filter(Boolean).join("\n")
      : "";
    const rows = Array.isArray(output.rows) && output.rows.length > 0
      ? JSON.stringify(output.rows)
      : "";
    const pageConfidences = Array.isArray(output.pages)
      ? output.pages.map((page) => Number(page?.confidence)).filter(Number.isFinite)
      : [];
    const averagePageConfidence = pageConfidences.length > 0
      ? pageConfidences.reduce((sum, value) => sum + value, 0) / pageConfidences.length
      : null;
    return {
      text: String(output.text || pages || rows || "").trim().slice(0, 12000),
      provider_confidence: firstFinite(
        output.ocr_confidence,
        output.average_confidence,
        output.confidence,
        averagePageConfidence,
      ),
    };
  } catch {
    return { text: "", provider_confidence: 0 };
  }
}

async function resolveEvidenceItem(svc, artifact, requestedId, clinicId) {
  const id = artifact.origin_evidence_item_id || requestedId || null;
  if (!id) return null;
  if (artifact.origin_evidence_item_id && requestedId && artifact.origin_evidence_item_id !== requestedId) {
    throw Object.assign(new Error("evidence_link_mismatch"), { code: "tenant_scope_violation" });
  }
  const row = await svc.entities.EvidenceItem.get(id).catch(() => null);
  if (!row || !assertTenantScope(clinicId, row)) {
    throw Object.assign(new Error("tenant_scope_violation"), { code: "tenant_scope_violation" });
  }
  return row;
}

async function resolveFactCard(svc, artifact, requestedId, clinicId) {
  const id = artifact.evidence_fact_card_id || requestedId || null;
  if (!id) return null;
  if (artifact.evidence_fact_card_id && requestedId && artifact.evidence_fact_card_id !== requestedId) {
    throw Object.assign(new Error("fact_card_link_mismatch"), { code: "tenant_scope_violation" });
  }
  const row = await svc.entities.EvidenceFactCard.get(id).catch(() => null);
  if (!row || !assertTenantScope(clinicId, row) || row.artifact_id !== artifact.id) {
    throw Object.assign(new Error("tenant_scope_violation"), { code: "tenant_scope_violation" });
  }
  return row;
}

async function resolveProcessing(svc, artifact, clinicId) {
  const rows = await svc.entities.FragmentProcessingResult.filter({
    clinic_id: clinicId,
    artifact_id: artifact.id,
  });
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows.slice().sort((a, b) => String(b.completed_at || b.created_date || b.id)
    .localeCompare(String(a.completed_at || a.created_date || a.id)))[0];
}

async function upsertMetadataRecord(svc, metadata, clinicId) {
  const existing = await svc.entities.EyeExamReportMetadata.filter({
    clinic_id: clinicId,
    raw_artifact_id: metadata.raw_artifact_id,
  });
  const descriptor = {
    ...metadata,
    clinic_id: clinicId,
    created_at: new Date().toISOString(),
  };
  const row = Array.isArray(existing) ? existing[0] : null;
  if (row) return svc.entities.EyeExamReportMetadata.update(row.id, descriptor);
  return svc.entities.EyeExamReportMetadata.create(descriptor);
}

async function appendMetadataToFactCard(svc, factCard, metadata, artifactId) {
  const existingFields = Array.isArray(factCard.fields) ? factCard.fields : [];
  const retained = existingFields.filter((field) =>
    typeof field?.field_name !== "string" || !field.field_name.startsWith("eye_exam.")
  );
  const metadataFields = metadataToFactCardFields(metadata, artifactId);
  await svc.entities.EvidenceFactCard.update(factCard.id, {
    fields: [...retained, ...metadataFields],
  });
}
