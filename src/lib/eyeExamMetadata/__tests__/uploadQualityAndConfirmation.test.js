import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  EYE_EXAM_ITEM_CANDIDATES,
  getEyeExamItemCandidates,
  inferEyeExamItemTag,
  validateEyeExamItemConfirmation,
} from "../../../../base44/shared/eyeExamMetadata/examItemCatalog.ts";
import {
  assessEyeExamOcrQuality,
  LOW_QUALITY_REUPLOAD_CODE,
  OCR_QUALITY_POOR_THRESHOLD,
} from "../../../../base44/shared/eyeExamMetadata/ocrQuality.ts";
import {
  buildEyeExamUploadResponse,
  buildLowQualityEyeExamMetadata,
  finalizeParsedEyeExamMetadata,
} from "../../../../base44/shared/eyeExamMetadata/uploadPolicy.ts";
import {
  createEyeExamMetadata,
  metadataToFactCardFields,
} from "../../../../base44/shared/eyeExamMetadata/model.ts";
import {
  coreRoutingFieldsForLlm,
  deterministicCandidates,
  getEyeExamMatchingContext,
  llmCandidateMatch,
} from "../../composition/candidateFinder.js";

const context = {
  clinic_id: "clinic-001",
  raw_artifact_id: "artifact-001",
  evidence_fact_card_id: "fact-001",
  occurred_at: "2026-08-01T10:00:00Z",
  reported_at: "2026-08-01T10:01:00Z",
  department: "特检室",
  role: "OPTOMETRIST",
};

const clearTono = `TOPCON CT-800
TONO DATA
2026/08/01 09:35
OD AVG 19 mmHg
OS AVG 17 mmHg`;

const clearRefraction = `TOPCON KR-800
REF. DATA
2026_08_01 AM 10:34
VD: 12.00
<R> S C A
-2.25 -1.00 163
<L> S C A
-2.50 -1.25 140
PD: 61.5`;

describe("eye exam OCR upload quality gate", () => {
  it("marks a short garbled OCR result as poor", () => {
    const quality = assessEyeExamOcrQuality("||||||||||\n������\n....");
    expect(quality.flag).toBe("poor");
    expect(quality.score).toBeLessThan(OCR_QUALITY_POOR_THRESHOLD);
    expect(quality.reasons.length).toBeGreaterThan(0);
  });

  it("uses provider confidence as a hard low-quality signal", () => {
    const quality = assessEyeExamOcrQuality(clearTono, { provider_confidence: 0.2 });
    expect(quality.flag).toBe("poor");
    expect(quality.reasons).toContain("ocr_provider_confidence_too_low");
  });

  it("does not misclassify clear Tono and refraction reports", () => {
    const tonoQuality = assessEyeExamOcrQuality(clearTono, { provider_confidence: 0.91 });
    const refQuality = assessEyeExamOcrQuality(clearRefraction, { provider_confidence: 88 });
    expect(tonoQuality.flag).toBe("good");
    expect(refQuality.flag).toBe("good");
    expect(tonoQuality.score).toBeGreaterThanOrEqual(70);
    expect(refQuality.score).toBeGreaterThanOrEqual(70);
  });

  it("builds a minimal reupload record and skips item confirmation", () => {
    const quality = assessEyeExamOcrQuality("TOPCON\nOCT\n����", { provider_confidence: 0.12 });
    const metadata = buildLowQualityEyeExamMetadata({ context, rawText: "TOPCON\nOCT\n����", quality });
    const response = buildEyeExamUploadResponse(metadata);
    expect(metadata).toMatchObject({
      parser_id: "low_quality_eye_exam_gate",
      ocr_quality_flag: "poor",
      requires_reupload: true,
      requires_exam_item_confirmation: false,
      parse_status: "partial",
      routing_status: "routing_ready",
      value_add_status: "value_add_unavailable",
    });
    expect(metadata.warnings).toContain(LOW_QUALITY_REUPLOAD_CODE);
    expect(response.warning_code).toBe(LOW_QUALITY_REUPLOAD_CODE);
  });
});

describe("eye exam item confirmation catalog", () => {
  it("exposes the supported business candidate list in a stable order", () => {
    expect(getEyeExamItemCandidates().map((item) => item.id)).toEqual([
      "tono",
      "refraction",
      "macular_oct",
      "optic_nerve_oct",
      "fundus_photo",
      "corneal_endothelium",
      "ocular_ultrasound",
      "other_eye_exam",
    ]);
    expect(EYE_EXAM_ITEM_CANDIDATES.at(-1)).toMatchObject({
      id: "other_eye_exam",
      requires_note: true,
    });
  });

  it("suggests macular and optic nerve OCT separately", () => {
    expect(inferEyeExamItemTag({ exam_type: "OCT", exam_item_name: "Macular Cube 512x128" })).toBe("macular_oct");
    expect(inferEyeExamItemTag({ exam_type: "OCT", exam_item_name: "Optic Disc Cube 200x200 RNFL" })).toBe("optic_nerve_oct");
  });

  it("requires a note for other eye exams", () => {
    expect(validateEyeExamItemConfirmation("other_eye_exam", "")).toEqual({
      ok: false,
      error_code: "eye_exam_item_other_note_required",
    });
    expect(validateEyeExamItemConfirmation("other_eye_exam", "视野检查")).toMatchObject({
      ok: true,
      note: "视野检查",
    });
  });

  it("marks a clear parsed report as requiring confirmation", () => {
    const quality = assessEyeExamOcrQuality(clearTono, { provider_confidence: 0.92 });
    const metadata = finalizeParsedEyeExamMetadata({
      parsedMetadata: {
        ...context,
        exam_type: "眼压检查",
        exam_item_name: "Tono Data",
        parser_id: "topcon_tono_parser",
        parser_version: "phase1.v1",
        parse_status: "parsed",
        parse_confidence: 0.96,
        eye_side_results: {
          right: { key_values: { average_iop_mmhg: 19 } },
          left: { key_values: { average_iop_mmhg: 17 } },
        },
      },
      quality,
    });
    expect(metadata).toMatchObject({
      ocr_quality_flag: "good",
      requires_reupload: false,
      requires_exam_item_confirmation: true,
      exam_item_suggested_tag: "tono",
      routing_status: "routing_ready",
    });
    expect(metadata.value_add_fields.eye_side_results.right.key_values.average_iop_mmhg).toBe(19);
  });
});

describe("manual item projection and workflow matching", () => {
  const confirmedMetadata = createEyeExamMetadata({
    ...context,
    exam_type: "OCT",
    exam_item_name: "Macular Cube 512x128",
    exam_item_suggested_tag: "macular_oct",
    exam_item_manual_tag: "optic_nerve_oct",
    exam_item_manual_label: "视神经 OCT",
    exam_item_confirmed_at: "2026-08-01T13:00:00Z",
    exam_item_confirmed_by_staff_id: "staff-001",
    requires_exam_item_confirmation: false,
    parser_id: "zeiss_oct_parser",
    parser_version: "phase1.v1",
    parse_status: "parsed",
    parse_confidence: 0.9,
  });
  const fields = metadataToFactCardFields(confirmedMetadata, "artifact-001");
  const factCard = {
    id: "fact-001",
    clinic_id: "clinic-001",
    artifact_id: "artifact-001",
    occurred_at: "2026-08-01T10:00:00Z",
    fields,
  };

  it("projects the manual tag as the canonical core routing item", () => {
    expect(fields.find((field) => field.field_name === "eye_exam.exam_item_manual_tag")).toMatchObject({
      value: "optic_nerve_oct",
      extraction_quality: "high",
      extraction_method: "user_confirmed",
    });
    expect(fields.find((field) => field.field_name === "routing.item_tag")?.value).toBe("optic_nerve_oct");
    expect(fields.find((field) => field.field_name === "eye_exam.match_exam_item")?.value).toBe("optic_nerve_oct");
    expect(getEyeExamMatchingContext(factCard)).toMatchObject({
      manual_tag: "optic_nerve_oct",
      automatic_exam_item_name: "Macular Cube 512x128",
      effective_match_item: "optic_nerve_oct",
      source: "user_confirmed",
    });
  });

  it("ranks a workflow matching the manual item ahead of a closer automatic mismatch", () => {
    const candidates = deterministicCandidates({
      factCard,
      clinicId: "clinic-001",
      workflows: [
        {
          id: "wf-macular",
          clinic_id: "clinic-001",
          expected_exam_item_tag: "macular_oct",
          temporal_anchors: ["2026-08-01T10:00:00Z"],
        },
        {
          id: "wf-optic",
          clinic_id: "clinic-001",
          expected_exam_item_tag: "optic_nerve_oct",
          temporal_anchors: ["2026-08-01T10:20:00Z"],
        },
      ],
    });
    expect(candidates.map((candidate) => candidate.workflow_id)).toEqual(["wf-optic", "wf-macular"]);
    expect(candidates[0]).toMatchObject({ item_match_source: "manual", score: 0.82 });
  });

  it("puts the manual core tag into the LLM prompt and excludes value-add fields", async () => {
    const factCardWithDetailNoise = {
      ...factCard,
      fields: [
        ...factCard.fields,
        { field_name: "eye_exam.right.sphere_d", value: "-9.99" },
        { field_name: "eye_exam.device_model", value: "SECRET-MODEL" },
      ],
    };
    const invokeLLM = vi.fn(async () => ({
      best_workflow_id: "wf-optic",
      confidence: 0.88,
      reason_codes: ["manual_exam_item_match"],
    }));
    await llmCandidateMatch({
      factCard: factCardWithDetailNoise,
      candidateWorkflows: [
        { id: "wf-optic", workflow_family: "patient_visit", expected_exam_item_tag: "optic_nerve_oct" },
      ],
      invokeLLM,
    });
    const prompt = invokeLLM.mock.calls[0][0].prompt;
    expect(prompt).toContain('"item_tag":"optic_nerve_oct"');
    expect(prompt).toContain('"item_tag_source":"user_confirmed"');
    expect(prompt).not.toContain("-9.99");
    expect(prompt).not.toContain("SECRET-MODEL");
    expect(coreRoutingFieldsForLlm(factCardWithDetailNoise).some((field) => field.field_name === "eye_exam.right.sphere_d")).toBe(false);
  });
});

describe("upload service and frontend wiring", () => {
  it("runs the poor-quality gate before detailed dispatch and exposes confirmation action", () => {
    const source = readFileSync("base44/functions/eyeExamMetadataService/entry.ts", "utf8");
    expect(source).toContain('ACTION_CONFIRM_EXAM_ITEM = "confirmExamItem"');
    expect(source).toContain("assessEyeExamOcrQuality");
    expect(source).toContain('if (ocrQuality.flag === "poor")');
    expect(source).toContain("getEyeExamItemCandidates");
    expect(source.indexOf('if (ocrQuality.flag === "poor")')).toBeLessThan(
      source.indexOf("dispatchEyeExamReportMetadata({ rawText"),
    );
  });

  it("contains the exact reupload message and interactive confirmation flow", () => {
    const modal = readFileSync("src/components/staffPad/MetaTaggingModal.jsx", "utf8");
    const client = readFileSync("src/lib/phase5/ingestionClient.js", "utf8");
    expect(modal).toContain("这张检查报告照片过于模糊，系统无法可靠识别关键信息，请重新拍照并上传。");
    expect(modal).toContain("confirmEyeExamItem");
    expect(modal).toContain("other_eye_exam");
    expect(client).toContain(LOW_QUALITY_REUPLOAD_CODE);
    expect(client).toContain("requires_exam_item_confirmation");
  });
});
