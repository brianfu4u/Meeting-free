import { createClientFromRequest } from "npm:@base44/sdk@0.8.38";

/**
 * Clinic OS V10 — GuessPolicyService（GuessPolicy 唯一发布/更新/迁移后端入口）
 *
 * R2.4 修订（本次）：
 * 1. 跨租户修复：admin 身份由 ClinicConfig.created_by_id===user.id 或
 *    ClinicConfig.manager_id→Staff.user_id===user.id 推导，**不从请求体取信 clinic_id**。
 *    publish/update/migrate 三 action 均强制 isAuthorizedForClinic 校验。
 * 2. update 不得绕过发布生命周期：移除 status 字段更新；status 仅经 publish 新版本流转。
 * 3. publish 原子性：先 create 新版本成功 → 再退役旧 published → 再更新 ClinicConfig；
 *    create 失败时旧 published 仍有效；ClinicConfig 更新失败外显为 warning（不静默）。
 * 4. update 的 clinic_id 一律取自 DB 记录 rec.clinic_id，不接受请求体 clinic_id 覆盖。
 *
 * 宪法：
 * - 写入仅店长（admin）且必须属于该门店；
 * - legacy_text 与未知 rule_code 均不得正常发布（发布校验拒绝）；
 * - clinic_id 物理隔离。
 *
 * 注：迁移/校验逻辑在本后端入口内联实现（持久化权威源），与 src/lib/composition/policyUtils.js
 * 的纯函数保持一致语义；前端纯函数仅用于客户端预校验与单测，不构成平行发布入口。
 */

const KNOWN_RULE_CODES = [
  "subject_conflict",
  "time_impossible",
  "attach_to_closed_workflow",
  "legacy_text",
];

const PUBLISHABLE_RULE_CODES = [
  "subject_conflict",
  "time_impossible",
  "attach_to_closed_workflow",
];

const TRACK_IDS = [
  "subject_fingerprint",
  "causal_chain",
  "temporal_continuity",
  "department_handoff",
  "actor_device_location",
  "document_lineage",
  "open_loop_closure",
];

function migrateHardGuardrails(guardrails: any[]): any[] {
  if (!Array.isArray(guardrails)) return [];
  return guardrails.map((g) => {
    if (typeof g === "string") {
      return { rule_code: "legacy_text", original: g };
    }
    if (g && typeof g === "object" && !Array.isArray(g)) {
      if (g.rule_code && KNOWN_RULE_CODES.includes(g.rule_code)) return g;
      return { rule_code: "legacy_text", original: JSON.stringify(g) };
    }
    return { rule_code: "legacy_text", original: String(g) };
  });
}

function validatePolicyTracks(policy: any) {
  const errors: string[] = [];
  const tracks = policy?.tracks;
  if (tracks == null) return { valid: true, errors };
  if (!Array.isArray(tracks)) return { valid: false, errors: ["tracks must be array"] };
  const known = new Set(TRACK_IDS);
  const seen = new Set<string>();
  tracks.forEach((t: any, i: number) => {
    if (!t || typeof t !== "object" || Array.isArray(t)) {
      errors.push(`tracks[${i}] must be object`);
      return;
    }
    if (!t.track_id || typeof t.track_id !== "string") {
      errors.push(`tracks[${i}].track_id missing`);
      return;
    }
    if (!known.has(t.track_id)) {
      errors.push(`tracks[${i}].track_id unknown: ${t.track_id}（固定七轨道不可替换/新增）`);
    }
    if (seen.has(t.track_id)) {
      errors.push(`tracks[${i}].track_id duplicate: ${t.track_id}`);
    }
    seen.add(t.track_id);
  });
  return { valid: errors.length === 0, errors };
}

function validatePolicyForPublish(policy: any) {
  const errors: string[] = [];
  if (!policy || typeof policy !== "object") {
    return { valid: false, errors: ["policy must be object"] };
  }
  const guardrails = policy.hard_guardrails;
  if (guardrails != null) {
    if (!Array.isArray(guardrails)) {
      return { valid: false, errors: ["hard_guardrails must be array"] };
    }
    guardrails.forEach((g: any, i: number) => {
      if (!g || typeof g !== "object" || Array.isArray(g)) {
        errors.push(`hard_guardrails[${i}] must be object`);
        return;
      }
      if (!g.rule_code || typeof g.rule_code !== "string") {
        errors.push(`hard_guardrails[${i}].rule_code missing`);
        return;
      }
      if (!PUBLISHABLE_RULE_CODES.includes(g.rule_code)) {
        errors.push(`hard_guardrails[${i}].rule_code not publishable: ${g.rule_code}`);
      }
    });
  }
  const tc = validatePolicyTracks(policy);
  return { valid: errors.length === 0 && tc.valid, errors: [...errors, ...tc.errors] };
}

function deepEqual(a: any, b: any): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 跨租户授权：admin 是否属于该门店。
 * 1) ClinicConfig.created_by_id === user.id（门店创建者即店长）；或
 * 2) ClinicConfig.manager_id 对应的 Staff.user_id === user.id。
 * 请求体 clinic_id 不得作为授权依据。
 */
async function isAuthorizedForClinic(svc: any, user: any, clinic_id: string): Promise<boolean> {
  if (!clinic_id || !user?.id) return false;
  try {
    const cfgs = await svc.entities.ClinicConfig.filter({ clinic_id });
    if (!cfgs || cfgs.length === 0) return false;
    // 1) 创建者
    if (cfgs.some((c: any) => c.created_by_id === user.id)) return true;
    // 2) manager_id → Staff.user_id
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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "未登录" }, { status: 401 });
    const svc = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const { action, clinic_id } = body || {};

    // ── publish：店长发布新版本（原子序：create → retire → config） ──────
    if (action === "publish") {
      if (user.role !== "admin") {
        return Response.json({ error: "仅店长可发布策略" }, { status: 403 });
      }
      if (!clinic_id) return Response.json({ error: "clinic_id 必填" }, { status: 400 });
      // 跨租户校验：admin 必须属于该门店（不从请求体取信）
      if (!(await isAuthorizedForClinic(svc, user, clinic_id))) {
        return Response.json({ error: "无权操作该门店（租户隔离）" }, { status: 403 });
      }
      const { policy_version, hard_guardrails, tracks, decision_rules } = body;
      if (policy_version == null) {
        return Response.json({ error: "policy_version 必填" }, { status: 400 });
      }
      const migrated = migrateHardGuardrails(hard_guardrails || []);
      const candidate = { hard_guardrails: migrated, tracks, decision_rules };
      const { valid, errors } = validatePolicyForPublish(candidate);
      if (!valid) {
        return Response.json({ ok: false, errors, policy: null }, { status: 400 });
      }
      const now = new Date().toISOString();
      // 原子序 1：先创建新版本（失败则旧 published 仍有效，安全）
      const created = await svc.entities.GuessPolicy.create({
        clinic_id,
        policy_version,
        status: "published",
        hard_guardrails: migrated,
        tracks: tracks || [],
        decision_rules: decision_rules || {},
        published_at: now,
        published_by: user.id,
      });
      // 原子序 2：新版本已落库，再退役同店旧 published
      const older = await svc.entities.GuessPolicy.filter({ clinic_id, status: "published" });
      const retireWarnings: string[] = [];
      for (const o of older) {
        if (o.id === created.id) continue;
        try {
          await svc.entities.GuessPolicy.update(o.id, { status: "retired", retired_at: now });
        } catch (e) {
          retireWarnings.push(`retire ${o.id} failed: ${(e as Error).message}`);
        }
      }
      // 原子序 3：更新 ClinicConfig.active_policy_version（失败外显为 warning，不静默）
      const configWarnings: string[] = [];
      try {
        const cfgList = await svc.entities.ClinicConfig.filter({ clinic_id });
        if (cfgList[0]) {
          await svc.entities.ClinicConfig.update(cfgList[0].id, { active_policy_version: policy_version });
        } else {
          configWarnings.push("ClinicConfig 不存在，active_policy_version 未更新");
        }
      } catch (e) {
        configWarnings.push(`ClinicConfig 更新失败: ${(e as Error).message}`);
      }
      return Response.json({
        ok: true,
        policy_id: created.id,
        policy: created,
        warnings: [...retireWarnings, ...configWarnings],
      });
    }

    // ── update：更新既有策略记录（不得绕过发布生命周期） ──────────────────
    if (action === "update") {
      if (user.role !== "admin") {
        return Response.json({ error: "仅店长可更新策略" }, { status: 403 });
      }
      const { policy_id, hard_guardrails, tracks, decision_rules, status } = body;
      if (!policy_id) return Response.json({ error: "policy_id 必填" }, { status: 400 });
      // 禁止经 update 改 status（绕过 publish 生命周期）
      if (status !== undefined) {
        return Response.json({ error: "update 禁止修改 status；状态流转仅经 publish 新版本" }, { status: 400 });
      }
      let rec: any;
      try {
        rec = await svc.entities.GuessPolicy.get(policy_id);
      } catch {
        return Response.json({ error: "策略不存在" }, { status: 404 });
      }
      // 跨租户校验：clinic_id 一律取自 DB 记录，不接受请求体覆盖
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
        } catch (e) {
          failed++;
          failed_record_ids.push(rec.id);
        }
      }
      return Response.json({ ok: true, dry_run, scanned, migrated, skipped, failed, failed_record_ids });
    }

    return Response.json({ error: "action 必须为 publish / update / migrate" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
});