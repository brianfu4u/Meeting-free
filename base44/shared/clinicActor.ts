// Shared clinic actor resolution for backend functions.
// Resolves an authenticated platform user to a clinic-scoped actor
// (clinic staff or admin manager). Pure module — no Deno.serve.
//
// Usage:
//   import { resolveClinicActor } from "../../shared/clinicActor.ts";
//   const actor = await resolveClinicActor(base44.asServiceRole, user, clinicId, {
//     requireOnDuty: true,   // ingestion: normally reject off_duty staff
//     staffRole: "admin",   // role label assigned to the staff path
//   });
//
// Options:
//   requireOnDuty (default false): when true, an off_duty staff is normally
//     treated as "no staff mapping" and the function falls through to the
//     admin-manager check.
//   staffRole (default "admin"): role value returned for the staff path. Use
//     "staff" when callers need to distinguish non-manager staff from the
//     clinic manager (e.g. per-owner undo list access control).
//
// Temporary single-clinic upload policy:
//   clinic-001 is the application's current default clinic. During terminal
//   photo-upload testing, a user who is already bound to a Staff row in
//   clinic-001 may upload while off_duty. This relaxes only the legacy on-duty
//   gate; exact clinic_id equality and Staff.user_id binding remain mandatory.
export const DEFAULT_SINGLE_CLINIC_UPLOAD_TEST_ID = "clinic-001";
export const SAME_CLINIC_OFF_DUTY_TEST_REASON = "same_clinic_off_duty_upload_test";

export function canRelaxDefaultClinicOnDutyGate({ clinicId, staff, requireOnDuty }) {
  return Boolean(
    requireOnDuty === true &&
    clinicId === DEFAULT_SINGLE_CLINIC_UPLOAD_TEST_ID &&
    staff &&
    staff.clinic_id === clinicId &&
    staff.status === "off_duty"
  );
}

export async function resolveClinicActor(svc, user, clinicId, options = {}) {
  const { requireOnDuty = false, staffRole = "admin" } = options;
  if (typeof clinicId !== "string" || clinicId.trim() === "") return null;

  const staffRows = await svc.entities.Staff.filter({ user_id: user.id });
  const sameClinicStaff = (staffRows || []).find(
    (s) => s && s.user_id === user.id && s.clinic_id === clinicId
  ) || null;

  let staff = null;
  let tenantScopeRelaxed = false;
  if (requireOnDuty) {
    if (sameClinicStaff && sameClinicStaff.status !== "off_duty") {
      staff = sameClinicStaff;
    } else if (canRelaxDefaultClinicOnDutyGate({ clinicId, staff: sameClinicStaff, requireOnDuty })) {
      staff = sameClinicStaff;
      tenantScopeRelaxed = true;
    }
  } else {
    staff = sameClinicStaff;
  }

  if (!staff) {
    if (user.role === "admin") {
      const configs = await svc.entities.ClinicConfig.filter({ clinic_id: clinicId });
      const config = configs?.[0];
      if (config && config.manager_id === user.id) {
        return {
          user_id: user.id,
          clinic_id: clinicId,
          staff_id: user.id,
          role: "admin",
          tenant_scope_relaxed: false,
          tenant_scope_relaxation_reason: null,
        };
      }
    }
    return null;
  }

  return {
    user_id: user.id,
    clinic_id: clinicId,
    staff_id: staff.id,
    role: staffRole,
    tenant_scope_relaxed: tenantScopeRelaxed,
    tenant_scope_relaxation_reason: tenantScopeRelaxed
      ? SAME_CLINIC_OFF_DUTY_TEST_REASON
      : null,
  };
}
