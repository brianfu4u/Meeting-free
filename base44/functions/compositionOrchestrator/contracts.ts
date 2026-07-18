/**
 * Phase 3 compositionOrchestrator backend contracts.
 * Pure types only: safe to bundle in the Base44 function directory.
 */

export type CompositionAction = "interpret" | "run" | "query" | "listRuns";
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
  trigger_type?: "manual" | "scheduled";
  cutoff_event_seq?: number;
  cutoff_ingested_at?: string | null;
  policy_version?: number;
  prompt_version?: string | null;
  model_version?: string | null;
  limit?: number;
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
  createRun: (descriptor: Record<string, unknown>) => Promise<Record<string, unknown>>;
  updateRun: (id: string, patch: Record<string, unknown>) => Promise<Record<string, unknown>>;
  getRun: (id: string) => Promise<Record<string, unknown> | null>;
  listRuns: (
    clinicId: string,
    filters: { business_date?: string; limit: number }
  ) => Promise<Record<string, unknown>[]>;

  executePipeline: (
    request: ServiceRequest,
    actor: ActorContext,
    run: Record<string, unknown>
  ) => Promise<PipelineResult>;
  createHypotheses: (
    descriptors: Record<string, unknown>[]
  ) => Promise<Record<string, unknown>[]>;
  createAttention: (descriptor: Record<string, unknown>) => Promise<Record<string, unknown>>;
  now: () => string;
};
