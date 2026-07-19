# Phase 4 Pilot Runbook

This runbook is an operator checklist. It does not authorize a clinic rollout.

## Current state

- The platform automation remains inactive in source control.
- Scheduler secrets are not left configured after an isolated pilot.
- No clinic is approved by this document.
- `clinic-001` requires a separate explicit approval naming that clinic.

## Manual isolated E2E

Use `scripts/phase4-isolated-e2e.mjs` for the non-scheduler runtime path:

```bash
cat scripts/phase4-isolated-e2e.mjs | npx base44@latest exec
```

It creates a randomized `phase4-it-<uuid>` tenant, verifies run/replay and
the explicit human-review contract, then cleans its exact fixture ids.

## Isolated scheduler pilot

The only approved scheduler smoke target is a newly generated
`phase4-it-scheduler-<uuid>` tenant. The wrapper refuses to run if either
scheduler secret already exists, so it cannot overwrite a real deployment.

Preflight:

```bash
git pull origin main
npx base44@latest whoami
npx base44@latest secrets list
```

Run once from the linked repository root:

```bash
bash scripts/phase4-scheduler-pilot.sh
```

The wrapper performs this fixed sequence:

1. Generate one random test clinic id; `clinic-001` is hard-blocked.
2. Create only the minimum ClinicConfig, Staff, published GuessPolicy,
   Artifact and EvidenceFactCard fixtures.
3. Set `COMPOSITION_SCHEDULER_ENABLED=true` and set
   `COMPOSITION_SCHEDULER_CLINICS` to that single random clinic.
4. Invoke the scheduled payload once, then once more as an idempotent replay.
5. Verify exactly one completed scheduled CompositionRun, pending hypotheses,
   scheduler health, released lock and zero authoritative workflow side effects.
6. Roll back the two secrets first. Base44 automatically redeploys functions
   that reference changed secrets.
7. Delete only exact ids discovered under the random test tenant and verify all
   12 entity counts are zero.

The EXIT/INT/TERM trap applies the same rollback order after a failure:
**secrets first, fixture cleanup second**. Do not interrupt the Codespace until
the rollback output is visible. If the terminal is lost, immediately run:

```bash
npx base44@latest secrets delete COMPOSITION_SCHEDULER_ENABLED COMPOSITION_SCHEDULER_CLINICS
```

Then rerun cleanup with the exact random clinic id shown by the pilot:

```bash
export PHASE4_TEST_CLINIC_ID='phase4-it-scheduler-<uuid>'
export PHASE4_PILOT_MODE=cleanup
cat scripts/phase4-scheduler-pilot.mjs | npx base44@latest exec
```

Finally, confirm the two scheduler secret names are absent:

```bash
npx base44@latest secrets list
```

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
