"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock3, Laptop, Loader2, LogOut, MonitorSmartphone, ShieldCheck, Smartphone, Tablet } from "lucide-react";

type UserSession = {
  id: string;
  auth_method: string;
  device_type: string;
  browser: string;
  operating_system: string;
  ip_address: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
  status: "active" | "revoked" | "expired" | string;
  is_current: boolean;
};

type SessionList = {
  items: UserSession[];
  legacy_current_session: boolean;
};

function sessionIcon(type: string) {
  if (type === "mobile") return Smartphone;
  if (type === "tablet") return Tablet;
  if (type === "desktop") return Laptop;
  return MonitorSmartphone;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function relativeTime(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return formatDate(value);
}

function authMethodLabel(value: string) {
  if (value === "password") return "Password";
  if (value === "google") return "Google";
  if (value === "legacy") return "Existing sign-in";
  return value.replaceAll("_", " ");
}

function endedReason(session: UserSession) {
  if (session.status === "expired") return "Expired";
  if (session.revoked_reason === "remote_sign_out") return "Signed out remotely";
  if (session.revoked_reason === "sign_out_other_devices") return "Signed out from another device";
  if (session.revoked_reason === "user_logout") return "Signed out";
  if (session.revoked_reason === "password_reset" || session.revoked_reason === "security_change") return "Security credentials changed";
  if (session.revoked_reason === "legacy_logout") return "Signed out";
  return "Ended";
}

function SessionRow({
  session,
  workingId,
  onSignOut,
}: {
  session: UserSession;
  workingId: string | null;
  onSignOut: (session: UserSession) => void;
}) {
  const Icon = sessionIcon(session.device_type);
  const active = session.status === "active";
  return <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
    <div className="flex min-w-0 items-start gap-3">
      <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100"><Icon className="size-5 text-neutral-600" /></div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-neutral-900">{session.browser} on {session.operating_system}</p>
          {session.is_current ? <span className="rounded-full bg-neutral-950 px-2 py-0.5 text-[11px] font-semibold text-white">Current device</span> : null}
          {!session.is_current && active ? <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Active</span> : null}
          {!active ? <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold text-neutral-500">{endedReason(session)}</span> : null}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-500">
          <span>{session.device_type}</span>
          <span>{authMethodLabel(session.auth_method)}</span>
          {session.ip_address ? <span>IP {session.ip_address}</span> : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-400">
          <span>Signed in {formatDate(session.created_at)}</span>
          <span className="inline-flex items-center gap-1"><Clock3 className="size-3" />Last active {relativeTime(session.last_seen_at)}</span>
        </div>
      </div>
    </div>
    {active && !session.is_current ? <button type="button" disabled={workingId === session.id} onClick={() => onSignOut(session)} className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:opacity-50">{workingId === session.id ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}Sign out</button> : null}
  </div>;
}

export function ProfileSessionsSection() {
  const [data, setData] = useState<SessionList | null>(null);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [workingAll, setWorkingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/profile/sessions", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to load device sessions.");
      setData(payload as SessionList);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load device sessions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const activeSessions = useMemo(
    () => data?.items.filter((item) => item.status === "active") ?? [],
    [data],
  );
  const historySessions = useMemo(
    () => data?.items.filter((item) => item.status !== "active") ?? [],
    [data],
  );
  const otherActiveCount = useMemo(
    () => activeSessions.filter((item) => !item.is_current).length,
    [activeSessions],
  );
  const duplicateLegacyUpgradeDetected = useMemo(() => {
    const legacy = activeSessions.filter((item) => item.auth_method === "legacy" && !item.is_current);
    if (legacy.length < 2) return false;
    const signatures = new Map<string, number>();
    for (const item of legacy) {
      const key = `${item.browser}|${item.operating_system}|${item.ip_address ?? ""}`;
      signatures.set(key, (signatures.get(key) ?? 0) + 1);
    }
    return [...signatures.values()].some((count) => count > 1);
  }, [activeSessions]);

  async function signOutSession(session: UserSession) {
    if (!window.confirm(`Sign out ${session.browser} on ${session.operating_system}?`)) return;
    setWorkingId(session.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/profile/sessions/${session.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to sign out this device.");
      setMessage("Device signed out successfully.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to sign out this device.");
    } finally {
      setWorkingId(null);
    }
  }

  async function signOutOtherDevices() {
    if (!window.confirm("Sign out every other active device? Your current browser will stay signed in.")) return;
    setWorkingAll(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/profile/sessions/revoke-others", { method: "POST" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to sign out other devices.");
      const count = Number(payload?.revoked_count ?? 0);
      setMessage(count ? `${count} other device session${count === 1 ? "" : "s"} signed out.` : "No other active devices were signed in.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to sign out other devices.");
    } finally {
      setWorkingAll(false);
    }
  }

  return (
    <section className="rounded-3xl border bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100"><ShieldCheck className="size-5" /></div>
          <div>
            <h2 className="font-semibold">Devices & sessions</h2>
            <p className="mt-1 max-w-2xl text-sm text-neutral-500">Review active devices separately from recent sign-in history and remotely revoke access you no longer trust.</p>
          </div>
        </div>
        <button type="button" disabled={workingAll || loading || !otherActiveCount || Boolean(data?.legacy_current_session)} onClick={() => void signOutOtherDevices()} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-semibold transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-45">
          {workingAll ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}Sign out all other devices
        </button>
      </div>

      {data?.legacy_current_session ? <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">This browser was signed in before device-session tracking was enabled. It will be upgraded automatically on the next token refresh or sign-in; existing access is not interrupted.</div> : null}
      {duplicateLegacyUpgradeDetected ? <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900"><p className="font-semibold">Duplicate legacy session records detected</p><p className="mt-1">These can be created by parallel requests during the initial session-tracking rollout and do not mean multiple physical devices signed in. Use <strong>Sign out all other devices</strong> once to keep only this current session active.</p></div> : null}
      {error ? <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {message ? <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}

      <div className="mt-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-neutral-900">Active devices</h3>
          {!loading ? <span className="text-xs text-neutral-400">{activeSessions.length} active</span> : null}
        </div>
        <div className="mt-3 divide-y rounded-2xl border">
          {loading ? <div className="flex items-center justify-center gap-2 p-8 text-sm text-neutral-500"><Loader2 className="size-4 animate-spin" />Loading device sessions...</div> : null}
          {!loading && !activeSessions.length ? <div className="p-8 text-center text-sm text-neutral-500">No active tracked sessions.</div> : null}
          {activeSessions.map((session) => <SessionRow key={session.id} session={session} workingId={workingId} onSignOut={(item) => void signOutSession(item)} />)}
        </div>
      </div>

      {!loading && historySessions.length ? <div className="mt-7 border-t pt-6">
        <div className="flex items-center justify-between gap-3">
          <div><h3 className="text-sm font-semibold text-neutral-900">Recent sign-in history</h3><p className="mt-1 text-xs text-neutral-400">Ended and expired sessions from the last 90 days.</p></div>
          <span className="text-xs text-neutral-400">{historySessions.length} recent</span>
        </div>
        <div className="mt-3 divide-y rounded-2xl border bg-neutral-50/40">
          {historySessions.map((session) => <SessionRow key={session.id} session={session} workingId={workingId} onSignOut={(item) => void signOutSession(item)} />)}
        </div>
      </div> : null}
    </section>
  );
}
