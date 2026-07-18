import { describe, it, expect, vi } from "vitest";
import { deterministicCandidates, resolveWorkflowLink } from "../candidateFinder";

const baseWorkflows = [
  { id: "wf-1", clinic_id: "c1", workflow_family: "patient_visit", subject_type: "patient", started_at: "2026-07-18T09:00:00Z", last_event_at: "2026-07-18T09:10:00Z", temporal_anchors: ["2026-07-18T09:10:00Z"] },
  { id: "wf-2", clinic_id: "c1", workflow_family: "patient_visit", subject_type: "patient", started_at: "2026-07-18T09:30:00Z", temporal_anchors: ["2026-07-18T09:40:00Z"] },
];

describe("candidateFinder — 明确ID匹配可自动挂接", () => {
  it("source_workflow_id 命中则自动挂接", async () => {
    const artifact = { id: "a1", clinic_id: "c1", file_url: "u", source_workflow_id: "wf-1", captured_at: "2026-07-18T09:20:00Z" };
    const res = await resolveWorkflowLink({ artifact, workflows: baseWorkflows, invokeLLM: vi.fn(), clinicId: "c1" });
    expect(res.linkedWorkflowId).toBe("wf-1");
    expect(res.method).toBe("explicit_id");
  });
});

describe("candidateFinder — clinic_id 隔离", () => {
  it("其他门店的 workflow 不进入候选", () => {
    const mixed = [...baseWorkflows, { id: "wf-evil", clinic_id: "c-evil", started_at: "2026-07-18T09:35:00Z", temporal_anchors: ["2026-07-18T09:35:00Z"] }];
    const artifact = { id: "a1", clinic_id: "c1", file_url: "u", captured_at: "2026-07-18T09:35:00Z" };
    const cands = deterministicCandidates({ artifact, workflows: mixed, clinicId: "c1" });
    expect(cands.every((c) => c.workflow_id !== "wf-evil")).toBe(true);
  });
  it("resolveWorkflowLink 也强制 clinic_id 隔离", async () => {
    const mixed = [...baseWorkflows, { id: "wf-evil", clinic_id: "c-evil", started_at: "2026-07-18T09:35:00Z", temporal_anchors: ["2026-07-18T09:35:00Z"] }];
    const factCard = { id: "f1", artifact_id: "a1", explicit_workflow_id: null, occurred_at: "2026-07-18T09:35:00Z", fields: [] };
    const res = await resolveWorkflowLink({ factCard, workflows: mixed, invokeLLM: vi.fn(), clinicId: "c1" });
    expect(res.candidates.every((c) => c.workflow_id !== "wf-evil")).toBe(true);
  });
});

describe("candidateFinder — 限制候选数", () => {
  it("时空候选超过上限被截断", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: `wf-${i}`, clinic_id: "c1", started_at: "2026-07-18T09:30:00Z", temporal_anchors: ["2026-07-18T09:35:00Z"],
    }));
    const artifact = { id: "a1", clinic_id: "c1", file_url: "u", captured_at: "2026-07-18T09:35:00Z" };
    const cands = deterministicCandidates({ artifact, workflows: many, clinicId: "c1" });
    expect(cands.length).toBeLessThanOrEqual(5);
  });
});

describe("candidateFinder — 时空匹配仅候选不挂接", () => {
  it("两个患者均落在窗口内，不得自动挂接任一", async () => {
    const artifact = { id: "a1", clinic_id: "c1", file_url: "u", captured_at: "2026-07-18T09:35:00Z" };
    const res = await resolveWorkflowLink({ artifact, workflows: baseWorkflows, invokeLLM: vi.fn(), clinicId: "c1" });
    expect(res.candidates.length).toBe(2);
    expect(res.linkedWorkflowId).toBeNull();
    expect(res.method).toBe("candidate_only");
  });

  it("禁止用 extracted_at 作为业务时间", () => {
    const factCard = { id: "f1", artifact_id: "a1", explicit_workflow_id: null, occurred_at: "2026-07-18T09:35:00Z", extracted_at: "2026-07-18T20:00:00Z", fields: [] };
    const cands = deterministicCandidates({ factCard, workflows: baseWorkflows, clinicId: "c1" });
    expect(cands.length).toBe(2);
  });
});

describe("candidateFinder — 影子模式 LLM 不得自动挂接", () => {
  it("LLM 高置信度仍仅候选", async () => {
    const factCard = { id: "f1", artifact_id: "a1", explicit_workflow_id: null, subject_type: "patient", subject_fingerprint: { name: "张三" }, occurred_at: "2026-07-18T09:35:00Z", fields: [] };
    const invokeLLM = vi.fn(async () => ({ best_workflow_id: "wf-1", confidence: 0.95, reason_codes: ["name_match"] }));
    const res = await resolveWorkflowLink({ factCard, workflows: baseWorkflows, invokeLLM, clinicId: "c1" });
    expect(res.linkedWorkflowId).toBeNull();
    expect(res.method).toBe("candidate_only");
  });
});