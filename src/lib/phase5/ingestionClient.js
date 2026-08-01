// Phase 5 前端碎片采集客户端 —— 唯一允许的入站桥接封装。
// 仅调用 UploadFile + 后端函数，禁止前端直接操作 Artifact/EvidenceFactCard/FragmentProcessingResult。
import { base44 } from "@/api/base44Client";

export const STATUS_LABELS = {
  pending: "待处理",
  processing: "解析中",
  aligned: "已对齐",
  parsed: "元数据已解析",
  partial: "元数据部分解析",
  fallback: "格式待适配",
  needs_clarification: "需补充",
  failed: "失败",
  rejected: "已拒绝",
};

export const STATUS_COLORS = {
  pending: "#94A3B8",
  processing: "#60a5fa",
  aligned: "#4ade80",
  parsed: "#4ade80",
  partial: "#fbbf24",
  fallback: "#fbbf24",
  needs_clarification: "#fbbf24",
  failed: "#f87171",
  rejected: "#f87171",
};

export const ERROR_LABELS = {
  idempotency_conflict: "幂等冲突：相同请求键但碎片类型/校验和不同",
  mime_for_supported: "MIME 类型不支持",
  mime_forbidden: "MIME 类型被禁用",
  url_not_whitelisted: "上传 URL 不在白名单",
  tenant_scope_violation: "租户越权",
  unauthenticated: "未登录",
  artifact_not_found: "凭证不存在",
  fragment_not_retryable: "当前状态不可重试",
  retry_limit_reached: "重试次数已达上限",
  upload_failed: "文件上传失败",
};

// 计算 SHA-256 校验和（仅作幂等辅助，非安全边界）
export async function computeChecksum(file) {
  try {
    const buf = await file.arrayBuffer();
    const hash = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

// UploadFile → 真实文件 URL
export async function uploadFile(file) {
  const res = await base44.integrations.Core.UploadFile({ file });
  return res?.file_url || res?.data?.file_url || null;
}

function unwrap(res) {
  return res?.data ?? res;
}

function metadataPreviewFields(metadata) {
  if (!metadata) return [];
  const fields = [];
  const push = (fieldName, value) => {
    if (value == null || value === "") return;
    fields.push({
      field_name: fieldName,
      value: typeof value === "string" ? value : JSON.stringify(value),
      source_quote: metadata.raw_text_excerpt || "",
      extraction_quality: metadata.parse_status === "parsed" ? "high" : "uncertain",
    });
  };
  push("报告类型", metadata.exam_type);
  push("检查项目", metadata.exam_item_name);
  push("设备厂商", metadata.device_vendor);
  push("检查时间", metadata.measured_at);
  for (const [key, value] of Object.entries(metadata.report_key_values || {})) push(key, value);
  for (const side of ["right", "left"]) {
    for (const [key, value] of Object.entries(metadata.eye_side_results?.[side]?.key_values || {})) {
      if (["axis_original_ocr_deg", "axis_correction_applied"].includes(key)) continue;
      push(`${side}.${key}`, value);
    }
  }
  return fields;
}

export function buildEyeExamMetadataPreview(metadata, genericPreview = null) {
  if (!metadata) return genericPreview;
  return {
    extracted_text: genericPreview?.extracted_text || metadata.raw_text_excerpt || "",
    fields: metadataPreviewFields(metadata),
    alignment_status: metadata.parse_status,
    quality_issues: metadata.warnings || [],
    evidence_alignment_status: genericPreview?.alignment_status || null,
  };
}

export async function captureFragment(payload) {
  const res = unwrap(await base44.functions.invoke("fragmentIngestionService", payload));
  if (res && res.ok === false) {
    const code = res.error_code || "ingestion_failed";
    const err = new Error(ERROR_LABELS[code] || code);
    err.error_code = code;
    err.response = { data: res };
    throw err;
  }

  // Direct ingestion may produce useful OCR even when the generic workflow
  // quality gate asks for clarification. Eye-exam metadata has a separate,
  // non-diagnostic completeness status and is shown preferentially in preview.
  if (payload?.clinic_id && res?.artifact?.id) {
    try {
      const metadataResult = await persistEyeExamMetadata({
        clinic_id: payload.clinic_id,
        artifact_id: res.artifact.id,
        evidence_fact_card_id: res?.alignment?.fact_card_ids?.[0] || null,
      });
      const metadata = metadataResult?.metadata || null;
      return {
        ...res,
        eye_exam_metadata: metadata,
        parse_preview: buildEyeExamMetadataPreview(metadata, res?.parse_preview || null),
      };
    } catch {
      // Never turn a successful evidence upload into a failed upload because
      // optional eye-exam metadata derivation was unavailable.
    }
  }
  return res;
}

export async function persistEyeExamMetadata(payload) {
  const res = unwrap(await base44.functions.invoke("eyeExamMetadataService", {
    ...payload,
    action: "parseAndPersist",
  }));
  if (res && res.ok === false) {
    const code = res.error_code || "eye_exam_metadata_failed";
    const err = new Error(ERROR_LABELS[code] || code);
    err.error_code = code;
    err.response = { data: res };
    throw err;
  }
  return res;
}

export async function persistEyeExamMetadataForBridgeResults({ clinicId, bridgeResults }) {
  if (!clinicId || !Array.isArray(bridgeResults)) return [];
  const eligible = bridgeResults.filter((item) => item?.artifact_id);
  return Promise.allSettled(eligible.map((item) => persistEyeExamMetadata({
    clinic_id: clinicId,
    artifact_id: item.artifact_id,
    origin_evidence_item_id: item.origin_evidence_item_id || null,
    evidence_fact_card_id: item.evidence_fact_card_id || null,
  })));
}

export async function getFragmentStatus(payload) {
  return unwrap(
    await base44.functions.invoke("fragmentIngestionService", {
      ...payload,
      action: "getFragmentStatus",
    })
  );
}

export async function retryFragment(payload) {
  return unwrap(
    await base44.functions.invoke("fragmentIngestionService", {
      ...payload,
      action: "retryFragment",
    })
  );
}

export function newClientRequestId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `crid-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
