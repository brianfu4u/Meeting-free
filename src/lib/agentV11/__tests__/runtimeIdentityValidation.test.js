import { describe, expect, it } from "vitest";
import {
  collectDeviceIdentityValidationIssues,
  collectSourceContextValidationIssues,
} from "../../../../base44/functions/compositionOrchestrator/runtimeAdapter.ts";

describe("Agent v1.1 source-context hard gates", () => {
  it("blocks undeclared logistics uploads of clinical prescriptions", () => {
    expect(collectSourceContextValidationIssues(
      [{ id: "fc-1", artifact_id: "a-1" }],
      [{ id: "a-1", source_role: "INVENTORY_STAFF", category_id: "prescription_order" }]
    )).toEqual([expect.objectContaining({
      type: "source_role_conflict",
      semantic_class: "hard_source_context_conflict",
      artifact_id: "a-1",
    })]);
  });

  it("blocks cross-family declarations but bypasses declared proxy uploads", () => {
    const cards = [{ id: "fc-1", artifact_id: "a-1" }];
    expect(collectSourceContextValidationIssues(cards, [
      { id: "a-1", source_role: "OPTOMETRIST", category_id: "supply_purchase" },
    ])).toEqual([expect.objectContaining({ type: "business_family_conflict" })]);
    expect(collectSourceContextValidationIssues(cards, [
      { id: "a-1", source_role: "OPTOMETRIST", category_id: "supply_purchase", is_proxy: true },
    ])).toEqual([]);
  });

  it("does not block aligned role and category families", () => {
    expect(collectSourceContextValidationIssues(
      [{ id: "fc-1", artifact_id: "a-1" }],
      [{ id: "a-1", source_role: "OPTOMETRIST", category_id: "refraction_optometry" }]
    )).toEqual([]);
  });
});

describe("Agent v1.1 runtime identity validation", () => {
  it("emits a hard conflict only when every candidate has a different declared device", () => {
    const issues = collectDeviceIdentityValidationIssues([
      {
        id: "fc-1",
        device_serial: "DEVICE-C",
        _candidateWorkflowIds: ["wf-a", "wf-b"],
      },
    ], [
      { id: "wf-a", device_serial: "DEVICE-A" },
      { id: "wf-b", device_serial: "DEVICE-B" },
    ]);
    expect(issues).toEqual([{
      type: "device_identity_conflict",
      semantic_class: "hard_identity_conflict",
      fact_card_id: "fc-1",
      candidate_workflow_ids: ["wf-a", "wf-b"],
    }]);
  });

  it("uses the open same-family pool when the linker returns no candidates", () => {
    const issues = collectDeviceIdentityValidationIssues([
      {
        id: "fc-1",
        workflow_family_hint: "patient_care",
        subject_fingerprint: { device_serial: "DEVICE-C" },
        _candidateWorkflowIds: [],
      },
    ], [
      { id: "wf-a", workflow_family: "patient_care", status: "active", device_serial: "DEVICE-A" },
      { id: "wf-b", workflow_family: "patient_care", status: "active", device_serial: "DEVICE-B" },
      { id: "wf-other", workflow_family: "finance", status: "active", subject_fingerprint: { device_serial: "DEVICE-C" } },
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
        device_serial: "DEVICE-A",
        _candidateWorkflowIds: ["wf-a", "wf-b"],
      },
    ], [
      { id: "wf-a", device_serial: "DEVICE-A" },
      { id: "wf-b", subject_fingerprint: {} },
    ])).toEqual([]);
  });
});
