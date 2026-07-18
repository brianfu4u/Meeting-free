import { describe, it, expect, vi } from "vitest";
import { assembleWorkflow } from "../workflowAssembly";

const factCards = [
  { id: "f1", artifact_id: "a1", fields: [{ field_name: "lens_power", value: "-2.50D" }] },
  { id: "f2", artifact_id: "a2", fields: [{ field_name: "va", value: "0.8" }] },
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
        workflow_hypothesis_id: "hyp-1",
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
      needs_manager_dispatch: false,
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
    expect(h.reasoning_tracks.causal_chain).toEqual([]); // 未使用轨道允许空
    expect(res.source_proposal_id).toBeTruthy();
    // 不含运营预警型字段
    expect(h).not.toHaveProperty("attention_type");
    expect(h).not.toHaveProperty("urgency");
  });

  it("未使用轨道补齐为空数组，不强制编造", async () => {
    const cluster = { fact_card_ids: ["f1"], artifact_ids: ["a1"], composition_type: "new_train" };
    const invokeLLM = vi.fn(async () => ({
      hypotheses: [{
        workflow_hypothesis_id: "h",
        workflow_family: "patient_visit",
        composition_type: "new_train",
        ordered_artifact_ids: ["a1"],
        reasoning_tracks: { subject_fingerprint: ["x"] },
      }],
      unexplained_artifact_ids: [],
      needs_manager_dispatch: false,
    }));
    const res = await assembleWorkflow({ cluster, compositionType: "new_train", factCards, invokeLLM, clinicId: "c1", policyVersion: 1 });
    expect(res.hypotheses[0].reasoning_tracks.open_loop_closure).toEqual([]);
    expect(res.hypotheses[0].reasoning_tracks.document_lineage).toEqual([]);
  });
});

describe("workflowAssembly — 非患者 Workflow 可编组", () => {
  it("采购流程 procurement 可编组为 new_train", async () => {
    const cluster = { fact_card_ids: ["f1", "f2"], artifact_ids: ["a1", "a2"], composition_type: "new_train", workflow_family_hint: "procurement" };
    const invokeLLM = vi.fn(async () => ({
      hypotheses: [{
        workflow_hypothesis_id: "h2",
        workflow_family: "procurement",
        composition_type: "new_train",
        target_workflow_id: null,
        ordered_artifact_ids: ["a1", "a2"],
        reasoning_tracks: { causal_chain: ["采购申请→审批→收货"] },
      }],
      unexplained_artifact_ids: [],
      needs_manager_dispatch: false,
    }));
    const res = await assembleWorkflow({ cluster, compositionType: "new_train", factCards, invokeLLM, clinicId: "c1", policyVersion: 1 });
    expect(res.hypotheses[0].workflow_family).toBe("procurement");
    expect(res.hypotheses[0].composition_type).toBe("new_train");
    expect(res.hypotheses[0].target_workflow_id).toBeNull();
  });
});

describe("workflowAssembly — 仅传入列车相关 factCards 给 LLM", () => {
  it("prompt 不含其他列车的 artifact", async () => {
    const allCards = [...factCards, { id: "fX", artifact_id: "aX", fields: [] }];
    const cluster = { fact_card_ids: ["f1", "f2"], artifact_ids: ["a1", "a2"], composition_type: "attach" };
    const invokeLLM = vi.fn(async () => ({
      hypotheses: [{
        workflow_hypothesis_id: "h",
        workflow_family: "patient_visit",
        composition_type: "attach",
        target_workflow_id: "wf-1",
        ordered_artifact_ids: ["a1", "a2"],
        reasoning_tracks: {},
      }],
      unexplained_artifact_ids: [],
      needs_manager_dispatch: false,
    }));
    await assembleWorkflow({
      cluster, compositionType: "attach", factCards: allCards,
      workflow: { id: "wf-1" }, invokeLLM, clinicId: "c1", policyVersion: 1,
    });
    const promptArg = invokeLLM.mock.calls[0][0].prompt;
    expect(promptArg).toContain('"artifact_id":"a1"');
    expect(promptArg).toContain('"artifact_id":"a2"');
    expect(promptArg).not.toContain('"artifact_id":"aX"');
  });
});