"use client";

import { useCallback, useEffect, useState } from "react";
import { AtSign, BadgeCheck, KeyRound, Loader2, Mail, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";

import { GoogleReauthButton } from "@/components/auth/google-reauth-button";

type SignInIdentities = {
  email: string;
  email_verified: boolean;
  username: string | null;
  google_connected: boolean;
  has_password: boolean;
};

const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/;

export function ProfileSignInIdentities({
  onProfileChanged,
}: {
  onProfileChanged?: () => void | Promise<void>;
}) {
  const [identities, setIdentities] = useState<SignInIdentities | null>(null);
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingUsername, setSavingUsername] = useState(false);
  const [linkingGoogle, setLinkingGoogle] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/profile/identities", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to load sign-in identities.");
      const next = payload as SignInIdentities;
      setIdentities(next);
      setUsername(next.username ?? "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load sign-in identities.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function updateUsername(nextValue: string | null) {
    const normalized = nextValue?.trim().toLowerCase() || null;
    if (normalized && !USERNAME_PATTERN.test(normalized)) {
      setError("Username must be 3–32 characters and can use letters, numbers, dots, underscores and hyphens. It must start and end with a letter or number.");
      setMessage(null);
      return;
    }

    setSavingUsername(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/profile/identities/username", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: normalized }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to update username.");
      const next = payload as SignInIdentities;
      setIdentities(next);
      setUsername(next.username ?? "");
      setMessage(next.username ? `Username @${next.username} is ready for password sign-in.` : "Username removed from your sign-in identities.");
      await onProfileChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update username.");
    } finally {
      setSavingUsername(false);
    }
  }

  async function connectGoogle(credential: string) {
    setLinkingGoogle(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/profile/google-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to connect Google sign-in.");
      setMessage("Google sign-in connected successfully. You can now use Google from the sign-in page.");
      await load();
      await onProfileChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to connect Google sign-in.");
    } finally {
      setLinkingGoogle(false);
    }
  }

  if (loading && !identities) {
    return (
      <section className="rounded-3xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-3 text-sm text-neutral-500">
          <Loader2 className="size-4 animate-spin" /> Loading sign-in identities…
        </div>
      </section>
    );
  }

  if (!identities) {
    return (
      <section className="rounded-3xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div><h2 className="font-semibold">Sign-in identities</h2><p className="mt-1 text-sm text-neutral-500">Manage the identities you can use to access Business OS.</p></div>
          <button type="button" onClick={() => void load()} className="rounded-xl border p-2 text-neutral-500" aria-label="Reload sign-in identities"><RefreshCw className="size-4" /></button>
        </div>
        {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      </section>
    );
  }

  const usernameChanged = username.trim().toLowerCase() !== (identities.username ?? "");

  return (
    <section className="rounded-3xl border bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3 border-b pb-5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100"><ShieldCheck className="size-5" /></div>
        <div className="min-w-0">
          <h2 className="font-semibold">Sign-in identities</h2>
          <p className="mt-1 text-sm leading-6 text-neutral-500">Use your primary email or username with a password, or connect Google for one-click sign-in.</p>
        </div>
      </div>

      {error ? <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {message ? <div role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div> : null}

      <div className="mt-5 space-y-4">
        <div className="rounded-2xl border bg-neutral-50/70 p-4">
          <div className="flex items-start gap-3">
            <Mail className="mt-0.5 size-4 shrink-0 text-neutral-400" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><p className="font-medium">Primary email</p>{identities.email_verified ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700"><BadgeCheck className="size-3" />Verified</span> : null}</div>
              <p className="mt-1 break-all text-sm text-neutral-600">{identities.email}</p>
              <p className="mt-1 text-xs text-neutral-400">Always available as your primary account identity.</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border p-4">
          <div className="flex items-start gap-3">
            <AtSign className="mt-0.5 size-4 shrink-0 text-neutral-400" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">Username</p>{identities.username ? <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">@{identities.username}</span> : <span className="text-xs text-neutral-400">Optional</span>}</div>
              <p className="mt-1 text-xs leading-5 text-neutral-500">Global across every workspace. Use 3–32 lowercase letters, numbers, dots, underscores or hyphens.</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <div className="relative min-w-0 flex-1"><AtSign className="absolute left-3 top-3.5 size-4 text-neutral-400" /><input value={username} onChange={(event) => { setUsername(event.target.value.toLowerCase()); setError(null); setMessage(null); }} maxLength={32} autoCapitalize="none" autoCorrect="off" spellCheck={false} className="h-11 w-full rounded-xl border border-neutral-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-neutral-500 focus:ring-4 focus:ring-neutral-950/[0.04]" placeholder="your.username" /></div>
                <button type="button" disabled={savingUsername || !usernameChanged} onClick={() => void updateUsername(username)} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">{savingUsername ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}Save username</button>
                {identities.username ? <button type="button" disabled={savingUsername} onClick={() => void updateUsername(null)} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border bg-white px-4 text-sm font-medium text-neutral-600 disabled:opacity-40"><Trash2 className="size-4" />Remove</button> : null}
              </div>
              {!identities.has_password ? <p className="mt-2 text-xs text-amber-700">Username sign-in becomes available after you create a password for this account.</p> : <p className="mt-2 text-xs text-emerald-700">You can sign in with this username and your password. Prefixing it with @ also works.</p>}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border p-4">
          <div className="flex items-start gap-3">
            <BadgeCheck className="mt-0.5 size-4 shrink-0 text-neutral-400" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><p className="font-medium">Google account</p>{identities.google_connected ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Connected</span> : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Not connected</span>}</div>
              {identities.google_connected ? <p className="mt-1 text-sm text-neutral-500">Google sign-in is linked to your primary email identity.</p> : <><p className="mt-1 text-sm leading-6 text-neutral-500">Connect the Google account that uses <span className="font-medium text-neutral-700">{identities.email}</span>. A different Google email will be rejected.</p><div className="mt-3"><GoogleReauthButton busy={linkingGoogle} busyLabel="Connecting Google…" onCredential={connectGoogle} /></div></>}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border bg-neutral-50/70 p-4">
          <div className="flex items-start gap-3">
            <KeyRound className="mt-0.5 size-4 shrink-0 text-neutral-400" />
            <div><div className="flex flex-wrap items-center gap-2"><p className="font-medium">Password credential</p><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${identities.has_password ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{identities.has_password ? "Enabled" : "Not configured"}</span></div><p className="mt-1 text-sm text-neutral-500">{identities.has_password ? "Email and username can both use this password." : "Create a password below if you also want email or username password sign-in."}</p></div>
          </div>
        </div>
      </div>
    </section>
  );
}
