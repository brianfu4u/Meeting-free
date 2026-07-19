/**
 * Phase 5 photo-capture boundary.
 *
 * This flow uploads one image, persists one tenant-scoped Artifact, then asks
 * compositionOrchestrator to interpret it. It never runs assembly, reviews a
 * hypothesis, commits a proposal, or mutates Workflow authority entities.
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
  now = new Date(),
}) {
  if (!base44) throw new Error("base44_client_required");
  if (!clinicId) throw new Error("clinic_id_required");
  if (!sourceRegion) throw new Error("source_region_required");
  validateCaptureFile(file);

  const user = await base44.auth.me();
  if (!user?.id) throw new Error("unauthenticated");

  const staffRows = await base44.entities.Staff.filter({
    clinic_id: clinicId,
    user_id: user.id,
  });
  const staff = staffRows?.[0] || null;
  if (!staff?.id) throw new Error("staff_context_required");

  const upload = unwrap(await base44.integrations.Core.UploadFile({ file }));
  const fileUrl = upload?.file_url;
  if (!fileUrl) throw new Error("upload_file_url_missing");

  const capturedAt = now.toISOString();
  const artifact = await base44.entities.Artifact.create({
    clinic_id: clinicId,
    artifact_type: "image",
    file_url: fileUrl,
    source_staff_id: String(staff.id),
    source_region: sourceRegion,
    business_date: localBusinessDate(now),
    captured_at: capturedAt,
    ingestion_seq: now.getTime(),
    interpreted: false,
  });

  try {
    const interpreted = unwrap(await base44.functions.invoke("compositionOrchestrator", {
      action: "interpret",
      clinic_id: clinicId,
      artifact_id: String(artifact.id),
    }));
    return {
      artifact,
      factCard: interpreted?.fact_card || interpreted?.factCard || null,
      interpreted: interpreted?.ok === true,
      shadowOnly: true,
    };
  } catch (error) {
    // Keep the uploaded Artifact as an auditable pending fragment. A later
    // scheduler/manual retry may interpret it; never delete evidence silently.
    throw Object.assign(new Error(
      error?.response?.data?.error_code || error?.message || "photo_interpret_failed"
    ), { artifact });
  }
}
