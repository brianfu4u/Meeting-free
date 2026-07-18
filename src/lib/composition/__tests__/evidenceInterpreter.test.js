import { describe, it, expect, vi } from "vitest";
import { interpretArtifact } from "../evidenceInterpreter";

describe("evidenceInterpreter — 契约映射", () => {
  it("注入 source_artifact_id 与抽取质量，返回 EvidenceFactCard 草案", async () => {
    const artifact = {
      id: "art-1",
      clinic_id: "c1",
      artifact_type: "image",
      file_url: "https://example.com/x.png",
      source_region: "optometry",
      business_date: "2026-07-18",
      captured_at: "2026-07-18T09:30:00Z",
    };
    const invokeLLM = vi.fn(async () => ({
      fields: [
        { field_name: "lens_power", value: "-2.50D", source_region: "处方单", extraction_quality: "high", extraction_method: "ocr" },
        { field_name: "patient_name", value: "张三", extraction_quality: "medium" },
      ],
      session_hint: "P-001",
    }));
    const card = await interpretArtifact({ artifact, sopDigest: "...", businessLine: "optometry", policyVersion: 1, invokeLLM });
    expect(invokeLLM).toHaveBeenCalledOnce();
    expect(card.artifact_id).toBe("art-1");
    expect(card.clinic_id).toBe("c1");
    expect(card.session_id).toBeNull();
    expect(card.fields).toHaveLength(2);
    expect(card.fields[0].source_artifact_id).toBe("art-1");
    expect(card.fields[0].extraction_quality).toBe("high");
    expect(card._interpreter_session_hint).toBe("P-001");
    expect(card.policy_version).toBe(1);
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