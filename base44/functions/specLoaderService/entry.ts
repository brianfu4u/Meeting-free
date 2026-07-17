import { createClientFromRequest } from "npm:@base44/sdk@0.8.38";

/**
 * Clinic OS V10 — SpecLoaderService（SPEC 编组规则引擎）
 *
 * 职责：管理各部门 SOP 操作手册 → LLM 压缩为「编组规则摘要」→ 供 pipelineEngine 编组代理读取
 *
 * 三种 action：
 * 1. load_all   → Agent 读取所有部门的编组摘要（供编组决策，无需重读全文）
 * 2. reload     → 店长重新加载：遍历所有 SOP 文档，LLM 重新生成 digest（仅 admin）
 * 3. update_sop → 店长更新某部门 SOP 文档（仅 admin，更新后需手动 reload 刷新摘要）
 *
 * V10 宪法：
 * - 读取（load_all）对所有登录用户开放（Agent 也需读取）
 * - 写入（reload / update_sop）仅店长（admin）权限
 * - clinic_id 物理隔离
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "未登录" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { action, clinic_id, department, sop_document } = body || {};
    const svc = base44.asServiceRole;

    // ── load_all：Agent 读取编组规则摘要 ─────────────────────────────────
    if (action === "load_all") {
      if (!clinic_id) return Response.json({ error: "clinic_id 必填" }, { status: 400 });
      const specs = await svc.entities.SystemSpec.filter({ clinic_id }, "department", 100);
      return Response.json({
        ok: true,
        clinic_id,
        total: specs.length,
        departments: specs.map((s) => ({
          department: s.department,
          department_name: s.department_name,
          department_group: s.department_group,
          sop_digest: s.sop_digest || "",
          spec_version: s.spec_version || 0,
          loaded_at: s.loaded_at || null,
        })),
      });
    }

    // ── 以下为写入操作：仅店长（admin） ───────────────────────────────────
    if (action === "reload") {
      if (user.role !== "admin") {
        return Response.json({ error: "仅店长可重新加载 SPEC" }, { status: 403 });
      }
      if (!clinic_id) return Response.json({ error: "clinic_id 必填" }, { status: 400 });
      const specs = await svc.entities.SystemSpec.filter({ clinic_id });
      if (specs.length === 0) {
        return Response.json({ error: "该门店暂无 SOP 记录，请先预置出厂版本" }, { status: 404 });
      }

      let reloaded = 0;
      for (const spec of specs) {
        let digest = "";
        try {
          const res = await svc.integrations.Core.InvokeLLM({
            prompt: `你是诊所运营规范解析引擎（Clinic OS V10）。请将以下 SOP 操作手册压缩为「编组规则摘要」，供 AI 编组代理在事件流合并决策时快速读取。

要求（紧凑文本，≤200字）：
1. 车头事件：哪些事件会开启一条新的工作流（火车头）
2. 车厢顺序：事件的前驱→后继关系链
3. 末端车厢：哪些事件出现意味着该工作流接近闭环
4. 禁止合并：哪些事件不应并入患者诊疗流（如行政/打卡/设备维护）

输出 JSON：{ "digest": "紧凑摘要文本" }

部门：${spec.department_name}（${spec.department}）

SOP 文档：
${spec.sop_document}`,
            response_json_schema: {
              type: "object",
              properties: { digest: { type: "string" } },
            },
          });
          digest = res?.digest || "";
        } catch {
          digest = "[摘要生成失败，降级使用原文片段]\n" + (spec.sop_document || "").slice(0, 200);
        }

        await svc.entities.SystemSpec.update(spec.id, {
          sop_digest: digest,
          spec_version: (spec.spec_version || 0) + 1,
          loaded_at: new Date().toISOString(),
          updated_by: user.id,
        });
        reloaded++;
      }

      return Response.json({
        ok: true,
        reloaded,
        message: `SPEC 已重新加载，${reloaded} 个部门的编组规则摘要已刷新`,
      });
    }

    // ── update_sop：店长更新某部门 SOP 文档 ──────────────────────────────
    if (action === "update_sop") {
      if (user.role !== "admin") {
        return Response.json({ error: "仅店长可更新 SOP" }, { status: 403 });
      }
      if (!clinic_id || !department || !sop_document) {
        return Response.json({ error: "clinic_id / department / sop_document 必填" }, { status: 400 });
      }
      const existing = await svc.entities.SystemSpec.filter({ clinic_id, department }, "-spec_version", 1);
      if (!existing[0]) {
        return Response.json({ error: "该部门 SOP 不存在，请联系管理员预置出厂版本" }, { status: 404 });
      }
      await svc.entities.SystemSpec.update(existing[0].id, {
        sop_document,
        updated_by: user.id,
      });
      return Response.json({
        ok: true,
        message: "SOP 文档已更新，请执行 reload 刷新编组规则摘要",
        department,
      });
    }

    return Response.json({ error: "action 必须为 load_all / reload / update_sop" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
});