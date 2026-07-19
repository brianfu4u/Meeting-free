/**
 * Phase 5 server-side photo Artifact boundary.
 *
 * The caller supplies only an uploaded file URL and source region. Tenant,
 * staff attribution, timestamps, and ingestion sequence come from the
 * authenticated backend context.
 */

export const PHOTO_SOURCE_REGIONS = [
  "reception",
  "optometry",
  "medical",
  "treatment",
  "procurement",
  "other",
] as const;

function fail(code: string): never {
  throw Object.assign(new Error(code), { code });
}

function required(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim()) fail(code);
  return value.trim();
}

export function buildPhotoArtifactDescriptor({
  clinicId,
  staffId,
  fileUrl,
  sourceRegion,
  now = new Date(),
}: {
  clinicId: unknown;
  staffId: unknown;
  fileUrl: unknown;
  sourceRegion: unknown;
  now?: Date;
}) {
  const clinic = required(clinicId, "clinic_id_required");
  const staff = required(staffId, "staff_context_required");
  const url = required(fileUrl, "file_url_required");
  const region = required(sourceRegion, "source_region_required");

  if (url.length > 4096) fail("file_url_invalid");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    fail("file_url_invalid");
  }
  if (parsed.protocol !== "https:") fail("file_url_invalid");
  if (!PHOTO_SOURCE_REGIONS.includes(region as any)) fail("source_region_invalid");
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) fail("captured_at_invalid");

  const localYear = now.getFullYear();
  const localMonth = String(now.getMonth() + 1).padStart(2, "0");
  const localDay = String(now.getDate()).padStart(2, "0");

  return {
    clinic_id: clinic,
    artifact_type: "image",
    file_url: url,
    source_staff_id: staff,
    source_region: region,
    business_date: `${localYear}-${localMonth}-${localDay}`,
    captured_at: now.toISOString(),
    ingestion_seq: now.getTime(),
    interpreted: false,
  };
}
