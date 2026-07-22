// GENERATED_AGENT_V11_MIRROR source=src/lib/agentV11/authoritativeAttachSaga.js blob=d9cb0aab76a06cf967fee98d613f740ef83dfa2d
import { buildAttachmentLinkDescriptor } from "./attachmentProjection.js";

export async function executeAuthoritativeAttachSaga({ attachment, ops, now }) {
  if (!attachment || !Array.isArray(attachment.artifactIds) || attachment.artifactIds.length === 0) {
    throw new Error("authoritative_attachment_missing");
  }
  if (typeof ops?.createOrGetAttachmentLink !== "function") throw new Error("attachment_link_op_missing");
  if (typeof ops?.reconcileUndoFromAttachmentLink !== "function") throw new Error("undo_projection_op_missing");
  const links = [];
  for (const artifactId of [...new Set(attachment.artifactIds)]) {
    const descriptor = buildAttachmentLinkDescriptor({
      clinicId: attachment.clinicId, workflowId: attachment.workflowId, artifactId,
      attachedAt: now, attachedByRunId: attachment.runId,
      sourceHypothesisId: attachment.hypothesisId,
      snapshotId: attachment.snapshotId, snapshotVersion: attachment.snapshotVersion,
      policyVersion: attachment.policyVersion ?? null,
      decisionSource: attachment.decisionSource, decisionActorId: attachment.decisionActorId,
    });
    const link = await ops.createOrGetAttachmentLink(descriptor);
    if (!link?.id || link.status !== "attached") throw new Error("authoritative_link_persistence_failed");
    await ops.reconcileUndoFromAttachmentLink(link, now);
    links.push(link);
  }
  return { links, decision_source: attachment.decisionSource };
}
