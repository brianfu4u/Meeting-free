import { describe, expect, it } from "vitest";
import { createCompositionService } from "../../../../base44/functions/compositionOrchestrator/service.ts";
import { executeAgentAutoAttachSaga } from "../../../../base44/functions/compositionOrchestrator/runtime/agentAutoAttachSaga.js";
import {
  buildRunDescriptor,
  buildHypothesisDescriptors,
  deriveDispatchDecision,
  buildAttentionDescriptor,
  buildRunFailure,
} from "../../phase3/orchestratorCore";

function isolatedOps({ autoAttachMode = "commit" } = {}) {
  let run = null;
  let intent = null;
  let workflow = {
    id: "wf1", clinic_id: "phase-v11-e2e", status: "active",
    current_snapshot_id: "s1", current_snapshot_version: 1,
  };
  const snapshots = new Map([["s1", {
    id: "s1", clinic_id: "phase-v11-e2e", workflow_id: "wf1",
    snapshot_version: 1, projection_version: 1, artifact_ids: ["existing"],
  }]]);
  const hypotheses = new Map();
  const links = new Map();
  const undo = new Map([["undo-a1", {
    id: "undo-a1", clinic_id: "phase-v11-e2e", artifact_id: "a1",
    status: "pending",
  }]]);
  let snapshotSequence = 1;

  const sagaOps = {
    findIntent: async () => intent,
    createIntent: async descriptor => (intent = { id: "intent-1", ...descriptor }),
    updateIntent: async (_id, patch) => (intent = { ...intent, ...patch }),
    getWorkflow: async () => workflow,
    getSnapshot: async id => snapshots.get(id),
    createSnapshot: async descriptor => {
      const saved = { id: `s${++snapshotSequence}`, ...descriptor };
      snapshots.set(saved.id, saved);
      return saved;
    },
    casWorkflowPointer: async (filter, patch) => {
      if (
        workflow.current_snapshot_id !== filter.current_snapshot_id ||
        workflow.current_snapshot_version !== filter.current_snapshot_version
      ) return { updated: 0 };
      workflow = { ...workflow, ...patch };
      return { updated: 1 };
    },
    createOrGetAttachmentLink: async descriptor => {
      if (!links.has(descriptor.idempotency_key)) {
        links.set(descriptor.idempotency_key, { id: `link-${links.size + 1}`, ...descriptor });
      }
      return links.get(descriptor.idempotency_key);
    },
    reconcileUndoFromAttachmentLink: async (link, now) => {
      let resolved = 0;
      for (const [id, row] of undo) {
        if (row.artifact_id === link.artifact_id && row.status === "pending") {
          undo.set(id, {
            ...row, status: "resolved", resolved_at: now,
            resolved_into_workflow_id: link.workflow_id,
            resolved_by_link_id: link.id,
          });
          resolved += 1;
        }
      }
      return { resolved };
    },
    updateHypothesis: async (key, patch) => {
      const current = hypotheses.get(key);
      hypotheses.set(key, { ...current, ...patch });
      return hypotheses.get(key);
    },
  };

  const execute = request => executeAgentAutoAttachSaga({
    request, ops: sagaOps, now: "2026-07-22T06:00:00.000Z",
  });

  return {
    authorize: () => true,
    assertTenant: (clinicId, ...objects) =>
      objects.every(item => item?.clinic_id === clinicId),
    buildRun: buildRunDescriptor,
    buildHypotheses: buildHypothesisDescriptors,
    deriveDispatch: deriveDispatchDecision,
    buildAttention: buildAttentionDescriptor,
    buildFailure: buildRunFailure,
    findRunByIdempotency: async () => run,
    newRunLockOwner: () => "lock-1",
    acquireRunLock: async () => ({ acquired: true }),
    releaseRunLock: async () => undefined,
    createRun: async descriptor => (run = {
      id: "run-1", ...descriptor, status: "running",
    }),
    updateRun: async (_id, patch) => (run = { ...run, ...patch }),
    executePipeline: async () => ({
      hypotheses: [{
        source_proposal_id: "proposal",
        workflow_hypothesis_id: "proposal#h0",
        composition_type: "attach",
        workflow_family: "patient_visit",
        target_workflow_id: "wf1",
        target_snapshot_id: "s1",
        target_snapshot_version: 1,
        ordered_artifact_ids: ["a1"],
      }],
      guardrailResult: {
        checked: [{ workflow_hypothesis_id: "proposal#h0", validation_blocks: [] }],
        ranked: [{ workflow_hypothesis_id: "proposal#h0" }],
        bestHypothesisId: "proposal#h0",
        needsManagerDispatch: false,
      },
      validationIssues: [], artifactIds: ["a1"], factCardIds: ["fc1"],
    }),
    createHypotheses: async descriptors => descriptors.map((descriptor, index) => {
      const row = { id: `hyp-${index + 1}`, ...descriptor };
      hypotheses.set(row.workflow_hypothesis_id, row);
      return row;
    }),
    createAttention: async descriptor => ({ id: "attention-1", ...descriptor }),
    getWorkflow: async id => id === workflow.id ? workflow : null,
    agentAutoAttachMode: () => autoAttachMode,
    recordAgentAutoAttachObservation: async request => {
      if (intent) return { outcome: "observed", idempotent: true, intent };
      intent = {
        id: "intent-1",
        clinic_id: request.clinicId,
        composition_run_id: request.runId,
        workflow_hypothesis_id: request.hypothesisId,
        source_proposal_id: request.sourceProposalId,
        target_workflow_id: request.workflowId,
        artifact_ids: request.artifactIds,
        status: "observed",
        decision_source: "agent_autonomous",
      };
      return { outcome: "observed", idempotent: false, intent };
    },
    executeAgentAutoAttach: execute,
    resumeAgentAutoAttachForRun: async existingRun => {
      if (!intent) return null;
      if (autoAttachMode !== "commit") {
        return { outcome: "observed", idempotent: true, intent };
      }
      const hypothesis = hypotheses.get(intent.workflow_hypothesis_id);
      return execute({
        clinicId: existingRun.clinic_id,
        runId: existingRun.id,
        hypothesisId: intent.workflow_hypothesis_id,
        sourceProposalId: hypothesis.source_proposal_id,
        workflowId: intent.target_workflow_id,
        artifactIds: intent.artifact_ids,
        policyVersion: existingRun.policy_version,
      });
    },
    now: () => "2026-07-22T06:00:00.000Z",
    state: () => ({ run, intent, workflow, snapshots, hypotheses, links, undo }),
  };
}

describe("production run to Base44 runtime mirror isolated E2E", () => {
  it("observes an eligible attachment without Snapshot, Link, or Undo projection", async () => {
    const ops = isolatedOps({ autoAttachMode: "observe" });
    const service = createCompositionService(ops);
    const request = {
      action: "run", clinic_id: "phase-v11-e2e",
      business_date: "2026-07-22", slot: "12:30",
      policy_version: 11, cutoff_event_seq: 1,
    };
    const actor = {
      user_id: "manager-1", role: "admin", clinic_id: "phase-v11-e2e",
    };

    const first = await service.handle(request, actor);
    expect(first).toMatchObject({
      http_status: 201,
      authoritative_attachment: { outcome: "observed", idempotent: false },
      auto_attach_gate: { mode: "observe", eligible: true, reasons: [] },
      review: { required: false, reason: "authoritative_attachment_observed" },
    });
    const observed = ops.state();
    expect(observed.intent).toMatchObject({ status: "observed" });
    expect(observed.snapshots.size).toBe(1);
    expect(observed.workflow).toMatchObject({
      current_snapshot_id: "s1", current_snapshot_version: 1,
    });
    expect(observed.links.size).toBe(0);
    expect(observed.undo.get("undo-a1")).toMatchObject({ status: "pending" });

    const replay = await service.handle(request, actor);
    expect(replay).toMatchObject({
      http_status: 200,
      idempotent: true,
      authoritative_attachment: { outcome: "observed", idempotent: true },
    });
    const replayed = ops.state();
    expect(replayed.snapshots.size).toBe(1);
    expect(replayed.links.size).toBe(0);
    expect(replayed.undo.get("undo-a1")).toMatchObject({ status: "pending" });
  });

  it("attaches authoritatively and replays with zero Snapshot/Link/Undo growth", async () => {
    const ops = isolatedOps();
    const service = createCompositionService(ops);
    const request = {
      action: "run", clinic_id: "phase-v11-e2e",
      business_date: "2026-07-22", slot: "12:30",
      policy_version: 11, cutoff_event_seq: 1,
    };
    const actor = {
      user_id: "manager-1", role: "admin", clinic_id: "phase-v11-e2e",
    };

    const first = await service.handle(request, actor);
    expect(first).toMatchObject({
      http_status: 201,
      authoritative_attachment: { outcome: "committed", idempotent: false },
      review: {
        required: false,
        reason: "authoritative_attachment_committed",
      },
    });
    expect(first.hypotheses[0].status).toBe("committed");
    const beforeReplay = ops.state();
    expect(beforeReplay.snapshots.get(beforeReplay.workflow.current_snapshot_id).artifact_ids)
      .toEqual(["existing", "a1"]);
    expect([...beforeReplay.links.values()][0]).toMatchObject({
      artifact_id: "a1",
      decision_source: "agent_autonomous",
      decision_actor_id: "run-1",
    });
    expect(beforeReplay.undo.get("undo-a1")).toMatchObject({
      status: "resolved", resolved_by_link_id: "link-1",
    });

    const counts = {
      snapshots: beforeReplay.snapshots.size,
      links: beforeReplay.links.size,
      undo: beforeReplay.undo.size,
    };
    const replay = await service.handle(request, actor);
    expect(replay).toMatchObject({
      http_status: 200, idempotent: true,
      authoritative_attachment: { outcome: "committed", idempotent: true },
    });
    const afterReplay = ops.state();
    expect({
      snapshots: afterReplay.snapshots.size,
      links: afterReplay.links.size,
      undo: afterReplay.undo.size,
    }).toEqual(counts);
  });
});
