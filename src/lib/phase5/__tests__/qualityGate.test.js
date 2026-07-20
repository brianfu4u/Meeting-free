import { describe, expect, it } from "vitest";
import { evaluateFactCard } from "../../../../base44/functions/fragmentIngestionService/qualityGate.ts";
import { ALIGNMENT_STATUS } from "../../../../base44/functions/fragmentIngestionService/contract.ts";

const alignedCard = () => ({
  artifact_id: "a1",
  subject_type: "patient",
  subject_fingerprint: { name: "TEST_FIXTURE" },
  subject_quality: "high",
  occurred_at: "2026-07-20T03:00:00.000Z",
  time_uncertain: false,
  confidence: 0.85,
  evidence_spans: [{ text: "TEST_FIXTURE" }],
  contradictions: [],
  unsupported_assumptions: [],
  interpreter_version: "phase5.interpreter.v1",
  prompt_version: "phase5.prompt.v1",
  fields: [{ field_name: "x", value: "y" }],
});

describe("fragmentIngestionService quality gate", () => {
  it("marks a well-formed identified card as aligned and assembly-eligible", () => {
    const r = evaluateFactCard(alignedCard());
    expect(r.status).toBe(ALIGNMENT_STATUS.aligned);
    expect(r.assembly_eligible).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("downgrades unknown-subject cards to needs_clarification", () => {
    const card = { ...alignedCard(), subject_type: "unknown", subject_fingerprint: {}, subject_quality: "uncertain" };
    const r = evaluateFactCard(card);
    expect(r.status).toBe(ALIGNMENT_STATUS.needs_clarification);
    expect(r.assembly_eligible).toBe(false);
    expect(r.issues).toContain("subject_unknown");
  });

  it("downgrades time-uncertain cards to needs_clarification", () => {
    const card = { ...alignedCard(), occurred_at: null, time_uncertain: true };
    const r = evaluateFactCard(card);
    expect(r.status).toBe(ALIGNMENT_STATUS.needs_clarification);
    expect(r.issues).toContain("time_uncertain");
  });

  it("downgrades low-confidence cards to needs_clarification", () => {
    const card = { ...alignedCard(), confidence: 0.4 };
    const r = evaluateFactCard(card);
    expect(r.status).toBe(ALIGNMENT_STATUS.needs_clarification);
    expect(r.issues).toContain("confidence_low");
  });

  it("rejects cards missing required structural fields", () => {
    const card = alignedCard();
    delete card.artifact_id;
    const r = evaluateFactCard(card);
    expect(r.status).toBe(ALIGNMENT_STATUS.rejected);
    expect(r.assembly_eligible).toBe(false);
    expect(r.issues).toContain("artifact_id_missing");
  });

  it("rejects cards missing evidence_spans array", () => {
    const card = alignedCard();
    delete card.evidence_spans;
    const r = evaluateFactCard(card);
    expect(r.status).toBe(ALIGNMENT_STATUS.rejected);
    expect(r.issues).toContain("evidence_spans_missing");
  });

  it("rejects cards missing interpreter_version", () => {
    const card = alignedCard();
    delete card.interpreter_version;
    const r = evaluateFactCard(card);
    expect(r.status).toBe(ALIGNMENT_STATUS.rejected);
  });

  it("returns rejected for null card", () => {
    const r = evaluateFactCard(null);
    expect(r.status).toBe(ALIGNMENT_STATUS.rejected);
    expect(r.assembly_eligible).toBe(false);
  });
});