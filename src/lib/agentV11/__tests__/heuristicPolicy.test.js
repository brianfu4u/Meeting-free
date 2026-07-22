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
  missing_segments: { semantics: "descriptive", triggers_manager_dispatch: false, triggers_exception: false },
  business_family_gating: { enabled: true, conflict_action: "block_candidate" },
  device_consistency: { explicit_conflict_action: "block_candidate" },
  manager_approved_exception: {
    output_status: "manager_approved_exception",
    normal_assembly_eligible: false,
    contributes_to_learning: false,
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

const candidate = {
  workflow_id: "wf-a",
  clinic_id: "phase-it-policy",
  workflow_status: "open",
  business_domain: "CLINICAL",
  department: "OUTPATIENT",
  base_score: 0.7,
};

function evaluate(evidence, candidates = [candidate]) {
  return evaluateHeuristicPolicyShadow({ policy, evidence: { clinic_id: "phase-it-policy", event_times: {}, ...evidence }, candidates });
}

describe("Agent v1.1 heuristic policy shadow evaluator", () => {
  it("requires shadow-only safety configuration", () => {
    expect(validateHeuristicPolicy(policy)).toEqual({ valid: true, errors: [] });
    expect(validateHeuristicPolicy({ ...policy, execution_mode: "active" }).errors).toContain("execution_mode_must_be_shadow");
    expect(validateHeuristicPolicy({ ...policy, manager_approved_exception: { ...policy.manager_approved_exception, normal_assembly_eligible: true } }).errors)
      .toContain("manager_approved_exception_boundary_invalid");
  });

  it("S003 blocks an undeclared source-role conflict and emits rule trace", () => {
    const result = evaluate({ uploader_role: "RECEPTION", content_role: "DOCTOR", is_proxy: false });
    expect(result.proposed_candidates).toHaveLength(0);
    expect(result.blocked_candidates[0].rule_codes).toContain("UNDECLARED_SOURCE_ROLE_CONFLICT");
    expect(result.rule_trace).toContainEqual(expect.objectContaining({ rule_code: "UNDECLARED_SOURCE_ROLE_CONFLICT", effect: "candidate_blocked" }));
  });

  it("allows the configured declared proxy without weakening unrelated hard blocks", () => {
    const result = evaluate({ uploader_role: "RECEPTION", content_role: "DOCTOR", is_proxy: true, on_behalf_of_role: "DOCTOR" });
    expect(result.proposed_candidates).toHaveLength(1);
    expect(result.rule_trace).toContainEqual(expect.objectContaining({ rule_code: "DECLARED_PROXY_ALLOWED", effect: "candidate_scored" }));
  });

  it("S004 blocks a business-family conflict", () => {
    const result = evaluate({ business_domain: "FINANCE" });
    expect(result.proposed_candidates).toHaveLength(0);
    expect(result.blocked_candidates[0].rule_codes).toContain("BUSINESS_FAMILY_CONFLICT");
  });

  it("S009 records financial reverse inference only as expected_missing", () => {
    const evidence = { business_domain: "FINANCE", payment_category: "oct_exam_fee" };
    const inferred = inferExpectedMissing(evidence, policy);
    expect(inferred).toEqual([expect.objectContaining({
      artifact_type: "ophthalmic_imaging",
      status: "expected_missing",
      creates_fact: false,
      closure_evidence: false,
    })]);
    const result = evaluate(evidence, [{ ...candidate, business_domain: "FINANCE" }]);
    expect(result.expected_missing).toEqual(inferred);
    expect(result.creates_virtual_artifact).toBe(false);
    expect(result.contributes_to_closure).toBe(false);
    expect(result.needs_manager_dispatch).toBe(false);
  });

  it("S014 blocks an explicit device identity conflict", () => {
    const result = evaluate({ device_id: "device-a" }, [{ ...candidate, device_id: "device-b" }]);
    expect(result.proposed_candidates).toHaveLength(0);
    expect(result.blocked_candidates[0].rule_codes).toContain("DEVICE_IDENTITY_CONFLICT");
  });

  it("S015 preserves a manager-approved exception as archive-only and excludes normal learning", () => {
    const result = evaluate({ manager_approved_exception: true, business_domain: "CLINICAL" });
    expect(result.proposed_status).toBe("manager_approved_exception");
    expect(result.normal_assembly_eligible).toBe(false);
    expect(result.contributes_to_learning).toBe(false);
    expect(result.proposed_candidates).toHaveLength(0);
    expect(result.blocked_candidates[0].rule_codes).toContain("MANAGER_APPROVED_EXCEPTION_ARCHIVE_ONLY");
  });

  it("remains non-authoritative and never dispatches, closes, or creates facts", () => {
    const result = evaluate({ business_domain: "CLINICAL" });
    expect(result).toEqual(expect.objectContaining({
      authoritative: false,
      execution_mode: "shadow",
      needs_manager_dispatch: false,
      creates_exception: false,
      creates_virtual_artifact: false,
      contributes_to_closure: false,
    }));
  });
});
