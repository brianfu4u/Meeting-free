import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const entry = fs.readFileSync(
  path.join(root, "base44/functions/compositionOrchestrator/entry.ts"),
  "utf8"
);
const config = JSON.parse(
  fs.readFileSync(
    path.join(root, "base44/functions/compositionOrchestrator/function.jsonc"),
    "utf8"
  )
);
const canonical = fs.readFileSync(
  path.join(root, "src/lib/phase4/schedulerCore.js"),
  "utf8"
);
const mirror = fs.readFileSync(
  path.join(root, "base44/functions/compositionOrchestrator/runtime/schedulerCore.js"),
  "utf8"
);
const healthCanonical = fs.readFileSync(
  path.join(root, "src/lib/phase4/schedulerHealth.js"),
  "utf8"
);
const healthMirror = fs.readFileSync(
  path.join(root, "base44/functions/compositionOrchestrator/runtime/schedulerHealth.js"),
  "utf8"
);

describe("Phase 4 scheduler deployment contract", () => {
  it("ships the automation inactive", () => {
    expect(config.automations).toHaveLength(1);
    expect(config.automations[0]).toMatchObject({
      type: "scheduled",
      function_args: { mode: "scheduled_scan" },
      is_active: false,
      repeat_unit: "minutes",
      repeat_interval: 5,
    });
  });

  it("requires both server enablement and an allowlist", () => {
    expect(entry).toContain('Deno.env.get("COMPOSITION_SCHEDULER_ENABLED") === "true"');
    expect(entry).toContain('Deno.env.get("COMPOSITION_SCHEDULER_CLINICS")');
    expect(entry).toContain(".slice(0, 10)");
    expect(entry).toContain("if (!enabled || allowlist.length === 0)");
  });

  it("the scheduler invokes run only and never review or commit", () => {
    expect(canonical).toContain('action: "run"');
    expect(canonical).not.toContain('action: "review"');
    expect(canonical).not.toContain('action: "commit"');
  });

  it("keeps the deployed runtime mirror identical to the canonical module", () => {
    const stripped = mirror
      .replace(/^\/\/ GENERATED_PHASE4_MIRROR.*\n/, "")
      .replace(/^\/\/ Keep behavior identical.*\n/, "");
    expect(stripped).toBe(canonical);
  });
  
  it("keeps scheduler health mirror identical and stores only safe errors", () => {
    const stripped = healthMirror
      .replace(/^\/\/ GENERATED_PHASE4_MIRROR.*\n/, "")
      .replace(/^\/\/ Keep behavior identical.*\n/, "");
    expect(stripped).toBe(healthCanonical);
    expect(entry).toContain("buildSchedulerHealthPatch");
    expect(entry).toContain("sanitizeSchedulerErrorCode");
    expect(entry).not.toContain("error_message:");
  });
});
