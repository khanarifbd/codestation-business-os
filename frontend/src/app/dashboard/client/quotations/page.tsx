"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, FileText, Search } from "lucide-react";
import { useRouter } from "next/navigation";

import { ClientPortalError, ClientPortalLoading, ClientPortalPageHeader, ClientPortalStatusBadge, formatPortalDate, formatPortalMoney } from "@/components/client-portal-ui";
import type { ClientPortalQuotation } from "@/lib/client-portal-types";

export default function ClientQuotationsPage() {
  const router = useRouter();
  const [quotations, setQuotations] = useState<ClientPortalQuotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/client-portal/quotations", { cache: "no-store" });
        if (response.status === 401) { router.replace("/login"); return; }
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.detail ?? "Unable to load quotations");
        if (active) setQuotations(Array.isArray(payload) ? payload : []);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Unable to load quotations");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [router]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return quotations;
    return quotations.filter((quotation) => `${quotation.quotation_number} ${quotation.subject ?? ""} ${quotation.status} ${quotation.currency}`.toLowerCase().includes(term));
  }, [quotations, search]);

  if (loading) return <ClientPortalLoading />;
  if (error) return <ClientPortalError message={error} />;

  return <main className="min-h-screen bg-neutral-100 p-5 sm:p-8 lg:p-10"><div className="mx-auto max-w-[1300px]">
    <ClientPortalPageHeader title="Quotations" description="Review quotations that have been shared with your linked client account. Internal drafts are never shown here." />

    <div className="mt-7 grid gap-4 sm:grid-cols-3">
      <div className="rounded-2xl border bg-white p-5"><p className="text-xs font-medium uppercase tracking-[0.14em] text-neutral-400">Shared quotations</p><p className="mt-2 text-3xl font-semibold">{quotations.length}</p></div>
      <div className="rounded-2xl border bg-white p-5"><p className="text-xs font-medium uppercase tracking-[0.14em] text-neutral-400">Accepted</p><p className="mt-2 text-3xl font-semibold">{quotations.filter((quotation) => quotation.status === "accepted").length}</p></div>
      <div className="rounded-2xl border bg-white p-5"><p className="text-xs font-medium uppercase tracking-[0.14em] text-neutral-400">Awaiting decision</p><p className="mt-2 text-3xl font-semibold">{quotations.filter((quotation) => ["sent", "issued", "pending"].includes(quotation.status)).length}</p></div>
    </div>

    <div className="mt-5 rounded-2xl border bg-white p-4 sm:p-5">
      <label className="relative block max-w-md"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search quotations" className="h-10 w-full rounded-xl border border-neutral-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-neutral-400" /></label>
    </div>

    <div className="mt-5 space-y-4">
      {filtered.length ? filtered.map((quotation) => <Link key={quotation.id} href={`/dashboard/client/quotations/${quotation.id}`} className="block rounded-2xl border bg-white p-5 transition hover:border-neutral-300 hover:shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><FileText className="size-4 text-neutral-400" /><span className="text-xs font-medium text-neutral-400">{quotation.quotation_number}</span><ClientPortalStatusBadge status={quotation.status} /></div><h2 className="mt-2 text-lg font-semibold">{quotation.subject || "Quotation"}</h2></div>
          <ArrowRight className="size-5 shrink-0 text-neutral-300" />
        </div>
        <div className="mt-5 grid gap-4 border-t pt-4 sm:grid-cols-3">
          <div><p className="text-xs text-neutral-400">Issued</p><p className="mt-1 text-sm font-medium">{formatPortalDate(quotation.issue_date)}</p></div>
          <div><p className="text-xs text-neutral-400">Valid until</p><p className="mt-1 text-sm font-medium">{formatPortalDate(quotation.valid_until)}</p></div>
          <div><p className="text-xs text-neutral-400">Total</p><p className="mt-1 text-sm font-semibold">{formatPortalMoney(quotation.total, quotation.currency)}</p></div>
        </div>
      </Link>) : <div className="rounded-2xl border border-dashed bg-white px-5 py-14 text-center text-sm text-neutral-400">{quotations.length ? "No quotations match your search." : "No quotations have been shared with your client account yet."}</div>}
    </div>
  </div></main>;
}
