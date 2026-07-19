/**
 * Clinic OS Phase 3 — 纯 Schema 测试
 *
 * 不依赖网络、不写数据。读取 base44/entities/*.jsonc 与 src/lib/phase3/contract.js，
 * 校验 Entity 字段、枚举、关系与状态机一致性。
 *
 * Phase 2 文件只读引用：仅校验 Phase 3 新增/追加字段存在，不校验 Phase 2 逻辑语义。
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  PHASE3_CONTRACT_VERSION,
  WORKFLOW_STATUSES,
  WORKFLOW_TRANSITIONS,
  HYPOTHESIS_STATUSES,
  HYPOTHESIS_TRANSITIONS,
  COMMIT_INTENT_STATUSES,
  COMMIT_INTENT_TRANSITIONS,
  COMMIT_OUTCOMES,
  MANAGER_TARGET_TYPES,
  SUBJECT_QUALITIES,
  COMPOSITION_TYPES,
  validateTransition,
  transitionMachines,
  assertSnapshotPointerMatch,
  assertAttachCompleteness,
  assertCommitTenantScope,
  assertSnapshotBelongsToWorkflow,
  assertIntentHypothesisLink,
  assertNoReverseHypothesisArray,
  assertNoAutoManager,
  canPerform,
  ACTION_PERMISSIONS,
} from "../contract";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENTITIES_DIR = path.resolve(__dirname, "../../../../base44/entities");

function readEntity(name) {
  const raw = fs.readFileSync(path.join(ENTITIES_DIR, `${name}.jsonc`), "utf8");
  // 容忍 jsonc 注释（本批文件为纯 JSON，但保留稳健性）
  const stripped = raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  return JSON.parse(stripped);
}

describe("Phase 3 契约版本", () => {
  it("暴露 PHASE3_CONTRACT_VERSION", () => {
    expect(PHASE3_CONTRACT_VERSION).toBe(1);
  });
});

describe("Workflow Entity (新增)", () => {
  const schema = readEntity("Workflow");
  it("存在且名为 Workflow", () => {
    expect(schema.name).toBe("Workflow");
  });
  const requiredFields = ["clinic_id", "workflow_family", "status"];
  it(`required 包含 ${requiredFields.join(", ")}`, () => {
    for (const f of requiredFields) expect(schema.required).toContain(f);
  });
  it("承载业务根字段（不塞进 WorkflowSnapshot）", () => {
    const props = schema.properties;
    for (const f of ["workflow_family", "subject_type", "subject_fingerprint", "temporal_anchors", "started_at", "last_event_at", "open_loops"]) {
      expect(props).toHaveProperty(f);
    }
    expect(props.status.enum).toEqual(WORKFLOW_STATUSES);
  });
  it("current_snapshot_id / current_snapshot_version 指针存在", () => {
    expect(schema.properties).toHaveProperty("current_snapshot_id");
    expect(schema.properties).toHaveProperty("current_snapshot_version");
  });
});

describe("WorkflowHypothesis Entity (新增)", () => {
  const schema = readEntity("WorkflowHypothesis");
  it("存在且名为 WorkflowHypothesis", () => {
    expect(schema.name).toBe("WorkflowHypothesis");
  });
  const userFields = [
    "clinic_id", "composition_run_id", "source_proposal_id", "workflow_hypothesis_id",
    "composition_type", "workflow_family", "target_workflow_id", "target_snapshot_id",
    "target_snapshot_version", "ordered_artifact_ids", "reasoning_tracks",
    "unsupported_assumptions", "contradictions", "unexplained_artifact_ids",
    "validation_blocks", "rank", "alternative_group", "status",
  ];
  it("包含用户指定的全部字段", () => {
    for (const f of userFields) expect(schema.properties).toHaveProperty(f);
  });
  it("composition_type 枚举与契约一致", () => {
    expect(schema.properties.composition_type.enum).toEqual(COMPOSITION_TYPES);
  });
  it("status 枚举与 HYPOTHESIS_STATUSES 一致", () => {
    expect(schema.properties.status.enum).toEqual(HYPOTHESIS_STATUSES);
  });
  it("required 含核心键", () => {
    for (const f of ["clinic_id", "composition_run_id", "source_proposal_id", "workflow_hypothesis_id", "composition_type", "status"]) {
      expect(schema.required).toContain(f);
    }
  });
});

describe("WorkflowCommitIntent Entity (新增, Saga)", () => {
  const schema = readEntity("WorkflowCommitIntent");
  it("存在且名为 WorkflowCommitIntent", () => {
    expect(schema.name).toBe("WorkflowCommitIntent");
  });
  it("Saga 状态枚举与契约一致", () => {
    expect(schema.properties.status.enum).toEqual(COMMIT_INTENT_STATUSES);
  });
  it("含 reconciliation 对账字段（决策 B）", () => {
    expect(schema.properties).toHaveProperty("reconciliation");
  });
  it("含幂等键与 CAS 比对字段", () => {
    for (const f of ["manager_execution_idempotency_key", "expected_snapshot_id", "expected_snapshot_version", "new_snapshot_id", "new_snapshot_version"]) {
      expect(schema.properties).toHaveProperty(f);
    }
  });
});

describe("Artifact 追加字段", () => {
  const schema = readEntity("Artifact");
  it("追加 source_workflow_id（explicit_id 挂接依据）", () => {
    expect(schema.properties).toHaveProperty("source_workflow_id");
  });
});

describe("EvidenceFactCard 追加字段", () => {
  const schema = readEntity("EvidenceFactCard");
  const newFields = ["explicit_workflow_id", "workflow_family_hint", "subject_type", "subject_fingerprint", "subject_quality", "occurred_at"];
  it("追加 interpretArtifact 产出的 6 字段", () => {
    for (const f of newFields) expect(schema.properties).toHaveProperty(f);
  });
  it("subject_quality 枚举与契约一致", () => {
    expect(schema.properties.subject_quality.enum).toEqual(SUBJECT_QUALITIES);
  });
});

describe("WorkflowSnapshot 追加字段", () => {
  const schema = readEntity("WorkflowSnapshot");
  it("追加 workflow_id（关联 Workflow，不承担业务根职责）", () => {
    expect(schema.properties).toHaveProperty("workflow_id");
  });
  it("不再新增业务根字段（决策 1：不把 workflow 字段塞进 snapshot）", () => {
    // workflow_family/subject_type/temporal_anchors/open_loops 应留在 Workflow
    for (const f of ["workflow_family", "subject_type", "temporal_anchors", "open_loops"]) {
      expect(schema.properties).not.toHaveProperty(f);
    }
  });
});

describe("AttentionItem 追加字段", () => {
  const schema = readEntity("AttentionItem");
  it("追加 composition_run_id / selected_hypothesis_id / committed_workflow_id / commit_outcome", () => {
    for (const f of ["composition_run_id", "selected_hypothesis_id", "committed_workflow_id", "commit_outcome"]) {
      expect(schema.properties).toHaveProperty(f);
    }
  });
  it("commit_outcome 枚举与契约一致", () => {
    expect(schema.properties.commit_outcome.enum).toEqual(COMMIT_OUTCOMES);
  });
});

describe("ManagerDecision 扩展", () => {
  const schema = readEntity("ManagerDecision");
  it("target_type 追加 hypothesis/proposal", () => {
    expect(schema.properties.target_type.enum).toEqual(MANAGER_TARGET_TYPES);
  });
  it("追加 commit_intent_id", () => {
    expect(schema.properties).toHaveProperty("commit_intent_id");
  });
});

describe("决策 C：不重复存储关系", () => {
  const compRun = readEntity("CompositionRun");
  it("CompositionRun 不反向存 hypothesis_ids（关系宿主为 WorkflowHypothesis.composition_run_id）", () => {
    expect(assertNoReverseHypothesisArray(compRun).ok).toBe(true);
    expect(compRun.properties).not.toHaveProperty("hypothesis_ids");
  });
});

describe("状态机校验", () => {
  it("Workflow 合法/非法流转", () => {
    expect(() => validateTransition(transitionMachines.workflow, "active", "stalled")).not.toThrow();
    expect(() => validateTransition(transitionMachines.workflow, "active", "closed")).not.toThrow();
    expect(() => validateTransition(transitionMachines.workflow, "closed", "active")).toThrow();
  });
  it("Hypothesis 合法/非法流转", () => {
    expect(() => validateTransition(transitionMachines.hypothesis, "pending_review", "selected")).not.toThrow();
    expect(() => validateTransition(transitionMachines.hypothesis, "dispatched", "committed")).not.toThrow();
    expect(() => validateTransition(transitionMachines.hypothesis, "committed", "pending_review")).toThrow();
  });
  it("CommitIntent Saga 合法/非法流转", () => {
    expect(() => validateTransition(transitionMachines.commit_intent, "pending", "committing")).not.toThrow();
    expect(() => validateTransition(transitionMachines.commit_intent, "committing", "committed")).not.toThrow();
    expect(() => validateTransition(transitionMachines.commit_intent, "compensation_failed", "pending")).not.toThrow();
    expect(() => validateTransition(transitionMachines.commit_intent, "committed", "pending")).toThrow();
  });
});

describe("关系不变量", () => {
  it("assertSnapshotPointerMatch：版本/ID 不一致 → stale", () => {
    const wf = { current_snapshot_id: "s1", current_snapshot_version: 3 };
    expect(assertSnapshotPointerMatch(wf, "s1", 3).ok).toBe(true);
    expect(assertSnapshotPointerMatch(wf, "s1", 4).ok).toBe(false);
    expect(assertSnapshotPointerMatch(wf, "s2", 3).ok).toBe(false);
  });
  it("assertAttachCompleteness：attach 必须三件齐全", () => {
    expect(assertAttachCompleteness({ composition_type: "new_train" }).ok).toBe(true);
    expect(assertAttachCompleteness({ composition_type: "attach", target_workflow_id: "w1" }).ok).toBe(false);
    expect(assertAttachCompleteness({ composition_type: "attach", target_workflow_id: "w1", target_snapshot_id: "s1", target_snapshot_version: 2 }).ok).toBe(true);
  });
  it("assertCommitTenantScope：跨租户阻断", () => {
    const a = { clinic_id: "c1" };
    const b = { clinic_id: "c2" };
    expect(assertCommitTenantScope("c1", a, a, a, a).ok).toBe(true);
    expect(assertCommitTenantScope("c1", a, a, b, a).ok).toBe(false);
  });
  it("assertSnapshotBelongsToWorkflow", () => {
    expect(assertSnapshotBelongsToWorkflow({ workflow_id: "w1" }, { id: "w1" }).ok).toBe(true);
    expect(assertSnapshotBelongsToWorkflow({ workflow_id: "w2" }, { id: "w1" }).ok).toBe(false);
  });
  it("assertIntentHypothesisLink", () => {
    expect(assertIntentHypothesisLink({ selected_hypothesis_id: "h1" }, { workflow_hypothesis_id: "h1" }).ok).toBe(true);
    expect(assertIntentHypothesisLink({ selected_hypothesis_id: "h1" }, { workflow_hypothesis_id: "h2" }).ok).toBe(false);
  });
  it("assertNoAutoManager：禁止 auto/system", () => {
    expect(assertNoAutoManager("user-123").ok).toBe(true);
    expect(assertNoAutoManager("auto").ok).toBe(false);
    expect(assertNoAutoManager("system").ok).toBe(false);
  });
});

describe("权限矩阵（决策 D）", () => {
  it("staff 可 interpret/run/query/listRuns", () => {
    expect(canPerform("interpret", "staff")).toBe(true);
    expect(canPerform("run", "staff")).toBe(true);
    expect(canPerform("query", "staff")).toBe(true);
    expect(canPerform("listRuns", "staff")).toBe(true);
  });
  it("staff 不可 commit", () => {
    expect(canPerform("commit", "staff")).toBe(false);
  });
  it("admin 可 commit", () => {
    expect(canPerform("commit", "admin")).toBe(true);
  });
  it("未知 action 拒绝", () => {
    expect(canPerform("unknown", "admin")).toBe(false);
  });
  it("ACTION_PERMISSIONS 完整性", () => {
    expect(Object.keys(ACTION_PERMISSIONS).sort()).toEqual(
      ["commit", "interpret", "listRuns", "query", "review", "run"].sort()
    );
  });
});


describe("CompositionRun Phase 3 Batch 2 metadata", () => {
  const schema = readEntity("CompositionRun");
  it("declares trigger/model/prompt/contract/error metadata", () => {
    for (const field of [
      "trigger_type",
      "prompt_version",
      "model_version",
      "contract_version",
      "error_code",
    ]) {
      expect(schema.properties).toHaveProperty(field);
    }
  });
  it("limits trigger_type to manual/scheduled", () => {
    expect(schema.properties.trigger_type.enum).toEqual(["manual", "scheduled"]);
  });
  it("does not duplicate WorkflowHypothesis relationships", () => {
    expect(schema.properties).not.toHaveProperty("hypothesis_ids");
  });
});


describe("ClinicConfig CompositionRun CAS lease", () => {
  const schema = readEntity("ClinicConfig");
  it("uses a lock namespace separate from GuessPolicy publish", () => {
    for (const field of [
      "composition_run_lock_key",
      "composition_run_lock_owner_id",
      "composition_run_lock_acquired_at",
      "composition_run_lock_expires_at",
    ]) {
      expect(schema.properties).toHaveProperty(field);
    }
    expect(schema.properties.composition_run_lock_owner_id)
      .not.toEqual(schema.properties.publish_lock_owner_id);
  });
});
