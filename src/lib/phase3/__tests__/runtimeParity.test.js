import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { PHASE2_RUNTIME_SOURCES } from "../../../../base44/functions/compositionOrchestrator/runtimeAdapter.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const mirrorDir = path.join(root, "base44/functions/compositionOrchestrator/runtime");

const mirrors = {
  "src/lib/composition/prompts.js": "prompts.js",
  "src/lib/composition/evidenceInterpreter.js": "evidenceInterpreter.js",
  "src/lib/composition/candidateFinder.js": "candidateFinder.js",
  "src/lib/composition/clustering.js": "clustering.js",
  "src/lib/composition/workflowAssembly.js": "workflowAssembly.js",
  "src/lib/composition/guardrailValidator.js": "guardrailValidator.js",
  "src/lib/tenant/tenantContext.js": "tenantContext.js",
};

function gitBlobSha(content) {
  return createHash("sha1")
    .update(`blob ${Buffer.byteLength(content)}\0`)
    .update(content)
    .digest("hex");
}

function restoreCanonicalImports(content) {
  return content
    .replaceAll('from "./prompts.js";', 'from "./prompts";')
    .replaceAll('from "./tenantContext.js";', 'from "../tenant/tenantContext";');
}

describe("Phase 2 generated runtime mirror parity", () => {
  for (const [source, mirror] of Object.entries(mirrors)) {
    it(`${mirror} is pinned to and matches ${source}`, () => {
      const sourceContent = fs.readFileSync(path.join(root, source), "utf8");
      const expectedBlob = gitBlobSha(sourceContent);
      expect(PHASE2_RUNTIME_SOURCES[source]).toBe(expectedBlob);

      const generated = fs.readFileSync(path.join(mirrorDir, mirror), "utf8");
      const lines = generated.split("\n");
      expect(lines[0]).toBe(
        `// GENERATED_PHASE2_MIRROR source=${source} blob=${expectedBlob}`
      );
      const body = lines.slice(2).join("\n");
      expect(restoreCanonicalImports(body)).toBe(sourceContent);
    });
  }

  it("pins every generated mirror and no extra source", () => {
    expect(Object.keys(PHASE2_RUNTIME_SOURCES).sort())
      .toEqual(Object.keys(mirrors).sort());
  });
});
