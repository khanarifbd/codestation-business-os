"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CreditCard, ExternalLink, Loader2, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import Link from "next/link";
import { useAdministrationReadOwner } from "@/hooks/use-administration-read-owner";
import { CompanyPanelReadError, useCompanyPanelSafety, type CompanyPanelLeaveRegistration } from "@/hooks/use-company-panel-safety";
import { StripeManualConnectForm } from "@/components/company/stripe-manual-connect-form";
import { StripeWebhookSetup } from "@/components/company/stripe-webhook-setup";
import { StripeLiveLifecycleReview } from "@/components/company/stripe-live-lifecycle-review";

type StripeConnection = {
  provider: "stripe"; mode: "test" | "live"; connected: boolean;
  stripe_account_id: string | null; charges_enabled: boolean;
  payouts_enabled: boolean; details_submitted: boolean;
  checkout_available: boolean;
  connection_method?: "oauth" | "api_key" | null;
  account_label?: string | null;
  credential_hint?: string | null;
  webhook_configured?: boolean;
  webhook_url?: string | null;
};
type ResponseData = { configured_modes: string[]; manual_setup_available: boolean; connections: StripeConnection[] };

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const nullableText = (value: unknown) => value === null || typeof value === "string";
function isConnection(value: unknown): value is StripeConnection {
  return record(value) && value.provider === "stripe" && ["test", "live"].includes(String(value.mode))
    && ["connected", "charges_enabled", "payouts_enabled", "details_submitted", "checkout_available"].every(key => typeof value[key] === "boolean")
    && nullableText(value.stripe_account_id) && ["account_label", "credential_hint", "webhook_url"].every(key => value[key] === undefined || nullableText(value[key]))
    && (value.connection_method === undefined || value.connection_method === null || ["oauth", "api_key"].includes(String(value.connection_method)))
    && (value.webhook_configured === undefined || typeof value.webhook_configured === "boolean");
}
function isGatewayData(value: unknown): value is ResponseData {
  return record(value) && typeof value.manual_setup_available === "boolean" && Array.isArray(value.configured_modes)
    && value.configured_modes.every(mode => mode === "test" || mode === "live") && Array.isArray(value.connections)
    && value.connections.length === 2 && value.connections.every(isConnection) && new Set(value.connections.map(row => row.mode)).size === 2;
}
async function readGateway(): Promise<ResponseData> {
  const response = await fetch("/api/finance/payment-gateways/stripe", { method: "GET", cache: "no-store" });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || !isGatewayData(body)) throw new CompanyPanelReadError("Payment gateway settings could not be verified. Retry reading current status.", response.status);
  return body;
}
export function PaymentGatewaysSettingsPanel({ registerLeaveGuard }: { registerLeaveGuard?: CompanyPanelLeaveRegistration }) {
  const owner = useAdministrationReadOwner();
  if (owner.loading || !owner.tenant) return <p role="status">Checking gateway settings access…</p>;
  if (!owner.tenant.permissions.some(value => value === "*" || value === "finance.view")) return <p role="alert">Finance view access is required to read payment gateway settings.</p>;
  return <PaymentGatewaysContent key={`${owner.key}:${owner.tenant.role}`} canManage={owner.tenant.role === "admin"} registerLeaveGuard={registerLeaveGuard}/>;
}
function PaymentGatewaysContent({ canManage, registerLeaveGuard }: { canManage: boolean; registerLeaveGuard?: CompanyPanelLeaveRegistration }) {
  const safety = useCompanyPanelSafety(true, canManage);
  const childLeaves = useRef<Record<string, () => boolean>>({});
  const childOperations = useRef<Record<string, () => boolean>>({});
  const registerChildLeave = useCallback((key: string, guard: () => boolean) => { childLeaves.current[key] = guard; return () => { if (childLeaves.current[key] === guard) delete childLeaves.current[key]; }; }, []);
  const registerChildOperation = useCallback((key: string, guard: () => boolean) => { childOperations.current[key] = guard; return () => { if (childOperations.current[key] === guard) delete childOperations.current[key]; }; }, []);
  const manualTestLeave = useCallback((guard: () => boolean) => registerChildLeave("manual-test", guard), [registerChildLeave]);
  const manualTestOperation = useCallback((guard: () => boolean) => registerChildOperation("manual-test", guard), [registerChildOperation]);
  const manualLiveLeave = useCallback((guard: () => boolean) => registerChildLeave("manual-live", guard), [registerChildLeave]);
  const manualLiveOperation = useCallback((guard: () => boolean) => registerChildOperation("manual-live", guard), [registerChildOperation]);
  const webhookTestLeave = useCallback((guard: () => boolean) => registerChildLeave("webhook-test", guard), [registerChildLeave]);
  const webhookTestOperation = useCallback((guard: () => boolean) => registerChildOperation("webhook-test", guard), [registerChildOperation]);
  const webhookLiveLeave = useCallback((guard: () => boolean) => registerChildLeave("webhook-live", guard), [registerChildLeave]);
  const webhookLiveOperation = useCallback((guard: () => boolean) => registerChildOperation("webhook-live", guard), [registerChildOperation]);
  const childRegistrations = {
    "manual-test": { registerLeaveGuard: manualTestLeave, registerOperationGuard: manualTestOperation },
    "manual-live": { registerLeaveGuard: manualLiveLeave, registerOperationGuard: manualLiveOperation },
    "webhook-test": { registerLeaveGuard: webhookTestLeave, registerOperationGuard: webhookTestOperation },
    "webhook-live": { registerLeaveGuard: webhookLiveLeave, registerOperationGuard: webhookLiveOperation },
  };
  const canStart = (child?: string) => safety.canEdit() && Object.entries(childOperations.current).every(([key, guard]) => key === child || guard());
  const ownLeave = safety.confirmLeave;
  const combinedLeave = useCallback(() => ownLeave() && Object.values(childLeaves.current).every(guard => guard()), [ownLeave]);
  useLayoutEffect(() => registerLeaveGuard?.(combinedLeave), [registerLeaveGuard, combinedLeave]);
  const [data, setData] = useState<ResponseData | null>(null);
  const [busyMode, setBusyMode] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busy = safety.busy ? busyMode : null, error = safety.error;
  const visibleData = safety.readDenied ? null : data;
  const readOwned = safety.read;
  const load = useCallback(() => readOwned(readGateway, setData), [readOwned]);
  useEffect(() => {
    void load();
    const event = new URLSearchParams(window.location.search).get("stripe");
    if (event === "connected") setNotice("Stripe connected. Refresh account status and complete test-mode setup before enabling payments.");
    if (event === "cancelled") setNotice("Stripe authorization was cancelled; no changes to your account.");
  }, [load]);
  async function connect(mode: "test" | "live") {
    if (!canStart()) return;
    setBusyMode(mode); setNotice(null);
    await safety.run(() => fetch(`/api/finance/payment-gateways/stripe/connect?mode=${mode}`, { method: "POST", cache: "no-store" }),
      (value): value is { authorization_url: string } => record(value) && typeof value.authorization_url === "string" && value.authorization_url.startsWith("https://connect.stripe.com/oauth/authorize?"),
      value => { if (safety.current()) window.location.assign(value.authorization_url); }, true);
  }
  async function disconnect(mode: "test" | "live") {
    if (!canStart()) return;
    if (!window.confirm(`Disable the ${mode} Stripe connection? Stored API credentials will be erased. Existing accounting data remains intact.`)) return;
    setBusyMode(mode); setNotice(null);
    await safety.run(() => fetch(`/api/finance/payment-gateways/stripe/disable?mode=${mode}`, { method: "POST", cache: "no-store" }),
      (value): value is StripeConnection => isConnection(value) && value.mode === mode && !value.connected,
      async () => { const next = await readGateway(); if (!safety.current()) return; setData(next); setNotice(`Stripe ${mode} connection disabled.`); });
  }
  async function refresh(mode: "test" | "live") {
    if (!canStart()) return;
    setBusyMode(mode); setNotice(null);
    await safety.run(() => fetch(`/api/finance/payment-gateways/stripe/refresh?mode=${mode}`, { method: "POST", cache: "no-store" }),
      (value): value is StripeConnection => isConnection(value) && value.mode === mode && value.stripe_account_id === data?.connections.find(row => row.mode === mode)?.stripe_account_id,
      async () => { const next = await readGateway(); if (!safety.current()) return; setData(next); setNotice(`${mode === "test" ? "Test" : "Live"} Stripe status refreshed.`); });
  }
  async function childConnected() {
    if (!safety.current()) return;
    if (await load() && safety.current()) setNotice("Company Stripe connection verified and stored securely. Checkout is not enabled yet.");
  }

  return <div className="space-y-5">
    <div><h3 className="flex items-center gap-2 text-lg font-semibold"><CreditCard className="size-5" />Payment gateways</h3>
      <p className="mt-2 max-w-3xl text-sm text-neutral-600">Each company can connect its own payment providers. Stripe can be configured with organization-owned API keys, or using Stripe Connect when available. Connections and payments remain isolated by company.</p></div>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
    {safety.unresolved ? <div role="status">{safety.phase === "unknown" ? "The gateway operation outcome is unknown." : "The gateway operation was acknowledged; verification or navigation is incomplete."} Do not repeat it. A read does not prove the earlier operation failed.</div> : null}
    {(error || safety.unresolved) ? <button type="button" disabled={safety.busy || safety.reading} onClick={() => void load()}>Read gateway status only</button> : null}
    {visibleData && error ? <p>Previously verified gateway status is shown read-only; current access could not be verified.</p> : null}
    {notice && <div role="status" className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm">{notice}</div>}
    {!visibleData && !error && <div className="flex items-center gap-2 text-sm text-neutral-500"><Loader2 className="size-4 animate-spin" />Loading gateway settings…</div>}
    {visibleData && !visibleData.manual_setup_available ? <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Secure API key storage is not yet configured on the Backend. An administrator must set PAYMENT_GATEWAY_ENCRYPTION_KEY once; companies can then connect their own Stripe accounts from this page.</p> : null}
    {visibleData ? <fieldset disabled={safety.locked} className="m-0 min-w-0 border-0 p-0 grid gap-4 lg:grid-cols-2">{(["test", "live"] as const).map(mode => {
      const row = visibleData?.connections.find(x => x.mode === mode);
      const configured = Boolean(visibleData?.configured_modes.includes(mode));
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
          <StripeManualConnectForm {...childRegistrations[`manual-${mode}`]} mayStart={() => canStart(`manual-${mode}`)} mode={mode} connected enabled={canManage && Boolean(data?.manual_setup_available)} onConnected={childConnected} />
          {row.connection_method === "api_key" ? <StripeWebhookSetup key={mode} {...childRegistrations[`webhook-${mode}`]} mayStart={() => canStart(`webhook-${mode}`)} mode={mode} enabled={canManage} url={row.webhook_url ?? null} configured={Boolean(row.webhook_configured)} onSaved={async () => { await load(); }}/> : null}
          {mode === "live" ? <StripeLiveLifecycleReview /> : null}
        </> : <>
          <p className="mt-3 text-sm text-neutral-500">Authorize this workspace to use its Stripe account. Only a company admin can initiate the connection.</p>
          <StripeManualConnectForm {...childRegistrations[`manual-${mode}`]} mayStart={() => canStart(`manual-${mode}`)} mode={mode} connected={false} enabled={canManage && Boolean(data?.manual_setup_available)} onConnected={childConnected} />
          {configured && <button type="button" onClick={() => void connect(mode)} disabled={Boolean(busy)} className="mt-3 inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium disabled:opacity-50">{busy === mode ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}Connect via Stripe OAuth</button>}
        </>}
      </section>;
    })}</fieldset> : null}
    <div className="rounded-2xl border p-5"><h4 className="font-semibold">Other payment methods</h4><p className="mt-1 text-sm text-neutral-500">Gateway providers can coexist for each company. Automated PayPal integration is planned; bank and Payoneer payment destinations are already available via Financial Accounts.</p><div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-xl border p-3 text-sm"><strong>PayPal</strong><p className="mt-1 text-xs text-neutral-500">Coming later</p></div><div className="rounded-xl border p-3 text-sm"><strong>Payoneer / Wise</strong><p className="mt-1 text-xs text-neutral-500">Manual payment links</p></div><div className="rounded-xl border p-3 text-sm"><strong>Bank Transfer</strong><p className="mt-1 text-xs text-neutral-500"><Link href="/dashboard/accounting/accounts" className="underline">Manage Financial Accounts</Link></p></div></div></div>
    <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <ShieldCheck className="mt-0.5 size-5 shrink-0" />
      <p><strong>Only Sandbox Checkout is available for testing.</strong> After configuring the test Webhook Signing Secret, you can generate Stripe Sandbox Checkout links for issued USD invoices. Sandbox payments are recorded in test history and never change actual invoice balances, accounting journals or reports. Live payment collection remains disabled.</p>
    </div>
  </div>;
}
