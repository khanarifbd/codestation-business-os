"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, CreditCard, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { getApiErrorMessage } from "@/lib/api-error";

type Attempt = {
  id: string;
  invoice_id: string;
  mode: "test";
  amount: string;
  currency: string;
  status: string;
  checkout_url: string | null;
  expires_at: string | null;
  completed_at: string | null;
};
type SandboxStatus = {
  test_mode: boolean;
  gateway_connected: boolean;
  financial_account_linked: boolean;
  financial_account_name: string | null;
  webhook_configured: boolean;
  checkout_available: boolean;
  attempts: Attempt[];
};

export function InvoiceStripeSandboxPanel({
  invoiceId, currency, status: invoiceStatus, canManage,
}: {
  invoiceId: string; currency: string; status: string; canManage: boolean;
}) {
  const [data, setData] = useState<SandboxStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const response = await fetch(`/api/finance/stripe-checkout/invoices/${encodeURIComponent(invoiceId)}`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(getApiErrorMessage(body, "Could not load Stripe test sessions"));
    setData(body as SandboxStatus);
  }, [invoiceId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void reload().catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Stripe sandbox unavailable"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);

  async function generate() {
    if (!canManage) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/finance/stripe-checkout/invoices/${encodeURIComponent(invoiceId)}`, { method: "POST" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getApiErrorMessage(body, "Could not create Stripe Checkout"));
      await reload();
      const attempt = body as Attempt;
      if (attempt.checkout_url) {
        await navigator.clipboard.writeText(attempt.checkout_url);
        setNotice("Sandbox Checkout link generated and copied. Share this link only with test participants.");
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Stripe Sandbox Checkout failed"); }
    finally { setBusy(false); }
  }

  const latest = data?.attempts[0];
  const eligible = ["sent", "partially_paid"].includes(invoiceStatus);
  if (loading && !data) return <div className="rounded-xl border p-4 text-xs text-neutral-500">Checking Stripe Sandbox availability…</div>;
  if (!data?.gateway_connected && !latest) return null;
  return <section className="rounded-2xl border border-violet-200 bg-violet-50/50 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="flex items-center gap-2 text-lg font-semibold"><CreditCard className="size-5" />Stripe Sandbox Checkout</h2>
        <p className="mt-1 text-sm text-neutral-600">Test with Stripe test cards only. Sandbox payments are never booked into real Invoice Balances or Accounting Journals.</p>
      </div>
      <button type="button" onClick={() => void reload().catch(reason => setError(reason instanceof Error ? reason.message : "Refresh failed"))} className="inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-xs"><RefreshCw className="size-3.5" />Refresh Test Status</button>
    </div>
    {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">{notice}</p>}
    {!data?.webhook_configured && <p className="mt-3 text-xs text-amber-800">First configure a Stripe Sandbox webhook in <Link href="/dashboard/company?tab=payments" className="font-semibold underline">Company Payment Gateways</Link>.</p>}
    {data?.gateway_connected && !data.financial_account_linked && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">This invoice&apos;s receipt account is not linked to your Stripe Sandbox. Go to <Link href="/dashboard/accounting/accounts" className="font-semibold underline">Financial Accounts</Link>, open the existing Stripe Payment account, select <strong>Edit account & gateway</strong>, and link the connected Stripe Sandbox. This mapping does not change any balance.</p>}
    {data?.financial_account_linked && <p className="mt-3 text-xs text-emerald-700">Receipt account mapped: {data.financial_account_name}. Test payments will not update this account balance.</p>}
    {currency !== "USD" && <p className="mt-3 text-xs text-amber-800">Sandbox Checkout is initially enabled for USD invoices only.</p>}
    {!eligible && <p className="mt-3 text-xs text-amber-800">Send the invoice before creating a Checkout link.</p>}
    {canManage && <button disabled={busy || !data?.checkout_available} type="button" onClick={() => void generate()} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{busy ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}Generate Sandbox Payment Link</button>}
    {latest && <div className="mt-4 rounded-xl border bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Latest Sandbox Session · {latest.currency} {latest.amount}</p>
      <p className="mt-2 text-sm">Status: <strong className={latest.status === "sandbox_paid" ? "text-emerald-700" : "text-neutral-700"}>{latest.status === "sandbox_paid" ? "Paid (Sandbox Only)" : latest.status.replaceAll("_", " ")}</strong></p>
      {latest.checkout_url && <div className="mt-3 flex flex-wrap gap-2">
        <a href={latest.checkout_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs"><ExternalLink className="size-3.5" />Open Checkout</a>
        <button type="button" onClick={() => void navigator.clipboard.writeText(latest.checkout_url!)} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs"><Copy className="size-3.5"/>Copy Payment Link</button>
      </div>}
      {latest.status === "sandbox_paid" && <p className="mt-2 flex items-center gap-2 text-xs text-emerald-700"><Check className="size-4" />Stripe Sandbox payment verified by signed webhook. Real invoice is unchanged.</p>}
    </div>}
  </section>;
}
