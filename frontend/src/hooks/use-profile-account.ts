"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { accountKey, isIdentities, isPasskeys, isProfile, isSessions, profileError, sameAccount, type AccountIdentity, type AccountRead } from "@/components/profile/profile-model";
import type { ProfileMode } from "@/lib/profile-navigation";
export type ProfileReadReceipt = { owner: object; data: AccountRead };
export function useProfileAccount(account: AccountIdentity, mode: ProfileMode) {
  const router = useRouter(), key = accountKey(account);
  const observedId = account.id, observedEmail = account.email, observedActive = account.is_active;
  // Generation identity never revives across A→B→A, including same-instance callers.
  const identity = useMemo(() => ({ key, mode }), [key, mode]);
  const active = useRef<object | null>(null), ready = useRef<ProfileReadReceipt | null>(null), epoch = useRef(0), invalidated = useRef(false);
  const [state, setState] = useState<{ owner: object; receipt: ProfileReadReceipt | null; loading: boolean; error: string | null }>({ owner: identity, receipt: null, loading: true, error: null });
  useLayoutEffect(() => { active.current = identity; ready.current = null; invalidated.current = false; epoch.current++; return () => { if (active.current === identity) { active.current = null; ready.current = null; } }; }, [identity]);
  const current = useCallback(() => active.current === identity && !invalidated.current && observedActive, [identity, observedActive]);
  const forceAuth = useCallback(() => { if (!current()) return; invalidated.current = true; ready.current = null; epoch.current++; setState({ owner: identity, receipt: null, loading: false, error: "Your account session changed. Sign in again to continue." }); router.replace("/login"); }, [current, identity, router]);
  const isReady = useCallback((receipt: ProfileReadReceipt | null) => current() && Boolean(receipt) && ready.current === receipt, [current]);
  const refresh = useCallback(async () => {
    if (!current()) return false;
    const request = ++epoch.current; ready.current = null;
    const valid = () => current() && epoch.current === request;
    setState(previous => ({ owner: identity, receipt: previous.owner === identity ? previous.receipt : null, loading: true, error: null }));
    async function get(path: string) {
      const response = await fetch(path, { cache: "no-store" });
      if (!valid()) return null;
      if (response.status === 401) { forceAuth(); return null; }
      const body: unknown = await response.json().catch(() => null);
      if (!valid()) return null;
      if (!response.ok) throw Error(profileError(body, "Account details could not be read. Retry before making changes."));
      return body;
    }
    try {
      const profile = await get("/api/profile"); if (!valid()) return false;
      if (!isProfile(profile)) throw Error("Your profile response could not be verified.");
      if (!sameAccount(profile, { id: observedId, email: observedEmail, is_active: observedActive })) { forceAuth(); return false; }
      const data: AccountRead = { profile, identities: null, passkeys: null, sessions: null };
      if (mode === "security" || mode === "username") { const value = await get("/api/profile/identities"); if (!valid()) return false; if (!isIdentities(value, observedEmail)) throw Error("Sign-in identities could not be verified."); data.identities = value; }
      if (mode === "passkeys" || mode === "enrollment") { const value = await get("/api/profile/passkeys"); if (!valid()) return false; if (!isPasskeys(value)) throw Error("Passkey records could not be verified."); data.passkeys = value; }
      if (mode === "sessions") { const value = await get("/api/profile/sessions"); if (!valid()) return false; if (!isSessions(value)) throw Error("Device-session records could not be verified."); data.sessions = value; }
      const receipt = { owner: identity, data }; ready.current = receipt; setState({ owner: identity, receipt, loading: false, error: null }); return true;
    } catch (error) { if (valid()) setState(previous => ({ owner: identity, receipt: previous.owner === identity ? previous.receipt : null, loading: false, error: error instanceof Error ? error.message : "Unable to read account details." })); return false; }
  }, [current, identity, mode, observedId, observedEmail, observedActive, forceAuth]);
  useEffect(() => { let mounted = true; queueMicrotask(() => { if (mounted) void refresh(); }); return () => { mounted = false; }; }, [refresh]);
  const receipt = state.owner === identity ? state.receipt : null;
  return { account, mode, identity, current, isReady, forceAuth, refresh, receipt, data: receipt?.data ?? null, loading: state.owner !== identity || state.loading, error: state.owner === identity ? state.error : null };
}
export type ProfileAccountState = ReturnType<typeof useProfileAccount>;
