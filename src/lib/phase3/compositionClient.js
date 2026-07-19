/**
 * Phase 3 frontend boundary. All manager review/commit traffic goes through
 * compositionOrchestrator; callers never mutate authority entities directly.
 */
export class CompositionApiError extends Error {
  constructor(body = {}, status = null) {
    super(body.error_code || "composition_request_failed");
    this.name = "CompositionApiError";
    this.errorCode = body.error_code || "composition_request_failed";
    this.status = status ?? body.http_status ?? null;
    this.retryable = body.retryable === true;
    this.body = body;
  }
}

export async function invokeComposition(base44, payload) {
  if (!base44?.functions?.invoke) throw new Error("Base44 functions client required");
  if (!payload?.clinic_id) throw new Error("clinic_id required");
  try {
    const response = await base44.functions.invoke("compositionOrchestrator", payload);
    return response?.data ?? response;
  } catch (error) {
    const body = error?.response?.data || {};
    throw new CompositionApiError(body, error?.response?.status ?? null);
  }
}

export function activeHypotheses(hypotheses = []) {
  return hypotheses.filter((item) =>
    ["pending_review", "selected", "dispatched"].includes(item?.status)
  );
}

export function reasoningTrackEntries(reasoningTracks) {
  if (!reasoningTracks || typeof reasoningTracks !== "object") return [];
  return Object.entries(reasoningTracks).map(([trackId, evidence]) => ({
    trackId,
    evidence: Array.isArray(evidence) ? evidence : [],
  }));
}

export function canCommitHypothesis(hypothesis) {
  return hypothesis?.status === "selected" &&
    hypothesis?.composition_type === "attach" &&
    Boolean(hypothesis?.target_workflow_id) &&
    Boolean(hypothesis?.target_snapshot_id) &&
    hypothesis?.target_snapshot_version != null;
}
