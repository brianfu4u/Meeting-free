import { describe, expect, it } from "vitest";
import {
  buildPhotoArtifactDescriptor,
  PHOTO_SOURCE_REGIONS,
} from "../../../../base44/functions/compositionOrchestrator/photoCapture.ts";

describe("Phase 5 server-side photo Artifact boundary", () => {
  it("derives tenant, staff, timestamp, date and sequence server-side", () => {
    const now = new Date(2026, 6, 20, 10, 11, 12, 345);
    expect(buildPhotoArtifactDescriptor({
      clinicId: "clinic-test",
      staffId: "staff-1",
      fileUrl: "https://files.test/photo.jpg",
      sourceRegion: "reception",
      now,
    })).toEqual({
      clinic_id: "clinic-test",
      artifact_type: "image",
      file_url: "https://files.test/photo.jpg",
      source_staff_id: "staff-1",
      source_region: "reception",
      business_date: "2026-07-20",
      captured_at: now.toISOString(),
      ingestion_seq: now.getTime(),
      interpreted: false,
    });
  });

  it("rejects missing authenticated staff attribution", () => {
    expect(() => buildPhotoArtifactDescriptor({
      clinicId: "clinic-test",
      staffId: null,
      fileUrl: "https://files.test/photo.jpg",
      sourceRegion: "reception",
    })).toThrow("staff_context_required");
  });

  it("rejects non-HTTPS URLs and unknown regions", () => {
    expect(() => buildPhotoArtifactDescriptor({
      clinicId: "clinic-test",
      staffId: "staff-1",
      fileUrl: "http://files.test/photo.jpg",
      sourceRegion: "reception",
    })).toThrow("file_url_invalid");
    expect(() => buildPhotoArtifactDescriptor({
      clinicId: "clinic-test",
      staffId: "staff-1",
      fileUrl: "https://files.test/photo.jpg",
      sourceRegion: "made-up",
    })).toThrow("source_region_invalid");
    expect(PHOTO_SOURCE_REGIONS).toHaveLength(6);
  });
});
