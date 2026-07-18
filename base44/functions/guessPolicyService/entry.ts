import { createClientFromRequest } from "npm:@base44/sdk@0.8.38";
import {
  CONTRACT_VERSION,
  KNOWN_RULE_CODES,
  PUBLISHABLE_RULE_CODES,
  TRACK_IDS,
  RULE_DESCRIPTORS,
  TRACK_DESCRIPTORS,
  UPDATABLE_STATUSES,
  migrateHardGuardrails,
  validatePolicyForPublish,
  canUpdatePolicy,
  isAuthorizedForClinicPure,
  buildContract,
} from "./contract.ts";
import { orchestratePublish } from "./publishOrchestrator.ts";

/**
 * Clinic OS V10 — GuessPolicyService（GuessPolicy 唯一发布/更新/迁移后端入口）
 *
 * 发布主逻辑下沉至 publishOrchestrator.ts（纯逻辑 + 注入 ops），本文件只负责：
 * - 鉴权 / 租户隔离；
 * - 构造真实 Base44 SDK ops 注入编排器；
 * - metadata / contract / update / migrate 辅助 action。
 *
 * 禁止在本文件复制规则码/轨道/校验/迁移逻辑（全部来自 contract.ts）。
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "未登录" }, { status: 401 });
    const svc = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const { action, clinic_id } = body || {};

    // ── contract：返回共享契约（登录即可，无门店维度） ───────────────────
    if (action === "contract") {
      return Response.json({ ok: true, ...buildContract() });
    }

    // ── metadata：只读，返回版本与描述符（需授权） ──────────────────────
    if (action === "metadata") {
      if (user.role !== "admin") return Response.json({ error: "仅店长可查看策略元数据" }, { status: 403 });
      if (!clinic_id) return Response.json({ error: "clinic_id 必填" }, { status: 400 });
      if (!(await isAuthorized(svc, user, clinic_id))) {
        return Response.json({ error: "无权操作该门店（租户隔离）" }, { status: 403 });
      }
      return Response.json({ ok: true, ...(await computeMetadata(svc, clinic_id)) });
    }

    // ── publish：店长发布新版本（编排器：版本单调+幂等+补偿） ────────────
    if (action === "publish") {
      if (user.role !== "admin") return Response.json({ error: "仅店长可发布策略" }, { status: 403 });
      if (!clinic_id) return Response.json({ error: "clinic_id 必填" }, { status: 400 });
      if (!(await isAuthorized(svc, user, clinic_id))) {
        return Response.json({ error: "无权操作该门店（租户隔离）" }, { status: 403 });
      }
      const ops = makeRealOps(svc);
      const result = await orchestratePublish(
        {
          clinic_id,
          idempotency_key: body.idempotency_key,
          policy_version: body.policy_version,
          hard_guardrails: body.hard_guardrails,
          tracks: body.tracks,
          decision_rules: body.decision_rules,
          user_id: user.id,
        },
        ops
      );
      return Response.json(result, { status: result.http_status });
    }

    // ── update：更新既有策略（仅 draft/reviewed；published/retired 禁止） ─
    if (action === "update") {
      if (user.role !== "admin") return Response.json({ error: "仅店长可更新策略" }, { status: 403 });
      const { policy_id, hard_guardrails, tracks, decision_rules, status } = body;
      if (!policy_id) return Response.json({ error: "policy_id 必填" }, { status: 400 });
      if (status !== undefined) {
        return Response.json({ error: "update 禁止修改 status；状态流转仅经 publish 新版本" }, { status: 400 });
      }
      let rec: any;
      try {
        rec = await svc.entities.GuessPolicy.get(policy_id);
      } catch {
        return Response.json({ error: "策略不存在" }, { status: 404 });
      }
      if (!(await isAuthorized(svc, user, rec.clinic_id))) {
        return Response.json({ error: "无权操作该门店（租户隔离）" }, { status: 403 });
      }
      if (!canUpdatePolicy(rec.status)) {
        return Response.json(
          { ok: false, error: "已发布/退役策略不可原地修改；请通过 publish 创建新版本", current_status: rec.status },
          { status: 409 }
        );
      }
      const migrated = migrateHardGuardrails(hard_guardrails ?? rec.hard_guardrails ?? []);
      const candidate = {
        hard_guardrails: migrated,
        tracks: tracks ?? rec.tracks,
        decision_rules: decision_rules ?? rec.decision_rules,
      };
      const { valid, errors } = validatePolicyForPublish(candidate);
      if (!valid) return Response.json({ ok: false, errors }, { status: 400 });
      const patch: any = { hard_guardrails: migrated };
      if (tracks !== undefined) patch.tracks = tracks;
      if (decision_rules !== undefined) patch.decision_rules = decision_rules;
      const updated = await svc.entities.GuessPolicy.update(policy_id, patch);
      return Response.json({ ok: true, policy: updated });
    }

    // ── migrate：受控迁移同店所有 GuessPolicy 的 hard_guardrails（逐条审计） ─
    if (action === "migrate") {
      if (user.role !== "admin") return Response.json({ error: "仅店长可执行迁移" }, { status: 403 });
      if (!clinic_id) return Response.json({ error: "clinic_id 必填" }, { status: 400 });
      if (!(await isAuthorized(svc, user, clinic_id))) {
        return Response.json({ error: "无权操作该门店（租户隔离）" }, { status: 403 });
      }
      const dry_run = body.dry_run === true;
      const all = await svc.entities.GuessPolicy.filter({ clinic_id });
      const audit: any[] = [];
      let migrated = 0;
      let skipped = 0;
      let failed = 0;
      for (const rec of all) {
        const before = rec.hard_guardrails || [];
        const after = migrateHardGuardrails(before);
        const changed = JSON.stringify(after) !== JSON.stringify(before);
        if (!changed) {
          skipped++;
          audit.push({ id: rec.id, status: rec.status, policy_version: rec.policy_version, action: "skipped" });
          continue;
        }
        if (!dry_run) {
          try {
            await svc.entities.GuessPolicy.update(rec.id, { hard_guardrails: after });
            migrated++;
            audit.push({
              id: rec.id,
              status: rec.status,
              policy_version: rec.policy_version,
              action: "migrated",
              before_summary: summarizeGuardrails(before),
              after_summary: summarizeGuardrails(after),
            });
          } catch (e) {
            failed++;
            audit.push({ id: rec.id, status: rec.status, policy_version: rec.policy_version, action: "failed", error: (e as Error).message });
          }
        } else {
          migrated++;
          audit.push({ id: rec.id, status: rec.status, policy_version: rec.policy_version, action: "dry_run_migrated" });
        }
      }
      return Response.json({ ok: true, dry_run, scanned: all.length, migrated, skipped, failed, audit });
    }

    return Response.json({ error: "action 必须为 metadata / contract / publish / update / migrate" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
});

// ── 真实 Base44 SDK ops（注入编排器） ─────────────────────────────────
function makeRealOps(svc: any): any {
  return {
    findByIdempotencyKey: async (cid: string, key: string) =>
      svc.entities.GuessPolicy.filter({ clinic_id: cid, publish_idempotency_key: key }),
    findAllPolicies: async (cid: string) => svc.entities.GuessPolicy.filter({ clinic_id: cid }),
    findPublished: async (cid: string) =>
      svc.entities.GuessPolicy.filter({ clinic_id: cid, status: "published" }),
    findConfig: async (cid: string) => {
      const l = await svc.entities.ClinicConfig.filter({ clinic_id: cid });
      return l[0] || null;
    },
    createStaging: async (input: any) => svc.entities.GuessPolicy.create(input),
    recheckByIdempotencyKey: async (cid: string, key: string) =>
      svc.entities.GuessPolicy.filter({ clinic_id: cid, publish_idempotency_key: key }),
    recheckByVersion: async (cid: string, v: number) =>
      svc.entities.GuessPolicy.filter({ clinic_id: cid, policy_version: v }),
    retirePolicy: async (id: string, now: string) =>
      svc.entities.GuessPolicy.update(id, { status: "retired", retired_at: now }),
    restoreRetired: async (id: string, retired_at: any) =>
      svc.entities.GuessPolicy.update(id, { status: "published", retired_at }),
    updateConfigActive: async (cfgId: string, v: number) =>
      svc.entities.ClinicConfig.update(cfgId, { active_policy_version: v }),
    restoreConfigActive: async (cfgId: string, orig: number | null) =>
      svc.entities.ClinicConfig.update(cfgId, { active_policy_version: orig }),
    markPublished: async (id: string, now: string, uid: string) =>
      svc.entities.GuessPolicy.update(id, { status: "published", published_at: now, published_by: uid }),
    deleteStaging: async (id: string) => svc.entities.GuessPolicy.delete(id),
    // CAS 锁：owner-scoped。由 updateMany 返回的 updated===1 唯一判定成功（不重读字段比较）。
    // 短租约 + 过期接管：过期锁用精确 owner+expires_at 值 CAS 接管，崩溃不锁死门店。
    acquireLock: async (cid: string, owner: string, nowISO: string, expiresISO: string) => {
      try {
        const r1 = await svc.entities.ClinicConfig.updateMany(
          { clinic_id: cid, publish_lock_owner_id: null },
          { $set: { publish_lock_owner_id: owner, publish_lock_acquired_at: nowISO, publish_lock_expires_at: expiresISO } }
        );
        if (r1?.updated === 1) return { acquired: true };
      } catch {
        /* fall through to takeover */
      }
      try {
        const l = await svc.entities.ClinicConfig.filter({ clinic_id: cid });
        const cfg = l[0];
        if (cfg && cfg.publish_lock_owner_id && cfg.publish_lock_expires_at &&
            new Date(cfg.publish_lock_expires_at).getTime() < Date.now()) {
          const r2 = await svc.entities.ClinicConfig.updateMany(
            { clinic_id: cid, publish_lock_owner_id: cfg.publish_lock_owner_id, publish_lock_expires_at: cfg.publish_lock_expires_at },
            { $set: { publish_lock_owner_id: owner, publish_lock_acquired_at: nowISO, publish_lock_expires_at: expiresISO } }
          );
          if (r2?.updated === 1) return { acquired: true, reason: "expired_takeover" };
        }
      } catch {
        /* ignore */
      }
      return { acquired: false, reason: "lock_busy" };
    },
    releaseLock: async (cid: string, owner: string) => {
      try {
        const r = await svc.entities.ClinicConfig.updateMany(
          { clinic_id: cid, publish_lock_owner_id: owner },
          { $set: { publish_lock_owner_id: null, publish_lock_acquired_at: null, publish_lock_expires_at: null } }
        );
        return { updated: r?.updated ?? 0 };
      } catch (e) {
        return { updated: 0, error: (e as Error).message };
      }
    },
  };
}

async function computeMetadata(svc: any, clinic_id: string) {
  const all = await svc.entities.GuessPolicy.filter({ clinic_id });
  const versions = all.map((r: any) => Number(r.policy_version) || 0);
  const maxV = versions.length ? Math.max(...versions) : 0;
  let active: any = null;
  try {
    const l = await svc.entities.ClinicConfig.filter({ clinic_id });
    active = l[0]?.active_policy_version ?? null;
  } catch {
    active = null;
  }
  return {
    clinic_id,
    active_policy_version: active,
    max_policy_version: maxV || null,
    next_policy_version: maxV + 1,
    publishable_rule_codes: PUBLISHABLE_RULE_CODES,
    known_rule_codes: KNOWN_RULE_CODES,
    track_ids: TRACK_IDS,
    rule_descriptors: RULE_DESCRIPTORS,
    track_descriptors: TRACK_DESCRIPTORS,
    updatable_statuses: UPDATABLE_STATUSES,
    contract_version: CONTRACT_VERSION,
  };
}

async function isAuthorized(svc: any, user: any, clinic_id: string): Promise<boolean> {
  if (!clinic_id || !user?.id) return false;
  try {
    const cfgs = await svc.entities.ClinicConfig.filter({ clinic_id });
    if (!cfgs || cfgs.length === 0) return false;
    const managerIds = [...new Set(cfgs.map((c: any) => c.manager_id).filter(Boolean))];
    const staffByManagerId = new Map();
    for (const mid of managerIds) {
      try {
        const s = await svc.entities.Staff.get(mid);
        if (s) staffByManagerId.set(mid, s);
      } catch {
        // manager_id 可能不是 Staff.id，忽略
      }
    }
    return isAuthorizedForClinicPure(user, cfgs, staffByManagerId);
  } catch {
    return false;
  }
}

function summarizeGuardrails(g: any): string {
  try {
    return (g || [])
      .map((x: any) => (typeof x === "string" ? "legacy_str" : x?.rule_code || "obj"))
      .join(",");
  } catch {
    return "?";
  }
}