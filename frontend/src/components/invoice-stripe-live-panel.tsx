"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "@/lib/qrcode-svg";
import { getApiErrorMessage } from "@/lib/api-error";

type LiveAttempt = {
  id: string; amount: string; currency: string; status: string;
  checkout_url: string | null;
};
type LiveStatus = {
  gateway_connected: boolean; platform_live_enabled: boolean;
  checkout_available: boolean; webhook_configured: boolean;
  financial_account_linked: boolean; attempts: LiveAttempt[];
};

function LiveInvoicePaymentQr({ value }: { value: string }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current) return;
    const element = container.current;
    const qr = QRCode({ msg: value, dim: 148, pad: 4, ecl: "M", pal: ["#000", "#fff"] });
    qr.setAttribute("role", "img");
    qr.setAttribute("aria-label", "Scan to pay the Stripe Live invoice");
    element.replaceChildren(qr);
    return () => { element.replaceChildren(); };
  }, [value]);
  return <div ref={container} className="size-[148px]" />;
}

export function InvoiceStripeLivePanel({invoiceId, currency, status, canManage}: {
  invoiceId: string; currency: string; status: string; canManage: boolean;
}) {
  const [state, setState] = useState<LiveStatus | null>(null);
  const [permanentPayLink, setPermanentPayLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const isPayable = ["sent", "partially_paid"].includes(status);
  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch(`/api/finance/stripe-checkout/live/invoices/${encodeURIComponent(invoiceId)}`, { cache: "no-store" }),
      fetch(`/api/finance/invoices/${encodeURIComponent(invoiceId)}/payment-instructions`, { cache: "no-store" }),
    ]).then(async ([checkoutResponse, paymentResponse]) => {
      const statusData = await checkoutResponse.json().catch(() => null);
      if (!checkoutResponse.ok) throw new Error(getApiErrorMessage(statusData, "Could not load Stripe Live status"));
      const paymentData = paymentResponse.ok ? await paymentResponse.json().catch(() => null) : null;
      if (!active) return;
      setState(statusData as LiveStatus);
      const url = paymentData?.payment_url;
      setPermanentPayLink(
        paymentData?.payment_method === "stripe" && typeof url === "string"
        && url.includes("/api/v1/finance/stripe-checkout/pay/") ? url : null
      );
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Cannot load Stripe Live"); });
    return () => { active = false; };
  }, [invoiceId, status]);
  if (!canManage || currency !== "USD" || (!state?.gateway_connected && !error)) return null;
  async function generate() {
    if (!window.confirm("Create a REAL Stripe Live Checkout payment link? Only share it with the invoice customer. The verified payment will post to the company's real accounting ledger.")) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/finance/stripe-checkout/live/invoices/${encodeURIComponent(invoiceId)}`, { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getApiErrorMessage(data, "Could not create Stripe Live Checkout"));
      if (!data?.checkout_url) throw new Error("Stripe Checkout link was not returned");
      await navigator.clipboard.writeText(data.checkout_url);
      setNotice("Stripe Live Checkout link generated and copied. Real money will be collected if the customer pays.");
      setState(prev => prev ? {...prev, attempts: [data, ...prev.attempts.filter(x => x.id !== data.id)]} : prev);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Stripe Live Checkout failed");
    } finally { setBusy(false); }
  }
  async function verifyExisting(attemptId: string) {
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch(
        `/api/finance/stripe-checkout/live/invoices/${encodeURIComponent(invoiceId)}/attempts/${encodeURIComponent(attemptId)}/reconcile`,
        { method: "POST" },
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getApiErrorMessage(data, "Could not reconcile Stripe Live payment"));
      setNotice(data.accounting_posted ? "Verified payment posted to Invoice, Clearing and Journal. Refresh the invoice to see updated balances." : "Stripe payment is pending or needs financial review.");
      const updated = await fetch(`/api/finance/stripe-checkout/live/invoices/${encodeURIComponent(invoiceId)}`, {cache:"no-store"});
      if (updated.ok) setState(await updated.json());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Stripe payment verification failed");
    } finally { setBusy(false); }
  }
  return <section className="rounded-2xl border border-blue-200 bg-blue-50/40 p-5">
    <h2 className="text-base font-semibold">Stripe Live Checkout</h2>
    <p className="mt-1 text-xs text-neutral-600">Real payments only. Signed webhook and Stripe API verification are required before automatic Invoice, Fee and Journal posting.</p>
    {!state?.platform_live_enabled && <p className="mt-3 text-xs font-medium text-amber-800">Live collection is disabled by the platform administrator. Enable it only after the final financial test and live merchant approval.</p>}
    {permanentPayLink && isPayable && <div className="mt-4 grid gap-4 rounded-xl border border-emerald-200 bg-white p-4 sm:grid-cols-[1fr_auto]">
      <div>
        <p className="text-sm font-semibold text-emerald-800">Automatic Invoice Payment Link</p>
        <p className="mt-1 text-xs text-neutral-500">Included in the client invoice and PDF. The QR opens a fresh Stripe Checkout, even after an earlier session expires.</p>
        <a href={permanentPayLink} target="_blank" rel="noopener noreferrer" className="mt-2 block break-all text-xs font-medium text-blue-700 underline">{permanentPayLink}</a>
        <button type="button" onClick={() => void navigator.clipboard.writeText(permanentPayLink).then(() => setNotice("Invoice payment link copied.")).catch(() => setError("Could not copy payment link"))}
          className="mt-3 rounded-lg border bg-white px-3 py-2 text-xs font-medium">Copy Client Payment Link</button>
      </div>
      <div className="flex flex-col items-center justify-center gap-1"><LiveInvoicePaymentQr value={permanentPayLink} /><span className="text-[11px] text-neutral-500">Scan to pay</span></div>
    </div>}
    {error && <p role="alert" className="mt-3 text-xs text-red-700">{error}</p>}
    {notice && <p role="status" className="mt-3 text-xs text-emerald-700">{notice}</p>}
    <button type="button" disabled={!state?.checkout_available || !isPayable || busy} onClick={() => void generate()}
      className="mt-4 rounded-xl bg-neutral-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">
      {busy ? "Generating Live Checkout…" : "Generate direct Checkout session (optional)"}
    </button>
    {state?.attempts?.length ? <div className="mt-4 space-y-2">
      {state.attempts.slice(0, 5).map(a => <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-white p-3 text-xs" key={a.id}>
        <span>{a.currency} {a.amount} · {a.status.replaceAll("_"," ")}</span>
        <span className="flex items-center gap-3">{a.checkout_url && a.status === "open" && <a href={a.checkout_url} target="_blank" rel="noopener noreferrer" className="underline">Open Stripe Checkout</a>}
        {state.platform_live_enabled && <button type="button" disabled={busy} onClick={() => void verifyExisting(a.id)} className="underline disabled:opacity-40">Verify payment</button>}</span>
      </div>)}
    </div> : null}
  </section>;
}
