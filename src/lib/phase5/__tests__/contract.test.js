import { describe, expect, it } from "vitest";
import {
  ACTIONS,
  ADAPTER_VERSION,
  ALIGNMENT_VERSION,
  ALLOWED_ERROR_CODES,
  FRAGMENT_TYPES,
  MAX_RETRY_ATTEMPTS,
  computeIngestionKey,
  isTestClinic,
  mapFragmentTypeToArtifactType,
  sanitizeErrorCode,
} from "../../../../base44/functions/fragmentIngestionService/contract.ts";
import {
  HANDOFF_VERSION,
  EVENT_GENE_CODE_FORMAT,
  EVENT_GENE_CODE_USAGE_POLICY,
  GENE_CODE_REGEX,
  formatEventGeneCode,
  AGENT_PICKUP_FILTER_FIELDS,
  PICKUP_REQUIRED_ALIGNMENT,
  EXCLUDED_ALIGNMENT_STATUSES,
  isPickupEligible,
  RUN_IDEMPOTENCY_RULES,
  classifyRunForIdempotency,
  EVENT_ID_SEMANTICS,
  isEventIdAGroupingKey,
  CONSUMPTION_MARKER,
} from "../agentHandoffContract.js";

describe("fragmentIngestionService contract", () => {
  it("exposes the four Phase 5 fragment types", () => {
    expect(FRAGMENT_TYPES).toEqual(["image", "document", "audio", "text"]);
  });

  it("exposes the six unified actions", () => {
    expect(ACTIONS.has("captureFragment")).toBe(true);
    expect(ACTIONS.has("getFragmentStatus")).toBe(true);
    expect(ACTIONS.has("listFragments")).toBe(true);
    expect(ACTIONS.has("retryFragment")).toBe(true);
    expect(ACTIONS.has("processFragment")).toBe(true);
    expect(ACTIONS.has("dispatchToComposition")).toBe(true);
  });

  it("pins adapter/alignment versions for traceability", () => {
    expect(ADAPTER_VERSION).toBe("phase5.adapter.v1");
    expect(ALIGNMENT_VERSION).toBe("phase5.alignment.v1");
  });

  it("computes ingestion key as clinic_id::client_request_id", () => {
    expect(computeIngestionKey("clinic-001", "req-abc")).toBe("clinic-001::req-abc");
  });

  it("identifies test clinics by phase5-it- prefix", () => {
    expect(isTestClinic("phase5-it-abc")).toBe(true);
    expect(isTestClinic("clinic-001")).toBe(false);
    expect(isTestClinic("phase4-it-abc")).toBe(false);
  });

  it("maps fragment types to legacy artifact types without breaking Phase 1–4", () => {
    expect(mapFragmentTypeToArtifactType("image")).toBe("image");
    expect(mapFragmentTypeToArtifactType("document")).toBe("file");
    expect(mapFragmentTypeToArtifactType("audio")).toBe("voice");
    expect(mapFragmentTypeToArtifactType("text")).toBe("text");
  });

  it("sanitizes unknown error codes to internal_error", () => {
    expect(sanitizeErrorCode("tenant_scope_violation")).toBe("tenant_scope_violation");
    expect(sanitizeErrorCode("not_a_real_code")).toBe("internal_error");
    expect(sanitizeErrorCode(undefined)).toBe("internal_error");
  });

  it("allowlist blocks raw exception leakage", () => {
    expect(ALLOWED_ERROR_CODES.has("stack_trace")).toBe(false);
    expect(ALLOWED_ERROR_CODES.has("SyntaxError")).toBe(false);
    expect(ALLOWED_ERROR_CODES.has("tenant_scope_violation")).toBe(true);
  });

  it("caps retry attempts", () => {
    expect(MAX_RETRY_ATTEMPTS).toBe(3);
  });
});

describe("Phase 5 two-stage async handoff contract", () => {
  it("pins a handoff version for traceability", () => {
    expect(typeof HANDOFF_VERSION).toBe("string");
    expect(HANDOFF_VERSION.startsWith("phase5.handoff.")).toBe(true);
  });

  // ── 约束 1：event_gene_code 仅展示/日志/追溯 ──
  it("forbids event_gene_code as a grouping-decision input", () => {
    expect(EVENT_GENE_CODE_USAGE_POLICY.forbidden).toContain("grouping_decision");
    expect(EVENT_GENE_CODE_USAGE_POLICY.forbidden).toContain("business_logic_parse");
    expect(EVENT_GENE_CODE_USAGE_POLICY.allowed).toContain("display");
    expect(EVENT_GENE_CODE_USAGE_POLICY.allowed).toContain("log_search");
    expect(EVENT_GENE_CODE_USAGE_POLICY.allowed).toContain("human_traceability");
  });

  it("formats event_gene_code with the agreed segment order", () => {
    const code = formatEventGeneCode({
      clinic_id: "clinic-001",
      business_date: "2026-07-20",
      department: "optometry",
      staff_id: "staff-abcdef123",
      fragment_type: "image",
      seq: 3,
    });
    expect(code).toBe("clinic-001/2026-07-20/optometry/def123/image/0003");
    expect(GENE_CODE_REGEX.test(code)).toBe(true);
  });

  it("masks staff id to last 6 alnum chars and pads seq to 4 digits", () => {
    const code = formatEventGeneCode({
      clinic_id: "clinic-001",
      business_date: "2026-07-20",
      department: "reception",
      staff_id: "us-east-1|staff-XYZ",
      fragment_type: "text",
      seq: 12,
    });
    expect(code).toBe("clinic-001/2026-07-20/reception/affxyz/text/0012");
  });

  it("does not embed client_request_id in event_gene_code", () => {
    const code = formatEventGeneCode({
      clinic_id: "clinic-001",
      business_date: "2026-07-20",
      department: "optometry",
      staff_id: "abcdef",
      fragment_type: "image",
      seq: 1,
      client_request_id: "req-secret-uuid",
    });
    expect(code).not.toContain("req-secret-uuid");
  });

  // ── 约束 2：取货范围必须同时满足全部条件 ──
  it("requires the four structured pickup-filter fields", () => {
    expect(AGENT_PICKUP_FILTER_FIELDS).toEqual([
      "clinic_id",
      "assembly_eligible",
      "alignment_status",
      "ingestion_seq",
    ]);
  });

  it("isPickupEligible returns true only when all five conditions hold", () => {
    const factCard = {
      clinic_id: "phase5-it-1",
      assembly_eligible: true,
      alignment_status: "aligned",
      artifact_id: "art-1",
    };
    const artifact = { id: "art-1", ingestion_seq: 5 };
    expect(
      isPickupEligible({
        factCard,
        artifact,
        clinicId: "phase5-it-1",
        cutoffEventSeq: 5,
        completedArtifactIds: [],
      })
    ).toBe(true);
  });

  it("isPickupEligible rejects tenant mismatch", () => {
    expect(
      isPickupEligible({
        factCard: { clinic_id: "phase5-it-1", assembly_eligible: true, alignment_status: "aligned", artifact_id: "a" },
        artifact: { id: "a", ingestion_seq: 1 },
        clinicId: "phase5-it-2",
        cutoffEventSeq: 10,
        completedArtifactIds: [],
      })
    ).toBe(false);
  });

  it("isPickupEligible rejects assembly_eligible=false", () => {
    expect(
      isPickupEligible({
        factCard: { clinic_id: "c", assembly_eligible: false, alignment_status: "aligned", artifact_id: "a" },
        artifact: { id: "a", ingestion_seq: 1 },
        clinicId: "c",
        cutoffEventSeq: 10,
        completedArtifactIds: [],
      })
    ).toBe(false);
  });

  it("isPickupEligible rejects non-aligned status (excludes needs_clarification/failed/rejected)", () => {
    for (const status of EXCLUDED_ALIGNMENT_STATUSES) {
      expect(
        isPickupEligible({
          factCard: { clinic_id: "c", assembly_eligible: true, alignment_status: status, artifact_id: "a" },
          artifact: { id: "a", ingestion_seq: 1 },
          clinicId: "c",
          cutoffEventSeq: 10,
          completedArtifactIds: [],
        })
      ).toBe(false);
    }
  });

  it("isPickupEligible rejects artifacts later than cutoff", () => {
    expect(
      isPickupEligible({
        factCard: { clinic_id: "c", assembly_eligible: true, alignment_status: "aligned", artifact_id: "a" },
        artifact: { id: "a", ingestion_seq: 11 },
        clinicId: "c",
        cutoffEventSeq: 10,
        completedArtifactIds: [],
      })
    ).toBe(false);
  });

  it("isPickupEligible rejects artifacts already in a completed run", () => {
    expect(
      isPickupEligible({
        factCard: { clinic_id: "c", assembly_eligible: true, alignment_status: "aligned", artifact_id: "a" },
        artifact: { id: "a", ingestion_seq: 1 },
        clinicId: "c",
        cutoffEventSeq: 10,
        completedArtifactIds: ["a"],
      })
    ).toBe(false);
  });

  it("isPickupEligible rejects missing ingestion_seq (Stage 2 prerequisite gap)", () => {
    expect(
      isPickupEligible({
        factCard: { clinic_id: "c", assembly_eligible: true, alignment_status: "aligned", artifact_id: "a" },
        artifact: { id: "a" },
        clinicId: "c",
        cutoffEventSeq: 10,
        completedArtifactIds: [],
      })
    ).toBe(false);
  });

  it("pins the required alignment value to aligned", () => {
    expect(PICKUP_REQUIRED_ALIGNMENT).toBe("aligned");
  });

  // ── 约束 3：防重规则区分运行结果 ──
  it("classifies completed runs as processed-no-repeat", () => {
    expect(RUN_IDEMPOTENCY_RULES.completed).toBe("processed_no_repeat");
    expect(classifyRunForIdempotency("completed")).toBe("processed_no_repeat");
  });

  it("classifies running/pending as same-key-existing-run", () => {
    expect(RUN_IDEMPOTENCY_RULES.running).toBe("same_key_existing_run");
    expect(RUN_IDEMPOTENCY_RULES.pending).toBe("same_key_existing_run");
    expect(classifyRunForIdempotency("running")).toBe("same_key_existing_run");
    expect(classifyRunForIdempotency("pending")).toBe("same_key_existing_run");
  });

  it("classifies failed as safe-retry (no permanent loss)", () => {
    expect(RUN_IDEMPOTENCY_RULES.failed).toBe("safe_retry");
    expect(classifyRunForIdempotency("failed")).toBe("safe_retry");
  });

  // ── 约束 4：解析异常不进入编组池 ──
  it("excludes needs_clarification/failed/rejected from the pickup pool", () => {
    expect(EXCLUDED_ALIGNMENT_STATUSES).toEqual(
      expect.arrayContaining(["needs_clarification", "failed", "rejected"])
    );
  });

  // ── 约束 5：不得以 assembly_eligible=false 表示消费 ──
  it("forbids assembly_eligible=false as a consumption marker", () => {
    expect(CONSUMPTION_MARKER.forbidden).toBe("EvidenceFactCard.assembly_eligible=false");
    expect(CONSUMPTION_MARKER.allowed).toContain("CompositionRun.artifact_ids_processed");
  });

  // ── 约束 6：溯源事件 ID 语义分离 ──
  it("separates source_event_id (nullable business event) from ingestion_event_id (non-null audit)", () => {
    expect(EVENT_ID_SEMANTICS.source_event_id.nullable).toBe(true);
    expect(EVENT_ID_SEMANTICS.ingestion_event_id.nullable).toBe(false);
    expect(EVENT_ID_SEMANTICS.grouping_key).toBe(false);
    expect(isEventIdAGroupingKey()).toBe(false);
  });
});