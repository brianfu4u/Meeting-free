import type {
  ActorContext,
  CompositionOps,
  ServiceRequest,
  ServiceResult,
} from "./contracts.ts";

const ACTIONS = new Set(["interpret", "run", "query", "listRuns"]);
const ACTIVE_HYPOTHESIS_STATUSES = ["pending_review", "selected", "dispatched"];
const RUN_LOCK_LEASE_MS = 30_000;

function response(http_status: number, body: Record<string, unknown>): ServiceResult {
  return { ok: http_status >= 200 && http_status < 300, http_status, ...body };
}

function requiredString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
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
    const existing = await ops.findRunByIdempotency(actor.clinic_id, key);
    if (existing) {
      if (!tenantSafe(ops, actor.clinic_id, existing)) {
        return response(403, { error_code: "tenant_scope_violation" });
      }
      return response(200, { idempotent: true, run: existing });
    }

    persistedRun = await ops.createRun({ ...descriptor, status: "running", run_started_at: ops.now() });
    if (!requiredString(persistedRun.id)) {
      throw Object.assign(new Error("run_create_failed"), { code: "persistence_failed" });
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

    let attention_item: Record<string, unknown> | null = null;
    if (dispatch.needsManagerDispatch) {
      const attentionDescriptor = ops.buildAttention({
        clinicId: actor.clinic_id,
        compositionRunId: persistedRun.id,
        artifactIds: pipeline.artifactIds || [],
        evidenceFactCardIds: pipeline.factCardIds || [],
        generatedAt: ops.now(),
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
      await ops.updateRun(String(persistedRun.id), {
        ...failure,
        run_finished_at: ops.now(),
      }).catch(() => undefined);
    }
    return response(500, {
      error_code:
        typeof failure.error_code === "string" ? failure.error_code : "composition_failed",
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
      return response(400, { error_code: "action_invalid" });
    },
  };
}
