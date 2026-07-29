import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

describe("Direction A live E2E harness safety", () => {
  const shell = read("scripts/phase5-live-e2e.sh");
  const helper = read("scripts/phase5-live-e2e.mjs");

  it("uses a randomized isolated tenant and forbids clinic-001 mutation", () => {
    expect(shell).toContain("phase5-it-e2e-");
    expect(helper).toContain('FORBIDDEN_CLINICS = new Set(["clinic-001"])');
    expect(helper).toContain("production_clinic_forbidden");
    expect(helper).not.toContain('ClinicConfig.update("clinic-001"');
  });

  it("reads actual scheduler state before temporarily changing gates", () => {
    expect(helper).toContain('secretState("COMPOSITION_SCHEDULER_ENABLED")');
    expect(helper).toContain('secretState("COMPOSITION_SCHEDULER_CLINICS")');
    expect(helper).toContain('ClinicConfig.filter({ clinic_id: "clinic-001" })');
    expect(shell.indexOf("ORIGINAL_DIAGNOSIS=")).toBeLessThan(shell.indexOf("base44_cli secrets set"));
  });

  it("restores secrets before exact fixture cleanup", () => {
    const rollback = shell.slice(shell.indexOf("rollback()"));
    expect(rollback.indexOf("restore_one_secret")).toBeGreaterThanOrEqual(0);
    expect(rollback.indexOf("run_mode cleanup")).toBeGreaterThan(rollback.indexOf("restore_one_secret"));
  });

  it("invokes the deployed employee report and scheduled composition paths", () => {
    expect(helper).toContain('base44.functions.invoke("staffReportService"');
    expect(helper).toContain('base44.functions.invoke("compositionOrchestrator"');
    expect(helper).toContain('args: { mode: "scheduled_scan" }');
    expect(helper).toContain("direction_a_not_deployed");
  });

  it("asserts the persisted bridge, seven tracks, attachment and dashboard read model", () => {
    expect(helper).toContain("origin_evidence_item_id");
    expect(helper).toContain("reasoning_tracks_missing");
    expect(helper).toContain("agent_attach_not_committed");
    expect(helper).toContain("snapshot_estimated_completion_missing");
    expect(helper).toContain("dashboard_read_model");
  });

  it("does not add historical EvidenceItem scanning or backfill", () => {
    expect(helper).not.toContain("historical_backfill");
    expect(helper).not.toContain("backfillEvidence");
    expect(shell).not.toContain("migration");
  });
});
