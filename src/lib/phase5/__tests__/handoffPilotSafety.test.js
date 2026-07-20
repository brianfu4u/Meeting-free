import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

describe("Phase 5 scheduler handoff pilot safety", () => {
  const shell = read("scripts/phase5-scheduler-handoff-pilot.sh");
  const helper = read("scripts/phase5-scheduler-handoff-pilot.mjs");
  const ingestion = read("scripts/phase5-isolated-e2e.mjs");
  const entry = read("base44/functions/fragmentIngestionService/entry.ts");

  it("uses the real scheduled_scan path and a randomized isolated clinic", () => {
    expect(helper).toContain('args: { mode: "scheduled_scan" }');
    expect(shell).toContain("phase5-it-handoff-");
    expect(helper).toContain('clinicId !== "clinic-001"');
  });

  it("never patches ingestion_seq in test code", () => {
    expect(helper).not.toContain("patchIngestionSeq");
    expect(ingestion).not.toContain("patchIngestionSeq");
    expect(entry).toContain("ingestion_seq: lastIssuedIngestionSeq");
  });

  it("rolls scheduler secrets back before fixture cleanup", () => {
    const rollback = shell.slice(shell.indexOf("rollback()"));
    expect(rollback.indexOf('secrets delete "$ENABLED_SECRET"')).toBeGreaterThanOrEqual(0);
    expect(rollback.indexOf('secrets delete "$ALLOWLIST_SECRET"')).toBeGreaterThanOrEqual(0);
    expect(rollback.indexOf('export PHASE5_HANDOFF_MODE="cleanup"')).toBeGreaterThan(
      rollback.indexOf('secrets delete "$ALLOWLIST_SECRET"'),
    );
  });

  it("hard-asserts no authoritative workflow side effects", () => {
    for (const assertion of [
      "manager_decision_created", "commit_intent_created", "snapshot_created", "workflow_created",
    ]) expect(helper).toContain(assertion);
  });

  it("checks first scan, replay zero growth, pending review and lock release", () => {
    expect(shell).toContain('run_scan_with_redeploy_wait "first"');
    expect(shell).toContain('run_scan_with_redeploy_wait "replay"');
    expect(helper).toContain("replay_run_growth");
    expect(helper).toContain("auto_review_detected");
    expect(helper).toContain("composition_lock_not_released");
  });
});
