import { describe, it, expect, vi } from "vitest";
import { atomicClaim } from "../idempotency";
import { TenantScopeError } from "../tenantContext";

function makeEntity() {
  const store = new Map();
  let seq = 0;
  return {
    filter: vi.fn(async (q) =>
      [...store.values()].filter((r) =>
        Object.entries(q).every(([k, v]) => r[k] === v)
      )
    ),
    create: vi.fn(async (data) => {
      const id = `rec_${++seq}`;
      const rec = { ...data, id };
      store.set(id, rec);
      return rec;
    }),
  };
}
function fakeApi() {
  return { CompositionRun: makeEntity() };
}

describe("atomicClaim — 幂等占位", () => {
  it("首次调用 create 并标记 created:true", async () => {
    const api = fakeApi();
    const r1 = await atomicClaim(api, "CompositionRun", "key::1", {
      clinic_id: "clinic-001",
      slot: "12:30",
    });
    expect(r1.created).toBe(true);
    expect(r1.record.idempotency_key).toBe("key::1");
  });
  it("相同幂等键第二次返回已存在记录，标记 created:false", async () => {
    const api = fakeApi();
    await atomicClaim(api, "CompositionRun", "key::2", { clinic_id: "clinic-001" });
    const r2 = await atomicClaim(api, "CompositionRun", "key::2", { clinic_id: "clinic-001" });
    expect(r2.created).toBe(false);
    expect(r2.record.idempotency_key).toBe("key::2");
  });
  it("缺 idempotencyKey 抛错", async () => {
    const api = fakeApi();
    await expect(atomicClaim(api, "CompositionRun", "", { clinic_id: "c1" })).rejects.toThrow(
      TenantScopeError
    );
  });
  it("缺 payload.clinic_id 抛错", async () => {
    const api = fakeApi();
    await expect(atomicClaim(api, "CompositionRun", "k", {})).rejects.toThrow(TenantScopeError);
  });
  it("去重过滤与创建均以 payload.clinic_id 为作用域（防跨租户占位）", async () => {
    const api = fakeApi();
    await atomicClaim(api, "CompositionRun", "key::scope", { clinic_id: "clinic-001" });
    const filterArg = api.CompositionRun.filter.mock.calls[0][0];
    expect(filterArg.clinic_id).toBe("clinic-001");
    expect(filterArg.idempotency_key).toBe("key::scope");
    const createArg = api.CompositionRun.create.mock.calls[0][0];
    expect(createArg.clinic_id).toBe("clinic-001");
  });
});