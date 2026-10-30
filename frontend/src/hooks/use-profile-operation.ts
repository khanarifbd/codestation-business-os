"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { useDocumentNavigationGuard } from "@/hooks/use-document-navigation-guard";
import { createPasskeyCredential, passkeysSupported } from "@/lib/passkeys";
import { avatarError, isIdentities, isPasskey, isPasskeyOptions, isProfile, isRevocation, knownProfileRejection, normalizedUsername, passwordError, personalError, profileError, profilePayload, sameAccount, usernameError, type PersonalFields } from "@/components/profile/profile-model";
import { verifiedProfileInputRejection } from "@/components/profile/profile-input-rejection";
import { profileBack } from "@/lib/profile-navigation";
import type { ProfileAccountState, ProfileReadReceipt } from "@/hooks/use-profile-account";
export type ProfileAction = "profile" | "username" | "photo" | "photo-remove" | "password" | "google-password" | "google-link" | "passkey-enroll" | "passkey-remove" | "session-revoke" | "sessions-revoke";
type Phase = "idle" | "verification" | "pending" | "rejected" | "acknowledged" | "confirmed" | "unknown";
type Token = { owner: object; action: ProfileAction; read: ProfileReadReceipt };
export type ProfileReview = { token: Token; id: string | null; title: string; description: string };
type State = { owner: object; phase: Phase; action: ProfileAction | null; message: string | null; result: unknown };
type RequestSpec = { action: ProfileAction; path: string; init: RequestInit; verify: (body: unknown, response: Response) => boolean; message: (body: unknown) => string; clear?: () => void; notify?: boolean };
const UNKNOWN = "The outcome is unknown. This operation may already have completed. Do not repeat it automatically; review current account information or sign in again as appropriate. A later matching or absent record is not this request's receipt.";
const ACK = "The server acknowledged the request, but its result could not be verified. Do not submit it again. Review current account information separately.";
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
export function useProfileOperation(account: ProfileAccountState) {
  const { identity, current, isReady, receipt } = account;
  const pendingRef = useRef(false), operation = useRef<Token | null>(null), armed = useRef<ProfileReview | null>(null);
  const lock = useRef<Phase>("idle"), forgetProvider = useRef<(() => void) | null>(null);
  const [flight, setFlight] = useState({ owner: identity, value: false });
  const [state, setState] = useState<State>({ owner: identity, phase: "idle", action: null, message: null, result: null });
  const [review, setReview] = useState<ProfileReview | null>(null), [dirtyState, setDirtyState] = useState({ owner: identity, value: false });
  const dirty = dirtyState.owner === identity && dirtyState.value;
  useLayoutEffect(() => { pendingRef.current = false; operation.current = null; armed.current = null; lock.current = "idle"; return () => { forgetProvider.current?.(); forgetProvider.current = null; operation.current = null; armed.current = null; pendingRef.current = false; }; }, [identity]);
  const phase = state.owner === identity ? state.phase : "idle";
  const busy = flight.owner === identity && flight.value, unresolved = phase === "unknown" || phase === "acknowledged";
  const nav = useDocumentNavigationGuard(dirty || unresolved || Boolean(review), { pendingRef, isBusy: busy, discardMessage: unresolved ? "The account operation may already have completed. Leave this memory-only result? Do not repeat it without reviewing current account access." : "Discard the account changes entered here and leave?" });
  const belongs = (token: Token) => current() && token.owner === identity && operation.current === token;
  function settle(token: Token, phase: Phase, message: string | null, result: unknown = null) { if (!belongs(token)) return; lock.current = phase; if (phase !== "pending" && phase !== "verification") { armed.current = null; setReview(null); } setState({ owner: identity, phase, action: token.action, message, result }); }
  function canStart() { return current() && !pendingRef.current && ["idle", "rejected"].includes(lock.current) && isReady(receipt); }
  function inputError(message: string | null) { if (!message || !canStart()) return false; setState({ owner: identity, phase: "rejected", action: null, message, result: null }); return true; }
  function start(action: ProfileAction, expected: ProfileReadReceipt | null = receipt) {
    if (!canStart() || !expected || expected !== receipt || !isReady(expected)) return null;
    const token = { owner: identity, action, read: expected }; operation.current = token; pendingRef.current = true; setFlight({ owner: identity, value: true }); lock.current = "pending"; armed.current = null;
    setState({ owner: identity, phase: "pending", action, message: null, result: null }); return token;
  }
  function release(token: Token) { if (belongs(token)) { pendingRef.current = false; setFlight({ owner: identity, value: false }); } }
  function unknown(token: Token, clear?: () => void) { if (!belongs(token) || ["acknowledged", "confirmed"].includes(lock.current)) return; clear?.(); settle(token, "unknown", UNKNOWN); }
  async function receive(token: Token, spec: RequestSpec) {
    try {
      const response = await fetch(spec.path, spec.init);
      if (!belongs(token)) return false;
      if (response.ok) { settle(token, "acknowledged", ACK); spec.clear?.(); }
      else if (!knownProfileRejection(response.status)) unknown(token, spec.clear);
      // A successful password replacement intentionally revokes this session.
      if (token.action === "password" && response.ok && response.status === 204) {
        settle(token, "confirmed", "Password changed. This account's sessions have been signed out; sign in again with your new password."); nav.markClean(); setDirtyState({ owner: identity, value: false }); return true;
      }
      const body: unknown = await response.json().catch(() => null);
      if (!belongs(token)) return false;
      if (response.ok) {
        if (spec.verify(body, response)) { settle(token, "confirmed", spec.message(body), body); nav.markClean(); setDirtyState({ owner: identity, value: false }); if (spec.notify) window.dispatchEvent(new Event("business-os-profile-updated")); }
        return true;
      }
      // Step-up401 is a domain rejection; only an authoritative current GET401
      // forces auth teardown. Existing BFF refresh/retry is not changed here.
      const personalInput = ["profile", "photo", "photo-remove"].includes(token.action);
      if (knownProfileRejection(response.status) && (!personalInput || verifiedProfileInputRejection(body))) settle(token, "rejected", profileError(body, "The operation was rejected. Review the input before trying again."));
      else if (personalInput && knownProfileRejection(response.status)) unknown(token, spec.clear);
      return false;
    } catch { unknown(token, spec.clear); return false; }
    finally { release(token); }
  }
  function submit(spec: RequestSpec) { if (armed.current) return Promise.resolve(false); const token = start(spec.action); return token ? receive(token, spec) : Promise.resolve(false); }
  const validProfile = (body: unknown) => isProfile(body) && sameAccount(body, account.account);
  function savePersonal(values: PersonalFields) {
    if (!canStart()) return Promise.resolve(false); const error = personalError(values); if (inputError(error)) return Promise.resolve(false);
    const body = profilePayload(values);
    return submit({ action: "profile", path: "/api/profile", init: json("PATCH", body), verify: value => validProfile(value) && isProfile(value) && value.full_name === body.full_name && value.phone === body.phone && value.timezone === body.timezone, message: () => "Personal details saved.", notify: true });
  }
  function saveUsername(value: string) {
    if (!canStart() || !receipt?.data.identities) return Promise.resolve(false); if (inputError(usernameError(value))) return Promise.resolve(false);
    const username = normalizedUsername(value);
    return submit({ action: "username", path: "/api/profile/identities/username", init: json("PATCH", { username }), verify: body => isIdentities(body, account.account.email) && body.username === username, message: () => username ? `Username @${username} saved.` : "Optional username removed. Your primary email is unchanged.", notify: true });
  }
  function uploadPhoto(file: File | null, clear: () => void) {
    if (!canStart()) return Promise.resolve(false); if (inputError(avatarError(file)) || !file) return Promise.resolve(false);
    const form = new FormData(); form.append("file", file);
    return submit({ action: "photo", path: "/api/profile/avatar", init: { method: "PUT", body: form }, verify: body => validProfile(body) && isProfile(body) && body.has_avatar, message: () => "Profile photo updated.", clear, notify: true });
  }
  function changePassword(currentPassword: string, newPassword: string, confirmation: string, clear: () => void) {
    if (!canStart() || !receipt?.data.profile.has_password) return Promise.resolve(false); if (inputError(passwordError(newPassword, confirmation, currentPassword))) return Promise.resolve(false);
    return submit({ action: "password", path: "/api/profile/password", init: json("POST", { current_password: currentPassword, new_password: newPassword }), verify: () => false, message: () => "", clear });
  }
  // Provider widgets are mounted only after this current-read preparation. No
  // credential is stored in React state. Captured callbacks cannot consume a
  // later attempt after cancellation/re-arm or account/route replacement.
  function prepareGoogle(newPassword?: string, confirmation?: string, clear?: () => void) {
    if (!canStart() || !receipt || armed.current) return null;
    const action = newPassword === undefined ? "google-link" : "google-password";
    if (action === "google-link" && receipt.data.profile.google_connected || action === "google-password" && (receipt.data.profile.has_password || !receipt.data.profile.google_connected)) return null;
    if (newPassword !== undefined && inputError(passwordError(newPassword, confirmation ?? ""))) return null;
    const token = start(action); if (!token) return null;
    const forget = () => { newPassword = undefined; clear?.(); }; forgetProvider.current = forget;
    settle(token, "verification", "Complete fresh Google verification for this account, or cancel before any account request is sent.");
    return {
      owner: identity,
      cancel() { if (!belongs(token) || lock.current !== "verification") return false; forget(); forgetProvider.current = null; pendingRef.current = false; setFlight({ owner: identity, value: false }); lock.current = "idle"; operation.current = null; setState({ owner: identity, phase: "idle", action: null, message: "Google verification cancelled here. No account request was sent by this attempt.", result: null }); return true; },
      async accept(credential: string) {
        if (!belongs(token) || lock.current !== "verification") return false;
        if (credential.length < 100 || credential.length > 16384) { forget(); forgetProvider.current = null; settle(token, "rejected", "Google did not return a valid verification credential. Start a fresh verification."); release(token); return false; }
        settle(token, "pending", null);
        const init = json("POST", action === "google-link" ? { credential } : { credential, new_password: newPassword });
        newPassword = undefined; credential = ""; forgetProvider.current = null;
        return receive(token, { action, path: action === "google-link" ? "/api/profile/google-link" : "/api/profile/password/google-setup", init, verify: body => validProfile(body) && isProfile(body) && (action === "google-link" ? body.google_connected : body.has_password), message: () => action === "google-link" ? "Google sign-in connected to your primary email." : "Password created. Your existing session remains active; Google sign-in is unchanged.", clear, notify: true });
      },
    };
  }
  async function enrollPasskey(name: string, currentPassword: string, clear: () => void) {
    if (!canStart() || armed.current || !receipt?.data.profile.has_password || !receipt.data.passkeys || receipt.data.passkeys.length >= 20) return false;
    const title = name.trim(); if (inputError(!title || title.length > 80 ? "Use 1–80 characters for the passkey name." : currentPassword.length < 8 || currentPassword.length > 128 ? "Current password must contain 8–128 characters." : !passkeysSupported() ? "Passkeys are not supported by this browser or device." : null)) return false;
    const token = start("passkey-enroll"); if (!token) return false;
    try {
      const response = await fetch("/api/profile/passkeys/registration/options", json("POST", { current_password: currentPassword }));
      if (!belongs(token)) return false;
      const body: unknown = await response.json().catch(() => null); if (!belongs(token)) return false;
      if (!response.ok || !isPasskeyOptions(body)) { settle(token, "rejected", profileError(body, "Passkey setup could not be started. No registration verification was sent.")); return false; }
      let credential: Record<string, unknown>;
      try { credential = await createPasskeyCredential(body.public_key); }
      catch { if (belongs(token)) { clear(); settle(token, "rejected", "Passkey setup stopped before verification. No registration verification was sent by this attempt; a local authenticator credential may exist."); } return false; }
      if (!belongs(token)) return false;
      return await receive(token, { action: "passkey-enroll", path: "/api/profile/passkeys/registration/verify", init: json("POST", { challenge_id: body.challenge_id, name: title, credential }), verify: value => isPasskey(value) && value.name === title && !token.read.data.passkeys?.some(x => x.id === value.id), message: () => "Passkey registered for your global account.", clear });
    } catch { if (belongs(token) && lock.current === "pending") settle(token, "rejected", "Passkey setup could not obtain a challenge. No registration verification was sent. Start a fresh setup deliberately."); return false; }
    finally { release(token); }
  }
  function arm(action: "photo-remove" | "passkey-remove" | "session-revoke" | "sessions-revoke", id: string | null = null) {
    if (!canStart() || !receipt || armed.current) return false;
    let title = "", description = "";
    if (action === "photo-remove") { if (!receipt.data.profile.has_avatar) return false; title = "Remove profile photo?"; description = "Your profile will use initials instead. Personal details are unchanged."; }
    if (action === "passkey-remove") { const row = receipt.data.passkeys?.find(x => x.id === id); if (!row) return false; title = `Remove ${row.name}?`; description = "This passkey will no longer sign in to your global account. Other sign-in methods are unchanged."; }
    if (action === "session-revoke") { const row = receipt.data.sessions?.items.find(x => x.id === id); if (!row || row.is_current || row.status !== "active") return false; title = `Sign out ${row.browser} on ${row.operating_system}?`; description = "This affects the selected account session, not your current browser."; }
    if (action === "sessions-revoke") { const data = receipt.data.sessions; if (!data || data.legacy_current_session || !data.items.some(x => x.status === "active" && !x.is_current)) return false; title = "Sign out all other active sessions?"; description = "The server acts on the current set of other sessions, not only this loaded list. Your current browser stays signed in."; }
    const value = { token: { owner: identity, action, read: receipt }, id, title, description }; armed.current = value; setReview(value); return true;
  }
  function closeReview() { if (!current() || pendingRef.current || !review || armed.current !== review) return false; armed.current = null; setReview(null); return true; }
  function confirmReview() {
    if (!review || armed.current !== review || !canStart() || review.token.owner !== identity || !isReady(review.token.read)) return Promise.resolve(false);
    const action = review.token.action, id = review.id; const token = start(action, review.token.read); if (!token) return Promise.resolve(false);
    if (action === "photo-remove") return receive(token, { action, path: "/api/profile/avatar", init: { method: "DELETE" }, verify: body => validProfile(body) && isProfile(body) && !body.has_avatar, message: () => "Profile photo removed.", notify: true });
    if (action === "passkey-remove") return receive(token, { action, path: `/api/profile/passkeys/${encodeURIComponent(id!)}`, init: { method: "DELETE" }, verify: (_, response) => response.status === 204, message: () => "Passkey removed." });
    const single = action === "session-revoke";
    return receive(token, { action, path: single ? `/api/profile/sessions/${encodeURIComponent(id!)}` : "/api/profile/sessions/revoke-others", init: { method: single ? "DELETE" : "POST" }, verify: body => isRevocation(body, single), message: body => isRevocation(body, single) ? body.revoked_count ? `${body.revoked_count} ${single ? "selected session" : "other session"}${body.revoked_count === 1 ? "" : "s"} signed out.` : "No active sessions needed revocation; the server returned a zero count." : "" });
  }
  return { phase, busy, unresolved, message: state.owner === identity ? state.message : null, result: state.owner === identity ? state.result : null, action: state.owner === identity ? state.action : null, review: review?.token.owner === identity ? review : null,
    canEdit: ["idle", "rejected"].includes(phase) && !account.loading && !account.error && Boolean(receipt) && !review,
    canChange: () => canStart() && !armed.current,
    setDirty(value: boolean) { if (current() && !pendingRef.current) setDirtyState({ owner: identity, value }); }, inputError, savePersonal, saveUsername, uploadPhoto, changePassword, prepareGoogle, enrollPasskey, arm, closeReview, confirmReview,
    refresh: () => current() && !pendingRef.current ? account.refresh() : Promise.resolve(false),
    back: () => current() ? nav.navigate(profileBack(account.mode)) : false,
    signIn: () => current() ? nav.navigate("/login", { discard: phase === "confirmed" && state.action === "password" }) : false,
  };
}
export type ProfileOperation = ReturnType<typeof useProfileOperation>;
