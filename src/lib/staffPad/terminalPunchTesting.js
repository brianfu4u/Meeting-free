import {
  ROLE_GROUPS,
  ROLE_TO_DEPARTMENT,
} from "../departments/registry.js";

/**
 * Temporary, explicitly-scoped defaults for terminal punch testing.
 *
 * The Staff entity has no generic `STAFF` enum. `reception` is the safest
 * existing non-clinical role for a simple terminal registration/punch test.
 * Production clinics keep their existing role-selection flow.
 */
export const TEST_TERMINAL_SIGNUP_CLINICS = Object.freeze([]);
export const TEST_TERMINAL_STAFF_ROLE = "reception";
export const TEST_TERMINAL_STAFF_ROLE_GROUP = "non_clinical";
export const TEST_TERMINAL_STAFF_DEPARTMENT_ID = "front_desk";

export function isTerminalPunchTestClinic(clinicId) {
  return TEST_TERMINAL_SIGNUP_CLINICS.includes(String(clinicId || ""));
}

export function resolveTerminalSignupRole(clinicId, selectedRole) {
  return isTerminalPunchTestClinic(clinicId)
    ? TEST_TERMINAL_STAFF_ROLE
    : selectedRole;
}

export function buildStaffBindingPayload({
  clinicId,
  user,
  name,
  selectedRole,
  zone = "",
}) {
  const trimmedName = String(name || "").trim();
  if (!clinicId) throw new Error("clinic_id_required");
  if (!user?.id) throw new Error("user_id_required");
  if (!trimmedName) throw new Error("staff_name_required");

  const role = resolveTerminalSignupRole(clinicId, selectedRole);
  const roleGroup = ROLE_GROUPS[role];
  const departmentId = ROLE_TO_DEPARTMENT[role];
  if (!role || !roleGroup || !departmentId) {
    throw new Error("staff_role_invalid");
  }

  return {
    clinic_id: clinicId,
    staff_name: trimmedName,
    role,
    role_group: roleGroup,
    department_id: departmentId,
    status: "off_duty",
    pad_online: true,
    user_id: user.id,
    assigned_zone: String(zone || "").trim(),
  };
}

/**
 * A terminal punch requires only a bound Staff identity in the active clinic.
 * No admin flag or extra permission marker is required.
 */
export function canUseTerminalPunch({ staff, clinicId }) {
  if (!staff?.id || !staff?.user_id || staff.clinic_id !== clinicId) return false;
  return Boolean(ROLE_GROUPS[staff.role] && ROLE_TO_DEPARTMENT[staff.role]);
}