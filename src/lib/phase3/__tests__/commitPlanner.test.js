import { describe, expect, it } from "vitest";
import {
  CommitPlanError,
  buildCommitFailureReconciliation,
  buildStaleReconciliation,
  buildWorkflowPointerPatch,
  evaluatePointerCasResult,
  planAttachCommit,
  sanitizeCommitError,
} from "../commitPlanner";

const base = () => ({
  clinicId: "clinic-a",
  now: "2026-07-19T01:00:00.000Z",
  managerDecision: {
    id: "decision-1",
    clinic_id: "clinic-a",
    manager_id: "manager-1",
    target_type: "hypothesis",
    target_id: "proposal-1#h0",
    decision: "approved",
  },
  attentionItem: {
    id: "attention-1",
    clinic_id: "clinic-a",
    selected_hypothesis_id: "proposal-1#h0",
  },
  hypothesis: {
    clinic_id: "clinic-a",
    composition_run_id: "run-1",
    source_proposal_id: "proposal-1",
    workflow_hypothesis_id: "proposal-1#h0",
    composition_type: "attach",
    status: "selected",
    target_workflow_id: "workflow-1",
    target_snapshot_id: "snapshot-3",
    target_snapshot_version: 3,
    ordered_artifact_ids: ["artifact-2", "artifact-1"],
  },
  workflow: {
    id: "workflow-1",
    clinic_id: "clinic-a",
    status: "active",
    current_snapshot_id: "snapshot-3",
    current_snapshot_version: 3,
  },
  currentSnapshot: {
    id: "snapshot-3",
    clinic_id: "clinic-a",
    workflow_id: "workflow-1",
    session_id: "session-1",
    business_line: "optometry",
    start_time: "2026-07-19T00:00:00.000Z",
    status: "active",
    generated_at: "2026-07-19T00:20:00.000Z",
    snapshot_version: 3,
    projection_version: 8,
    artifact_ids: ["artifact-0"],
    nested: { untouched: true },
    created_date: "system",
  },
});

function expectCode(fn, code) {
  expect(fn).toThrowError(CommitPlanError);
  try { fn(); } catch (error) { expect(error.code).toBe(code); }
}

describe("Phase 3 attach commit planner", () => {
  it("builds deterministic intent, immutable snapshot v+1, and exact CAS filter", () => {
    const input = base();
    const before = JSON.parse(JSON.stringify(input.currentSnapshot));
    const plan = planAttachCommit(input);

    expect(plan.manager_execution_idempotency_key).toBe("exec::decision-1::proposal-1");
    expect(plan.intent_descriptor).toMatchObject({
      selected_hypothesis_id: "proposal-1#h0",
      expected_snapshot_id: "snapshot-3",
      expected_snapshot_version: 3,
      new_snapshot_version: 4,
      status: "pending",
    });
    expect(plan.snapshot_descriptor).toMatchObject({
      workflow_id: "workflow-1",
      snapshot_version: 4,
      projection_version: 9,
      manager_decision_id: "decision-1",
      source_proposal_id: "proposal-1",
      artifact_ids: ["artifact-2", "artifact-1"],
    });
    expect(plan.snapshot_descriptor).not.toHaveProperty("id");
    expect(plan.snapshot_descriptor).not.toHaveProperty("created_date");
    expect(plan.workflow_cas_filter).toEqual({
      id: "workflow-1",
      clinic_id: "clinic-a",
      current_snapshot_id: "snapshot-3",
      current_snapshot_version: 3,
    });
    expect(input.currentSnapshot).toEqual(before);
    plan.snapshot_descriptor.nested.untouched = false;
    expect(input.currentSnapshot.nested.untouched).toBe(true);
  });

  it("is deterministic for identical business inputs", () => {
    expect(planAttachCommit(base())).toEqual(planAttachCommit(base()));
  });

  it("builds pointer patch only after a new snapshot ID exists", () => {
    const plan = planAttachCommit(base());
    expect(buildWorkflowPointerPatch(plan, "snapshot-4")).toEqual({
      current_snapshot_id: "snapshot-4",
      current_snapshot_version: 4,
    });
    expectCode(() => buildWorkflowPointerPatch(plan, ""), "new_snapshot_id_required");
  });

  it.each([
    ["workflow pointer id changed", x => { x.workflow.current_snapshot_id = "other"; }, "stale_proposal_snapshot_id_mismatch"],
    ["workflow pointer version changed", x => { x.workflow.current_snapshot_version = 4; }, "stale_proposal_version_mismatch"],
    ["cross tenant workflow", x => { x.workflow.clinic_id = "clinic-b"; }, "workflow_cross_tenant"],
    ["snapshot belongs elsewhere", x => { x.currentSnapshot.workflow_id = "workflow-2"; }, "snapshot_workflow_mismatch"],
    ["snapshot target differs", x => { x.currentSnapshot.id = "snapshot-other"; }, "target_snapshot_mismatch"],
    ["decision targets another hypothesis", x => { x.managerDecision.target_id = "other#h0"; }, "manager_decision_hypothesis_mismatch"],
    ["decision not approved", x => { x.managerDecision.decision = "rejected"; }, "manager_decision_not_approved"],
    ["system manager", x => { x.managerDecision.manager_id = "system"; }, "manager_decision_not_human"],
    ["hypothesis not selected", x => { x.hypothesis.status = "pending_review"; }, "hypothesis_not_selected"],
    ["attention targets another hypothesis", x => { x.attentionItem.selected_hypothesis_id = "other#h0"; }, "attention_hypothesis_link_mismatch"],
  ])("blocks %s before persistence", (_name, mutate, code) => {
    const input = base();
    mutate(input);
    expectCode(() => planAttachCommit(input), code);
  });

  it("explicitly refuses new_train until its creation Saga is defined", () => {
    const input = base();
    input.hypothesis.composition_type = "new_train";
    input.hypothesis.target_workflow_id = null;
    input.hypothesis.target_snapshot_id = null;
    input.hypothesis.target_snapshot_version = null;
    expectCode(() => planAttachCommit(input), "commit_new_train_not_supported");
  });

  it("interprets Base44 CAS updated count strictly", () => {
    expect(evaluatePointerCasResult({ updated: 1 })).toEqual({ ok: true, outcome: "committed" });
    expect(evaluatePointerCasResult({ updated: 0 })).toEqual({
      ok: false,
      outcome: "stale",
      error_code: "stale_proposal",
    });
    expect(evaluatePointerCasResult({ success: true })).toMatchObject({ ok: false, outcome: "stale" });
  });

  it("produces safe stale reconciliation without raw exceptions", () => {
    expect(buildStaleReconciliation({
      now: "2026-07-19T01:01:00.000Z",
      executedSteps: ["intent_created", "snapshot_created"],
    })).toEqual({
      status: "stale",
      finalized_at: "2026-07-19T01:01:00.000Z",
      reconciliation: {
        last_step: "workflow_pointer_cas",
        executed_steps: ["intent_created", "snapshot_created"],
        pending_compensation: ["discard_unreferenced_snapshot"],
        error: "stale_proposal",
      },
    });
  });

  it("allowlists reconciliation error codes and never leaks message/stack/token", () => {
    const secretError = {
      code: "DB_BROKE",
      message: "Authorization Bearer super-secret",
      stack: "stack with token",
    };
    expect(sanitizeCommitError("snapshot_create_failed")).toBe("snapshot_create_failed");
    expect(sanitizeCommitError(secretError)).toBe("commit_failed");
    const patch = buildCommitFailureReconciliation({
      now: "2026-07-19T01:02:00.000Z",
      lastStep: "snapshot_create",
      executedSteps: ["intent_created"],
      error: secretError,
    });
    const json = JSON.stringify(patch);
    expect(json).not.toContain("super-secret");
    expect(json).not.toContain("Bearer");
    expect(json).not.toContain("stack");
    expect(patch.status).toBe("compensation_failed");
  });
});
