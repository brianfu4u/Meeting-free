/*
 * Phase 5 isolated cleanup — exact-ID deletion only.
 * Run via: cat scripts/phase5-cleanup.mjs | npx base44@latest exec
 *
 * Discovers all records for a given test clinic_id (must start with phase5-it-)
 * and deletes them in dependency order. NEVER uses prefix-based deleteMany.
 * NEVER deletes clinic-001 or any non-phase5-it clinic.
 */

const PHASE5_PREFIX = "phase5-it-";
const FORBIDDEN = new Set(["clinic-001"]);

const cleanupOrder = [
  "AttentionItem",
  "FragmentProcessingResult",
  "EvidenceFactCard",
  "Artifact",
  "Staff",
  "ClinicConfig",
];

function assert(cond, msg) {
  if (!cond) throw new Error(`phase5_cleanup_assertion_failed:${msg}`);
}

async function discoverCounts(clinicId) {
  assert(clinicId.startsWith(PHASE5_PREFIX), "unsafe_clinic_prefix");
  assert(!FORBIDDEN.has(clinicId), "production_clinic_forbidden");
  const counts = {};
  for (const name of cleanupOrder) {
    const rows = await base44.entities[name].filter({ clinic_id: clinicId });
    counts[name] = (rows || []).length;
  }
  return counts;
}

async function cleanupExact(clinicId) {
  const before = await discoverCounts(clinicId);
  const deleted = {};
  for (const name of cleanupOrder) {
    deleted[name] = 0;
    const rows = await base44.entities[name].filter({ clinic_id: clinicId });
    for (const row of rows || []) {
      if (row?.id) {
        try {
          await base44.entities[name].delete(String(row.id));
          deleted[name] += 1;
        } catch (err) {
          console.error(`delete_failed:${name}:${row.id}`, err?.message || err);
        }
      }
    }
  }
  const after = await discoverCounts(clinicId);
  return { before, deleted, after };
}

const clinicId = (typeof argv !== "undefined" && argv?.[0]) || "";
if (!clinicId.startsWith(PHASE5_PREFIX)) {
  console.log(JSON.stringify({ ok: false, error: "clinic_id must start with phase5-it-", provided: clinicId }));
} else {
  const result = await cleanupExact(clinicId);
  console.log(JSON.stringify({ ok: true, clinic_id: clinicId, ...result }, null, 2));
}