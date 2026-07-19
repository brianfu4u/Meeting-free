import { describe, expect, it, vi } from "vitest";
import {
  captureAndInterpretPhoto,
  localBusinessDate,
  validateCaptureFile,
} from "../photoCapture";

function image(overrides = {}) {
  return { type: "image/jpeg", size: 1024, name: "capture.jpg", ...overrides };
}

describe("Phase 5 photo capture shadow boundary", () => {
  it("validates image type and size", () => {
    expect(validateCaptureFile(image())).toBe(true);
    expect(() => validateCaptureFile(image({ type: "text/plain" }))).toThrow("image_file_required");
    expect(() => validateCaptureFile(image({ size: 16 * 1024 * 1024 }))).toThrow("image_too_large");
  });

  it("uses local calendar date", () => {
    expect(localBusinessDate(new Date(2026, 6, 20, 1, 2, 3))).toBe("2026-07-20");
  });

  it("uploads, creates one Artifact and invokes interpret only", async () => {
    const calls = [];
    const base44 = {
      auth: { me: vi.fn(async () => ({ id: "u1" })) },
      integrations: { Core: { UploadFile: vi.fn(async () => ({ file_url: "https://files.test/capture.jpg" })) } },
      entities: {
        Staff: { filter: vi.fn(async () => [{ id: "staff1" }]) },
        Artifact: { create: vi.fn(async (value) => ({ id: "a1", ...value })) },
      },
      functions: {
        invoke: vi.fn(async (name, payload) => {
          calls.push({ name, payload });
          return { data: { ok: true, fact_card: { id: "f1", artifact_id: "a1" } } };
        }),
      },
    };

    const result = await captureAndInterpretPhoto({
      base44,
      clinicId: "clinic-test",
      file: image(),
      sourceRegion: "reception",
      now: new Date("2026-07-20T01:02:03.000Z"),
    });

    expect(result.shadowOnly).toBe(true);
    expect(result.interpreted).toBe(true);
    expect(base44.entities.Artifact.create).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([{
      name: "compositionOrchestrator",
      payload: { action: "interpret", clinic_id: "clinic-test", artifact_id: "a1" },
    }]);
    expect(JSON.stringify(calls)).not.toMatch(/"action":"(run|review|commit)"/);
  });

  it("refuses capture without a tenant Staff binding", async () => {
    const base44 = {
      auth: { me: vi.fn(async () => ({ id: "u1" })) },
      entities: { Staff: { filter: vi.fn(async () => []) } },
    };
    await expect(captureAndInterpretPhoto({
      base44,
      clinicId: "clinic-test",
      file: image(),
      sourceRegion: "reception",
    })).rejects.toThrow("staff_context_required");
  });
});
