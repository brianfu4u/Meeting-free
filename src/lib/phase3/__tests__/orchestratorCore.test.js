import { describe, expect, it } from "vitest";
import {
  authorizeAction,
  assertTenantScope,
  buildAttentionDescriptor,
  buildHypothesisDescriptors,
  buildRunDescriptor,
  buildRunFailure,
  deriveDispatchDecision,
} from "../orchestratorCore";

const attach = (overrides = {}) => ({
  source_proposal_id: "proposal-1",
  workflow_hypothesis_id: "proposal-1#h0",
  composition_type: "attach",
  workflow_family: "patient_visit",
  target_workflow_id: "wf-1",
  target_snapshot_id: "snap-1",
  target_snapshot_version: 3,
  ordered_artifact_ids: ["a1", "a2"],
  reasoning_tracks: {},
  unsupported_assumptions: [],
  contradictions: [],
  unexplained_artifact_ids: [],
  ...overrides,
});

describe("Phase 3 orchestratorCore authorization", () => {
  it("staff can run but cannot commit", () => {
    expect(authorizeAction({ action: "run", role: "staff", clinicId: "c1" })).toBe(true);
    expect(() => authorizeAction({ action: "commit", role: "staff", clinicId: "c1" })).toThrow();
  });
  it("rejects missing clinic scope", () => {
    expect(() => authorizeAction({ action: "run", role: "staff" })).toThrow(/clinicId/);
  });
});

describe("Phase 3 orchestratorCore tenant scope", () => {
  it("accepts same tenant and optional null", () => {
    expect(assertTenantScope("c1", { clinic_id: "c1" }, null)).toBe(true);
  });
  it("rejects missing tenant, cross tenant and primitive", () => {
    expect(() => assertTenantScope("c1", {})).toThrow(/missing_tenant/);
    expect(() => assertTenantScope("c1", { clinic_id: "c2" })).toThrow(/cross_tenant/);
    expect(() => assertTenantScope("c1", "c1")).toThrow(/invalid_type/);
  });
});

describe("Phase 3 run descriptor", () => {
  it("is schema compatible and idempotent", () => {
    const input = {
      clinicId: "c1",
      businessDate: "2026-07-18",
      slot: "17:30",
      policyVersion: 7,
      cutoffEventSeq: 42,
      triggerType: "manual",
      promptVersion: "assembly-v2",
      modelVersion: "automatic",
      artifactIds: ["a2", "a1", "a2"],
    };
    const a = buildRunDescriptor(input);
    const b = buildRunDescriptor(input);
    expect(a.idempotency_key).toBe(b.idempotency_key);
    expect(a.status).toBe("pending");
    expect(a.contract_version).toBe(1);
    expect(a.artifact_ids_processed).toEqual(["a2", "a1"]);
    expect(a).not.toHaveProperty("hypothesis_ids");
  });
  it("rejects invalid trigger", () => {
    expect(() => buildRunDescriptor({
      clinicId: "c1", businessDate: "2026-07-18", slot: "x",
      policyVersion: 1, cutoffEventSeq: 1, triggerType: "other",
    })).toThrow(/trigger_type_invalid/);
  });
});

describe("Phase 3 hypothesis descriptors", () => {
  it("maps guardrail blocks per hypothesis, not globally", () => {
    const h1 = attach();
    const h2 = attach({
      source_proposal_id: "proposal-2",
      workflow_hypothesis_id: "proposal-2#h0",
      target_workflow_id: "wf-2",
      target_snapshot_id: "snap-2",
    });
    const result = buildHypothesisDescriptors({
      clinicId: "c1",
      compositionRunId: "run-1",
      hypotheses: [h1, h2],
      guardrailResult: {
        checked: [
          { hypothesis: h1, blocks: [{ rule_code: "subject_conflict" }] },
          { hypothesis: h2, blocks: [] },
        ],
        ranked: [h2],
      },
    });
    expect(result[0].validation_blocks).toEqual([{ rule_code: "subject_conflict" }]);
    expect(result[1].validation_blocks).toEqual([]);
    expect(result[1].rank).toBe(0);
  });
  it("incomplete attach remains pending_review and receives a validation block", () => {
    const [result] = buildHypothesisDescriptors({
      clinicId: "c1",
      compositionRunId: "run-1",
      hypotheses: [attach({ target_snapshot_id: null })],
    });
    expect(result.status).toBe("pending_review");
    expect(result.validation_blocks).toContainEqual({ rule_code: "attach_without_snapshot" });
  });
  it("requires authoritative hypothesis keys", () => {
    expect(() => buildHypothesisDescriptors({
      clinicId: "c1", compositionRunId: "run-1",
      hypotheses: [attach({ source_proposal_id: null })],
    })).toThrow(/source_proposal_id/);
  });
});

describe("Phase 3 dispatch boundary", () => {
  it("validation issues force manager dispatch and clear best", () => {
    expect(deriveDispatchDecision({
      guardrailResult: { needsManagerDispatch: false, bestHypothesisId: "h1" },
      validationIssues: [{ type: "orphan_cluster_overlap" }],
    })).toEqual({ needsManagerDispatch: true, bestHypothesisId: null });
  });
});

describe("Phase 3 attention descriptor", () => {
  it("uses schema-required text and does not duplicate hypothesis relation", () => {
    const result = buildAttentionDescriptor({
      clinicId: "c1",
      compositionRunId: "run-1",
      artifactIds: ["a1"],
      evidenceFactCardIds: ["f1"],
      generatedAt: "2026-07-18T10:00:00.000Z",
    });
    expect(result.title).toBeTruthy();
    expect(result.recommendation).toBeTruthy();
    expect(result.generated_at).toBeTruthy();
    expect(result).not.toHaveProperty("hypothesis_ids");
  });
});

describe("Phase 3 safe failures", () => {
  it("never exposes raw error messages, stack or tokens", () => {
    const result = buildRunFailure({
      code: "persistence_failed",
      message: "Bearer secret-token production detail",
      stack: "sensitive stack",
    });
    expect(result).toEqual({
      status: "failed",
      error_message: "composition_run_failed",
      error_code: "persistence_failed",
    });
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });
  it("normalizes unknown codes", () => {
    expect(buildRunFailure({ code: "evil", message: "private" }).error_code)
      .toBe("unknown_failure");
  });
});
