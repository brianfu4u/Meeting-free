// Base44 deployment trigger — commit replay 7f39bdf
import { createClientFromRequest } from "npm:@base44/sdk@0.8.38";
import { createCompositionService } from "./service.ts";
import {
  buildScheduledRunRequest,
  selectScheduledSlot,
} from "./runtime/schedulerCore.js";
import {
  buildSchedulerHealthPatch,
  sanitizeSchedulerErrorCode,
} from "./runtime/schedulerHealth.js";
// Base44's deploy parser can misclassify cross-file `import type` as a runtime import.
type ActorContext = { user_id: string; clinic_id: string; role: "staff" | "admin" };
type ServiceRequest = Record<string, any> & { clinic_id?: string };
type CompositionOps = Record<string, any>;
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
import {
  buildAttachmentLinkDescriptor,
  reconcileUndoFromAttachmentLink,
} from "./runtime/attachmentProjection.js";
import { executeAgentAutoAttachSaga } from "./runtime/agentAutoAttachSaga.js";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ ok: false, error_code: "method_not_allowed" }, { status: 405 });
  }

  try {
    const base44 = createClientFromRequest(req);
    const body = (await req.json().catch(() => ({}))) as ServiceRequest & {
      args?: { mode?: string };
    };

    // Phase 4 automation path. Server-side environment gates and a fixed
    // clinic allowlist are required before any service-role read or write.
    if (body?.args?.mode === "scheduled_scan") {
      const result = await handleScheduledScan(base44.asServiceRole);
      return Response.json(result, { status: result.http_status });
    }

    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ ok: false, error_code: "unauthenticated" }, { status: 401 });
    }

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

async function handleScheduledScan(svc: any) {
  const enabled = Deno.env.get("COMPOSITION_SCHEDULER_ENABLED") === "true";
  const allowlist = [
    ...new Set(
      (Deno.env.get("COMPOSITION_SCHEDULER_CLINICS") || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    ),
  ].slice(0, 10);

  // Fail closed before touching any entity.
  if (!enabled || allowlist.length === 0) {
    return {
      ok: true,
      http_status: 200,
      mode: "scheduled_scan",
      scheduler_enabled: false,
      scanned: 0,
      processed: 0,
      results: [],
    };
  }

  const now = new Date();
  const results = [];
  for (const clinicId of allowlist) {
    let config: any = null;
    try {
      const rows = await svc.entities.ClinicConfig.filter({ clinic_id: clinicId });
      config = rows?.[0] || null;
      const due = selectScheduledSlot({ config, now });
      if (!due.eligible) {
        results.push({
          clinic_id: clinicId,
          status: "skipped",
          reason: sanitizeSchedulerErrorCode(due.reason),
        });
        continue;
      }

      const artifacts = await svc.entities.Artifact.filter({
        clinic_id: clinicId,
        business_date: due.businessDate,
      });
      const prepared = buildScheduledRunRequest({ config, due, artifacts });
      if (!prepared.ok) {
        await persistSchedulerHealth(
          svc,
          config,
          buildSchedulerHealthPatch({
            now,
            status: "skipped",
            reason: prepared.reason,
            slot: due.slot,
          })
        );
        results.push({
          clinic_id: clinicId,
          slot: due.slot,
          status: "skipped",
          reason: sanitizeSchedulerErrorCode(prepared.reason),
        });
        continue;
      }

      const actor: ActorContext = {
        user_id: "phase4-scheduler",
        clinic_id: clinicId,
        role: "admin",
      };
      const outcome = await createCompositionService(makeOps(svc)).handle(
        prepared.request,
        actor
      );
      await persistSchedulerHealth(
        svc,
        config,
        buildSchedulerHealthPatch({ now, outcome, slot: due.slot })
      );
      results.push({
        clinic_id: clinicId,
        slot: due.slot,
        status: outcome.ok ? "processed" : "failed",
        http_status: outcome.http_status,
        idempotent: outcome.idempotent === true,
        run_id: outcome.run?.id || outcome.run_id || null,
        error_code: outcome.ok
          ? null
          : sanitizeSchedulerErrorCode(outcome.error_code),
      });
    } catch {
      if (config?.id) {
        await persistSchedulerHealth(
          svc,
          config,
          buildSchedulerHealthPatch({
            now,
            status: "failed",
            reason: "scheduler_failed",
          })
        );
      }
      results.push({
        clinic_id: clinicId,
        status: "failed",
        http_status: 500,
        error_code: "scheduler_failed",
      });
    }
  }

  return {
    ok: true,
    http_status: 200,
    mode: "scheduled_scan",
    scheduler_enabled: true,
    scanned: allowlist.length,
    processed: results.filter((item) => item.status === "processed").length,
    results,
  };
}

async function persistSchedulerHealth(svc: any, config: any, patch: any) {
  if (!config?.id) return false;
  try {
    await svc.entities.ClinicConfig.update(String(config.id), patch);
    return true;
  } catch {
    return false;
  }
}

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
  const agentAttachMode = () =>
    Deno.env.get("AGENT_AUTO_ATTACH_MODE") === "commit" ? "commit" : "observe";

  const createOrGetAttachmentLink = async (input: any) => {
    const descriptor = input?.idempotency_key
      ? input
      : buildAttachmentLinkDescriptor(input);
    const existing = await svc.entities.WorkflowArtifactLink.filter({
      clinic_id: descriptor.clinic_id,
      idempotency_key: descriptor.idempotency_key,
    });
    return existing?.[0] || svc.entities.WorkflowArtifactLink.create(descriptor);
  };

  const reconcileUndo = (link: any, now: string) =>
    reconcileUndoFromAttachmentLink({
      link,
      now,
      findPendingUndo: (clinicId: string, artifactId: string) =>
        svc.entities.UndoListItem.filter({
          clinic_id: clinicId,
          artifact_id: artifactId,
          status: "pending",
        }),
      updateUndo: (id: string, patch: any) =>
        svc.entities.UndoListItem.update(id, patch),
    });

  const executeAgentAttach = (request: any) =>
    executeAgentAutoAttachSaga({
      request,
      now: new Date().toISOString(),
      ops: {
        findIntent: async (clinicId: string, key: string) => {
          const rows = await svc.entities.AgentAttachIntent.filter({
            clinic_id: clinicId,
            idempotency_key: key,
          });
          return (rows || []).sort((a: any, b: any) =>
            String(a.created_date || a.id).localeCompare(
              String(b.created_date || b.id)
            )
          )[0] || null;
        },
        createIntent: (descriptor: any) =>
          svc.entities.AgentAttachIntent.create(descriptor),
        updateIntent: (id: string, patch: any) =>
          svc.entities.AgentAttachIntent.update(id, patch),
        getWorkflow: async (id: string) => {
          try {
            return await svc.entities.Workflow.get(id);
          } catch {
            return null;
          }
        },
        getSnapshot: async (id: string) => {
          try {
            return await svc.entities.WorkflowSnapshot.get(id);
          } catch {
            return null;
          }
        },
        createSnapshot: (descriptor: any) =>
          svc.entities.WorkflowSnapshot.create(descriptor),
        casWorkflowPointer: (filter: any, patch: any) =>
          svc.entities.Workflow.updateMany(filter, { $set: patch }),
        createOrGetAttachmentLink,
        reconcileUndoFromAttachmentLink: reconcileUndo,
        updateHypothesis: async (workflowHypothesisId: string, patch: any) => {
          const rows = await svc.entities.WorkflowHypothesis.filter({
            clinic_id: request.clinicId,
            workflow_hypothesis_id: workflowHypothesisId,
          });
          const row = rows?.[0];
          if (!row?.id) throw new Error("agent_attach_hypothesis_not_found");
          return svc.entities.WorkflowHypothesis.update(row.id, patch);
        },
      },
    });

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

      // 仅就绪证据卡（assembly_eligible=true）进入编组。
      // 无卡或未就绪→跳过，等待解析站产出合格卡后由后续 run 取货。
      // run 内不自行解析 Artifact（解析职责归解析站，见 agentHandoffContract）。
      const factCards = [];
      for (const artifact of artifacts) {
        const rows = await svc.entities.EvidenceFactCard.filter({
          clinic_id: actor.clinic_id,
          artifact_id: artifact.id,
          stale: false,
        });
        const card = rows?.[0] || null;
        if (card && card.assembly_eligible === true) {
          factCards.push(card);
        }
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

      const pipelineResult = await executeCompositionRuntime({
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

      // 次日回流：对本次 run 未产出有效 hypothesis 的就绪 FactCard，
      // 逐个生成 pending UndoListItem 供员工次日补充/移交。
      // 不催、不过期：无 due_date，pending 可无限期挂着，直至员工 resolve 或 attachment reconciliation 自动 resolve。
      const processedArtifactIds = new Set(
        (pipelineResult.artifactIds || []).filter((id: any) => typeof id === "string" && id)
      );
      const artifactById = new Map((artifacts || []).map((a: any) => [a.id, a]));
      const undoDispatch = deriveDispatchDecision({
        guardrailResult: pipelineResult.guardrailResult,
        validationIssues: (pipelineResult.validationIssues || []),
      });
      const unmatchedReasonCodes = undoDispatch.llmAuditReasonCodes || [];
      const undoItemsCreated: string[] = [];
      for (const card of factCards) {
        if (processedArtifactIds.has(card.artifact_id)) continue;
        const existing = await svc.entities.UndoListItem.filter({
          clinic_id: actor.clinic_id,
          artifact_id: card.artifact_id,
          status: "pending",
        });
        if (existing && existing.length > 0) continue;
        const artifact = artifactById.get(card.artifact_id);
        const created = await svc.entities.UndoListItem.create({
          clinic_id: actor.clinic_id,
          artifact_id: card.artifact_id,
          original_uploader_id: artifact?.source_staff_id || null,
          idempotency_key: `${actor.clinic_id}::${card.artifact_id}`,
          business_date: request.business_date,
          bounced_at: new Date().toISOString(),
          bounce_reason: "not_assembled_by_cutoff",
          status: "pending",
          fact_card_id: card.id,
          unmatched_reason_codes: unmatchedReasonCodes,
          created_by_run_id: String(run.id),
        });
        undoItemsCreated.push(String(created.id));
      }

      return { ...pipelineResult, undoItemsCreated };
    },
    createHypotheses: async (descriptors) => {
      const created = [];
      for (const descriptor of descriptors) {
        created.push(await svc.entities.WorkflowHypothesis.create(descriptor));
      }
      return created;
    },
    createAttention: (descriptor) => svc.entities.AttentionItem.create(descriptor),
    executeAgentAutoAttach: executeAgentAttach,
    agentAutoAttachMode: agentAttachMode,
    recordAgentAutoAttachObservation: async (request) => {
      const key = `${request.clinicId}::${request.hypothesisId}`;
      const rows = await svc.entities.AgentAttachIntent.filter({
        clinic_id: request.clinicId,
        idempotency_key: key,
      });
      const existing = (rows || []).sort((a: any, b: any) =>
        String(a.created_date || a.id).localeCompare(
          String(b.created_date || b.id)
        )
      )[0];
      if (existing) {
        return {
          outcome: existing.status === "committed" ? "committed" : "observed",
          idempotent: true,
          intent: existing,
        };
      }
      const intent = await svc.entities.AgentAttachIntent.create({
        clinic_id: request.clinicId,
        idempotency_key: key,
        composition_run_id: request.runId,
        workflow_hypothesis_id: request.hypothesisId,
        target_workflow_id: request.workflowId,
        artifact_ids: [...new Set(request.artifactIds || [])],
        status: "observed",
        decision_source: "agent_autonomous",
        retry_count: 0,
        created_at: new Date().toISOString(),
        reconciliation: {
          last_step: "eligibility_observed",
          pending_compensation: [],
        },
      });
      return { outcome: "observed", idempotent: false, intent };
    },
    resumeAgentAutoAttachForRun: async (run, policyVersion) => {
      if (!run?.id || !run?.clinic_id) return null;
      const intents = await svc.entities.AgentAttachIntent.filter({
        clinic_id: run.clinic_id,
        composition_run_id: run.id,
      });
      const intent = (intents || [])
        .sort((a: any, b: any) =>
          String(a.created_date || a.id).localeCompare(
            String(b.created_date || b.id)
          )
        )[0];
      if (!intent) return null;
      const hypotheses = await svc.entities.WorkflowHypothesis.filter({
        clinic_id: run.clinic_id,
        workflow_hypothesis_id: intent.workflow_hypothesis_id,
      });
      const hypothesis = hypotheses?.[0];
      if (!hypothesis) throw new Error("agent_attach_recovery_hypothesis_not_found");
      if (agentAttachMode() !== "commit") {
        return { outcome: "observed", idempotent: true, intent };
      }
      return executeAgentAttach({
        clinicId: run.clinic_id,
        runId: run.id,
        hypothesisId: intent.workflow_hypothesis_id,
        sourceProposalId: hypothesis.source_proposal_id,
        workflowId: intent.target_workflow_id,
        artifactIds: intent.artifact_ids,
        policyVersion,
      });
    },

    getHypothesisByKey: async (clinicId, workflowHypothesisId) => {
      const rows = await svc.entities.WorkflowHypothesis.filter({
        clinic_id: clinicId,
        workflow_hypothesis_id: workflowHypothesisId,
      });
      return rows?.[0] || null;
    },
    updateHypothesis: (id, patch) =>
      svc.entities.WorkflowHypothesis.update(id, patch),
    findManagerExceptionDecision: async (clinicId, artifactId) => {
      const rows = await svc.entities.ManagerDecision.filter({
        clinic_id: clinicId,
        target_type: "artifact_exception",
        target_id: artifactId,
      });
      return (rows || []).sort((x: any, y: any) =>
        String(x.created_date || x.id).localeCompare(String(y.created_date || y.id))
      )[0] || null;
    },
    getPublishedPolicy: async (clinicId) => {
      const rows = await svc.entities.GuessPolicy.filter({
        clinic_id: clinicId,
        status: "published",
      });
      return (rows || []).sort((x: any, y: any) =>
        Number(y.policy_version || 0) - Number(x.policy_version || 0)
      )[0] || null;
    },
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

    findCommitIntentByKey: async (clinicId, key) => {
      const rows = await svc.entities.WorkflowCommitIntent.filter({
        clinic_id: clinicId,
        manager_execution_idempotency_key: key,
      });
      return (rows || []).sort((x: any, y: any) =>
        String(x.created_date || x.id).localeCompare(String(y.created_date || y.id))
      )[0] || null;
    },

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
          createOrGetAttachmentLink,
          reconcileUndoFromAttachmentLink: reconcileUndo,
        },
      });
    },
    now: () => new Date().toISOString(),
  };
}