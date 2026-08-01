import { base44 } from "@/api/base44Client";

function unwrap(response) {
  return response?.data ?? response;
}

/**
 * Internal management client. No UI is added in Phase 2; callers may use this
 * from an admin/QA tool or console-backed management workflow.
 */
export async function getEyeExamParsingQualityOverview({
  clinic_id,
  days = 7,
  top_n = 10,
}) {
  if (!clinic_id) throw new Error("clinic_id required");
  const result = unwrap(await base44.functions.invoke("eyeExamMetadataService", {
    action: "getQualityOverview",
    clinic_id,
    days,
    top_n,
  }));
  if (result?.ok === false) {
    const error = new Error(result.error_code || "eye_exam_quality_overview_failed");
    error.error_code = result.error_code;
    throw error;
  }
  return result?.overview || null;
}
