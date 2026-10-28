export type Profile = { id: string; email: string; full_name: string; phone: string | null; timezone: string | null; system_role: string; is_active: boolean; is_verified: boolean; has_password: boolean; google_connected: boolean; has_avatar: boolean; avatar_version: number; created_at: string; updated_at: string };
export type AccountIdentity = Pick<Profile, "id" | "email" | "is_active">;
export type SignInIdentities = { email: string; email_verified: boolean; username: string | null; google_connected: boolean; has_password: boolean };
export type Passkey = { id: string; name: string; credential_device_type: string; backed_up: boolean; transports: string[]; created_at: string; last_used_at: string | null };
export type UserSession = { id: string; auth_method: string; device_type: string; browser: string; operating_system: string; ip_address: string | null; created_at: string; last_seen_at: string; expires_at: string; revoked_at: string | null; revoked_reason: string | null; status: string; is_current: boolean };
export type SessionList = { items: UserSession[]; legacy_current_session: boolean };
export type PersonalFields = { full_name: string; phone: string; timezone: string };
export type AccountRead = { profile: Profile; identities: SignInIdentities | null; passkeys: Passkey[] | null; sessions: SessionList | null };
const record = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string";
const nullableText = (v: unknown) => v === null || text(v);
const date = (v: unknown) => text(v) && Number.isFinite(Date.parse(v));
const nullableDate = (v: unknown) => v === null || date(v);
const bool = (v: unknown) => typeof v === "boolean";
export function accountIdentity(value: unknown): AccountIdentity | null {
  return record(value) && text(value.id) && Boolean(value.id) && text(value.email) && Boolean(value.email) && bool(value.is_active) ? { id: value.id, email: value.email, is_active: value.is_active as boolean } : null;
}
export function accountKey(value: AccountIdentity | null) { return value ? JSON.stringify([value.id, value.email, value.is_active]) : "unverified-account"; }
export function isProfile(v: unknown): v is Profile {
  return record(v) && accountIdentity(v) !== null && ["full_name", "system_role"].every(k => text(v[k])) && ["phone", "timezone"].every(k => nullableText(v[k])) && ["is_verified", "has_password", "google_connected", "has_avatar"].every(k => bool(v[k])) && Number.isSafeInteger(v.avatar_version) && Number(v.avatar_version) >= 0 && date(v.created_at) && date(v.updated_at);
}
export function sameAccount(v: Profile, account: AccountIdentity) { return v.id === account.id && v.email.toLowerCase() === account.email.toLowerCase() && v.is_active && account.is_active; }
export function isIdentities(v: unknown, email: string): v is SignInIdentities {
  return record(v) && text(v.email) && v.email.toLowerCase() === email.toLowerCase() && nullableText(v.username) && ["email_verified", "google_connected", "has_password"].every(k => bool(v[k]));
}
export function isPasskey(v: unknown): v is Passkey {
  return record(v) && text(v.id) && Boolean(v.id) && text(v.name) && text(v.credential_device_type) && bool(v.backed_up) && Array.isArray(v.transports) && v.transports.every(text) && date(v.created_at) && nullableDate(v.last_used_at);
}
export function isPasskeys(v: unknown): v is Passkey[] { return Array.isArray(v) && v.length <= 20 && v.every(isPasskey) && new Set(v.map(x => x.id)).size === v.length; }
export function isSession(v: unknown): v is UserSession {
  return record(v) && ["id", "auth_method", "device_type", "browser", "operating_system", "status"].every(k => text(v[k])) && Boolean(v.id) && ["ip_address", "revoked_reason"].every(k => nullableText(v[k])) && ["created_at", "last_seen_at", "expires_at"].every(k => date(v[k])) && nullableDate(v.revoked_at) && bool(v.is_current);
}
export function isSessions(v: unknown): v is SessionList { return record(v) && bool(v.legacy_current_session) && Array.isArray(v.items) && v.items.length <= 100 && v.items.every(isSession) && new Set(v.items.map(x => x.id)).size === v.items.length && v.items.filter(x => x.is_current).length <= 1; }
export function isRevocation(v: unknown, single: boolean): v is { revoked_count: number } { return record(v) && Number.isSafeInteger(v.revoked_count) && Number(v.revoked_count) >= 0 && (!single || Number(v.revoked_count) <= 1); }
export function isPasskeyOptions(v: unknown): v is { challenge_id: string; public_key: Record<string, unknown> } {
  if (!record(v) || !text(v.challenge_id) || v.challenge_id.length !== 36 || !record(v.public_key)) return false;
  const p = v.public_key;
  return text(p.challenge) && Boolean(p.challenge) && record(p.user) && text(p.user.id) && text(p.user.name) && text(p.user.displayName) && record(p.rp) && text(p.rp.name) && Array.isArray(p.pubKeyCredParams) && p.pubKeyCredParams.length > 0 && p.pubKeyCredParams.every(x => record(x) && x.type === "public-key" && Number.isInteger(x.alg)) && (p.excludeCredentials === undefined || Array.isArray(p.excludeCredentials) && p.excludeCredentials.every(x => record(x) && text(x.id)));
}
export function profileFields(p: Profile): PersonalFields { return { full_name: p.full_name, phone: p.phone ?? "", timezone: p.timezone ?? "" }; }
export function profilePayload(v: PersonalFields) { return { full_name: v.full_name.trim(), phone: v.phone.trim() || null, timezone: v.timezone || null }; }
export function personalError(v: PersonalFields) {
  if (v.full_name.trim().length < 2 || v.full_name.trim().length > 160) return "Use 2–160 characters for your full name.";
  if (v.phone.length > 40) return "Phone must be 40 characters or fewer.";
  if (v.timezone.length > 64) return "Choose a supported personal timezone.";
  return null;
}
export function normalizedUsername(value: string) { return value.trim().toLowerCase() || null; }
export function usernameError(value: string) { const name = normalizedUsername(value); return name && (name.length < 3 || name.length > 32 || !/^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/.test(name)) ? "Use 3–32 lowercase letters, numbers, dots, underscores or hyphens; start and end with a letter or number." : null; }
export function passwordError(next: string, confirmation: string, current?: string) {
  if (next.length < 8 || next.length > 128 || current !== undefined && (current.length < 8 || current.length > 128)) return "Passwords must contain 8–128 characters.";
  if (next !== confirmation) return "New password and confirmation do not match.";
  if (current !== undefined && next === current) return "New password must be different from your current password.";
  return null;
}
export function avatarError(file: File | null) { return !file ? "Choose a photo first." : !["image/jpeg", "image/png", "image/webp"].includes(file.type) ? "Choose a JPEG, PNG or WebP image." : file.size > 5 * 1024 * 1024 ? "Profile photo must be 5 MB or smaller." : null; }
export function profileError(body: unknown, fallback: string) { return record(body) && text(body.detail) ? body.detail : fallback; }
export function knownProfileRejection(status: number) { return [400, 401, 403, 404, 409, 413, 415, 422].includes(status); }
export function profileDate(value: string | null) { return value ? new Date(value).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Never used"; }
export function profileInitials(name: string) { return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]?.toUpperCase()).join("") || "U"; }
export function sessionReason(s: UserSession) {
  if (s.status === "expired") return "Expired";
  return ({ new_sign_in_same_device: "Replaced by a newer sign-in", remote_sign_out: "Signed out remotely", sign_out_other_devices: "Signed out from another device", user_logout: "Signed out", password_reset: "Security credentials changed", security_change: "Security credentials changed", legacy_logout: "Signed out" } as Record<string, string>)[s.revoked_reason ?? ""] ?? "Ended";
}
export function duplicateLegacySessions(items: UserSession[]) { const seen = new Set<string>(); return items.filter(x => x.status === "active" && x.auth_method === "legacy" && !x.is_current).some(x => { const key = JSON.stringify([x.browser, x.operating_system, x.ip_address]); if (seen.has(key)) return true; seen.add(key); return false; }); }
