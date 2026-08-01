import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateFileSize } from "../../../../base44/functions/fragmentIngestionService/security.ts";
import { ERROR_LABELS } from "../ingestionClient.js";

describe("staff-pad upload metadata contract", () => {
  it("preserves File metadata after Base44 storage upload", () => {
    const sheet = readFileSync("src/components/staffPad/ReportSheet.jsx", "utf8");
    const modal = readFileSync("src/components/staffPad/MetaTaggingModal.jsx", "utf8");

    expect(sheet).toContain('const att = { type: "image", url: file_url, name: f.name, file: f };');
    expect(sheet).toContain('const att = { type: "file", url: file_url, name: f.name, file: f };');
    expect(modal).toContain("file_size: attachment.file?.size ?? null");
    expect(modal).toContain("mime_type: attachment.file?.type");
  });

  it("demonstrates the pre-fix failure and post-fix success", () => {
    expect(validateFileSize("image", null)).toEqual({
      ok: false,
      reason: "size_required",
    });
    expect(validateFileSize("image", 1_887_436)).toEqual({ ok: true });
    expect(ERROR_LABELS.size_required).toContain("文件已上传");
  });
});
