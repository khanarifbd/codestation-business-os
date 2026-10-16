"use client";

import { useCallback, useEffect, useState } from "react";
import { CreditCard, ExternalLink, Loader2, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import Link from "next/link";
import { StripeManualConnectForm } from "@/components/company/stripe-manual-connect-form";

type StripeConnection = {
  provider: "stripe"; mode: "test" | "live"; connected: boolean;
  stripe_account_id: string | null; charges_enabled: boolean;
  payouts_enabled: boolean; details_submitted: boolean;
  checkout_available: boolean;
  connection_method?: "oauth" | "api_key" | null;
  account_label?: string | null;
  credential_hint?: string | null;
  webhook_configured?: boolean;
};
type ResponseData = { configured_modes: string[]; manual_setup_available: boolean; connections: StripeConnection[] };

async function request<T>(path: string, method = "GET"): Promise<T> {
  const response = await fetch(`/api/finance/payment-gateways/stripe${path}`, {
    method, cache: "no-store",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.detail === "string" ? data.detail : "Stripe settings request failed");
  return data as T;
}

export function PaymentGatewaysSettingsPanel() {
  const [data, setData] = useState<ResponseData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setData(await request<ResponseData>("")); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load payment gateways"); }
  }, []);
  useEffect(() => {
    void load();
    const event = new URLSearchParams(window.location.search).get("stripe");
    if (event === "connected") setNotice("Stripe connected. Refresh account status and complete test-mode setup before enabling payments.");
    if (event === "cancelled") setNotice("Stripe authorization was cancelled; no changes to your account.");
  }, [load]);

  async function connect(mode: "test" | "live") {
    setBusy(mode); setError(null); setNotice(null);
    try {
      const { authorization_url } = await request<{ authorization_url: string }>(`/connect?mode=${mode}`, "POST");
      if (!authorization_url.startsWith("https://connect.stripe.com/oauth/authorize?")) {
        throw new Error("Unexpected Stripe authorization URL");
      }
      window.location.assign(authorization_url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start Stripe connection");
      setBusy(null);
    }
  }

  async function disconnect(mode: "test" | "live") {
    if (!window.confirm(`Disable the ${mode} Stripe connection? Stored API credentials will be erased. Existing accounting data remains intact.`)) return;
    setBusy(mode); setError(null); setNotice(null);
    try {
      await request(`/disable?mode=${mode}`, "POST");
      await load();
      setNotice(`Stripe ${mode} connection disabled.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to disable Stripe");
    } finally { setBusy(null); }
  }

  async function refresh(mode: "test" | "live") {
    setBusy(mode); setError(null); setNotice(null);
    try {
      await request(`/refresh?mode=${mode}`, "POST");
      await load();
      setNotice(`${mode === "test" ? "Test" : "Live"} Stripe status refreshed.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Stripe refresh failed");
    } finally { setBusy(null); }
  }

  return <div className="space-y-5">
    <div><h3 className="flex items-center gap-2 text-lg font-semibold"><CreditCard className="size-5" />Payment gateways</h3>
      <p className="mt-2 max-w-3xl text-sm text-neutral-600">Each company can connect its own payment providers. Stripe can be configured with organization-owned API keys, or using Stripe Connect when available. Connections and payments remain isolated by company.</p></div>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
    {notice && <div role="status" className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm">{notice}</div>}
    {!data && !error && <div className="flex items-center gap-2 text-sm text-neutral-500"><Loader2 className="size-4 animate-spin" />Loading gateway settings…</div>}
    {data && !data.manual_setup_available ? <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Secure API key storage is not yet configured on the Backend. An administrator must set PAYMENT_GATEWAY_ENCRYPTION_KEY once; companies can then connect their own Stripe accounts from this page.</p> : null}
    <div className="grid gap-4 lg:grid-cols-2">{(["test", "live"] as const).map(mode => {
      const row = data?.connections.find(x => x.mode === mode);
      const configured = Boolean(data?.configured_modes.includes(mode));
      return <section key={mode} className="rounded-2xl border p-5">
        <div className="flex items-center justify-between gap-3"><h4 className="font-semibold">{mode === "test" ? "Stripe Test Mode" : "Stripe Live Mode"}</h4>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${row?.connected ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-500"}`}>{row?.connected ? "Connected" : "Not connected"}</span>
        </div>
        {row?.connected ? <>
          <p className="mt-3 text-sm font-medium">{row.account_label || "Stripe account"}</p><p className="mt-1 break-all font-mono text-xs text-neutral-600">{row.stripe_account_id}</p><p className="mt-1 text-xs text-neutral-500">{row.connection_method === "api_key" ? "Company API key" : "Stripe Connect"}{row.credential_hint ? ` · ${row.credential_hint}` : ""}</p>
          <div className="mt-3 space-y-1 text-sm">
            <p>Charges: <span className={row.charges_enabled ? "text-emerald-700" : "text-amber-700"}>{row.charges_enabled ? "Enabled" : "Pending verification"}</span></p>
            <p>Payouts: {row.payouts_enabled ? "Enabled" : "Pending verification"}</p>
            <p>Account details: {row.details_submitted ? "Submitted" : "Incomplete"}</p><p>Webhook secret saved: {row.webhook_configured ? "Yes" : "No"}</p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => void refresh(mode)} disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium disabled:opacity-50"><RefreshCw className="size-4" />Refresh status</button><button type="button" onClick={() => void disconnect(mode)} disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-50"><Unplug className="size-4" />Disable</button></div>
          <StripeManualConnectForm mode={mode} connected enabled={Boolean(data?.manual_setup_available)} onConnected={async () => { await load(); setNotice("Company Stripe connection verified and stored securely. Checkout is not enabled yet."); }} />
        </> : <>
          <p className="mt-3 text-sm text-neutral-500">Authorize this workspace to use its Stripe account. Only a company admin can initiate the connection.</p>
          <StripeManualConnectForm mode={mode} connected={false} enabled={Boolean(data?.manual_setup_available)} onConnected={async () => { await load(); setNotice("Company Stripe connection verified and stored securely. Checkout is not enabled yet."); }} />
          {configured && <button type="button" onClick={() => void connect(mode)} disabled={Boolean(busy)} className="mt-3 inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium disabled:opacity-50">{busy === mode ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}Connect via Stripe OAuth</button>}
        </>}
      </section>;
    })}</div>
    <div className="rounded-2xl border p-5"><h4 className="font-semibold">Other payment methods</h4><p className="mt-1 text-sm text-neutral-500">Gateway providers can coexist for each company. Automated PayPal integration is planned; bank and Payoneer payment destinations are already available via Financial Accounts.</p><div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-xl border p-3 text-sm"><strong>PayPal</strong><p className="mt-1 text-xs text-neutral-500">Coming later</p></div><div className="rounded-xl border p-3 text-sm"><strong>Payoneer / Wise</strong><p className="mt-1 text-xs text-neutral-500">Manual payment links</p></div><div className="rounded-xl border p-3 text-sm"><strong>Bank Transfer</strong><p className="mt-1 text-xs text-neutral-500"><Link href="/dashboard/accounting/accounts" className="underline">Manage Financial Accounts</Link></p></div></div></div>
    <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <ShieldCheck className="mt-0.5 size-5 shrink-0" />
      <p><strong>Payment collection is not active yet.</strong> Linking a Stripe account does not automatically create Checkout Sessions or mark invoices paid. The next integration stage must ship verified webhooks, idempotent invoice posting and reconciliation before live payments are enabled. Do not use manual Stripe receipts to mark an invoice paid twice.</p>
    </div>
  </div>;
}
