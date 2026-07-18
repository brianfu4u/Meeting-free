import { describe, it, expect } from "vitest";
import { orchestratePublish } from "../../../../base44/functions/guessPolicyService/publishOrchestrator";
import {
  canUpdatePolicy,
  isAuthorizedForClinicPure,
  UPDATABLE_STATUSES,
  RULE_DESCRIPTORS,
  TRACK_DESCRIPTORS,
  PUBLISHABLE_RULE_CODES,
  TRACK_IDS,
} from "../../../../base44/functions/guessPolicyService/contract";

/**
 * 后端发布生命周期测试（编排器 + 契约纯函数）。
 * 编排器副作用通过 mock ops 注入；失败注入经 ops 的 inject 集合实现，
 * 部署态 entry.ts 永不含注入逻辑。
 */
const CID = "clinic-test";
let _id = 0;
const rid = () => "p" + ++_id;

function makeOps(seed = {}) {
  const injectSet = new Set([].concat(seed.inject || []));
  const state = {
    policies: seed.policies ? seed.policies.map((p) => ({ ...p })) : [],
    config: seed.config ? { ...seed.config } : null,
  };
  return {
    state,
    injectSet,
    findByIdempotencyKey: async (cid, key) => state.policies.filter((p) => p.clinic_id === cid && p.publish_idempotency_key === key),
    findAllPolicies: async (cid) => state.policies.filter((p) => p.clinic_id === cid),
    findPublished: async (cid) => state.policies.filter((p) => p.clinic_id === cid && p.status === "published"),
    findConfig: async () => state.config,
    createStaging: async (input) => {
      const rec = { ...input, id: rid(), created_date: new Date().toISOString() };
      state.policies.push(rec);
      if (seed.onCreate) seed.onCreate(state, rec);
      return rec;
    },
    recheckByIdempotencyKey: async (cid, key) => state.policies.filter((p) => p.clinic_id === cid && p.publish_idempotency_key === key),
    recheckByVersion: async (cid, v) => state.policies.filter((p) => p.clinic_id === cid && Number(p.policy_version) === v),
    retirePolicy: async (id, now, idx) => {
      if (injectSet.has("retire@" + idx)) throw new Error("injected retire@" + idx);
      const p = state.policies.find((p) => p.id === id);
      if (p) { p.status = "retired"; p.retired_at = now; }
    },
    restoreRetired: async (id, retired_at) => {
      if (injectSet.has("restore_retired")) throw new Error("injected restore_retired");
      const p = state.policies.find((p) => p.id === id);
      if (p) { p.status = "published"; p.retired_at = retired_at; }
    },
    updateConfigActive: async (cfgId, v) => {
      if (injectSet.has("config_update")) throw new Error("injected config_update");
      if (state.config) state.config.active_policy_version = v;
    },
    restoreConfigActive: async (cfgId, orig) => {
      if (injectSet.has("compensation")) throw new Error("injected compensation");
      if (state.config) state.config.active_policy_version = orig;
    },
    markPublished: async (id, now, uid) => {
      if (injectSet.has("publish_mark")) throw new Error("injected publish_mark");
      const p = state.policies.find((p) => p.id === id);
      if (p) { p.status = "published"; p.published_at = now; p.published_by = uid; }
      return p;
    },
    deleteStaging: async (id) => {
      if (injectSet.has("delete_staging")) throw new Error("injected delete_staging");
      state.policies = state.policies.filter((p) => p.id !== id);
    },
  };
}

const input = (over = {}) => ({
  clinic_id: CID,
  idempotency_key: "k1",
  policy_version: undefined,
  hard_guardrails: [{ rule_code: "subject_conflict" }],
  tracks: [{ track_id: "causal_chain" }],
  decision_rules: {},
  user_id: "u1",
  ...over,
});

describe("publish — 幂等与版本单调", () => {
  it("相同 idempotency_key 重试返回同一 policy_id", async () => {
    const ops = makeOps({
      policies: [{ id: "v1", clinic_id: CID, policy_version: 1, status: "published", publish_idempotency_key: "k1", created_date: "2024-01-01T00:00:00Z" }],
      config: { id: "cfg", active_policy_version: 1 },
    });
    const r = await orchestratePublish(input({ idempotency_key: "k1" }), ops);
    expect(r.status).toBe("idempotent");
    expect(r.ok).toBe(true);
    expect(r.policy_id).toBe("v1");
    expect(r.idempotent).toBe(true);
  });

  it("重试发生在 next_version 已变化之后仍幂等命中（版本校验在 key 查询之后）", async () => {
    const ops = makeOps({
      policies: [{ id: "v1", clinic_id: CID, policy_version: 1, status: "published", publish_idempotency_key: "k1", created_date: "2024-01-01T00:00:00Z" }],
      config: { id: "cfg", active_policy_version: 1 },
    });
    // next_version 应为 2，但传 99；因先命中 key，不应返回 version_conflict
    const r = await orchestratePublish(input({ idempotency_key: "k1", policy_version: 99 }), ops);
    expect(r.status).toBe("idempotent");
    expect(r.policy_id).toBe("v1");
  });

  it("缺 idempotency_key → 400 missing_idempotency_key", async () => {
    const ops = makeOps();
    const r = await orchestratePublish(input({ idempotency_key: "" }), ops);
    expect(r.status).toBe("missing_idempotency_key");
    expect(r.http_status).toBe(400);
    expect(r.ok).toBe(false);
  });

  it("版本不等于 next_version → 409 version_conflict", async () => {
    const ops = makeOps();
    const r = await orchestratePublish(input({ policy_version: 5 }), ops);
    expect(r.status).toBe("version_conflict");
    expect(r.http_status).toBe(409);
    expect(r.next_version).toBe(1);
    expect(r.provided).toBe(5);
  });
});

describe("publish — 并发去重（post-create 乐观兜底）", () => {
  it("两个并发相同 key：后到者认负删除自身，只保留 winner", async () => {
    const ops = makeOps({
      onCreate: (state, rec) => {
        // 模拟并发：另一请求更早创建了同 key 记录
        state.policies.push({ id: "rival", clinic_id: CID, policy_version: 1, status: "draft", publish_idempotency_key: "k1", created_date: "2024-01-01T00:00:00Z" });
      },
    });
    const r = await orchestratePublish(input({ idempotency_key: "k1" }), ops);
    expect(r.status).toBe("idempotent");
    expect(r.policy_id).toBe("rival");
    // 认负者自身已删除，只剩 rival
    expect(ops.state.policies.map((p) => p.id)).toEqual(["rival"]);
  });

  it("两个并发相同版本不同 key：后到者认负，返回 version_conflict + winner", async () => {
    const ops = makeOps({
      onCreate: (state, rec) => {
        state.policies.push({ id: "rival", clinic_id: CID, policy_version: 1, status: "draft", publish_idempotency_key: "k2", created_date: "2024-01-01T00:00:00Z" });
      },
    });
    const r = await orchestratePublish(input({ idempotency_key: "k1" }), ops);
    expect(r.status).toBe("version_conflict");
    expect(r.http_status).toBe(409);
    expect(r.policy_id).toBe("rival");
    expect(ops.state.policies.map((p) => p.id)).toEqual(["rival"]);
  });
});

describe("publish — 成功路径", () => {
  it("空状态发布 v1：暂存→标记 published，config.active=1", async () => {
    const ops = makeOps({ config: { id: "cfg", active_policy_version: null } });
    const r = await orchestratePublish(input(), ops);
    expect(r.status).toBe("published");
    expect(r.ok).toBe(true);
    expect(r.next_version).toBe(1);
    expect(ops.state.policies).toHaveLength(1);
    expect(ops.state.policies[0].status).toBe("published");
    expect(ops.state.config.active_policy_version).toBe(1);
  });
});

describe("publish — 补偿回滚（失败注入）", () => {
  const threePublished = () => [
    { id: "a", clinic_id: CID, policy_version: 1, status: "published", created_date: "2024-01-01T00:00:00Z" },
    { id: "b", clinic_id: CID, policy_version: 2, status: "published", created_date: "2024-01-02T00:00:00Z" },
    { id: "c", clinic_id: CID, policy_version: 3, status: "published", created_date: "2024-01-03T00:00:00Z" },
  ];

  it("退役第 0 条失败：无记录被改，完整回滚", async () => {
    const ops = makeOps({ policies: threePublished(), config: { id: "cfg", active_policy_version: 3 }, inject: "retire@0" });
    const r = await orchestratePublish(input(), ops);
    expect(r.status).toBe("publish_failed");
    expect(r.compensation.succeeded).toBe(true);
    expect(ops.state.policies.map((p) => p.status)).toEqual(["published", "published", "published"]);
    expect(ops.state.config.active_policy_version).toBe(3);
    expect(ops.state.policies.find((p) => p.status === "draft")).toBeUndefined();
  });

  it("退役第 1 条失败：已退役的第 0 条被恢复，完整回滚", async () => {
    const ops = makeOps({ policies: threePublished(), config: { id: "cfg", active_policy_version: 3 }, inject: "retire@1" });
    const r = await orchestratePublish(input(), ops);
    expect(r.status).toBe("publish_failed");
    expect(r.compensation.succeeded).toBe(true);
    expect(r.compensation.restored_retired_ids).toEqual(["a"]);
    expect(ops.state.policies.map((p) => p.status)).toEqual(["published", "published", "published"]);
    expect(ops.state.config.active_policy_version).toBe(3);
  });

  it("退役第 2（最后）条失败：已退役的第 0/1 条被恢复，完整回滚", async () => {
    const ops = makeOps({ policies: threePublished(), config: { id: "cfg", active_policy_version: 3 }, inject: "retire@2" });
    const r = await orchestratePublish(input(), ops);
    expect(r.status).toBe("publish_failed");
    expect(r.compensation.restored_retired_ids).toEqual(["a", "b"]);
    expect(ops.state.policies.map((p) => p.status)).toEqual(["published", "published", "published"]);
  });

  it("ClinicConfig 更新失败：已退役恢复 + config 恢复原值，完整回滚", async () => {
    const ops = makeOps({ policies: [{ id: "a", clinic_id: CID, policy_version: 1, status: "published", created_date: "2024-01-01T00:00:00Z" }], config: { id: "cfg", active_policy_version: 1 }, inject: "config_update" });
    const r = await orchestratePublish(input(), ops);
    expect(r.status).toBe("publish_failed");
    expect(r.compensation.succeeded).toBe(true);
    expect(r.compensation.restored_retired_ids).toEqual(["a"]);
    expect(r.compensation.config_restored).toBe(true);
    expect(ops.state.policies[0].status).toBe("published");
    expect(ops.state.config.active_policy_version).toBe(1);
  });

  it("最终 published 标记失败：config + 已退役恢复，完整回滚", async () => {
    const ops = makeOps({ policies: [{ id: "a", clinic_id: CID, policy_version: 1, status: "published", created_date: "2024-01-01T00:00:00Z" }], config: { id: "cfg", active_policy_version: 1 }, inject: "publish_mark" });
    const r = await orchestratePublish(input(), ops);
    expect(r.status).toBe("publish_failed");
    expect(r.compensation.succeeded).toBe(true);
    expect(ops.state.policies[0].status).toBe("published");
    expect(ops.state.config.active_policy_version).toBe(1);
  });
});

describe("publish — 补偿本身失败 → compensation_failed", () => {
  it("恢复 config 失败：返回 compensation_failed + reconciliation", async () => {
    const ops = makeOps({
      policies: [{ id: "a", clinic_id: CID, policy_version: 1, status: "published", created_date: "2024-01-01T00:00:00Z" }],
      config: { id: "cfg", active_policy_version: 1 },
      inject: ["publish_mark", "compensation"],
    });
    const r = await orchestratePublish(input(), ops);
    expect(r.status).toBe("compensation_failed");
    expect(r.compensation.succeeded).toBe(false);
    expect(r.compensation.config_restore_failed).toBe(true);
    expect(r.compensation.reconciliation.some((x) => x.stage === "restore_config")).toBe(true);
  });

  it("删除暂存失败：返回 compensation_failed", async () => {
    const ops = makeOps({
      policies: [{ id: "a", clinic_id: CID, policy_version: 1, status: "published", created_date: "2024-01-01T00:00:00Z" }],
      config: { id: "cfg", active_policy_version: 1 },
      inject: ["publish_mark", "delete_staging"],
    });
    const r = await orchestratePublish(input(), ops);
    expect(r.status).toBe("compensation_failed");
    expect(r.compensation.staging_delete_failed).toBe(true);
  });

  it("恢复已退役记录失败：返回 compensation_failed", async () => {
    const ops = makeOps({
      policies: [
        { id: "a", clinic_id: CID, policy_version: 1, status: "published", created_date: "2024-01-01T00:00:00Z" },
        { id: "b", clinic_id: CID, policy_version: 2, status: "published", created_date: "2024-01-02T00:00:00Z" },
      ],
      config: { id: "cfg", active_policy_version: 2 },
      inject: ["retire@1", "restore_retired"],
    });
    const r = await orchestratePublish(input(), ops);
    expect(r.status).toBe("compensation_failed");
    expect(r.compensation.failed_restore_retired_ids).toContain("a");
  });
});

describe("update — 禁止原地修改已发布/退役策略", () => {
  it("canUpdatePolicy: draft/reviewed 允许，published/retired 拒绝", () => {
    expect(canUpdatePolicy("draft")).toBe(true);
    expect(canUpdatePolicy("reviewed")).toBe(true);
    expect(canUpdatePolicy("published")).toBe(false);
    expect(canUpdatePolicy("retired")).toBe(false);
    expect(canUpdatePolicy(undefined)).toBe(false);
  });
  it("UPDATABLE_STATUSES 仅 draft/reviewed", () => {
    expect(UPDATABLE_STATUSES).toEqual(["draft", "reviewed"]);
  });
});

describe("租户授权 — isAuthorizedForClinicPure", () => {
  it("店长为 config 创建人 → 授权", () => {
    expect(isAuthorizedForClinicPure({ id: "u1" }, [{ created_by_id: "u1" }], new Map())).toBe(true);
  });
  it("店长为 manager 绑定员工 → 授权", () => {
    const m = new Map([["s1", { user_id: "u1" }]]);
    expect(isAuthorizedForClinicPure({ id: "u1" }, [{ manager_id: "s1" }], m)).toBe(true);
  });
  it("非店长且无 config → 拒绝", () => {
    expect(isAuthorizedForClinicPure({ id: "u2" }, [], new Map())).toBe(false);
  });
  it("manager 不匹配 → 拒绝", () => {
    const m = new Map([["s1", { user_id: "u9" }]]);
    expect(isAuthorizedForClinicPure({ id: "u1" }, [{ manager_id: "s1" }], m)).toBe(false);
  });
  it("无用户 → 拒绝", () => {
    expect(isAuthorizedForClinicPure(null, [{ created_by_id: "u1" }], new Map())).toBe(false);
  });
});

describe("契约描述符 — 前端去硬编码依据", () => {
  it("RULE_DESCRIPTORS codes 与 PUBLISHABLE_RULE_CODES 一致", () => {
    expect(RULE_DESCRIPTORS.map((d) => d.rule_code)).toEqual(PUBLISHABLE_RULE_CODES);
  });
  it("每个规则描述符含 rule_code + params（可为空）", () => {
    for (const d of RULE_DESCRIPTORS) {
      expect(typeof d.rule_code).toBe("string");
      expect(Array.isArray(d.params)).toBe(true);
    }
  });
  it("TRACK_DESCRIPTORS track_ids 与 TRACK_IDS 一致", () => {
    expect(TRACK_DESCRIPTORS.map((d) => d.track_id)).toEqual(TRACK_IDS);
  });
  it("每个轨道描述符含 name + description", () => {
    for (const d of TRACK_DESCRIPTORS) {
      expect(typeof d.name).toBe("string");
      expect(typeof d.description).toBe("string");
    }
  });
});