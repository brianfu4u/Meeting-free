import { describe, expect, it, vi } from "vitest";
import {
  EYE_EXAM_PARSER_REGISTRY,
  dispatchEyeExamReportMetadata,
  selectEyeExamParser,
} from "../../../../base44/shared/eyeExamMetadata/dispatch.ts";
import {
  EYE_EXAM_DISCLAIMER,
  EYE_EXAM_METADATA_SCHEMA_VERSION,
  metadataToFactCardFields,
} from "../../../../base44/shared/eyeExamMetadata/model.ts";

const baseContext = {
  clinic_id: "clinic-001",
  patient_id: "session-001",
  raw_artifact_id: "artifact-001",
  origin_evidence_item_id: "evidence-001",
};

const noLlm = { mock: true };

describe("eye exam report metadata dispatch", () => {
  it("registers parsers by vendor and report format rather than hospital", () => {
    expect(EYE_EXAM_PARSER_REGISTRY.map((parser) => parser.id)).toEqual([
      "topcon_tono_parser",
      "topcon_refraction_parser",
      "zeiss_oct_parser",
      "generic_fundus_photo_parser",
      "generic_corneal_endothelium_parser",
      "generic_ocular_ultrasound_parser",
    ]);
  });

  it("parses a TOPCON Tono Data receipt into bilateral IOP metadata", async () => {
    const text = `TOPCON CT-800\nTONO DATA\n2026/08/01 09:35\nOD AVG: 19 mmHg\nOS AVG: 17 mmHg`;
    expect(selectEyeExamParser(text)?.parser.id).toBe("topcon_tono_parser");

    const result = await dispatchEyeExamReportMetadata({ rawText: text, context: baseContext, deps: noLlm });
    expect(result).toMatchObject({
      schema_version: EYE_EXAM_METADATA_SCHEMA_VERSION,
      record_kind: "exam_data_record",
      exam_type: "眼压检查",
      exam_item_name: "Tono Data",
      device_vendor: "TOPCON",
      device_model: "CT-800",
      measured_at: "2026-08-01T09:35:00",
      parser_id: "topcon_tono_parser",
      parse_status: "parsed",
      disclaimer: EYE_EXAM_DISCLAIMER,
    });
    expect(result.eye_side_results.right.key_values.average_iop_mmhg).toBe(19);
    expect(result.eye_side_results.left.key_values.average_iop_mmhg).toBe(17);
  });

  it("parses a TOPCON automatic refraction receipt", async () => {
    const text = `TOPCON KR-800\nREF DATA\n2026-08-01 10:05\nOD SPH -2.50 CYL -0.75 AXIS 90\nOS SPH -3.00 CYL -0.50 AXIS 85`;
    const result = await dispatchEyeExamReportMetadata({ rawText: text, context: baseContext, deps: noLlm });
    expect(result.parser_id).toBe("topcon_refraction_parser");
    expect(result.exam_type).toBe("屈光验光");
    expect(result.eye_side_results.right.key_values).toMatchObject({
      sphere_d: -2.5,
      cylinder_d: -0.75,
      axis_deg: 90,
    });
    expect(result.eye_side_results.left.key_values.sphere_d).toBe(-3);
  });

  it("parses the clinic TOPCON multi-row OCR receipt as complete metadata", async () => {
    const text = `NAME
2026_08_01 AM 10:34
NO.0465
SN:4694190
REF. DATA
VD: 12.00 CYL: (-)
<R> S C A
 - 2.25 - 1.25 163
 - 2.25 - 1.00 164
 - 2.25 - 1.00 163
 - 2.25 - 1.00 163
 S. E. - 2.75
<L> S C A
 - 2.50 - 1.25 14
 - 2.50 - 1.00 14
 - 2.25 - 1.25 14
 - 2.50 - 1.25 14
 S. E. - 3.25
PD: 61.5
TOPCON`;

    const result = await dispatchEyeExamReportMetadata({ rawText: text, context: baseContext, deps: noLlm });

    expect(result).toMatchObject({
      schema_version: EYE_EXAM_METADATA_SCHEMA_VERSION,
      parser_id: "topcon_refraction_parser",
      parser_version: "phase1.1.v1",
      parse_status: "parsed",
      exam_type: "屈光验光",
      exam_item_name: "自动验光 / Ref Data",
      device_vendor: "TOPCON",
      measured_at: "2026-08-01T10:34:00",
      report_key_values: { pd_mm: 61.5, vd_mm: 12 },
    });
    expect(result.eye_side_results.right.key_values).toMatchObject({
      sphere_d: -2.75,
      spherical_equivalent_d: -2.75,
      cylinder_d: -1,
      axis_deg: 163,
    });
    expect(result.eye_side_results.left.key_values).toMatchObject({
      sphere_d: -3.25,
      spherical_equivalent_d: -3.25,
      cylinder_d: -1.25,
      axis_deg: 140,
      axis_original_ocr_deg: 14,
      axis_correction_applied: true,
    });
    expect(result.eye_side_results.right.raw_measurements).toHaveLength(4);
    expect(result.eye_side_results.left.raw_measurements).toHaveLength(4);
    expect(result.eye_side_results.left.raw_measurements[0]).toMatchObject({
      sphere_d: -2.5,
      cylinder_d: -1.25,
      axis_raw_deg: 14,
      axis_deg: 140,
    });
    expect(result.warnings).toContain("left_axis_trailing_zero_ocr_recovered");
    expect(result.warnings).not.toContain("refraction_values_not_fully_detected");

    const fields = metadataToFactCardFields(result, "artifact-001");
    expect(fields.some((field) => field.field_name === "eye_exam.pd_mm" && field.value === "61.5")).toBe(true);
    expect(fields.some((field) => field.field_name === "eye_exam.vd_mm" && field.value === "12")).toBe(true);
    expect(fields.some((field) => field.field_name === "eye_exam.left.axis_deg" && field.value === "140")).toBe(true);
  });

  it("parses a ZEISS Cirrus OCT report", async () => {
    const text = `ZEISS CIRRUS HD-OCT 5000\nMacular Cube 512x128\n2026/08/01 11:20\nOD Central Subfield Thickness: 248 um Signal Strength: 8\nOS Central Subfield Thickness: 251 um Signal Strength: 9`;
    const result = await dispatchEyeExamReportMetadata({ rawText: text, context: baseContext, deps: noLlm });
    expect(result.parser_id).toBe("zeiss_oct_parser");
    expect(result.exam_type).toBe("OCT");
    expect(result.exam_item_name).toBe("Macular Cube 512x128");
    expect(result.eye_side_results.right.key_values.central_subfield_thickness_um).toBe(248);
    expect(result.eye_side_results.left.key_values.signal_strength).toBe(9);
  });

  it("records fundus photography without interpreting image findings", async () => {
    const text = `CANON CR-2\nColor Fundus Photography\n2026-08-01\nOD image captured\nOS image captured`;
    const result = await dispatchEyeExamReportMetadata({ rawText: text, context: baseContext, deps: noLlm });
    expect(result.parser_id).toBe("generic_fundus_photo_parser");
    expect(result.exam_type).toBe("眼底照相");
    expect(result.warnings).toContain("image_findings_are_not_interpreted_in_phase1");
  });

  it("parses corneal endothelial cell values", async () => {
    const text = `TOMEY EM-4000\nCorneal Endothelial Cell Analysis\nOD CD 2780 CCT 532 CV 31 HEX 56\nOS CD 2690 CCT 528 CV 33 HEX 54`;
    const result = await dispatchEyeExamReportMetadata({ rawText: text, context: baseContext, deps: noLlm });
    expect(result.parser_id).toBe("generic_corneal_endothelium_parser");
    expect(result.eye_side_results.right.key_values.cell_density_cells_mm2).toBe(2780);
    expect(result.eye_side_results.left.key_values.cct_um).toBe(528);
  });

  it("parses ophthalmic A/B ultrasound measurements", async () => {
    const text = `NIDEK US-4000\nOcular Ultrasound A/B Scan\nOD Axial Length 24.12 mm ACD 3.21 mm Lens Thickness 4.35 mm\nOS Axial Length 23.98 mm ACD 3.18 mm Lens Thickness 4.30 mm`;
    const result = await dispatchEyeExamReportMetadata({ rawText: text, context: baseContext, deps: noLlm });
    expect(result.parser_id).toBe("generic_ocular_ultrasound_parser");
    expect(result.exam_type).toBe("眼科超声");
    expect(result.eye_side_results.right.key_values.axial_length_mm).toBe(24.12);
    expect(result.eye_side_results.left.key_values.anterior_chamber_depth_mm).toBe(3.18);
  });

  it("uses fallback for an unknown but clearly ophthalmic report", async () => {
    const text = `NIDEK UNKNOWN FORMAT\n眼科检查报告\n2026-08-01\nOD value block A\nOS value block B`;
    const result = await dispatchEyeExamReportMetadata({ rawText: text, context: baseContext, deps: noLlm });
    expect(result.parser_id).toBe("fallback_eye_exam_parser");
    expect(result.exam_type).toBe("未识别眼科检查报告");
    expect(result.parse_status).toBe("fallback");
    expect(result.warnings).toContain("format_not_fully_adapted");
    expect(result.raw_text_excerpt).toContain("UNKNOWN FORMAT");
  });

  it("ignores non-eye operational documents", async () => {
    const result = await dispatchEyeExamReportMetadata({
      rawText: "供应商送货单 2026-08-01 镜架 20 件",
      context: baseContext,
      deps: noLlm,
    });
    expect(result).toBeNull();
  });

  it("uses constrained LLM completion without accepting diagnosis or treatment fields", async () => {
    const invokeLLM = vi.fn(async () => ({
      exam_type: "眼压检查",
      exam_item_name: "Tono Data",
      device_vendor: "TOPCON",
      device_model: "CT-800",
      measured_at: "2026-08-01T09:35:00",
      eye_side_results: {
        right: { raw_text: "OD 19", key_values: { average_iop_mmhg: 19 } },
        left: { raw_text: "OS 17", key_values: { average_iop_mmhg: 17 } },
      },
      parse_status: "parsed",
      parse_confidence: 0.9,
      warnings: [],
      diagnosis: "青光眼",
      treatment_recommendation: "用药",
    }));

    const result = await dispatchEyeExamReportMetadata({
      rawText: "TOPCON Tono Data OD 19 mmHg OS 17 mmHg",
      context: baseContext,
      deps: { mock: false, invokeLLM },
    });
    expect(invokeLLM).toHaveBeenCalledTimes(1);
    expect(result).not.toHaveProperty("diagnosis");
    expect(result).not.toHaveProperty("treatment_recommendation");
    expect(result.disclaimer).toBe(EYE_EXAM_DISCLAIMER);
    expect(result.clinic_id).toBe("clinic-001");
  });

  it("flattens stable metadata fields for EvidenceFactCard consumption", async () => {
    const result = await dispatchEyeExamReportMetadata({
      rawText: "TOPCON CT-800\nTono Data\nOD AVG 19 mmHg\nOS AVG 17 mmHg",
      context: baseContext,
      deps: noLlm,
    });
    const fields = metadataToFactCardFields(result, "artifact-001");
    expect(fields.some((field) => field.field_name === "eye_exam.exam_type" && field.value === "眼压检查")).toBe(true);
    expect(fields.some((field) => field.field_name === "eye_exam.right.average_iop_mmhg" && field.value === "19")).toBe(true);
    expect(fields.every((field) => field.source_artifact_id === "artifact-001")).toBe(true);
  });
});
