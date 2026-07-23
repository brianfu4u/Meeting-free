import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { executeAgentAutoAttachSaga as executeCanonical } from "../agentAutoAttachSaga";
import { executeAgentAutoAttachSaga as executeRuntime } from "../../../../base44/functions/compositionOrchestrator/runtime/agentAutoAttachSaga.js";
import { AGENT_V11_RUNTIME_SOURCES } from "../../../../base44/functions/compositionOrchestrator/runtimeAdapter.ts";

const request = {
  clinicId: "phase-v11-mirror", runId: "run-original",
  hypothesisId: "proposal#h0", sourceProposalId: "proposal",
  workflowId: "wf1", artifactIds: ["artifact-new"], policyVersion: 11,
};

function fixture() {
  let intent = null;
  let workflow = {
    id: "wf1", clinic_id: "phase-v11-mirror",
    current_snapshot_id: "s1", current_snapshot_version: 1,
  };
  const snapshots = {
    s1: {
      id: "s1", clinic_id: "phase-v11-mirror", workflow_id: "wf1",
      snapshot_version: 1, projection_version: 1, artifact_ids: [],
    },
    competing: {
      id: "competing", clinic_id: "phase-v11-mirror", workflow_id: "wf1",
      snapshot_version: 2, projection_version: 2, artifact_ids: ["artifact-other"],
    },
  };
  const links = new Map();
  let sequence = 0;
  let conflict = true;
  let undoResolutions = 0;
  const ops = {
    findIntent: async () => intent,
    createIntent: async row => (intent = { id: "intent-1", ...row }),
    updateIntent: async (_id, patch) => (intent = { ...intent, ...patch }),
    getWorkflow: async () => workflow,
    getSnapshot: async id => snapshots[id],
    createSnapshot: async row => {
      const saved = { id: `generated-${++sequence}`, ...row };
      snapshots[saved.id] = saved;
      return saved;
    },
    casWorkflowPointer: async (_filter, patch) => {
      if (conflict) {
        conflict = false;
        workflow = { ...workflow, current_snapshot_id: "competing", current_snapshot_version: 2 };
        links.set("other", { id: "other", artifact_id: "artifact-other", status: "attached" });
        return { updated: 0 };
      }
      workflow = { ...workflow, ...patch };
      return { updated: 1 };
    },
    createOrGetAttachmentLink: async descriptor => {
      const key = descriptor.idempotency_key;
      if (!links.has(key)) links.set(key, { id: `link-${links.size + 1}`, ...descriptor });
      return links.get(key);
    },
    reconcileUndoFromAttachmentLink: async () => { undoResolutions += 1; },
    updateHypothesis: async () => ({}),
    result: () => ({ intent, workflow, snapshots, links, undoResolutions, sequence }),
  };
  return ops;
}

async function scenario(execute) {
  const ops = fixture();
  const first = await execute({ request, ops, now: "2026-07-22T05:00:00.000Z" });
  const replay = await execute({
    request: { ...request, runId: "run-restarted" }, ops,
    now: "2026-07-22T05:01:00.000Z",
  });
  const state = ops.result();
  return {
    first: first.outcome,
    replay: replay.outcome,
    intentStatus: state.intent.status,
    intentRun: state.intent.composition_run_id,
    pointerVersion: state.workflow.current_snapshot_version,
    finalArtifacts: state.snapshots[state.workflow.current_snapshot_id].artifact_ids,
    linkedArtifacts: [...state.links.values()].map(item => item.artifact_id).filter(Boolean).sort(),
    undoResolutions: state.undoResolutions,
    snapshotsCreated: state.sequence,
  };
}

describe("Agent auto-attach Base44 runtime mirror", () => {
  it("pins every Agent v1.1 mirror to the exact canonical source blob", () => {
    const root = path.resolve(process.cwd());
    for (const [source, expected] of Object.entries(AGENT_V11_RUNTIME_SOURCES)) {
      const body = fs.readFileSync(path.join(root, source));
      expect(createHash("sha1").update(body).digest("hex")).toBe(expected);
      const mirror = path.join(
        root,
        "base44/functions/compositionOrchestrator/runtime",
        path.basename(source)
      );
      expect(fs.readFileSync(mirror, "utf8").split("\n")[0]).toContain(`blob=${expected}`);
    }
  });

  it("matches canonical CAS-rebase and replay behavior", async () => {
    const canonical = await scenario(executeCanonical);
    const runtime = await scenario(executeRuntime);
    expect(runtime).toEqual(canonical);
    expect(runtime).toEqual({
      first: "cas_retryable",
      replay: "committed",
      intentStatus: "committed",
      intentRun: "run-original",
      pointerVersion: 3,
      finalArtifacts: ["artifact-other", "artifact-new"],
      linkedArtifacts: ["artifact-new", "artifact-other"],
      undoResolutions: 1,
      snapshotsCreated: 2,
    });
  });
});