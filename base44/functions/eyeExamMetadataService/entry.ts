import { createClientFromRequest } from "npm:@base44/sdk@0.8.38";
import { resolveClinicActor } from "../../shared/clinicActor.ts";
import { dispatchEyeExamReportMetadata } from "../../shared/eyeExamMetadata/dispatch.ts";
import { metadataToFactCardFields } from "../../shared/eyeExamMetadata/model.ts";
import {
  aggregateParsingQuality,
  buildParsingQualityEvent,
} from "../../shared/eyeExamMetadata/quality.ts";
import { assertTenantScope, isNonEmptyString } from "../fragmentIngestionService/security.ts";

const ACTION_PARSE_AND_PERSIST = "parseAndPersist";
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

async function parseAndPersist(svc, body, actor) {
  const artifact = await svc.entities.Artifact.get(body.artifact_id).catch(() => null);
  if (!artifact || !assertTenantScope(actor.clinic_id, artifact)) {
    throw Object.assign(new Error("tenant_scope_violation"), { code: "tenant_scope_violation" });
  }

  const evidenceItem = await resolveEvidenceItem(svc, artifact, body.origin_evidence_item_id, actor.clinic_id);
  const factCard = await resolveFactCard(svc, artifact, body.evidence_fact_card_id, actor.clinic_id);
  const processing = await resolveProcessing(svc, artifact, actor.clinic_id);
  const rawText = await resolveRawText(svc, artifact, processing, body.raw_text);
  if (!rawText) return { metadata: null, skipped_reason: "source_text_unavailable" };

  const deps = {
    mock: false,
    invokeLLM: (input) => svc.integrations.Core.InvokeLLM({ ...input, model: input.model || "automatic" }),
  };
  const metadata = await dispatchEyeExamReportMetadata({
    rawText,
    context: {
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
    },
    deps,
  });

  if (!metadata) return { metadata: null, skipped_reason: "not_eye_exam_report" };

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

async function resolveRawText(svc, artifact, processing, suppliedText) {
  const existing = String(suppliedText || processing?.extracted_text || "").trim();
  if (existing) return existing.slice(0, 12000);
  if (!artifact.file_url || !["image", "document"].includes(artifact.fragment_type)) return "";

  try {
    const extracted = await svc.integrations.Core.ExtractDataFromUploadedFile({
      file_url: artifact.file_url,
      json_schema: {
        type: "object",
        properties: {
          text: { type: "string" },
          pages: {
            type: "array",
            items: {
              type: "object",
              properties: {
                page_number: { type: "number" },
                text: { type: "string" },
              },
            },
          },
          rows: { type: "array", items: { type: "object", additionalProperties: true } },
        },
      },
    });
    if (!extracted || extracted.status !== "success") return "";
    const output = extracted.output || {};
    const pages = Array.isArray(output.pages)
      ? output.pages.map((page) => page?.text).filter(Boolean).join("\n")
      : "";
    const rows = Array.isArray(output.rows) && output.rows.length > 0
      ? JSON.stringify(output.rows)
      : "";
    return String(output.text || pages || rows || "").trim().slice(0, 12000);
  } catch {
    return "";
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
