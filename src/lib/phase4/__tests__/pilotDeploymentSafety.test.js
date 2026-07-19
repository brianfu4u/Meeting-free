import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const functionConfig = JSON.parse(
  fs.readFileSync(
    path.join(root, "base44/functions/compositionOrchestrator/function.jsonc"),
    "utf8"
  )
);
const entry = fs.readFileSync(
  path.join(root, "base44/functions/compositionOrchestrator/entry.ts"),
  "utf8"
);
const runbook = fs.readFileSync(
  path.join(root, "docs/PHASE4_PILOT_RUNBOOK.md"),
  "utf8"
);

describe("Phase 4 pilot deployment safety", () => {
  it("does not activate the scheduler in source control", () => {
    expect(functionConfig.automations[0].is_active).toBe(false);
  });

  it("keeps server enablement and clinic allowlist outside source control", () => {
    expect(entry).toContain('Deno.env.get("COMPOSITION_SCHEDULER_ENABLED")');
    expect(entry).toContain('Deno.env.get("COMPOSITION_SCHEDULER_CLINICS")');
    expect(entry).not.toContain("COMPOSITION_SCHEDULER_ENABLED=true");
    expect(entry).not.toContain("COMPOSITION_SCHEDULER_CLINICS=clinic-001");
  });

  it("documents rollback without entity deletion", () => {
    expect(runbook).toContain('"composition_schedule_enabled": false');
    expect(runbook).toContain('"composition_rollout_status": "disabled"');
    expect(runbook).toContain("Do not delete runs");
  });

  it("requires a separately named approval for clinic-001", () => {
    expect(runbook).toContain("clinic-001");
    expect(runbook).toContain("separate explicit approval");
  });
});
