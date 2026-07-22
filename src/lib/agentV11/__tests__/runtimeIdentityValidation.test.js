import { describe, expect, it } from "vitest";
import { collectDeviceIdentityValidationIssues } from "../../../../base44/functions/compositionOrchestrator/runtimeAdapter.ts";

describe("Agent v1.1 runtime identity validation", () => {
  it("emits a hard conflict only when every candidate has a different declared device", () => {
    const issues = collectDeviceIdentityValidationIssues([
      {
        id: "fc-1",
        subject_fingerprint: { device_serial: "DEVICE-C" },
        _candidateWorkflowIds: ["wf-a", "wf-b"],
      },
    ], [
      { id: "wf-a", subject_fingerprint: { device_serial: "DEVICE-A" } },
      { id: "wf-b", subject_fingerprint: { device_serial: "DEVICE-B" } },
    ]);
    expect(issues).toEqual([{
      type: "device_identity_conflict",
      semantic_class: "hard_identity_conflict",
      fact_card_id: "fc-1",
      candidate_workflow_ids: ["wf-a", "wf-b"],
    }]);
  });

  it("does not veto when a candidate matches or lacks declared device evidence", () => {
    expect(collectDeviceIdentityValidationIssues([
      {
        id: "fc-1",
        subject_fingerprint: { device_serial: "DEVICE-A" },
        _candidateWorkflowIds: ["wf-a", "wf-b"],
      },
    ], [
      { id: "wf-a", subject_fingerprint: { device_serial: "DEVICE-A" } },
      { id: "wf-b", subject_fingerprint: {} },
    ])).toEqual([]);
  });
});
