import { describe, expect, it } from "vitest";
import {
  BRIDGE_STATUS,
  bridgeEvidenceItemRealtime,
  runSingleBridgeAttempt,
} from "../../../../base44/shared/evidenceArtifactBridge.ts";
import { isPickupEligible } from "../../phase5/agentHandoffContract.js";

function createMemoryService() {
  const stores = new Map();
  let sequence = 0;
  const table = (name) => {
    if (!stores.has(name)) stores.set(name, []);
    return stores.get(name);
  };
  const matches = (row, query) => Object.entries(query || {}).every(([key, value]) => row[key] === value);
  const entities = new Proxy({}, {
    get(_target, name) {
      return {
        async create(payload) {
          const row = {
            ...structuredClone(payload),
            id: `${String(name).toLowerCase()}-${++sequence}`,
            created_date: `2026-07-29T00:00:${String(sequence).padStart(2, "0")}Z`,
          };
          table(name).push(row);
          return structuredClone(row);
        },
        async filter(query) {
          return table(name).filter((row) => matches(row, query)).map((row) => structuredClone(row));
        },
        async get(id) {
          const row = table(name).find((item) => item.id === id);
          if (!row) throw new Error(`${String(name)}_not_found`);
          return structuredClone(row);
        },
        async update(id, patch) {
          const row = table(name).find((item) => item.id === id);
          if (!row) throw new Error(`${String(name)}_not_found`);
          Object.assign(row, structuredClone(patch));
          return structuredClone(row);
        },
        async delete(id) {
          const rows = table(name);
          const index = rows.findIndex((item) => item.id === id);
          if (index >= 0) rows.splice(index, 1);
        },
      };
    },
  });
  return {
    entities,
    integrations: { Core: {} },
    rows: (name) => table(name).map((row) => structuredClone(row)),
  };
}

async function seedEvidence(svc, overrides = {}) {
  return svc.entities.EvidenceItem.create({
    clinic_id: "phase5-it-bridge-unit",
    version_id: "v-report-1",
    evidence_type: "image",
    file_url: "https://files.base44.com/bridge-unit.png",
    submitted_at: "2026-07-29T09:00:00Z",
    submitted_by: "staff-1",
    eval_result: "pending",
    bridge_status: "pending",
    attempt_count: 0,
    ...overrides,
  });
}

const staff = {
  id: "staff-1",
  role: "optometrist",
  role_group: "medical_core",
  assigned_zone: "optometry",
};

const mockDeps = {
  mock: true,
  invokeLLM: async () => ({}),
  transcribeAudio: async () => ({}),
  extractDataFromFile: async () => ({}),
};

const alwaysFail = async () => {
  throw Object.assign(new Error("adapter failed"), { code: "adapter_failed" });
};

async function refreshed(svc, evidence) {
  return svc.entities.EvidenceItem.get(evidence.id);
}

describe("EvidenceItem → Artifact real-time bridge", () => {
  it("converts the full chain once and replays idempotently", async () => {
    const svc = createMemoryService();
    const evidence = await seedEvidence(svc);

    const first = await bridgeEvidenceItemRealtime({
      svc,
      evidenceItem: evidence,
      sourceEventId: "report-event-1",
      staff,
      deps: mockDeps,
    });

    expect(first.bridge_status).toBe(BRIDGE_STATUS.converted);
    expect(first.assembly_eligible).toBe(true);
    expect(first.attempt_count).toBe(1);
    expect(svc.rows("Artifact")).toHaveLength(1);
    expect(svc.rows("FragmentProcessingResult")).toHaveLength(1);
    expect(svc.rows("EvidenceFactCard")).toHaveLength(1);

    const artifact = svc.rows("Artifact")[0];
    const processing = svc.rows("FragmentProcessingResult")[0];
    const factCard = svc.rows("EvidenceFactCard")[0];
    expect(artifact.origin_evidence_item_id).toBe(evidence.id);
    expect(processing.origin_evidence_item_id).toBe(evidence.id);
    expect(factCard.origin_evidence_item_id).toBe(evidence.id);
    expect(Number.isFinite(Number(artifact.ingestion_seq))).toBe(true);
    expect(factCard.alignment_status).toBe("aligned");
    expect(factCard.assembly_eligible).toBe(true);
    expect(isPickupEligible({
      factCard,
      artifact,
      clinicId: evidence.clinic_id,
      cutoffEventSeq: artifact.ingestion_seq,
      completedArtifactIds: [],
    })).toBe(true);

    const second = await bridgeEvidenceItemRealtime({
      svc,
      evidenceItem: await refreshed(svc, evidence),
      sourceEventId: "report-event-1",
      staff,
      deps: mockDeps,
    });
    expect(second.idempotent).toBe(true);
    expect(svc.rows("Artifact")).toHaveLength(1);
    expect(svc.rows("FragmentProcessingResult")).toHaveLength(1);
    expect(svc.rows("EvidenceFactCard")).toHaveLength(1);
  });

  it("records the first failure in audit only", async () => {
    const svc = createMemoryService();
    const evidence = await seedEvidence(svc);
    const result = await runSingleBridgeAttempt({
      svc,
      evidenceItem: evidence,
      sourceEventId: "report-event-fail",
      staff,
      deps: mockDeps,
      processor: alwaysFail,
    });
    expect(result.bridge_status).toBe(BRIDGE_STATUS.failed);
    expect(result.attempt_count).toBe(1);
    expect(result.last_error_code).toBe("adapter_failed");
    expect(svc.rows("AuditLog")).toHaveLength(1);
    expect(svc.rows("AttentionItem")).toHaveLength(0);
  });

  it("records the second failure in audit only", async () => {
    const svc = createMemoryService();
    const evidence = await seedEvidence(svc);
    await runSingleBridgeAttempt({ svc, evidenceItem: evidence, sourceEventId: "report-event-fail", staff, deps: mockDeps, processor: alwaysFail });
    const result = await runSingleBridgeAttempt({
      svc,
      evidenceItem: await refreshed(svc, evidence),
      sourceEventId: "report-event-fail",
      staff,
      deps: mockDeps,
      processor: alwaysFail,
    });
    expect(result.attempt_count).toBe(2);
    expect(svc.rows("AuditLog")).toHaveLength(2);
    expect(svc.rows("AttentionItem")).toHaveLength(0);
  });

  it("creates one deduplicated AttentionItem only after the third failure", async () => {
    const svc = createMemoryService();
    const evidence = await seedEvidence(svc);
    await runSingleBridgeAttempt({ svc, evidenceItem: evidence, sourceEventId: "report-event-fail", staff, deps: mockDeps, processor: alwaysFail });
    await runSingleBridgeAttempt({ svc, evidenceItem: await refreshed(svc, evidence), sourceEventId: "report-event-fail", staff, deps: mockDeps, processor: alwaysFail });
    const third = await runSingleBridgeAttempt({
      svc,
      evidenceItem: await refreshed(svc, evidence),
      sourceEventId: "report-event-fail",
      staff,
      deps: mockDeps,
      processor: alwaysFail,
    });
    expect(third.attempt_count).toBe(3);
    expect(third.attention_item_id).toBeTruthy();
    expect(svc.rows("AuditLog")).toHaveLength(3);
    expect(svc.rows("AttentionItem")).toHaveLength(1);

    const terminalReplay = await bridgeEvidenceItemRealtime({
      svc,
      evidenceItem: await refreshed(svc, evidence),
      sourceEventId: "report-event-fail",
      staff,
      deps: mockDeps,
      processor: alwaysFail,
    });
    expect(terminalReplay.attempt_count).toBe(3);
    expect(svc.rows("AttentionItem")).toHaveLength(1);
  });
});
