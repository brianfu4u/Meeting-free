import { describe, it, expect } from "vitest";
import {
  TenantScopeError,
  assertSameTenant,
  assertTenantScope,
  assertCollectionTenant,
  assertDeepTenantScope,
  buildScopeKey,
  computeRunIdempotencyKey,
  computeProposalIdempotencyKey,
  computeManagerExecutionIdempotencyKey,
} from "../tenantContext";

describe("assertSameTenant", () => {
  it("passes when clinic_id matches", () => {
    expect(() => assertSameTenant("c1", { clinic_id: "c1" }, "x")).not.toThrow();
  });
  it("passes when object has no clinic_id", () => {
    expect(() => assertSameTenant("c1", { foo: 1 }, "x")).not.toThrow();
  });
  it("throws on mismatch", () => {
    expect(() => assertSameTenant("c1", { clinic_id: "c2" }, "x")).toThrow(TenantScopeError);
  });
  it("throws when clinicId missing", () => {
    expect(() => assertSameTenant("", { clinic_id: "c1" }, "x")).toThrow(TenantScopeError);
  });
});

describe("assertTenantScope (跨 Tenant 注入防御)", () => {
  it("passes when all match", () => {
    expect(() => assertTenantScope("c1", { clinic_id: "c1" }, { clinic_id: "c1" })).not.toThrow();
  });
  it("rejects injected foreign object among many", () => {
    expect(() =>
      assertTenantScope("c1", { clinic_id: "c1" }, { clinic_id: "c999" })
    ).toThrow(TenantScopeError);
  });
});

describe("assertCollectionTenant", () => {
  it("passes all matching", () => {
    expect(() =>
      assertCollectionTenant("c1", [{ clinic_id: "c1" }, { clinic_id: "c1" }], "arr")
    ).not.toThrow();
  });
  it("rejects one foreign element", () => {
    expect(() =>
      assertCollectionTenant("c1", [{ clinic_id: "c1" }, { clinic_id: "x" }], "arr")
    ).toThrow(TenantScopeError);
  });
});

describe("assertDeepTenantScope", () => {
  it("passes clean nested payload", () => {
    expect(() =>
      assertDeepTenantScope("c1", {
        clinic_id: "c1",
        artifacts: [{ clinic_id: "c1" }],
        snapshots: [{ clinic_id: "c1" }],
      })
    ).not.toThrow();
  });
  it("blocks cross-tenant injection via nested artifacts array (攻击场景)", () => {
    expect(() =>
      assertDeepTenantScope("c1", {
        clinic_id: "c1",
        artifacts: [{ clinic_id: "c1" }, { clinic_id: "evil" }],
      })
    ).toThrow(TenantScopeError);
  });
  it("blocks foreign clinic_id on payload root", () => {
    expect(() =>
      assertDeepTenantScope("c1", { clinic_id: "evil", artifacts: [] })
    ).toThrow(TenantScopeError);
  });
});

describe("buildScopeKey", () => {
  it("namespaces key with clinic_id", () => {
    expect(buildScopeKey("c1", "factcard:abc")).toBe("tenant:c1:factcard:abc");
  });
  it("different tenants get different keys (缓存隔离)", () => {
    expect(buildScopeKey("c1", "k")).not.toBe(buildScopeKey("c2", "k"));
  });
  it("rejects missing clinic_id", () => {
    expect(() => buildScopeKey("", "k")).toThrow(TenantScopeError);
  });
});

describe("computeRunIdempotencyKey", () => {
  it("is deterministic for same inputs", () => {
    const args = { clinicId: "c1", businessDate: "2026-07-18", slot: "12:30", policyVersion: 1, cutoffEventSeq: 42 };
    expect(computeRunIdempotencyKey(args)).toBe(computeRunIdempotencyKey(args));
  });
  it("changes with each input field", () => {
    const base = { clinicId: "c1", businessDate: "2026-07-18", slot: "12:30", policyVersion: 1, cutoffEventSeq: 42 };
    expect(computeRunIdempotencyKey({ ...base, slot: "15:30" })).not.toBe(computeRunIdempotencyKey(base));
    expect(computeRunIdempotencyKey({ ...base, cutoffEventSeq: 43 })).not.toBe(computeRunIdempotencyKey(base));
    expect(computeRunIdempotencyKey({ ...base, policyVersion: 2 })).not.toBe(computeRunIdempotencyKey(base));
    expect(computeRunIdempotencyKey({ ...base, businessDate: "2026-07-19" })).not.toBe(computeRunIdempotencyKey(base));
  });
  it("rejects missing fields", () => {
    expect(() => computeRunIdempotencyKey({ clinicId: "c1" })).toThrow(TenantScopeError);
  });
});

describe("computeProposalIdempotencyKey", () => {
  it("is order-independent (sorted artifact ids)", () => {
    const a = computeProposalIdempotencyKey({ clinicId: "c1", sortedArtifactIds: ["a1", "a2", "a3"], policyVersion: 1 });
    const b = computeProposalIdempotencyKey({ clinicId: "c1", sortedArtifactIds: ["a3", "a1", "a2"], policyVersion: 1 });
    expect(a).toBe(b);
  });
  it("changes with policy_version and clinic_id", () => {
    const a = computeProposalIdempotencyKey({ clinicId: "c1", sortedArtifactIds: ["a1"], policyVersion: 1 });
    expect(computeProposalIdempotencyKey({ clinicId: "c1", sortedArtifactIds: ["a1"], policyVersion: 2 })).not.toBe(a);
    expect(computeProposalIdempotencyKey({ clinicId: "c2", sortedArtifactIds: ["a1"], policyVersion: 1 })).not.toBe(a);
  });
});

describe("computeManagerExecutionIdempotencyKey", () => {
  it("combines decision and proposal", () => {
    expect(computeManagerExecutionIdempotencyKey({ managerDecisionId: "d1", proposalId: "p1" }))
      .toBe("exec::d1::p1");
  });
  it("rejects missing fields", () => {
    expect(() => computeManagerExecutionIdempotencyKey({ managerDecisionId: "d1" })).toThrow(TenantScopeError);
  });
});