import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { dispatchEyeExamReportMetadata } from "../../../../base44/shared/eyeExamMetadata/dispatch.ts";
import {
  EYE_EXAM_FORMAT_TEMPLATES,
  selectEyeExamFormatTemplate,
} from "../../../../base44/shared/eyeExamMetadata/templateRegistry.ts";
import {
  aggregateParsingQuality,
  buildParsingQualityEvent,
  mapParseStatusToQualityStatus,
} from "../../../../base44/shared/eyeExamMetadata/quality.ts";

const baseContext = {
  clinic_id: "clinic-001",
  patient_id: "session-001",
  raw_artifact_id: "artifact-001",
};

describe("eye exam format generalization", () => {
  it("registers reusable format templates by report family", () => {
    expect(EYE_EXAM_FORMAT_TEMPLATES.map((template) => template.id)).toEqual([
      "topcon_tono_data_v1",
      "topcon_ref_data_v1",
      "zeiss_cirrus_oct_v1",
      "generic_fundus_photo_v1",
      "generic_corneal_endothelium_v1",
      "generic_ocular_ultrasound_v1",
    ]);
  });

  it("matches the same TOPCON refraction template when values and spacing change", () => {
    const first = `TOPCON\nREF. DATA\nVD:12.00\n<R> S C A\n-2.25 -1.00 163\nS. E. -2.75\n<L> S C A\n-3.00 -0.75 85\nPD:61.5`;
    const second = `TOPCON KR-800 AUTO REF\nOD SPH +0.50 CYL -2.25 AXIS 12\nOS SPH -6.00 CYL -1.50 AXIS 177\nPD 63.0`;
    expect(selectEyeExamFormatTemplate(first)?.template.id).toBe("topcon_ref_data_v1");
    expect(selectEyeExamFormatTemplate(second)?.template.id).toBe("topcon_ref_data_v1");
  });

  it("does not match an operational invoice as an eye-exam template", () => {
    expect(selectEyeExamFormatTemplate("供应商送货单 镜架 20 件 合计 3000 元")).toBeNull();
  });

  it("uses fixed format guidance for constrained LLM completion", async () => {
    const invokeLLM = vi.fn(async () => ({
      exam_type: "屈光验光",
      exam_item_name: "自动验光 / Ref Data",
      device_vendor: "TOPCON",
      device_model: null,
      measured_at: "2026-08-01T10:34:00",
      eye_side_results: {
        right: { raw_text: "<R> S C A -2.25 -1.00 163", key_values: { sphere_d: -2.25, cylinder_d: -1, axis_deg: 163 } },
        left: { raw_text: "<L> S C A -2.50 -1.25 140", key_values: { sphere_d: -2.5, cylinder_d: -1.25, axis_deg: 140 } },
      },
      parse_status: "parsed",
      parse_confidence: 0.9,
      warnings: [],
    }));

    // PR #59 now fully parses a complete TOPCON REF. DATA receipt without
    // LLM. This fixture intentionally omits measured_at so Phase 2 exercises
    // format-level constrained completion for a genuinely missing field.
    const text = `TOPCON\nREF. DATA\n<R> S C A\n-2.25 -1.00 163\n<L> S C A\n-2.50 -1.25 140`;
    const result = await dispatchEyeExamReportMetadata({
      rawText: text,
      context: baseContext,
      deps: { mock: false, invokeLLM },
    });

    expect(invokeLLM).toHaveBeenCalledTimes(1);
    const prompt = invokeLLM.mock.calls[0][0].prompt;
    expect(prompt).toContain("topcon_ref_data_v1");
    expect(prompt).toContain("representative_examples");
    expect(prompt).toContain("不生成疾病诊断");
    expect(result.template_id).toBe("topcon_ref_data_v1");
    expect(result.template_version).toBe("phase2.v1");
    expect(result.warnings).toContain("llm_completion_applied");
    expect(result).not.toHaveProperty("diagnosis");
  });

  it("does not invoke LLM for an already stable rule parse", async () => {
    const invokeLLM = vi.fn();
    const result = await dispatchEyeExamReportMetadata({
      rawText: "TOPCON CT-800\nTONO DATA\n2026/08/01 09:35\nOD AVG 19 mmHg\nOS AVG 17 mmHg",
      context: baseContext,
      deps: { mock: false, invokeLLM },
    });
    expect(result.parse_status).toBe("parsed");
    expect(result.template_id).toBe("topcon_tono_data_v1");
    expect(invokeLLM).not.toHaveBeenCalled();
  });
});

describe("eye exam parsing quality telemetry", () => {
  it("maps metadata statuses to the three quality categories", () => {
    expect(mapParseStatusToQualityStatus("parsed")).toBe("success");
    expect(mapParseStatusToQualityStatus("partial")).toBe("needs_clarification");
    expect(mapParseStatusToQualityStatus("fallback")).toBe("fallback");
  });

  it("builds privacy-minimized idempotent event data", () => {
    const event = buildParsingQualityEvent({
      clinic_id: "clinic-001",
      raw_artifact_id: "artifact-001",
      patient_id: "patient-secret",
      raw_text_excerpt: "NAME PATIENT SECRET",
      exam_type: "屈光验光",
      exam_item_name: "Ref Data",
      device_vendor: "TOPCON",
      device_model: "KR-800",
      parser_id: "topcon_refraction_parser",
      parser_version: "phase1.v1",
      template_id: "topcon_ref_data_v1",
      template_version: "phase2.v1",
      parse_status: "partial",
      parse_confidence: 0.66,
      warnings: ["refraction_values_not_fully_detected"],
    }, { recorded_at: "2026-08-01T00:00:00.000Z" });

    expect(event).toMatchObject({
      quality_status: "needs_clarification",
      exam_item_name: "Ref Data",
      device_vendor: "TOPCON",
      template_id: "topcon_ref_data_v1",
    });
    expect(event).not.toHaveProperty("patient_id");
    expect(event).not.toHaveProperty("raw_text_excerpt");
  });

  it("aggregates recent events and ranks weak report families", () => {
    const now = "2026-08-01T12:00:00.000Z";
    const events = [
      ...["2026-07-29", "2026-07-30", "2026-07-31"].map((date) => ({
        recorded_at: `${date}T10:00:00.000Z`,
        exam_type: "眼压检查",
        exam_item_name: "Tono Data",
        device_vendor: "TOPCON",
        device_model: "CT-800",
        parser_id: "topcon_tono_parser",
        template_id: "topcon_tono_data_v1",
        metadata_parse_status: "parsed",
        parse_confidence: 0.95,
      })),
      {
        recorded_at: "2026-08-01T09:00:00.000Z",
        exam_type: "屈光验光",
        exam_item_name: "Ref Data",
        device_vendor: "TOPCON",
        device_model: "KR-800",
        parser_id: "topcon_refraction_parser",
        template_id: "topcon_ref_data_v1",
        metadata_parse_status: "parsed",
        parse_confidence: 0.9,
      },
      ...["2026-07-30", "2026-07-31"].map((date) => ({
        recorded_at: `${date}T09:00:00.000Z`,
        exam_type: "屈光验光",
        exam_item_name: "Ref Data",
        device_vendor: "TOPCON",
        device_model: "KR-800",
        parser_id: "topcon_refraction_parser",
        template_id: "topcon_ref_data_v1",
        metadata_parse_status: "partial",
        parse_confidence: 0.6,
      })),
      {
        recorded_at: "2026-08-01T08:00:00.000Z",
        exam_type: "OCT",
        exam_item_name: "Unknown OCT",
        device_vendor: "NEWVENDOR",
        device_model: "X1",
        parser_id: "fallback_eye_exam_parser",
        template_id: "unmatched",
        metadata_parse_status: "fallback",
        parse_confidence: 0.4,
      },
      {
        recorded_at: "2026-06-01T08:00:00.000Z",
        exam_type: "OCT",
        exam_item_name: "Old Event",
        device_vendor: "OLD",
        metadata_parse_status: "fallback",
      },
    ];

    const overview = aggregateParsingQuality(events, { now, days: 7, limit: 10 });
    expect(overview.total_events).toBe(7);
    expect(overview.totals).toEqual({ success: 4, needs_clarification: 2, fallback: 1 });
    expect(overview.overall_success_rate).toBe(0.571);
    expect(overview.stable_coverage[0]).toMatchObject({
      device_vendor: "TOPCON",
      exam_item_name: "Tono Data",
      success_rate: 1,
      coverage_state: "stable",
    });
    expect(overview.optimization_candidates[0]).toMatchObject({
      device_vendor: "TOPCON",
      exam_item_name: "Ref Data",
      success_count: 1,
      needs_clarification_count: 2,
      fallback_count: 0,
      coverage_state: "optimize",
    });
    expect(overview.optimization_candidates.some((row) => row.device_vendor === "NEWVENDOR" && row.fallback_count === 1)).toBe(true);
  });

  it("wires idempotent event persistence and the manager overview action", () => {
    const source = readFileSync("base44/functions/eyeExamMetadataService/entry.ts", "utf8");
    expect(source).toContain('ACTION_GET_QUALITY_OVERVIEW = "getQualityOverview"');
    expect(source).toContain("EyeExamParserQualityEvent.filter");
    expect(source).toContain("EyeExamParserQualityEvent.update");
    expect(source).toContain("EyeExamParserQualityEvent.create");
    expect(source).toContain('new Set(["clinic_director", "qa_officer"])');
    expect(source).toContain("aggregateParsingQuality");
  });
});
