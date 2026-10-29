export type EmployeeInvitation = { company_name: string; email: string; full_name: string; role_name: string; employee_code: string; expires_at: string; existing_user: boolean };
export type InvitationAcknowledgment = { ok: true; company_name: string; employee_code: string };
export type IdentityPhase = "idle" | "pending" | "acknowledged" | "confirmed" | "unknown";
export type CompanyFields = { name: string; country_code: string; timezone: string; currency: string; business_type: string; team_size: string; financial_year_start_month: string };
export const COMPANY_DEFAULTS: CompanyFields = { name: "", country_code: "BD", timezone: "Asia/Dhaka", currency: "BDT", business_type: "Software & IT Services", team_size: "2-5", financial_year_start_month: "7" };
export type CompanyMembership = { organization: { id: string; name: string; slug: string; status: string; country_code: string; timezone: string; currency: string; business_type: string | null; team_size: string | null; financial_year_start_month: number; setup_completed: boolean; created_by_user_id: string }; membership_id: string; role_id: string; role: string; role_name: string; role_slug: string; status: string; is_owner: boolean; relationships: string[]; primary_relationship: string; permissions: string[] };
const record = (x: unknown): x is Record<string, unknown> => Boolean(x && typeof x === "object" && !Array.isArray(x));
const text = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;
const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every(text);
export function isEmployeeInvitation(x: unknown): x is EmployeeInvitation {
  return record(x) && ["company_name", "email", "full_name", "role_name", "employee_code"].every(k => text(x[k])) && text(x.expires_at) && Number.isFinite(Date.parse(x.expires_at)) && typeof x.existing_user === "boolean";
}
export function isInvitationAcknowledgment(x: unknown, preview: EmployeeInvitation): x is InvitationAcknowledgment {
  return record(x) && x.ok === true && x.company_name === preview.company_name && x.employee_code === preview.employee_code;
}
export function invitationInputError(password: string, confirmation: string) {
  if (password.length < 8 || password.length > 128) return "Use a password between 8 and 128 characters.";
  return password !== confirmation ? "Passwords do not match." : null;
}
export function isCompanyMembership(x: unknown): x is CompanyMembership {
  if (!record(x) || !record(x.organization)) return false;
  const o = x.organization;
  return ["id", "name", "slug", "status", "country_code", "timezone", "currency", "created_by_user_id"].every(k => text(o[k]))
    && ["business_type", "team_size"].every(k => o[k] === null || typeof o[k] === "string")
    && Number.isInteger(o.financial_year_start_month) && Number(o.financial_year_start_month) >= 1 && Number(o.financial_year_start_month) <= 12 && typeof o.setup_completed === "boolean"
    && ["membership_id", "role_id", "role", "role_name", "role_slug", "status", "primary_relationship"].every(k => text(x[k]))
    && typeof x.is_owner === "boolean" && strings(x.relationships) && strings(x.permissions);
}
export function isCompanyMemberships(x: unknown): x is CompanyMembership[] { return Array.isArray(x) && x.every(isCompanyMembership); }
/** Keep the existing seven-field wire contract and original numeric month. */
export function companyPayload(fields: CompanyFields) {
  return { name: fields.name, country_code: fields.country_code, timezone: fields.timezone, currency: fields.currency, business_type: fields.business_type, team_size: fields.team_size, financial_year_start_month: Number(fields.financial_year_start_month) };
}
export function companyInputError(v: CompanyFields) {
  if (v.name.trim().length < 2 || v.name.length > 180) return "Enter a company name between 2 and 180 characters.";
  if (!v.country_code || !v.currency || !v.timezone || !v.business_type || !v.team_size || !Number.isInteger(Number(v.financial_year_start_month)) || Number(v.financial_year_start_month) < 1 || Number(v.financial_year_start_month) > 12) return "Complete the company settings before creating the workspace.";
  return null;
}
export function isCreatedCompany(x: unknown, fields: CompanyFields): x is CompanyMembership {
  if (!isCompanyMembership(x)) return false;
  const o = x.organization;
  return x.is_owner && o.name === fields.name.trim() && o.country_code === fields.country_code.toUpperCase() && o.currency === fields.currency.toUpperCase() && o.timezone === fields.timezone && o.financial_year_start_month === Number(fields.financial_year_start_month) && o.business_type === fields.business_type.trim() && o.team_size === fields.team_size.trim();
}
export const knownIdentityRejection = (status: number) => [400, 401, 403, 404, 409, 422].includes(status);
export function identityError(body: unknown, fallback: string) { return record(body) && typeof body.detail === "string" ? body.detail : fallback; }
