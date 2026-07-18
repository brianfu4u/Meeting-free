import { createClientFromRequest } from "npm:@base44/sdk@0.8.38";
import {
  CONTRACT_VERSION,
  KNOWN_RULE_CODES,
  PUBLISHABLE_RULE_CODES,
  TRACK_IDS,
  migrateHardGuardrails,
  validatePolicyTracks,
  validatePolicyForPublish,
  buildContract,
} from "./contract.ts";

/**
 * Clinic OS V10 — GuessPolicyService（GuessPolicy 唯一发布/更新/迁移后端入口）
 *
 * R2.4 Phase2 修订：
 * 1. 版本单调：policy_version 不得信任前端输入；服务端计算 next_version = max+1。
 *    调用方传入版本必须等于 next_version，否则 409；拒绝重复/低版本。
 * 2. 发布补偿（真正原子）：create staging(draft) → 快照旧 published + 原 active →
 *    retire 旧 → 更新 ClinicConfig → 标记 staging published。任一步失败回滚旧状态并
 *    删除暂存记录，返回非 2xx；禁止 ok:true+warnings 表示生命周期关键步骤失败。
 * 3. 请求幂等：publish_idempotency_key 重复请求只产生一条 Policy。
 * 4. 共享契约：KNOWN/PUBLISHABLE_RULE_CODES、TRACK_IDS、迁移/校验逻辑全部来自
 *    ./contract.ts（单一权威源），前端不再复制。
 * 5. 只读 action：metadata（active/max/next + 可发布规则 + 轨道 + 契约版本）、
 *    contract（返回 buildContract）。
 * 6. 跨租户授权：isAuthorizedForClinic 不从请求体取信 clinic_id。
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

    // ── metadata：只读，返回版本与可发布规则（需授权） ──────────────────
    if (action === "metadata") {
      if (user.role !== "admin") {
        return Response.json({ error: "仅店长可查看策略元数据" }, { status: 403 });
      }
      if (!clinic_id) return Response.json({ error: "clinic_id 必填" }, { status: 400 });
      if (!(await isAuthorizedForClinic(svc, user, clinic_id))) {
        return Response.json({ error: "无权操作该门店（租户隔离）" }, { status: 403 });
      }
      const meta = await computeMetadata(svc, clinic_id);
      return Response.json({ ok: true, ...meta });
    }

    // ── publish：店长发布新版本（版本单调 + 幂等 + 补偿回滚） ────────────
    if (action === "publish") {
      if (user.role !== "admin") {
        return Response.json({ error: "仅店长可发布策略" }, { status: 403 });
      }
      if (!clinic_id) return Response.json({ error: "clinic_id 必填" }, { status: 400 });
      if (!(await isAuthorizedForClinic(svc, user, clinic_id))) {
        return Response.json({ error: "无权操作该门店（租户隔离）" }, { status: 403 });
      }
      const { hard_guardrails, tracks, decision_rules, policy_version, idempotency_key } = body;

      // 版本单调：服务端计算 next_version
      const meta = await computeMetadata(svc, clinic_id);
      const nextV = meta.next_policy_version;
      if (policy_version != null && Number(policy_version) !== nextV) {
        return Response.json(
          { ok: false, error: "版本冲突：必须等于服务端 next_version", next_version: nextV, provided: Number(policy_version) },
          { status: 409 }
        );
      }
      const finalVersion = nextV;

      // 幂等：相同 idempotency_key 已存在则直接返回既有 Policy
      if (idempotency_key) {
        const existing = await svc.entities.GuessPolicy.filter({
          clinic_id,
          publish_idempotency_key: idempotency_key,
        });
        if (existing && existing.length > 0) {
          return Response.json({
            ok: true,
            idempotent: true,
            policy_id: existing[0].id,
            policy: existing[0],
            next_version: nextV,
          });
        }
      }

      // 发布校验
      const migrated = migrateHardGuardrails(hard_guardrails || []);
      const candidate = { hard_guardrails: migrated, tracks, decision_rules };
      const { valid, errors } = validatePolicyForPublish(candidate);
      if (!valid) {
        return Response.json({ ok: false, errors, policy: null }, { status: 400 });
      }

      const now = new Date().toISOString();

      // 步骤 1：创建暂存记录（draft，未发布）
      let staging: any;
      try {
        staging = await svc.entities.GuessPolicy.create({
          clinic_id,
          policy_version: finalVersion,
          status: "draft",
          hard_guardrails: migrated,
          tracks: tracks || [],
          decision_rules: decision_rules || {},
          publish_idempotency_key: idempotency_key || null,
        });
      } catch (e) {
        return Response.json({ ok: false, error: "暂存创建失败", detail: (e as Error).message }, { status: 500 });
      }

      // 步骤 2：快照旧 published + 原 active version
      const older = await svc.entities.GuessPolicy.filter({ clinic_id, status: "published" });
      const oldSnap = older.map((o: any) => ({ id: o.id, retired_at: o.retired_at }));
      let cfgRec: any = null;
      let originalActive: any = undefined;
      try {
        const cfgList = await svc.entities.ClinicConfig.filter({ clinic_id });
        cfgRec = cfgList[0] || null;
        originalActive = cfgRec?.active_policy_version ?? null;
      } catch {
        // 读取失败后续按无 config 处理
      }

      // 步骤 3：退役旧 published
      try {
        for (const o of older) {
          await svc.entities.GuessPolicy.update(o.id, { status: "retired", retired_at: now });
        }
      } catch (e) {
        await safeDelete(svc, staging.id);
        return Response.json({ ok: false, error: "退役旧版本失败，已回滚", detail: (e as Error).message }, { status: 500 });
      }

      // 步骤 4：更新 ClinicConfig.active_policy_version
      if (!cfgRec) {
        // 无 config 视为生命周期失败：回滚旧 published + 删除暂存
        await restoreOlder(svc, oldSnap);
        await safeDelete(svc, staging.id);
        return Response.json({ ok: false, error: "ClinicConfig 不存在，已回滚" }, { status: 500 });
      }
      try {
        await svc.entities.ClinicConfig.update(cfgRec.id, { active_policy_version: finalVersion });
      } catch (e) {
        await restoreOlder(svc, oldSnap);
        await safeDelete(svc, staging.id);
        return Response.json({ ok: false, error: "ClinicConfig 更新失败，已回滚", detail: (e as Error).message }, { status: 500 });
      }

      // 步骤 5：标记暂存为 published（最后一步，全部成功后）
      try {
        const published = await svc.entities.GuessPolicy.update(staging.id, {
          status: "published",
          published_at: now,
          published_by: user.id,
        });
        return Response.json({
          ok: true,
          policy_id: published.id,
          policy: published,
          next_version: nextV,
        });
      } catch (e) {
        // 关键失败：config 已更新但发布标记失败 → 回滚 config + 旧 published + 删除暂存
        try {
          await svc.entities.ClinicConfig.update(cfgRec.id, { active_policy_version: originalActive });
        } catch {}
        await restoreOlder(svc, oldSnap);
        await safeDelete(svc, staging.id);
        return Response.json({ ok: false, error: "发布标记失败，已回滚", detail: (e as Error).message }, { status: 500 });
      }
    }

    // ── update：更新既有策略记录（不得绕过发布生命周期） ──────────────────
    if (action === "update") {
      if (user.role !== "admin") {
        return Response.json({ error: "仅店长可更新策略" }, { status: 403 });
      }
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
      if (!(await isAuthorizedForClinic(svc, user, rec.clinic_id))) {
        return Response.json({ error: "无权操作该门店（租户隔离）" }, { status: 403 });
      }
      const migrated = migrateHardGuardrails(hard_guardrails ?? rec.hard_guardrails ?? []);
      const candidate = {
        hard_guardrails: migrated,
        tracks: tracks ?? rec.tracks,
        decision_rules: decision_rules ?? rec.decision_rules,
      };
      const { valid, errors } = validatePolicyForPublish(candidate);
      if (!valid) {
        return Response.json({ ok: false, errors, policy: null }, { status: 400 });
      }
      const patch: any = { hard_guardrails: migrated };
      if (tracks !== undefined) patch.tracks = tracks;
      if (decision_rules !== undefined) patch.decision_rules = decision_rules;
      const updated = await svc.entities.GuessPolicy.update(policy_id, patch);
      return Response.json({ ok: true, policy: updated });
    }

    // ── migrate：幂等迁移同店所有 GuessPolicy 的 hard_guardrails ──────────
    if (action === "migrate") {
      if (user.role !== "admin") {
        return Response.json({ error: "仅店长可执行迁移" }, { status: 403 });
      }
      if (!clinic_id) return Response.json({ error: "clinic_id 必填" }, { status: 400 });
      if (!(await isAuthorizedForClinic(svc, user, clinic_id))) {
        return Response.json({ error: "无权操作该门店（租户隔离）" }, { status: 403 });
      }
      const dry_run = body.dry_run === true;
      const all = await svc.entities.GuessPolicy.filter({ clinic_id });
      let scanned = all.length;
      let migrated = 0;
      let skipped = 0;
      let failed = 0;
      const failed_record_ids: string[] = [];
      for (const rec of all) {
        try {
          const current = rec.hard_guardrails || [];
          const migratedGuardrails = migrateHardGuardrails(current);
          if (deepEqual(migratedGuardrails, current)) {
            skipped++;
            continue;
          }
          if (!dry_run) {
            await svc.entities.GuessPolicy.update(rec.id, { hard_guardrails: migratedGuardrails });
          }
          migrated++;
        } catch {
          failed++;
          failed_record_ids.push(rec.id);
        }
      }
      return Response.json({ ok: true, dry_run, scanned, migrated, skipped, failed, failed_record_ids });
    }

    return Response.json({ error: "action 必须为 metadata / contract / publish / update / migrate" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
});

// ── helpers ───────────────────────────────────────────────────────────

async function computeMetadata(svc: any, clinic_id: string) {
  const all = await svc.entities.GuessPolicy.filter({ clinic_id });
  const versions = all.map((r: any) => Number(r.policy_version) || 0);
  const maxV = versions.length ? Math.max(...versions) : 0;
  let active: any = null;
  try {
    const cfgList = await svc.entities.ClinicConfig.filter({ clinic_id });
    active = cfgList[0]?.active_policy_version ?? null;
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
    contract_version: CONTRACT_VERSION,
  };
}

async function isAuthorizedForClinic(svc: any, user: any, clinic_id: string): Promise<boolean> {
  if (!clinic_id || !user?.id) return false;
  try {
    const cfgs = await svc.entities.ClinicConfig.filter({ clinic_id });
    if (!cfgs || cfgs.length === 0) return false;
    if (cfgs.some((c: any) => c.created_by_id === user.id)) return true;
    for (const c of cfgs) {
      if (!c.manager_id) continue;
      try {
        const staff = await svc.entities.Staff.get(c.manager_id);
        if (staff && staff.user_id === user.id) return true;
      } catch {
        // manager_id 可能不是 Staff.id，忽略
      }
    }
  } catch {
    return false;
  }
  return false;
}

async function restoreOlder(svc: any, oldSnap: { id: string; retired_at: any }[]) {
  for (const o of oldSnap) {
    try {
      await svc.entities.GuessPolicy.update(o.id, { status: "published", retired_at: o.retired_at ?? null });
    } catch {
      // 尽力恢复
    }
  }
}

async function safeDelete(svc: any, id: string) {
  try {
    await svc.entities.GuessPolicy.delete(id);
  } catch {
    // 尽力清理暂存
  }
}

function deepEqual(a: any, b: any): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}