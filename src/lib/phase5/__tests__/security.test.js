import { describe, expect, it } from "vitest";
import {
  validateClientRequestId,
  validateFilename,
  validateFileSize,
  validateFragmentType,
  validateMimeType,
  validateTextContent,
  validateUploadUrl,
  assertTenantScope,
} from "../../../../base44/functions/fragmentIngestionService/security.ts";
import { DEFAULT_UPLOAD_DOMAINS, LIMITS } from "../../../../base44/shared/fragmentIngestion/contract.ts";

describe("fragmentIngestionService security", () => {
  it("rejects non-https upload URLs", () => {
    const r = validateUploadUrl("http://files.base44.com/x.png", DEFAULT_UPLOAD_DOMAINS);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("url_not_https");
  });

  it("rejects URLs outside the Base44 upload domain allowlist", () => {
    const r = validateUploadUrl("https://evil.example.com/steal.png", DEFAULT_UPLOAD_DOMAINS);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("url_not_whitelisted");
  });

  it("accepts https URLs on whitelisted domains", () => {
    const r = validateUploadUrl("https://files.base44.com/fixture.png", DEFAULT_UPLOAD_DOMAINS);
    expect(r.ok).toBe(true);
  });

  it("rejects fragment types outside the four-modal set", () => {
    expect(validateFragmentType("video").ok).toBe(false);
    expect(validateFragmentType("image").ok).toBe(true);
    expect(validateFragmentType("").ok).toBe(false);
  });

  it("rejects forbidden executable MIME prefixes", () => {
    const r = validateMimeType("image", "application/x-msdownload");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("mime_forbidden");
  });

  it("rejects unsupported MIME for a fragment type", () => {
    const r = validateMimeType("image", "application/pdf");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("mime_not_supported");
  });

  it("accepts whitelisted MIME per fragment type", () => {
    expect(validateMimeType("image", "image/png").ok).toBe(true);
    expect(validateMimeType("document", "application/pdf").ok).toBe(true);
    expect(validateMimeType("audio", "audio/m4a").ok).toBe(true);
  });

  it("rejects forbidden filename extensions", () => {
    expect(validateFilename("payload.exe").ok).toBe(false);
    expect(validateFilename("report.pdf").ok).toBe(true);
    expect(validateFilename("macro.doc").ok).toBe(false);
  });

  it("enforces file size limits per fragment type", () => {
    expect(validateFileSize("image", LIMITS.MAX_IMAGE_BYTES + 1).ok).toBe(false);
    expect(validateFileSize("image", LIMITS.MAX_IMAGE_BYTES).ok).toBe(true);
    expect(validateFileSize("audio", null).ok).toBe(false);
    expect(validateFileSize("text", null).ok).toBe(true);
  });

  it("validates and trims text content with length cap", () => {
    const short = validateTextContent("hello world");
    expect(short.ok).toBe(true);
    expect(short.normalized).toBe("hello world");
    const empty = validateTextContent("   ");
    expect(empty.ok).toBe(false);
    const tooLong = validateTextContent("x".repeat(LIMITS.MAX_TEXT_CHARS + 1));
    expect(tooLong.ok).toBe(false);
  });

  it("enforces tenant scope across objects", () => {
    expect(assertTenantScope("c1", { clinic_id: "c1" })).toBe(true);
    expect(assertTenantScope("c1", { clinic_id: "c2" })).toBe(false);
    expect(assertTenantScope("c1", { clinic_id: "c1" }, { clinic_id: "c1" })).toBe(true);
    expect(assertTenantScope("c1", { clinic_id: "c1" }, { clinic_id: "c2" })).toBe(false);
    expect(assertTenantScope("", { clinic_id: "c1" })).toBe(false);
  });

  it("limits client_request_id length", () => {
    expect(validateClientRequestId("x".repeat(LIMITS.MAX_CLIENT_REQUEST_ID_LEN + 1)).ok).toBe(false);
    expect(validateClientRequestId("valid-req-id").ok).toBe(true);
  });
});