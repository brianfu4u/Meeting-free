/**
 * Clinic OS V10 — Guardrail Validator（修订版）
 *
 * 修订要点：
 * - 删除加权公式（fragments_explained - violations*weight - assumptions*weight）；
 * - 改为顺序比较：先淘汰硬护栏违规 → 再比解释碎片数 → 再比无依据假设数 →
 *   再比矛盾数 → 无法明显区分则 manager_required；
 * - 真正阻断硬护栏违规假设（blocked=true，不进入候选）；
 * - 不信任 LLM 自报 guardrail_violations，依据真实 Artifact / Workflow / Tenant / Policy 独立检查；
 * - 未使用的 reasoning track 允许空数组，不因空判违规。
 */

/**
 * 校验一组 Workflow 假设。
 * @param {Array} hypotheses - assembleWorkflow 产出
 * @param {Object} context - { artifacts[], workflows[], clinicId, guessPolicy, committedArtifactIds[] }
 * @returns { checked, ranked, surviving, bestHypothesisId, needsManagerDispatch, allBlocked }
 */
export function validateHypotheses(hypotheses, context = {}) {
  const {
    artifacts = [],
    workflows = [],
    clinicId,
    guessPolicy = {},
    committedArtifactIds = [],
  } = context;

  const artifactById = new Map(artifacts.map((a) => [a.id, a]));
  const workflowById = new Map(workflows.map((w) => [w.id, w]));
  const committed = new Set(committedArtifactIds);

  // 独立硬护栏检查（不信任 LLM 自报）
  const checked = (hypotheses || []).map((h) => {
    const blocks = [];

    // 1. Artifact 存在且同租户
    for (const aid of h.ordered_artifact_ids || []) {
      const a = artifactById.get(aid);
      if (!a) {
        blocks.push({ code: "artifact_not_found", artifact_id: aid });
      } else if (clinicId && a.clinic_id !== clinicId) {
        blocks.push({ code: "cross_tenant_artifact", artifact_id: aid });
      }
    }

    // 2. attach 须有且目标 Workflow 存在；new_train 目标须为 null
    if (h.composition_type === "attach") {
      if (!h.target_workflow_id) {
        blocks.push({ code: "attach_without_target" });
      } else if (!workflowById.has(h.target_workflow_id)) {
        blocks.push({ code: "target_workflow_not_found" });
      }
    }
    if (h.composition_type === "new_train" && h.target_workflow_id) {
      blocks.push({ code: "new_train_with_target" });
    }

    // 3. 重复证据（已被其他 Workflow 占用的 Artifact）
    for (const aid of h.ordered_artifact_ids || []) {
      if (committed.has(aid)) {
        blocks.push({ code: "duplicate_evidence", artifact_id: aid });
      }
    }

    // 4. Policy 硬护栏（独立执行，不读 LLM 自报字段）
    for (const g of guessPolicy.hard_guardrails || []) {
      if (g.includes("attach_requires_open_loop") && h.composition_type === "attach") {
        // 由调用方在 workflows 中携带 open_loops；此处仅做存在性兜底
        const w = h.target_workflow_id ? workflowById.get(h.target_workflow_id) : null;
        if (w && Array.isArray(w.open_loops) && w.open_loops.length === 0) {
          blocks.push({ code: "attach_to_closed_workflow" });
        }
      }
    }

    return { hypothesis: h, blocked: blocks.length > 0, blocks };
  });

  const surviving = checked.filter((c) => !c.blocked).map((c) => c.hypothesis);

  // 顺序比较（无加权分数）
  const ranked = [...survying_safe(surviving)].sort(compareHypotheses);

  let bestHypothesisId = null;
  let needsManagerDispatch = false;

  if (ranked.length === 0) {
    // 全部被硬护栏阻断 → 经理处理
    needsManagerDispatch = true;
  } else {
    bestHypothesisId = ranked[0].workflow_hypothesis_id;
    if (ranked.length > 1 && compareHypotheses(ranked[0], ranked[1]) === 0) {
      // 多候选无法明显区分 → 经理判断
      needsManagerDispatch = true;
    }
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

// 防御性拷贝，避免排序污染原数组
function survying_safe(arr) {
  return arr;
}

/** 计算假设解释的真实碎片数（ordered 去掉 unexplained） */
function fragmentsExplained(h) {
  const ordered = h.ordered_artifact_ids || [];
  const unexplained = new Set(h.unexplained_artifact_ids || []);
  return ordered.filter((id) => !unexplained.has(id)).length;
}

/**
 * 顺序比较器（无加权）：
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