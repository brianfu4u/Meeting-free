import { describe, it, expect, vi } from "vitest";
import { assembleWorkflow } from "../workflowAssembly";

const factCards = [
  { id: "f1", artifact_id: "a1", explicit_workflow_id: null, subject_type: "patient", subject_fingerprint: { name: "张三" }, subject_quality: "high", occurred_at: "2026-07-18T09:00:00Z", fields: [{ field_name: "lens_power", value: "-2.50D" }] },
  { id: "f2", artifact_id: "a2", explicit_workflow_id: null, subject_type: "patient", subject_fingerprint: { name: "张三" }, subject_quality: "high", occurred_at: "2026-07-18T09:30:00Z", fields: [{ field_name: "va", value: "0.8" }] },
];

const TRACK_KEYS = ["subject_fingerprint", "causal_chain", "temporal_continuity", "department_handoff", "actor_device_location", "document_lineage", "open_loop_closure"];

describe("workflowAssembly — 编组目标输出", () => {
  it("产出 hypotheses，含七轨道键与 composition_type，忽略 LLM 自报 needs_manager_dispatch", async () => {
    const cluster = { fact_card_ids: ["f1", "f2"], artifact_ids: ["a1", "a2"], composition_type: "attach", workflow_id: "wf-1" };
    const invokeLLM = vi.fn(async () => ({
      hypotheses: [{
        workflow_hypothesis_id: "ignored", workflow_family: "patient_visit", composition_type: "attach",
        target_workflow_id: "wf-1", target_snapshot_id: null, target_snapshot_version: null,
        ordered_artifact_ids: ["a1", "a2"], reasoning_tracks: { subject_fingerprint: ["姓名张三"] },
        unsupported_assumptions: [], contradictions: [], unexplained_artifact_ids: [],
      }],
      unexplained_artifact_ids: [],
      needs_manager_dispatch: true,
    }));
    const res = await assembleWorkflow({
      cluster, compositionType: "attach", factCards,
      workflow: { id: "wf-1", workflow_family: "patient_visit", open_loops: [] },
      candidateWorkflows: [{ id: "wf-1", workflow_family: "patient_visit" }],
      invokeLLM, clinicId: "c1", policyVersion: 1, assemblyRunId: "run-1",
    });
    expect(res.hypotheses).toHaveLength(1);
    const h = res.hypotheses[0];
    expect(h.composition_type).toBe("attach");
    expect(Object.keys(h.reasoning_tracks).sort()).toEqual(TRACK_KEYS.slice().sort());
    expect(res).not.toHaveProperty("needs_manager_dispatch");
    expect(h.workflow_hypothesis_id).not.toBe("ignored");
    expect(h.source_proposal_id).toBe(res.source_proposal_id);
    expect(h.source_proposal_id).toBe("c1::art:a1,a2::pv1");
  });
});

describe("workflowAssembly — target_snapshot_id / target_snapshot_version", () => {
  it("传入 snapshot → hypothesis 携带 id 与 version", async () => {
    const cluster = { fact_card_ids: ["f1", "f2"], artifact_ids: ["a1", "a2"], composition_type: "attach" };
    const invokeLLM = vi.fn(async () => ({ hypotheses: [{ workflow_hypothesis_id: "h", workflow_family: "patient_visit", composition_type: "attach", target_workflow_id: "wf-1", target_snapshot_id: "snap-7", target_snapshot_version: 3, ordered_artifact_ids: ["a1", "a2"], reasoning_tracks: {}, unsupported_assumptions: [], contradictions: [], unexplained_artifact_ids: [] }], unexplained_artifact_ids: [] }));
    const res = await assembleWorkflow({ cluster, compositionType: "attach", factCards, workflow: { id: "wf-1" }, snapshot: { id: "snap-7", snapshot_version: 3 }, invokeLLM, clinicId: "c1", policyVersion: 1 });
    expect(res.hypotheses[0].target_snapshot_id).toBe("snap-7");
    expect(res.hypotheses[0].target_snapshot_version).toBe(3);
  });

  it("无 snapshot → target_snapshot_id/version 为 null", async () => {
    const cluster = { fact_card_ids: ["f1", "f2"], artifact_ids: ["a1", "a2"], composition_type: "new_train", workflow_family_hint: "procurement" };
    const invokeLLM = vi.fn(async () => ({ hypotheses: [{ workflow_hypothesis_id: "h2", workflow_family: "procurement", composition_type: "new_train", target_workflow_id: null, target_snapshot_id: null, target_snapshot_version: null, ordered_artifact_ids: ["a1", "a2"], reasoning_tracks: {}, unsupported_assumptions: [], contradictions: [], unexplained_artifact_ids: [] }], unexplained_artifact_ids: [] }));
    const res = await assembleWorkflow({ cluster, compositionType: "new_train", factCards, invokeLLM, clinicId: "c1", policyVersion: 1 });
    expect(res.hypotheses[0].target_snapshot_id).toBeNull();
    expect(res.hypotheses[0].target_snapshot_version).toBeNull();
  });
});

describe("workflowAssembly — new_train null Schema 实际调用", () => {
  it("Schema target_workflow_id 含 null 类型，new_train hypothesis target_workflow_id 为 null", async () => {
    const cluster = { fact_card_ids: ["f1", "f2"], artifact_ids: ["a1", "a2"], composition_type: "new_train", workflow_family_hint: "procurement" };
    const invokeLLM = vi.fn(async () => ({ hypotheses: [{ workflow_hypothesis_id: "h2", workflow_family: "procurement", composition_type: "new_train", target_workflow_id: null, target_snapshot_id: null, target_snapshot_version: null, ordered_artifact_ids: ["a1", "a2"], reasoning_tracks: { causal_chain: ["采购→收货"] }, unsupported_assumptions: [], contradictions: [], unexplained_artifact_ids: [] }], unexplained_artifact_ids: [] }));
    const res = await assembleWorkflow({ cluster, compositionType: "new_train", factCards, invokeLLM, clinicId: "c1", policyVersion: 1 });
    const schema = invokeLLM.mock.calls[0][0].response_json_schema;
    expect(schema.properties.hypotheses.items.properties.target_workflow_id.type).toContain("null");
    expect(res.hypotheses[0].target_workflow_id).toBeNull();
  });
});

describe("workflowAssembly — 确定性 hypothesis ID（重试稳定）", () => {
  it("相同输入两次调用产生相同 hypothesis ID", async () => {
    const cluster = { fact_card_ids: ["f1", "f2"], artifact_ids: ["a1", "a2"], composition_type: "attach" };
    const mk = () => vi.fn(async () => ({ hypotheses: [{ workflow_hypothesis_id: "x", workflow_family: "patient_visit", composition_type: "attach", target_workflow_id: "wf-1", target_snapshot_id: null, target_snapshot_version: null, ordered_artifact_ids: ["a1", "a2"], reasoning_tracks: {}, unsupported_assumptions: [], contradictions: [], unexplained_artifact_ids: [] }], unexplained_artifact_ids: [] }));
    const r1 = await assembleWorkflow({ cluster, compositionType: "attach", factCards, workflow: { id: "wf-1" }, invokeLLM: mk(), clinicId: "c1", policyVersion: 1, assemblyRunId: "run-1" });
    const r2 = await assembleWorkflow({ cluster, compositionType: "attach", factCards, workflow: { id: "wf-1" }, invokeLLM: mk(), clinicId: "c1", policyVersion: 1, assemblyRunId: "run-1" });
    expect(r1.hypotheses[0].workflow_hypothesis_id).toBe(r2.hypotheses[0].workflow_hypothesis_id);
    expect(r1.hypotheses[0].workflow_hypothesis_id).toMatch(/#h0$/);
  });
});

describe("workflowAssembly — source_proposal_id 缺失禁止生成 hypothesis", () => {
  it("缺 clinicId 抛错（无 hyp-0 兜底）", async () => {
    const cluster = { fact_card_ids: ["f1"], artifact_ids: ["a1"], composition_type: "attach" };
    await expect(assembleWorkflow({ cluster, factCards, invokeLLM: vi.fn(), policyVersion: 1 })).rejects.toThrow(/source_proposal_id/);
  });
  it("缺 policyVersion 抛错", async () => {
    const cluster = { fact_card_ids: ["f1"], artifact_ids: ["a1"], composition_type: "attach" };
    await expect(assembleWorkflow({ cluster, factCards, invokeLLM: vi.fn(), clinicId: "c1" })).rejects.toThrow(/source_proposal_id/);
  });
  it("空 artifact_ids 抛错", async () => {
    const cluster = { fact_card_ids: ["f1"], artifact_ids: [], composition_type: "attach" };
    await expect(assembleWorkflow({ cluster, factCards, invokeLLM: vi.fn(), clinicId: "c1", policyVersion: 1 })).rejects.toThrow(/source_proposal_id/);
  });
});