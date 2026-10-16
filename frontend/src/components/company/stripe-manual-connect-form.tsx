"use client";

import { FormEvent, useState } from "react";
import { ExternalLink, KeyRound } from "lucide-react";

type Mode = "test" | "live";

export function StripeManualConnectForm({
  mode, connected, enabled, onConnected,
}: {
  mode: Mode;
  connected: boolean;
  enabled: boolean;
  onConnected: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setSecretKey("");
    setWebhookSecret("");
    setError(null);
    setOpen(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!secretKey.trim() || saving) return;
    if (connected && !window.confirm("Replace the existing Stripe connection for this mode? Existing invoices and accounting data will not be changed.")) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/finance/payment-gateways/stripe/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          secret_key: secretKey.trim(),
          webhook_secret: webhookSecret.trim() || null,
          replace_existing: connected,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof body?.detail === "string" ? body.detail : "Could not verify Stripe credentials");
      close();
      await onConnected();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Stripe account connection failed");
    } finally {
      setSaving(false);
    }
  }

  return <div className="mt-4">
    <button type="button" disabled={!enabled || saving} onClick={() => { if (open) close(); else setOpen(true); }}
      className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2.5 text-sm font-medium disabled:opacity-40">
      <KeyRound className="size-4" />{connected ? "Replace API credentials" : "Add Stripe API Key"}
    </button>
    {!enabled ? <p className="mt-2 text-xs text-amber-700">The SaaS administrator must configure server-side payment gateway encryption once before companies can securely save keys.</p> : null}
    {open && <form onSubmit={(event) => void submit(event)} className="mt-3 space-y-3 rounded-xl border bg-neutral-50 p-4">
      <h5 className="text-sm font-semibold">{mode === "test" ? "Test" : "Live"} Stripe credentials</h5>
      <label className="block text-sm">Secret Key <span className="text-red-600">*</span>
        <input type="password" autoComplete="off" spellCheck={false} value={secretKey}
          onChange={(event) => setSecretKey(event.target.value)} required
          placeholder={mode === "test" ? "sk_test_..." : "sk_live_..."}
          className="mt-1 w-full rounded-lg border bg-white px-3 py-2.5 font-mono text-sm" />
      </label>
      <label className="block text-sm">Webhook Signing Secret (optional until checkout integration)
        <input type="password" autoComplete="off" spellCheck={false} value={webhookSecret}
          onChange={(event) => setWebhookSecret(event.target.value)} placeholder="whsec_..."
          className="mt-1 w-full rounded-lg border bg-white px-3 py-2.5 font-mono text-sm" />
      </label>
      <p className="text-xs leading-5 text-neutral-500">Keys are validated directly with Stripe and stored encrypted, never displayed again. Never share a Secret Key in chat. <a
        href={mode === "test" ? "https://dashboard.stripe.com/test/apikeys" : "https://dashboard.stripe.com/apikeys"}
        target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium underline">
        Stripe API Keys <ExternalLink className="size-3" /></a></p>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving || !secretKey.trim()} className="rounded-lg bg-neutral-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{saving ? "Verifying…" : "Verify & Connect"}</button>
        <button type="button" onClick={close} disabled={saving} className="rounded-lg border px-3 py-2 text-xs">Cancel</button>
      </div>
    </form>}
  </div>;
}
