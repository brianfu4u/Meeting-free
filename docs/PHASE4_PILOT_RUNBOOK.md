# Phase 4 Pilot Runbook

This runbook is an operator checklist. It does not authorize a clinic rollout.

## Current state

- The platform automation remains inactive in source control.
- No scheduler environment variables or clinic allowlist are configured.
- No clinic is approved by this document.
- `clinic-001` requires a separate explicit approval naming that clinic.

## Isolated E2E

Use a new tenant id matching `phase4-it-<uuid>`. Record every created Entity id.

1. Create only the minimum isolated ClinicConfig, Staff, published GuessPolicy,
   Artifact and EvidenceFactCard fixtures.
2. Set the isolated clinic to `pilot` and enable its schedule.
3. Configure the server environment gates with only the isolated clinic.
4. Activate the automation or invoke its scheduled payload once.
5. Verify one scheduled CompositionRun, idempotent replay with zero growth,
   health timestamps and safe error codes.
6. Verify WorkflowHypothesis remains pending manager review.
7. Verify no ManagerDecision, WorkflowCommitIntent, WorkflowSnapshot or Workflow
   is created by the scheduler.
8. Roll back first: disable the clinic schedule and remove it from the allowlist.
9. Delete only the recorded isolated fixture ids and verify all residual counts are zero.
10. Perform read-only counts for `clinic-001`; never use it as the isolation target.

## Pilot activation order

A real pilot requires the owner to name one exact clinic id in writing.

1. Capture a baseline count and current ClinicConfig.
2. Run `evaluatePilotReadiness`; every blocker must be cleared.
3. Add only the approved clinic to `COMPOSITION_SCHEDULER_CLINICS`.
4. Set `COMPOSITION_SCHEDULER_ENABLED=true`.
5. Apply the minimal activation patch to that clinic.
6. Activate the platform automation.
7. Observe one complete slot before expanding or changing anything.

## Rollback

Rollback is configuration-only:

```json
{
  "composition_schedule_enabled": false,
  "composition_rollout_status": "disabled"
}
```

Then remove the clinic from the environment allowlist. Do not delete runs,
hypotheses, snapshots or audit records. An in-flight run may finish, but no new
scheduled slot should begin.
