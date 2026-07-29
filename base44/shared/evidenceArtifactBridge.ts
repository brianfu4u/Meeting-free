declare const Deno: any;

// EvidenceItem → Artifact bridge for staff-report attachments.
// Direction A only: real-time conversion of newly-created EvidenceItem rows.
// This module never scans or backfills historical EvidenceItem records and never
// imports or invokes compositionOrchestrator.

import {
  ADAPTER_VERSION,
  ALIGNMENT_STATUS,
  PROCESSING_STATUS,
  sanitizeErrorCode,
} from "../functions/fragmentIngestionService/contract.ts";
import { runAdapter } from "../functions/fragmentIngestionService/adapters.ts";
import {
  alignExtraction,
  evaluateAlignment,
} from "../functions/fragmentIngestionService/alignment.ts";

export const EVIDENCE_BRIDGE_VERSION = "evidence-artifact-bridge.v1";
export const EVIDENCE_BRIDGE_MAX_ATTEMPTS = 3;

export const BRIDGE_STATUS = Object.freeze({
  pending: "pending",
  processing: "processing",
  converted: "converted",
  failed: "failed",
});

const FAILURE_ATTENTION_PREFIX = "evidence-bridge-failed";
let lastIssuedBridgeIngestionSeq = 0;

export function computeOriginBridgeKey(clinicId: string, evidenceItemId: string) {
  return `${clinicId}::evidence-item::${evidenceItemId}`;
}

export function mapEvidenceItemTypes(evidenceType: string) {
  if (evidenceType === "voice") return { artifact_type: "voice", fragment_type: "audio" };
  if (evidenceType === "file") return { artifact_type: "file", fragment_type: "document" };
  if (evidenceType === "screenshot") return { artifact_type: "screenshot", fragment_type: "image" };
  return { artifact_type: "image", fragment_type: "image" };
}

export function shouldCreateBridgeAttention(attemptCount: number) {
  return Number(attemptCount) >= EVIDENCE_BRIDGE_MAX_ATTEMPTS;
}

export function computeBridgeIngestionSeq(nowMs = Date.now(), previousSeq = 0) {
  const now = Number(nowMs);
  const previous = Number(previousSeq);
  if (!Number.isFinite(now) || now < 0) throw new Error("invalid_ingestion_clock");
  const base = Math.trunc(now) * 1000;
  const prior = Number.isFinite(previous) && previous >= 0 ? Math.trunc(previous) : 0;
  return Math.max(base, prior + 1);
}

export function buildEvidenceBridgeDeps(svc: any) {
  const mockValue = typeof Deno !== "undefined" ? Deno.env.get("FRAGMENT_INGESTION_MOCK") : undefined;
  const mock = mockValue == null || mockValue === "true" || mockValue === "1";
  return {
    mock,
    invokeLLM: (input: any) => svc.integrations.Core.InvokeLLM({ ...input, model: input.model || "automatic" }),
    transcribeAudio: (input: any) => svc.integrations.Core.TranscribeAudio(input),
    extractDataFromFile: (input: any) => svc.integrations.Core.ExtractDataFromUploadedFile(input),
  };
}

export async function bridgeEvidenceItemsRealtime({
  svc,
  evidenceItems,
  sourceEventId,
  staff,
  now = new Date().toISOString(),
  deps = buildEvidenceBridgeDeps(svc),
  processor = processArtifactToFactCard,
}: {
  svc: any;
  evidenceItems: any[];
  sourceEventId: string;
  staff: any;
  now?: string;
  deps?: any;
  processor?: typeof processArtifactToFactCard;
}) {
  const results = [];
  for (const evidenceItem of evidenceItems || []) {
    results.push(await bridgeEvidenceItemRealtime({ svc, evidenceItem, sourceEventId, staff, now, deps, processor }));
  }
  return results;
}

export async function bridgeEvidenceItemRealtime({
  svc,
  evidenceItem,
  sourceEventId,
  staff,
  now = new Date().toISOString(),
  deps = buildEvidenceBridgeDeps(svc),
  processor = processArtifactToFactCard,
}: {
  svc: any;
  evidenceItem: any;
  sourceEventId: string;
  staff: any;
  now?: string;
  deps?: any;
  processor?: typeof processArtifactToFactCard;
}) {
  const existing = await findConvertedChain(svc, evidenceItem);
  if (existing) {
    await markEvidenceConverted(svc, evidenceItem);
    return buildResult({ evidenceItem, artifact: existing.artifact, processing: existing.processing, factCard: existing.factCard, attempts: Number(evidenceItem.attempt_count || 0), idempotent: true });
  }

  let current = await refreshEvidenceItem(svc, evidenceItem);
  while (Number(current.attempt_count || 0) < EVIDENCE_BRIDGE_MAX_ATTEMPTS) {
    const outcome = await runSingleBridgeAttempt({ svc, evidenceItem: current, sourceEventId, staff, now, deps, processor });
    if (outcome.bridge_status === BRIDGE_STATUS.converted) return outcome;
    current = await refreshEvidenceItem(svc, current);
  }

  return {
    origin_evidence_item_id: evidenceItem.id,
    bridge_status: BRIDGE_STATUS.failed,
    attempt_count: Number(current.attempt_count || EVIDENCE_BRIDGE_MAX_ATTEMPTS),
    last_error_code: current.last_error_code || "internal_error",
    artifact_id: null,
    processing_result_id: null,
    evidence_fact_card_id: null,
    assembly_eligible: false,
    idempotent: false,
  };
}

export async function runSingleBridgeAttempt({
  svc,
  evidenceItem,
  sourceEventId,
  staff,
  now = new Date().toISOString(),
  deps,
  processor = processArtifactToFactCard,
}: {
  svc: any;
  evidenceItem: any;
  sourceEventId: string;
  staff: any;
  now?: string;
  deps: any;
  processor?: typeof processArtifactToFactCard;
}) {
  const converted = await findConvertedChain(svc, evidenceItem);
  if (converted) {
    await markEvidenceConverted(svc, evidenceItem);
    return buildResult({ evidenceItem, artifact: converted.artifact, processing: converted.processing, factCard: converted.factCard, attempts: Number(evidenceItem.attempt_count || 0), idempotent: true });
  }

  const attempt = Number(evidenceItem.attempt_count || 0) + 1;
  await svc.entities.EvidenceItem.update(evidenceItem.id, {
    bridge_status: BRIDGE_STATUS.processing,
    attempt_count: attempt,
    last_error_code: null,
  });

  let artifact = null;
  let processing = null;
  try {
    artifact = await ensureArtifact({ svc, evidenceItem, sourceEventId, staff, now });
    processing = await ensureProcessing({ svc, evidenceItem, artifact, attempt, now });
    const factCard = await processor({ svc, evidenceItem, artifact, processing, attempt, deps, now });

    await svc.entities.EvidenceItem.update(evidenceItem.id, {
      bridge_status: BRIDGE_STATUS.converted,
      attempt_count: attempt,
      last_error_code: null,
    });

    const audit = await writeBridgeAudit({ svc, evidenceItem, sourceEventId, attempt, now, status: BRIDGE_STATUS.converted, artifact, processing, factCard, errorCode: null });
    return { ...buildResult({ evidenceItem, artifact, processing, factCard, attempts: attempt }), audit_event_id: audit.event_id };
  } catch (error: any) {
    const errorCode = sanitizeErrorCode(error?.code || "internal_error");
    if (processing?.id) {
      await svc.entities.FragmentProcessingResult.update(processing.id, {
        status: PROCESSING_STATUS.failed,
        attempt_count: attempt,
        error_code: errorCode,
        completed_at: new Date().toISOString(),
      }).catch(() => undefined);
    }
    await svc.entities.EvidenceItem.update(evidenceItem.id, {
      bridge_status: BRIDGE_STATUS.failed,
      attempt_count: attempt,
      last_error_code: errorCode,
    });

    const audit = await writeBridgeAudit({ svc, evidenceItem, sourceEventId, attempt, now, status: BRIDGE_STATUS.failed, artifact, processing, factCard: null, errorCode });
    let attentionItemId = null;
    if (shouldCreateBridgeAttention(attempt)) {
      const attention = await ensureBridgeFailureAttention({ svc, evidenceItem, sourceEventId, artifact, auditEventId: audit.event_id, errorCode, now });
      attentionItemId = attention?.id || null;
    }

    return {
      origin_evidence_item_id: evidenceItem.id,
      bridge_status: BRIDGE_STATUS.failed,
      attempt_count: attempt,
      last_error_code: errorCode,
      artifact_id: artifact?.id || null,
      processing_result_id: processing?.id || null,
      evidence_fact_card_id: null,
      assembly_eligible: false,
      attention_item_id: attentionItemId,
      audit_event_id: audit.event_id,
      idempotent: false,
    };
  }
}

export async function processArtifactToFactCard({ svc, evidenceItem, artifact, processing, attempt, deps }: any) {
  await svc.entities.FragmentProcessingResult.update(processing.id, {
    status: PROCESSING_STATUS.processing,
    attempt_count: attempt,
    started_at: new Date().toISOString(),
    completed_at: null,
    error_code: null,
  });

  const extraction = await runAdapter({ artifact, deps });
  const aligned = await alignExtraction({ artifact, extraction, deps });
  const gate = evaluateAlignment(aligned);
  if (gate.status !== ALIGNMENT_STATUS.aligned || gate.assembly_eligible !== true) {
    throw Object.assign(new Error("quality_gate_failed"), { code: "quality_gate_failed" });
  }

  const existingFactCards = await svc.entities.EvidenceFactCard.filter({
    clinic_id: evidenceItem.clinic_id,
    origin_evidence_item_id: evidenceItem.id,
  });
  let factCard = firstRow(existingFactCards);
  if (!factCard) {
    factCard = await svc.entities.EvidenceFactCard.create({
      clinic_id: artifact.clinic_id,
      artifact_id: artifact.id,
      origin_evidence_item_id: evidenceItem.id,
      fields: (aligned.fields || []).map((field: any) => ({
        field_name: field.field_name,
        value: field.value,
        source_artifact_id: artifact.id,
        source_region: extraction.evidence_spans?.[0]?.region || null,
        source_quote: field.source_quote || "",
        extraction_quality: field.extraction_quality || "uncertain",
        extraction_method: field.extraction_method || "llm_parse",
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
    });
  }

  await svc.entities.Artifact.update(artifact.id, { interpreted: true, evidence_fact_card_id: factCard.id });
  await svc.entities.FragmentProcessingResult.update(processing.id, {
    status: ALIGNMENT_STATUS.aligned,
    extracted_text: String(extraction.normalized_text || "").slice(0, 4000),
    transcript: extraction.transcript ? String(extraction.transcript).slice(0, 4000) : null,
    language: extraction.language || null,
    duration_ms: extraction.duration_ms ?? null,
    evidence_spans: extraction.evidence_spans || [],
    parser_warnings: extraction.warnings || [],
    quality_issues: gate.issues || [],
    fact_card_ids: [factCard.id],
    assembly_eligible: true,
    attempt_count: attempt,
    error_code: null,
    completed_at: new Date().toISOString(),
  });
  return factCard;
}

async function ensureArtifact({ svc, evidenceItem, sourceEventId, staff, now }: any) {
  const existing = firstRow(await svc.entities.Artifact.filter({
    clinic_id: evidenceItem.clinic_id,
    origin_evidence_item_id: evidenceItem.id,
  }));
  if (existing) return existing;

  const types = mapEvidenceItemTypes(evidenceItem.evidence_type);
  lastIssuedBridgeIngestionSeq = computeBridgeIngestionSeq(Date.now(), lastIssuedBridgeIngestionSeq);
  return svc.entities.Artifact.create({
    clinic_id: evidenceItem.clinic_id,
    artifact_type: types.artifact_type,
    fragment_type: types.fragment_type,
    file_url: evidenceItem.file_url,
    source_staff_id: evidenceItem.submitted_by,
    source_event_id: sourceEventId,
    source_region: staff?.assigned_zone || staff?.role_group || null,
    source_role: staff?.role || null,
    business_date: computeBusinessDate(evidenceItem.submitted_at || now),
    captured_at: evidenceItem.submitted_at || now,
    received_at: now,
    ingestion_seq: lastIssuedBridgeIngestionSeq,
    interpreted: false,
    origin_evidence_item_id: evidenceItem.id,
    client_request_id: `evidence-item:${evidenceItem.id}`,
    ingestion_key: computeOriginBridgeKey(evidenceItem.clinic_id, evidenceItem.id),
    source_channel: "staff_report",
    original_metadata: {
      bridge_version: EVIDENCE_BRIDGE_VERSION,
      origin_evidence_item_id: evidenceItem.id,
      evidence_version_id: evidenceItem.version_id,
      task_id: evidenceItem.task_id || null,
    },
    adapter_name: types.fragment_type,
    adapter_version: ADAPTER_VERSION,
    normal_rule_learning_eligible: true,
  });
}

async function ensureProcessing({ svc, evidenceItem, artifact, attempt, now }: any) {
  const existing = firstRow(await svc.entities.FragmentProcessingResult.filter({
    clinic_id: evidenceItem.clinic_id,
    origin_evidence_item_id: evidenceItem.id,
  }));
  if (existing) {
    await svc.entities.FragmentProcessingResult.update(existing.id, {
      artifact_id: artifact.id,
      status: PROCESSING_STATUS.pending,
      attempt_count: attempt,
      error_code: null,
      started_at: now,
      completed_at: null,
    });
    return { ...existing, artifact_id: artifact.id, attempt_count: attempt };
  }

  return svc.entities.FragmentProcessingResult.create({
    clinic_id: evidenceItem.clinic_id,
    artifact_id: artifact.id,
    origin_evidence_item_id: evidenceItem.id,
    client_request_id: `evidence-item:${evidenceItem.id}`,
    ingestion_key: computeOriginBridgeKey(evidenceItem.clinic_id, evidenceItem.id),
    fragment_type: artifact.fragment_type,
    adapter_name: artifact.fragment_type,
    adapter_version: ADAPTER_VERSION,
    status: PROCESSING_STATUS.pending,
    attempt_count: attempt,
    started_at: now,
  });
}

async function findConvertedChain(svc: any, evidenceItem: any) {
  const factCard = firstRow(await svc.entities.EvidenceFactCard.filter({
    clinic_id: evidenceItem.clinic_id,
    origin_evidence_item_id: evidenceItem.id,
    assembly_eligible: true,
    alignment_status: ALIGNMENT_STATUS.aligned,
  }));
  if (!factCard) return null;
  const artifact = await svc.entities.Artifact.get(factCard.artifact_id).catch(() => null);
  if (!artifact || artifact.clinic_id !== evidenceItem.clinic_id) return null;
  const processing = firstRow(await svc.entities.FragmentProcessingResult.filter({
    clinic_id: evidenceItem.clinic_id,
    origin_evidence_item_id: evidenceItem.id,
  }));
  return { artifact, processing, factCard };
}

async function markEvidenceConverted(svc: any, evidenceItem: any) {
  await svc.entities.EvidenceItem.update(evidenceItem.id, {
    bridge_status: BRIDGE_STATUS.converted,
    last_error_code: null,
  });
}

async function refreshEvidenceItem(svc: any, evidenceItem: any) {
  return svc.entities.EvidenceItem.get(evidenceItem.id).catch(() => evidenceItem);
}

async function writeBridgeAudit({ svc, evidenceItem, sourceEventId, attempt, now, status, artifact, processing, factCard, errorCode }: any) {
  const eventId = `${sourceEventId}/evidence-bridge/${evidenceItem.id}/attempt-${attempt}`;
  return svc.entities.AuditLog.create({
    clinic_id: evidenceItem.clinic_id,
    event_id: eventId,
    timestamp: new Date().toISOString(),
    source_agent: "EvidenceArtifactBridge_V1",
    trigger_type: status === BRIDGE_STATUS.converted ? "EVIDENCE_ARTIFACT_BRIDGE_CONVERTED" : "EVIDENCE_ARTIFACT_BRIDGE_FAILED",
    payload: {
      source_event_id: sourceEventId,
      origin_evidence_item_id: evidenceItem.id,
      artifact_id: artifact?.id || null,
      processing_result_id: processing?.id || null,
      evidence_fact_card_id: factCard?.id || null,
      bridge_status: status,
      attempt_count: attempt,
      last_error_code: errorCode,
      bridge_version: EVIDENCE_BRIDGE_VERSION,
      requested_at: now,
    },
  });
}

async function ensureBridgeFailureAttention({ svc, evidenceItem, sourceEventId, artifact, auditEventId, errorCode, now }: any) {
  const sourceProposalId = `${FAILURE_ATTENTION_PREFIX}::${evidenceItem.clinic_id}::${evidenceItem.id}`;
  const existing = firstRow(await svc.entities.AttentionItem.filter({
    clinic_id: evidenceItem.clinic_id,
    attention_type: "evidence_missing",
    source_proposal_id: sourceProposalId,
    status: "open",
  }));
  if (existing) return existing;

  return svc.entities.AttentionItem.create({
    clinic_id: evidenceItem.clinic_id,
    attention_type: "evidence_missing",
    urgency: "yellow",
    title: "证据桥接连续失败",
    reasoning: `EvidenceItem ${evidenceItem.id} 已连续桥接失败 ${EVIDENCE_BRIDGE_MAX_ATTEMPTS} 次，错误码 ${errorCode}。员工汇报主流程已成功保存。`,
    evidence_ids: [evidenceItem.id],
    event_ids: [sourceEventId],
    recommendation: "请检查原始附件可读性或解析服务状态后重试桥接。",
    status: "open",
    generated_at: now,
    artifact_ids: artifact?.id ? [artifact.id] : [],
    evidence_fact_card_ids: [],
    audit_event_ids: [auditEventId],
    source_proposal_id: sourceProposalId,
    shadow_mode_snapshot: true,
  });
}

function buildResult({ evidenceItem, artifact, processing, factCard, attempts, idempotent = false }: any) {
  return {
    origin_evidence_item_id: evidenceItem.id,
    bridge_status: BRIDGE_STATUS.converted,
    attempt_count: attempts,
    last_error_code: null,
    artifact_id: artifact?.id || null,
    processing_result_id: processing?.id || null,
    evidence_fact_card_id: factCard?.id || null,
    assembly_eligible: factCard?.assembly_eligible === true,
    idempotent,
  };
}

function firstRow(rows: any[]) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows.slice().sort((a, b) => String(a.created_date || a.id).localeCompare(String(b.created_date || b.id)))[0];
}

function computeBusinessDate(iso: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
