/**
 * Phase 3 Batch 2A — orchestratorCore 纯逻辑测试
 *
 * 不访问数据库、LLM、文件系统、git、vitest、build。
 * 仅断言纯函数行为。
 */
import { describe, it, expect } from "vitest";
import {
  authorizeAction,
  assertTenantScope,
  buildRunDescriptor,
  buildHypothesisDescriptors,
  deriveDispatchDecision,
  buildAttentionDescriptor,
  buildRunFailure,
} from "../orchestratorCore";
import { PHASE3_CONTRACT_VERSION } from "../contract";

describe("authorizeAction", () => {
  it("缺 clinicId 拒绝", () => {
    expect(authorizeAction({ action: "run", role: "staff" })).toEqual({ ok: false, reason: "missing_clinic_id" });
  });

  it("缺 action 拒绝", () => {
    expect(authorizeAction({ role: "staff", clinicId: "c1" })).toEqual({ ok: false, reason: "missing_action" });
  });

  it("缺 role 拒绝", () => {
    expect(authorizeAction({ action: "run", clinicId: "c1" })).toEqual({ ok: false, reason: "missing_role" });
  });

  it("staff 允许 interpret/run/query/listRuns", () => {
    for (const a of ["interpret", "run", "query", "listRuns"]) {
      const r = authorizeAction({ action: a, role: "staff", clinicId: "c1" });
      expect(r.ok).toBe(true);
    }
  });

  it("staff 禁止 commit", () => {
    const r = authorizeAction({ action: "commit", role: "staff", clinicId: "c1" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("action_not_permitted");
  });

  it("admin 允许 commit", () => {
    expect(authorizeAction({ action: "commit", role: "admin", clinicId: "c1" }).ok).toBe(true);
  });

  it("未知 action 拒绝", () => {
    expect(authorizeAction({ action: "frobnicate", role: "admin", clinicId: "c1" }).ok).toBe(false);
  });
});

describe("assertTenantScope", () => {
  it("缺 clinicId 返回阻断", () => {
    expect(assertTenantScope(null, { clinic_id: "c1" })).toEqual({ ok: false, reason: "missing_clinic_id" });
  });

  it("所有对象 clinic_id 一致通过", () => {
    expect(assertTenantScope("c1", { clinic_id: "c1" }, { clinic_id: "c1" }).ok).toBe(true);
  });

  it("对象缺失 clinic_id 阻断", () => {
    const r = assertTenantScope("c1", { clinic_id: "c1" }, { foo: "bar" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("object_missing_tenant");
    expect(r.offendingIndex).toBe(1);
  });

  it("跨租户对象阻断", () => {
    const r = assertTenantScope("c1", { clinic_id: "c1" }, { clinic_id: "c2" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("object_cross_tenant");
    expect(r.offendingIndex).toBe(1);
  });

  it("null 对象跳过", () => {
    expect(assertTenantScope("c1", null, undefined, { clinic_id: "c1" }).ok).toBe(true);
  });

  it("空字符串 clinic_id 视为缺失", () => {
    expect(assertTenantScope("c1", { clinic_id: "" }).ok).toBe(false);
  });
});

describe("buildRunDescriptor", () => {
  const baseInput = {
    clinicId: "c1",
    businessDate: "2026-07-18",
    slot: "12:30",
    triggerType: "scheduled",
    cutoffEventSeq: 42,
    policyVersion: 3,
    promptVersion: "asm-v1",
    modelVersion: "automatic",
  };

  it("生成完整 descriptor 且 status=pending", () => {
    const d = buildRunDescriptor(baseInput);
    expect(d.status).toBe("pending");
    expect(d.clinic_id).toBe("c1");
    expect(d.business_date).toBe("2026-07-18");
    expect(d.slot).toBe("12:30");
    expect(d.trigger_type).toBe("scheduled");
    expect(d.cutoff_event_seq).toBe(42);
    expect(d.policy_version).toBe(3);
    expect(d.prompt_version).toBe("asm-v1");
    expect(d.model_version).toBe("automatic");
    expect(d.contract_version).toBe(PHASE3_CONTRACT_VERSION);
    expect(d.idempotency_key).toContain("c1::2026-07-18::12:30::pv3::seq42");
    expect(d.proposals_generated).toBe(0);
    expect(d.artifact_ids_processed).toEqual([]);
  });

  it("不含 hypothesis_ids", () => {
    const d = buildRunDescriptor(baseInput);
    expect(d).not.toHaveProperty("hypothesis_ids");
    expect(Object.keys(d).some((k) => k.toLowerCase().includes("hypothesis"))).toBe(false);
  });

  it("同一输入产生稳定 descriptor（幂等键稳定）", () => {
    const a = buildRunDescriptor(baseInput);
    const b = buildRunDescriptor(baseInput);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("缺 clinicId 抛错", () => {
    expect(() => buildRunDescriptor({ ...baseInput, clinicId: null })).toThrow();
  });

  it("缺 cutoffEventSeq 抛错", () => {
    expect(() => buildRunDescriptor({ ...baseInput, cutoffEventSeq: null })).toThrow();
  });
});

describe("buildHypothesisDescriptors", () => {
  const baseInput = {
    compositionRunId: "run-1",
    clinicId: "c1",
    policyVersion: 3,
    promptVersion: "asm-v1",
    modelVersion: "automatic",
    hypotheses: [
      {
        workflow_hypothesis_id: "h0",
        composition_type: "attach",
        workflow_family: "optometry",
        target_workflow_id: "wf-1",
        target_snapshot_id: "snap-1",
        target_snapshot_version: 2,
        ordered_artifact_ids: ["a1", "a2"],
        reasoning_tracks: { subject_fingerprint: [] },
        unsupported_assumptions: [],
        contradictions: [],
        unexplained_artifact_ids: [],
        source_proposal_id: "prop-1",
        rank: 0,
      },
      {
        workflow_hypothesis_id: "h1",
        composition_type: "orphan",
        workflow_family: "optometry",
        ordered_artifact_ids: ["a3"],
        source_proposal_id: "prop-2",
        rank: 1,
      },
    ],
  };

  it("每条携带 composition_run_id", () => {
    const ds = buildHypothesisDescriptors(baseInput);
    expect(ds.length).toBe(2);
    expect(ds.every((d) => d.composition_run_id === "run-1")).toBe(true);
    expect(ds[0].status).toBe("pending_review");
  });

  it("保存 snapshot id/version", () => {
    const ds = buildHypothesisDescriptors(baseInput);
    expect(ds[0].target_snapshot_id).toBe("snap-1");
    expect(ds[0].target_snapshot_version).toBe(2);
  });

  it("保存排序依据 rank", () => {
    const ds = buildHypothesisDescriptors(baseInput);
    expect(ds[0].rank).toBe(0);
    expect(ds[1].rank).toBe(1);
  });

  it("保存阻断原因 validation_blocks（来自 guardrail）", () => {
    const ds = buildHypothesisDescriptors({
      ...baseInput,
      guardrailBlocks: [{ rule_code: "subject_conflict" }],
    });
    expect(ds[0].validation_blocks).toContainEqual({ rule_code: "subject_conflict" });
  });

  it("attach 缺 snapshot → 记录阻断并置 rejected", () => {
    const ds = buildHypothesisDescriptors({
      ...baseInput,
      hypotheses: [
        {
          ...baseInput.hypotheses[0],
          target_snapshot_id: null,
          target_snapshot_version: null,
        },
      ],
    });
    expect(ds[0].status).toBe("rejected");
    expect(ds[0].validation_blocks.some((b) => b.rule_code === "attach_without_snapshot")).toBe(true);
  });

  it("attach 缺 workflow_id → 记录阻断", () => {
    const ds = buildHypothesisDescriptors({
      ...baseInput,
      hypotheses: [{ ...baseInput.hypotheses[0], target_workflow_id: null }],
    });
    expect(ds[0].validation_blocks.some((b) => b.rule_code === "attach_without_target")).toBe(true);
    expect(ds[0].status).toBe("rejected");
  });

  it("orphan 不要求 snapshot", () => {
    const ds = buildHypothesisDescriptors(baseInput);
    expect(ds[1].composition_type).toBe("orphan");
    expect(ds[1].status).toBe("pending_review");
  });

  it("缺 compositionRunId 抛错", () => {
    expect(() => buildHypothesisDescriptors({ ...baseInput, compositionRunId: null })).toThrow();
  });

  it("缺 hypotheses 数组抛错", () => {
    expect(() => buildHypothesisDescriptors({ ...baseInput, hypotheses: null })).toThrow();
  });

  it("不向 descriptor 写 workflow mutation 字段", () => {
    const ds = buildHypothesisDescriptors(baseInput);
    for (const d of ds) {
      expect(d).not.toHaveProperty("workflow_mutation");
      expect(d).not.toHaveProperty("snapshot_mutation");
      expect(d).not.toHaveProperty("manager_decision");
      expect(d).not.toHaveProperty("commit_intent");
    }
  });
});

describe("deriveDispatchDecision", () => {
  it("validationIssues 非空 → needsManagerDispatch=true, bestHypothesisId=null", () => {
    const r = deriveDispatchDecision({ validationIssues: [{ rule_code: "x" }], bestHypothesisId: "h0" });
    expect(r.needsManagerDispatch).toBe(true);
    expect(r.bestHypothesisId).toBe(null);
  });

  it("validationIssues 空 → 尊重 guardrail.needsManagerDispatch", () => {
    const r = deriveDispatchDecision({ validationIssues: [], needsManagerDispatch: true, bestHypothesisId: "h0" });
    expect(r.needsManagerDispatch).toBe(true);
    expect(r.bestHypothesisId).toBe("h0");
  });

  it("validationIssues 空 且无 dispatch → 不派发", () => {
    const r = deriveDispatchDecision({ validationIssues: [] });
    expect(r.needsManagerDispatch).toBe(false);
    expect(r.bestHypothesisId).toBe(null);
  });

  it("不产生 ManagerDecision 字段", () => {
    const r = deriveDispatchDecision({ validationIssues: [{ rule_code: "x" }] });
    expect(r).not.toHaveProperty("managerDecision");
    expect(r).not.toHaveProperty("manager_decision");
  });
});

describe("buildAttentionDescriptor", () => {
  const baseInput = {
    needsManagerDispatch: true,
    clinicId: "c1",
    compositionRunId: "run-1",
    policyVersion: 3,
    promptVersion: "asm-v1",
    modelVersion: "automatic",
    hypothesisIds: ["h0", "h1"],
    bestHypothesisId: null,
    artifactIds: ["a1", "a2"],
    evidenceFactCardIds: ["fc1"],
  };

  it("needsManagerDispatch=false → 返回 null", () => {
    expect(buildAttentionDescriptor({ ...baseInput, needsManagerDispatch: false })).toBe(null);
  });

  it("生成 descriptor 且只含引用", () => {
    const d = buildAttentionDescriptor(baseInput);
    expect(d).not.toBeNull();
    expect(d.clinic_id).toBe("c1");
    expect(d.composition_run_id).toBe("run-1");
    expect(d.hypothesis_ids).toEqual(["h0", "h1"]);
    expect(d.artifact_ids).toEqual(["a1", "a2"]);
    expect(d.evidence_fact_card_ids).toEqual(["fc1"]);
    expect(d.selected_hypothesis_id).toBe(null);
  });

  it("status=open, shadow_mode_snapshot=true", () => {
    const d = buildAttentionDescriptor(baseInput);
    expect(d.status).toBe("open");
    expect(d.shadow_mode_snapshot).toBe(true);
  });

  it("不产生 Workflow/Snapshot/ManagerDecision/CommitIntent 写入字段", () => {
    const d = buildAttentionDescriptor(baseInput);
    expect(d).not.toHaveProperty("workflow_mutation");
    expect(d).not.toHaveProperty("snapshot_mutation");
    expect(d).not.toHaveProperty("manager_decision");
    expect(d).not.toHaveProperty("manager_decision_id");
    expect(d).not.toHaveProperty("commit_intent");
    expect(d).not.toHaveProperty("workflow_id_new");
    // committed_workflow_id 必须为 null（未提交）
    expect(d.committed_workflow_id).toBe(null);
    expect(d.commit_outcome).toBe(null);
    expect(d.task_id_created).toBe(null);
    expect(d.manager_action).toBe(null);
  });

  it("缺 clinicId 抛错", () => {
    expect(() => buildAttentionDescriptor({ ...baseInput, clinicId: null })).toThrow();
  });
});

describe("buildRunFailure", () => {
  it("Error 对象 → 稳定可序列化 descriptor", () => {
    const e = new Error("boom");
    e.stack = "sensitive stack trace";
    const d = buildRunFailure(e);
    expect(d.status).toBe("failed");
    expect(d.error.message).toBe("boom");
    expect(d.error.reason).toBe("runtime_error");
    expect(JSON.stringify(d)).toBeDefined();
    expect(JSON.stringify(d)).not.toContain("sensitive stack trace");
  });

  it("带 reason 的对象", () => {
    const d = buildRunFailure({ message: "tenant mismatch", reason: "object_cross_tenant" });
    expect(d.error.reason).toBe("object_cross_tenant");
  });

  it("null → unknown", () => {
    const d = buildRunFailure(null);
    expect(d.status).toBe("failed");
    expect(d.error.message).toBe("unknown_error");
  });

  it("同一输入稳定输出", () => {
    const a = buildRunFailure(new Error("x"));
    const b = buildRunFailure(new Error("x"));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});