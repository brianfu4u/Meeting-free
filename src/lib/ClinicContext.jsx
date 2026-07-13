/**
 * Clinic OS V9 M1 — ClinicContext
 * 宪法①：clinic_id 是门店唯一标识，物理隔离字段，全应用唯一真源。
 * 下游 clinicData / eventBus 均依赖此真源，无 clinic_id 拒绝运行。
 */
import { createContext, useContext, useMemo } from "react";
import { clinicData } from "@/lib/clinicData";

const ClinicContext = createContext(null);

export function ClinicProvider({ clinicId, children }) {
  if (!clinicId) {
    throw new Error("[ClinicContext] 宪法违规：ClinicProvider 必须传入非空 clinicId");
  }
  const value = useMemo(() => ({ clinicId }), [clinicId]);
  return <ClinicContext.Provider value={value}>{children}</ClinicContext.Provider>;
}

export function useClinicId() {
  const ctx = useContext(ClinicContext);
  if (!ctx?.clinicId) {
    throw new Error("[ClinicContext] useClinicId 必须在 ClinicProvider 内调用");
  }
  return ctx.clinicId;
}

/**
 * 组件内获取受隔离守卫的实体操作句柄。
 * 自动绑定当前 clinic_id，缺失或冲突时调用即抛错。
 * 用法：const staff = useClinicEntities("Staff"); await staff.filter({ status: "on_duty" });
 */
export function useClinicEntities(entityName) {
  const clinicId = useClinicId();
  return useMemo(() => clinicData(entityName, clinicId), [entityName, clinicId]);
}