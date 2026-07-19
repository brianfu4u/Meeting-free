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


## B2 implementation

The scheduled scan is configured in
`base44/functions/compositionOrchestrator/function.jsonc` at a five-minute
interval, but ships with `is_active: false`.

It remains fail-closed even if the automation is manually invoked:

1. `COMPOSITION_SCHEDULER_ENABLED` must equal `true`.
2. `COMPOSITION_SCHEDULER_CLINICS` must contain an explicit comma-separated
   clinic allowlist (maximum 10).
3. Each allowlisted ClinicConfig must independently be active, have
   `composition_schedule_enabled=true`, a non-disabled rollout status, a
   valid timezone/schedule/grace window, and a published policy version.
4. A due slot with no artifact watermark is skipped.
5. The generated request is always `action=run` and
   `trigger_type=scheduled`; review and commit remain human-only.
6. CompositionRun idempotency remains the authority for retry safety.

Neither environment variable is configured by source control. Production or
pilot activation requires a separate explicit operator action.


## B3 operations health

Batch 3 adds read-only operational visibility without activating the scheduler.

- ClinicConfig stores only allowlisted scheduler outcome codes, the latest run/slot,
  and separate success/failure timestamps. Raw provider or exception messages are
  never persisted.
- Each allowlisted clinic is isolated during a scheduled scan; one clinic failure
  cannot abort the remaining bounded scan.
- Expired CompositionRun leases are surfaced as stale locks. Active leases are
  reported as busy and are never force-released by the UI.
- The manager review surface shows rollout state, recent success/failure, lag,
  safe error code, and fixed retry guidance.
- The health panel is read-only. It cannot create ManagerDecision, call review,
  or call commit.
- Scheduler automation remains inactive and source control does not configure
  either environment gate or any clinic allowlist.
