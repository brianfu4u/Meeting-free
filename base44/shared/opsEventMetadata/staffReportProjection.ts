import {
  createOpsEventMetadata,
  opsEventMetadataToFactCardFields,
} from "./model.ts";

function cleanString(value: unknown, max = 300): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function inferEventType(reportType: string, parsed: Record<string, any>) {
  const explicit = cleanString(parsed.event_type, 120)?.toLowerCase().replace(/[\s-]+/g, "_");
  if (explicit) return explicit;
  const text = `${parsed.category || ""} ${parsed.summary || ""} ${parsed.event_title || ""}`;
  if (/投诉|抱怨|complaint/i.test(text)) return "complaint";
  if (/培训|training/i.test(text)) return "training";
  if (/故障|维修|equipment|failure|repair/i.test(text)) return "equipment_failure";
  if (/资源|物资|resource/i.test(text)) return "resource_request";
  if (/协作|协调|coordination/i.test(text)) return "staff_coordination";
  if (reportType === "progress") return "progress_update";
  if (reportType === "completion") return "completion";
  return "other";
}

export function buildOpsMetadataFromStaffReport({
  clinic_id,
  event_id,
  report_type,
  combined_text,
  staff,
  ai_parsed,
  evidence_ids,
  bridge_results,
  now,
}: any) {
  const parsed = ai_parsed && typeof ai_parsed === "object" ? ai_parsed : {};
  const eventType = inferEventType(report_type, parsed);
  const summary = cleanString(parsed.summary, 300)
    || cleanString(combined_text, 300)
    || `${staff?.staff_name || staff?.role || "员工"}提交${report_type}汇报`;
  const eventTitle = cleanString(parsed.event_title || parsed.attention_title, 180)
    || summary;
  const converted = Array.isArray(bridge_results)
    ? bridge_results.filter((item) => item?.bridge_status === "converted")
    : [];

  return createOpsEventMetadata({
    clinic_id,
    source_event_id: event_id,
    source_artifact_id: converted[0]?.artifact_id || null,
    origin_evidence_item_ids: evidence_ids || [],
    evidence_fact_card_ids: converted.map((item) => item?.evidence_fact_card_id).filter(Boolean),
    event_type: eventType,
    event_title: eventTitle,
    patient_id: null,
    department: staff?.assigned_zone || staff?.role_group || null,
    role: staff?.role || null,
    occurred_at: now,
    reported_at: now,
    basic_summary: summary,
    priority_hint: parsed.priority_hint || (parsed.urgency === "red" ? "P2" : "P3"),
    sla_target_minutes: parsed.sla_target_minutes,
    value_add_fields: parsed.value_add_fields || {},
    parser_id: "staff_report_ops_event_parser",
    parser_version: "phase1.v1",
    parse_confidence: Object.keys(parsed).length > 0 ? 0.75 : 0.4,
    warnings: parsed.summary === "LLM 解析失败，已原文存档" ? ["ops_event_llm_parse_failed"] : [],
    raw_text_excerpt: combined_text,
  });
}

export async function persistOpsMetadataAndProjectRouting({
  svc,
  metadata,
  bridge_results,
  created_at,
}: any) {
  const record = await svc.entities.OpsEventMetadata.create({
    ...metadata,
    clinic_id: metadata.core_routing_fields.clinic_id,
    created_at,
  });

  const projectedFactCardIds: string[] = [];
  for (const bridgeResult of bridge_results || []) {
    const factCardId = bridgeResult?.evidence_fact_card_id;
    const artifactId = bridgeResult?.artifact_id;
    if (!factCardId || !artifactId) continue;
    const factCard = await svc.entities.EvidenceFactCard.get(factCardId).catch(() => null);
    if (!factCard || factCard.clinic_id !== metadata.core_routing_fields.clinic_id) continue;
    const routingFields = opsEventMetadataToFactCardFields(metadata, artifactId);
    const retained = (factCard.fields || []).filter(
      (field) => !String(field?.field_name || "").startsWith("routing."),
    );
    await svc.entities.EvidenceFactCard.update(factCard.id, {
      fields: [...retained, ...routingFields],
      occurred_at: metadata.core_routing_fields.occurred_at || factCard.occurred_at,
    });
    projectedFactCardIds.push(factCard.id);
  }

  return { record, projected_fact_card_ids: projectedFactCardIds };
}
