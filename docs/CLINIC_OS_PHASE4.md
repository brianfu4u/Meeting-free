# Clinic OS Phase 4 — Scheduled Rollout and Operations

> Baseline: Phase 3 frozen at main `bd2112822170f857b56bb14c750c62f904dc2f50`.

## Goal

Operate the Phase 3 composition agent safely across clinics: scheduled shadow runs, observable health, and reversible per-clinic rollout. Manager review remains mandatory; Phase 4 does not introduce automatic commit.

## Non-negotiable boundaries

- `clinic-001` remains disabled until an explicit rollout decision.
- No scheduler may run without: active clinic, explicit schedule enablement, non-disabled rollout state, valid timezone/slots, and an active published policy.
- Scheduled retries reuse the Phase 3 CompositionRun idempotency key.
- AI never creates ManagerDecision and never calls commit.
- Legacy `pipelineEngine trigger=compose` is not a production entry and will be disabled before scheduler activation.
- Every integration test uses `phase4-it-<uuid>` and deletes only recorded IDs; remaining count must be zero.

## Rollout states

| State | Scheduled runs | Manager review | Commit |
|---|---:|---:|---:|
| disabled | no | historical read-only | no |
| shadow | yes | yes | manager only |
| pilot | yes | yes | manager only |
| active | yes | yes | manager only |

State changes are configuration changes, not inference results.

## Batches

1. **B1 — Contract and feature flags**
   - ClinicConfig rollout/schedule fields.
   - Pure validation and eligibility logic.
   - Defaults remain disabled.
2. **B2 — Scheduled runner**
   - One platform schedule polls eligible clinics.
   - Per-clinic timezone/slot calculation.
   - Calls compositionOrchestrator `run`; never `review` or `commit`.
   - Idempotent retry and bounded concurrency.
3. **B3 — Operations**
   - Last success/failure, safe error codes, lag and stale-lock visibility.
   - Manager-facing health panel and retry guidance.
4. **B4 — Pilot and freeze**
   - Isolated E2E, then one explicitly approved pilot clinic.
   - Rollback is disabling the schedule flag; no data deletion.
   - CI, deployment evidence, and freeze record.

## B1 acceptance

- New fields default to disabled.
- Invalid timezone/slot/policy configuration cannot become eligible.
- No entity writes, scheduler calls, or production rollout during B1.
