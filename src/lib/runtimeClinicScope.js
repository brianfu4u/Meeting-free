export const DEFAULT_CLINIC_ID = "clinic-001";

const SAFE_TEST_CLINIC = /^phase5-it-e2e-[0-9a-f-]{36}$/i;

/**
 * Resolve the dashboard tenant for an isolated live E2E run.
 *
 * Production remains pinned to clinic-001. A URL override is accepted only for
 * the randomized phase5 live-E2E tenant shape, so an arbitrary clinic_id cannot
 * be injected through the browser location.
 */
export function resolveRuntimeClinicId(locationLike = globalThis.location) {
  if (!locationLike || typeof locationLike.search !== "string") {
    return DEFAULT_CLINIC_ID;
  }
  const requested = new URLSearchParams(locationLike.search).get("clinic_id") || "";
  return SAFE_TEST_CLINIC.test(requested) ? requested : DEFAULT_CLINIC_ID;
}

export function isSafeLiveE2EClinicId(clinicId) {
  return SAFE_TEST_CLINIC.test(String(clinicId || ""));
}
