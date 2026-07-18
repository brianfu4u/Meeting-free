/**
 * Clinic OS V10 — Guardrail Validator（修订版 R2）
 *
 * R2：
 * - 独立检查：Artifact/目标 Workflow 同租户、引用 ID 真实、Artifact 不重复、主体硬冲突、物理时间不可能；
 * - 结构化 Policy rule_code 执行（switch），禁止自然语言 includes() 作为正式规则；
 * - Tie 或全部阻断 → bestHypothesisId = null + needsManagerDispatch = true；
 * - 校验结果是 needs_manager_dispatch 的唯一来源。
 */

export function validateHypotheses(hypotheses, context = {}) {
  const {
    artifacts = [],
    workflows = [],
    clinicId,
    guessPolicy = {},
    committedArtifactIds = [],
    now = Date.now(),
  } = context;

  const artifactById = new Map(artifacts.map((a) => [a.id, a]));
  const workflowById = new Map(workflows.map((w) => [w.id, w]));
  const committed = new Set(committedArtifactIds);
  const hardRules = guessPolicy.hard_guardrails || [];

  const checked = (hypotheses || []).map((h) => {
    const blocks = [
      ...independentChecks(h, { artifactById, workflowById, clinicId, committed }),
      ...policyChecks(h, { artifactById, workflowById, hardRules, now }),
    ];
    return { hypothesis: h, blocked: blocks.length > 0, blocks };
  });

  const surviving = checked.filter((c) => !c.blocked).map((c) => c.hypothesis);
  const ranked = [...surviving].sort(compareHypotheses);

  let bestHypothesisId = null;
  let needsManagerDispatch = false;

  if (ranked.length === 0) {
    needsManagerDispatch = true; // 全部被硬护栏阻断
  } else if (ranked.length >= 2 && compareHypotheses(ranked[0], ranked[1]) === 0) {
    needsManagerDispatch = true; // 多候选无法明显区分 → 不默认选第一个
  } else {
    bestHypothesisId = ranked[0].workflow_hypothesis_id;
  }

  return {
    checked,
    ranked,
    surviving,
    bestHypothesisId,
    needsManagerDispatch,
    allBlocked: ranked.length === 0,
  };
}

/** 始终执行的独立完整性检查（不依赖 Policy 配置） */
function independentChecks(h, { artifactById, workflowById, clinicId, committed }) {
  const blocks = [];
  const ordered = h.ordered_artifact_ids || [];

  for (const aid of ordered) {
    const a = artifactById.get(aid);
    if (!a) {
      blocks.push({ rule_code: "artifact_not_found", artifact_id: aid });
    } else if (clinicId && a.clinic_id !== clinicId) {
      blocks.push({ rule_code: "cross_tenant_artifact", artifact_id: aid });
    }
  }

  // 簇内 Artifact ID 重复
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
      } else if (clinicId && wf.clinic_id && wf.clinic_id !== clinicId) {
        blocks.push({ rule_code: "cross_tenant_workflow" });
      }
    }
  }
  if (h.composition_type === "new_train" && h.target_workflow_id) {
    blocks.push({ rule_code: "new_train_with_target" });
  }

  for (const aid of ordered) {
    if (committed.has(aid)) blocks.push({ rule_code: "duplicate_evidence", artifact_id: aid });
  }

  return blocks;
}

/** Policy 驱动的结构化规则（按 rule_code 分发，禁止 includes() 字符串匹配） */
function policyChecks(h, { artifactById, workflowById, hardRules, now }) {
  const blocks = [];
  const ordered = h.ordered_artifact_ids || [];

  for (const rule of hardRules) {
    switch (rule.rule_code) {
      case "subject_conflict": {
        const names = ordered
          .map((id) => artifactById.get(id))
          .filter((a) => a && a.subject_quality === "high" && a.subject_fingerprint)
          .map((a) => a.subject_fingerprint.name)
          .filter(Boolean);
        if (new Set(names).size > 1) blocks.push({ rule_code: "subject_conflict" });
        break;
      }
      case "time_impossible": {
        const maxGapMs = (rule.max_gap_minutes ?? 1440) * 60 * 1000;
        const wf = h.target_workflow_id ? workflowById.get(h.target_workflow_id) : null;
        for (const aid of ordered) {
          const a = artifactById.get(aid);
          if (!a || !a.captured_at) continue;
          const t = new Date(a.captured_at).getTime();
          if (Number.isNaN(t)) continue;
          if (t > now + 60 * 1000) {
            blocks.push({ rule_code: "time_impossible", artifact_id: aid, reason: "future" });
          }
          if (wf && wf.arrival_time) {
            const start = new Date(wf.arrival_time).getTime();
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
      default:
        // 未知 rule_code 不执行（不臆测）
        break;
    }
  }
  return blocks;
}

function fragmentsExplained(h) {
  const ordered = h.ordered_artifact_ids || [];
  const unexplained = new Set(h.unexplained_artifact_ids || []);
  return ordered.filter((id) => !unexplained.has(id)).length;
}

/**
 * 顺序比较（无加权）：
 * 1. 解释碎片数 多者优先
 * 2. 无依据假设 少者优先
 * 3. 矛盾 少者优先
 * 4. 全部相等返回 0（tie）
 */
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