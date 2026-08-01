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
    expect(staffReport).toContain("bridge failure must never fail the employee report");
  });

  it("pins seven-track, candidate ranking and Guardrail runtime files to the main baseline", () => {
    const expected = {
      "base44/functions/compositionOrchestrator/runtimeAdapter.ts": "17175de97f6da1d4622a38a6a7b713d8205a8cb4",
      "base44/functions/compositionOrchestrator/runtime/candidateFinder.js": "8077223bd00372df371ae3cc434a6693d5a87ecc",
      "base44/functions/compositionOrchestrator/runtime/guardrailValidator.js": "8ee1aba674d9cf232aafc7cab7ab717d5923bb8a",
      "base44/functions/compositionOrchestrator/runtime/workflowAssembly.js": "2df2e7867ad20d6315079749b05138890925001f",
      "base44/functions/compositionOrchestrator/service.ts": "45cfd4b7c7483b9c2c5692d7dfe962fd411589a2",
    };
    for (const [relative, sha] of Object.entries(expected)) {
      expect(gitBlobSha(read(relative)), relative).toBe(sha);
    }
  });
});
