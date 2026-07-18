import { describe, it, expect, vi } from "vitest";
import { interpretArtifact } from "../evidenceInterpreter";

describe("evidenceInterpreter — 通用 Workflow 契约字段", () => {
  it("输出 explicit_workflow_id / workflow_family_hint / subject_type / subject_fingerprint / occurred_at，无 session_id", async () => {
    const artifact = {
      id: "art-1",
      clinic_id: "c1",
      artifact_type: "image",
      file_url: "https://example.com/x.png",
      source_region: "optometry",
      source_workflow_id: "wf-9",
      business_date: "2026-07-18",
      captured_at: "2026-07-18T09:30:00Z",
    };
    const invokeLLM = vi.fn(async () => ({
      fields: [
        { field_name: "lens_power", value: "-2.50D", source_region: "处方单", extraction_quality: "high", extraction_method: "ocr" },
      ],
      subject_type: "patient",
      subject_fingerprint: { name: "张三", external_id: "P-001" },
      workflow_family_hint: "patient_visit",
      occurred_at: "2026-07-18T09:25:00Z",
    }));
    const card = await interpretArtifact({ artifact, sopDigest: "...", businessLine: "optometry", policyVersion: 1, invokeLLM });
    expect(card.artifact_id).toBe("art-1");
    expect(card.clinic_id).toBe("c1");
    expect(card.explicit_workflow_id).toBe("wf-9");
    expect(card.workflow_family_hint).toBe("patient_visit");
    expect(card.subject_type).toBe("patient");
    expect(card.subject_fingerprint.name).toBe("张三");
    expect(card.occurred_at).toBe("2026-07-18T09:25:00Z");
    expect(card.extracted_at).toBeTruthy(); // 解读时刻，非业务时间
    expect(card).not.toHaveProperty("session_id");
    expect(card).not.toHaveProperty("_interpreter_session_hint");
    expect(card.fields[0].source_artifact_id).toBe("art-1");
    expect(card.fields[0].extraction_quality).toBe("high");
  });

  it("occurred_at 缺失时以 artifact.captured_at 兜底，extracted_at 不作业务时间", async () => {
    const artifact = {
      id: "art-2", clinic_id: "c1", artifact_type: "file", file_url: "u",
      business_date: "2026-07-18", captured_at: "2026-07-18T10:00:00Z",
    };
    const invokeLLM = vi.fn(async () => ({ fields: [] }));
    const card = await interpretArtifact({ artifact, invokeLLM });
    expect(card.occurred_at).toBe("2026-07-18T10:00:00Z");
    expect(card.occurred_at).not.toBe(card.extracted_at);
  });

  it("图像类走 gemini_3_flash 模型", async () => {
    const artifact = { id: "a", clinic_id: "c", artifact_type: "image", file_url: "u", business_date: "2026-07-18", captured_at: "2026-07-18T09:00:00Z" };
    const invokeLLM = vi.fn(async () => ({ fields: [] }));
    await interpretArtifact({ artifact, invokeLLM });
    expect(invokeLLM.mock.calls[0][0].model).toBe("gemini_3_flash");
  });

  it("缺 file_url 抛错", async () => {
    await expect(interpretArtifact({ artifact: { id: "a" }, invokeLLM: vi.fn() })).rejects.toThrow();
  });
});

describe("evidenceInterpreter → clustering 契约", () => {
  it("interpretArtifact 产出可直接注入 clusterFactCards（通过 explicit_workflow_id）", async () => {
    const { clusterFactCards } = await import("../clustering");
    const artifact = { id: "art-1", clinic_id: "c1", artifact_type: "image", file_url: "u", source_workflow_id: "wf-1", business_date: "2026-07-18", captured_at: "2026-07-18T09:00:00Z" };
    const invokeLLM = vi.fn(async () => ({ fields: [], subject_type: "patient", subject_fingerprint: { name: "张三" }, workflow_family_hint: "patient_visit" }));
    const card = await interpretArtifact({ artifact, invokeLLM, policyVersion: 1 });
    const { trains } = clusterFactCards([{ ...card, _resolvedWorkflowId: "wf-1", _linkMethod: "explicit_id" }]);
    expect(trains[0].workflow_id).toBe("wf-1");
  });
});