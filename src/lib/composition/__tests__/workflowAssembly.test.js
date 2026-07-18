import { describe, it, expect, vi } from "vitest";
import { assembleWorkflow } from "../workflowAssembly";

const factCards = [
  { id: "f1", artifact_id: "a1", explicit_workflow_id: null, subject_type: "patient", subject_fingerprint: { name: "张三" }, occurred_at: "2026-07-18T09:00:00Z", fields: [{ field_name: "lens_power", value: "-2.50D" }] },
  { id: "f2", artifact_id: "a2", explicit_workflow_id: null, subject_type: "patient", subject_fingerprint: { name: "张三" }, occurred_at: "2026-07-18T09:30:00Z", fields: [{ field_name: "va", value: "0.8" }] },
];

const TRACK_KEYS = [
  "subject_fingerprint",
  "causal_chain",
  "temporal_continuity",
  "department_handoff",
  "actor_device_location",
  "document_lineage",
  "open_loop_closure",
];

describe("workflowAssembly — 编组目标输出", () => {
  it("产出 hypotheses，含七条轨道键与 composition_type", async () => {
    const cluster = { fact_card_ids: ["f1", "f2"], artifact_ids: ["a1", "a2"], composition_type: "attach", workflow_id: "wf-1" };
    const invokeLLM = vi.fn(async () => ({
      hypotheses: [{
        workflow_hypothesis_id: "ignored",
        workflow_family: "patient_visit",
        composition_type: "attach",
        target_workflow_id: "wf-1",
        ordered_artifact_ids: ["a1", "a2"],
        reasoning_tracks: { subject_fingerprint: ["姓名张三"], causal_chain: [], temporal_continuity: ["同日"], department_handoff: [], actor_device_location: [], document_lineage: [], open_loop_closure: [] },
        unsupported_assumptions: [],
        contradictions: [],
        unexplained_artifact_ids: [],
      }],
      unexplained_artifact_ids: [],
      needs_manager_dispatch: true, // LLM 自报，应被忽略
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
    expect(h.target_workflow_id).toBe("wf-1");
    expect(Object.keys(h.reasoning_tracks).sort()).toEqual(TRACK_KEYS.slice().sort());
    expect(h.reasoning_tracks.causal_chain).toEqual([]);
    expect(res.source_proposal_id).toBeTruthy();
    // 关键：assembly 不返回 LLM 自报 needs_manager_dispatch（唯一来源是 guardrail）
    expect(res).not.toHaveProperty("needs_manager_dispatch");
    // LLM 自报 hypothesis_id 被确定性 ID 覆盖
    expect(h.workflow_hypothesis_id).not.toBe("ignored");
  });

  it("未使用轨道补齐为空数组，不强制编造", async () => {
    const cluster = { fact_card_ids: ["f1"], artifact_ids: ["a1"], composition_type: "new_train" };
    const invokeLLM = vi.fn(async () => ({ hypotheses: [{ workflow_hypothesis_id: "h", workflow_family: "patient_visit", composition_type: "new_train", ordered_artifact_ids: ["a1"], reasoning_tracks: { subject_fingerprint: ["x"] } }], unexplained_artifact_ids: [] }));
    const res = await assembleWorkflow({ cluster, compositionType: "new_train", factCards, invokeLLM, clinicId: "c1", policyVersion: 1 });
    expect(res.hypotheses[0].reasoning_tracks.open_loop_closure).toEqual([]);
  });
});

describe("workflowAssembly — target_snapshot_id / target_snapshot_version", () => {
  it("传入 snapshot → hypothesis 携带 target_snapshot_id 与 version", async () => {
    const cluster = { fact_card_ids: ["f1", "f2"], artifact_ids: ["a1", "a2"], composition_type: "attach" };
    const invokeLLM = vi.fn(async () => ({ hypotheses: [{ workflow_hypothesis_id: "h", workflow_family: "patient_visit", composition_type: "attach", target_workflow_id: "wf-1", ordered_artifact_ids: ["a1", "a2"], reasoning_tracks: {} }], unexplained_artifact_ids: [] }));
    const res = await assembleWorkflow({
      cluster, compositionType: "attach", factCards,
      workflow: { id: "wf-1" },
      snapshot: { id: "snap-7", snapshot_version: 3 },
      invokeLLM, clinicId: "c1", policyVersion: 1,
    });
    expect(res.hypotheses[0].target_snapshot_id).toBe("snap-7");
    expect(res.hypotheses[0].target_snapshot_version).toBe(3);
  });

  it("无 snapshot 时 target_snapshot_id/version 为 null", async () => {
    const cluster = { fact_card_ids: ["f1"], artifact_ids: ["a1"], composition_type: "new_train" };
    const invokeLLM = vi.fn(async () => ({ hypotheses: [{ workflow_hypothesis_id: "h", workflow_family: "procurement", composition_type: "new_train", ordered_artifact_ids: ["a1"], reasoning_tracks: {} }], unexplained_artifact_ids: [] }));
    const res = await assembleWorkflow({ cluster, compositionType: "new_train", factCards, invokeLLM, clinicId: "c1", policyVersion: 1 });
    expect(res.hypotheses[0].target_snapshot_id).toBeNull();
    expect(res.hypotheses[0].target_snapshot_version).toBeNull();
  });
});

describe("workflowAssembly — new_train null Schema 实际调用", () => {
  it("Schema 的 target_workflow_id 类型包含 null，且 new_train hypothesis target_workflow_id 为 null", async () => {
    const cluster = { fact_card_ids: ["f1", "f2"], artifact_ids: ["a1", "a2"], composition_type: "new_train", workflow_family_hint: "procurement" };
    const invokeLLM = vi.fn(async () => ({ hypotheses: [{ workflow_hypothesis_id: "h2", workflow_family: "procurement", composition_type: "new_train", target_workflow_id: null, ordered_artifact_ids: ["a1", "a2"], reasoning_tracks: { causal_chain: ["采购→收货"] } }], unexplained_artifact_ids: [] }));
    const res = await assembleWorkflow({ cluster, compositionType: "new_train", factCards, invokeLLM, clinicId: "c1", policyVersion: 1 });
    const schema = invokeLLM.mock.calls[0][0].response_json_schema;
    const targetType = schema.properties.hypotheses.items.properties.target_workflow_id.type;
    expect(targetType).toContain("null");
    expect(res.hypotheses[0].composition_type).toBe("new_train");
    expect(res.hypotheses[0].target_workflow_id).toBeNull();
    expect(res.hypotheses[0].workflow_family).toBe("procurement");
  });
});

describe("workflowAssembly — 确定性 hypothesis ID（重试稳定）", () => {
  it("相同输入两次调用产生相同 hypothesis ID", async () => {
    const cluster = { fact_card_ids: ["f1", "f2"], artifact_ids: ["a1", "a2"], composition_type: "attach" };
    const mkInvoke = () => vi.fn(async () => ({ hypotheses: [{ workflow_hypothesis_id: "x", workflow_family: "patient_visit", composition_type: "attach", target_workflow_id: "wf-1", ordered_artifact_ids: ["a1", "a2"], reasoning_tracks: {} }], unexplained_artifact_ids: [] }));
    const res1 = await assembleWorkflow({ cluster, compositionType: "attach", factCards, workflow: { id: "wf-1" }, invokeLLM: mkInvoke(), clinicId: "c1", policyVersion: 1, assemblyRunId: "run-1" });
    const res2 = await assembleWorkflow({ cluster, compositionType: "attach", factCards, workflow: { id: "wf-1" }, invokeLLM: mkInvoke(), clinicId: "c1", policyVersion: 1, assemblyRunId: "run-1" });
    expect(res1.hypotheses[0].workflow_hypothesis_id).toBe(res2.hypotheses[0].workflow_hypothesis_id);
    expect(res1.hypotheses[0].workflow_hypothesis_id).toMatch(/#h0$/);
  });
});

describe("workflowAssembly — 仅传入列车相关 factCards 给 LLM", () => {
  it("prompt 不含其他列车的 artifact", async () => {
    const allCards = [...factCards, { id: "fX", artifact_id: "aX", fields: [] }];
    const cluster = { fact_card_ids: ["f1", "f2"], artifact_ids: ["a1", "a2"], composition_type: "attach" };
    const invokeLLM = vi.fn(async () => ({ hypotheses: [{ workflow_hypothesis_id: "h", workflow_family: "patient_visit", composition_type: "attach", target_workflow_id: "wf-1", ordered_artifact_ids: ["a1", "a2"], reasoning_tracks: {} }], unexplained_artifact_ids: [] }));
    await assembleWorkflow({ cluster, compositionType: "attach", factCards: allCards, workflow: { id: "wf-1" }, invokeLLM, clinicId: "c1", policyVersion: 1 });
    const promptArg = invokeLLM.mock.calls[0][0].prompt;
    expect(promptArg).toContain('"artifact_id":"a1"');
    expect(promptArg).toContain('"artifact_id":"a2"');
    expect(promptArg).not.toContain('"artifact_id":"aX"');
  });
});