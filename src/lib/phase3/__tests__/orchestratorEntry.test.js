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
const service = fs.readFileSync(
  path.join(root, "base44/functions/compositionOrchestrator/service.ts"),
  "utf8"
);

describe("compositionOrchestrator deployable entry contract", () => {
  it("derives identity and clinic membership on the server", () => {
    expect(entry).toContain("base44.auth.me()");
    expect(entry).toContain("svc.entities.Staff.filter");
    expect(entry).toContain("user_id: user.id");
    expect(entry).toContain("actor.clinic_id");
  });

  it("keeps deploy-time types local for Base44 parser compatibility", () => {
    expect(entry).not.toContain('from "./contracts.ts"');
    expect(service).not.toContain('from "./contracts.ts"');
    expect(service).toContain('"review", "commit"');
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

  it("wires the audited attach commit Saga through the pinned runtime", () => {
    expect(entry).toContain("svc.entities.ManagerDecision.create");
    expect(entry).toContain("svc.entities.WorkflowHypothesis.update");
    expect(entry).toContain('from "./runtime/commitRuntime.js"');
    expect(entry).toContain("WorkflowCommitIntent.create");
    expect(entry).toContain("WorkflowSnapshot.create");
    expect(entry).toContain("Workflow.updateMany");
    expect(entry).not.toContain("svc.entities.Workflow.update(");
  });

  it("does not return raw exception messages", () => {
    expect(entry).not.toContain("(error as Error).message");
    expect(entry).not.toContain("String((e as Error)");
    expect(entry).toContain('"composition_orchestrator_failed"');
  });
});
