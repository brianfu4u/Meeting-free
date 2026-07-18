import { createClientFromRequest } from "npm:@base44/sdk@0.8.38";

/**
 * Clinic OS V10 — GuessPolicyService（GuessPolicy 唯一发布/更新/迁移后端入口）
 *
 * R2.4：项目此前无真实 GuessPolicy publish/update 持久化入口。本函数是唯一入口，
 * 所有调用方必须经此发布/更新策略；禁止产生平行入口（不再仅靠纯函数包装）。
 *
 * 三个 action：
 * 1. publish  — 店长发布新版本：迁移 hard_guardrails → 发布校验 → 通过才写库（status=published），
 *               并退役同店旧的 published 版本，更新 ClinicConfig.active_policy_version。
 * 2. update   — 更新既有策略记录：迁移 → 发布校验 → 通过才写库。
 * 3. migrate   — 扫描同店所有 GuessPolicy，对 hard_guardrails 执行幂等迁移（字符串/未知结构 → legacy_text）；
 *               返回 scanned/migrated/failed/failed_ids；已迁移记录重复运行不重复修改（migrated=0）。
 *
 * 宪法：
 * - 写入仅店长（admin）；
 * - legacy_text 与未知 rule_code 均不得正常发布（发布校验拒绝）；
 * - clinic_id 物理隔离。
 *
 * 注：迁移/校验逻辑在本后端入口内联实现（持久化权威源），与 src/lib/composition/policyUtils.js
 * 的纯函数保持一致语义；前端纯函数用于客户端预校验与单测。
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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "未登录" }, { status: 401 });
    const svc = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const { action, clinic_id } = body || {};

    // ── publish：店长发布新版本 ──────────────────────────────────────────
    if (action === "publish") {
      if (user.role !== "admin") {
        return Response.json({ error: "仅店长可发布策略" }, { status: 403 });
      }
      if (!clinic_id) return Response.json({ error: "clinic_id 必填" }, { status: 400 });
      const { policy_version, hard_guardrails, tracks, decision_rules } = body;
      if (policy_version == null) {
        return Response.json({ error: "policy_version 必填" }, { status: 400 });
      }
      const migrated = migrateHardGuardrails(hard_guardrails || []);
      const candidate = { hard_guardrails: migrated, tracks, decision_rules };
      const { valid, errors } = validatePolicyForPublish(candidate);
      if (!valid) {
        // 写入前拒绝非法 Policy：不落库
        return Response.json({ ok: false, errors, policy: null }, { status: 400 });
      }
      const now = new Date().toISOString();
      // 退役同店旧的 published 版本
      const older = await svc.entities.GuessPolicy.filter({ clinic_id, status: "published" });
      for (const o of older) {
        await svc.entities.GuessPolicy.update(o.id, { status: "retired", retired_at: now });
      }
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
      // 更新 ClinicConfig.active_policy_version
      try {
        const cfgList = await svc.entities.ClinicConfig.filter({ clinic_id });
        if (cfgList[0]) {
          await svc.entities.ClinicConfig.update(cfgList[0].id, { active_policy_version: policy_version });
        }
      } catch { /* ClinicConfig 可能未配置，忽略 */ }
      return Response.json({ ok: true, policy_id: created.id, policy: created });
    }

    // ── update：更新既有策略记录 ─────────────────────────────────────────
    if (action === "update") {
      if (user.role !== "admin") {
        return Response.json({ error: "仅店长可更新策略" }, { status: 403 });
      }
      const { policy_id, hard_guardrails, tracks, decision_rules, status } = body;
      if (!policy_id) return Response.json({ error: "policy_id 必填" }, { status: 400 });
      let rec: any;
      try {
        rec = await svc.entities.GuessPolicy.get(policy_id);
      } catch {
        return Response.json({ error: "策略不存在" }, { status: 404 });
      }
      if (clinic_id && rec.clinic_id !== clinic_id) {
        return Response.json({ error: "clinic_id 不匹配（租户隔离）" }, { status: 403 });
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
      if (status !== undefined) patch.status = status;
      const updated = await svc.entities.GuessPolicy.update(policy_id, patch);
      return Response.json({ ok: true, policy: updated });
    }

    // ── migrate：幂等迁移同店所有 GuessPolicy 的 hard_guardrails ──────────
    // dry_run=true 时仅统计不写库；返回 scanned/migrated/skipped/failed/failed_record_ids。
    // 幂等：已结构化（迁移后与现有一致）的记录计入 skipped，不重复修改；二次运行 migrated 必为 0。
    if (action === "migrate") {
      if (user.role !== "admin") {
        return Response.json({ error: "仅店长可执行迁移" }, { status: 403 });
      }
      if (!clinic_id) return Response.json({ error: "clinic_id 必填" }, { status: 400 });
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
          // 幂等：若迁移后与现有一致，则计入 skipped，不重复修改
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