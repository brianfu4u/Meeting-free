import { describe, expect, it, vi } from "vitest";
import { createCompositionService } from "../../../../base44/functions/compositionOrchestrator/service.ts";

function makeOps(overrides = {}) {
  const runs = [];
  return {
    authorize: ({ action, role, clinicId }) =>
      Boolean(
        clinicId &&
        ["interpret", "run", "query", "listRuns", "review", "commit"].includes(action) &&
        ["staff", "admin"].includes(role) &&
        (!["review", "commit"].includes(action) || role === "admin")
      ),
    assertTenant: (clinicId, ...objects) =>
      objects.every((o) => o && typeof o === "object" && o.clinic_id === clinicId),
    buildRun: (input) => ({
      clinic_id: input.clinicId,
      business_date: input.businessDate,
      slot: input.slot,
      policy_version: input.policyVersion,
      cutoff_event_seq: input.cutoffEventSeq,
      status: "pending",
      idempotency_key: `${input.clinicId}::${input.businessDate}::${input.slot}::pv${input.policyVersion}::seq${input.cutoffEventSeq}`,
    }),
    buildHypotheses: ({ clinicId, compositionRunId, hypotheses }) =>
      hypotheses.map((h) => ({
        ...h,
        clinic_id: clinicId,
        composition_run_id: compositionRunId,
        validation_blocks: h.validation_blocks || [],
        status: "pending_review",
      })),
    deriveDispatch: ({ guardrailResult = {}, validationIssues }) => ({
      needsManagerDispatch: validationIssues.length > 0,
      bestHypothesisId:
        validationIssues.length > 0 ? null : guardrailResult.bestHypothesisId || null,
    }),
    buildAttention: ({
      clinicId,
      compositionRunId,
      generatedAt,
      selectedHypothesisId = null,
      managerDispatchRequired = false,
    }) => ({
      clinic_id: clinicId,
      composition_run_id: compositionRunId,
      title: "编组候选待审核",
      recommendation: "请店长审核编组候选",
      generated_at: generatedAt,
      selected_hypothesis_id: selectedHypothesisId,
      manager_dispatch_required: managerDispatchRequired,
    }),
    buildFailure: () => ({
      status: "failed",
      error_code: "composition_failed",
      error_message: "composition_run_failed",
    }),
    getArtifact: vi.fn(async (id) => ({ id, clinic_id: "c1" })),
    findFactCardByArtifact: vi.fn(async () => null),
    interpretArtifact: vi.fn(async () => ({ fields: [], subject_type: "patient" })),
    createFactCard: vi.fn(async (d) => ({ id: "fc-1", ...d })),
    findRunByIdempotency: vi.fn(async () => null),
    newRunLockOwner: (userId, key) => `lock::${userId}::${key}`,
    acquireRunLock: vi.fn(async () => ({ acquired: true })),
    releaseRunLock: vi.fn(async () => undefined),
    createRun: vi.fn(async (d) => {
      const row = { id: "run-1", ...d };
      runs.push(row);
      return row;
    }),
    updateRun: vi.fn(async (id, patch) => ({ id, clinic_id: "c1", ...patch })),
    getRun: vi.fn(async (id) => ({ id, clinic_id: "c1", status: "completed" })),
    listHypothesesByRun: vi.fn(async () => [{
      id: "h-db-1",
      clinic_id: "c1",
      composition_run_id: "run-1",
      workflow_hypothesis_id: "h1",
      status: "pending_review",
    }]),
    listAttentionByRun: vi.fn(async () => [{
      id: "att1",
      clinic_id: "c1",
      composition_run_id: "run-1",
      status: "open",
    }]),
    listRuns: vi.fn(async () => [{ id: "run-1", clinic_id: "c1" }]),
    listActiveHypothesisSummaries: vi.fn(async () => ({
      "run-1": { active_count: 2, status_counts: { pending_review: 2 } },
    })),
    executePipeline: vi.fn(async () => ({
      hypotheses: [{ source_proposal_id: "p1", workflow_hypothesis_id: "p1#h0", composition_type: "new_train" }],
      guardrailResult: { checked: [], ranked: [], needsManagerDispatch: false, bestHypothesisId: "p1#h0" },
      validationIssues: [],
      artifactIds: ["a1"],
      factCardIds: ["fc1"],
    })),
    createHypotheses: vi.fn(async (d) => d.map((x, i) => ({ id: `h-${i}`, ...x }))),
    createAttention: vi.fn(async (d) => ({ id: "att-1", ...d })),
    executeAgentAutoAttach: vi.fn(async () => ({
      outcome: "committed",
      idempotent: false,
      intent: { id: "agent-intent-1", status: "committed" },
    })),
    agentAutoAttachMode: () => "commit",
    recordAgentAutoAttachObservation: vi.fn(async () => ({
      outcome: "observed",
      idempotent: false,
      intent: { id: "observed-intent-1", status: "observed" },
    })),
    resumeAgentAutoAttachForRun: vi.fn(async () => null),
    getHypothesisByKey: vi.fn(async (clinicId, key) => ({
      id: "h-db-1",
      clinic_id: clinicId,
      composition_run_id: "run-1",
      workflow_hypothesis_id: key,
      status: "pending_review",
    })),
    updateHypothesis: vi.fn(async (id, patch) => ({
      id,
      clinic_id: "c1",
      composition_run_id: "run-1",
      workflow_hypothesis_id: "h1",
      ...patch,
    })),
    findManagerDecision: vi.fn(async () => null),
    createManagerDecision: vi.fn(async (d) => ({ id: "md-1", ...d })),
    updateAttention: vi.fn(async (id, patch) => ({
      id,
      clinic_id: "c1",
      composition_run_id: "run-1",
      ...patch,
    })),
    findCommitIntentByKey: vi.fn(async () => null),
    getWorkflow: vi.fn(async (id) => ({
      id, clinic_id: "c1", status: "active",
      current_snapshot_id: "snap3", current_snapshot_version: 3,
    })),
    getSnapshot: vi.fn(async (id) => ({
      id, clinic_id: "c1", workflow_id: "wf1",
      snapshot_version: 3, projection_version: 3,
    })),
    planAttachCommit: vi.fn(input => ({
      manager_execution_idempotency_key: "exec::md1::p1",
      intent_descriptor: {
        clinic_id: input.clinicId,
        target_workflow_id: "wf1",
        selected_hypothesis_id: "h1",
        attention_item_id: "att1",
        manager_decision_id: "md1",
      },
      snapshot_descriptor: { snapshot_version: 4 },
      workflow_cas_filter: {},
    })),
    executeCommitSaga: vi.fn(async () => ({
      outcome: "committed",
      idempotent: false,
      intent: { id: "intent1", status: "committed" },
    })),
    now: () => "2026-07-18T12:00:00.000Z",
    ...overrides,
  };
}

const actor = { user_id: "u1", role: "staff", clinic_id: "c1" };

describe("compositionOrchestrator service authorization", () => {
  it("rejects client/actor tenant mismatch before operations", async () => {
    const ops = makeOps();
    const result = await createCompositionService(ops).handle(
      { action: "listRuns", clinic_id: "c2" },
      actor
    );
    expect(result.http_status).toBe(403);
    expect(ops.listRuns).not.toHaveBeenCalled();
  });
  it("rejects staff commit before reading a hypothesis", async () => {
    const ops = makeOps();
    const result = await createCompositionService(ops).handle(
      { action: "commit", clinic_id: "c1", workflow_hypothesis_id: "h1" },
      actor
    );
    expect(result.http_status).toBe(403);
    expect(ops.getHypothesisByKey).not.toHaveBeenCalled();
  });
});

describe("compositionOrchestrator interpret", () => {
  it("persists a tenant-scoped fact card", async () => {
    const ops = makeOps();
    const result = await createCompositionService(ops).handle(
      { action: "interpret", clinic_id: "c1", artifact_id: "a1" },
      actor
    );
    expect(result.http_status).toBe(201);
    expect(result.fact_card.clinic_id).toBe("c1");
    expect(ops.createFactCard).toHaveBeenCalledTimes(1);
  });
  it("is idempotent by artifact", async () => {
    const existing = { id: "fc-existing", artifact_id: "a1", clinic_id: "c1" };
    const ops = makeOps({ findFactCardByArtifact: vi.fn(async () => existing) });
    const result = await createCompositionService(ops).handle(
      { action: "interpret", clinic_id: "c1", artifact_id: "a1" },
      actor
    );
    expect(result.idempotent).toBe(true);
    expect(ops.interpretArtifact).not.toHaveBeenCalled();
    expect(ops.createFactCard).not.toHaveBeenCalled();
  });
  it("blocks a cross-tenant artifact", async () => {
    const ops = makeOps({ getArtifact: vi.fn(async () => ({ id: "a1", clinic_id: "c2" })) });
    const result = await createCompositionService(ops).handle(
      { action: "interpret", clinic_id: "c1", artifact_id: "a1" },
      actor
    );
    expect(result.http_status).toBe(403);
    expect(ops.interpretArtifact).not.toHaveBeenCalled();
  });
});

describe("compositionOrchestrator run", () => {
  const request = {
    action: "run",
    clinic_id: "c1",
    business_date: "2026-07-18",
    slot: "12:30",
    policy_version: 3,
    cutoff_event_seq: 42,
  };
  it("persists run and exposes every pending hypothesis for manual review", async () => {
    const ops = makeOps();
    const result = await createCompositionService(ops).handle(request, actor);
    expect(result.http_status).toBe(201);
    expect(result.run.status).toBe("completed");
    expect(result.hypotheses[0].status).toBe("pending_review");
    expect(result.attention_item.id).toBe("att-1");
    expect(result.attention_item.selected_hypothesis_id).toBe("p1#h0");
    expect(result.attention_item.manager_dispatch_required).toBe(false);
    expect(result.dispatch).toEqual({
      needsManagerDispatch: false,
      bestHypothesisId: "p1#h0",
    });
    expect(result.review).toEqual({
      required: true,
      reason: "human_review_required",
      suggestedHypothesisId: "p1#h0",
      autoCommitAllowed: false,
      authoritativeAttachmentOutcome: null,
    });
    expect(ops.createHypotheses).toHaveBeenCalledTimes(1);
    expect(ops.createAttention).toHaveBeenCalledTimes(1);
  });
  it("keeps ambiguous dispatch visible without preselecting a hypothesis", async () => {
    const ops = makeOps({
      executePipeline: vi.fn(async () => ({
        hypotheses: [{ source_proposal_id: "p1", workflow_hypothesis_id: "p1#h0", composition_type: "orphan" }],
        guardrailResult: {},
        validationIssues: [{ type: "orphan_cluster_overlap" }],
        artifactIds: ["a1"],
        factCardIds: ["fc1"],
      })),
    });
    const result = await createCompositionService(ops).handle(request, actor);
    expect(result.attention_item.id).toBe("att-1");
    expect(result.attention_item.selected_hypothesis_id).toBeNull();
    expect(result.attention_item.manager_dispatch_required).toBe(true);
    expect(result.dispatch).toEqual({
      needsManagerDispatch: true,
      bestHypothesisId: null,
    });
    expect(result.review).toEqual({
      required: true,
      reason: "guardrail_dispatch_required",
      suggestedHypothesisId: null,
      autoCommitAllowed: false,
      authoritativeAttachmentOutcome: null,
    });
    expect(ops.createAttention).toHaveBeenCalledTimes(1);
  });
  it("records missing segments without evidence_missing attention or dispatch", async () => {
    const ops = makeOps({
      deriveDispatch: () => ({ needsManagerDispatch: false, bestHypothesisId: "p1#h0" }),
      executePipeline: vi.fn(async () => ({
        hypotheses: [{ source_proposal_id: "p1", workflow_hypothesis_id: "p1#h0", composition_type: "new_train" }],
        guardrailResult: { bestHypothesisId: "p1#h0" },
        validationIssues: [{ type: "missing_segment", segment: "financial_settlement" }],
        artifactIds: ["a1"], factCardIds: ["fc1"],
      })),
    });
    const result = await createCompositionService(ops).handle(request, actor);
    expect(result.dispatch.needsManagerDispatch).toBe(false);
    expect(result.review).toMatchObject({
      required: false, reason: "missing_segments_recorded",
    });
    expect(result.attention_item).toBeNull();
    expect(ops.createAttention).not.toHaveBeenCalled();
  });
  it("routes a unique guardrail-clean attach through the replayable authoritative Saga", async () => {
    const ops = makeOps({
      executePipeline: vi.fn(async () => ({
        hypotheses: [{
          source_proposal_id: "p-attach",
          workflow_hypothesis_id: "p-attach#h0",
          composition_type: "attach",
          target_workflow_id: "wf1",
          target_snapshot_id: "snap3",
          target_snapshot_version: 3,
          ordered_artifact_ids: ["a1"],
        }],
        guardrailResult: {
          bestHypothesisId: "p-attach#h0",
          needsManagerDispatch: false,
        },
        validationIssues: [],
        artifactIds: ["a1"], factCardIds: ["fc1"],
      })),
    });
    const result = await createCompositionService(ops).handle(request, actor);
    expect(result.authoritative_attachment).toMatchObject({
      outcome: "committed",
      intent: { id: "agent-intent-1", status: "committed" },
    });
    expect(ops.executeAgentAutoAttach).toHaveBeenCalledWith({
      clinicId: "c1",
      runId: "run-1",
      hypothesisId: "p-attach#h0",
      sourceProposalId: "p-attach",
      workflowId: "wf1",
      artifactIds: ["a1"],
      policyVersion: 3,
    });
    expect(result.attention_item).toBeNull();
    expect(result.review).toMatchObject({
      required: false,
      reason: "authoritative_attachment_committed",
      authoritativeAttachmentOutcome: "committed",
    });
  });
  it("defaults the authority gate to observation without creating authoritative projections", async () => {
    const ops = makeOps({
      agentAutoAttachMode: () => "observe",
      executePipeline: vi.fn(async () => ({
        hypotheses: [{
          source_proposal_id: "p-observe",
          workflow_hypothesis_id: "p-observe#h0",
          composition_type: "attach",
          target_workflow_id: "wf1",
          target_snapshot_id: "snap3",
          target_snapshot_version: 3,
          ordered_artifact_ids: ["a1"],
        }],
        guardrailResult: {
          bestHypothesisId: "p-observe#h0",
          needsManagerDispatch: false,
        },
        validationIssues: [], artifactIds: ["a1"], factCardIds: ["fc1"],
      })),
    });
    const result = await createCompositionService(ops).handle(request, actor);
    expect(result.authoritative_attachment).toMatchObject({
      outcome: "observed",
      intent: { status: "observed" },
    });
    expect(result.auto_attach_gate).toEqual({
      mode: "observe", eligible: true, reasons: [], hypothesisId: "p-observe#h0",
    });
    expect(result.review).toMatchObject({
      required: false, reason: "authoritative_attachment_observed",
    });
    expect(ops.recordAgentAutoAttachObservation).toHaveBeenCalledTimes(1);
    expect(ops.executeAgentAutoAttach).not.toHaveBeenCalled();
    expect(ops.updateRun).toHaveBeenCalledWith("run-1", expect.objectContaining({
      auto_attach_mode: "observe",
      auto_attach_eligible: true,
      auto_attach_outcome: "observed",
    }));
  });
  it("blocks observe intent creation for a closed target Workflow", async () => {
    const ops = makeOps({
      agentAutoAttachMode: () => "observe",
      getWorkflow: vi.fn(async (id) => ({
        id, clinic_id: "c1", status: "closed",
        current_snapshot_id: "snap3", current_snapshot_version: 3,
      })),
      executePipeline: vi.fn(async () => ({
        hypotheses: [{
          source_proposal_id: "p-closed",
          workflow_hypothesis_id: "p-closed#h0",
          composition_type: "attach",
          target_workflow_id: "wf1",
          target_snapshot_id: "snap3",
          target_snapshot_version: 3,
          ordered_artifact_ids: ["a1"],
        }],
        guardrailResult: {
          bestHypothesisId: "p-closed#h0",
          needsManagerDispatch: false,
        },
        validationIssues: [], artifactIds: ["a1"], factCardIds: ["fc1"],
      })),
    });
    const result = await createCompositionService(ops).handle(request, actor);
    expect(result.auto_attach_gate).toEqual({
      mode: "observe",
      eligible: false,
      reasons: ["workflow_closed"],
      hypothesisId: "p-closed#h0",
    });
    expect(result.authoritative_attachment).toBeNull();
    expect(result.review).toMatchObject({
      required: false,
      reason: "authoritative_target_closed",
    });
    expect(result.attention_item).toBeNull();
    expect(ops.createAttention).not.toHaveBeenCalled();
    expect(ops.recordAgentAutoAttachObservation).not.toHaveBeenCalled();
    expect(ops.executeAgentAutoAttach).not.toHaveBeenCalled();
    expect(ops.updateRun).toHaveBeenCalledWith("run-1", expect.objectContaining({
      auto_attach_eligible: false,
      auto_attach_gate_reasons: ["workflow_closed"],
      auto_attach_outcome: "not_eligible",
    }));
  });
  it("keeps an active Workflow eligible even when open_loops is empty", async () => {
    const ops = makeOps({
      agentAutoAttachMode: () => "observe",
      getWorkflow: vi.fn(async (id) => ({
        id, clinic_id: "c1", status: "active", open_loops: [],
        current_snapshot_id: "snap3", current_snapshot_version: 3,
      })),
      executePipeline: vi.fn(async () => ({
        hypotheses: [{
          source_proposal_id: "p-active",
          workflow_hypothesis_id: "p-active#h0",
          composition_type: "attach",
          target_workflow_id: "wf1",
          target_snapshot_id: "snap3",
          target_snapshot_version: 3,
          ordered_artifact_ids: ["a1"],
        }],
        guardrailResult: {
          bestHypothesisId: "p-active#h0",
          needsManagerDispatch: false,
        },
        validationIssues: [], artifactIds: ["a1"], factCardIds: ["fc1"],
      })),
    });
    const result = await createCompositionService(ops).handle(request, actor);
    expect(result.auto_attach_gate).toMatchObject({
      eligible: true,
      reasons: [],
    });
    expect(ops.recordAgentAutoAttachObservation).toHaveBeenCalledTimes(1);
  });
  it("resumes an unfinished attach intent when the CompositionRun retry finds the existing run", async () => {
    const existing = { id: "run-1", clinic_id: "c1", status: "running" };
    const recovery = {
      outcome: "committed",
      idempotent: true,
      repaired: true,
      intent: { id: "agent-intent-1", status: "committed" },
    };
    const ops = makeOps({
      findRunByIdempotency: vi.fn(async () => existing),
      resumeAgentAutoAttachForRun: vi.fn(async () => recovery),
    });
    const result = await createCompositionService(ops).handle(request, actor);
    expect(result).toMatchObject({
      http_status: 200,
      idempotent: true,
      run: { id: "run-1", clinic_id: "c1", status: "completed" },
      authoritative_attachment: recovery,
    });
    expect(ops.resumeAgentAutoAttachForRun).toHaveBeenCalledWith(existing, 3);
    expect(ops.updateRun).toHaveBeenCalledWith("run-1", expect.objectContaining({
      status: "completed",
    }));
    expect(ops.executePipeline).not.toHaveBeenCalled();
  });
  it("serializes concurrent creation with a short lock and second lookup", async () => {
    const existing = { id: "run-other", clinic_id: "c1", status: "running" };
    const find = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing);
    const ops = makeOps({ findRunByIdempotency: find });
    const result = await createCompositionService(ops).handle(request, actor);
    expect(result.idempotent).toBe(true);
    expect(result.run.id).toBe("run-other");
    expect(ops.acquireRunLock).toHaveBeenCalledTimes(1);
    expect(ops.releaseRunLock).toHaveBeenCalledTimes(1);
    expect(ops.createRun).not.toHaveBeenCalled();
  });
  it("returns retryable conflict while another creator owns the lease", async () => {
    const ops = makeOps({
      acquireRunLock: vi.fn(async () => ({ acquired: false, reason: "lock_busy" })),
    });
    const result = await createCompositionService(ops).handle(request, actor);
    expect(result).toEqual(expect.objectContaining({
      http_status: 409,
      error_code: "run_lock_busy",
      retryable: true,
    }));
    expect(ops.createRun).not.toHaveBeenCalled();
    expect(ops.executePipeline).not.toHaveBeenCalled();
  });
  it("releases the creation lock before executing the pipeline", async () => {
    const order = [];
    const ops = makeOps({
      releaseRunLock: vi.fn(async () => { order.push("release"); }),
      executePipeline: vi.fn(async () => {
        order.push("pipeline");
        return {
          hypotheses: [],
          guardrailResult: {},
          validationIssues: [],
          artifactIds: [],
          factCardIds: [],
        };
      }),
    });
    await createCompositionService(ops).handle(request, actor);
    expect(order).toEqual(["release", "pipeline"]);
  });
  it("returns an existing run for the same idempotency key", async () => {
    const existing = { id: "run-existing", clinic_id: "c1", status: "completed" };
    const ops = makeOps({ findRunByIdempotency: vi.fn(async () => existing) });
    const result = await createCompositionService(ops).handle(request, actor);
    expect(result.idempotent).toBe(true);
    expect(ops.createRun).not.toHaveBeenCalled();
    expect(ops.executePipeline).not.toHaveBeenCalled();
  });
  it("sanitizes failure and marks a persisted run failed", async () => {
    const ops = makeOps({
      executePipeline: vi.fn(async () => {
        throw new Error("Bearer secret-token stack");
      }),
    });
    const result = await createCompositionService(ops).handle(request, actor);
    expect(result.http_status).toBe(500);
    expect(JSON.stringify(result)).not.toContain("secret-token");
    expect(ops.updateRun).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ status: "failed", error_code: "composition_failed" })
    );
  });
});

describe("compositionOrchestrator manager review", () => {
  const request = {
    action: "review",
    clinic_id: "c1",
    workflow_hypothesis_id: "h1",
    review_decision: "select",
    decision_note: "店长确认该编组",
  };
  const admin = { user_id: "manager-1", role: "admin", clinic_id: "c1" };

  it("rejects staff before reading a hypothesis", async () => {
    const ops = makeOps();
    const result = await createCompositionService(ops).handle(request, actor);
    expect(result).toEqual(expect.objectContaining({
      http_status: 403,
      error_code: "action_not_allowed",
    }));
    expect(ops.getHypothesisByKey).not.toHaveBeenCalled();
  });

  it("returns a retryable conflict while another manager owns the review lease", async () => {
    const ops = makeOps({
      acquireRunLock: vi.fn(async () => ({ acquired: false, reason: "lock_busy" })),
    });
    const result = await createCompositionService(ops).handle(request, admin);
    expect(result).toEqual(expect.objectContaining({
      http_status: 409,
      error_code: "review_lock_busy",
      retryable: true,
    }));
    expect(ops.createManagerDecision).not.toHaveBeenCalled();
    expect(ops.updateHypothesis).not.toHaveBeenCalled();
    expect(ops.updateAttention).not.toHaveBeenCalled();
  });

  it("records a human selection and projects selected/executed states", async () => {
    const ops = makeOps();
    const result = await createCompositionService(ops).handle(request, admin);
    expect(result.http_status).toBe(201);
    expect(result.idempotent).toBe(false);
    expect(result.manager_decision).toEqual(expect.objectContaining({
      manager_id: "manager-1",
      target_type: "hypothesis",
      target_id: "h1",
      decision: "approved",
    }));
    expect(result.hypothesis.status).toBe("selected");
    expect(result.attention_items[0]).toEqual(expect.objectContaining({
      status: "executed",
      manager_action: "execute",
      selected_hypothesis_id: "h1",
    }));
    expect(ops.createManagerDecision).toHaveBeenCalledTimes(1);
    expect(ops.updateHypothesis).toHaveBeenCalledWith("h-db-1", { status: "selected" });
  });

  it("replays an existing matching decision without creating a duplicate", async () => {
    const existing = {
      id: "md-existing",
      clinic_id: "c1",
      manager_id: "manager-1",
      target_type: "hypothesis",
      target_id: "h1",
      decision: "approved",
      decided_at: "2026-07-18T11:00:00.000Z",
    };
    const ops = makeOps({
      findManagerDecision: vi.fn(async () => existing),
      getHypothesisByKey: vi.fn(async () => ({
        id: "h-db-1",
        clinic_id: "c1",
        composition_run_id: "run-1",
        workflow_hypothesis_id: "h1",
        status: "selected",
      })),
    });
    const result = await createCompositionService(ops).handle(request, admin);
    expect(result.http_status).toBe(200);
    expect(result.idempotent).toBe(true);
    expect(ops.createManagerDecision).not.toHaveBeenCalled();
    expect(ops.updateHypothesis).not.toHaveBeenCalled();
  });

  it("rejects a conflicting second decision", async () => {
    const ops = makeOps({
      findManagerDecision: vi.fn(async () => ({
        id: "md-existing",
        clinic_id: "c1",
        target_id: "h1",
        decision: "rejected",
      })),
    });
    const result = await createCompositionService(ops).handle(request, admin);
    expect(result).toEqual(expect.objectContaining({
      http_status: 409,
      error_code: "hypothesis_already_reviewed",
    }));
    expect(ops.updateHypothesis).not.toHaveBeenCalled();
  });

  it("keeps attention open when rejecting one of several pending candidates", async () => {
    const ops = makeOps({
      listHypothesesByRun: vi.fn(async () => [
        {
          id: "h-db-1", clinic_id: "c1", composition_run_id: "run-1",
          workflow_hypothesis_id: "h1", status: "pending_review",
        },
        {
          id: "h-db-2", clinic_id: "c1", composition_run_id: "run-1",
          workflow_hypothesis_id: "h2", status: "pending_review",
        },
      ]),
    });
    const result = await createCompositionService(ops).handle(
      { ...request, review_decision: "reject" },
      admin
    );
    expect(result.http_status).toBe(201);
    expect(result.hypothesis.status).toBe("rejected");
    expect(result.attention_items).toEqual([]);
    expect(ops.updateAttention).not.toHaveBeenCalled();
  });

  it("blocks an injected cross-tenant hypothesis", async () => {
    const ops = makeOps({
      getHypothesisByKey: vi.fn(async () => ({
        id: "h-db-1",
        clinic_id: "c2",
        composition_run_id: "run-1",
        workflow_hypothesis_id: "h1",
        status: "pending_review",
      })),
    });
    const result = await createCompositionService(ops).handle(request, admin);
    expect(result.http_status).toBe(403);
    expect(ops.createManagerDecision).not.toHaveBeenCalled();
  });
});

describe("compositionOrchestrator query/listRuns", () => {
  it("query returns only tenant-scoped related records", async () => {
    const result = await createCompositionService(makeOps()).handle(
      { action: "query", clinic_id: "c1", composition_run_id: "run-1" },
      actor
    );
    expect(result.http_status).toBe(200);
    expect(result.hypotheses).toHaveLength(1);
    expect(result.attention_items).toHaveLength(1);
  });
  it("query blocks injected cross-tenant related records", async () => {
    const ops = makeOps({
      listHypothesesByRun: vi.fn(async () => [{ id: "h1", clinic_id: "c2" }]),
    });
    const result = await createCompositionService(ops).handle(
      { action: "query", clinic_id: "c1", composition_run_id: "run-1" },
      actor
    );
    expect(result.http_status).toBe(403);
  });
  it("listRuns omits hypothesis aggregation by default", async () => {
    const ops = makeOps();
    const result = await createCompositionService(ops).handle(
      { action: "listRuns", clinic_id: "c1" },
      actor
    );
    expect(result.hypothesis_summary_included).toBe(false);
    expect(ops.listActiveHypothesisSummaries).not.toHaveBeenCalled();
    expect(result.runs[0]).not.toHaveProperty("hypothesis_summary");
  });
  it("listRuns opt-in aggregates active statuses only", async () => {
    const ops = makeOps();
    const result = await createCompositionService(ops).handle(
      { action: "listRuns", clinic_id: "c1", include_hypothesis_summary: true },
      actor
    );
    expect(result.hypothesis_summary_included).toBe(true);
    expect(result.runs[0].hypothesis_summary.active_count).toBe(2);
    expect(ops.listActiveHypothesisSummaries).toHaveBeenCalledWith(
      "c1",
      ["run-1"],
      ["pending_review", "selected", "dispatched"]
    );
    expect(result.runs[0]).not.toHaveProperty("hypotheses");
  });
  it("listRuns caps limit at 100", async () => {
    const ops = makeOps();
    const result = await createCompositionService(ops).handle(
      { action: "listRuns", clinic_id: "c1", limit: 999 },
      actor
    );
    expect(result.limit).toBe(100);
    expect(ops.listRuns).toHaveBeenCalledWith("c1", { business_date: undefined, limit: 100 });
  });
});


describe("compositionOrchestrator attach commit", () => {
  const admin = { user_id: "manager-1", role: "admin", clinic_id: "c1" };
  const request = {
    action: "commit",
    clinic_id: "c1",
    workflow_hypothesis_id: "h1",
    attention_item_id: "att1",
  };
  const selectedHypothesis = {
    id: "h-db-1",
    clinic_id: "c1",
    composition_run_id: "run-1",
    source_proposal_id: "p1",
    workflow_hypothesis_id: "h1",
    composition_type: "attach",
    status: "selected",
    target_workflow_id: "wf1",
    target_snapshot_id: "snap3",
    target_snapshot_version: 3,
  };
  const approved = {
    id: "md1",
    clinic_id: "c1",
    manager_id: "manager-1",
    target_type: "hypothesis",
    target_id: "h1",
    decision: "approved",
  };
  const attention = {
    id: "att1",
    clinic_id: "c1",
    composition_run_id: "run-1",
    status: "executed",
    selected_hypothesis_id: "h1",
  };

  function commitOps(overrides = {}) {
    return makeOps({
      getHypothesisByKey: vi.fn(async () => selectedHypothesis),
      findManagerDecision: vi.fn(async () => approved),
      listAttentionByRun: vi.fn(async () => [attention]),
      ...overrides,
    });
  }

  it("executes the serialized Saga for an approved selected attach", async () => {
    const ops = commitOps();
    const result = await createCompositionService(ops).handle(request, admin);
    expect(result.http_status).toBe(201);
    expect(result.idempotent).toBe(false);
    expect(ops.planAttachCommit).toHaveBeenCalledWith(expect.objectContaining({
      clinicId: "c1",
      managerDecision: approved,
      attentionItem: attention,
      hypothesis: selectedHypothesis,
    }));
    expect(ops.acquireRunLock).toHaveBeenCalledWith(
      "c1",
      "manager-commit::exec::md1::p1",
      expect.any(String),
      expect.any(String),
      expect.any(String)
    );
    expect(ops.executeCommitSaga).toHaveBeenCalledTimes(1);
    expect(ops.releaseRunLock).toHaveBeenCalledTimes(1);
  });

  it("returns 200 for a committed retry before re-planning", async () => {
    const intent = {
      id: "intent1", clinic_id: "c1",
      manager_execution_idempotency_key: "exec::md1::p1", status: "committed",
    };
    const ops = commitOps({
      getHypothesisByKey: vi.fn(async () => ({ ...selectedHypothesis, status: "committed" })),
      findCommitIntentByKey: vi.fn(async () => intent),
    });
    const result = await createCompositionService(ops).handle(request, admin);
    expect(result).toEqual(expect.objectContaining({
      http_status: 200, idempotent: true,
      commit: expect.objectContaining({ outcome: "committed", intent }),
    }));
    expect(ops.planAttachCommit).not.toHaveBeenCalled();
    expect(ops.acquireRunLock).not.toHaveBeenCalled();
    expect(ops.executeCommitSaga).not.toHaveBeenCalled();
  });

  it("replays a terminal stale intent without re-planning", async () => {
    const intent = {
      id: "intent-stale", clinic_id: "c1",
      manager_execution_idempotency_key: "exec::md1::p1", status: "stale",
    };
    const ops = commitOps({
      getHypothesisByKey: vi.fn(async () => ({ ...selectedHypothesis, status: "stale" })),
      findCommitIntentByKey: vi.fn(async () => intent),
    });
    const result = await createCompositionService(ops).handle(request, admin);
    expect(result).toEqual(expect.objectContaining({
      http_status: 409, error_code: "stale_proposal", idempotent: true,
    }));
    expect(ops.planAttachCommit).not.toHaveBeenCalled();
    expect(ops.executeCommitSaga).not.toHaveBeenCalled();
  });

  it("returns stale conflict without claiming commit", async () => {
    const ops = commitOps({
      executeCommitSaga: vi.fn(async () => ({
        outcome: "stale", idempotent: false,
        intent: { id: "intent1", status: "stale" },
      })),
    });
    const result = await createCompositionService(ops).handle(request, admin);
    expect(result).toEqual(expect.objectContaining({
      http_status: 409,
      error_code: "stale_proposal",
      idempotent: false,
    }));
  });

  it("requires the prior human manager approval", async () => {
    const ops = commitOps({ findManagerDecision: vi.fn(async () => null) });
    const result = await createCompositionService(ops).handle(request, admin);
    expect(result).toEqual(expect.objectContaining({
      http_status: 409,
      error_code: "manager_approval_required",
    }));
    expect(ops.planAttachCommit).not.toHaveBeenCalled();
  });

  it("requires the selected attention projection", async () => {
    const ops = commitOps({ listAttentionByRun: vi.fn(async () => []) });
    const result = await createCompositionService(ops).handle(request, admin);
    expect(result).toEqual(expect.objectContaining({
      http_status: 409,
      error_code: "selected_attention_item_required",
    }));
  });

  it("returns retryable conflict while another commit owns the lease", async () => {
    const ops = commitOps({
      acquireRunLock: vi.fn(async () => ({ acquired: false, reason: "lock_busy" })),
    });
    const result = await createCompositionService(ops).handle(request, admin);
    expect(result).toEqual(expect.objectContaining({
      http_status: 409,
      error_code: "commit_lock_busy",
      retryable: true,
    }));
    expect(ops.executeCommitSaga).not.toHaveBeenCalled();
  });

  it("maps planner pointer mismatch to stale_proposal", async () => {
    const error = Object.assign(new Error("do not expose"), {
      code: "stale_proposal_version_mismatch",
    });
    const ops = commitOps({
      planAttachCommit: vi.fn(() => { throw error; }),
    });
    const result = await createCompositionService(ops).handle(request, admin);
    expect(result).toEqual(expect.objectContaining({
      http_status: 409,
      error_code: "stale_proposal",
    }));
    expect(JSON.stringify(result)).not.toContain("do not expose");
  });

  it("blocks cross-tenant workflow before planning", async () => {
    const ops = commitOps({
      getWorkflow: vi.fn(async () => ({
        id: "wf1", clinic_id: "c2",
        current_snapshot_id: "snap3", current_snapshot_version: 3,
      })),
    });
    const result = await createCompositionService(ops).handle(request, admin);
    expect(result.http_status).toBe(403);
    expect(ops.planAttachCommit).not.toHaveBeenCalled();
  });
});
