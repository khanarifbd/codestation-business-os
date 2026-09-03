"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ReceiptText, Search } from "lucide-react";
import { useRouter } from "next/navigation";

import { ClientPortalError, ClientPortalLoading, ClientPortalPageHeader, ClientPortalStatusBadge, formatPortalDate, formatPortalMoney } from "@/components/client-portal-ui";
import type { ClientPortalInvoice } from "@/lib/client-portal-types";

export default function ClientInvoicesPage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<ClientPortalInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/client-portal/invoices", { cache: "no-store" });
        if (response.status === 401) { router.replace("/login"); return; }
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.detail ?? "Unable to load invoices");
        if (active) setInvoices(Array.isArray(payload) ? payload : []);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Unable to load invoices");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [router]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return invoices;
    return invoices.filter((invoice) => `${invoice.invoice_number} ${invoice.subject ?? ""} ${invoice.status} ${invoice.currency}`.toLowerCase().includes(term));
  }, [invoices, search]);

  if (loading) return <ClientPortalLoading />;
  if (error) return <ClientPortalError message={error} />;

  const unpaid = invoices.filter((invoice) => Number(invoice.balance_due || 0) > 0).length;
  const paid = invoices.filter((invoice) => Number(invoice.balance_due || 0) <= 0).length;

  return <main className="min-h-screen bg-neutral-100 p-5 sm:p-8 lg:p-10"><div className="mx-auto max-w-[1300px]">
    <ClientPortalPageHeader title="Invoices" description="View issued invoices, outstanding balances and confirmed payment history for your linked client account." />

    <div className="mt-7 grid gap-4 sm:grid-cols-3">
      <div className="rounded-2xl border bg-white p-5"><p className="text-xs font-medium uppercase tracking-[0.14em] text-neutral-400">Issued invoices</p><p className="mt-2 text-3xl font-semibold">{invoices.length}</p></div>
      <div className="rounded-2xl border bg-white p-5"><p className="text-xs font-medium uppercase tracking-[0.14em] text-neutral-400">Outstanding</p><p className="mt-2 text-3xl font-semibold">{unpaid}</p></div>
      <div className="rounded-2xl border bg-white p-5"><p className="text-xs font-medium uppercase tracking-[0.14em] text-neutral-400">Settled</p><p className="mt-2 text-3xl font-semibold">{paid}</p></div>
    </div>

    <div className="mt-5 rounded-2xl border bg-white p-4 sm:p-5">
      <label className="relative block max-w-md"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search invoices" className="h-10 w-full rounded-xl border border-neutral-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-neutral-400" /></label>
    </div>

    <div className="mt-5 space-y-4">
      {filtered.length ? filtered.map((invoice) => <Link key={invoice.id} href={`/dashboard/client/invoices/${invoice.id}`} className="block rounded-2xl border bg-white p-5 transition hover:border-neutral-300 hover:shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><ReceiptText className="size-4 text-neutral-400" /><span className="text-xs font-medium text-neutral-400">{invoice.invoice_number}</span><ClientPortalStatusBadge status={invoice.status} /></div><h2 className="mt-2 text-lg font-semibold">{invoice.subject || "Invoice"}</h2></div>
          <ArrowRight className="size-5 shrink-0 text-neutral-300" />
        </div>
        <div className="mt-5 grid gap-4 border-t pt-4 sm:grid-cols-5">
          <div><p className="text-xs text-neutral-400">Issued</p><p className="mt-1 text-sm font-medium">{formatPortalDate(invoice.issue_date)}</p></div>
          <div><p className="text-xs text-neutral-400">Due</p><p className="mt-1 text-sm font-medium">{formatPortalDate(invoice.due_date)}</p></div>
          <div><p className="text-xs text-neutral-400">Total</p><p className="mt-1 text-sm font-semibold">{formatPortalMoney(invoice.total, invoice.currency)}</p></div>
          <div><p className="text-xs text-neutral-400">Paid</p><p className="mt-1 text-sm font-semibold">{formatPortalMoney(invoice.amount_paid, invoice.currency)}</p></div>
          <div><p className="text-xs text-neutral-400">Balance due</p><p className="mt-1 text-sm font-semibold">{formatPortalMoney(invoice.balance_due, invoice.currency)}</p></div>
        </div>
      </Link>) : <div className="rounded-2xl border border-dashed bg-white px-5 py-14 text-center text-sm text-neutral-400">{invoices.length ? "No invoices match your search." : "No issued invoices are linked to your client account yet."}</div>}
    </div>
  </div></main>;
}
