/**
 * Phase 5 photo-capture client boundary.
 *
 * The browser uploads image bytes, then asks the authenticated backend to
 * create and interpret the tenant/staff-scoped Artifact. It never creates
 * entities directly and never invokes run, review, or commit.
 */

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export function localBusinessDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function validateCaptureFile(file) {
  if (!file) throw new Error("photo_required");
  if (!String(file.type || "").startsWith("image/")) throw new Error("image_file_required");
  if (Number(file.size || 0) <= 0) throw new Error("empty_image");
  if (Number(file.size) > MAX_IMAGE_BYTES) throw new Error("image_too_large");
  return true;
}

function unwrap(value) {
  return value?.data ?? value;
}

export async function captureAndInterpretPhoto({
  base44,
  clinicId,
  file,
  sourceRegion,
}) {
  if (!base44) throw new Error("base44_client_required");
  if (!clinicId) throw new Error("clinic_id_required");
  if (!sourceRegion) throw new Error("source_region_required");
  validateCaptureFile(file);

  const upload = unwrap(await base44.integrations.Core.UploadFile({ file }));
  const fileUrl = upload?.file_url;
  if (!fileUrl) throw new Error("upload_file_url_missing");

  const captured = unwrap(await base44.functions.invoke("compositionOrchestrator", {
    action: "capturePhoto",
    clinic_id: clinicId,
    file_url: fileUrl,
    source_region: sourceRegion,
  }));

  if (captured?.ok !== true) {
    throw Object.assign(
      new Error(captured?.error_code || "photo_interpret_failed"),
      { artifact: captured?.artifact || null }
    );
  }

  return {
    artifact: captured.artifact,
    factCard: captured.fact_card || captured.factCard || null,
    interpreted: Boolean(captured.fact_card || captured.factCard),
    shadowOnly: captured.shadow_only === true,
  };
}
