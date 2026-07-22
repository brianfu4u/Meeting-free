import { Buffer } from "buffer";
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


const phase3Mirrors = {
  "src/lib/phase3/contract.js": {
    mirror: "phase3Contract.js",
    blob: "d7cf563cd2fdf8da6e7bbb85dbbfb3df7eccca6b",
  },
  "src/lib/phase3/orchestratorCore.js": {
    mirror: "orchestratorCore.js",
    blob: "025ef158a00f139f2b785bc6f06edc257aed6341",
  },
};

describe("Phase 3 generated runtime mirror parity", () => {
  for (const [source, config] of Object.entries(phase3Mirrors)) {
    it(`${config.mirror} is pinned to and matches ${source}`, () => {
      const sourceContent = fs.readFileSync(path.join(root, source), "utf8");
      expect(gitBlobSha(sourceContent)).toBe(config.blob);
      const generated = fs.readFileSync(path.join(mirrorDir, config.mirror), "utf8");
      const lines = generated.split("\n");
      expect(lines[0]).toBe(
        `// GENERATED_PHASE3_MIRROR source=${source} blob=${config.blob}`
      );
      const body = lines.slice(2).join("\n")
        .replaceAll('from "./tenantContext.js";', 'from "../tenant/tenantContext";')
        .replaceAll('from "./phase3Contract.js";', 'from "./contract";')
        .replaceAll('from "./triggerCore.js";', 'from "../phase4/triggerCore";');
      expect(body).toBe(sourceContent);
    });
  }
});
