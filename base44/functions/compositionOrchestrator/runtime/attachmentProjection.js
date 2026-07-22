// GENERATED_AGENT_V11_MIRROR source=src/lib/agentV11/attachmentProjection.js blob=f9383ef747eb6b61e52cf1b7623ff46b62cc649d
function required(value, name) {
  if (typeof value !== "string" || !value) throw new Error(`${name}_required`);
  return value;
}

export function buildAttachmentLinkDescriptor({
  clinicId, workflowId, artifactId, attachedAt, attachedByRunId,
  sourceHypothesisId, snapshotId, snapshotVersion, policyVersion = null,
  decisionSource, decisionActorId,
}) {
  required(clinicId, "clinic_id");
  required(workflowId, "workflow_id");
  required(artifactId, "artifact_id");
  required(attachedAt, "attached_at");
  required(attachedByRunId, "attached_by_run_id");
  if (!["agent_autonomous", "manager_manual"].includes(decisionSource)) throw new Error("decision_source_invalid");
  required(decisionActorId, "decision_actor_id");
  return {
    clinic_id: clinicId, workflow_id: workflowId, artifact_id: artifactId,
    idempotency_key: `${clinicId}::${workflowId}::${artifactId}`,
    status: "attached", attached_at: attachedAt,
    attached_by_run_id: attachedByRunId,
    source_hypothesis_id: sourceHypothesisId || null,
    snapshot_id: snapshotId || null,
    snapshot_version: snapshotVersion ?? null,
    policy_version: policyVersion,
    decision_source: decisionSource,
    decision_actor_id: decisionActorId,
  };
}

export async function reconcileUndoFromAttachmentLink({ link, findPendingUndo, updateUndo, now }) {
  if (!link?.id || link.status !== "attached") return { resolved: 0 };
  required(link.clinic_id, "clinic_id");
  required(link.artifact_id, "artifact_id");
  required(link.workflow_id, "workflow_id");
  required(now, "now");
  const rows = await findPendingUndo(link.clinic_id, link.artifact_id);
  let resolved = 0;
  for (const row of rows || []) {
    if (!row?.id || row.status !== "pending") continue;
    await updateUndo(row.id, {
      status: "resolved", resolved_at: now,
      resolved_into_workflow_id: link.workflow_id,
      resolved_by_link_id: link.id,
    });
    resolved += 1;
  }
  return { resolved };
}
