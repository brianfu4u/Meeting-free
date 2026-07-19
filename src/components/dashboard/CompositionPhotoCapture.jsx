import React from "react";
import { AlertTriangle, Camera, CheckCircle2, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useClinicId } from "@/lib/ClinicContext";
import { captureAndInterpretPhoto } from "@/lib/phase5/photoCapture";

const C = {
  card: "#1E293B", border: "#334155", text: "#F1F5F9", sub: "#94A3B8",
  cyan: "#00C7D9", green: "#4ade80", red: "#f87171", amber: "#fbbf24",
};

const REGIONS = [
  ["reception", "前台接待"],
  ["optometry", "检查区"],
  ["medical", "医生问诊"],
  ["treatment", "治疗区"],
  ["procurement", "采购/库存"],
  ["other", "其他"],
];

function messageFor(error) {
  const code = error?.message || "photo_capture_failed";
  const map = {
    photo_required: "请先拍照或选择图片。",
    image_file_required: "只支持图片文件。",
    empty_image: "图片内容为空。",
    image_too_large: "图片超过 15MB，请降低照片分辨率后重试。",
    staff_context_required: "当前账号尚未绑定本诊所员工，无法记录证据来源。",
    upload_file_url_missing: "图片上传失败，未取得文件地址。",
    unauthenticated: "请重新登录后再试。",
  };
  return map[code] || `上传或解释失败：${code}`;
}

export default function CompositionPhotoCapture() {
  const clinicId = useClinicId();
  const inputRef = React.useRef(null);
  const [region, setRegion] = React.useState("reception");
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState(null);

  const onFile = async (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    if (!file || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await captureAndInterpretPhoto({
        base44,
        clinicId,
        file,
        sourceRegion: region,
      });
      setNotice({
        type: "success",
        text: result.interpreted
          ? `照片已解释为证据碎片（Artifact ${result.artifact.id}），等待下一轮影子编组。`
          : `照片已保存（Artifact ${result.artifact.id}），等待解释。`,
      });
    } catch (error) {
      setNotice({
        type: "error",
        text: error?.artifact?.id
          ? `照片已安全保存为 Artifact ${error.artifact.id}，但解释失败：${messageFor(error)}`
          : messageFor(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs font-bold" style={{ color: C.text }}>
            <Camera size={15} style={{ color: C.cyan }} />
            Phase 5 · 拍照证据入口
          </div>
          <div className="mt-1 text-[11px]" style={{ color: C.sub }}>
            拍照后只生成证据碎片并进行 AI 解释；不会自动编组提交或修改工作流。
          </div>
        </div>

        <select
          aria-label="照片来源区域"
          value={region}
          disabled={busy}
          onChange={(event) => setRegion(event.target.value)}
          className="rounded-lg px-2 py-2 text-xs"
          style={{ color: C.text, background: "#0f1d2e", border: `1px solid ${C.border}` }}
        >
          {REGIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>

        <input
          ref={inputRef}
          className="hidden"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onFile}
        />
        <button
          type="button"
          disabled={busy || !clinicId}
          onClick={() => inputRef.current?.click()}
          className="rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-40"
          style={{ color: C.cyan, background: "#00c7d912", border: "1px solid #00c7d955" }}
        >
          {busy ? <><Loader2 size={13} className="mr-1 inline animate-spin" />处理中…</> :
            <><Camera size={13} className="mr-1 inline" />拍照上传</>}
        </button>
      </div>

      {notice && (
        <div className="mt-3 flex items-start gap-2 rounded-lg p-2 text-[11px]"
          style={{
            color: notice.type === "success" ? C.green : C.red,
            border: `1px solid ${notice.type === "success" ? "#16a34a55" : "#dc262655"}`,
          }}>
          {notice.type === "success" ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
          <span>{notice.text}</span>
        </div>
      )}

      <div className="mt-2 text-[10px]" style={{ color: C.amber }}>
        首轮实操请使用不含患者姓名、电话、身份证号或面部信息的测试照片。
      </div>
    </section>
  );
}
