import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const helperPath = path.resolve(here, "../../../../scripts/phase4-scheduler-pilot.mjs");
const wrapperPath = path.resolve(here, "../../../../scripts/phase4-scheduler-pilot.sh");
const helper = fs.readFileSync(helperPath, "utf8");
const wrapper = fs.readFileSync(wrapperPath, "utf8");

describe("Phase 4 isolated scheduler pilot safety", () => {
  it("requires a randomized scheduler test tenant and blocks clinic-001", () => {
    expect(helper).toContain('const TEST_PREFIX = "phase4-it-scheduler-"');
    expect(helper).toContain('new Set(["clinic-001"])');
    expect(helper).toContain("phase4-it-scheduler-[0-9a-f-]{36}");
    expect(helper).toContain('assert(!FORBIDDEN_CLINICS.has(clinicId), "production_clinic_forbidden")');
    expect(wrapper).toContain('PHASE4_TEST_CLINIC_ID="phase4-it-scheduler-');
  });

  it("refuses to overwrite pre-existing scheduler secrets", () => {
    expect(wrapper).toContain('existing_secrets="$(base44_cli secrets list)"');
    expect(wrapper).toContain("scheduler secret already exists; refusing to overwrite it");
    expect(wrapper).toContain('ENABLED_SECRET="COMPOSITION_SCHEDULER_ENABLED"');
    expect(wrapper).toContain('ALLOWLIST_SECRET="COMPOSITION_SCHEDULER_CLINICS"');
  });

  it("uses a single-clinic allowlist and performs first plus replay scans", () => {
    expect(wrapper).toContain('"$ALLOWLIST_SECRET=$PHASE4_TEST_CLINIC_ID"');
    expect(wrapper).toContain('PHASE4_SCAN_EXPECTATION="first"');
    expect(wrapper).toContain('PHASE4_SCAN_EXPECTATION="replay"');
    expect(helper).toContain('args: { mode: "scheduled_scan" }');
    expect(helper).toContain('assert(result?.scanned === 1, "allowlist_not_single_clinic")');
    expect(helper).toContain('assert(item?.idempotent === (scanExpectation === "replay")');
  });

  it("rolls back secrets before cleaning data on success and failure", () => {
    const rollbackStart = wrapper.indexOf("rollback() {");
    const secretDelete = wrapper.indexOf('base44_cli secrets delete "$ENABLED_SECRET" "$ALLOWLIST_SECRET"', rollbackStart);
    const cleanupMode = wrapper.indexOf('export PHASE4_PILOT_MODE="cleanup"', rollbackStart);
    expect(rollbackStart).toBeGreaterThanOrEqual(0);
    expect(secretDelete).toBeGreaterThan(rollbackStart);
    expect(cleanupMode).toBeGreaterThan(secretDelete);
    expect(wrapper).toContain("trap on_exit EXIT INT TERM");
    expect(wrapper).toContain("rollback || status=1");
  });

  it("never invokes review or commit and asserts the human boundary", () => {
    expect(helper).not.toMatch(/action:\s*["']review["']/);
    expect(helper).not.toMatch(/action:\s*["']commit["']/);
    expect(helper).toContain('row.status === "pending_review"');
    expect(helper).toContain('all.ManagerDecision.length === 0');
    expect(helper).toContain('all.WorkflowCommitIntent.length === 0');
    expect(helper).toContain('all.WorkflowSnapshot.length === 0');
    expect(helper).toContain('all.Workflow.length === 0');
  });

  it("deletes exact ids only and verifies all 12 entity counts are zero", () => {
    expect(helper).toContain(".map((record) => String(record.id)).filter(Boolean)");
    expect(helper).toContain("base44.entities[entityName].delete(id)");
    expect(helper).toContain('Object.values(after).every((count) => count === 0)');
    expect(helper).toContain('"ClinicConfig"');
  });
});
