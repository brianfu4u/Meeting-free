import { describe, expect, it } from "vitest";
import { collectManagerExceptionValidationIssues } from "../../../../base44/functions/compositionOrchestrator/runtimeAdapter.ts";

describe("Agent v1.1 manager exception isolation", () => {
  it("hard-isolates only explicitly archived exception artifacts", () => {
    const cards = [
      { id: "fc-exception", artifact_id: "a-exception" },
      { id: "fc-proxy", artifact_id: "a-proxy" },
    ];
    const artifacts = [
      {
        id: "a-exception",
        exception_class: "manager_approved_exception",
        normal_rule_learning_eligible: false,
        is_proxy: true,
      },
      {
        id: "a-proxy",
        is_proxy: true,
        source_role: "RECEPTION",
        proxy_for_role: "DOCTOR",
        category_id: "prescription_order",
        normal_rule_learning_eligible: true,
      },
    ];
    expect(collectManagerExceptionValidationIssues(cards, artifacts)).toEqual([
      expect.objectContaining({
        type: "manager_exception_archive_only",
        semantic_class: "hard_exception_isolation",
        artifact_id: "a-exception",
        normal_rule_learning_eligible: false,
      }),
    ]);
  });

  it("does not convert a one-off approval into a reusable normal rule", () => {
    const ordinaryProxy = [{ id: "a2", is_proxy: true, normal_rule_learning_eligible: true }];
    const card = [{ id: "fc2", artifact_id: "a2" }];
    const managerArchive = {
      target_type: "artifact_exception",
      target_id: "different-artifact",
      decision_scope: "exception_archive_only",
      normal_rule_learning_eligible: false,
    };
    expect(managerArchive.decision_scope).toBe("exception_archive_only");
    expect(collectManagerExceptionValidationIssues(card, ordinaryProxy)).toEqual([]);
  });
});
