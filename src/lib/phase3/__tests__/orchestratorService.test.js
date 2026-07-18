import { describe, expect, it, vi } from "vitest";
import { createCompositionService } from "../../../../base44/functions/compositionOrchestrator/service.ts";

function makeOps(overrides = {}) {
  const runs = [];
  return {
    authorize: ({ action, role, clinicId }) =>
      Boolean(clinicId && ["interpret", "run", "query", "listRuns"].includes(action) &&
        ["staff", "admin"].includes(role)),
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
      hypotheses.map((h) => ({ ...h, clinic_id: clinicId, composition_run_id: compositionRunId, status: "pending_review" })),
    deriveDispatch: ({ validationIssues }) => ({
      needsManagerDispatch: validationIssues.length > 0,
      bestHypothesisId: null,
    }),
    buildAttention: ({ clinicId, compositionRunId, generatedAt }) => ({
      clinic_id: clinicId,
      composition_run_id: compositionRunId,
      title: "编组候选待审核",
      recommendation: "请店长审核编组候选",
      generated_at: generatedAt,
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
    createRun: vi.fn(async (d) => {
      const row = { id: "run-1", ...d };
      runs.push(row);
      return row;
    }),
    updateRun: vi.fn(async (id, patch) => ({ id, clinic_id: "c1", ...patch })),
    getRun: vi.fn(async (id) => ({ id, clinic_id: "c1", status: "completed" })),
    listHypothesesByRun: vi.fn(async () => [{ id: "h1", clinic_id: "c1" }]),
    listAttentionByRun: vi.fn(async () => [{ id: "att1", clinic_id: "c1" }]),
    listRuns: vi.fn(async () => [{ id: "run-1", clinic_id: "c1" }]),
    executePipeline: vi.fn(async () => ({
      hypotheses: [{ source_proposal_id: "p1", workflow_hypothesis_id: "p1#h0", composition_type: "new_train" }],
      guardrailResult: { checked: [], ranked: [], needsManagerDispatch: false, bestHypothesisId: "p1#h0" },
      validationIssues: [],
      artifactIds: ["a1"],
      factCardIds: ["fc1"],
    })),
    createHypotheses: vi.fn(async (d) => d.map((x, i) => ({ id: `h-${i}`, ...x }))),
    createAttention: vi.fn(async (d) => ({ id: "att-1", ...d })),
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
  it("rejects commit because it is not a Batch 2 action", async () => {
    const result = await createCompositionService(makeOps()).handle(
      { action: "commit", clinic_id: "c1" },
      actor
    );
    expect(result.http_status).toBe(400);
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
  it("persists run, hypotheses and completion without auto decision", async () => {
    const ops = makeOps();
    const result = await createCompositionService(ops).handle(request, actor);
    expect(result.http_status).toBe(201);
    expect(result.run.status).toBe("completed");
    expect(result.hypotheses[0].status).toBe("pending_review");
    expect(result.attention_item).toBeNull();
    expect(ops.createHypotheses).toHaveBeenCalledTimes(1);
  });
  it("creates attention only when dispatch is required", async () => {
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
    expect(ops.createAttention).toHaveBeenCalledTimes(1);
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
