"use client";

import { useEffect, useState } from "react";
import { CreditCard, ExternalLink, ReceiptText } from "lucide-react";
import { useParams, useRouter } from "next/navigation";

import { ClientPortalError, ClientPortalLoading, ClientPortalPageHeader, ClientPortalStatusBadge, formatPortalDate, formatPortalMoney, portalStatusLabel } from "@/components/client-portal-ui";
import type { ClientPortalInvoiceDetail } from "@/lib/client-portal-types";

export default function ClientInvoiceDetailPage() {
  const params = useParams<{ invoiceId: string }>();
  const router = useRouter();
  const [invoice, setInvoice] = useState<ClientPortalInvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/client-portal/invoices/${encodeURIComponent(params.invoiceId)}`, { cache: "no-store" });
        if (response.status === 401) { router.replace("/login"); return; }
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.detail ?? "Unable to load invoice");
        if (active) setInvoice(payload as ClientPortalInvoiceDetail);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Unable to load invoice");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [params.invoiceId, router]);

  if (loading) return <ClientPortalLoading />;
  if (!invoice) return <ClientPortalError message={error ?? "Invoice not found"} />;

  return <main className="min-h-screen bg-neutral-100 p-5 sm:p-8 lg:p-10"><div className="mx-auto max-w-[1150px]">
    <ClientPortalPageHeader title={invoice.subject || invoice.invoice_number} description="Issued invoice details, payment instructions and confirmed payment history." backHref="/dashboard/client/invoices" />
    <div className="mt-5 flex flex-wrap items-center gap-2"><span className="text-sm font-medium text-neutral-400">{invoice.invoice_number}</span><ClientPortalStatusBadge status={invoice.status} /></div>

    <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-2xl border bg-white p-5"><p className="text-xs font-medium uppercase tracking-[0.12em] text-neutral-400">Invoice total</p><p className="mt-2 text-xl font-semibold">{formatPortalMoney(invoice.total, invoice.currency)}</p></div>
      <div className="rounded-2xl border bg-white p-5"><p className="text-xs font-medium uppercase tracking-[0.12em] text-neutral-400">Paid</p><p className="mt-2 text-xl font-semibold">{formatPortalMoney(invoice.amount_paid, invoice.currency)}</p></div>
      <div className="rounded-2xl border bg-white p-5"><p className="text-xs font-medium uppercase tracking-[0.12em] text-neutral-400">Balance due</p><p className="mt-2 text-xl font-semibold">{formatPortalMoney(invoice.balance_due, invoice.currency)}</p></div>
      <div className="rounded-2xl border bg-white p-5"><p className="text-xs font-medium uppercase tracking-[0.12em] text-neutral-400">Due date</p><p className="mt-2 text-xl font-semibold">{formatPortalDate(invoice.due_date)}</p></div>
    </div>

    <section className="mt-5 rounded-2xl border bg-white p-5 sm:p-6">
      <div className="flex items-center gap-2"><ReceiptText className="size-4 text-neutral-400" /><h2 className="font-semibold">Invoice details</h2></div>
      <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div><p className="text-xs text-neutral-400">Issued</p><p className="mt-1 text-sm font-medium">{formatPortalDate(invoice.issue_date)}</p></div>
        <div><p className="text-xs text-neutral-400">Status</p><p className="mt-1 text-sm font-medium">{portalStatusLabel(invoice.status)}</p></div>
        <div><p className="text-xs text-neutral-400">From</p><p className="mt-1 text-sm font-medium">{invoice.seller_name}</p>{invoice.seller_email ? <p className="mt-1 text-xs text-neutral-500">{invoice.seller_email}</p> : null}</div>
        <div><p className="text-xs text-neutral-400">Billed to</p><p className="mt-1 text-sm font-medium">{invoice.client_name}</p>{invoice.client_email ? <p className="mt-1 text-xs text-neutral-500">{invoice.client_email}</p> : null}</div>
      </div>
    </section>

    <section className="mt-5 overflow-hidden rounded-2xl border bg-white">
      <div className="border-b px-5 py-4 sm:px-6"><h2 className="font-semibold">Items</h2></div>
      <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-neutral-50 text-xs uppercase tracking-[0.08em] text-neutral-400"><tr><th className="px-5 py-3 font-medium">Item</th><th className="px-4 py-3 font-medium">Qty</th><th className="px-4 py-3 font-medium">Unit price</th><th className="px-4 py-3 font-medium">Tax</th><th className="px-5 py-3 text-right font-medium">Total</th></tr></thead><tbody className="divide-y">{invoice.items.map((item) => <tr key={item.id}><td className="px-5 py-4"><p className="font-medium">{item.item_name}</p>{item.description ? <p className="mt-1 max-w-xl text-xs leading-5 text-neutral-500">{item.description}</p> : null}</td><td className="px-4 py-4 text-neutral-600">{Number(item.quantity).toLocaleString()} {item.unit}</td><td className="px-4 py-4 text-neutral-600">{formatPortalMoney(item.unit_price, invoice.currency)}</td><td className="px-4 py-4 text-neutral-600">{Number(item.tax_rate).toLocaleString()}%</td><td className="px-5 py-4 text-right font-semibold">{formatPortalMoney(item.line_total, invoice.currency)}</td></tr>)}</tbody></table></div>
      <div className="ml-auto grid max-w-md gap-2 border-t px-5 py-5 text-sm sm:px-6"><div className="flex justify-between gap-4"><span className="text-neutral-500">Subtotal</span><span className="font-medium">{formatPortalMoney(invoice.subtotal, invoice.currency)}</span></div><div className="flex justify-between gap-4"><span className="text-neutral-500">Discount</span><span className="font-medium">{formatPortalMoney(invoice.discount_total, invoice.currency)}</span></div><div className="flex justify-between gap-4"><span className="text-neutral-500">Tax</span><span className="font-medium">{formatPortalMoney(invoice.tax_total, invoice.currency)}</span></div><div className="flex justify-between gap-4 border-t pt-2 text-base"><span className="font-semibold">Total</span><span className="font-semibold">{formatPortalMoney(invoice.total, invoice.currency)}</span></div></div>
    </section>

    {(invoice.payment_method || invoice.payment_account_name || invoice.payment_instructions || invoice.payment_url) ? <section className="mt-5 rounded-2xl border bg-white p-5 sm:p-6"><div className="flex items-center gap-2"><CreditCard className="size-4 text-neutral-400" /><h2 className="font-semibold">Payment information</h2></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><div><p className="text-xs text-neutral-400">Method</p><p className="mt-1 text-sm font-medium">{invoice.payment_method ? portalStatusLabel(invoice.payment_method) : "—"}</p></div><div><p className="text-xs text-neutral-400">Account</p><p className="mt-1 text-sm font-medium">{invoice.payment_account_name || "—"}</p>{invoice.payment_provider ? <p className="mt-1 text-xs text-neutral-500">{invoice.payment_provider}</p> : null}</div>{invoice.payment_account_holder ? <div><p className="text-xs text-neutral-400">Account holder</p><p className="mt-1 text-sm font-medium">{invoice.payment_account_holder}</p></div> : null}{invoice.payment_account_reference ? <div><p className="text-xs text-neutral-400">Reference</p><p className="mt-1 text-sm font-medium">{invoice.payment_account_reference}</p></div> : null}</div>{invoice.payment_instructions ? <p className="mt-5 whitespace-pre-wrap rounded-xl bg-neutral-50 p-4 text-sm leading-6 text-neutral-600">{invoice.payment_instructions}</p> : null}{invoice.payment_url ? <a href={invoice.payment_url} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white">Open payment link<ExternalLink className="size-4" /></a> : null}</section> : null}

    <section className="mt-5 rounded-2xl border bg-white p-5 sm:p-6"><h2 className="font-semibold">Payment history</h2>{invoice.payments.length ? <div className="mt-4 divide-y rounded-xl border">{invoice.payments.map((payment) => <div key={payment.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium">{formatPortalDate(payment.payment_date)}</p><p className="mt-1 text-xs text-neutral-500">{portalStatusLabel(payment.method)}{payment.reference ? ` · ${payment.reference}` : ""}</p></div><p className="text-sm font-semibold">{formatPortalMoney(payment.invoice_amount, payment.invoice_currency)}</p></div>)}</div> : <p className="mt-4 text-sm text-neutral-400">No confirmed payments are recorded for this invoice yet.</p>}</section>

    {(invoice.notes || invoice.terms_conditions) ? <section className="mt-5 grid gap-5 sm:grid-cols-2">{invoice.notes ? <div className="rounded-2xl border bg-white p-5"><h2 className="font-semibold">Notes</h2><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-neutral-600">{invoice.notes}</p></div> : null}{invoice.terms_conditions ? <div className="rounded-2xl border bg-white p-5"><h2 className="font-semibold">Terms & conditions</h2><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-neutral-600">{invoice.terms_conditions}</p></div> : null}</section> : null}
  </div></main>;
}
