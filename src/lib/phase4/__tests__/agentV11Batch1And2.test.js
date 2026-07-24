import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CANONICAL_TRIGGER_TYPES,
  buildUnifiedRunRequest,
  normalizeTriggerType,
} from "../triggerCore";
import { buildRunDescriptor } from "../../phase3/orchestratorCore";

const root = path.resolve(process.cwd());
const entity = (name) => JSON.parse(
  fs.readFileSync(path.join(root, "base44", "entities", `${name}.jsonc`), "utf8")
);

describe("Agent v1.1 Batch 1 schemas", () => {
  it("makes UndoListItem durable, idempotent, and authority-resolved", () => {
    const schema = entity("UndoListItem");
    expect(schema.required).toEqual(expect.arrayContaining([
      "clinic_id", "artifact_id", "original_uploader_id", "idempotency_key", "status",
    ]));
    expect(schema.properties.status.enum).toEqual(["pending", "resolved", "manager_cleared", "accepted_orphan"]);
    expect(schema.properties).toHaveProperty("resolved_by_link_id");
  });

  it("defines an append-only authoritative WorkflowArtifactLink", () => {
    const schema = entity("WorkflowArtifactLink");
    expect(schema.required).toEqual(expect.arrayContaining([
      "clinic_id", "workflow_id", "artifact_id", "idempotency_key", "attached_by_run_id",
    ]));
    expect(schema.properties.status.enum).toEqual(["attached", "superseded"]);
    expect(schema.properties).toHaveProperty("superseded_by_link_id");
    expect(schema.required).toEqual(expect.arrayContaining([
      "decision_source", "decision_actor_id",
    ]));
  });

  it("defines a replayable AgentAttachIntent stable across Run restarts", () => {
    const schema = entity("AgentAttachIntent");
    expect(schema.properties.idempotency_key.description).toContain("stable across CompositionRun restart");
    expect(schema.properties.status.enum).toEqual([
      "observed", "pending", "attaching", "cas_retryable", "committed", "compensation_failed",
    ]);
    expect(schema.required).toEqual(expect.arrayContaining([
      "clinic_id", "idempotency_key", "composition_run_id",
      "workflow_hypothesis_id", "target_workflow_id", "artifact_ids",
      "status", "decision_source",
    ]));
  });

  it("stores cutoff and daily run cadence in GuessPolicy", () => {
    const schema = entity("GuessPolicy");
    expect(schema.properties.daily_cutoff_time.default).toBe("17:30");
    expect(schema.properties.agent_run_frequency.default).toBe(2);
    expect(schema.properties.next_business_day_start_time.default).toBe("08:00");
  });
});

describe("Agent v1.1 Batch 2 unified triggers", () => {
  const common = {
    clinicId: "phase-v11-it",
    businessDate: "2026-07-22",
    slot: "17:30",
    policyVersion: 4,
    artifacts: [
      { ingestion_seq: 2, ingested_at: "2026-07-22T07:00:00Z" },
      { ingestion_seq: 8, ingested_at: "2026-07-22T08:00:00Z" },
    ],
  };

  it("supports exactly the three canonical entry types and a legacy alias", () => {
    expect(CANONICAL_TRIGGER_TYPES).toEqual([
      "scheduled", "manager_manual", "cutoff_reconciliation",
    ]);
    expect(normalizeTriggerType("manual")).toBe("manager_manual");
    expect(normalizeTriggerType("other")).toBeNull();
  });

  it("gives all three entries the same core payload except provenance", () => {
    const requests = CANONICAL_TRIGGER_TYPES.map((triggerType) =>
      buildUnifiedRunRequest({ ...common, triggerType }).request
    );
    const withoutTrigger = requests.map(({ trigger_type, ...rest }) => rest);
    expect(withoutTrigger[0]).toEqual(withoutTrigger[1]);
    expect(withoutTrigger[1]).toEqual(withoutTrigger[2]);
  });

  it("shares trigger-neutral run idempotency and watermark semantics", () => {
    const descriptors = CANONICAL_TRIGGER_TYPES.map((triggerType) => {
      const request = buildUnifiedRunRequest({ ...common, triggerType }).request;
      return buildRunDescriptor({
        clinicId: request.clinic_id,
        businessDate: request.business_date,
        slot: request.slot,
        policyVersion: request.policy_version,
        cutoffEventSeq: request.cutoff_event_seq,
        cutoffIngestedAt: request.cutoff_ingested_at,
        triggerType: request.trigger_type,
      });
    });
    expect(new Set(descriptors.map((item) => item.idempotency_key)).size).toBe(1);
    expect(descriptors.map((item) => item.trigger_type)).toEqual(CANONICAL_TRIGGER_TYPES);
  });
});