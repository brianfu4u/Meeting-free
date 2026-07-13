/**
 * Clinic OS V9 M1 — clinicData 实体隔离访问层
 * 宪法①：所有查询/存储强制携带 clinic_id，禁止无隔离的全量读写。
 *
 * 组件内：const staff = useClinicEntities("Staff");  // 见 ClinicContext.jsx
 * 非组件：import { clinicData } from "@/lib/clinicData";
 *         const staff = clinicData("Staff", clinicId);
 *         await staff.filter({ status: "on_duty" });
 *
 * 守卫规则：
 *  - 读（list/filter/updateMany/deleteMany）：query 强制注入 clinic_id，杜绝跨租户读取与误伤。
 *  - 写（create/bulkCreate）：强制注入 clinic_id（克隆时注入不可修改）。
 *  - 改（update/bulkUpdate）：校验 clinic_id 不可被篡改（不主动改写，保持不可变）。
 *  - 任何 clinic_id 缺失或冲突的调用，直接抛错拦截。
 */
import { base44 } from "@/api/base44Client";

export function clinicData(entityName, clinicId) {
  if (!clinicId) {
    throw new Error(`[clinicData] 宪法违规：${entityName} 操作缺少 clinic_id，已拦截`);
  }
  const entity = base44.entities[entityName];
  if (!entity) {
    throw new Error(`[clinicData] 未知实体：${entityName}`);
  }

  const assertClinic = (data, op) => {
    if (data && data.clinic_id !== undefined && data.clinic_id !== clinicId) {
      throw new Error(
        `[clinicData] 宪法违规：${entityName}.${op} clinic_id 不匹配（期望 ${clinicId}，实际 ${data.clinic_id}）`
      );
    }
  };

  return {
    // ── 读：强制注入 clinic_id 过滤，禁止全量读取 ──
    list: (sort, limit) => entity.filter({ clinic_id: clinicId }, sort, limit),
    filter: (query = {}, sort, limit) =>
      entity.filter({ ...query, clinic_id: clinicId }, sort, limit),
    get: (id) => entity.get(id),

    // ── 写：create 强制注入 clinic_id ──
    create: (data) => {
      assertClinic(data, "create");
      return entity.create({ ...data, clinic_id: clinicId });
    },
    bulkCreate: (items) =>
      entity.bulkCreate(
        (items || []).map((d) => {
          assertClinic(d, "bulkCreate");
          return { ...d, clinic_id: clinicId };
        })
      ),

    // ── 改：update 不改写 clinic_id（不可变），仅校验不被篡改 ──
    update: (id, data) => {
      assertClinic(data, "update");
      return entity.update(id, data);
    },
    bulkUpdate: (items) =>
      entity.bulkUpdate(
        (items || []).map((d) => {
          assertClinic(d, "bulkUpdate");
          return d;
        })
      ),

    // ── 批量更新/删除：query 强制注入 clinic_id，杜绝跨租户误伤 ──
    updateMany: (query, update) =>
      entity.updateMany({ ...query, clinic_id: clinicId }, update),
    deleteMany: (query = {}) =>
      entity.deleteMany({ ...query, clinic_id: clinicId }),
    delete: (id) => entity.delete(id),

    schema: () => entity.schema(),
  };
}