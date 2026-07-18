import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const entry = fs.readFileSync(
  path.join(root, "base44/functions/compositionOrchestrator/entry.ts"),
  "utf8"
);

describe("compositionOrchestrator deployable entry contract", () => {
  it("derives identity and clinic membership on the server", () => {
    expect(entry).toContain("base44.auth.me()");
    expect(entry).toContain("svc.entities.Staff.filter");
    expect(entry).toContain("user_id: user.id");
    expect(entry).toContain("actor.clinic_id");
  });

  it("uses the parity-checked runtime adapter", () => {
    expect(entry).toContain('from "./runtimeAdapter.ts"');
    expect(entry).toContain("executeCompositionRuntime");
    expect(entry).toContain("interpretArtifactRuntime");
  });

  it("implements owner-scoped CAS lease using updated===1", () => {
    expect(entry).toContain("composition_run_lock_owner_id");
    expect(entry).toContain("composition_run_lock_expires_at");
    expect(entry).toContain("first?.updated === 1");
    expect(entry).toContain("takeover?.updated === 1");
  });

  it("does not expose commit or write authoritative workflow decisions", () => {
    expect(entry).not.toContain('action === "commit"');
    expect(entry).not.toContain("WorkflowCommitIntent.create");
    expect(entry).not.toContain("ManagerDecision.create");
    expect(entry).not.toContain("WorkflowSnapshot.create");
    expect(entry).not.toContain("Workflow.update(");
  });

  it("does not return raw exception messages", () => {
    expect(entry).not.toContain("(error as Error).message");
    expect(entry).not.toContain("String((e as Error)");
    expect(entry).toContain('"composition_orchestrator_failed"');
  });
});
