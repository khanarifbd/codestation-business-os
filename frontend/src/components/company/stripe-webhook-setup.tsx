"use client";

import { FormEvent, useState } from "react";
import { useCompanyProviderChild, type ProviderChildLeaveRegistration } from "@/hooks/use-company-provider-child";
import { Check, Copy, ShieldCheck } from "lucide-react";

export function StripeWebhookSetup({
  url, configured, onSaved, mode = "test", enabled = true, registerLeaveGuard, registerOperationGuard, mayStart,
}: {
  url: string | null; configured: boolean; onSaved: () => Promise<void>;
  mode?: "test" | "live";
  enabled?: boolean; registerLeaveGuard?: ProviderChildLeaveRegistration;
  registerOperationGuard?: ProviderChildLeaveRegistration; mayStart?: () => boolean;
}) {
  const [draft, setDraft] = useState<{ scope: object | null; value: string }>({ scope: null, value: "" });
  const [showInput, setShowInput] = useState(false);
  const guard = useCompanyProviderChild(`webhook:${mode}`, enabled, registerLeaveGuard, registerOperationGuard, mayStart);
  const loading = guard.busy, error = guard.error;
  const secret = draft.scope === guard.identity ? draft.value : "";
  const setSecret = (value: string) => setDraft({ scope: guard.identity, value });
  const [message, setMessage] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!secret.trim() || !guard.canEdit()) return;
    setMessage(null);
    await guard.run(() => fetch("/api/finance/stripe-checkout/webhook-secret", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, signing_secret: secret.trim() }),
    }), value => Boolean(value && typeof value === "object" && "webhook_configured" in value && value.webhook_configured === true), async () => {
      setSecret(""); setShowInput(false);
      await onSaved();
      if (guard.current()) setMessage(`${mode === "test" ? "Sandbox" : "Live"} webhook secret saved securely.`);
    });
  }

  return <div className="mt-4 rounded-xl border bg-neutral-50 p-4 text-sm">
    <div className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-4" />{mode === "test" ? "Sandbox Checkout Webhook" : "Live Lifecycle Review Webhook"}</div>
    <p className="mt-1 text-xs text-neutral-500">{mode === "test" ? "Register this endpoint in Stripe Sandbox → Developers → Webhooks. Listen for checkout.session.completed and checkout.session.async_payment_succeeded." : "Register this separate endpoint in Stripe Live → Developers → Webhooks. Select checkout.session.completed, charge.refunded, charge.dispute.created, charge.dispute.closed, payout.paid and payout.failed. Events are recorded for review; no automatic Live accounting posting is enabled."}</p>
    {!url && <p className="mt-2 text-xs text-red-700">The platform administrator must configure PUBLIC_API_URL before you can register the webhook.</p>}
    {url && <div className="mt-3 flex flex-col gap-2 sm:flex-row">
      <code className="min-w-0 flex-1 break-all rounded-lg border bg-white px-3 py-2 text-xs">{url}</code>
      <button type="button" onClick={async () => { if (!guard.current()) return; await navigator.clipboard.writeText(url); if (guard.current()) setMessage("Webhook endpoint copied."); }} className="inline-flex items-center justify-center gap-2 rounded-lg border bg-white px-3 py-2 text-xs"><Copy className="size-3.5" />Copy URL</button>
    </div>}
    <p className="mt-2 text-xs">{configured ? <span className="inline-flex items-center gap-1 font-medium text-emerald-700"><Check className="size-3.5"/>Signing secret configured</span> : <span className="text-amber-700">Stripe signing secret not configured</span>}</p>
    <button type="button" disabled={guard.locked} onClick={() => { if (!guard.discard()) return; setShowInput(!showInput); setSecret(""); }} className="mt-3 rounded-lg border bg-white px-3 py-2 text-xs font-medium">{configured ? "Rotate webhook signing secret" : "Add webhook signing secret"}</button>
    {showInput && <form onSubmit={(event) => void save(event)} className="mt-3 space-y-2">
      <label htmlFor="stripe-webhook-secret" className="block text-xs font-medium">Signing secret from this Stripe Webhook Endpoint</label>
      <input id="stripe-webhook-secret" type="password" required autoComplete="off" spellCheck={false} value={secret} disabled={guard.locked} onChange={(event) => { if (guard.changeDirty(Boolean(event.target.value))) setSecret(event.target.value); }} placeholder="whsec_..." className="w-full rounded-lg border bg-white px-3 py-2 text-sm" />
      <button type="submit" disabled={guard.locked || !secret.startsWith("whsec_")} className="rounded-lg bg-neutral-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{loading ? "Saving…" : "Save securely"}</button>
    </form>}
    {message && <p role="status" className="mt-2 text-xs text-emerald-700">{message}</p>}
    {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
    <p className="mt-3 text-xs text-amber-800">{mode === "test" ? "Sandbox payment confirmation is recorded for testing only. No Invoice, Financial Account, Journal or Reports balance changes." : "Live event delivery is review-only. Refund/dispute posting remains blocked; bank payouts require Stripe verification and bank statement evidence."}</p>
  </div>;
}
