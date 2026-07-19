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

  it("uploads and invokes backend capturePhoto only", async () => {
    const calls = [];
    const base44 = {
      integrations: {
        Core: {
          UploadFile: vi.fn(async () => ({
            file_url: "https://files.test/capture.jpg",
          })),
        },
      },
      functions: {
        invoke: vi.fn(async (name, payload) => {
          calls.push({ name, payload });
          return {
            data: {
              ok: true,
              shadow_only: true,
              artifact: { id: "a1" },
              fact_card: { id: "f1", artifact_id: "a1" },
            },
          };
        }),
      },
      // Any direct entity access is a test failure: attribution belongs server-side.
      entities: new Proxy({}, {
        get() {
          throw new Error("client_entity_access_forbidden");
        },
      }),
    };

    const result = await captureAndInterpretPhoto({
      base44,
      clinicId: "clinic-test",
      file: image(),
      sourceRegion: "reception",
    });

    expect(result.shadowOnly).toBe(true);
    expect(result.interpreted).toBe(true);
    expect(calls).toEqual([{
      name: "compositionOrchestrator",
      payload: {
        action: "capturePhoto",
        clinic_id: "clinic-test",
        file_url: "https://files.test/capture.jpg",
        source_region: "reception",
      },
    }]);
    expect(JSON.stringify(calls)).not.toMatch(/"action":"(run|review|commit)"/);
  });

  it("surfaces backend tenant/staff refusal", async () => {
    const base44 = {
      integrations: {
        Core: {
          UploadFile: vi.fn(async () => ({
            file_url: "https://files.test/capture.jpg",
          })),
        },
      },
      functions: {
        invoke: vi.fn(async () => ({
          data: { ok: false, error_code: "staff_context_required" },
        })),
      },
    };
    await expect(captureAndInterpretPhoto({
      base44,
      clinicId: "clinic-test",
      file: image(),
      sourceRegion: "reception",
    })).rejects.toThrow("staff_context_required");
  });
});
