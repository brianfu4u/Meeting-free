import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { asList } from "@/hooks/useClinicData";

const LABELS = {
  average_iop_mmhg: "平均眼压",
  measurements_mmhg: "测量值",
  sphere_d: "球镜 S",
  cylinder_d: "柱镜 C",
  axis_deg: "轴位 A",
  spherical_equivalent_d: "等效球镜 SE",
  pd_mm: "瞳距 PD",
  vd_mm: "顶点距 VD",
  k1_d: "K1",
  k2_d: "K2",
  central_subfield_thickness_um: "中心区厚度",
  average_thickness_um: "平均厚度",
  rnfl_average_um: "RNFL 平均厚度",
  signal_strength: "信号强度",
  cell_density_cells_mm2: "细胞密度",
  average_cell_area_um2: "平均细胞面积",
  cct_um: "角膜厚度 CCT",
  cv: "变异系数 CV",
  hex_percent: "六边形细胞 HEX",
  axial_length_mm: "眼轴长度 AL",
  anterior_chamber_depth_mm: "前房深度 ACD",
  lens_thickness_mm: "晶状体厚度 LT",
  vitreous_length_mm: "玻璃体腔长度",
};

const DISPLAY_ORDER = ["sphere_d", "cylinder_d", "axis_deg", "spherical_equivalent_d"];
const AUDIT_ONLY_KEYS = new Set(["axis_original_ocr_deg", "axis_correction_applied"]);

function unitFor(key) {
  if (key.endsWith("_mmhg")) return " mmHg";
  if (key.endsWith("_um") || key.endsWith("_um2")) return key.endsWith("_um2") ? " μm²" : " μm";
  if (key.endsWith("_mm")) return " mm";
  if (key.endsWith("_d")) return " D";
  if (key.endsWith("_deg")) return "°";
  if (key.endsWith("_percent")) return "%";
  return "";
}

function valueText(key, value) {
  if (value == null || value === "") return "—";
  return `${value}${typeof value === "number" ? unitFor(key) : ""}`;
}

function orderedEntries(values = {}) {
  return Object.entries(values)
    .filter(([key]) => !AUDIT_ONLY_KEYS.has(key))
    .sort(([left], [right]) => {
      const leftIndex = DISPLAY_ORDER.indexOf(left);
      const rightIndex = DISPLAY_ORDER.indexOf(right);
      if (leftIndex >= 0 || rightIndex >= 0) {
        return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex);
      }
      return left.localeCompare(right);
    });
}

function KeyValueRow({ values }) {
  const entries = orderedEntries(values);
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {entries.map(([key, value]) => (
        <div key={key} className="text-[10px]" style={{ color: "#94A3B8" }}>
          <span>{LABELS[key] || key}：</span>
          <span style={{ color: "#F1F5F9" }}>{valueText(key, value)}</span>
        </div>
      ))}
    </div>
  );
}

function EyeSide({ label, result }) {
  const entries = orderedEntries(result?.key_values || {});
  if (entries.length === 0 && !result?.raw_text) return null;
  return (
    <div className="rounded-lg px-2.5 py-2" style={{ background: "rgba(15,23,42,0.45)", border: "1px solid #334155" }}>
      <div className="text-[10px] font-bold mb-1" style={{ color: "#CBD5E1" }}>{label}</div>
      {entries.length > 0 ? (
        <KeyValueRow values={result?.key_values || {}} />
      ) : (
        <div className="text-[10px]" style={{ color: "#64748B" }}>已识别眼别，暂无稳定关键数值</div>
      )}
    </div>
  );
}

async function loadMetadata(clinicId, artifactIds) {
  const rows = [];
  for (const artifactId of artifactIds) {
    const result = await base44.entities.EyeExamReportMetadata.filter({
      clinic_id: clinicId,
      raw_artifact_id: artifactId,
    }, "-created_at", 1);
    rows.push(...asList(result));
  }
  const unique = new Map();
  rows.forEach((row) => unique.set(row.id || row.raw_artifact_id, row));
  return [...unique.values()];
}

export default function EyeExamMetadataPanel({ artifactIds = [], clinicId }) {
  const ids = [...new Set((artifactIds || []).filter(Boolean))];
  const { data, isLoading } = useQuery({
    queryKey: ["eyeExamReportMetadata", clinicId, ids.join(",")],
    queryFn: () => loadMetadata(clinicId, ids),
    enabled: Boolean(clinicId && ids.length > 0),
    refetchInterval: 15000,
  });
  const records = asList(data);

  if (!clinicId || ids.length === 0 || (!isLoading && records.length === 0)) return null;

  return (
    <div className="px-3 pb-2.5">
      <div className="rounded-xl p-3" style={{ background: "rgba(14,116,144,0.08)", border: "1px solid rgba(34,211,238,0.22)" }}>
        <div className="flex items-center gap-1.5 mb-2">
          <Activity size={12} style={{ color: "#22D3EE" }} />
          <span className="text-[10.5px] font-bold" style={{ color: "#22D3EE" }}>检查报告元数据</span>
          <span className="text-[9px] ml-auto" style={{ color: "#64748B" }}>检查数据记录</span>
        </div>

        {isLoading ? (
          <div className="text-[10px]" style={{ color: "#64748B" }}>读取检查报告元数据…</div>
        ) : (
          <div className="space-y-2.5">
            {records.map((record) => {
              const axisRecovered = (record.warnings || []).some((warning) => String(warning).includes("axis_trailing_zero_ocr_recovered"));
              return (
                <div key={record.id || record.raw_artifact_id}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1.5">
                    <span className="text-[11px] font-semibold" style={{ color: "#F1F5F9" }}>{record.exam_type}</span>
                    {record.exam_item_name && <span className="text-[10px]" style={{ color: "#CBD5E1" }}>· {record.exam_item_name}</span>}
                    {record.parse_status === "fallback" && (
                      <span className="inline-flex items-center gap-1 text-[9px]" style={{ color: "#FBBF24" }}>
                        <AlertTriangle size={9} /> 格式未完全适配
                      </span>
                    )}
                  </div>
                  <div className="text-[9.5px] mb-2" style={{ color: "#64748B" }}>
                    {[record.device_vendor, record.device_model].filter(Boolean).join(" ") || "设备未识别"}
                    {record.measured_at ? ` · ${String(record.measured_at).replace("T", " ")}` : ""}
                  </div>
                  {Object.keys(record.report_key_values || {}).length > 0 && (
                    <div className="rounded-lg px-2.5 py-2 mb-2" style={{ background: "rgba(15,23,42,0.35)", border: "1px solid rgba(51,65,85,0.75)" }}>
                      <KeyValueRow values={record.report_key_values} />
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <EyeSide label="右眼 OD/R" result={record.eye_side_results?.right} />
                    <EyeSide label="左眼 OS/L" result={record.eye_side_results?.left} />
                  </div>
                  {axisRecovered && (
                    <div className="text-[9px] mt-1.5" style={{ color: "#94A3B8" }}>
                      轴位包含受限 OCR 尾零校正；原始数值与逐行测量已保留供审计。
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="text-[9px] mt-2 pt-2" style={{ color: "#64748B", borderTop: "1px solid rgba(51,65,85,0.65)" }}>
          仅为检查数据记录，不构成医学诊断或治疗建议。
        </div>
      </div>
    </div>
  );
}
