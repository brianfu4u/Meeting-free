import { describe, it, expect, vi } from "vitest";
import { deterministicCandidates, resolveWorkflowLink } from "../candidateFinder";

const baseWorkflows = [
  { id: "wf-1", workflow_family: "patient_visit", subject_type: "patient", arrival_time: "2026-07-18T09:00:00Z", node_scan_timestamps: { seated: "2026-07-18T09:10:00Z" } },
  { id: "wf-2", workflow_family: "patient_visit", subject_type: "patient", arrival_time: "2026-07-18T09:30:00Z", node_scan_timestamps: { seated: "2026-07-18T09:40:00Z" } },
];

describe("candidateFinder — 明确ID匹配可自动挂接", () => {
  it("source_workflow_id 命中则自动挂接", async () => {
    const artifact = { id: "a1", clinic_id: "c1", file_url: "u", source_workflow_id: "wf-1", captured_at: "2026-07-18T09:20:00Z" };
    const res = await resolveWorkflowLink({ artifact, workflows: baseWorkflows, invokeLLM: vi.fn() });
    expect(res.linkedWorkflowId).toBe("wf-1");
    expect(res.method).toBe("explicit_id");
    expect(res.needsManagerReview).toBe(false);
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

  it("时间接近但仅一个候选，仍不自动挂接（身份未确定）", async () => {
    const artifact = { id: "a1", clinic_id: "c1", file_url: "u", captured_at: "2026-07-18T09:35:00Z" };
    const res = await resolveWorkflowLink({ artifact, workflows: [baseWorkflows[0]], invokeLLM: vi.fn() });
    expect(res.candidates.length).toBe(1);
    expect(res.linkedWorkflowId).toBeNull();
    expect(res.needsManagerReview).toBe(true);
  });

  it("时间接近但主体不同（无显式绑定），不合并到任一", () => {
    const artifact = { id: "a1", clinic_id: "c1", file_url: "u", captured_at: "2026-07-18T09:35:00Z" };
    const cands = deterministicCandidates({ artifact, workflows: baseWorkflows });
    // 两个均为候选，无任一被自动选定
    expect(cands.length).toBe(2);
    expect(cands.every((c) => c.method === "spatiotemporal")).toBe(true);
  });
});

describe("candidateFinder — 影子模式 LLM 不得自动挂接", () => {
  it("LLM 返回高置信度，仍仅记录候选，不挂接", async () => {
    const factCard = { id: "f1", artifact_id: "a1", workflow_id: null, fields: [{ field_name: "patient_name", value: "张三" }] };
    const invokeLLM = vi.fn(async () => ({ best_workflow_id: "wf-1", confidence: 0.95, reason_codes: ["name_match"] }));
    const res = await resolveWorkflowLink({ factCard, workflows: baseWorkflows, invokeLLM });
    expect(res.linkedWorkflowId).toBeNull();
    expect(res.method).toBe("candidate_only");
    expect(res.needsManagerReview).toBe(true);
    const llmCand = res.candidates.find((c) => c.method === "llm");
    expect(llmCand.confidence).toBe(0.95); // 仅记录，不决定挂接
  });

  it("LLM 返回低置信度，同样不挂接（无阈值门控逻辑）", async () => {
    const factCard = { id: "f1", artifact_id: "a1", workflow_id: null, fields: [{ field_name: "patient_name", value: "张三" }] };
    const invokeLLM = vi.fn(async () => ({ best_workflow_id: "wf-1", confidence: 0.2, reason_codes: [] }));
    const res = await resolveWorkflowLink({ factCard, workflows: baseWorkflows, invokeLLM });
    expect(res.linkedWorkflowId).toBeNull();
    expect(res.needsManagerReview).toBe(true);
  });
});