import { describe, it, expect, vi } from "vitest";
import { runAssemblySmoke } from "../assemblySmoke.mjs";
import { ASSEMBLY_JSON_SCHEMA, TRACK_IDS } from "../prompts";

const mkNewTrainHyp = () => ({
  workflow_hypothesis_id: "h1",
  workflow_family: "procurement",
  composition_type: "new_train",
  target_workflow_id: null,
  target_snapshot_id: null,
  target_snapshot_version: null,
  ordered_artifact_ids: ["a1", "a2"],
  reasoning_tracks: Object.fromEntries(TRACK_IDS.map((id) => [id, []])),
  unsupported_assumptions: [],
  contradictions: [],
  unexplained_artifact_ids: [],
});

describe("assemblySmoke — 导入真实 ASSEMBLY_JSON_SCHEMA（项7）", () => {
  it("Schema 为导入对象且含 hypotheses required + 七轨道", () => {
    expect(ASSEMBLY_JSON_SCHEMA.required).toContain("hypotheses");
    expect(
      Object.keys(ASSEMBLY_JSON_SCHEMA.properties.hypotheses.items.properties.reasoning_tracks.properties).sort()
    ).toEqual([...TRACK_IDS].sort());
  });

  it("传入 LLM 的 schema 必须是导入的同一对象引用（非手工复制）", async () => {
    const invokeLLM = vi.fn(async () => ({ hypotheses: [mkNewTrainHyp()], unexplained_artifact_ids: [] }));
    await runAssemblySmoke({ invokeLLM });
    expect(invokeLLM.mock.calls[0][0].response_json_schema).toBe(ASSEMBLY_JSON_SCHEMA);
  });

  it("mock 返回合法 new_train → ok=true，七轨道/null 全部符合", async () => {
    const invokeLLM = vi.fn(async () => ({ hypotheses: [mkNewTrainHyp()], unexplained_artifact_ids: [] }));
    const res = await runAssemblySmoke({ invokeLLM });
    expect(res.ok).toBe(true);
    expect(res.checks.seven_tracks_present).toBe(true);
    expect(res.checks.composition_type_new_train).toBe(true);
    expect(res.checks.target_workflow_id_is_null).toBe(true);
    expect(res.schema_imported).toBe(true);
  });

  it("mock 返回缺轨道 → ok=false", async () => {
    const bad = mkNewTrainHyp();
    bad.reasoning_tracks = { subject_fingerprint: [] };
    const invokeLLM = vi.fn(async () => ({ hypotheses: [bad], unexplained_artifact_ids: [] }));
    const res = await runAssemblySmoke({ invokeLLM });
    expect(res.ok).toBe(false);
    expect(res.checks.seven_tracks_present).toBe(false);
  });

  it("缺 invokeLLM 抛错", async () => {
    await expect(runAssemblySmoke({})).rejects.toThrow(/invokeLLM/);
  });
});