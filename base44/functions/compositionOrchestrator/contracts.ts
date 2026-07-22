/**
 * Phase 3 compositionOrchestrator backend contracts.
 * Pure types only: safe to bundle in the Base44 function directory.
 */

export type CompositionAction = "interpret" | "run" | "query" | "listRuns" | "review" | "commit";
export type ReviewDecision = "select" | "reject" | "ignore";
export type ActorRole = "staff" | "admin";

export type ActorContext = {
  user_id: string;
  role: ActorRole;
  clinic_id: string;
};

export type ServiceRequest = {
  action: CompositionAction;
  clinic_id: string;
  artifact_id?: string;
  composition_run_id?: string;
  business_date?: string;
  slot?: string;
  trigger_type?: "manual" | "scheduled" | "manager_manual" | "cutoff_reconciliation";
  cutoff_event_seq?: number;
  cutoff_ingested_at?: string | null;
  policy_version?: number;
  prompt_version?: string | null;
  model_version?: string | null;
  limit?: number;
  include_hypothesis_summary?: boolean;
  workflow_hypothesis_id?: string;
  review_decision?: ReviewDecision;
  decision_note?: string | null;
  attention_item_id?: string;
  exception_artifact_id?: string;
};

export type ServiceResult = {
  ok: boolean;
  http_status: number;
  [key: string]: unknown;
};

export type PipelineResult = {
  hypotheses: unknown[];
  guardrailResult: Record<string, unknown>;
  validationIssues?: unknown[];
  artifactIds?: string[];
  factCardIds?: string[];
};

export type CompositionOps = {
  authorize: (input: { action: CompositionAction; role: ActorRole; clinicId: string }) => boolean;
  assertTenant: (clinicId: string, ...objects: unknown[]) => boolean;
  buildRun: (input: Record<string, unknown>) => Record<string, unknown>;
  buildHypotheses: (input: Record<string, unknown>) => Record<string, unknown>[];
  deriveDispatch: (input: Record<string, unknown>) => {
    needsManagerDispatch: boolean;
    bestHypothesisId: string | null;
  };
  buildAttention: (input: Record<string, unknown>) => Record<string, unknown>;
  buildFailure: (error: unknown) => Record<string, unknown>;

  getArtifact: (id: string) => Promise<Record<string, unknown> | null>;
  findFactCardByArtifact: (
    clinicId: string,
    artifactId: string
  ) => Promise<Record<string, unknown> | null>;
  interpretArtifact: (
    artifact: Record<string, unknown>,
    context: ActorContext
  ) => Promise<Record<string, unknown>>;
  createFactCard: (descriptor: Record<string, unknown>) => Promise<Record<string, unknown>>;

  findRunByIdempotency: (
    clinicId: string,
    idempotencyKey: string
  ) => Promise<Record<string, unknown> | null>;
  newRunLockOwner: (userId: string, idempotencyKey: string) => string;
  acquireRunLock: (
    clinicId: string,
    idempotencyKey: string,
    owner: string,
    now: string,
    expiresAt: string
  ) => Promise<{ acquired: boolean; reason?: string }>;
  releaseRunLock: (
    clinicId: string,
    idempotencyKey: string,
    owner: string
  ) => Promise<void>;
  createRun: (descriptor: Record<string, unknown>) => Promise<Record<string, unknown>>;
  updateRun: (id: string, patch: Record<string, unknown>) => Promise<Record<string, unknown>>;
  getRun: (id: string) => Promise<Record<string, unknown> | null>;
  listHypothesesByRun: (
    clinicId: string,
    runId: string
  ) => Promise<Record<string, unknown>[]>;
  listAttentionByRun: (
    clinicId: string,
    runId: string
  ) => Promise<Record<string, unknown>[]>;
  listRuns: (
    clinicId: string,
    filters: { business_date?: string; limit: number }
  ) => Promise<Record<string, unknown>[]>;
  listActiveHypothesisSummaries: (
    clinicId: string,
    runIds: string[],
    statuses: string[]
  ) => Promise<Record<string, { active_count: number; status_counts: Record<string, number> }>>;

  executePipeline: (
    request: ServiceRequest,
    actor: ActorContext,
    run: Record<string, unknown>
  ) => Promise<PipelineResult>;
  createHypotheses: (
    descriptors: Record<string, unknown>[]
  ) => Promise<Record<string, unknown>[]>;
  createAttention: (descriptor: Record<string, unknown>) => Promise<Record<string, unknown>>;

  getHypothesisByKey: (
    clinicId: string,
    workflowHypothesisId: string
  ) => Promise<Record<string, unknown> | null>;
  updateHypothesis: (
    id: string,
    patch: Record<string, unknown>
  ) => Promise<Record<string, unknown>>;
  findManagerExceptionDecision: (
    clinicId: string,
    artifactId: string
  ) => Promise<Record<string, unknown> | null>;
  getPublishedPolicy: (
    clinicId: string
  ) => Promise<Record<string, unknown> | null>;
  findManagerDecision: (
    clinicId: string,
    workflowHypothesisId: string
  ) => Promise<Record<string, unknown> | null>;
  createManagerDecision: (
    descriptor: Record<string, unknown>
  ) => Promise<Record<string, unknown>>;
  updateAttention: (
    id: string,
    patch: Record<string, unknown>
  ) => Promise<Record<string, unknown>>;

  findCommitIntentByKey: (
    clinicId: string,
    managerExecutionIdempotencyKey: string
  ) => Promise<Record<string, unknown> | null>;
  getWorkflow: (id: string) => Promise<Record<string, unknown> | null>;
  getSnapshot: (id: string) => Promise<Record<string, unknown> | null>;
  planAttachCommit: (input: Record<string, unknown>) => Record<string, any>;
  executeCommitSaga: (
    plan: Record<string, any>,
    now: string
  ) => Promise<Record<string, unknown>>;
  now: () => string;
};
