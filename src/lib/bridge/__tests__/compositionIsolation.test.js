import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

function gitBlobSha(content) {
  const bytes = Buffer.from(content, "utf8");
  return createHash("sha1")
    .update(Buffer.from(`blob ${bytes.length}\0`, "utf8"))
    .update(bytes)
    .digest("hex");
}

describe("evidence bridge composition isolation regression", () => {
  it("does not invoke compositionOrchestrator from the real-time bridge path", () => {
    const bridge = read("base44/shared/evidenceArtifactBridge.ts");
    const staffReport = read("base44/functions/staffReportService/entry.ts");
    expect(bridge).not.toMatch(/from\s+["'][^"']*compositionOrchestrator/);
    expect(bridge).not.toContain('functions.invoke("compositionOrchestrator"');
    expect(staffReport).not.toMatch(/from\s+["'][^"']*compositionOrchestrator/);
    expect(staffReport).not.toContain('functions.invoke("compositionOrchestrator"');
    expect(staffReport).toContain("bridgeEvidenceItemsRealtime");
    expect(staffReport).toContain("employee_report_preserved");
  });

  it("pins seven-track, core-only candidate routing and Guardrail runtime files", () => {
    const expected = {
      "base44/functions/compositionOrchestrator/runtimeAdapter.ts": "676a498d9a9d46f2649ccab88e9ec5c9c05106a8",
      "base44/functions/compositionOrchestrator/runtime/candidateFinder.js": "8e0a221ecc4d642dd02165be1acc0a0a877f2e38",
      "base44/functions/compositionOrchestrator/runtime/guardrailValidator.js": "8ee1aba674d9cf232aafc7cab7ab717d5923bb8a",
      "base44/functions/compositionOrchestrator/runtime/workflowAssembly.js": "2df2e7867ad20d6315079749b05138890925001f",
      "base44/functions/compositionOrchestrator/service.ts": "45cfd4b7c7483b9c2c5692d7dfe962fd411589a2",
    };
    for (const [relative, sha] of Object.entries(expected)) {
      expect(gitBlobSha(read(relative)), relative).toBe(sha);
    }
  });
});
