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