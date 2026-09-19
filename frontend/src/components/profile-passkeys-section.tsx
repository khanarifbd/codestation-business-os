"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Fingerprint, KeyRound, Loader2, ShieldCheck, Trash2 } from "lucide-react";

import { GoogleReauthButton } from "@/components/auth/google-reauth-button";
import { PasswordField } from "@/components/auth/password-field";
import { createPasskeyCredential, passkeysSupported, type PasskeyOptionsEnvelope } from "@/lib/passkeys";

type Passkey = {
  id: string;
  name: string;
  credential_device_type: string;
  backed_up: boolean;
  transports: string[];
  created_at: string;
  last_used_at: string | null;
};

function formatDate(value: string | null) {
  if (!value) return "Never used";
  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ProfilePasskeysSection({
  hasPassword,
  googleConnected,
}: {
  hasPassword: boolean;
  googleConnected: boolean;
}) {
  const [items, setItems] = useState<Passkey[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [name, setName] = useState("My passkey");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const supported = useMemo(() => typeof window === "undefined" || passkeysSupported(), []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/profile/passkeys", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to load passkeys.");
      setItems(Array.isArray(payload) ? payload as Passkey[] : []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load passkeys.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function registerPasskey(stepUp: { current_password?: string; google_credential?: string }) {
    if (!passkeysSupported()) {
      setError("Passkeys are not supported by this browser or device.");
      return;
    }
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Enter a name for this passkey.");
      return;
    }

    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      const optionsResponse = await fetch("/api/profile/passkeys/registration/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stepUp),
      });
      const optionsPayload = await optionsResponse.json().catch(() => null);
      if (!optionsResponse.ok) throw new Error(optionsPayload?.detail ?? "Unable to start passkey setup.");

      const options = optionsPayload as PasskeyOptionsEnvelope;
      const credential = await createPasskeyCredential(options.public_key);
      const verifyResponse = await fetch("/api/profile/passkeys/registration/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challenge_id: options.challenge_id,
          name: trimmedName,
          credential,
        }),
      });
      const verifyPayload = await verifyResponse.json().catch(() => null);
      if (!verifyResponse.ok) throw new Error(verifyPayload?.detail ?? "Unable to save this passkey.");

      setMessage("Passkey added. You can now use it from the sign-in page.");
      await load();
    } catch (reason) {
      const domReason = reason instanceof DOMException ? reason.name : "";
      if (domReason === "NotAllowedError") {
        setError("Passkey setup was cancelled or timed out.");
      } else {
        setError(reason instanceof Error ? reason.message : "Unable to add this passkey.");
      }
    } finally {
      setWorking(false);
    }
  }

  async function removePasskey(item: Passkey) {
    if (!window.confirm(`Remove "${item.name}"? This passkey will no longer be able to sign in.`)) return;
    setRemovingId(item.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/profile/passkeys/${item.id}`, { method: "DELETE" });
      const payload = response.status === 204 ? null : await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to remove this passkey.");
      setMessage("Passkey removed.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to remove this passkey.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <section className="rounded-3xl border bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3 border-b pb-5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100"><Fingerprint className="size-5" /></div>
        <div>
          <h2 className="font-semibold">Passkeys</h2>
          <p className="mt-1 text-sm text-neutral-500">Use Touch ID, Face ID, Windows Hello or a security key to sign in without entering your password.</p>
        </div>
      </div>

      {!supported ? <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">This browser or device does not support WebAuthn passkeys.</div> : null}
      {error ? <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {message ? <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}

      <div className="mt-5 space-y-3">
        <label className="block text-sm font-medium text-neutral-800">
          Passkey name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            placeholder="MacBook Touch ID"
            className="mt-2 h-11 w-full rounded-xl border border-neutral-200 px-3 outline-none focus:border-neutral-500 focus:ring-4 focus:ring-neutral-950/[0.04]"
          />
        </label>

        {hasPassword ? (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void registerPasskey({ current_password: String(form.get("passkey_current_password") ?? "") });
            }}
          >
            <PasswordField
              name="passkey_current_password"
              label="Current password"
              autoComplete="current-password"
              placeholder="Verify your password first"
            />
            <button type="submit" disabled={working || !supported} className="inline-flex h-11 items-center gap-2 rounded-xl bg-neutral-950 px-5 text-sm font-semibold text-white disabled:opacity-50">
              {working ? <Loader2 className="size-4 animate-spin" /> : <Fingerprint className="size-4" />}
              {working ? "Adding passkey…" : "Verify & add passkey"}
            </button>
          </form>
        ) : googleConnected ? (
          <div className="space-y-3">
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
              <p className="font-semibold">Verify with your connected Google account</p>
              <p className="mt-1 text-blue-800">A fresh Google verification is required before this browser can add a new passkey.</p>
            </div>
            <GoogleReauthButton busy={working} busyLabel="Adding passkey…" onCredential={(credential) => registerPasskey({ google_credential: credential })} />
          </div>
        ) : (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Add a password or connect Google before enrolling a passkey.</div>
        )}
      </div>

      <div className="mt-6 border-t pt-5">
        <div className="flex items-center justify-between gap-3">
          <div><h3 className="text-sm font-semibold">Your passkeys</h3><p className="mt-1 text-xs text-neutral-400">Passkeys are attached to your global Business OS account, not a single workspace.</p></div>
          {!loading ? <span className="text-xs text-neutral-400">{items.length} saved</span> : null}
        </div>
        <div className="mt-3 divide-y rounded-2xl border">
          {loading ? <div className="flex items-center justify-center gap-2 p-6 text-sm text-neutral-500"><Loader2 className="size-4 animate-spin" />Loading passkeys…</div> : null}
          {!loading && !items.length ? <div className="p-6 text-center text-sm text-neutral-500">No passkeys added yet.</div> : null}
          {items.map((item) => (
            <div key={item.id} className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100"><KeyRound className="size-5 text-neutral-600" /></div>
                <div className="min-w-0">
                  <p className="font-semibold text-neutral-900">{item.name}</p>
                  <p className="mt-1 text-xs text-neutral-500">{item.backed_up ? "Synced passkey" : "Device-bound passkey"} · Added {formatDate(item.created_at)}</p>
                  <p className="mt-1 text-xs text-neutral-400">Last used {formatDate(item.last_used_at)}</p>
                </div>
              </div>
              <button type="button" disabled={removingId === item.id} onClick={() => void removePasskey(item)} className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:opacity-50">
                {removingId === item.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}Remove
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 flex items-start gap-3 rounded-2xl bg-neutral-50 p-4 text-xs leading-5 text-neutral-600">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" />
        <p>Business OS never receives your fingerprint, face scan or device PIN. Your device verifies you locally and only a public-key credential is stored by Business OS.</p>
      </div>
    </section>
  );
}
