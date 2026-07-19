import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const panel = fs.readFileSync(
  path.join(root, "src/components/dashboard/CompositionSchedulerHealth.jsx"),
  "utf8"
);
const reviewPanel = fs.readFileSync(
  path.join(root, "src/components/dashboard/CompositionReviewPanel.jsx"),
  "utf8"
);

describe("Phase 4 manager health panel contract", () => {
  it("uses tenant context and reads only ClinicConfig", () => {
    expect(panel).toContain("useClinicId()");
    expect(panel).toContain("base44.entities.ClinicConfig.filter");
    expect(panel).not.toContain(".create(");
    expect(panel).not.toContain(".update(");
    expect(panel).not.toContain(".delete(");
  });

  it("shows safe health guidance without review or commit actions", () => {
    expect(panel).toContain("deriveSchedulerHealth");
    expect(panel).toContain("安全错误码");
    expect(panel).toContain("只读监控");
    expect(panel).not.toContain('action: "review"');
    expect(panel).not.toContain('action: "commit"');
  });

  it("is mounted inside the existing manager review surface", () => {
    expect(reviewPanel).toContain('import CompositionSchedulerHealth from "./CompositionSchedulerHealth"');
    expect(reviewPanel).toContain("<CompositionSchedulerHealth />");
  });
});
