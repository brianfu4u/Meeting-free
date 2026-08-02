// Pure validation utilities — no Deno-specific APIs, safe for vitest.
import {
  FRAGMENT_TYPES,
  FRAGMENT_TYPE_SET,
  LIMITS,
  MIME_WHITELIST,
  FORBIDDEN_EXTENSIONS,
  FORBIDDEN_MIME_PREFIXES,
} from "../../shared/fragmentIngestion/contract.ts";

export function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateFragmentType(type) {
  if (!isNonEmptyString(type)) return { ok: false, reason: "fragment_type_required" };
  if (!FRAGMENT_TYPE_SET.has(type)) return { ok: false, reason: "fragment_type_invalid" };
  return { ok: true };
}

export function validateClientRequestId(id) {
  if (!isNonEmptyString(id)) return { ok: false, reason: "client_request_id_required" };
  if (id.length > LIMITS.MAX_CLIENT_REQUEST_ID_LEN) {
    return { ok: false, reason: "client_request_id_too_long" };
  }
  return { ok: true };
}

export function validateUploadUrl(url, allowedDomains) {
  if (!isNonEmptyString(url)) return { ok: false, reason: "file_url_required" };
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "url_invalid" };
  }
  if (parsed.protocol !== "https:") return { ok: false, reason: "url_not_https" };
  const host = parsed.hostname.toLowerCase();
  // 平台自有存储域名始终可信（files./uploads./media. 等 *.base44.com / *.base44.dev 子域），
  // 不受 BASE44_UPLOAD_DOMAIN 秘钥覆盖影响 —— 秘钥仅用于追加外部自定义域名。
  const PLATFORM_TRUSTED = [".base44.com", ".base44.dev", ".base44.app"];
  const isPlatformTrusted = PLATFORM_TRUSTED.some((s) => host === s.slice(1) || host.endsWith(s));
  if (isPlatformTrusted) return { ok: true };
  const allow = (allowedDomains || []).filter(Boolean);
  if (allow.length === 0) return { ok: false, reason: "url_not_whitelisted" };
  const ok = allow.some((d) => host === d || host.endsWith("." + d));
  if (!ok) return { ok: false, reason: "url_not_whitelisted" };
  return { ok: true };
}

export function validateMimeType(fragmentType, claimed) {
  if (!isNonEmptyString(claimed)) return { ok: false, reason: "mime_type_required" };
  const lower = claimed.toLowerCase();
  if (FORBIDDEN_MIME_PREFIXES.some((p) => lower.startsWith(p))) {
    return { ok: false, reason: "mime_forbidden" };
  }
  // 去除参数后缀（如 ;codecs=opus），仅匹配基础 MIME
  const base = lower.split(";")[0].trim();
  const whitelist = MIME_WHITELIST[fragmentType] || [];
  if (whitelist.includes(base)) return { ok: true };
  // 兼容：浏览器 MediaRecorder 音频录音常以 video/* 容器封装音频，
  // audio 片段视作可转写音频放行（video/webm / video/mp4 / video/x-matroska / audio/ogg）
  if (fragmentType === "audio" && (base === "video/webm" || base === "video/mp4" || base === "video/x-matroska" || base === "audio/ogg")) {
    if (whitelist.includes("audio/webm") || whitelist.includes("audio/m4a") || whitelist.includes("audio/mp4")) return { ok: true };
  }
  return { ok: false, reason: "mime_not_supported" };
}

export function validateFilename(filename) {
  if (!filename) return { ok: true };
  if (typeof filename !== "string") return { ok: false, reason: "filename_forbidden" };
  const lower = filename.toLowerCase();
  if (FORBIDDEN_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return { ok: false, reason: "filename_forbidden" };
  }
  return { ok: true };
}

export function validateFileSize(fragmentType, size) {
  if (fragmentType === "text") return { ok: true };
  if (size == null || typeof size !== "number" || size <= 0) {
    return { ok: false, reason: "size_required" };
  }
  const limit =
    fragmentType === "image" ? LIMITS.MAX_IMAGE_BYTES
    : fragmentType === "document" ? LIMITS.MAX_DOCUMENT_BYTES
    : fragmentType === "audio" ? LIMITS.MAX_AUDIO_BYTES
    : LIMITS.MAX_TEXT_CHARS;
  if (size > limit) return { ok: false, reason: "file_too_large" };
  return { ok: true };
}

export function validateTextContent(text) {
  if (!isNonEmptyString(text)) return { ok: false, reason: "text_empty" };
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, reason: "text_empty" };
  if (text.length > LIMITS.MAX_TEXT_CHARS) return { ok: false, reason: "text_too_long" };
  return { ok: true, normalized: trimmed };
}

export function sanitizeFilename(filename) {
  if (!isNonEmptyString(filename)) return null;
  const base = filename.split(/[\\/]/).pop() || filename;
  return base.slice(0, 200);
}

export function assertTenantScope(clinicId, ...objects) {
  if (!isNonEmptyString(clinicId)) return false;
  for (const obj of objects) {
    if (obj == null) continue;
    if (typeof obj !== "object") return false;
    const rec = obj;
    const c = rec.clinic_id;
    if (!isNonEmptyString(c)) return false;
    if (c !== clinicId) return false;
  }
  return true;
}