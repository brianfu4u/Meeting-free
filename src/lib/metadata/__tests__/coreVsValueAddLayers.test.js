import { describe, expect, it, vi } from "vitest";
import {
  createEyeExamMetadata,
  getEyeExamValueAddAccess,
  metadataToFactCardFields,
} from "../../../../base44/shared/eyeExamMetadata/model.ts";
import {
  createOpsEventMetadata,
  getOpsEventValueAddAccess,
  opsEventMetadataToFactCardFields,
} from "../../../../base44/shared/opsEventMetadata/model.ts";
import {
  coreRoutingFieldsForLlm,
  deterministicCandidates,
  getCoreRoutingContext,
  llmCandidateMatch,
} from "../../composition/candidateFinder.js";

const eyeBase = {
  clinic_id: "clinic-001",
  patient_id: "patient-001",
  raw_artifact_id: "artifact-001",
  exam_type: "屈光验光",
  exam_item_name: "自动验光 / Ref Data",
  measured_at: "2026-08-01T10:34:00Z",
  reported_at: "2026-08-01T10:35:00Z",
  department: "特检室",
  role: "OPTOMETRIST",
  parser_id: "topcon_refraction_parser",
  parser_version: "phase1.1.v1",
  parse_status: "parsed",
  parse_confidence: 0.96,
};

describe("metadata two-layer contract", () => {
  it("stores eye routing data and detailed measurements in separate groups", () => {
    const metadata = createEyeExamMetadata({
      ...eyeBase,
      device_vendor: "TOPCON",
      device_model: "KR-800",
      report_key_values: { pd_mm: 61.5, vd_mm: 12 },
      eye_side_results: {
        right: { key_values: { sphere_d: -2.25, cylinder_d: -1, axis_deg: 163 } },
        left: { key_values: { sphere_d: -2.5, cylinder_d: -1.25, axis_deg: 140 } },
      },
    });

    expect(metadata.routing_status).toBe("routing_ready");
    expect(metadata.routing_ready).toBe(true);
    expect(metadata.core_routing_fields).toMatchObject({
      metadata_domain: "eye_exam",
      exam_type: "屈光验光",
      exam_item_name: "自动验光 / Ref Data",
      clinic_id: "clinic-001",
      patient_id: "patient-001",
      department: "特检室",
      role: "OPTOMETRIST",
      occurred_at: "2026-08-01T10:34:00Z",
    });
    expect(metadata.core_routing_fields).not.toHaveProperty("sphere_d");
    expect(metadata.value_add_fields.device_context).toEqual({
      device_vendor: "TOPCON",
      device_model: "KR-800",
    });
    expect(metadata.value_add_fields.eye_side_results.right.key_values.sphere_d).toBe(-2.25);
    expect(metadata.value_add_status).toBe("value_add_complete");
  });

  it("keeps routing ready when detailed eye values are unavailable", () => {
    const metadata = createEyeExamMetadata({ ...eyeBase, parse_status: "partial" });
    expect(metadata.routing_status).toBe("routing_ready");
    expect(metadata.value_add_status).toBe("value_add_unavailable");
    expect(getEyeExamValueAddAccess(metadata)).toMatchObject({
      available: false,
      reason_code: "value_add_fields_unavailable",
      message: "此记录目前仅存储为基础记录，未解析详细数值。",
    });
  });

  it("projects only eye core routing fields to the FactCard bus", () => {
    const metadata = createEyeExamMetadata({
      ...eyeBase,
      device_vendor: "TOPCON",
      report_key_values: { pd_mm: 61.5 },
      eye_side_results: {
        right: { key_values: { sphere_d: -2.25, axis_deg: 163 } },
        left: { key_values: { sphere_d: -2.5, axis_deg: 140 } },
      },
    });
    const fields = metadataToFactCardFields(metadata, "artifact-001");
    expect(fields.some((field) => field.field_name === "routing.exam_type")).toBe(true);
    expect(fields.some((field) => field.field_name === "routing.basic_summary")).toBe(true);
    expect(fields.some((field) => /sphere|axis|pd_mm|device_vendor/.test(field.field_name))).toBe(false);
  });

  it("creates routing-ready operational metadata while keeping complaint metrics value-add only", () => {
    const metadata = createOpsEventMetadata({
      clinic_id: "clinic-001",
      source_event_id: "event-001",
      event_type: "complaint",
      event_title: "患者等待时间投诉",
      department: "前台",
      role: "RECEPTION",
      occurred_at: "2026-08-01T11:00:00Z",
      reported_at: "2026-08-01T11:03:00Z",
      basic_summary: "患者反映候诊等待时间过长",
      priority_hint: "P2",
      sla_target_minutes: 30,
      complaint_severity_score: 4,
      involved_process_nodes: ["挂号", "候诊"],
    });

    expect(metadata.routing_status).toBe("routing_ready");
    expect(metadata.core_routing_fields.event_type).toBe("complaint");
    expect(metadata.core_routing_fields).not.toHaveProperty("complaint_severity_score");
    expect(metadata.value_add_fields).toMatchObject({
      complaint_severity_score: 4,
      involved_process_nodes: ["挂号", "候诊"],
    });
    expect(metadata.value_add_status).toBe("value_add_complete");
    const fields = opsEventMetadataToFactCardFields(metadata, "artifact-ops-001");
    expect(fields.some((field) => field.field_name === "routing.event_type" && field.value === "complaint")).toBe(true);
    expect(fields.some((field) => field.field_name.includes("severity"))).toBe(false);
  });

  it("supports product-layer gating for value-add consumers", () => {
    const metadata = createOpsEventMetadata({
      clinic_id: "clinic-001",
      source_event_id: "event-training",
      event_type: "training",
      event_title: "新员工服务培训",
      occurred_at: "2026-08-01T09:00:00Z",
      basic_summary: "前台新员工服务流程培训",
      training_duration_minutes: 90,
      participant_count: 8,
    });
    expect(getOpsEventValueAddAccess(metadata, false)).toMatchObject({
      available: false,
      reason_code: "value_add_feature_not_enabled",
    });
    expect(getOpsEventValueAddAccess(metadata, true)).toMatchObject({
      available: true,
      value_add_fields: { training_duration_minutes: 90, participant_count: 8 },
    });
  });
});

describe("composition reads core routing only", () => {
  const factCard = {
    id: "fact-001",
    clinic_id: "clinic-001",
    artifact_id: "artifact-001",
    occurred_at: "2026-08-01T11:00:00Z",
    fields: [
      { field_name: "routing.metadata_domain", value: "ops_event" },
      { field_name: "routing.event_type", value: "equipment_failure" },
      { field_name: "routing.event_title", value: "OCT设备故障" },
      { field_name: "routing.clinic_id", value: "clinic-001" },
      { field_name: "routing.department", value: "特检室" },
      { field_name: "routing.role", value: "EQUIPMENT_ADMIN" },
      { field_name: "routing.occurred_at", value: "2026-08-01T11:00:00Z" },
      { field_name: "routing.basic_summary", value: "OCT设备无法启动" },
      { field_name: "routing.item_tag", value: "equipment_failure" },
      { field_name: "routing.priority_hint", value: "P1" },
      { field_name: "routing.sla_target_minutes", value: "15" },
      { field_name: "ops_event.downtime_minutes", value: "240" },
      { field_name: "eye_exam.right.sphere_d", value: "-9.99" },
      { field_name: "eye_exam.device_model", value: "SECRET-MODEL" },
    ],
  };

  it("extracts assignment, priority and SLA hints from core fields", () => {
    expect(getCoreRoutingContext(factCard)).toMatchObject({
      event_type: "equipment_failure",
      department: "特检室",
      role: "EQUIPMENT_ADMIN",
      priority_hint: "P1",
      sla_target_minutes: "15",
    });
    const candidates = deterministicCandidates({
      factCard,
      clinicId: "clinic-001",
      workflows: [
        {
          id: "wf-generic",
          clinic_id: "clinic-001",
          temporal_anchors: ["2026-08-01T11:00:00Z"],
        },
        {
          id: "wf-equipment",
          clinic_id: "clinic-001",
          expected_event_type: "equipment_failure",
          department: "特检室",
          assignee_role: "EQUIPMENT_ADMIN",
          temporal_anchors: ["2026-08-01T11:05:00Z"],
        },
      ],
    });
    expect(candidates[0].workflow_id).toBe("wf-equipment");
    expect(candidates[0].routing_hints).toEqual({
      assignment_role_hint: "EQUIPMENT_ADMIN",
      department_hint: "特检室",
      priority_hint: "P1",
      sla_target_minutes: 15,
    });
  });

  it("filters detailed values out of the LLM prompt", async () => {
    expect(coreRoutingFieldsForLlm(factCard).every((field) => field.field_name.startsWith("routing."))).toBe(true);
    const invokeLLM = vi.fn(async () => ({
      best_workflow_id: "wf-equipment",
      confidence: 0.9,
      reason_codes: ["core_event_type_match"],
    }));
    await llmCandidateMatch({
      factCard,
      candidateWorkflows: [{ id: "wf-equipment", expected_event_type: "equipment_failure" }],
      invokeLLM,
    });
    const prompt = invokeLLM.mock.calls[0][0].prompt;
    expect(prompt).toContain("equipment_failure");
    expect(prompt).not.toContain("240");
    expect(prompt).not.toContain("-9.99");
    expect(prompt).not.toContain("SECRET-MODEL");
    expect(prompt).toContain("禁止使用左右眼数值、设备参数、投诉评分、培训指标、故障统计");
  });
});
