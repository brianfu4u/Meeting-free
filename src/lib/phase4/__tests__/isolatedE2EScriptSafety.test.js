import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(here, "../../../../scripts/phase4-isolated-e2e.mjs");
const source = fs.readFileSync(scriptPath, "utf8");

describe("Phase 4 isolated E2E script safety", () => {
  it("requires a randomized phase4-it tenant and blocks clinic-001", () => {
    expect(source).toContain('const TEST_PREFIX = "phase4-it-"');
    expect(source).toContain('new Set(["clinic-001"])');
    expect(source).toContain('assert(!FORBIDDEN_CLINICS.has(clinicId), "production_clinic_forbidden")');
  });

  it("keeps the scheduler disabled in the fixture and never starts a global scan", () => {
    expect(source).toContain("composition_schedule_enabled: false");
    expect(source).not.toContain("scheduled_scan");
  });

  it("never invokes review or commit", () => {
    expect(source).not.toMatch(/action:\s*["']review["']/);
    expect(source).not.toMatch(/action:\s*["']commit["']/);
  });

  it("cleans only exact ids and verifies zero residue", () => {
    expect(source).toContain("exactIds.get(entityName).add(String(record.id))");
    expect(source).toContain("base44.entities[entityName].delete(id)");
    expect(source).toContain("Object.values(report.after_cleanup).every((count) => count === 0)");
  });
});
