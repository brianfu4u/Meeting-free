import { describe, expect, it, vi } from "vitest";
import {
  CompositionApiError,
  activeHypotheses,
  canCommitHypothesis,
  invokeComposition,
  reasoningTrackEntries,
} from "../compositionClient";

describe("Phase 3 composition frontend boundary", () => {
  it("unwraps the SDK axios response and preserves tenant payload", async () => {
    const invoke = vi.fn(async () => ({ data: { ok: true, runs: [] } }));
    const result = await invokeComposition(
      { functions: { invoke } },
      { action: "listRuns", clinic_id: "clinic-a" }
    );
    expect(result).toEqual({ ok: true, runs: [] });
    expect(invoke).toHaveBeenCalledWith("compositionOrchestrator", {
      action: "listRuns",
      clinic_id: "clinic-a",
    });
  });

  it("normalizes non-2xx backend errors", async () => {
    const invoke = vi.fn(async () => {
      throw { response: { status: 409, data: { error_code: "stale_proposal" } } };
    });
    await expect(
      invokeComposition({ functions: { invoke } }, { action: "commit", clinic_id: "c1" })
    ).rejects.toMatchObject({
      name: "CompositionApiError",
      errorCode: "stale_proposal",
      status: 409,
    });
  });

  it("requires clinic_id before invoking", async () => {
    const invoke = vi.fn();
    await expect(invokeComposition({ functions: { invoke } }, { action: "query" }))
      .rejects.toThrow(/clinic_id/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("returns only active hypotheses", () => {
    expect(activeHypotheses([
      { status: "pending_review", id: 1 },
      { status: "selected", id: 2 },
      { status: "committed", id: 3 },
      { status: "rejected", id: 4 },
    ]).map((x) => x.id)).toEqual([1, 2]);
  });

  it("normalizes fixed reasoning tracks", () => {
    expect(reasoningTrackEntries({ causal_chain: ["a"], temporal_continuity: null }))
      .toEqual([
        { trackId: "causal_chain", evidence: ["a"] },
        { trackId: "temporal_continuity", evidence: [] },
      ]);
  });

  it("permits commit only for a fully targeted selected attach hypothesis", () => {
    expect(canCommitHypothesis({
      status: "selected",
      composition_type: "attach",
      target_workflow_id: "wf1",
      target_snapshot_id: "s1",
      target_snapshot_version: 2,
    })).toBe(true);
    expect(canCommitHypothesis({ status: "selected", composition_type: "new_train" }))
      .toBe(false);
  });

  it("exports a typed error for UI handling", () => {
    const error = new CompositionApiError({ error_code: "review_lock_busy", retryable: true }, 409);
    expect(error.retryable).toBe(true);
    expect(error.message).toBe("review_lock_busy");
  });
});
