import { describe, it, expect } from "vitest";
import { validateProposal } from "../guardrailValidator";

const goodTracks = ["T1", "T2", "T3", "T4", "T5", "T6", "T7"].map((id) => ({
  track_id: id,
  supporting_evidence: ["e1"],
  opposing_evidence: [],
  information_gaps: [],
}));

const baseGood = {
  title: "验光卡滞预警",
  urgency: "yellow",
  attention_type: "wait_timeout",
  recommendation: "建议调配验光师支援",
  reasoning_tracks: goodTracks,
  alternative_hypotheses: [
    { hypothesis_id: "H1", description: "验光师不足", fragments_explained: 5, guardrail_violations: 0, unsupported_assumptions_count: 0 },
  ],
  unsupported_assumptions: [],
};

describe("guardrailValidator — 合法提案", () => {
  it("齐全提案 valid 且选出最佳假设", () => {
    const r = validateProposal(baseGood, { tracks: [], hard_guardrails: [], decision_rules: {} });
    expect(r.valid).toBe(true);
    expect(r.guardrail_violations).toBe(0);
    expect(r.bestHypothesisId).toBe("H1");
  });
});

describe("guardrailValidator — 违反检测", () => {
  it("缺 title/recommendation 记违反", () => {
    const bad = { ...baseGood, title: "", recommendation: "" };
    const r = validateProposal(bad, {});
    expect(r.violations).toContain("missing_recommendation_or_title");
  });
  it("无 reasoning_tracks 记违反", () => {
    const bad = { ...baseGood, reasoning_tracks: [] };
    const r = validateProposal(bad, {});
    expect(r.violations).toContain("no_reasoning_tracks");
  });
  it("轨道全空记违反", () => {
    const bad = { ...baseGood, reasoning_tracks: [{ track_id: "T1", supporting_evidence: [], opposing_evidence: [], information_gaps: [] }] };
    const r = validateProposal(bad, {});
    expect(r.violations).toContain("track_T1_empty");
  });
  it("提议 closed 但无终止信号 → 全局护栏违反", () => {
    const policy = { tracks: [], hard_guardrails: ["closed需终止信号"], decision_rules: {} };
    const bad = { ...baseGood, proposed_workflow_status: "closed", terminal_signal_detected: false };
    const r = validateProposal(bad, policy);
    expect(r.violations).toContain("global_no_terminal_for_closure");
  });
  it("提议 handoff 但无交接证据 → 护栏违反", () => {
    const policy = { tracks: [], hard_guardrails: ["handoff需证据"], decision_rules: {} };
    const bad = { ...baseGood, proposed_handoff_department: "medical", handoff_evidence_ids: [] };
    const r = validateProposal(bad, policy);
    expect(r.violations).toContain("global_handoff_without_evidence");
  });
});

describe("guardrailValidator — 假设打分", () => {
  it("违反与无依据假设扣分排序", () => {
    const proposal = {
      ...baseGood,
      alternative_hypotheses: [
        { hypothesis_id: "H1", description: "A", fragments_explained: 6, guardrail_violations: 2, unsupported_assumptions_count: 1 },
        { hypothesis_id: "H2", description: "B", fragments_explained: 4, guardrail_violations: 0, unsupported_assumptions_count: 0 },
      ],
    };
    const policy = { tracks: [], hard_guardrails: [], decision_rules: { guardrail_violation_weight: 3, unsupported_assumption_weight: 1 } };
    const r = validateProposal(proposal, policy);
    // H1: 6 - 2*3 - 1 = -1; H2: 4 - 0 - 0 = 4 → H2 应排前
    expect(r.bestHypothesisId).toBe("H2");
  });
});