"use client";

import { FormEvent, useEffect, useState } from "react";
import { getApiErrorMessage } from "@/lib/api-error";
import type { FinancialAccountEditData } from "@/components/financial-account-edit-panel";

type Gateway = { id: string | null; mode: "test" | "live"; connected: boolean; payouts_enabled: boolean };
type Payout = { id: string; stripe_payout_id: string; transfer_id: string; currency: string; amount: string; bank_account_id: string; source_account_id: string; bank_statement_reference: string; accounting_posted: boolean };

export function StripeLivePayoutPanel({ account, onPosted }: {
  account: FinancialAccountEditData;
  onPosted: () => Promise<void>;
}) {
  const [isLive, setIsLive] = useState(false);
  const [accounts, setAccounts] = useState<FinancialAccountEditData[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [destination, setDestination] = useState("");
  const [payoutId, setPayoutId] = useState("");
  const [bankReference, setBankReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch("/api/finance/payment-gateways/stripe", { cache: "no-store" }).then(r => r.ok ? r.json() : null),
      fetch("/api/finance/accounts", { cache: "no-store" }).then(r => r.ok ? r.json() : []),
      fetch("/api/finance/stripe-payouts", { cache: "no-store" }).then(r => r.ok ? r.json() : []),
    ]).then(([gatewayResult, financialAccounts, recentPayouts]) => {
      if (!active) return;
      const activeGateway = (gatewayResult?.connections ?? []).find((g: Gateway) =>
        g.connected && g.mode === "live" && g.id === account.gateway_connection_id);
      setIsLive(Boolean(activeGateway));
      setAccounts((financialAccounts ?? []) as FinancialAccountEditData[]);
      setPayouts((recentPayouts ?? []) as Payout[]);
    }).catch(() => { if (active) setError("Could not load connected payout settings"); });
    return () => { active = false; };
  }, [account.gateway_connection_id]);

  if (!isLive || account.account_type !== "payment_gateway") return null;
  const banks = accounts.filter(a => a.account_type === "bank" && a.currency === account.currency && a.is_active);
  const recent = payouts.filter(p => p.source_account_id === account.id);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.confirm("Confirm that the payout is marked PAID in Stripe Live and the exact amount has appeared in the selected bank statement. This action posts a real accounting transfer.")) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch("/api/finance/stripe-payouts/reconcile", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stripe_payout_id: payoutId.trim(),
          source_account_id: account.id,
          bank_account_id: destination,
          bank_statement_reference: bankReference.trim(),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getApiErrorMessage(data, "Stripe payout verification failed"));
      setNotice(`Verified payout ${data.stripe_payout_id}: posted ${data.currency} ${data.amount} as a transfer, not revenue.`);
      setPayouts(prev => prev.some(p => p.id === data.id) ? prev : [data, ...prev]);
      setPayoutId(""); setBankReference("");
      await onPosted();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Payout reconciliation failed");
    } finally { setBusy(false); }
  }

  return <section className="rounded-2xl border bg-white p-5">
    <h2 className="text-lg font-semibold">Stripe Live Payout Reconciliation</h2>
    <p className="mt-1 text-sm text-neutral-500">Only verified, paid USD payouts with matching bank statement evidence can move funds from Stripe Clearing to Bank. This is a transfer, not income.</p>
    <p className="mt-2 text-xs font-medium text-amber-800">Sandbox payouts cannot enter accounting. Cross-currency payouts, refunds and disputes require separate reconciliation.</p>
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}
    <form onSubmit={(e) => void submit(e)} className="mt-4 grid gap-3 md:grid-cols-2">
      <label className="text-xs font-medium">Stripe Payout ID (po_...)
        <input required value={payoutId} onChange={e => setPayoutId(e.target.value)} pattern="po_[A-Za-z0-9]{8,110}" placeholder="po_..." className="mt-1 w-full rounded-lg border p-3 text-sm" />
      </label>
      <label className="text-xs font-medium">Destination Bank Account
        <select required value={destination} onChange={e => setDestination(e.target.value)} className="mt-1 w-full rounded-lg border bg-white p-3 text-sm">
          <option value="">Select matching currency bank</option>
          {banks.map(bank => <option value={bank.id} key={bank.id}>{bank.name} · {bank.currency}</option>)}
        </select>
      </label>
      <label className="text-xs font-medium md:col-span-2">Confirmed Bank Statement Reference
        <input required minLength={6} maxLength={180} value={bankReference} onChange={e => setBankReference(e.target.value)} placeholder="Statement transaction reference confirming actual credit" className="mt-1 w-full rounded-lg border p-3 text-sm" />
      </label>
      <div className="md:col-span-2"><button type="submit" disabled={busy || !banks.length} className="rounded-lg bg-neutral-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">{busy ? "Verifying & posting…" : "Verify Payout & Record Transfer"}</button></div>
    </form>
    {recent.length > 0 && <div className="mt-5 space-y-2">
      <h3 className="text-sm font-semibold">Reconciled payouts</h3>
      {recent.slice(0, 10).map(p => <div key={p.id} className="flex flex-wrap justify-between gap-2 rounded-lg border p-3 text-xs"><span>{p.stripe_payout_id}<span className="ml-2 text-neutral-500">· Bank ref {p.bank_statement_reference}</span></span><strong>{p.currency} {p.amount} · Transferred</strong></div>)}
    </div>}
  </section>;
}
