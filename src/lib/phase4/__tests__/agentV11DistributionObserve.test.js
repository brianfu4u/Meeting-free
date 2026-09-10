import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root=process.cwd();
const config=path.join(root,"config/agent-v11/realistic-distribution-200.csv");
const expand=path.join(root,"scripts/agent-v11-distribution-expand.mjs");
const dsl=path.join(root,"scripts/agent-v11-scenario-dsl-v2.mjs");
const chunk=path.join(root,"scripts/agent-v11-distribution-chunk-build.mjs");

describe("Agent v1.1 realistic distribution observe plan",()=>{
  it("expands exactly 200 weighted samples and preserves support boundaries",()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),"agent-v11-dist-"));
    const csv=path.join(dir,"expanded.csv"), json=path.join(dir,"dsl.json");
    try{
      fs.writeFileSync(csv,execFileSync(process.execPath,[expand,config],{encoding:"utf8"}));
      const lines=fs.readFileSync(csv,"utf8").trim().split(/\r?\n/);
      expect(lines).toHaveLength(201);
      fs.writeFileSync(json,execFileSync(process.execPath,[dsl,csv],{encoding:"utf8"}));
      const plan=JSON.parse(fs.readFileSync(json,"utf8"));
      expect(plan.scenarios).toHaveLength(200);
      expect(plan.scenarios.filter(x=>x.execution_support.level==="supported")).toHaveLength(196);
      const approximate=plan.scenarios.filter(x=>x.execution_support.level==="approximate");
      expect(approximate).toHaveLength(4);
      expect(new Set(approximate.map(x=>x.scenario_type))).toEqual(new Set(["cross_clinic","causal_inversion"]));
      expect(plan.scenarios.filter(x=>x.oracle.expected_eligible)).toHaveLength(173);
      const runner=execFileSync(process.execPath,[chunk,json,"0","4"],{encoding:"utf8"});
      expect(runner).toContain('"chunk_index":0');
      expect(runner).toContain('"supported":196');
      expect(runner).toContain("auto_attach_mode");
      expect(runner).not.toMatch(/secrets\.(set|delete)|auto_attach_mode\s*:\s*["']commit/);
    } finally { fs.rmSync(dir,{recursive:true,force:true}); }
  });
});
