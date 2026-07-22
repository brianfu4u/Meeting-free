import { describe, expect, it } from "vitest";
import {
  evaluateHeuristicPolicyShadow,
  inferExpectedMissing,
  validateHeuristicPolicy,
} from "../heuristicPolicy";

const policy = {
  schema_version: "agent-v1.1-policy-v1",
  policy_version: "clinic-policy-v1",
  execution_mode: "shadow",
  candidate_cutoff: { minimum_score: 0.2, maximum_count: 5 },
  temporal_evidence: {
    precedence: ["document", "system_business", "captured_at", "received_at"],
    evaluate_delay_as_fault: false,
  },
  missing_segments: {
    semantics: "descriptive",
    triggers_manager_dispatch: false,
    triggers_exception: false,
  },
  department_handoff_rules: [
    { rule_code: "HANDOFF_OPTOMETRY_DOCTOR", from_department: "OPTOMETRY", to_department: "OUTPATIENT", score_adjustment: 0.2 },
  ],
  proxy_rules: [
    { rule_code: "PROXY_RECEPTION", uploader_role: "RECEPTION", allowed_on_behalf_of_roles: ["DOCTOR"] },
  ],
  finance_reverse_inference: {
    output_status: "expected_missing",
    create_virtual_artifact: false,
    counts_as_closure_evidence: false,
    rules: [
      { rule_code: "REVERSE_INFER_FINANCE_01", payment_category: "oct_exam_fee", expected_artifact_type: "ophthalmic_imaging", confidence: 0.8 },
    ],
  },
};

describe("Agent v1.1 heuristic policy shadow evaluator", () => {
  it("requires explicit shadow mode and product-safe missing/reverse semantics", () => {
    expect(validateHeuristicPolicy(policy)).toEqual({ valid: true, errors: [] });
    expect(validateHeuristicPolicy({ ...policy, execution_mode: "active" }).errors).toContain("execution_mode_must_be_shadow");
    expect(validateHeuristicPolicy({ ...policy, missing_segments: { ...policy.missing_segments, triggers_manager_dispatch: true } }).errors)
      .toContain("missing_segments_dispatch_forbidden");
  });

  it("uses configured department rules and remains non-authoritative", () => {
    const result = evaluateHeuristicPolicyShadow({
      policy,
      evidence: {
        clinic_id: "phase-it-policy",
        department: "OPTOMETRY",
        uploader_role: "OPTOMETRIST",
        event_times: { document: "2026-07-22T09:15:00+09:00", captured_at: "2026-07-22T10:00:00+09:00" },
      },
      candidates: [
        { workflow_id: "wf-a", clinic_id: "phase-it-policy", workflow_status: "open", department: "OUTPATIENT", base_score: 0.4 },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.authoritative).toBe(false);
    expect(result.proposed_candidates[0].candidate_score).toBeCloseTo(0.6);
    expect(result.effective_event_time.event_time_source).toBe("document");
    expect(result.needs_manager_dispatch).toBe(false);
  });

  it("allows a declared proxy but blocks an undeclared source-role conflict", () => {
    const candidate = { workflow_id: "wf-a", clinic_id: "phase-it-policy", workflow_status: "open", department: "OUTPATIENT", base_score: 0.7 };
    const declared = evaluateHeuristicPolicyShadow({
      policy,
      evidence: { clinic_id: "phase-it-policy", uploader_role: "RECEPTION", content_role: "DOCTOR", is_proxy: true, on_behalf_of_role: "DOCTOR", event_times: {} },
      candidates: [candidate],
    });
    expect(declared.proposed_candidates).toHaveLength(1);
    const undeclared = evaluateHeuristicPolicyShadow({
      policy,
      evidence: { clinic_id: "phase-it-policy", uploader_role: "RECEPTION", content_role: "DOCTOR", is_proxy: false, event_times: {} },
      candidates: [candidate],
    });
    expect(undeclared.proposed_candidates).toHaveLength(0);
    expect(undeclared.blocked_candidates[0].rule_codes).toContain("UNDECLARED_SOURCE_ROLE_CONFLICT");
  });

  it("treats financial reverse inference as expected missing, never fact or closure evidence", () => {
    const inferred = inferExpectedMissing({ business_domain: "FINANCE", payment_category: "oct_exam_fee" }, policy);
    expect(inferred).toEqual([expect.objectContaining({
      artifact_type: "ophthalmic_imaging",
      status: "expected_missing",
      creates_fact: false,
      closure_evidence: false,
    })]);
  });

  it("hard-blocks cross-tenant and closed workflows regardless of score", () => {
    const result = evaluateHeuristicPolicyShadow({
      policy,
      evidence: { clinic_id: "clinic-a", uploader_role: "OPTOMETRIST", event_times: {} },
      candidates: [
        { workflow_id: "wf-cross", clinic_id: "clinic-b", workflow_status: "open", base_score: 1 },
        { workflow_id: "wf-closed", clinic_id: "clinic-a", workflow_status: "closed", base_score: 1 },
      ],
    });
    expect(result.proposed_candidates).toHaveLength(0);
    expect(result.blocked_candidates.flatMap((item) => item.rule_codes)).toEqual(expect.arrayContaining(["cross_tenant", "workflow_closed"]));
  });
});
