"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, RefreshCw, ShieldCheck } from "lucide-react";
import { getApiErrorMessage } from "@/lib/api-error";

type PreviewLine = { debit: string; credit: string; amount: string; currency: string };
type Settlement = {
  reconciled: boolean; accounting_posted: boolean; reason?: string;
  currency?: string; gross?: string; processing_fee?: string;
  net_stripe_balance?: string; availability_status?: string;
  stripe_balance_transaction_id?: string; financial_account?: string;
  journal_preview?: PreviewLine[]; notice?: string;
};

export function StripeSandboxSettlementPreview({
  invoiceId, attemptId, canManage,
}: {
  invoiceId: string; attemptId: string; canManage: boolean;
}) {
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const path = `/api/finance/stripe-settlement/invoices/${encodeURIComponent(invoiceId)}/attempts/${encodeURIComponent(attemptId)}`;
  const refresh = useCallback(async () => {
    const response = await fetch(path, { cache: "no-store" });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(getApiErrorMessage(result, "Could not read Stripe settlement"));
    setSettlement(result as Settlement);
  }, [path]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setSettlement(null);
    void refresh().catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Settlement unavailable"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]);

  async function reconcile() {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`${path}/reconcile`, { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getApiErrorMessage(data, "Could not verify Stripe fees"));
      setSettlement(data as Settlement);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Stripe settlement verification failed");
    } finally { setBusy(false); }
  }

  return <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-4" />Stripe Fee & Settlement Reconciliation</h3>
        <p className="mt-1 text-xs text-neutral-500">Verified against Stripe's actual balance transaction. No estimated processing fee.</p>
      </div>
      <button type="button" disabled={busy || loading} onClick={() => void refresh().catch(reason => setError(reason instanceof Error ? reason.message : "Could not refresh settlement"))} className="inline-flex items-center gap-1 rounded-lg border bg-white px-3 py-2 text-xs disabled:opacity-40"><RefreshCw className="size-3.5" />Refresh</button>
    </div>
    {loading && <p className="mt-3 text-xs text-neutral-500">Checking reconciliation status…</p>}
    {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {!settlement?.reconciled && !loading && <>
      <p className="mt-3 text-xs text-amber-800">The Sandbox payment was verified, but Stripe fee and net settlement have not been retrieved yet.</p>
      {canManage && <button type="button" disabled={busy} onClick={() => void reconcile()} className="mt-3 rounded-lg bg-neutral-950 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-40">{busy ? "Verifying Stripe Balance…" : "Verify Fee & Net Settlement"}</button>}
    </>}
    {settlement?.reconciled && <>
      <p className="mt-3 flex items-center gap-2 text-xs font-medium text-emerald-700"><CheckCircle2 className="size-4" />Stripe Settlement Verified (Sandbox Only)</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border bg-white p-3"><p className="text-xs text-neutral-500">Gross received</p><p className="mt-1 font-semibold">{settlement.currency} {settlement.gross}</p></div>
        <div className="rounded-lg border bg-white p-3"><p className="text-xs text-neutral-500">Stripe processing fee</p><p className="mt-1 font-semibold">{settlement.currency} {settlement.processing_fee}</p></div>
        <div className="rounded-lg border bg-white p-3"><p className="text-xs text-neutral-500">Net Stripe balance</p><p className="mt-1 font-semibold">{settlement.currency} {settlement.net_stripe_balance}</p></div>
      </div>
      <p className="mt-3 text-xs text-neutral-500">Balance transaction: <code className="break-all">{settlement.stripe_balance_transaction_id}</code> · {settlement.availability_status}</p>
      <div className="mt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Proposed Journal Entries · Preview Only</h4>
        <div className="mt-2 space-y-2">
          {(settlement.journal_preview ?? []).map((line, index) => <div key={index} className="grid gap-1 rounded-lg border bg-white p-3 text-xs sm:grid-cols-[1fr_1fr_auto]">
            <span>Debit: <strong>{line.debit}</strong></span>
            <span>Credit: <strong>{line.credit}</strong></span>
            <span className="font-semibold">{line.currency} {line.amount}</span>
          </div>)}
        </div>
      </div>
      <p className="mt-3 text-xs text-amber-900">{settlement.notice}</p>
    </>}
  </div>;
}
