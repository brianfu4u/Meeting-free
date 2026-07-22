// GENERATED_AGENT_V11_MIRROR source=src/lib/agentV11/agentAutoAttachSaga.js blob=aa048d94e9e1919fab16ceef504f71d6bb54780d
import { executeAuthoritativeAttachSaga } from "./authoritativeAttachSaga.js";
const uniq = v => [...new Set((v || []).filter(Boolean))];
const pointerMatches = (w, i) => Boolean(i?.new_snapshot_id && w?.current_snapshot_id === i.new_snapshot_id && w?.current_snapshot_version === i.new_snapshot_version);
const needOps = ops => ["findIntent","createIntent","updateIntent","getWorkflow","getSnapshot","createSnapshot","casWorkflowPointer","createOrGetAttachmentLink","reconcileUndoFromAttachmentLink","updateHypothesis"].forEach(n => { if (typeof ops?.[n] !== "function") throw new Error(`agent_attach_op_missing_${n}`); });
function descriptor(snapshot, r, now) {
  const next = structuredClone(snapshot);
  ["id","created_date","updated_date","created_by","created_by_id"].forEach(k => delete next[k]);
  return Object.assign(next, {
    clinic_id:r.clinicId, workflow_id:r.workflowId,
    snapshot_version:Number(snapshot.snapshot_version)+1,
    projection_version:Number(snapshot.projection_version ?? snapshot.snapshot_version)+1,
    generated_at:now, source_proposal_id:r.sourceProposalId,
    artifact_ids:uniq([...(snapshot.artifact_ids||[]),...r.artifactIds]),
    composition_run_id:r.runId,
  });
}
async function project({request,intent,ops,now}) {
  const p = await executeAuthoritativeAttachSaga({ attachment:{
    clinicId:request.clinicId, workflowId:request.workflowId, artifactIds:request.artifactIds,
    runId:intent.composition_run_id, hypothesisId:request.hypothesisId,
    snapshotId:intent.new_snapshot_id, snapshotVersion:intent.new_snapshot_version,
    policyVersion:request.policyVersion, decisionSource:"agent_autonomous",
    decisionActorId:intent.composition_run_id,
  },ops,now});
  await ops.updateHypothesis(request.hypothesisId,{status:"committed"});
  const committed=await ops.updateIntent(intent.id,{status:"committed",finalized_at:now,reconciliation:{last_step:"links_projected",pending_compensation:[]}});
  return {outcome:"committed",intent:committed,links:p.links};
}
export async function executeAgentAutoAttachSaga({request,ops,now}) {
  needOps(ops);
  if(!request?.clinicId||!request?.runId||!request?.hypothesisId||!request?.workflowId||!request?.artifactIds?.length) throw new Error("agent_attach_request_invalid");
  const key=`${request.clinicId}::${request.hypothesisId}`;
  let intent=await ops.findIntent(request.clinicId,key);
  if(!intent) intent=await ops.createIntent({clinic_id:request.clinicId,idempotency_key:key,composition_run_id:request.runId,workflow_hypothesis_id:request.hypothesisId,target_workflow_id:request.workflowId,artifact_ids:uniq(request.artifactIds),status:"pending",decision_source:"agent_autonomous",retry_count:0,created_at:now});
  const workflow=await ops.getWorkflow(request.workflowId);
  if(!workflow||workflow.clinic_id!==request.clinicId) throw new Error("agent_attach_tenant_violation");
  if(intent.status==="committed") return {outcome:"committed",idempotent:true,intent};
  if(pointerMatches(workflow,intent)){const repaired=await project({request,intent,ops,now});return {...repaired,idempotent:true,repaired:true};}
  const current=await ops.getSnapshot(workflow.current_snapshot_id);
  if(!current||current.clinic_id!==request.clinicId||current.workflow_id!==workflow.id) throw new Error("agent_attach_snapshot_invalid");
  const d=descriptor(current,request,now);
  intent=await ops.updateIntent(intent.id,{status:"attaching",expected_snapshot_id:current.id,expected_snapshot_version:current.snapshot_version,retry_count:Number(intent.retry_count||0)+(intent.status==="cas_retryable"?1:0)});
  const snapshot=await ops.createSnapshot(d);
  intent=await ops.updateIntent(intent.id,{new_snapshot_id:snapshot.id,new_snapshot_version:d.snapshot_version,reconciliation:{last_step:"snapshot_created",pending_compensation:[]}});
  const cas=await ops.casWorkflowPointer({id:workflow.id,clinic_id:request.clinicId,current_snapshot_id:current.id,current_snapshot_version:current.snapshot_version},{current_snapshot_id:snapshot.id,current_snapshot_version:d.snapshot_version});
  if(cas?.updated!==1){const retryable=await ops.updateIntent(intent.id,{status:"cas_retryable",reconciliation:{last_step:"workflow_pointer_cas",pending_compensation:["retry_from_latest_pointer"]}});return {outcome:"cas_retryable",idempotent:false,retryable:true,intent:retryable};}
  const committed=await project({request,intent,ops,now});return {...committed,idempotent:false,snapshot};
}
