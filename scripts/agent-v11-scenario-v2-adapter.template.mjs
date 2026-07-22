const PLAN = __AGENT_V11_SCENARIO_V2_EXECUTION_PLAN__;
const PREFIX = "agent-v11-it-v2-observe-";
const ENTITIES = ["AgentAttachIntent","WorkflowArtifactLink","UndoListItem","AttentionItem","ManagerDecision","WorkflowCommitIntent","WorkflowHypothesis","CompositionRun","WorkflowSnapshot","Workflow","EvidenceFactCard","Artifact","GuessPolicy","Staff","ClinicConfig"];
const assert = (v,m) => { if (!v) throw new Error(`agent_v11_v2_adapter_assertion_failed:${m}`); };
const unwrap = (v) => v?.data ?? v;
const clean = (v,f="unknown") => typeof v === "string" && v.trim() ? v.trim() : f;
const clock = (d) => ({ date:new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).format(d), slot:new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Tokyo",hour:"2-digit",minute:"2-digit",hour12:false}).format(d) });

async function execute(scenario, actor) {
  const clinic = `${PREFIX}${crypto.randomUUID()}`;
  assert(clinic.startsWith(PREFIX) && clinic !== "clinic-001", "unsafe_clinic");
  const rows = async e => (await base44.entities[e].filter({clinic_id:clinic})) || [];
  const create = async (e,p) => { assert(p.clinic_id === clinic,"tenant_scope"); return await base44.entities[e].create(p); };
  const counts = async () => Object.fromEntries(await Promise.all(ENTITIES.map(async e=>[e,(await rows(e)).length])));
  const report={scenario_id:scenario.scenario_id,execution_support:"supported",result:null,cleanup:null};
  try {
    const now=new Date(), nowIso=now.toISOString(), c=clock(now);
    const staff=await create("Staff",{clinic_id:clinic,user_id:actor.id,staff_name:"V2 Observe",role:"doctor",role_group:"medical_core",status:"off_duty"});
    await create("ClinicConfig",{clinic_id:clinic,clinic_name:`V2 ${scenario.scenario_id}`,manager_id:staff.id,activation_status:"active",timezone:"Asia/Tokyo",schedule_times:[c.slot],shadow_mode:true,active_policy_version:1,composition_rollout_status:"pilot",composition_schedule_enabled:false});
    await create("GuessPolicy",{clinic_id:clinic,policy_version:1,status:"published",tracks:[],hard_guardrails:[],decision_rules:{},published_at:nowIso,published_by:actor.id});
    const workflowMap=new Map();
    for (const spec of scenario.fixture.workflows || []) {
      const fp=spec.subject?.fingerprint || {};
      const status=spec.status === "closed_archived" ? "closed" : clean(spec.status,"active");
      const wf=await create("Workflow",{clinic_id:clinic,workflow_family:clean(spec.workflow_family),subject_type:clean(spec.subject?.type),subject_fingerprint:{name:clean(fp.name,`SUBJECT-${spec.key}`)},status,temporal_anchors:[nowIso],started_at:new Date(now.getTime()-600000).toISOString(),last_event_at:nowIso,open_loops:Array.isArray(spec.open_loops)?spec.open_loops:[],session_id:`session-${crypto.randomUUID()}`});
      const snap=await create("WorkflowSnapshot",{clinic_id:clinic,workflow_id:wf.id,session_id:wf.session_id,patient_name:clean(fp.name,`SUBJECT-${spec.key}`),business_line:"medical",start_time:wf.started_at,current_node:"v2_fixture",nodes_completed:[],stage_durations:{},status:"active",pipeline_trigger:"manual",generated_at:nowIso,snapshot_version:1,projection_version:1,projected_through_event_seq:0,source_proposal_id:`v2-${scenario.scenario_id}-${spec.key}`,artifact_ids:[],evidence_fact_card_ids:[],audit_event_ids:[]});
      await base44.entities.Workflow.update(wf.id,{current_snapshot_id:snap.id,current_snapshot_version:1});
      workflowMap.set(spec.key,{wf,snap});
    }
    let seq=0;
    for (const frag of scenario.fixture.fragments || []) {
      seq++; const target=workflowMap.get(frag.targeting?.workflow_key); const explicit=frag.targeting?.mode === "explicit" && target;
      const occurred=new Date(now.getTime()+Number(frag.occurred_at_offset_seconds||0)*1000).toISOString();
      const fp=frag.subject?.fingerprint||{};
      const artifact=await create("Artifact",{clinic_id:clinic,artifact_type:clean(frag.artifact_type,"document"),file_url:`https://example.invalid/${clinic}/${seq}`,source_staff_id:staff.id,source_region:clean(frag.source_department),source_role:clean(frag.source_role),category_id:clean(frag.category_id),business_date:c.date,captured_at:new Date(now.getTime()+Number(frag.captured_at_offset_seconds||30)*1000).toISOString(),occurred_at:occurred,ingestion_seq:seq,interpreted:true,...(explicit?{source_workflow_id:target.wf.id}:{})});
      const fact=await create("EvidenceFactCard",{clinic_id:clinic,artifact_id:artifact.id,...(explicit?{explicit_workflow_id:target.wf.id}:{}),fields:Object.entries(frag.document_numbers||{}).map(([k,v])=>({field_name:k,value:String(v),source_artifact_id:artifact.id,source_region:clean(frag.source_department),source_quote:String(v),extraction_quality:"high",extraction_method:"manual"})),business_date:c.date,extracted_at:nowIso,model_version:"v2-fixture-adapter",prompt_version:"v2-fixture-adapter",policy_version:1,stale:false,workflow_family_hint:clean(target?.wf?.workflow_family,scenario.fixture.workflows?.[0]?.workflow_family||"unknown"),subject_type:clean(frag.subject?.type),subject_fingerprint:{...fp,name:clean(fp.name,"UNKNOWN")},subject_quality:fp.name?"high":"low",occurred_at:occurred,time_uncertain:frag.time_uncertain===true,alignment_status:"aligned",assembly_eligible:true,missing_segments:Array.isArray(frag.missing_segments)?frag.missing_segments:[]});
      await base44.entities.Artifact.update(artifact.id,{evidence_fact_card_id:fact.id,interpreted:true});
      await create("UndoListItem",{clinic_id:clinic,artifact_id:artifact.id,original_uploader_id:staff.id,idempotency_key:`${clinic}::${artifact.id}`,business_date:c.date,bounced_at:nowIso,bounce_reason:"not_assembled_by_cutoff",status:"pending"});
    }
    const baseline=await counts();
    const request={action:"run",clinic_id:clinic,business_date:c.date,slot:c.slot,policy_version:1,cutoff_event_seq:seq,cutoff_ingested_at:nowIso,prompt_version:"agent-v11-v2-adapter",model_version:"automatic",trigger_type:"manager_manual"};
    const first=unwrap(await base44.functions.invoke("compositionOrchestrator",request));
    assert(first?.ok===true && first?.run?.status==="completed","run_failed"); assert(first.run.auto_attach_mode==="observe","not_observe");
    const after=await counts(), reasons=Array.isArray(first.run.auto_attach_gate_reasons)?first.run.auto_attach_gate_reasons:[];
    assert(after.WorkflowArtifactLink===baseline.WorkflowArtifactLink,"link_write"); assert(after.WorkflowSnapshot===baseline.WorkflowSnapshot,"snapshot_write"); assert((await rows("UndoListItem")).every(x=>x.status==="pending"),"undo_write"); assert(after.ManagerDecision===0&&after.WorkflowCommitIntent===0,"authority_write");
    const replay=unwrap(await base44.functions.invoke("compositionOrchestrator",request)); assert(replay?.idempotent===true&&replay?.run?.id===first.run.id,"replay_failed");
    const replayCounts=await counts(); for(const e of ["CompositionRun","WorkflowHypothesis","AgentAttachIntent","WorkflowArtifactLink","WorkflowSnapshot","UndoListItem"]) assert(replayCounts[e]===after[e],`replay_growth_${e}`);
    // Oracle is consulted only after runtime fixture execution and gate observation.
    // Match every declared dimension so dispatch/validation regressions cannot
    // hide behind a correct eligible boolean.
    const actualEligible=first.run.auto_attach_eligible===true;
    const actualGuardrailDispatch=first.dispatch?.needsManagerDispatch===true;
    const actualValidationBlock=
      reasons.includes("validation_blocks_present") ||
      (Array.isArray(first.hypotheses) && first.hypotheses.some(
        h=>Array.isArray(h.validation_blocks)&&h.validation_blocks.length>0
      ));
    const oracleChecks={
      eligible:actualEligible===scenario.oracle.expected_eligible,
      guardrail_dispatch:actualGuardrailDispatch===scenario.oracle.expected_guardrail_dispatch,
      validation_block:actualValidationBlock===scenario.oracle.expected_validation_block,
    };
    report.oracle=scenario.oracle;
    report.result={eligible:actualEligible,gate_reasons:reasons,actual_guardrail_dispatch:actualGuardrailDispatch,actual_validation_block:actualValidationBlock,llm_audit:{required:first.run.llm_audit_required===true,type:first.run.llm_audit_type||null,status:first.run.llm_audit_status||null,reason_codes:Array.isArray(first.run.llm_audit_reason_codes)?first.run.llm_audit_reason_codes:[]},oracle_checks:oracleChecks,oracle_match:Object.values(oracleChecks).every(Boolean),observed_intent_count:(await rows("AgentAttachIntent")).filter(x=>x.status==="observed").length,replay_idempotent:true,authoritative_writes_zero:true};
  } catch(e) { report.error=String(e?.message||e).replace(/[\r\n]+/g," ").slice(0,300); }
  finally { const before=await counts(); for(const e of ENTITIES) for(const x of await rows(e)) await base44.entities[e].delete(String(x.id)); const after=await counts(); report.cleanup={before,after,cleanup_all_zero:Object.values(after).every(x=>x===0)}; }
  return report;
}

assert(PLAN?.schema_version==="agent-v11-scenario-v2-execution-plan","plan_invalid");
const actor=await base44.auth.me(); assert(actor?.id,"actor_missing");
const scenarios=[]; for(const s of PLAN.supported) scenarios.push(await execute(s,actor));
const completed=scenarios.filter(x=>!x.error); const eligible=completed.filter(x=>x.result?.eligible).length;
const summary={mode:"observe",supported_executed:completed.length,supported_failed:scenarios.length-completed.length,eligible_count:eligible,eligible_rate:completed.length?eligible/completed.length:0,oracle_mismatch:completed.filter(x=>!x.result?.oracle_match).map(x=>x.scenario_id),approximate_report:PLAN.approximate.map(x=>({...x,executed:false,excluded_from_eligible_rate:true})),unsupported_skipped:PLAN.unsupported.map(x=>({...x,executed:false,excluded_from_eligible_rate:true})),safety:{authoritative_writes_zero:completed.every(x=>x.result?.authoritative_writes_zero),cleanup_all_zero:scenarios.every(x=>x.cleanup?.cleanup_all_zero)}};
console.log(JSON.stringify({summary,scenarios},null,2));
if(summary.supported_failed||!Object.values(summary.safety).every(Boolean)) throw new Error("agent_v11_v2_adapter_failed");
