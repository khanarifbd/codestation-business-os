"use client";

import { useEffect, useState } from "react";
import { Check, FileText, Loader2, X } from "lucide-react";
import { useParams, useRouter } from "next/navigation";

import { ClientPortalError, ClientPortalLoading, ClientPortalPageHeader, ClientPortalStatusBadge, formatPortalDate, formatPortalMoney, portalStatusLabel } from "@/components/client-portal-ui";
import type { ClientPortalQuotationDetail } from "@/lib/client-portal-types";

export default function ClientQuotationDetailPage() {
  const params = useParams<{ quotationId: string }>();
  const router = useRouter();
  const [quotation, setQuotation] = useState<ClientPortalQuotationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/client-portal/quotations/${encodeURIComponent(params.quotationId)}`, { cache: "no-store" });
        if (response.status === 401) { router.replace("/login"); return; }
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.detail ?? "Unable to load quotation");
        if (active) setQuotation(payload as ClientPortalQuotationDetail);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Unable to load quotation");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [params.quotationId, router]);

  async function decide(status: "accepted" | "rejected") {
    if (!quotation || saving) return;
    if (status === "accepted" && !window.confirm(`Accept quotation ${quotation.quotation_number}? This action cannot be undone.`)) return;
    if (status === "rejected" && !window.confirm(`Reject quotation ${quotation.quotation_number}? This action cannot be undone.`)) return;
    setSaving(true); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/client-portal/quotations/${encodeURIComponent(quotation.id)}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (response.status === 401) { router.replace("/login"); return; }
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to update quotation");
      setQuotation(payload as ClientPortalQuotationDetail);
      setMessage(status === "accepted" ? "Quotation accepted successfully." : "Quotation rejected successfully.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update quotation");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <ClientPortalLoading />;
  if (!quotation) return <ClientPortalError message={error ?? "Quotation not found"} />;

  return <main className="min-h-screen bg-neutral-100 p-5 sm:p-8 lg:p-10"><div className="mx-auto max-w-[1150px]">
    <ClientPortalPageHeader title={quotation.subject || quotation.quotation_number} description="Quotation details that have been shared with your client account." backHref="/dashboard/client/quotations" />
    <div className="mt-5 flex flex-wrap items-center gap-2"><span className="text-sm font-medium text-neutral-400">{quotation.quotation_number}</span><ClientPortalStatusBadge status={quotation.status} /></div>
    {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    {message ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}

    {quotation.status === "sent" ? <section className="mt-5 rounded-2xl border bg-white p-5 sm:p-6"><h2 className="font-semibold">Your decision</h2><p className="mt-1 text-sm text-neutral-500">Review the quotation below, then accept it or reject it. Your decision is recorded in the business audit trail.</p><div className="mt-4 flex flex-wrap gap-3"><button type="button" disabled={saving} onClick={() => void decide("accepted")} className="inline-flex items-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}Accept quotation</button><button type="button" disabled={saving} onClick={() => void decide("rejected")} className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 disabled:opacity-50"><X className="size-4" />Reject quotation</button></div></section> : null}

    <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-2xl border bg-white p-5"><p className="text-xs font-medium uppercase tracking-[0.12em] text-neutral-400">Total</p><p className="mt-2 text-xl font-semibold">{formatPortalMoney(quotation.total, quotation.currency)}</p></div>
      <div className="rounded-2xl border bg-white p-5"><p className="text-xs font-medium uppercase tracking-[0.12em] text-neutral-400">Issued</p><p className="mt-2 text-xl font-semibold">{formatPortalDate(quotation.issue_date)}</p></div>
      <div className="rounded-2xl border bg-white p-5"><p className="text-xs font-medium uppercase tracking-[0.12em] text-neutral-400">Valid until</p><p className="mt-2 text-xl font-semibold">{formatPortalDate(quotation.valid_until)}</p></div>
      <div className="rounded-2xl border bg-white p-5"><p className="text-xs font-medium uppercase tracking-[0.12em] text-neutral-400">Status</p><p className="mt-2 text-xl font-semibold">{portalStatusLabel(quotation.status)}</p></div>
    </div>

    <section className="mt-5 rounded-2xl border bg-white p-5 sm:p-6">
      <div className="flex items-center gap-2"><FileText className="size-4 text-neutral-400" /><h2 className="font-semibold">Quotation details</h2></div>
      <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div><p className="text-xs text-neutral-400">From</p><p className="mt-1 text-sm font-medium">{quotation.seller_name}</p>{quotation.seller_email ? <p className="mt-1 text-xs text-neutral-500">{quotation.seller_email}</p> : null}</div>
        <div><p className="text-xs text-neutral-400">Prepared for</p><p className="mt-1 text-sm font-medium">{quotation.client_name}</p>{quotation.client_email ? <p className="mt-1 text-xs text-neutral-500">{quotation.client_email}</p> : null}</div>
        <div><p className="text-xs text-neutral-400">Accepted</p><p className="mt-1 text-sm font-medium">{formatPortalDate(quotation.accepted_at)}</p></div>
        <div><p className="text-xs text-neutral-400">Rejected</p><p className="mt-1 text-sm font-medium">{formatPortalDate(quotation.rejected_at)}</p></div>
      </div>
    </section>

    <section className="mt-5 overflow-hidden rounded-2xl border bg-white">
      <div className="border-b px-5 py-4 sm:px-6"><h2 className="font-semibold">Items</h2></div>
      <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-neutral-50 text-xs uppercase tracking-[0.08em] text-neutral-400"><tr><th className="px-5 py-3 font-medium">Item</th><th className="px-4 py-3 font-medium">Qty</th><th className="px-4 py-3 font-medium">Unit price</th><th className="px-4 py-3 font-medium">Tax</th><th className="px-5 py-3 text-right font-medium">Total</th></tr></thead><tbody className="divide-y">{quotation.items.map((item) => <tr key={item.id}><td className="px-5 py-4"><p className="font-medium">{item.item_name}</p>{item.description ? <p className="mt-1 max-w-xl text-xs leading-5 text-neutral-500">{item.description}</p> : null}</td><td className="px-4 py-4 text-neutral-600">{Number(item.quantity).toLocaleString()} {item.unit}</td><td className="px-4 py-4 text-neutral-600">{formatPortalMoney(item.unit_price, quotation.currency)}</td><td className="px-4 py-4 text-neutral-600">{Number(item.tax_rate).toLocaleString()}%</td><td className="px-5 py-4 text-right font-semibold">{formatPortalMoney(item.line_total, quotation.currency)}</td></tr>)}</tbody></table></div>
      <div className="ml-auto grid max-w-md gap-2 border-t px-5 py-5 text-sm sm:px-6"><div className="flex justify-between gap-4"><span className="text-neutral-500">Subtotal</span><span className="font-medium">{formatPortalMoney(quotation.subtotal, quotation.currency)}</span></div><div className="flex justify-between gap-4"><span className="text-neutral-500">Discount</span><span className="font-medium">{formatPortalMoney(quotation.discount_total, quotation.currency)}</span></div><div className="flex justify-between gap-4"><span className="text-neutral-500">Tax</span><span className="font-medium">{formatPortalMoney(quotation.tax_total, quotation.currency)}</span></div><div className="flex justify-between gap-4 border-t pt-2 text-base"><span className="font-semibold">Total</span><span className="font-semibold">{formatPortalMoney(quotation.total, quotation.currency)}</span></div></div>
    </section>

    {(quotation.notes || quotation.terms_conditions) ? <section className="mt-5 grid gap-5 sm:grid-cols-2">{quotation.notes ? <div className="rounded-2xl border bg-white p-5"><h2 className="font-semibold">Notes</h2><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-neutral-600">{quotation.notes}</p></div> : null}{quotation.terms_conditions ? <div className="rounded-2xl border bg-white p-5"><h2 className="font-semibold">Terms & conditions</h2><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-neutral-600">{quotation.terms_conditions}</p></div> : null}</section> : null}
  </div></main>;
}
