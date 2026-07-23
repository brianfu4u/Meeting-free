// Shared clinic actor resolution for backend functions.
// Resolves an authenticated platform user to a clinic-scoped actor
// (clinic staff or admin manager). Pure module — no Deno.serve.
//
// Usage:
//   import { resolveClinicActor } from "../../shared/clinicActor.ts";
//   const actor = await resolveClinicActor(base44.asServiceRole, user, clinicId, {
//     requireOnDuty: true,   // ingestion: reject off_duty staff
//     staffRole: "admin",   // role label assigned to the staff path
//   });
//
// Options:
//   requireOnDuty (default false): when true, an off_duty staff is treated as
//     "no staff mapping" and the function falls through to the admin-manager
//     check — preserving the legacy ingestion gate semantics.
//   staffRole (default "admin"): role value returned for the staff path. Use
//     "staff" when callers need to distinguish non-manager staff from the
//     clinic manager (e.g. per-owner undo list access control).
export async function resolveClinicActor(svc, user, clinicId, options = {}) {
  const { requireOnDuty = false, staffRole = "admin" } = options;
  if (typeof clinicId !== "string" || clinicId.trim() === "") return null;
  const staffRows = await svc.entities.Staff.filter({ user_id: user.id });
  let staff = null;
  if (requireOnDuty) {
    staff = (staffRows || []).find(
      (s) => s && s.clinic_id === clinicId && s.status !== "off_duty"
    );
  } else {
    staff = (staffRows || []).find((s) => s && s.clinic_id === clinicId);
  }
  if (!staff) {
    if (user.role === "admin") {
      const configs = await svc.entities.ClinicConfig.filter({ clinic_id: clinicId });
      const config = configs?.[0];
      if (config && config.manager_id === user.id) {
        return { user_id: user.id, clinic_id: clinicId, staff_id: user.id, role: "admin" };
      }
    }
    return null;
  }
  return {
    user_id: user.id,
    clinic_id: clinicId,
    staff_id: staff.id,
    role: staffRole,
  };
}