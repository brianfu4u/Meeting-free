import { readFile,readdir } from "node:fs/promises";
import { join } from "node:path";
const [dir,dslPath] = process.argv.slice(2);
if(!dir||!dslPath) throw new Error("usage: node agent-v11-distribution-aggregate.mjs <result-dir> <dsl.json>");
const plan=JSON.parse(await readFile(dslPath,"utf8"));
const expected=new Map(plan.scenarios.map(x=>[x.scenario_id,x]));
const supported=plan.scenarios.filter(x=>x.execution_support?.level==="supported");
const approximate=plan.scenarios.filter(x=>x.execution_support?.level==="approximate");
const reports=[];
for(const name of (await readdir(dir)).filter(x=>x.endsWith(".json")).sort()){
  const payload=JSON.parse(await readFile(join(dir,name),"utf8"));
  for(const row of payload.scenarios||[]) reports.push(row);
}
const byId=new Map();
for(const row of reports){if(byId.has(row.scenario_id))throw new Error(`duplicate_result:${row.scenario_id}`);byId.set(row.scenario_id,row)}
const missing=supported.filter(x=>!byId.has(x.scenario_id)).map(x=>x.scenario_id);
const completed=[...byId.values()].filter(x=>!x.error);
const eligible=completed.filter(x=>x.result?.eligible===true);
const types={}; const gate_reason_distribution={}; const false_eligible=[];
for(const row of completed){
  const spec=expected.get(row.scenario_id); const type=spec?.scenario_type||"unknown";
  const bucket=types[type]||={sample_count:0,eligible_count:0,eligible_rate:0,gate_reasons:{}};
  bucket.sample_count++; if(row.result?.eligible===true)bucket.eligible_count++;
  for(const reason of row.result?.gate_reasons||[]){bucket.gate_reasons[reason]=(bucket.gate_reasons[reason]||0)+1;gate_reason_distribution[reason]=(gate_reason_distribution[reason]||0)+1}
  if(spec?.oracle?.expected_eligible===false&&row.result?.eligible===true)false_eligible.push(row.scenario_id);
}
for(const b of Object.values(types))b.eligible_rate=b.sample_count?b.eligible_count/b.sample_count:0;
const expectedSupportedEligible=supported.filter(x=>x.oracle.expected_eligible===true).length;
const result={
  mode:"observe",
  designed_all_200:{sample_count:plan.scenarios.length,expected_eligible_count:plan.scenarios.filter(x=>x.oracle.expected_eligible===true).length,expected_eligible_rate:plan.scenarios.filter(x=>x.oracle.expected_eligible===true).length/plan.scenarios.length},
  supported_main_stat:{sample_count:supported.length,completed_count:completed.length,eligible_count:eligible.length,actual_eligible_rate:completed.length?eligible.length/completed.length:0,expected_eligible_count:expectedSupportedEligible,expected_eligible_rate:expectedSupportedEligible/supported.length,missing_results:missing},
  approximate_excluded:approximate.map(x=>({scenario_id:x.scenario_id,scenario_type:x.scenario_type,reason:x.execution_support.reason,excluded_from_main_stat:true})),
  scenario_type_distribution:types,
  gate_reason_distribution,
  risk:{false_eligible,all_low_frequency_blocks_safe:false_eligible.length===0},
  safety:{all_results_present:missing.length===0,all_completed:completed.length===supported.length,authoritative_writes_zero:completed.every(x=>x.result?.authoritative_writes_zero===true),cleanup_all_zero:completed.every(x=>x.cleanup?.cleanup_all_zero===true)}
};
console.log(JSON.stringify(result,null,2));
if(!Object.values(result.safety).every(Boolean)||false_eligible.length)process.exitCode=1;
