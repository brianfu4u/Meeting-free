import { describe, it, expect, vi } from "vitest";
import { createScopedQuery } from "../scopedQuery";
import { TenantScopeError } from "../tenantContext";

/** 构造内存级假 entityApi，模拟 base44 实体操作，便于离线单测。
 *  每个 entity 缓存同一实例，保证 mock.calls 可读取。 */
function createFakeEntityApi() {
  const stores = {}; // entity -> Map<id, record>
  const apis = {}; // entity -> 句柄（缓存）
  const getApi = (entity) => {
    if (apis[entity]) return apis[entity];
    if (!stores[entity]) stores[entity] = new Map();
    const store = stores[entity];
    const handle = {
      list: vi.fn(async (sort, limit) => [...store.values()]),
      filter: vi.fn(async (query = {}, sort, limit) =>
        [...store.values()].filter((r) =>
          Object.entries(query).every(([k, v]) => r[k] === v)
        )
      ),
      get: vi.fn(async (id) => store.get(id) || null),
      create: vi.fn(async (data) => {
        const id = data.id || `rec_${store.size + 1}`;
        const rec = { ...data, id };
        store.set(id, rec);
        return rec;
      }),
      bulkCreate: vi.fn(async (items) => items.map((d) => handle.create(d))),
      update: vi.fn(async (id, patch) => {
        const rec = store.get(id);
        if (!rec) throw new Error("not found");
        const next = { ...rec, ...patch, id };
        store.set(id, next);
        return next;
      }),
      delete: vi.fn(async (id) => {
        store.delete(id);
        return { ok: true };
      }),
      updateMany: vi.fn(async (query, update) => {
        let n = 0;
        for (const r of [...store.values()]) {
          if (Object.entries(query).every(([k, v]) => r[k] === v)) {
            store.set(r.id, { ...r, ...(update.$set || update) });
            n++;
          }
        }
        return { modified: n };
      }),
      deleteMany: vi.fn(async (query) => {
        let n = 0;
        for (const r of [...store.values()]) {
          if (Object.entries(query).every(([k, v]) => r[k] === v)) {
            store.delete(r.id);
            n++;
          }
        }
        return { deleted: n };
      }),
    };
    apis[entity] = handle;
    return handle;
  };
  return new Proxy({}, { get: (_t, entity) => getApi(entity) });
}

function setup() {
  const entityApi = createFakeEntityApi();
  const q = createScopedQuery("clinic-001", entityApi);
  return { entityApi, q };
}

describe("ScopedQuery — filter 强制注入 clinic_id", () => {
  it("filter query always carries clinic_id", async () => {
    const { entityApi, q } = setup();
    await q.filter("Artifact", { source_staff_id: "s1" });
    const args = entityApi.Artifact.filter.mock.calls[0][0];
    expect(args.clinic_id).toBe("clinic-001");
    expect(args.source_staff_id).toBe("s1");
  });
  it("空 query 仍带 clinic_id（防止跨 Tenant 全量）", async () => {
    const { entityApi, q } = setup();
    await q.filter("Artifact");
    expect(entityApi.Artifact.filter.mock.calls[0][0].clinic_id).toBe("clinic-001");
  });
});

describe("ScopedQuery — create 强制注入并拒绝走私", () => {
  it("injects clinic_id on create", async () => {
    const { q } = setup();
    const rec = await q.create("Artifact", { artifact_type: "image", file_url: "u" });
    expect(rec.clinic_id).toBe("clinic-001");
  });
  it("拒绝 payload 自带不一致 clinic_id（跨 Tenant 注入攻击）", () => {
    const { q } = setup();
    expect(() =>
      q.create("Artifact", { clinic_id: "clinic-evil", file_url: "u" })
    ).toThrow(TenantScopeError);
  });
  it("bulkCreate 拒绝任一元素跨 Tenant", () => {
    const { q } = setup();
    expect(() =>
      q.bulkCreate("Artifact", [
        { clinic_id: "clinic-001", file_url: "u" },
        { clinic_id: "clinic-evil", file_url: "u2" },
      ])
    ).toThrow(TenantScopeError);
  });
});

describe("ScopedQuery — get/update/delete 归属校验", () => {
  it("get 跨 Tenant 记录抛错", async () => {
    const { entityApi, q } = setup();
    // 直接用原始 API 种一条他 Tenant 数据（绕过 ScopedQuery）
    await entityApi.Artifact.create({ id: "a1", clinic_id: "clinic-002", file_url: "u" });
    await expect(q.get("Artifact", "a1")).rejects.toThrow(TenantScopeError);
  });
  it("update 跨 Tenant 记录抛错", async () => {
    const { entityApi, q } = setup();
    await entityApi.Artifact.create({ id: "a2", clinic_id: "clinic-002", file_url: "u" });
    await expect(q.update("Artifact", "a2", { interpreted: true })).rejects.toThrow(TenantScopeError);
  });
  it("update 同 Tenant 成功且保留 clinic_id", async () => {
    const { q } = setup();
    const rec = await q.create("Artifact", { id: "a3", artifact_type: "image", file_url: "u" });
    const updated = await q.update("Artifact", rec.id, { interpreted: true });
    expect(updated.interpreted).toBe(true);
    expect(updated.clinic_id).toBe("clinic-001");
  });
  it("delete 跨 Tenant 记录抛错", async () => {
    const { entityApi, q } = setup();
    await entityApi.Artifact.create({ id: "a4", clinic_id: "clinic-002", file_url: "u" });
    await expect(q.delete("Artifact", "a4")).rejects.toThrow(TenantScopeError);
  });
});

describe("ScopedQuery — updateMany/deleteMany 永不跨 Tenant", () => {
  it("updateMany 注入 clinic_id", async () => {
    const { entityApi, q } = setup();
    await q.create("Artifact", { id: "a5", artifact_type: "image", file_url: "u" });
    await q.updateMany("Artifact", { artifact_type: "image" }, { $set: { interpreted: true } });
    const filter = entityApi.Artifact.updateMany.mock.calls[0][0];
    expect(filter.clinic_id).toBe("clinic-001");
  });
  it("deleteMany 空 query 仍带 clinic_id（不会误删他 Tenant）", async () => {
    const { entityApi, q } = setup();
    await q.deleteMany("Artifact");
    const filter = entityApi.Artifact.deleteMany.mock.calls[0][0];
    expect(filter.clinic_id).toBe("clinic-001");
  });
});

describe("ScopedQuery — 构造守卫", () => {
  it("缺 clinicId 抛错", () => {
    expect(() => createScopedQuery("", {})).toThrow(TenantScopeError);
  });
  it("缺 entityApi 抛错", () => {
    expect(() => createScopedQuery("c1", null)).toThrow(TenantScopeError);
  });
});