/* eslint-env node */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const scriptPath = path.resolve(process.cwd(), "scripts/agent-v11-observe-pilot.mjs");
const source = fs.readFileSync(scriptPath, "utf8");

describe("Agent v1.1 observe pilot safety", () => {
  it("hard-blocks production clinic ids and requires a randomized isolated prefix", () => {
    expect(source).toContain('const TEST_PREFIX = "agent-v11-it-observe-"');
    expect(source).toContain('new Set(["clinic-001"])');
    expect(source).toContain("crypto.randomUUID()");
    expect(source).toContain("assertSafeClinic()");
  });

  it("tests observation without changing secrets or enabling commit authority", () => {
    expect(source).toContain('mode_expected: "observe"');
    expect(source).toContain('auto_attach_mode === "observe"');
    expect(source).not.toContain("secrets set");
    expect(source).not.toContain("AGENT_AUTO_ATTACH_MODE=commit");
  });

  it("asserts every authoritative projection remains unchanged", () => {
    expect(source).toContain('"WorkflowArtifactLink"');
    expect(source).toContain("link_created_in_observe");
    expect(source).toContain("snapshot_created_in_observe");
    expect(source).toContain("workflow_pointer_changed");
    expect(source).toContain("undo_resolved_in_observe");
  });

  it("requires idempotent replay and exact tenant cleanup", () => {
    expect(source).toContain("replay_not_idempotent");
    expect(source).toContain("intent_grew_on_replay");
    expect(source).toContain("cleanup_residue");
    expect(source).toContain("cleanup_all_zero");
  });
});