import { readFile } from "node:fs/promises";

const MAP = {
  normal_forward: ["S001", false, false],
  delayed_upload: ["S002", false, false],
  ambiguous_candidates: ["S005", false, false],
  finance_reverse: ["S009", false, false],
  missing_head: ["S007", false, false],
  missing_tail: ["S008", false, false],
  long_cycle_nonclinical: ["S013", false, false],
  business_family_conflict: ["S004", false, true],
  role_conflict: ["S003", false, true],
  cross_clinic: ["S010", false, true],
  validation_block_device: ["S006", false, true],
  device_conflict: ["S014", false, true],
  causal_inversion: ["S011", false, true],
  manager_exception: ["S015", false, true],
};
const [path] = process.argv.slice(2);
if (!path) throw new Error("usage: node agent-v11-distribution-expand.mjs <distribution.csv>");
const lines = (await readFile(path, "utf8")).trim().split(/\r?\n/);
const header = lines.shift()?.split(",");
if (header?.join(",") !== "scenario_type,scenario_label,expected_eligible,count,pct") throw new Error("distribution_header_invalid");
const rows = lines.map(line => {
  const [scenario_type,scenario_label,expected_eligible,count,pct] = line.split(",");
  if (!MAP[scenario_type]) throw new Error(`scenario_type_unsupported:${scenario_type}`);
  return {scenario_type,scenario_label,expected_eligible:/^true$/i.test(expected_eligible),count:Number(count),pct:Number(pct)};
});
if (rows.reduce((n,r)=>n+r.count,0)!==200) throw new Error("distribution_count_must_equal_200");
if (Math.abs(rows.reduce((n,r)=>n+r.pct,0)-100)>1e-9) throw new Error("distribution_pct_must_equal_100");
const output=["scenario_id,department,business_family,description,candidates_count,has_guardrail_dispatch,has_validation_block,expected_eligible,notes"];
let serial=0;
for(const row of rows){
  const [base,guardrail,validation]=MAP[row.scenario_type];
  for(let i=0;i<row.count;i++){
    serial++;
    output.push([base+"-"+String(serial).padStart(3,"0"),row.scenario_label,row.scenario_type,row.scenario_label,row.scenario_type==="ambiguous_candidates"?2:1,guardrail,validation,row.expected_eligible,"realistic_distribution_simulation"].join(","));
  }
}
process.stdout.write(output.join("\n")+"\n");
