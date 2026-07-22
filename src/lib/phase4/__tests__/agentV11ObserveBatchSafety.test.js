import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const template = fs.readFileSync(path.join(root, "scripts/agent-v11-observe-batch.template.mjs"), "utf8");
const builder = fs.readFileSync(path.join(root, "scripts/agent-v11-observe-batch-build.mjs"), "utf8");

describe("Agent v1.1 observation batch safety", () => {
  it("uses randomized isolated tenants and hard-blocks clinic-001", () => {
    expect(template).toContain('const TEST_PREFIX = "agent-v11-it-observe-batch-"');
    expect(template).toContain('new Set(["clinic-001"])');
    expect(builder).toContain('"clinic_id" in scenario');
  });

  it("cannot mutate secrets or request commit authority", () => {
    expect(template).not.toMatch(/secrets\.(set|delete)|AGENT_AUTO_ATTACH_MODE\s*=\s*["']commit/);
    expect(template).toContain('auto_attach_mode === "observe"');
    expect(template).not.toContain('auto_attach_mode: "commit"');
  });

  it("asserts zero authoritative writes and replay growth", () => {
    expect(template).toContain('"observe_link_write"');
    expect(template).toContain('"observe_snapshot_write"');
    expect(template).toContain('"observe_pointer_write"');
    expect(template).toContain('"observe_undo_write"');
    expect(template).toContain('replayCounts[entity] === firstCounts[entity]');
  });

  it("reports aggregate and per-scenario gate distributions", () => {
    expect(template).toContain("sample_count");
    expect(template).toContain("eligible_rate");
    expect(template).toContain("gate_reason_distribution");
    expect(template).toContain("scenario_type_distribution");
  });

  it("cleans exact isolated tenant records", () => {
    expect(template).toContain("CLEANUP_ORDER");
    expect(template).toContain("cleanup_all_zero: true");
    expect(template).toContain("base44.entities[entity].delete(String(record.id))");
  });
});
