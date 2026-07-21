// FragmentIngestionService contracts — Clinic OS Phase 5
// Authoritative for action names, idempotency key, tenant scope, security limits.
// Do NOT modify Phase 1–4 composition rules from this layer.

export const FRAGMENT_TYPES = ["image", "document", "audio", "text"];
export const FRAGMENT_TYPE_SET = new Set(FRAGMENT_TYPES);

export const ACTIONS = new Set([
  "captureFragment",
  "getFragmentStatus",
  "listFragments",
  "retryFragment",
  "processFragment",
  "dispatchToComposition",
]);

export const ADAPTER_VERSION = "phase5.adapter.v1";
export const ALIGNMENT_VERSION = "phase5.alignment.v1";
export const INTERPRETER_VERSION = "phase5.interpreter.v1";
export const PROMPT_VERSION = "phase5.prompt.v1";

export const PROCESSING_STATUS = {
  pending: "pending",
  processing: "processing",
  aligned: "aligned",
  needs_clarification: "needs_clarification",
  failed: "failed",
  rejected: "rejected",
};

export const ALIGNMENT_STATUS = {
  aligned: "aligned",
  needs_clarification: "needs_clarification",
  rejected: "rejected",
  failed: "failed",
};

export const ATTENTION_TYPE_EVIDENCE_MISSING = "evidence_missing";

export const TEST_CLINIC_PREFIX = "phase5-it-";

export const MAX_RETRY_ATTEMPTS = 3;

export const LIMITS = {
  MAX_IMAGE_BYTES: 20 * 1024 * 1024,
  MAX_DOCUMENT_BYTES: 25 * 1024 * 1024,
  MAX_AUDIO_BYTES: 25 * 1024 * 1024,
  MAX_AUDIO_DURATION_MS: 10 * 60 * 1000,
  MAX_TEXT_CHARS: 8000,
  MAX_CLIENT_REQUEST_ID_LEN: 128,
};

export const MIME_WHITELIST = {
  image: ["image/jpeg", "image/jpg", "image/png", "image/heic", "image/webp"],
  document: [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv",
    "text/plain",
  ],
  audio: [
    "audio/m4a",
    "audio/mp3",
    "audio/x-m4a",
    "audio/wav",
    "audio/x-wav",
    "audio/webm",
    "audio/mpeg",
    "audio/x-mp3",
  ],
  text: ["text/plain"],
};

export const FORBIDDEN_EXTENSIONS = [
  ".exe", ".bat", ".sh", ".cmd", ".com", ".scr", ".js", ".mjs", ".vbs",
  ".dll", ".so", ".bin", ".apk", ".jar", ".msi", ".doc", ".xls", ".ppt",
  ".ps1", ".app", ".hta", ".cpl",
];

export const FORBIDDEN_MIME_PREFIXES = [
  "application/x-msdownload",
  "application/x-executable",
  "application/x-dosexec",
  "application/x-sh",
  "application/javascript",
  "text/javascript",
];

export const DEFAULT_UPLOAD_DOMAINS = [
  "files.base44.com",
  "uploads.base44.com",
  "files.base44.dev",
  "media.base44.com",
];

export const ALLOWED_ERROR_CODES = new Set([
  "tenant_scope_violation",
  "idempotency_conflict",
  "fragment_type_required",
  "fragment_type_invalid",
  "client_request_id_required",
  "client_request_id_too_long",
  "source_required",
  "file_url_required",
  "mime_type_required",
  "url_not_https",
  "url_invalid",
  "url_not_whitelisted",
  "mime_not_supported",
  "mime_forbidden",
  "filename_forbidden",
  "file_too_large",
  "text_too_long",
  "text_empty",
  "size_required",
  "artifact_not_found",
  "processing_not_found",
  "action_invalid",
  "action_not_allowed",
  "adapter_failed",
  "alignment_failed",
  "quality_gate_failed",
  "dispatch_not_allowed",
  "dispatch_test_clinic_required",
  "method_not_allowed",
  "unauthenticated",
  "staff_not_bound",
  "staff_inactive",
  "fragment_already_failed",
  "fragment_not_retryable",
  "retry_limit_reached",
  "internal_error",
]);

export function computeIngestionKey(clinicId, clientRequestId) {
  return `${clinicId}::${clientRequestId}`;
}

export function isTestClinic(clinicId) {
  return typeof clinicId === "string" && clinicId.startsWith(TEST_CLINIC_PREFIX);
}

export function isHttpOk(status) {
  return status >= 200 && status < 300;
}

export function makeResponse(httpStatus, body) {
  return { ok: isHttpOk(httpStatus), http_status: httpStatus, ...body };
}

export function sanitizeErrorCode(code) {
  if (typeof code === "string" && ALLOWED_ERROR_CODES.has(code)) return code;
  return "internal_error";
}

export function mapFragmentTypeToArtifactType(fragmentType) {
  if (fragmentType === "image") return "image";
  if (fragmentType === "document") return "file";
  if (fragmentType === "audio") return "voice";
  if (fragmentType === "text") return "text";
  return "file";
}