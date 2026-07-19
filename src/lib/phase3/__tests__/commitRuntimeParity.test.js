import { describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { planAttachCommit } from "../commitPlanner";
import {
  executeAttachCommitSagaRuntime,
  planAttachCommitRuntime,
} from "../../../../base44/functions/compositionOrchestrator/runtime/commitRuntime.js";

const input = () => ({
  clinicId: "c1",
  now: "2026-07-19T02:00:00.000Z",
  managerDecision: {
    id: "md1", clinic_id: "c1", manager_id: "manager1",
    target_type: "hypothesis", target_id: "p1#h0", decision: "approved",
  },
  attentionItem: {
    id: "att1", clinic_id: "c1", selected_hypothesis_id: "p1#h0",
  },
  hypothesis: {
    clinic_id: "c1", composition_run_id: "run1", source_proposal_id: "p1",
    workflow_hypothesis_id: "p1#h0", composition_type: "attach", status: "selected",
    target_workflow_id: "wf1", target_snapshot_id: "snap3",
    target_snapshot_version: 3, ordered_artifact_ids: ["a1"],
  },
  workflow: {
    id: "wf1", clinic_id: "c1", status: "active",
    current_snapshot_id: "snap3", current_snapshot_version: 3,
  },
  currentSnapshot: {
    id: "snap3", clinic_id: "c1", workflow_id: "wf1",
    session_id: "s1", business_line: "optometry",
    start_time: "2026-07-19T00:00:00.000Z",
    generated_at: "2026-07-19T01:00:00.000Z",
    status: "active", snapshot_version: 3, projection_version: 3,
  },
});

describe("Base44 commit runtime parity", () => {
  it("pins the exact canonical Planner/Saga source blobs", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const runtime = fs.readFileSync(
      path.resolve(
        here,
        "../../../../base44/functions/compositionOrchestrator/runtime/commitRuntime.js"
      ),
      "utf8"
    );
    expect(runtime).toContain(
      "src/lib/phase3/commitPlanner.js blob=de527c61941b640cdd83fd83f6b6f8926c461999"
    );
    expect(runtime).toContain(
      "src/lib/phase3/commitSaga.js blob=efc10bbaa47d4fb9c3a47fbe9345c90497015365"
    );
  });

  it("produces the same attach plan as the canonical module", () => {
    expect(planAttachCommitRuntime(input())).toEqual(planAttachCommit(input()));
  });

  it("uses updated===1 and persists committed projections", async () => {
    const plan = planAttachCommitRuntime(input());
    let intent = null;
    const ops = {
      findIntentByKey: vi.fn(async () => intent),
      createIntent: vi.fn(async descriptor => {
        intent = { id: "intent1", ...descriptor };
        return intent;
      }),
      updateIntent: vi.fn(async (_id, patch) => {
        intent = { ...intent, ...patch };
        return intent;
      }),
      createSnapshot: vi.fn(async descriptor => ({ id: "snap4", ...descriptor })),
      getWorkflow: vi.fn(async () => ({
        id: "wf1", clinic_id: "c1",
        current_snapshot_id: "snap4", current_snapshot_version: 4,
      })),
      casWorkflowPointer: vi.fn(async () => ({
        success: true, updated: 1, has_more: false,
      })),
      updateHypothesis: vi.fn(async (_id, patch) => patch),
      updateAttention: vi.fn(async (_id, patch) => patch),
      updateManagerDecision: vi.fn(async (_id, patch) => patch),
    };
    const result = await executeAttachCommitSagaRuntime({
      plan, ops, now: "2026-07-19T02:01:00.000Z",
    });
    expect(result).toMatchObject({ outcome: "committed", idempotent: false });
    expect(ops.casWorkflowPointer).toHaveBeenCalledWith(
      plan.workflow_cas_filter,
      { current_snapshot_id: "snap4", current_snapshot_version: 4 }
    );
    expect(intent.status).toBe("committed");
  });

  it("does not treat success=true as CAS success without updated=1", async () => {
    const plan = planAttachCommitRuntime(input());
    let intent = null;
    const ops = {
      findIntentByKey: vi.fn(async () => intent),
      createIntent: vi.fn(async descriptor => {
        intent = { id: "intent1", ...descriptor };
        return intent;
      }),
      updateIntent: vi.fn(async (_id, patch) => {
        intent = { ...intent, ...patch };
        return intent;
      }),
      createSnapshot: vi.fn(async descriptor => ({ id: "snap4", ...descriptor })),
      getWorkflow: vi.fn(async () => null),
      casWorkflowPointer: vi.fn(async () => ({ success: true })),
      updateHypothesis: vi.fn(async (_id, patch) => patch),
      updateAttention: vi.fn(async (_id, patch) => patch),
      updateManagerDecision: vi.fn(async (_id, patch) => patch),
    };
    const result = await executeAttachCommitSagaRuntime({
      plan, ops, now: "2026-07-19T02:01:00.000Z",
    });
    expect(result.outcome).toBe("stale");
    expect(intent.status).toBe("stale");
  });
});
