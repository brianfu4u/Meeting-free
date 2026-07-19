// Keep deploy-time types local: Base44 may misclassify cross-file `import type`
type ActorContext = { user_id: string; clinic_id: string; role: "staff" | "admin" };
type ServiceRequest = Record<string, any>;
type ServiceResult = Record<string, any> & { ok: boolean; http_status: number };
type CompositionOps = Record<string, any>;

const ACTIONS = new Set(["interpret", "run", "query", "listRuns", "review", "commit"]);
const REVIEW_TARGET = {
  select: { hypothesisStatus: "selected", managerDecision: "approved" },
  reject: { hypothesisStatus: "rejected", managerDecision: "rejected" },
  ignore: { hypothesisStatus: "ignored", managerDecision: "ignored" },
} as const;
const ACTIVE_HYPOTHESIS_STATUSES = ["pending_review", "selected", "dispatched"];
const RUN_LOCK_LEASE_MS = 30_000;

function response(http_status: number, body: Record<string, unknown>): ServiceResult {
  return { ok: http_status >= 200 && http_status < 300, http_status, ...body };
}

function requiredString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function managerExecutionIdempotencyKey(
  decision: Record<string, unknown>,
  hypothesis: Record<string, unknown>
): string | null {
  if (!requiredString(decision.id) || !requiredString(hypothesis.source_proposal_id)) return null;
  return `exec::${decision.id}::${hypothesis.source_proposal_id}`;
}

function tenantSafe(ops: CompositionOps, clinicId: string, ...objects: unknown[]): boolean {
  try {
    return ops.assertTenant(clinicId, ...objects) === true;
  } catch {
    return false;
  }
}

function authorized(
  ops: CompositionOps,
  request: ServiceRequest,
  actor: ActorContext
): ServiceResult | null {
  if (!ACTIONS.has(request.action)) return response(400, { error_code: "action_invalid" });
  if (!requiredString(request.clinic_id)) {
    return response(400, { error_code: "clinic_id_required" });
  }
  if (
    !actor ||
    !requiredString(actor.user_id) ||
    !requiredString(actor.clinic_id) ||
    actor.clinic_id !== request.clinic_id
  ) {
    return response(403, { error_code: "tenant_scope_violation" });
  }
  try {
    if (!ops.authorize({
      action: request.action,
      role: actor.role,
      clinicId: actor.clinic_id,
    })) {
      return response(403, { error_code: "action_not_allowed" });
    }
  } catch {
    return response(403, { error_code: "action_not_allowed" });
  }
  return null;
}

async function interpret(
  ops: CompositionOps,
  request: ServiceRequest,
  actor: ActorContext
): Promise<ServiceResult> {
  if (!requiredString(request.artifact_id)) {
    return response(400, { error_code: "artifact_id_required" });
  }
  const artifact = await ops.getArtifact(request.artifact_id);
  if (!artifact) return response(404, { error_code: "artifact_not_found" });
  if (!tenantSafe(ops, actor.clinic_id, artifact)) {
    return response(403, { error_code: "tenant_scope_violation" });
  }

  const existing = await ops.findFactCardByArtifact(actor.clinic_id, request.artifact_id);
  if (existing) {
    if (!tenantSafe(ops, actor.clinic_id, existing)) {
      return response(403, { error_code: "tenant_scope_violation" });
    }
    return response(200, { idempotent: true, fact_card: existing });
  }

  const interpreted = await ops.interpretArtifact(artifact, actor);
  if (!interpreted || typeof interpreted !== "object") {
    return response(502, { error_code: "interpret_failed" });
  }
  const descriptor = {
    ...interpreted,
    clinic_id: actor.clinic_id,
    artifact_id: request.artifact_id,
  };
  if (!tenantSafe(ops, actor.clinic_id, descriptor)) {
    return response(403, { error_code: "tenant_scope_violation" });
  }
  const created = await ops.createFactCard(descriptor);
  return response(201, { idempotent: false, fact_card: created });
}

async function query(
  ops: CompositionOps,
  request: ServiceRequest,
  actor: ActorContext
): Promise<ServiceResult> {
  if (!requiredString(request.composition_run_id)) {
    return response(400, { error_code: "composition_run_id_required" });
  }
  const run = await ops.getRun(request.composition_run_id);
  if (!run) return response(404, { error_code: "composition_run_not_found" });
  if (!tenantSafe(ops, actor.clinic_id, run)) {
    return response(403, { error_code: "tenant_scope_violation" });
  }
  const [hypotheses, attention_items] = await Promise.all([
    ops.listHypothesesByRun(actor.clinic_id, request.composition_run_id),
    ops.listAttentionByRun(actor.clinic_id, request.composition_run_id),
  ]);
  if (
    !hypotheses.every((item) => tenantSafe(ops, actor.clinic_id, item)) ||
    !attention_items.every((item) => tenantSafe(ops, actor.clinic_id, item))
  ) {
    return response(403, { error_code: "tenant_scope_violation" });
  }
  return response(200, { run, hypotheses, attention_items });
}

async function listRuns(
  ops: CompositionOps,
  request: ServiceRequest,
  actor: ActorContext
): Promise<ServiceResult> {
  const limit = Math.min(Math.max(Number(request.limit) || 20, 1), 100);
  const runs = await ops.listRuns(actor.clinic_id, {
    business_date: request.business_date,
    limit,
  });
  if (!runs.every((item) => tenantSafe(ops, actor.clinic_id, item))) {
    return response(403, { error_code: "tenant_scope_violation" });
  }

  if (request.include_hypothesis_summary !== true) {
    return response(200, { runs, limit, hypothesis_summary_included: false });
  }

  const runIds = runs
    .map((item) => item.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const summaries = runIds.length
    ? await ops.listActiveHypothesisSummaries(
        actor.clinic_id,
        runIds,
        ACTIVE_HYPOTHESIS_STATUSES
      )
    : {};
  const summarizedRuns = runs.map((item) => ({
    ...item,
    hypothesis_summary:
      typeof item.id === "string"
        ? summaries[item.id] || { active_count: 0, status_counts: {} }
        : { active_count: 0, status_counts: {} },
  }));
  return response(200, {
    runs: summarizedRuns,
    limit,
    hypothesis_summary_included: true,
    active_hypothesis_statuses: ACTIVE_HYPOTHESIS_STATUSES,
  });
}

async function review(
  ops: CompositionOps,
  request: ServiceRequest,
  actor: ActorContext
): Promise<ServiceResult> {
  if (!requiredString(request.workflow_hypothesis_id)) {
    return response(400, { error_code: "workflow_hypothesis_id_required" });
  }
  const target = REVIEW_TARGET[request.review_decision as keyof typeof REVIEW_TARGET];
  if (!target) return response(400, { error_code: "review_decision_invalid" });
  if (actor.user_id === "auto" || actor.user_id === "system") {
    return response(403, { error_code: "human_manager_required" });
  }

  const hypothesis = await ops.getHypothesisByKey(
    actor.clinic_id,
    request.workflow_hypothesis_id
  );
  if (!hypothesis) return response(404, { error_code: "workflow_hypothesis_not_found" });
  if (!tenantSafe(ops, actor.clinic_id, hypothesis)) {
    return response(403, { error_code: "tenant_scope_violation" });
  }

  const projectDecision = async (
    decision: Record<string, unknown>,
    idempotent: boolean
  ): Promise<ServiceResult> => {
    if (!tenantSafe(ops, actor.clinic_id, decision)) {
      return response(403, { error_code: "tenant_scope_violation" });
    }
    if (decision.decision !== target.managerDecision) {
      return response(409, { error_code: "hypothesis_already_reviewed" });
    }

    let projectedHypothesis = hypothesis;
    if (hypothesis.status === "pending_review") {
      if (!requiredString(hypothesis.id)) {
        return response(500, { error_code: "hypothesis_persistence_id_missing" });
      }
      projectedHypothesis = await ops.updateHypothesis(hypothesis.id, {
        status: target.hypothesisStatus,
      });
    } else if (hypothesis.status !== target.hypothesisStatus) {
      return response(409, { error_code: "hypothesis_state_conflict" });
    }

    const [attentionItems, relatedHypotheses] = await Promise.all([
      ops.listAttentionByRun(actor.clinic_id, String(hypothesis.composition_run_id || "")),
      ops.listHypothesesByRun(actor.clinic_id, String(hypothesis.composition_run_id || "")),
    ]);
    if (
      !attentionItems.every((item) => tenantSafe(ops, actor.clinic_id, item)) ||
      !relatedHypotheses.every((item) => tenantSafe(ops, actor.clinic_id, item))
    ) {
      return response(403, { error_code: "tenant_scope_violation" });
    }

    const otherPending = relatedHypotheses.some(
      (item) =>
        item.workflow_hypothesis_id !== request.workflow_hypothesis_id &&
        item.status === "pending_review"
    );
    const decidedAt = String(decision.decided_at || ops.now());
    const updatedAttention = [];
    for (const item of attentionItems.filter((candidate) => candidate.status === "open")) {
      if (!requiredString(item.id)) continue;
      if (request.review_decision === "select") {
        updatedAttention.push(await ops.updateAttention(item.id, {
          status: "executed",
          manager_action: "execute",
          manager_note: request.decision_note || null,
          decided_at: decidedAt,
          selected_hypothesis_id: request.workflow_hypothesis_id,
        }));
      } else if (!otherPending) {
        updatedAttention.push(await ops.updateAttention(item.id, {
          status: "ignored",
          manager_action: "ignore",
          manager_note: request.decision_note || null,
          decided_at: decidedAt,
          selected_hypothesis_id: null,
        }));
      }
    }

    return response(idempotent ? 200 : 201, {
      idempotent,
      hypothesis: projectedHypothesis,
      manager_decision: decision,
      attention_items: updatedAttention,
    });
  };

  const existing = await ops.findManagerDecision(
    actor.clinic_id,
    request.workflow_hypothesis_id
  );
  if (existing) return projectDecision(existing, true);

  const lockKey = `manager-review::${request.workflow_hypothesis_id}`;
  const owner = ops.newRunLockOwner(actor.user_id, lockKey);
  const lockNow = ops.now();
  const expiresAt = new Date(
    new Date(lockNow).getTime() + RUN_LOCK_LEASE_MS
  ).toISOString();
  const lock = await ops.acquireRunLock(
    actor.clinic_id,
    lockKey,
    owner,
    lockNow,
    expiresAt
  );
  if (!lock.acquired) {
    return response(409, { error_code: "review_lock_busy", retryable: true });
  }

  let decision: Record<string, unknown>;
  let idempotent = false;
  try {
    const lockedExisting = await ops.findManagerDecision(
      actor.clinic_id,
      request.workflow_hypothesis_id
    );
    if (lockedExisting) {
      decision = lockedExisting;
      idempotent = true;
    } else {
      decision = await ops.createManagerDecision({
        clinic_id: actor.clinic_id,
        manager_id: actor.user_id,
        target_type: "hypothesis",
        target_id: request.workflow_hypothesis_id,
        decision: target.managerDecision,
        decision_note:
          typeof request.decision_note === "string"
            ? request.decision_note.slice(0, 1000)
            : null,
        decided_at: ops.now(),
      });
    }
  } finally {
    await ops.releaseRunLock(actor.clinic_id, lockKey, owner).catch(() => undefined);
  }
  return projectDecision(decision, idempotent);
}

async function commit(
  ops: CompositionOps,
  request: ServiceRequest,
  actor: ActorContext
): Promise<ServiceResult> {
  if (!requiredString(request.workflow_hypothesis_id)) {
    return response(400, { error_code: "workflow_hypothesis_id_required" });
  }
  if (actor.user_id === "auto" || actor.user_id === "system") {
    return response(403, { error_code: "human_manager_required" });
  }

  const hypothesis = await ops.getHypothesisByKey(
    actor.clinic_id,
    request.workflow_hypothesis_id
  );
  if (!hypothesis) return response(404, { error_code: "workflow_hypothesis_not_found" });
  if (!tenantSafe(ops, actor.clinic_id, hypothesis)) {
    return response(403, { error_code: "tenant_scope_violation" });
  }

  const decision = await ops.findManagerDecision(
    actor.clinic_id,
    request.workflow_hypothesis_id
  );
  if (!decision) return response(409, { error_code: "manager_approval_required" });
  if (!tenantSafe(ops, actor.clinic_id, decision)) {
    return response(403, { error_code: "tenant_scope_violation" });
  }

  // A terminal CommitIntent is authoritative for retries. Check it before
  // re-planning because the first commit projects hypothesis.status=committed.
  const replayKey = managerExecutionIdempotencyKey(decision, hypothesis);
  if (replayKey) {
    const existingIntent = await ops.findCommitIntentByKey(actor.clinic_id, replayKey);
    if (existingIntent) {
      if (!tenantSafe(ops, actor.clinic_id, existingIntent)) {
        return response(403, { error_code: "tenant_scope_violation" });
      }
      if (existingIntent.status === "committed") {
        return response(200, {
          idempotent: true,
          commit: { outcome: "committed", idempotent: true, intent: existingIntent },
        });
      }
      if (existingIntent.status === "stale") {
        return response(409, {
          error_code: "stale_proposal",
          idempotent: true,
          commit: { outcome: "stale", idempotent: true, intent: existingIntent },
        });
      }
    }
  }

  const attentionItems = await ops.listAttentionByRun(
    actor.clinic_id,
    String(hypothesis.composition_run_id || "")
  );
  if (!attentionItems.every((item) => tenantSafe(ops, actor.clinic_id, item))) {
    return response(403, { error_code: "tenant_scope_violation" });
  }
  const attention = request.attention_item_id
    ? attentionItems.find((item) => item.id === request.attention_item_id)
    : attentionItems.find(
        (item) => item.selected_hypothesis_id === request.workflow_hypothesis_id
      );
  if (!attention) return response(409, { error_code: "selected_attention_item_required" });

  if (!requiredString(hypothesis.target_workflow_id)) {
    return response(409, { error_code: "commit_target_workflow_required" });
  }
  if (!requiredString(hypothesis.target_snapshot_id)) {
    return response(409, { error_code: "commit_target_snapshot_required" });
  }
  const [workflow, snapshot] = await Promise.all([
    ops.getWorkflow(hypothesis.target_workflow_id),
    ops.getSnapshot(hypothesis.target_snapshot_id),
  ]);
  if (!workflow) return response(404, { error_code: "workflow_not_found" });
  if (!snapshot) return response(404, { error_code: "workflow_snapshot_not_found" });
  if (
    !tenantSafe(ops, actor.clinic_id, workflow) ||
    !tenantSafe(ops, actor.clinic_id, snapshot)
  ) {
    return response(403, { error_code: "tenant_scope_violation" });
  }

  let plan: Record<string, any>;
  try {
    plan = ops.planAttachCommit({
      clinicId: actor.clinic_id,
      managerDecision: decision,
      attentionItem: attention,
      hypothesis,
      workflow,
      currentSnapshot: snapshot,
      now: ops.now(),
    });
  } catch (error) {
    const code = typeof (error as any)?.code === "string"
      ? (error as any).code
      : "commit_plan_invalid";
    if (code.includes("cross_tenant") || code.includes("missing_tenant")) {
      return response(403, { error_code: "tenant_scope_violation" });
    }
    if (
      code.startsWith("stale_proposal") ||
      code.includes("snapshot_mismatch") ||
      code.includes("version_mismatch")
    ) {
      return response(409, { error_code: "stale_proposal" });
    }
    return response(409, { error_code: code });
  }

  const lockKey = `manager-commit::${plan.manager_execution_idempotency_key}`;
  const owner = ops.newRunLockOwner(actor.user_id, lockKey);
  const lockNow = ops.now();
  const expiresAt = new Date(
    new Date(lockNow).getTime() + RUN_LOCK_LEASE_MS
  ).toISOString();
  const lock = await ops.acquireRunLock(
    actor.clinic_id, lockKey, owner, lockNow, expiresAt
  );
  if (!lock.acquired) {
    return response(409, { error_code: "commit_lock_busy", retryable: true });
  }

  try {
    const result = await ops.executeCommitSaga(plan, ops.now());
    if (result.outcome === "stale") {
      return response(409, {
        error_code: "stale_proposal",
        idempotent: result.idempotent === true,
        commit: result,
      });
    }
    return response(result.idempotent === true ? 200 : 201, {
      idempotent: result.idempotent === true,
      commit: result,
    });
  } catch {
    return response(500, { error_code: "commit_saga_failed" });
  } finally {
    await ops.releaseRunLock(actor.clinic_id, lockKey, owner).catch(() => undefined);
  }
}

async function run(
  ops: CompositionOps,
  request: ServiceRequest,
  actor: ActorContext
): Promise<ServiceResult> {
  let persistedRun: Record<string, unknown> | null = null;
  try {
    const descriptor = ops.buildRun({
      clinicId: actor.clinic_id,
      businessDate: request.business_date,
      slot: request.slot,
      triggerType: request.trigger_type || "manual",
      cutoffEventSeq: request.cutoff_event_seq,
      cutoffIngestedAt: request.cutoff_ingested_at ?? null,
      policyVersion: request.policy_version,
      promptVersion: request.prompt_version ?? null,
      modelVersion: request.model_version ?? null,
    });
    if (!tenantSafe(ops, actor.clinic_id, descriptor)) {
      return response(403, { error_code: "tenant_scope_violation" });
    }

    const key = descriptor.idempotency_key;
    if (!requiredString(key)) return response(500, { error_code: "idempotency_key_missing" });

    // Fast path for ordinary retries.
    const initialExisting = await ops.findRunByIdempotency(actor.clinic_id, key);
    if (initialExisting) {
      if (!tenantSafe(ops, actor.clinic_id, initialExisting)) {
        return response(403, { error_code: "tenant_scope_violation" });
      }
      return response(200, { idempotent: true, run: initialExisting });
    }

    // Concurrent retry protection: short CAS lease only surrounds recheck + create.
    // Pipeline execution happens after release, so long LLM calls do not hold the clinic lock.
    const owner = ops.newRunLockOwner(actor.user_id, key);
    const lockNow = ops.now();
    const expiresAt = new Date(
      new Date(lockNow).getTime() + RUN_LOCK_LEASE_MS
    ).toISOString();
    const lock = await ops.acquireRunLock(
      actor.clinic_id,
      key,
      owner,
      lockNow,
      expiresAt
    );
    if (!lock.acquired) {
      return response(409, {
        error_code: "run_lock_busy",
        retryable: true,
      });
    }

    try {
      // Required second check: another request may have created the run
      // between the fast-path lookup and our lock acquisition.
      const lockedExisting = await ops.findRunByIdempotency(actor.clinic_id, key);
      if (lockedExisting) {
        if (!tenantSafe(ops, actor.clinic_id, lockedExisting)) {
          return response(403, { error_code: "tenant_scope_violation" });
        }
        return response(200, { idempotent: true, run: lockedExisting });
      }
      persistedRun = await ops.createRun({
        ...descriptor,
        status: "running",
        run_started_at: ops.now(),
      });
      if (!requiredString(persistedRun.id)) {
        throw Object.assign(new Error("run_create_failed"), {
          code: "persistence_failed",
        });
      }
    } finally {
      await ops.releaseRunLock(actor.clinic_id, key, owner).catch(() => undefined);
    }

    const pipeline = await ops.executePipeline(request, actor, persistedRun);
    const hypothesisDescriptors = ops.buildHypotheses({
      clinicId: actor.clinic_id,
      compositionRunId: persistedRun.id,
      hypotheses: pipeline.hypotheses,
      guardrailResult: pipeline.guardrailResult,
    });
    const hypotheses = await ops.createHypotheses(hypothesisDescriptors);
    const dispatch = ops.deriveDispatch({
      guardrailResult: pipeline.guardrailResult,
      validationIssues: pipeline.validationIssues || [],
    });

    // Review visibility is independent from Guardrail ambiguity semantics:
    // every persisted pending_review hypothesis must be visible to a manager.
    // A unique best candidate is only a suggestion; it is never auto-selected,
    // approved, dispatched, or committed.
    let attention_item: Record<string, unknown> | null = null;
    const reviewRequired = hypotheses.some((item) => item.status === "pending_review");
    if (reviewRequired || dispatch.needsManagerDispatch) {
      const attentionDescriptor = ops.buildAttention({
        clinicId: actor.clinic_id,
        compositionRunId: persistedRun.id,
        artifactIds: pipeline.artifactIds || [],
        evidenceFactCardIds: pipeline.factCardIds || [],
        generatedAt: ops.now(),
        selectedHypothesisId: dispatch.bestHypothesisId,
        managerDispatchRequired: dispatch.needsManagerDispatch,
      });
      attention_item = await ops.createAttention(attentionDescriptor);
    }

    const completed = await ops.updateRun(String(persistedRun.id), {
      status: "completed",
      run_finished_at: ops.now(),
      proposals_generated: hypotheses.length,
      artifact_ids_processed: pipeline.artifactIds || [],
      error_code: null,
      error_message: null,
    });
    return response(201, {
      idempotent: false,
      run: completed,
      hypotheses,
      attention_item,
      dispatch,
    });
  } catch (error) {
    const failure = ops.buildFailure(error);
    if (persistedRun && requiredString(persistedRun.id)) {
      await ops
        .updateRun(String(persistedRun.id), {
          ...failure,
          run_finished_at: ops.now(),
        })
        .catch(() => undefined);
    }
    return response(500, {
      error_code:
        typeof failure.error_code === "string"
          ? failure.error_code
          : "composition_failed",
      run_id: persistedRun?.id || null,
    });
  }
}

export function createCompositionService(ops: CompositionOps) {
  if (!ops || typeof ops !== "object") throw new Error("CompositionOps required");
  return {
    async handle(request: ServiceRequest, actor: ActorContext): Promise<ServiceResult> {
      const rejection = authorized(ops, request, actor);
      if (rejection) return rejection;
      if (request.action === "interpret") return interpret(ops, request, actor);
      if (request.action === "run") return run(ops, request, actor);
      if (request.action === "query") return query(ops, request, actor);
      if (request.action === "listRuns") return listRuns(ops, request, actor);
      if (request.action === "review") return review(ops, request, actor);
      if (request.action === "commit") return commit(ops, request, actor);
      return response(400, { error_code: "action_invalid" });
    },
  };
}
