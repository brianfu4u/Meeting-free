// UndoListService — Clinic OS 次日回流
// 员工未匹配证据的次日补充/移交处理入口。
// 与 compositionOrchestrator 解耦：本服务只负责查询与员工 resolve，
// UndoListItem 的生成由 compositionOrchestrator run 收尾负责。
import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import { resolveClinicActor } from "../../shared/clinicActor.ts";

const ACTIONS = new Set(["list_undo_items", "resolve_undo_item"]);
const RESOLUTION_TYPES = new Set(["self_supplement", "handoff"]);

function makeResponse(http_status: number, body: Record<string, unknown>) {
  return { ok: http_status >= 200 && http_status < 300, http_status, ...body };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

async function resolveActor(base44, user, requestedClinicId) {
  // 次日回流：不要求在岗（off_duty 员工仍可查看/处理自己的待补清单），
  // 员工路径标记为 "staff" 以便按 original_uploader_id 做归属校验。
  return resolveClinicActor(base44.asServiceRole, user, requestedClinicId, {
    requireOnDuty: false,
    staffRole: "staff",
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json(makeResponse(405, { error_code: "method_not_allowed" }), { status: 405 });
  }
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    return Response.json(await handleRequest(base44, body), { status: 200 });
  } catch {
    return Response.json(makeResponse(500, { error_code: "internal_error" }), { status: 500 });
  }
});

async function handleRequest(base44: any, body: any) {
  const action = body?.action;
  if (!ACTIONS.has(action)) return makeResponse(400, { error_code: "action_invalid" });

  const user = await base44.auth.me();
  if (!user) return makeResponse(401, { error_code: "unauthenticated" });

  const actor = await resolveActor(base44, user, body.clinic_id);
  if (!actor) return makeResponse(403, { error_code: "tenant_scope_violation" });

  if (action === "list_undo_items") return listUndoItems(base44, body, actor);
  if (action === "resolve_undo_item") return resolveUndoItem(base44, body, actor);
  return makeResponse(400, { error_code: "action_invalid" });
}

// 改动点2：终端登录拉取接口
// 按 business_date 升序返回，不做时间截断，历史多久都全部返回。
async function listUndoItems(base44: any, body: any, actor: any) {
  const svc = base44.asServiceRole;
  const rows = await svc.entities.UndoListItem.filter({
    clinic_id: actor.clinic_id,
    original_uploader_id: actor.staff_id,
    status: "pending",
  });
  const items = (rows || [])
    .filter((item: any) => item && item.business_date)
    .sort((a: any, b: any) => String(a.business_date).localeCompare(String(b.business_date)));
  return makeResponse(200, {
    items: items.map((item: any) => ({
      id: item.id,
      artifact_id: item.artifact_id,
      fact_card_id: item.fact_card_id || null,
      business_date: item.business_date,
      unmatched_reason_codes: item.unmatched_reason_codes || [],
      status: item.status,
      created_by_run_id: item.created_by_run_id || null,
    })),
    count: items.length,
  });
}

// 改动点3：员工处理动作的两条分支
async function resolveUndoItem(base44: any, body: any, actor: any) {
  if (!isNonEmptyString(body.undo_item_id)) {
    return makeResponse(400, { error_code: "undo_item_id_required" });
  }
  const resolutionType = body.resolution_type;
  if (!RESOLUTION_TYPES.has(resolutionType)) {
    return makeResponse(400, { error_code: "resolution_type_invalid" });
  }

  const svc = base44.asServiceRole;
  const item = await svc.entities.UndoListItem.get(body.undo_item_id).catch(() => null);
  if (!item) return makeResponse(404, { error_code: "undo_item_not_found" });
  if (item.clinic_id !== actor.clinic_id) {
    return makeResponse(403, { error_code: "tenant_scope_violation" });
  }
  if (item.status !== "pending") {
    return makeResponse(409, { error_code: "undo_item_not_pending" });
  }
  // 仅归属人或店长可处理
  if (actor.role !== "admin" && item.original_uploader_id !== actor.staff_id) {
    return makeResponse(403, { error_code: "not_owner" });
  }

  const now = new Date().toISOString();

  if (resolutionType === "self_supplement") {
    // 车厢连车厢：新车厢直接引用旧车厢，两者绑成一组证据，
    // 交由下次编组重新判断，不涉及任何 workflow 中介。
    // 孤儿车厢本来就没有 source_workflow_id，不再复制该字段。
    const newArtifactId = body.new_artifact_id;
    if (!isNonEmptyString(newArtifactId)) {
      return makeResponse(400, { error_code: "new_artifact_id_required" });
    }
    const newArtifact = await svc.entities.Artifact.get(newArtifactId).catch(() => null);
    if (!newArtifact) return makeResponse(404, { error_code: "new_artifact_not_found" });
    if (newArtifact.clinic_id !== actor.clinic_id) {
      return makeResponse(403, { error_code: "tenant_scope_violation" });
    }
    // 在新车厢上打"引用旧车厢"标记，供下次编组识别为同组证据
    await svc.entities.Artifact.update(newArtifactId, {
      linked_undo_artifact_id: item.artifact_id,
    });
    const updated = await svc.entities.UndoListItem.update(body.undo_item_id, {
      status: "resolved",
      resolution_type: "self_supplement",
      linked_artifact_id: newArtifactId,
      resolved_at: now,
    });
    return makeResponse(200, { undo_item: updated });
  }

  // handoff：弱关联，只标记状态，不做强制关联。
  // 新车厢由同事在终端另行提交，走正常 Agent 候选匹配（部门/主体/时间窗）。
  const updated = await svc.entities.UndoListItem.update(body.undo_item_id, {
    status: "resolved",
    resolution_type: "handoff",
    resolved_at: now,
  });
  return makeResponse(200, { undo_item: updated, explicit_workflow_id_inherited: false });
}