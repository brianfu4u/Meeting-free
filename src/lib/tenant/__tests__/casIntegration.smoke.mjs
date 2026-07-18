/**
 * Clinic OS V10 — 真实 Base44 CAS 集成测试（隔离 clinic，手动/本地运行）
 *
 * 目的：验证 ClinicConfig 单文档 updateMany 返回的 updated 计数为可信 CAS 判据，
 * 覆盖 R4 锁语义：并发获锁唯一赢家 / 持有后阻塞 / 过期接管 / owner 释放。
 *
 * 运行前提：具备 Base44 服务端 SDK 凭证（本地 dev 或 exec_tool）。CI 无凭证时跳过。
 * 使用隔离 clinic_id（cas-it-<uuid>），绝不使用 clinic-001；结束按 cfg.id 清理。
 *
 * 已知结果（2026-07-18 exec_tool 实测）：
 *   s1 并发获锁 counts=[1,0] winners=1
 *   s2 持有后阻塞 counts=[0,0]
 *   s3 过期接管 updated=1
 *   s4 owner 释放 updated=1
 *   cleanup remaining=0
 */
import { base44 } from "../../../api/base44Client.js";

export async function runCasIntegration() {
  const cid = "cas-it-" + crypto.randomUUID().slice(0, 8);
  const cfg = await base44.asServiceRole.entities.ClinicConfig.create({
    clinic_id: cid, clinic_name: "CAS IT", manager_id: "m-it",
  });
  const out = { cid, cfgId: cfg.id };
  try {
    const nowISO = new Date().toISOString();
    const expISO = new Date(Date.now() + 30000).toISOString();
    const owners = ["own-A", "own-B"];

    const r1 = await Promise.all(owners.map((o) =>
      base44.asServiceRole.entities.ClinicConfig.updateMany(
        { clinic_id: cid, publish_lock_owner_id: null },
        { $set: { publish_lock_owner_id: o, publish_lock_acquired_at: nowISO, publish_lock_expires_at: expISO } }
      )
    ));
    out.s1 = { counts: r1.map((r) => r?.updated), winners: r1.filter((r) => r?.updated === 1).length };

    const r2 = await Promise.all(owners.map((o) =>
      base44.asServiceRole.entities.ClinicConfig.updateMany(
        { clinic_id: cid, publish_lock_owner_id: null },
        { $set: { publish_lock_owner_id: o + "-x" } }
      )
    ));
    out.s2 = { counts: r2.map((r) => r?.updated) };

    const held = (await base44.asServiceRole.entities.ClinicConfig.filter({ clinic_id: cid }))[0];
    out.heldOwner = held.publish_lock_owner_id;

    await base44.asServiceRole.entities.ClinicConfig.update(cfg.id, { publish_lock_expires_at: "2020-01-01T00:00:00Z" });
    const stale = (await base44.asServiceRole.entities.ClinicConfig.filter({ clinic_id: cid }))[0];
    const r3 = await base44.asServiceRole.entities.ClinicConfig.updateMany(
      { clinic_id: cid, publish_lock_owner_id: stale.publish_lock_owner_id, publish_lock_expires_at: "2020-01-01T00:00:00Z" },
      { $set: { publish_lock_owner_id: "own-C", publish_lock_acquired_at: nowISO, publish_lock_expires_at: expISO } }
    );
    out.s3 = { updated: r3?.updated };

    const r4 = await base44.asServiceRole.entities.ClinicConfig.updateMany(
      { clinic_id: cid, publish_lock_owner_id: "own-C" },
      { $set: { publish_lock_owner_id: null, publish_lock_acquired_at: null, publish_lock_expires_at: null } }
    );
    out.s4 = { updated: r4?.updated };
  } finally {
    try { await base44.asServiceRole.entities.ClinicConfig.delete(cfg.id); } catch {}
    const verify = await base44.asServiceRole.entities.ClinicConfig.filter({ clinic_id: cid });
    out.cleanup = { remaining: verify.length };
  }
  const pass =
    out.s1.winners === 1 &&
    out.s2.counts.every((c) => c === 0) &&
    out.s3.updated === 1 &&
    out.s4.updated === 1 &&
    out.cleanup.remaining === 0;
  out.pass = pass;
  return out;
}

// 直接运行：node src/lib/tenant/__tests__/casIntegration.smoke.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  runCasIntegration().then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(r.pass ? 0 : 1); });
}