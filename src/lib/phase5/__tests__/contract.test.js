import { describe, expect, it } from "vitest";
import {
  ACTIONS,
  ADAPTER_VERSION,
  ALIGNMENT_VERSION,
  FRAGMENT_TYPES,
  MAX_RETRY_ATTEMPTS,
  computeIngestionKey,
  computeIngestionSeq,
  isTestClinic,
  mapFragmentTypeToArtifactType,
  sanitizeErrorCode,
} from "../../../../base44/functions/fragmentIngestionService/contract.ts";
import {
  AGENT_PICKUP_FILTER_FIELDS,
  CONSUMPTION_MARKER,
  EVENT_GENE_CODE_FORMAT,
  EVENT_GENE_CODE_USAGE_POLICY,
  EVENT_ID_SEMANTICS,
  GENE_CODE_REGEX,
  HANDOFF_VERSION,
  classifyRunForIdempotency,
  formatEventGeneCode,
  isEventIdAGroupingKey,
  isPickupEligible,
} from "../agentHandoffContract";

describe("fragmentIngestionService contract", () => {
  it("exposes four fragment types and six actions", () => {
    expect(FRAGMENT_TYPES).toEqual(["image", "document", "audio", "text"]);
    expect([...ACTIONS]).toEqual(expect.arrayContaining([
      "captureFragment", "getFragmentStatus", "listFragments",
      "retryFragment", "processFragment", "dispatchToComposition",
    ]));
  });

  it("pins adapter and alignment versions", () => {
    expect(ADAPTER_VERSION).toBe("phase5.adapter.v1");
    expect(ALIGNMENT_VERSION).toBe("phase5.alignment.v1");
  });

  it("keeps ingestion identity separate from the cutoff waterline", () => {
    expect(computeIngestionKey("c1", "r1")).toBe("c1::r1");
    expect(computeIngestionSeq(1000, 0)).toBe(1_000_000);
    expect(computeIngestionSeq(1000, 1_000_000)).toBe(1_000_001);
  });

  it("rejects invalid clocks", () => {
    expect(() => computeIngestionSeq(Number.NaN, 0)).toThrow("invalid_ingestion_clock");
  });

  it("recognizes only phase5 test clinics", () => {
    expect(isTestClinic("phase5-it-abc")).toBe(true);
    expect(isTestClinic("clinic-001")).toBe(false);
  });

  it("preserves legacy artifact mappings and sanitized errors", () => {
    expect(mapFragmentTypeToArtifactType("document")).toBe("file");
    expect(mapFragmentTypeToArtifactType("audio")).toBe("voice");
    expect(sanitizeErrorCode("tenant_scope_violation")).toBe("tenant_scope_violation");
    expect(sanitizeErrorCode("raw_stack")).toBe("internal_error");
    expect(MAX_RETRY_ATTEMPTS).toBe(3);
  });
});

describe("Phase 5 parser → Agent handoff", () => {
  const artifact = { id: "artifact-abcdef12", clinic_id: "phase5-it-a", ingestion_seq: 10 };
  const factCard = {
    artifact_id: artifact.id,
    clinic_id: artifact.clinic_id,
    assembly_eligible: true,
    alignment_status: "aligned",
  };

  it("uses the v2 deterministic display label", () => {
    expect(HANDOFF_VERSION).toBe("phase5.handoff.v2");
    expect(EVENT_GENE_CODE_FORMAT).toBe(
      "{clinic_id}/{business_date}/{department}/{fragment_type}/{artifact_short_id}",
    );
    const code = formatEventGeneCode({
      clinic_id: "phase5-it-a",
      business_date: "2026-07-20",
      department: "optometry",
      fragment_type: "image",
      artifact_id: artifact.id,
    });
    expect(code).toBe("phase5-it-a/2026-07-20/optometry/image/abcdef12");
    expect(GENE_CODE_REGEX.test(code)).toBe(true);
  });

  it("forbids event_gene_code for grouping, authorization and idempotency", () => {
    expect(EVENT_GENE_CODE_USAGE_POLICY.forbidden).toEqual(expect.arrayContaining([
      "grouping_decision", "tenant_authorization", "idempotency_key",
    ]));
  });

  it("requires the four structured pickup fields", () => {
    expect(AGENT_PICKUP_FILTER_FIELDS).toEqual([
      "clinic_id", "assembly_eligible", "alignment_status", "ingestion_seq",
    ]);
  });

  it("accepts an aligned eligible card at or below cutoff", () => {
    expect(isPickupEligible({
      artifact, factCard, clinicId: artifact.clinic_id,
      cutoffEventSeq: 10, completedArtifactIds: [],
    })).toBe(true);
  });

  it.each(["needs_clarification", "failed", "rejected"])(
    "excludes %s cards",
    (status) => {
      expect(isPickupEligible({
        artifact,
        factCard: { ...factCard, alignment_status: status },
        clinicId: artifact.clinic_id,
        cutoffEventSeq: 10,
        completedArtifactIds: [],
      })).toBe(false);
    },
  );

  it("rejects tenant mismatch, future waterline and completed artifacts", () => {
    expect(isPickupEligible({ artifact, factCard, clinicId: "other", cutoffEventSeq: 10 })).toBe(false);
    expect(isPickupEligible({ artifact, factCard, clinicId: artifact.clinic_id, cutoffEventSeq: 9 })).toBe(false);
    expect(isPickupEligible({
      artifact, factCard, clinicId: artifact.clinic_id, cutoffEventSeq: 10,
      completedArtifactIds: [artifact.id],
    })).toBe(false);
  });

  it("maps run states to explicit replay behavior", () => {
    expect(classifyRunForIdempotency("completed")).toBe("processed_no_repeat");
    expect(classifyRunForIdempotency("running")).toBe("same_key_existing_run");
    expect(classifyRunForIdempotency("failed")).toBe("safe_retry");
  });

  it("does not consume cards by clearing assembly_eligible", () => {
    expect(CONSUMPTION_MARKER.forbidden).toBe("EvidenceFactCard.assembly_eligible=false");
  });

  it("keeps source and ingestion audit ids optional and out of grouping", () => {
    expect(EVENT_ID_SEMANTICS.source_event_id.nullable).toBe(true);
    expect(EVENT_ID_SEMANTICS.ingestion_event_id.nullable).toBe(true);
    expect(isEventIdAGroupingKey()).toBe(false);
  });
});
