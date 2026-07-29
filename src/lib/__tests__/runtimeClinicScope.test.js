import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLINIC_ID,
  isSafeLiveE2EClinicId,
  resolveRuntimeClinicId,
} from "../runtimeClinicScope.js";

describe("runtimeClinicScope", () => {
  const testClinic = "phase5-it-e2e-123e4567-e89b-12d3-a456-426614174000";

  it("defaults production traffic to clinic-001", () => {
    expect(resolveRuntimeClinicId(null)).toBe(DEFAULT_CLINIC_ID);
    expect(resolveRuntimeClinicId({ search: "" })).toBe(DEFAULT_CLINIC_ID);
  });

  it("accepts only the randomized live-E2E tenant shape", () => {
    expect(resolveRuntimeClinicId({ search: `?clinic_id=${testClinic}` })).toBe(testClinic);
    expect(isSafeLiveE2EClinicId(testClinic)).toBe(true);
  });

  it("rejects arbitrary and production tenant URL injection", () => {
    expect(resolveRuntimeClinicId({ search: "?clinic_id=clinic-002" })).toBe(DEFAULT_CLINIC_ID);
    expect(resolveRuntimeClinicId({ search: "?clinic_id=clinic-001" })).toBe(DEFAULT_CLINIC_ID);
    expect(resolveRuntimeClinicId({ search: "?clinic_id=phase5-it-e2e-not-a-uuid" })).toBe(DEFAULT_CLINIC_ID);
  });
});
