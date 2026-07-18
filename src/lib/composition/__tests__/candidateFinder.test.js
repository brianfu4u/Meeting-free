import { describe, it, expect, vi } from "vitest";
import { deterministicCandidates, resolveWorkflowLink } from "../candidateFinder";

const baseWorkflows = [
  { id: "wf-1", clinic_id: "c1", workflow_family: "patient_visit", subject_type: "patient", arrival_time: "2026-07-18T09:00:00Z", node_scan_timestamps: { seated: "2026-07-18T09:10:00Z" } },
  { id: "wf-2", clinic_id: "c1", workflow_family: "patient_visit", subject_type: "patient", arrival_time: "2026-07-18T09:30:00Z", node_scan_timestamps: { seated: "2026-07-18T09:40:00Z" } },
];

describe("candidateFinder — 明确ID匹配可自动挂接", () => {
  it("source_workflow_id 命中则自动挂接", async () => {
    const artifact = { id: "a1", clinic_id: "c1", file_url: "u", source_workflow_id: "wf-1", captured_at: "2026-07-18T09:20:00Z" };
    const res = await resolveWorkflowLink({ artifact, workflows: baseWorkflows, invokeLLM: vi.fn() });
    expect(res.linkedWorkflowId).toBe("wf-1");
    expect(res.method).toBe("explicit_id");
    expect(res.needsManagerReview).toBe(false);
  });

  it("factCard.explicit_workflow_id 命中则自动挂接", async () => {
    const factCard = { id: "f1", artifact_id: "a1", explicit_workflow_id: "wf-2", occurred_at: "2026-07-18T09:35:00Z", fields: [] };
    const res = await resolveWorkflowLink({ factCard, workflows: baseWorkflows, invokeLLM: vi.fn() });
    expect(res.linkedWorkflowId).toBe("wf-2");
    expect(res.method).toBe("explicit_id");
  });
});

describe("candidateFinder — 时间接近仅产生候选，不自动挂接", () => {
  it("两个患者均落在 ±120 分钟，不得自动挂接任一", async () => {
    const artifact = { id: "a1", clinic_id: "c1", file_url: "u", captured_at: "2026-07-18T09:35:00Z" };
    const res = await resolveWorkflowLink({ artifact, workflows: baseWorkflows, invokeLLM: vi.fn() });
    expect(res.candidates.length).toBe(2);
    expect(res.linkedWorkflowId).toBeNull();
    expect(res.method).toBe("candidate_only");
    expect(res.needsManagerReview).toBe(true);
  });

  it("时间接近但仅一个候选，仍不自动挂接", async () => {
    const artifact = { id: "a1", clinic_id: "c1", file_url: "u", captured_at: "2026-07-18T09:35:00Z" };
    const res = await resolveWorkflowLink({ artifact, workflows: [baseWorkflows[0]], invokeLLM: vi.fn() });
    expect(res.candidates.length).toBe(1);
    expect(res.linkedWorkflowId).toBeNull();
    expect(res.needsManagerReview).toBe(true);
  });

  it("时间接近但主体不同，不合并到任一", () => {
    const artifact = { id: "a1", clinic_id: "c1", file_url: "u", captured_at: "2026-07-18T09:35:00Z" };
    const cands = deterministicCandidates({ artifact, workflows: baseWorkflows });
    expect(cands.length).toBe(2);
    expect(cands.every((c) => c.method === "spatiotemporal")).toBe(true);
  });

  it("禁止用 extracted_at 作为业务时间（仅 occurred_at/captured_at）", () => {
    const factCard = { id: "f1", artifact_id: "a1", explicit_workflow_id: null, occurred_at: "2026-07-18T09:35:00Z", extracted_at: "2026-07-18T20:00:00Z", fields: [] };
    const cands = deterministicCandidates({ factCard, workflows: baseWorkflows });
    // occurred_at 落在窗口内 → 命中；若误用 extracted_at(20:00) 则会落在窗口外
    expect(cands.length).toBe(2);
  });
});

describe("candidateFinder — 影子模式 LLM 不得自动挂接", () => {
  it("LLM 返回高置信度，仍仅记录候选，不挂接", async () => {
    const factCard = { id: "f1", artifact_id: "a1", explicit_workflow_id: null, subject_type: "patient", subject_fingerprint: { name: "张三" }, occurred_at: "2026-07-18T09:35:00Z", fields: [] };
    const invokeLLM = vi.fn(async () => ({ best_workflow_id: "wf-1", confidence: 0.95, reason_codes: ["name_match"] }));
    const res = await resolveWorkflowLink({ factCard, workflows: baseWorkflows, invokeLLM });
    expect(res.linkedWorkflowId).toBeNull();
    expect(res.method).toBe("candidate_only");
    expect(res.needsManagerReview).toBe(true);
    const llmCand = res.candidates.find((c) => c.method === "llm");
    expect(llmCand.confidence).toBe(0.95);
  });

  it("LLM 返回低置信度，同样不挂接（无阈值门控）", async () => {
    const factCard = { id: "f1", artifact_id: "a1", explicit_workflow_id: null, occurred_at: "2026-07-18T09:35:00Z", fields: [] };
    const invokeLLM = vi.fn(async () => ({ best_workflow_id: "wf-1", confidence: 0.2, reason_codes: [] }));
    const res = await resolveWorkflowLink({ factCard, workflows: baseWorkflows, invokeLLM });
    expect(res.linkedWorkflowId).toBeNull();
    expect(res.needsManagerReview).toBe(true);
  });
});