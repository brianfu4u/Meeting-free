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
 *
 * R3 阻断修复新增：
 * - 幂等命中按 Policy 状态分类（publish_in_progress / idempotent_retired / integrity_conflict）；
 * - originalActive=null 补偿（显式 configWasUpdated）；
 * - 真实并发集成测试（Promise.all + CAS mock 锁），不依赖 created_date。
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
    // CAS 锁：单文档原子获取（mock 同步实现，无 await 间隙 → 真实互斥）
    acquireLock: async (cid, key) => {
      if (!state.config) return { acquired: false };
      if (state.config.publish_lock_request_id == null) {
        state.config.publish_lock_request_id = key;
        return { acquired: true };
      }
      return { acquired: false };
    },
    releaseLock: async (cid, key) => {
      if (state.config && state.config.publish_lock_request_id === key) {
        state.config.publish_lock_request_id = null;
      }
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

const cfg = (over = {}) => ({ id: "cfg", active_policy_version: null, ...over });

describe("publish — 幂等与版本单调", () => {
  it("相同 idempotency_key 重试返回同一 policy_id", async () => {
    const ops = makeOps({
      policies: [{ id: "v1", clinic_id: CID, policy_version: 1, status: "published", publish_idempotency_key: "k1", created_date: "2024-01-01T00:00:00Z" }],
      config: cfg({ active_policy_version: 1 }),
    });
    const r = await orchestratePublish(input({ idempotency_key: "k1" }), ops);
    expect(r.status).toBe("idempotent");
    expect(r.ok).toBe(true);
    expect(r.policy_id).toBe("v1");
    expect(r.idempotent).toBe(true);
  });

  it("重试发生在 next_version 已变化之后仍幂等命中（预查在版本校验之前）", async () => {
    const ops = makeOps({
      policies: [{ id: "v1", clinic_id: CID, policy_version: 1, status: "published", publish_idempotency_key: "k1", created_date: "2024-01-01T00:00:00Z" }],
      config: cfg({ active_policy_version: 1 }),
    });
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
    const ops = makeOps({ config: cfg() });
    const r = await orchestratePublish(input({ policy_version: 5 }), ops);
    expect(r.status).toBe("version_conflict");
    expect(r.http_status).toBe(409);
    expect(r.next_version).toBe(1);
    expect(r.provided).toBe(5);
  });
});

describe("publish — 幂等命中按 Policy 状态分类（R3 阻断2）", () => {
  it("命中 draft → publish_in_progress(409)，不得 ok:true", async () => {
    const ops = makeOps({
      policies: [{ id: "d1", clinic_id: CID, policy_version: 1, status: "draft", publish_idempotency_key: "k1", created_date: "2024-01-01T00:00:00Z" }],
      config: cfg(),
    });
    const r = await orchestratePublish(input({ idempotency_key: "k1" }), ops);
    expect(r.status).toBe("publish_in_progress");
    expect(r.ok).toBe(false);
    expect(r.http_status).toBe(409);
    expect(r.policy_id).toBe("d1");
  });

  it("命中 reviewed → publish_in_progress(409)", async () => {
    const ops = makeOps({
      policies: [{ id: "r1", clinic_id: CID, policy_version: 1, status: "reviewed", publish_idempotency_key: "k1", created_date: "2024-01-01T00:00:00Z" }],
      config: cfg(),
    });
    const r = await orchestratePublish(input({ idempotency_key: "k1" }), ops);
    expect(r.status).toBe("publish_in_progress");
    expect(r.ok).toBe(false);
  });

  it("命中 retired → idempotent_retired(409)，不得当作当前发布成功", async () => {
    const ops = makeOps({
      policies: [{ id: "old", clinic_id: CID, policy_version: 1, status: "retired", publish_idempotency_key: "k1", created_date: "2024-01-01T00:00:00Z" }],
      config: cfg({ active_policy_version: 2 }),
    });
    const r = await orchestratePublish(input({ idempotency_key: "k1" }), ops);
    expect(r.status).toBe("idempotent_retired");
    expect(r.ok).toBe(false);
    expect(r.http_status).toBe(409);
  });

  it("命中多条同 key → integrity_conflict(409)，输出记录 ID，不静默选 earliest", async () => {
    const ops = makeOps({
      policies: [
        { id: "a", clinic_id: CID, policy_version: 1, status: "published", publish_idempotency_key: "k1", created_date: "2024-01-01T00:00:00Z" },
        { id: "b", clinic_id: CID, policy_version: 1, status: "published", publish_idempotency_key: "k1", created_date: "2024-01-02T00:00:00Z" },
      ],
      config: cfg(),
    });
    const r = await orchestratePublish(input({ idempotency_key: "k1" }), ops);
    expect(r.status).toBe("integrity_conflict");
    expect(r.ok).toBe(false);
    expect(r.http_status).toBe(409);
    expect(r.record_ids).toEqual(expect.arrayContaining(["a", "b"]));
  });
});

describe("publish — post-create 去重安全网（R3 阻断2）", () => {
  it("post-create 命中 rival draft → publish_in_progress，不得当成功", async () => {
    const ops = makeOps({
      config: cfg(),
      onCreate: (state, rec) => {
        state.policies.push({ id: "rival", clinic_id: CID, policy_version: 1, status: "draft", publish_idempotency_key: "k1", created_date: "2024-01-01T00:00:00Z" });
      },
    });
    const r = await orchestratePublish(input({ idempotency_key: "k1" }), ops);
    expect(r.status).toBe("publish_in_progress");
    expect(r.http_status).toBe(409);
    expect(r.ok).toBe(false);
    // 认负者自身已删除，只剩 rival
    expect(ops.state.policies.map((p) => p.id)).toEqual(["rival"]);
  });

  it("post-create 命中 rival published → idempotent 成功", async () => {
    const ops = makeOps({
      config: cfg(),
      onCreate: (state, rec) => {
        state.policies.push({ id: "rival", clinic_id: CID, policy_version: 1, status: "published", publish_idempotency_key: "k1", created_date: "2024-01-01T00:00:00Z" });
      },
    });
    const r = await orchestratePublish(input({ idempotency_key: "k1" }), ops);
    expect(r.status).toBe("idempotent");
    expect(r.ok).toBe(true);
    expect(r.policy_id).toBe("rival");
    expect(ops.state.policies.map((p) => p.id)).toEqual(["rival"]);
  });

  it("两个并发相同版本不同 key：后到者认负，version_conflict + winner", async () => {
    const ops = makeOps({
      config: cfg(),
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
    const ops = makeOps({ config: cfg() });
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
    const ops = makeOps({ policies: threePublished(), config: cfg({ active_policy_version: 3 }), inject: "retire@0" });
    const r = await orchestratePublish(input(), ops);
    expect(r.status).toBe("publish_failed");
    expect(r.compensation.succeeded).toBe(true);
    expect(ops.state.policies.map((p) => p.status)).toEqual(["published", "published", "published"]);
    expect(ops.state.config.active_policy_version).toBe(3);
    expect(ops.state.policies.find((p) => p.status === "draft")).toBeUndefined();
  });

  it("退役第 1 条失败：已退役的第 0 条被恢复，完整回滚", async () => {
    const ops = makeOps({ policies: threePublished(), config: cfg({ active_policy_version: 3 }), inject: "retire@1" });
    const r = await orchestratePublish(input(), ops);
    expect(r.status).toBe("publish_failed");
    expect(r.compensation.succeeded).toBe(true);
    expect(r.compensation.restored_retired_ids).toEqual(["a"]);
    expect(ops.state.policies.map((p) => p.status)).toEqual(["published", "published", "published"]);
    expect(ops.state.config.active_policy_version).toBe(3);
  });

  it("退役第 2（最后）条失败：已退役的第 0/1 条被恢复，完整回滚", async () => {
    const ops = makeOps({ policies: threePublished(), config: cfg({ active_policy_version: 3 }), inject: "retire@2" });
    const r = await orchestratePublish(input(), ops);
    expect(r.status).toBe("publish_failed");
    expect(r.compensation.restored_retired_ids).toEqual(["a", "b"]);
    expect(ops.state.policies.map((p) => p.status)).toEqual(["published", "published", "published"]);
  });

  it("ClinicConfig 更新失败：已退役恢复 + config 恢复原值，完整回滚", async () => {
    const ops = makeOps({ policies: [{ id: "a", clinic_id: CID, policy_version: 1, status: "published", created_date: "2024-01-01T00:00:00Z" }], config: cfg({ active_policy_version: 1 }), inject: "config_update" });
    const r = await orchestratePublish(input(), ops);
    expect(r.status).toBe("publish_failed");
    expect(r.compensation.succeeded).toBe(true);
    expect(r.compensation.restored_retired_ids).toEqual(["a"]);
    expect(r.compensation.config_restored).toBe(true);
    expect(ops.state.policies[0].status).toBe("published");
    expect(ops.state.config.active_policy_version).toBe(1);
  });

  it("最终 published 标记失败：config + 已退役恢复，完整回滚", async () => {
    const ops = makeOps({ policies: [{ id: "a", clinic_id: CID, policy_version: 1, status: "published", created_date: "2024-01-01T00:00:00Z" }], config: cfg({ active_policy_version: 1 }), inject: "publish_mark" });
    const r = await orchestratePublish(input(), ops);
    expect(r.status).toBe("publish_failed");
    expect(r.compensation.succeeded).toBe(true);
    expect(ops.state.policies[0].status).toBe("published");
    expect(ops.state.config.active_policy_version).toBe(1);
  });

  it("originalActive=null：config 更新成功后 markPublished 失败 → config 恢复为 null，config_restored=true（R3 阻断1）", async () => {
    const ops = makeOps({ config: cfg({ active_policy_version: null }), inject: "publish_mark" });
    const r = await orchestratePublish(input(), ops);
    expect(r.status).toBe("publish_failed");
    expect(r.compensation.succeeded).toBe(true);
    expect(r.compensation.config_restored).toBe(true);
    expect(ops.state.config.active_policy_version).toBeNull();
  });

  it("originalActive=null：config 更新成功后 restoreConfigActive 失败 → compensation_failed", async () => {
    const ops = makeOps({ config: cfg({ active_policy_version: null }), inject: ["publish_mark", "compensation"] });
    const r = await orchestratePublish(input(), ops);
    expect(r.status).toBe("compensation_failed");
    expect(r.compensation.config_restore_failed).toBe(true);
    expect(r.compensation.reconciliation.some((x) => x.stage === "restore_config")).toBe(true);
  });
});

describe("publish — 补偿本身失败 → compensation_failed", () => {
  it("删除暂存失败：返回 compensation_failed", async () => {
    const ops = makeOps({
      policies: [{ id: "a", clinic_id: CID, policy_version: 1, status: "published", created_date: "2024-01-01T00:00:00Z" }],
      config: cfg({ active_policy_version: 1 }),
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
      config: cfg({ active_policy_version: 2 }),
      inject: ["retire@1", "restore_retired"],
    });
    const r = await orchestratePublish(input(), ops);
    expect(r.status).toBe("compensation_failed");
    expect(r.compensation.failed_restore_retired_ids).toContain("a");
  });
});

describe("publish — 真实并发集成测试（R3 阻断3：CAS 锁，非 created_date 启发）", () => {
  it("相同 clinic + key 并发：只存在一条 Policy，另一请求 publish_lock_busy", async () => {
    const ops = makeOps({ config: cfg() });
    const [a, b] = await Promise.all([
      orchestratePublish(input({ idempotency_key: "k1" }), ops),
      orchestratePublish(input({ idempotency_key: "k1" }), ops),
    ]);
    const results = [a, b];
    const published = results.filter((r) => r.status === "published");
    const busy = results.filter((r) => r.status === "publish_lock_busy");
    expect(published.length).toBe(1);
    expect(busy.length).toBe(1);
    const k1Policies = ops.state.policies.filter((p) => p.publish_idempotency_key === "k1");
    expect(k1Policies.length).toBe(1);
    expect(k1Policies[0].status).toBe("published");
  });

  it("相同 clinic + version、不同 key 并发：只能一个成功；busy 者重试后发布下一版本", async () => {
    const ops = makeOps({ config: cfg() });
    const [a, b] = await Promise.all([
      orchestratePublish(input({ idempotency_key: "k1" }), ops),
      orchestratePublish(input({ idempotency_key: "k2" }), ops),
    ]);
    const published = [a, b].filter((r) => r.status === "published");
    expect(published.length).toBe(1);
    const versions = ops.state.policies.map((p) => p.policy_version);
    expect(new Set(versions).size).toBe(versions.length); // 无重复版本
    // busy 者重试 → 发布 v2
    const busy = [a, b].find((r) => r.status === "publish_lock_busy");
    const busyKey = busy === a ? "k1" : "k2";
    const r2 = await orchestratePublish(input({ idempotency_key: busyKey }), ops);
    expect(r2.status).toBe("published");
    expect(r2.next_version).toBe(2);
    // 全局无重复版本
    const allVersions = ops.state.policies.map((p) => p.policy_version);
    expect(new Set(allVersions).size).toBe(allVersions.length);
  });

  it("两个 created_date 完全相同也不能双成功（CAS 锁保证，非 created_date 比较）", async () => {
    const fixedDate = "2026-07-18T00:00:00Z";
    const ops = makeOps({
      config: cfg(),
      onCreate: (state, rec) => {
        rec.created_date = fixedDate; // 强制任何创建的暂存 created_date 完全相同
      },
    });
    const [a, b] = await Promise.all([
      orchestratePublish(input({ idempotency_key: "k1" }), ops),
      orchestratePublish(input({ idempotency_key: "k1" }), ops),
    ]);
    const published = [a, b].filter((r) => r.status === "published");
    expect(published.length).toBe(1);
    const k1 = ops.state.policies.filter((p) => p.publish_idempotency_key === "k1");
    expect(k1.length).toBe(1);
    expect(k1[0].status).toBe("published");
  });

  it("锁释放后相同 key 重试命中幂等成功", async () => {
    const ops = makeOps({ config: cfg() });
    const first = await orchestratePublish(input({ idempotency_key: "k1" }), ops);
    expect(first.status).toBe("published");
    // 锁已释放（finally），重试相同 key → 预查命中 published → idempotent
    const again = await orchestratePublish(input({ idempotency_key: "k1" }), ops);
    expect(again.status).toBe("idempotent");
    expect(again.policy_id).toBe(first.policy_id);
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