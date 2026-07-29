#!/usr/bin/env bash
# Direction A live Base44 end-to-end validation.
#
# Reads the real scheduler environment, temporarily narrows all mutable gates to
# one randomized phase5-it-e2e-* clinic, invokes deployed functions and real
# entities, then restores the exact original secret values before deleting only
# records belonging to the randomized clinic.

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER="$ROOT_DIR/scripts/phase5-live-e2e.mjs"
LOG_DIR="$ROOT_DIR/artifacts"
ENABLED_SECRET="COMPOSITION_SCHEDULER_ENABLED"
ALLOWLIST_SECRET="COMPOSITION_SCHEDULER_CLINICS"
AUTO_ATTACH_SECRET="AGENT_AUTO_ATTACH_MODE"
MOCK_SECRET="FRAGMENT_INGESTION_MOCK"

cd "$ROOT_DIR"
mkdir -p "$LOG_DIR"

base44_cli() {
  npx base44@latest "$@"
}

if [[ ! -f "$HELPER" ]]; then
  echo "phase5_live_e2e_preflight_failed: helper_missing" >&2
  exit 1
fi
if [[ ! -f "base44/.app.jsonc" ]]; then
  echo "phase5_live_e2e_preflight_failed: base44/.app.jsonc missing; run in the linked Codespace/repository" >&2
  exit 1
fi

base44_cli whoami >/dev/null

PHASE5_LIVE_E2E_CLINIC_ID="phase5-it-e2e-$(node -e 'console.log(require("node:crypto").randomUUID())')"
export PHASE5_LIVE_E2E_CLINIC_ID
LOG_FILE="$LOG_DIR/${PHASE5_LIVE_E2E_CLINIC_ID}.jsonl"
SECRETS_TOUCHED=0
FIXTURE_MAY_EXIST=0
ORIGINAL_DIAGNOSIS=""

run_helper() {
  cat "$HELPER" | base44_cli exec
}

run_mode() {
  local selected_mode="$1"
  export PHASE5_LIVE_E2E_MODE="$selected_mode"
  run_helper
}

json_secret_present() {
  local json="$1" name="$2"
  node -e 'const d=JSON.parse(process.argv[1]); process.stdout.write(String(Boolean(d.scheduler_secrets[process.argv[2]].present)))' "$json" "$name"
}

json_secret_b64() {
  local json="$1" name="$2"
  node -e 'const d=JSON.parse(process.argv[1]); const v=d.scheduler_secrets[process.argv[2]].value ?? ""; process.stdout.write(Buffer.from(String(v)).toString("base64"))' "$json" "$name"
}

decode_b64() {
  node -e 'process.stdout.write(Buffer.from(process.argv[1], "base64").toString())' "$1"
}

restore_one_secret() {
  local name="$1" present="$2" encoded="$3"
  if [[ "$present" == "true" ]]; then
    local value
    value="$(decode_b64 "$encoded")"
    base44_cli secrets set "$name=$value" >/dev/null
  else
    base44_cli secrets delete "$name" >/dev/null 2>&1 || true
  fi
}

rollback() {
  local failed=0
  set +e

  # Restore environment first. Never leave the global scheduler pointed at a
  # transient clinic whose records are about to be deleted.
  if [[ "$SECRETS_TOUCHED" -eq 1 && -n "$ORIGINAL_DIAGNOSIS" ]]; then
    echo "Restoring original Base44 secrets..."
    restore_one_secret "$ENABLED_SECRET" "$ORIG_ENABLED_PRESENT" "$ORIG_ENABLED_B64" || failed=1
    restore_one_secret "$ALLOWLIST_SECRET" "$ORIG_ALLOWLIST_PRESENT" "$ORIG_ALLOWLIST_B64" || failed=1
    restore_one_secret "$AUTO_ATTACH_SECRET" "$ORIG_AUTO_ATTACH_PRESENT" "$ORIG_AUTO_ATTACH_B64" || failed=1
    restore_one_secret "$MOCK_SECRET" "$ORIG_MOCK_PRESENT" "$ORIG_MOCK_B64" || failed=1
    SECRETS_TOUCHED=0
  fi

  if [[ "$FIXTURE_MAY_EXIST" -eq 1 ]]; then
    echo "Cleaning exact records in $PHASE5_LIVE_E2E_CLINIC_ID..."
    run_mode cleanup | tee -a "$LOG_FILE" || failed=1
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

# 1. Read actual scheduler secrets and the actual clinic-001 gate values.
ORIGINAL_DIAGNOSIS="$(run_mode diagnose | tail -n 1)"
printf '%s\n' "$ORIGINAL_DIAGNOSIS" | tee -a "$LOG_FILE"

ORIG_ENABLED_PRESENT="$(json_secret_present "$ORIGINAL_DIAGNOSIS" "$ENABLED_SECRET")"
ORIG_ENABLED_B64="$(json_secret_b64 "$ORIGINAL_DIAGNOSIS" "$ENABLED_SECRET")"
ORIG_ALLOWLIST_PRESENT="$(json_secret_present "$ORIGINAL_DIAGNOSIS" "$ALLOWLIST_SECRET")"
ORIG_ALLOWLIST_B64="$(json_secret_b64 "$ORIGINAL_DIAGNOSIS" "$ALLOWLIST_SECRET")"
ORIG_AUTO_ATTACH_PRESENT="$(json_secret_present "$ORIGINAL_DIAGNOSIS" "$AUTO_ATTACH_SECRET")"
ORIG_AUTO_ATTACH_B64="$(json_secret_b64 "$ORIGINAL_DIAGNOSIS" "$AUTO_ATTACH_SECRET")"
ORIG_MOCK_PRESENT="$(json_secret_present "$ORIGINAL_DIAGNOSIS" "$MOCK_SECRET")"
ORIG_MOCK_B64="$(json_secret_b64 "$ORIGINAL_DIAGNOSIS" "$MOCK_SECRET")"

# 2. Open only the isolated test clinic. Mock applies only to the parser fixture;
# composition still invokes its deployed runtime and LLM path.
SECRETS_TOUCHED=1
base44_cli secrets set \
  "$ENABLED_SECRET=true" \
  "$ALLOWLIST_SECRET=$PHASE5_LIVE_E2E_CLINIC_ID" \
  "$AUTO_ATTACH_SECRET=commit" \
  "$MOCK_SECRET=true" >/dev/null

# Wait for secret redeploy until the deployed runtime reports all four values.
secrets_ready=0
for attempt in {1..18}; do
  effective="$(run_mode diagnose | tail -n 1)"
  if node -e '
    const d=JSON.parse(process.argv[1]).scheduler_secrets;
    const clinic=process.argv[2];
    const ok=d.COMPOSITION_SCHEDULER_ENABLED.value==="true" &&
      d.COMPOSITION_SCHEDULER_CLINICS.value===clinic &&
      d.AGENT_AUTO_ATTACH_MODE.value==="commit" &&
      d.FRAGMENT_INGESTION_MOCK.value==="true";
    process.exit(ok ? 0 : 1);
  ' "$effective" "$PHASE5_LIVE_E2E_CLINIC_ID"; then
    printf '%s\n' "$effective" | tee -a "$LOG_FILE"
    secrets_ready=1
    break
  fi
  echo "Waiting for Base44 secret redeploy ($attempt/18)..." >&2
  sleep 10
done
if [[ "$secrets_ready" -ne 1 ]]; then
  echo "phase5_live_e2e_failed: secret_redeploy_timeout" >&2
  exit 1
fi

# 3. Actual employee report → EvidenceItem → bridge chain.
FIXTURE_MAY_EXIST=1
run_mode setup | tee -a "$LOG_FILE"

# 4. Actual scheduled scan and same-slot idempotent replay.
export PHASE5_LIVE_E2E_SCAN_EXPECTATION="first"
run_mode scan | tee -a "$LOG_FILE"
export PHASE5_LIVE_E2E_SCAN_EXPECTATION="replay"
run_mode scan | tee -a "$LOG_FILE"
unset PHASE5_LIVE_E2E_SCAN_EXPECTATION

# 5. Verify hypothesis tracks, committed attachment, snapshot and dashboard model.
run_mode verify | tee -a "$LOG_FILE"

# Successful path uses the same rollback order: environment first, data second.
rollback
trap - EXIT INT TERM

echo "Direction A live E2E completed successfully."
echo "Clinic: $PHASE5_LIVE_E2E_CLINIC_ID"
echo "Log: $LOG_FILE"
