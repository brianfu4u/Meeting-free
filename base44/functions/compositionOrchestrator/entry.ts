// Base44 deployment trigger — Phase 3 attach commit runtime (redeploy e3d9a0b)
import { createClientFromRequest } from "npm:@base44/sdk@0.8.38";
import { createCompositionService } from "./service.ts";
import type { ActorContext, CompositionOps, ServiceRequest } from "./contracts.ts";
import {
  buildAttentionDescriptor,
  buildHypothesisDescriptors,
  buildRunDescriptor,
  buildRunFailure,
  deriveDispatchDecision,
  authorizeAction,
  assertTenantScope,
} from "./runtime/orchestratorCore.js";
import {
  executeCompositionRuntime,
  interpretArtifactRuntime,
} from "./runtimeAdapter.ts";
import {
  executeAttachCommitSagaRuntime,
  planAttachCommitRuntime,
} from "./runtime/commitRuntime.js";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ ok: false, error_code: "method_not_allowed" }, { status: 405 });
  }

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ ok: false, error_code: "unauthenticated" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as ServiceRequest;
    const clinicId = typeof body.clinic_id === "string" ? body.clinic_id : "";
    const actor = await resolveActor(base44.asServiceRole, user, clinicId);
    if (!actor) {
      return Response.json(
        { ok: false, error_code: "tenant_scope_violation" },
        { status: 403 }
      );
    }

    const ops = makeOps(base44.asServiceRole);
    const result = await createCompositionService(ops).handle(body, actor);
    return Response.json(result, { status: result.http_status });
  } catch {
    return Response.json(
      { ok: false, error_code: "composition_orchestrator_failed" },
      { status: 500 }
    );
  }
});

async function resolveActor(svc: any, user: any, clinicId: string): Promise<ActorContext | null> {
  if (!clinicId || !user?.id) return null;
  const configs = await svc.entities.ClinicConfig.filter({ clinic_id: clinicId });
  const config = configs?.[0];
  if (!config) return null;

  const staffRows = await svc.entities.Staff.filter({
    clinic_id: clinicId,
    user_id: user.id,
  });
  const staff = staffRows?.[0] || null;
  if (staff) {
    return {
      user_id: user.id,
      clinic_id: clinicId,
      role: config.manager_id === staff.id ? "admin" : "staff",
    };
  }

  // Compatibility for installations whose ClinicConfig.manager_id directly stores User.id.
  if (user.role === "admin" && config.manager_id === user.id) {
    return { user_id: user.id, clinic_id: clinicId, role: "admin" };
  }
  return null;
}

function makeOps(svc: any): CompositionOps {
  const invokeLLM = (input: any) =>
    svc.integrations.Core.InvokeLLM({ ...input, model: input.model || "automatic" });

  return {
    authorize: ({ action, role, clinicId }) => {
      try {
        return authorizeAction({ action, role, clinicId }) === true;
      } catch {
        return false;
      }
    },
    assertTenant: (clinicId, ...objects) => {
      try {
        return assertTenantScope(clinicId, ...objects) === true;
      } catch {
        return false;
      }
    },
    buildRun: buildRunDescriptor,
    buildHypotheses: buildHypothesisDescriptors,
    deriveDispatch: deriveDispatchDecision,
    buildAttention: buildAttentionDescriptor,
    buildFailure: buildRunFailure,

    getArtifact: async (id) => {
      try {
        return await svc.entities.Artifact.get(id);
      } catch {
        return null;
      }
    },
    findFactCardByArtifact: async (clinicId, artifactId) => {
      const rows = await svc.entities.EvidenceFactCard.filter({
        clinic_id: clinicId,
        artifact_id: artifactId,
        stale: false,
      });
      return rows?.[0] || null;
    },
    interpretArtifact: async (artifact, actor) => {
      const configs = await svc.entities.ClinicConfig.filter({ clinic_id: actor.clinic_id });
      const policyVersion = configs?.[0]?.active_policy_version ?? null;
      return interpretArtifactRuntime({
        artifact,
        policyVersion,
        invokeLLM,
      });
    },
    createFactCard: async (descriptor) => {
      const created = await svc.entities.EvidenceFactCard.create(descriptor);
      if (descriptor.artifact_id) {
        await svc.entities.Artifact.update(String(descriptor.artifact_id), {
          interpreted: true,
          evidence_fact_card_id: created.id,
        });
      }
      return created;
    },

    findRunByIdempotency: async (clinicId, idempotencyKey) => {
      const rows = await svc.entities.CompositionRun.filter({
        clinic_id: clinicId,
        idempotency_key: idempotencyKey,
      });
      return (rows || []).sort((a: any, b: any) =>
        String(a.created_date || a.id).localeCompare(String(b.created_date || b.id))
      )[0] || null;
    },
    newRunLockOwner: (userId, idempotencyKey) =>
      `run-lock::${userId}::${idempotencyKey}::${crypto.randomUUID()}`,
    acquireRunLock: async (clinicId, idempotencyKey, owner, now, expiresAt) => {
      try {
        const first = await svc.entities.ClinicConfig.updateMany(
          { clinic_id: clinicId, composition_run_lock_owner_id: null },
          {
            $set: {
              composition_run_lock_key: idempotencyKey,
              composition_run_lock_owner_id: owner,
              composition_run_lock_acquired_at: now,
              composition_run_lock_expires_at: expiresAt,
            },
          }
        );
        if (first?.updated === 1) return { acquired: true };
      } catch {
        // Continue to expired-lease takeover.
      }

      const rows = await svc.entities.ClinicConfig.filter({ clinic_id: clinicId });
      const config = rows?.[0];
      if (
        config?.composition_run_lock_owner_id &&
        config?.composition_run_lock_expires_at &&
        new Date(config.composition_run_lock_expires_at).getTime() < Date.now()
      ) {
        const takeover = await svc.entities.ClinicConfig.updateMany(
          {
            clinic_id: clinicId,
            composition_run_lock_key: config.composition_run_lock_key,
            composition_run_lock_owner_id: config.composition_run_lock_owner_id,
            composition_run_lock_expires_at: config.composition_run_lock_expires_at,
          },
          {
            $set: {
              composition_run_lock_key: idempotencyKey,
              composition_run_lock_owner_id: owner,
              composition_run_lock_acquired_at: now,
              composition_run_lock_expires_at: expiresAt,
            },
          }
        );
        if (takeover?.updated === 1) return { acquired: true, reason: "expired_takeover" };
      }
      return { acquired: false, reason: "lock_busy" };
    },
    releaseRunLock: async (clinicId, idempotencyKey, owner) => {
      await svc.entities.ClinicConfig.updateMany(
        {
          clinic_id: clinicId,
          composition_run_lock_key: idempotencyKey,
          composition_run_lock_owner_id: owner,
        },
        {
          $set: {
            composition_run_lock_key: null,
            composition_run_lock_owner_id: null,
            composition_run_lock_acquired_at: null,
            composition_run_lock_expires_at: null,
          },
        }
      );
    },
    createRun: (descriptor) => svc.entities.CompositionRun.create(descriptor),
    updateRun: (id, patch) => svc.entities.CompositionRun.update(id, patch),
    getRun: async (id) => {
      try {
        return await svc.entities.CompositionRun.get(id);
      } catch {
        return null;
      }
    },
    listHypothesesByRun: (clinicId, runId) =>
      svc.entities.WorkflowHypothesis.filter({
        clinic_id: clinicId,
        composition_run_id: runId,
      }),
    listAttentionByRun: (clinicId, runId) =>
      svc.entities.AttentionItem.filter({
        clinic_id: clinicId,
        composition_run_id: runId,
      }),
    listRuns: async (clinicId, filters) => {
      const query: any = { clinic_id: clinicId };
      if (filters.business_date) query.business_date = filters.business_date;
      const rows = await svc.entities.CompositionRun.filter(query);
      return (rows || [])
        .sort((a: any, b: any) =>
          String(b.run_started_at || b.created_date || "").localeCompare(
            String(a.run_started_at || a.created_date || "")
          )
        )
        .slice(0, filters.limit);
    },
    listActiveHypothesisSummaries: async (clinicId, runIds, statuses) => {
      const output: Record<string, any> = {};
      await Promise.all(
        runIds.map(async (runId) => {
          const rows = await svc.entities.WorkflowHypothesis.filter({
            clinic_id: clinicId,
            composition_run_id: runId,
          });
          const active = (rows || []).filter((item: any) => statuses.includes(item.status));
          const statusCounts: Record<string, number> = {};
          for (const item of active) {
            statusCounts[item.status] = (statusCounts[item.status] || 0) + 1;
          }
          output[runId] = {
            active_count: active.length,
            status_counts: statusCounts,
          };
        })
      );
      return output;
    },

    executePipeline: async (request, actor, run) => {
      const allArtifacts = await svc.entities.Artifact.filter({
        clinic_id: actor.clinic_id,
        business_date: request.business_date,
      });
      const artifacts = (allArtifacts || []).filter(
        (item: any) =>
          item.ingestion_seq == null ||
          Number(item.ingestion_seq) <= Number(request.cutoff_event_seq)
      );

      const factCards = [];
      for (const artifact of artifacts) {
        let rows = await svc.entities.EvidenceFactCard.filter({
          clinic_id: actor.clinic_id,
          artifact_id: artifact.id,
          stale: false,
        });
        let card = rows?.[0] || null;
        if (!card) {
          const interpreted = await interpretArtifactRuntime({
            artifact,
            policyVersion: request.policy_version,
            invokeLLM,
          });
          card = await svc.entities.EvidenceFactCard.create({
            ...interpreted,
            clinic_id: actor.clinic_id,
            artifact_id: artifact.id,
          });
          await svc.entities.Artifact.update(artifact.id, {
            interpreted: true,
            evidence_fact_card_id: card.id,
          });
        }
        factCards.push(card);
      }

      const [workflows, snapshots, policies, committed] = await Promise.all([
        svc.entities.Workflow.filter({ clinic_id: actor.clinic_id }),
        svc.entities.WorkflowSnapshot.filter({ clinic_id: actor.clinic_id }),
        svc.entities.GuessPolicy.filter({
          clinic_id: actor.clinic_id,
          policy_version: request.policy_version,
          status: "published",
        }),
        svc.entities.WorkflowHypothesis.filter({
          clinic_id: actor.clinic_id,
          status: "committed",
        }),
      ]);
      const committedArtifactIds = [
        ...new Set((committed || []).flatMap((item: any) => item.ordered_artifact_ids || [])),
      ];

      return executeCompositionRuntime({
        clinicId: actor.clinic_id,
        compositionRunId: String(run.id),
        policyVersion: Number(request.policy_version),
        artifacts,
        factCards,
        workflows,
        snapshots,
        guessPolicy: policies?.[0] || {},
        invokeLLM,
        committedArtifactIds,
        now: Date.now(),
      });
    },
    createHypotheses: async (descriptors) => {
      const created = [];
      for (const descriptor of descriptors) {
        created.push(await svc.entities.WorkflowHypothesis.create(descriptor));
      }
      return created;
    },
    createAttention: (descriptor) => svc.entities.AttentionItem.create(descriptor),

    getHypothesisByKey: async (clinicId, workflowHypothesisId) => {
      const rows = await svc.entities.WorkflowHypothesis.filter({
        clinic_id: clinicId,
        workflow_hypothesis_id: workflowHypothesisId,
      });
      return rows?.[0] || null;
    },
    updateHypothesis: (id, patch) =>
      svc.entities.WorkflowHypothesis.update(id, patch),
    findManagerDecision: async (clinicId, workflowHypothesisId) => {
      const rows = await svc.entities.ManagerDecision.filter({
        clinic_id: clinicId,
        target_type: "hypothesis",
        target_id: workflowHypothesisId,
      });
      return (rows || []).sort((x: any, y: any) =>
        String(x.created_date || x.id).localeCompare(String(y.created_date || y.id))
      )[0] || null;
    },
    createManagerDecision: (descriptor) =>
      svc.entities.ManagerDecision.create(descriptor),
    updateAttention: (id, patch) =>
      svc.entities.AttentionItem.update(id, patch),

    getWorkflow: async (id) => {
      try {
        return await svc.entities.Workflow.get(id);
      } catch {
        return null;
      }
    },
    getSnapshot: async (id) => {
      try {
        return await svc.entities.WorkflowSnapshot.get(id);
      } catch {
        return null;
      }
    },
    planAttachCommit: planAttachCommitRuntime,
    executeCommitSaga: (plan, now) => {
      const clinicId = String(plan?.intent_descriptor?.clinic_id || "");
      return executeAttachCommitSagaRuntime({
        plan,
        now,
        ops: {
          findIntentByKey: async (key) => {
            const rows = await svc.entities.WorkflowCommitIntent.filter({
              clinic_id: clinicId,
              manager_execution_idempotency_key: key,
            });
            return (rows || []).sort((x: any, y: any) =>
              String(x.created_date || x.id).localeCompare(String(y.created_date || y.id))
            )[0] || null;
          },
          createIntent: (descriptor) =>
            svc.entities.WorkflowCommitIntent.create(descriptor),
          updateIntent: (id, patch) =>
            svc.entities.WorkflowCommitIntent.update(id, patch),
          createSnapshot: (descriptor) =>
            svc.entities.WorkflowSnapshot.create(descriptor),
          getWorkflow: async (id) => {
            try {
              return await svc.entities.Workflow.get(id);
            } catch {
              return null;
            }
          },
          casWorkflowPointer: (filter, patch) =>
            svc.entities.Workflow.updateMany(filter, { $set: patch }),
          updateHypothesis: async (workflowHypothesisId, patch) => {
            const rows = await svc.entities.WorkflowHypothesis.filter({
              clinic_id: clinicId,
              workflow_hypothesis_id: workflowHypothesisId,
            });
            const row = rows?.[0];
            if (!row?.id) throw Object.assign(new Error("hypothesis_not_found"), {
              code: "projection_update_failed",
            });
            return svc.entities.WorkflowHypothesis.update(row.id, patch);
          },
          updateAttention: (id, patch) =>
            svc.entities.AttentionItem.update(id, patch),
          updateManagerDecision: (id, patch) =>
            svc.entities.ManagerDecision.update(id, patch),
        },
      });
    },
    now: () => new Date().toISOString(),
  };
}