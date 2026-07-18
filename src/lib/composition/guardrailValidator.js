/**
 * Clinic OS V10 — Guardrail Validator（修订版 R2.2）
 *
 * R2.2：
 * - 主体冲突检查读取 EvidenceFactCard（subject_fingerprint + subject_quality），不假设 Artifact 有 subject_quality；
 * - Snapshot 存在性 / Tenant / snapshot_version 校验；版本不一致 → stale_proposal 阻断；
 * - needs_manager_dispatch 唯一来源：假设校验结果 + clustering validation_issues；
 * - 结构化 rule_code 分发；legacy_text / 未知 rule_code 均阻断（不静默忽略）。
 */

import { KNOWN_RULE_CODES } from "./policyUtils";

export function validateHypotheses(hypotheses, context = {}) {
  // R2.4：Guardrail 自身必须要求 clinicId（租户隔离强制）
  if (!context.clinicId) {
    throw new Error("Guardrail: clinicId required（租户隔离强制）");
  }
  const {
    artifacts = [],
    workflows = [],
    snapshots = [],
    factCards = [],
    clinicId,
    guessPolicy = {},
    committedArtifactIds = [],
    now = Date.now(),
    validationIssues = [],
  } = context;

  const artifactById = new Map(artifacts.map((a) => [a.id, a]));
  const workflowById = new Map(workflows.map((w) => [w.id, w]));
  const snapshotById = new Map(snapshots.map((s) => [s.id, s]));
  const factCardByArtifactId = new Map(factCards.map((fc) => [fc.artifact_id, fc]));
  const committed = new Set(committedArtifactIds);
  const hardRules = guessPolicy.hard_guardrails || [];

  const checked = (hypotheses || []).map((h) => {
    const blocks = [
      ...independentChecks(h, { artifactById, workflowById, snapshotById, clinicId, committed }),
      ...policyChecks(h, { factCardByArtifactId, workflowById, snapshotById, hardRules, now }),
    ];
    return { hypothesis: h, blocked: blocks.length > 0, blocks };
  });

  const surviving = checked.filter((c) => !c.blocked).map((c) => c.hypothesis);
  const ranked = [...surviving].sort(compareHypotheses);

  let bestHypothesisId = null;
  let needsManagerDispatch = false;

  if (ranked.length === 0) {
    needsManagerDispatch = true;
  } else if (ranked.length >= 2 && compareHypotheses(ranked[0], ranked[1]) === 0) {
    needsManagerDispatch = true;
  } else {
    bestHypothesisId = ranked[0].workflow_hypothesis_id;
  }

  // R2.3 项4：Guardrail 是 needs_manager_dispatch 唯一来源；
  // validationIssues 非空 → needsManagerDispatch=true 且 bestHypothesisId=null（不自动选定最佳）
  if (validationIssues.length > 0) {
    needsManagerDispatch = true;
    bestHypothesisId = null;
  }

  return {
    checked,
    ranked,
    surviving,
    bestHypothesisId,
    needsManagerDispatch,
    allBlocked: ranked.length === 0,
    validationIssues,
  };
}

function independentChecks(h, { artifactById, workflowById, snapshotById, clinicId, committed }) {
  const blocks = [];
  const ordered = h.ordered_artifact_ids || [];

  for (const aid of ordered) {
    const a = artifactById.get(aid);
    if (!a) {
      blocks.push({ rule_code: "artifact_not_found", artifact_id: aid });
    } else if (!a.clinic_id) {
      // R2.4：Artifact 缺 clinic_id 阻断
      blocks.push({ rule_code: "missing_tenant_artifact", artifact_id: aid });
    } else if (a.clinic_id !== clinicId) {
      blocks.push({ rule_code: "cross_tenant_artifact", artifact_id: aid });
    }
  }

  if (new Set(ordered).size !== ordered.length) {
    blocks.push({ rule_code: "duplicate_artifact_id" });
  }

  if (h.composition_type === "attach") {
    if (!h.target_workflow_id) {
      blocks.push({ rule_code: "attach_without_target" });
    } else {
      const wf = workflowById.get(h.target_workflow_id);
      if (!wf) {
        blocks.push({ rule_code: "target_workflow_not_found" });
      } else if (!wf.clinic_id) {
        // R2.4：Workflow 缺 clinic_id 阻断
        blocks.push({ rule_code: "missing_tenant_workflow" });
      } else if (wf.clinic_id !== clinicId) {
        blocks.push({ rule_code: "cross_tenant_workflow" });
      }
    }
    // R2.3 项3：attach 必须携带 target_snapshot_id + version
    if (!h.target_snapshot_id) {
      blocks.push({ rule_code: "attach_without_snapshot" });
    } else if (h.target_snapshot_version == null) {
      blocks.push({ rule_code: "attach_without_snapshot_version" });
    }
  }
  if (h.composition_type === "new_train" && h.target_workflow_id) {
    blocks.push({ rule_code: "new_train_with_target" });
  }

  // Snapshot 存在性 / Tenant / workflow_id 一致 / snapshot_version（缺失或不一致均阻断为 stale_proposal）
  if (h.target_snapshot_id) {
    const snap = snapshotById.get(h.target_snapshot_id);
    if (!snap) {
      blocks.push({ rule_code: "target_snapshot_not_found" });
    } else {
      if (!snap.clinic_id) {
        // R2.4：Snapshot 缺 clinic_id 阻断
        blocks.push({ rule_code: "missing_tenant_snapshot" });
      } else if (snap.clinic_id !== clinicId) {
        blocks.push({ rule_code: "cross_tenant_snapshot" });
      }
      // R2.4：snapshot.workflow_id 缺失或不等于 target_workflow_id 均阻断
      if (h.target_workflow_id && snap.workflow_id !== h.target_workflow_id) {
        blocks.push({
          rule_code: "snapshot_workflow_mismatch",
          snapshot_workflow_id: snap.workflow_id ?? null,
          target_workflow_id: h.target_workflow_id,
        });
      }
      // R2.3 项3：实际版本缺失或不一致 → stale_proposal
      if (
        h.target_snapshot_version != null &&
        (snap.snapshot_version == null || snap.snapshot_version !== h.target_snapshot_version)
      ) {
        blocks.push({
          rule_code: "stale_proposal",
          expected: h.target_snapshot_version,
          actual: snap.snapshot_version ?? null,
        });
      }
    }
  }

  for (const aid of ordered) {
    if (committed.has(aid)) blocks.push({ rule_code: "duplicate_evidence", artifact_id: aid });
  }

  return blocks;
}

function policyChecks(h, { factCardByArtifactId, workflowById, snapshotById, hardRules, now }) {
  const blocks = [];
  const ordered = h.ordered_artifact_ids || [];

  for (const rule of hardRules) {
    switch (rule.rule_code) {
      case "subject_conflict": {
        // 读取 EvidenceFactCard 的 subject_fingerprint + subject_quality
        const names = ordered
          .map((aid) => factCardByArtifactId.get(aid))
          .filter((fc) => fc && fc.subject_quality === "high" && fc.subject_fingerprint)
          .map((fc) => fc.subject_fingerprint.name)
          .filter(Boolean);
        if (new Set(names).size > 1) blocks.push({ rule_code: "subject_conflict" });
        break;
      }
      case "time_impossible": {
        const maxGapMs = (rule.max_gap_minutes ?? 1440) * 60 * 1000;
        const wf = h.target_workflow_id ? workflowById.get(h.target_workflow_id) : null;
        for (const aid of ordered) {
          const fc = factCardByArtifactId.get(aid);
          const capturedAt = fc?.occurred_at;
          if (!capturedAt) continue;
          const t = new Date(capturedAt).getTime();
          if (Number.isNaN(t)) continue;
          if (t > now + 60 * 1000) {
            blocks.push({ rule_code: "time_impossible", artifact_id: aid, reason: "future" });
          }
          if (wf && wf.started_at) {
            const start = new Date(wf.started_at).getTime();
            if (!Number.isNaN(start) && t < start - maxGapMs) {
              blocks.push({ rule_code: "time_impossible", artifact_id: aid, reason: "before_workflow_start" });
            }
          }
        }
        break;
      }
      case "attach_to_closed_workflow": {
        const wf = h.target_workflow_id ? workflowById.get(h.target_workflow_id) : null;
        if (wf && Array.isArray(wf.open_loops) && wf.open_loops.length === 0) {
          blocks.push({ rule_code: "attach_to_closed_workflow" });
        }
        break;
      }
      case "legacy_text": {
        // 旧数据迁移后的标记：不静默忽略，强制阻断以推动重新编写
        blocks.push({ rule_code: "legacy_text", original: rule.original || null });
        break;
      }
      default: {
        // 未知 rule_code 不得静默忽略
        blocks.push({ rule_code: "unknown_rule", attempted: rule.rule_code });
        break;
      }
    }
  }
  return blocks;
}

function fragmentsExplained(h) {
  const ordered = h.ordered_artifact_ids || [];
  const unexplained = new Set(h.unexplained_artifact_ids || []);
  return ordered.filter((id) => !unexplained.has(id)).length;
}

export function compareHypotheses(a, b) {
  const fa = fragmentsExplained(a);
  const fb = fragmentsExplained(b);
  if (fb !== fa) return fb - fa;

  const ua = (a.unsupported_assumptions || []).length;
  const ub = (b.unsupported_assumptions || []).length;
  if (ua !== ub) return ua - ub;

  const ca = (a.contradictions || []).length;
  const cb = (b.contradictions || []).length;
  if (ca !== cb) return ca - cb;

  return 0;
}

export { KNOWN_RULE_CODES };