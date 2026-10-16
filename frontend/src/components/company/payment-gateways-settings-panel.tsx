"use client";

import { useCallback, useEffect, useState } from "react";
import { CreditCard, ExternalLink, Loader2, RefreshCw, ShieldCheck } from "lucide-react";

type StripeConnection = {
  provider: "stripe"; mode: "test" | "live"; connected: boolean;
  stripe_account_id: string | null; charges_enabled: boolean;
  payouts_enabled: boolean; details_submitted: boolean;
  checkout_available: boolean;
};
type ResponseData = { configured_modes: string[]; connections: StripeConnection[] };

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
      <p className="mt-2 max-w-3xl text-sm text-neutral-600">Each company links its own Stripe account. Account connection is organization-scoped; neither another company&apos;s account nor another company&apos;s payments are accessible.</p></div>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
    {notice && <div role="status" className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm">{notice}</div>}
    {!data && !error && <div className="flex items-center gap-2 text-sm text-neutral-500"><Loader2 className="size-4 animate-spin" />Loading gateway settings…</div>}
    <div className="grid gap-4 lg:grid-cols-2">{(["test", "live"] as const).map(mode => {
      const row = data?.connections.find(x => x.mode === mode);
      const configured = Boolean(data?.configured_modes.includes(mode));
      return <section key={mode} className="rounded-2xl border p-5">
        <div className="flex items-center justify-between gap-3"><h4 className="font-semibold">{mode === "test" ? "Stripe Test Mode" : "Stripe Live Mode"}</h4>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${row?.connected ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-500"}`}>{row?.connected ? "Connected" : "Not connected"}</span>
        </div>
        {row?.connected ? <>
          <p className="mt-3 break-all font-mono text-xs text-neutral-600">{row.stripe_account_id}</p>
          <div className="mt-3 space-y-1 text-sm">
            <p>Charges: <span className={row.charges_enabled ? "text-emerald-700" : "text-amber-700"}>{row.charges_enabled ? "Enabled" : "Pending verification"}</span></p>
            <p>Payouts: {row.payouts_enabled ? "Enabled" : "Pending verification"}</p>
            <p>Account details: {row.details_submitted ? "Submitted" : "Incomplete"}</p>
          </div>
          <button type="button" onClick={() => void refresh(mode)} disabled={Boolean(busy)} className="mt-4 inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium disabled:opacity-50"><RefreshCw className="size-4" />Refresh Stripe status</button>
        </> : <>
          <p className="mt-3 text-sm text-neutral-500">Authorize this workspace to use its Stripe account. Only a company admin can initiate the connection.</p>
          <button type="button" onClick={() => void connect(mode)} disabled={!configured || Boolean(busy)} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40">{busy === mode ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}Connect with Stripe</button>
          {!configured && <p className="mt-2 text-xs text-amber-700">Platform Stripe Connect {mode} credentials have not been configured.</p>}
        </>}
      </section>;
    })}</div>
    <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <ShieldCheck className="mt-0.5 size-5 shrink-0" />
      <p><strong>Payment collection is not active yet.</strong> Linking a Stripe account does not automatically create Checkout Sessions or mark invoices paid. The next integration stage must ship verified webhooks, idempotent invoice posting and reconciliation before live payments are enabled. Do not use manual Stripe receipts to mark an invoice paid twice.</p>
    </div>
  </div>;
}
