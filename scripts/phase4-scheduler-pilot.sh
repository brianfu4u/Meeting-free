#!/usr/bin/env bash
# Phase 4 one-clinic isolated scheduler pilot.
# This wrapper temporarily owns exactly two Base44 secrets, invokes the
# scheduled payload twice (first + idempotent replay), rolls secrets back first,
# then deletes only records in its randomized phase4-it-scheduler-* tenant.

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER="$ROOT_DIR/scripts/phase4-scheduler-pilot.mjs"
ENABLED_SECRET="COMPOSITION_SCHEDULER_ENABLED"
ALLOWLIST_SECRET="COMPOSITION_SCHEDULER_CLINICS"

cd "$ROOT_DIR"

base44_cli() {
  npx base44@latest "$@"
}

if [[ ! -f "$HELPER" || ! -f "base44/.app.jsonc" ]]; then
  echo "phase4_scheduler_pilot_preflight_failed: run from the linked repository root" >&2
  exit 1
fi

base44_cli whoami >/dev/null

existing_secrets="$(base44_cli secrets list)"
if grep -Eq "(^|[^A-Z0-9_])(${ENABLED_SECRET}|${ALLOWLIST_SECRET})([^A-Z0-9_]|$)" <<<"$existing_secrets"; then
  echo "phase4_scheduler_pilot_preflight_failed: scheduler secret already exists; refusing to overwrite it" >&2
  exit 1
fi

PHASE4_TEST_CLINIC_ID="phase4-it-scheduler-$(node -e 'console.log(require("node:crypto").randomUUID())')"
export PHASE4_TEST_CLINIC_ID
SECRETS_MAY_EXIST=0
FIXTURE_MAY_EXIST=0

run_helper() {
  cat "$HELPER" | base44_cli exec
}

rollback() {
  local failed=0
  set +e

  # Environment rollback MUST happen before any test-data cleanup.
  if [[ "$SECRETS_MAY_EXIST" -eq 1 ]]; then
    echo "Rolling back scheduler secrets before fixture cleanup..."
    base44_cli secrets delete "$ENABLED_SECRET" || failed=1
    base44_cli secrets delete "$ALLOWLIST_SECRET" || failed=1
    SECRETS_MAY_EXIST=0
  fi

  if [[ "$FIXTURE_MAY_EXIST" -eq 1 ]]; then
    echo "Cleaning exact records in $PHASE4_TEST_CLINIC_ID..."
    export PHASE4_PILOT_MODE="cleanup"
    unset PHASE4_SCAN_EXPECTATION || true
    run_helper || failed=1
    FIXTURE_MAY_EXIST=0
  fi

  set -e
  return "$failed"
}

on_exit() {
  local status=$?
  trap - EXIT INT TERM
  rollback || status=1
  exit "$status"
}
trap on_exit EXIT INT TERM

echo "Phase 4 isolated scheduler pilot clinic: $PHASE4_TEST_CLINIC_ID"
FIXTURE_MAY_EXIST=1
export PHASE4_PILOT_MODE="setup"
run_helper

# Mark ownership before setting secrets so a partially successful CLI call is
# still rolled back by the trap.
SECRETS_MAY_EXIST=1
base44_cli secrets set   "$ENABLED_SECRET=true"   "$ALLOWLIST_SECRET=$PHASE4_TEST_CLINIC_ID"

# Base44 rolls out changed secrets asynchronously across function instances.
# Both the first scan and its idempotent replay may briefly hit an old instance.
# Retry only scheduler_not_enabled; every other failure stops immediately.
run_scan_with_redeploy_wait() {
  local expectation="$1"
  local scan_ready=0
  local scan_output=""

  export PHASE4_PILOT_MODE="scan"
  export PHASE4_SCAN_EXPECTATION="$expectation"

  for attempt in {1..18}; do
    scan_output=""
    if scan_output="$(run_helper 2>&1)"; then
      printf '%s\n' "$scan_output"
      scan_ready=1
      break
    fi
    printf '%s\n' "$scan_output" >&2
    if ! grep -q "scheduler_not_enabled" <<<"$scan_output"; then
      echo "phase4_scheduler_pilot_failed: non-retryable $expectation scan error" >&2
      return 1
    fi
    echo "Waiting for scheduler secret redeploy before $expectation scan ($attempt/18)..." >&2
    sleep 10
  done

  if [[ "$scan_ready" -ne 1 ]]; then
    echo "phase4_scheduler_pilot_failed: scheduler secret redeploy timeout before $expectation scan" >&2
    return 1
  fi
}

run_scan_with_redeploy_wait "first"
run_scan_with_redeploy_wait "replay"

export PHASE4_PILOT_MODE="verify"
unset PHASE4_SCAN_EXPECTATION
run_helper

# Successful path uses the same rollback routine: secrets first, data second.
rollback
trap - EXIT INT TERM

echo "Phase 4 isolated scheduler pilot completed; secrets removed and test tenant cleaned."
