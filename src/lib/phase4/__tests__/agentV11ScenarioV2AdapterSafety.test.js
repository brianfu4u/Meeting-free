import {describe,it,expect} from "vitest";
import fs from "node:fs";
const build=fs.readFileSync("scripts/agent-v11-scenario-v2-adapter-build.mjs","utf8");
const runner=fs.readFileSync("scripts/agent-v11-scenario-v2-adapter.template.mjs","utf8");
describe("scenario v2 fixture adapter safety",()=>{
  it("executes exactly supported fixtures and separates non-production evidence",()=>{
    expect(build).toContain('level === "supported"'); expect(build).toContain('level === "approximate"'); expect(build).toContain('level === "unsupported"');
    expect(build).toContain("supported.length !== 11"); expect(runner).toContain("approximate_report"); expect(runner).toContain("unsupported_skipped"); expect(runner).toContain("excluded_from_eligible_rate:true");
  });
  it("constructs real workflow, snapshot, artifact, fact-card and undo conditions",()=>{
    for(const name of ["Workflow","WorkflowSnapshot","Artifact","EvidenceFactCard","UndoListItem"]) expect(runner).toContain(`create(\"${name}\"`);
    expect(runner).toContain("scenario.fixture.workflows"); expect(runner).toContain("scenario.fixture.fragments");
    expect(runner).toContain("spec.device_serial"); expect(runner).toContain("frag.device_serial");
    expect(runner).toContain("source_role:clean(frag.source_role)"); expect(runner).toContain("is_proxy:frag.is_proxy===true");
  });
  it("keeps oracle out of fixture construction and gates",()=>{
    const beforeRun=runner.slice(0,runner.indexOf('const first=unwrap'));
    expect(beforeRun).not.toContain("scenario.oracle"); expect(runner).toContain("oracle_match");
  });
  it("enforces observe-only, zero authority, replay and cleanup",()=>{
    expect(runner).toContain('auto_attach_mode===\"observe\"'); expect(runner).not.toMatch(/secrets\.(set|delete)|auto_attach_mode\s*:\s*["']commit/);
    expect(runner).toContain("link_write"); expect(runner).toContain("snapshot_write"); expect(runner).toContain("undo_write"); expect(runner).toContain("replay_growth_"); expect(runner).toContain("cleanup_all_zero"); expect(runner).toContain('clinic !== \"clinic-001\"');
  });
});
