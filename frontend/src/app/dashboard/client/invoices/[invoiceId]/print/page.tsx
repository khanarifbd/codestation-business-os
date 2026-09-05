"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Printer } from "lucide-react";
import { useParams, useRouter } from "next/navigation";

import { ClientPortalError, ClientPortalLoading, formatPortalDate, formatPortalMoney } from "@/components/client-portal-ui";
import type { ClientPortalInvoiceDetail } from "@/lib/client-portal-types";

export default function ClientInvoicePrintPage() {
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

  return <main className="min-h-screen bg-neutral-100 p-4 print:bg-white print:p-0 sm:p-8"><div className="mx-auto max-w-[900px]">
    <div className="mb-4 flex items-center justify-between gap-3 print:hidden"><button type="button" onClick={() => router.push(`/dashboard/client/invoices/${invoice.id}`)} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2.5 text-sm font-medium"><ArrowLeft className="size-4" />Back</button><button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white"><Printer className="size-4" />Print / Save PDF</button></div>

    <article className="rounded-2xl border bg-white p-6 shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none sm:p-10">
      <header className="flex flex-col justify-between gap-6 border-b pb-7 sm:flex-row"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Invoice</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">{invoice.invoice_number}</h1>{invoice.subject ? <p className="mt-2 text-sm text-neutral-500">{invoice.subject}</p> : null}</div><div className="text-sm sm:text-right"><p className="font-semibold">{invoice.seller_name}</p>{invoice.seller_email ? <p className="mt-1 text-neutral-500">{invoice.seller_email}</p> : null}{invoice.seller_address ? <p className="mt-1 max-w-xs whitespace-pre-wrap text-neutral-500">{invoice.seller_address}</p> : null}</div></header>

      <section className="grid gap-6 border-b py-7 sm:grid-cols-2"><div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">Bill to</p><p className="mt-2 font-semibold">{invoice.client_name}</p>{invoice.client_contact ? <p className="mt-1 text-sm text-neutral-500">{invoice.client_contact}</p> : null}{invoice.client_email ? <p className="mt-1 text-sm text-neutral-500">{invoice.client_email}</p> : null}{invoice.client_address ? <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-500">{invoice.client_address}</p> : null}</div><dl className="grid grid-cols-2 gap-4 text-sm"><div><dt className="text-neutral-400">Issue date</dt><dd className="mt-1 font-medium">{formatPortalDate(invoice.issue_date)}</dd></div><div><dt className="text-neutral-400">Due date</dt><dd className="mt-1 font-medium">{formatPortalDate(invoice.due_date)}</dd></div><div><dt className="text-neutral-400">Currency</dt><dd className="mt-1 font-medium">{invoice.currency}</dd></div><div><dt className="text-neutral-400">Status</dt><dd className="mt-1 font-medium capitalize">{invoice.status.replaceAll("_", " ")}</dd></div></dl></section>

      <section className="py-7"><div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead className="border-b text-xs uppercase tracking-[0.08em] text-neutral-400"><tr><th className="pb-3 font-medium">Item</th><th className="pb-3 font-medium">Qty</th><th className="pb-3 font-medium">Unit price</th><th className="pb-3 font-medium">Tax</th><th className="pb-3 text-right font-medium">Total</th></tr></thead><tbody className="divide-y">{invoice.items.map((item) => <tr key={item.id}><td className="py-4 pr-5"><p className="font-medium">{item.item_name}</p>{item.description ? <p className="mt-1 max-w-md text-xs leading-5 text-neutral-500">{item.description}</p> : null}</td><td className="py-4 pr-5">{Number(item.quantity).toLocaleString()} {item.unit}</td><td className="py-4 pr-5">{formatPortalMoney(item.unit_price, invoice.currency)}</td><td className="py-4 pr-5">{Number(item.tax_rate).toLocaleString()}%</td><td className="py-4 text-right font-medium">{formatPortalMoney(item.line_total, invoice.currency)}</td></tr>)}</tbody></table></div>
        <div className="ml-auto mt-6 grid max-w-sm gap-2 text-sm"><div className="flex justify-between gap-5"><span className="text-neutral-500">Subtotal</span><span>{formatPortalMoney(invoice.subtotal, invoice.currency)}</span></div><div className="flex justify-between gap-5"><span className="text-neutral-500">Discount</span><span>{formatPortalMoney(invoice.discount_total, invoice.currency)}</span></div><div className="flex justify-between gap-5"><span className="text-neutral-500">Tax</span><span>{formatPortalMoney(invoice.tax_total, invoice.currency)}</span></div><div className="mt-1 flex justify-between gap-5 border-t pt-3 text-lg font-semibold"><span>Total</span><span>{formatPortalMoney(invoice.total, invoice.currency)}</span></div><div className="flex justify-between gap-5"><span className="text-neutral-500">Paid</span><span>{formatPortalMoney(invoice.amount_paid, invoice.currency)}</span></div><div className="flex justify-between gap-5 font-semibold"><span>Balance due</span><span>{formatPortalMoney(invoice.balance_due, invoice.currency)}</span></div></div>
      </section>

      {(invoice.payment_account_name || invoice.payment_instructions) ? <section className="border-t py-6"><h2 className="font-semibold">Payment information</h2><div className="mt-3 grid gap-2 text-sm text-neutral-600">{invoice.payment_account_name ? <p><span className="text-neutral-400">Account:</span> {invoice.payment_account_name}</p> : null}{invoice.payment_provider ? <p><span className="text-neutral-400">Provider:</span> {invoice.payment_provider}</p> : null}{invoice.payment_account_holder ? <p><span className="text-neutral-400">Account holder:</span> {invoice.payment_account_holder}</p> : null}{invoice.payment_account_reference ? <p><span className="text-neutral-400">Reference:</span> {invoice.payment_account_reference}</p> : null}{invoice.payment_instructions ? <p className="mt-2 whitespace-pre-wrap leading-6">{invoice.payment_instructions}</p> : null}</div></section> : null}
      {(invoice.notes || invoice.terms_conditions) ? <section className="grid gap-6 border-t pt-6 sm:grid-cols-2">{invoice.notes ? <div><h2 className="font-semibold">Notes</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-600">{invoice.notes}</p></div> : null}{invoice.terms_conditions ? <div><h2 className="font-semibold">Terms & conditions</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-600">{invoice.terms_conditions}</p></div> : null}</section> : null}
    </article>
  </div></main>;
}
