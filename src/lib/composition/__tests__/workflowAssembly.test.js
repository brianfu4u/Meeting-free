import { describe, it, expect, vi } from "vitest";
import { assembleWorkflow } from "../workflowAssembly";

const train = {
  session_id: "sess-1",
  fact_card_ids: ["f1", "f2"],
  artifact_ids: ["a1", "a2"],
  methods: ["explicit_id"],
};

const factCards = [
  { id: "f1", artifact_id: "a1", session_id: "sess-1", fields: [{ field_name: "lens_power", value: "-2.50D" }] },
  { id: "f2", artifact_id: "a2", session_id: "sess-1", fields: [{ field_name: "va", value: "0.8" }] },
];

const llmResponse = {
  title: "验光卡滞",
  urgency: "yellow",
  attention_type: "wait_timeout",
  recommendation: "调配验光师支援",
  reasoning: "节点超时20分钟",
  reasoning_tracks: [{ track_id: "T5", supporting_evidence: ["f1"], opposing_evidence: [], information_gaps: [] }],
  alternative_hypotheses: [
    { hypothesis_id: "H1", description: "验光师不足", fragments_explained: 2, guardrail_violations: 0, unsupported_assumptions_count: 0 },
  ],
  terminal_signal_detected: false,
  unsupported_assumptions: [],
};

describe("workflowAssembly — 产出与校验", () => {
  it("规范化七条轨道并填充 source_proposal_id", async () => {
    const invokeLLM = vi.fn(async () => llmResponse);
    const { proposal, validation } = await assembleWorkflow({
      train,
      factCards,
      snapshot: { id: "snap-1", llm_summary: "验光中", current_node: "验光开始", total_elapsed_minutes: 25 },
      sopDigest: "...",
      guessPolicy: { tracks: [], hard_guardrails: [], decision_rules: {} },
      invokeLLM,
      clinicId: "c1",
      policyVersion: 1,
    });
    expect(proposal.session_id).toBe("sess-1");
    expect(proposal.reasoning_tracks).toHaveLength(7);
    expect(proposal.shadow_mode_snapshot).toBe(true);
    expect(proposal.evidence_fact_card_ids).toEqual(["f1", "f2"]);
    expect(proposal.source_proposal_id).toContain("c1::");
    expect(validation).toBeDefined();
  });

  it("仅传入列车相关 factCards 给 LLM", async () => {
    const invokeLLM = vi.fn(async () => llmResponse);
    await assembleWorkflow({
      train,
      factCards: [...factCards, { id: "fX", artifact_id: "aX", session_id: "sess-2", fields: [] }],
      guessPolicy: {},
      invokeLLM,
      clinicId: "c1",
      policyVersion: 1,
    });
    // prompt 中只应含 a1/a2，不含 aX
    const promptArg = invokeLLM.mock.calls[0][0].prompt;
    expect(promptArg).toContain('"artifact_id":"a1"');
    expect(promptArg).toContain('"artifact_id":"a2"');
    expect(promptArg).not.toContain('"artifact_id":"aX"');
  });
});