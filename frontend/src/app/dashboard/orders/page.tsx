"use client";

import Link from "next/link";
import { CheckCircle2, ClipboardCheck, Loader2, PlayCircle, Search, XCircle } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Summary = { total: number; confirmed: number; in_progress: number; completed: number; cancelled: number };
type OrderRow = {
  id: string;
  order_number: string;
  quotation_id: string | null;
  quotation_number: string | null;
  client_id: string;
  client_name: string;
  status: string;
  subject: string | null;
  order_date: string;
  currency: string;
  total: string | number;
  assigned_employee_id: string | null;
  assigned_employee_name: string | null;
  created_at: string;
  updated_at: string;
};
type QuotationMini = { id: string; quotation_number: string; status: string; client_name_snapshot: string; total: string | number; currency: string };
type OrderLink = { order_id: string; order_number: string; status: string };
type OrderPage = { items: OrderRow[]; next_cursor: string | null };

function money(value: string | number, currency: string) {
  return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function OrdersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const quotationId = searchParams.get("quotation_id");
  const requestedOrderId = searchParams.get("order_id");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [quotation, setQuotation] = useState<QuotationMini | null>(null);
  const [quotationOrderLink, setQuotationOrderLink] = useState<OrderLink | null>(null);
  const skipFirstFilterRefresh = useRef(true);

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const response = await fetch(`/api/sales${path}`, init);
    if (response.status === 401) {
      router.replace("/login");
      throw new Error("Authentication required");
    }
    if (response.status === 403) throw new Error("Your company role does not have permission for orders.");
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.detail ?? "Order request failed.");
    return payload;
  }, [router]);

  const query = useMemo(() => {
    const params = new URLSearchParams({ limit: "30" });
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    return params.toString();
  }, [search, statusFilter]);

  const refreshSummary = useCallback(async () => {
    setSummary(await api("/orders/summary") as Summary);
  }, [api]);

  const refreshList = useCallback(async (showLoader = false) => {
    if (showLoader) setListLoading(true);
    try {
      const payload = await api(`/orders?${query}`) as OrderPage;
      setRows(payload.items);
      setNextCursor(payload.next_cursor);
    } finally {
      if (showLoader) setListLoading(false);
    }
  }, [api, query]);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryPayload, listPayload] = await Promise.all([
        api("/orders/summary"),
        api(`/orders?${query}`),
      ]);
      setSummary(summaryPayload as Summary);
      const typed = listPayload as OrderPage;
      setRows(typed.items);
      setNextCursor(typed.next_cursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load orders.");
    } finally {
      setLoading(false);
    }
  }, [api, query]);

  useEffect(() => { void bootstrap(); }, [bootstrap]);

  useEffect(() => {
    if (skipFirstFilterRefresh.current) {
      skipFirstFilterRefresh.current = false;
      return;
    }
    void refreshList(true).catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to filter orders."));
  }, [query, refreshList]);

  useEffect(() => {
    if (!quotationId) {
      setQuotation(null);
      setQuotationOrderLink(null);
      return;
    }
    let active = true;
    void Promise.all([
      api(`/quotations/${encodeURIComponent(quotationId)}`),
      api(`/quotations/${encodeURIComponent(quotationId)}/order-link`),
    ]).then(([quotationPayload, linkPayload]) => {
      if (!active) return;
      setQuotation(quotationPayload as QuotationMini);
      setQuotationOrderLink(linkPayload as OrderLink | null);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "Unable to load accepted quotation.");
    });
    return () => { active = false; };
  }, [api, quotationId]);

  useEffect(() => {
    if (requestedOrderId) router.replace(`/dashboard/orders/${encodeURIComponent(requestedOrderId)}`);
  }, [requestedOrderId, router]);

  async function convertQuotation() {
    if (!quotationId || !quotation) return;
    if (quotation.status !== "accepted") {
      setError("Only accepted quotations can become orders.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await api(`/orders/from-quotation/${encodeURIComponent(quotationId)}`, { method: "POST" }) as OrderRow;
      setMessage(`Order ${created.order_number} created from ${quotation.quotation_number}`);
      setQuotationOrderLink({ order_id: created.id, order_number: created.order_number, status: created.status });
      await refreshSummary();
      router.push(`/dashboard/orders/${encodeURIComponent(created.id)}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create order.");
    } finally {
      setSaving(false);
    }
  }

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    setError(null);
    try {
      const params = new URLSearchParams(query);
      params.set("cursor", nextCursor);
      const payload = await api(`/orders?${params}`) as OrderPage;
      setRows((current) => [...current, ...payload.items]);
      setNextCursor(payload.next_cursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load more orders.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-100 p-4 sm:p-8 lg:p-10">
      <div className="mx-auto max-w-[1500px]">
        <header className="pr-32 sm:pr-40"><p className="text-sm font-medium text-neutral-500">Sales execution</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Orders</h1><p className="mt-2 text-sm text-neutral-500">Accepted quotations become immutable commercial orders and move through delivery execution.</p></header>

        {quotation ? <section className="mt-6 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-blue-950"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-wide text-blue-500">Quotation handoff</p><h2 className="mt-1 font-semibold">{quotation.quotation_number} · {quotation.client_name_snapshot}</h2><p className="mt-1 text-sm text-blue-700">{money(quotation.total, quotation.currency)} · Status: {quotation.status}</p></div>{quotationOrderLink ? <Link href={`/dashboard/orders/${encodeURIComponent(quotationOrderLink.order_id)}`} className="inline-flex h-11 items-center justify-center rounded-xl bg-white px-4 text-sm font-semibold shadow-sm">Open {quotationOrderLink.order_number}</Link> : <button disabled={saving || quotation.status !== "accepted"} onClick={() => void convertQuotation()} className="h-11 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Creating..." : "Create Order"}</button>}</div></section> : null}

        <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-5">
          <Stat label="Total" value={summary?.total ?? 0} icon={ClipboardCheck} />
          <Stat label="Confirmed" value={summary?.confirmed ?? 0} icon={ClipboardCheck} />
          <Stat label="In progress" value={summary?.in_progress ?? 0} icon={PlayCircle} />
          <Stat label="Completed" value={summary?.completed ?? 0} icon={CheckCircle2} />
          <Stat label="Cancelled" value={summary?.cancelled ?? 0} icon={XCircle} />
        </div>

        {message ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
        {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

        <section className="mt-5 overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="grid gap-3 border-b p-4 sm:grid-cols-[minmax(260px,1fr)_220px_auto] sm:p-5">
            <form onSubmit={(event) => { event.preventDefault(); setSearch(searchDraft.trim()); }} className="relative"><Search className="absolute left-3 top-3.5 size-4 text-neutral-400" /><input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search order, quotation, client..." className="h-11 w-full rounded-xl border pl-9 pr-3 text-sm outline-none focus:border-neutral-500" /></form>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-11 rounded-xl border bg-white px-3 text-sm"><option value="">All statuses</option><option value="confirmed">Confirmed</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select>
            <button onClick={() => { setSearchDraft(""); setSearch(""); setStatusFilter(""); }} className="h-11 rounded-xl border px-4 text-sm font-semibold">Reset</button>
          </div>

          {loading || listLoading ? <div className="flex min-h-64 items-center justify-center"><Loader2 className="size-6 animate-spin text-neutral-400" /></div> : rows.length === 0 ? <div className="px-6 py-20 text-center"><ClipboardCheck className="mx-auto size-8 text-neutral-300" /><h2 className="mt-4 font-semibold">No orders found</h2><p className="mt-1 text-sm text-neutral-500">Accept a quotation, then convert it into an order.</p></div> : <>
            <div className="space-y-3 p-4 md:hidden">{rows.map((item) => <Link key={item.id} href={`/dashboard/orders/${encodeURIComponent(item.id)}`} className="block rounded-2xl border p-4 transition hover:bg-neutral-50"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold">{item.order_number}</p><p className="mt-1 break-words text-xs text-neutral-500">{item.subject || item.client_name}</p></div><StatusBadge status={item.status} /></div><div className="mt-4 grid grid-cols-2 gap-3 text-xs"><Mini label="Client" value={item.client_name} /><Mini label="Date" value={item.order_date} /><Mini label="Quotation" value={item.quotation_number || "Manual"} /><Mini label="Total" value={money(item.total, item.currency)} /></div></Link>)}</div>
            <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-400"><tr><th className="px-6 py-3 font-medium">Order</th><th className="px-4 py-3 font-medium">Client</th><th className="px-4 py-3 font-medium">Quotation</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Date</th><th className="px-4 py-3 font-medium">Total</th><th className="px-6 py-3 text-right font-medium">Action</th></tr></thead><tbody className="divide-y">{rows.map((item) => <tr key={item.id} className="hover:bg-neutral-50/70"><td className="px-6 py-4"><p className="font-medium">{item.order_number}</p><p className="mt-1 text-xs text-neutral-400">{item.subject || "Commercial order"}</p></td><td className="px-4 py-4">{item.client_name}</td><td className="px-4 py-4">{item.quotation_number || "Manual"}</td><td className="px-4 py-4"><StatusBadge status={item.status} /></td><td className="px-4 py-4 text-neutral-600">{item.order_date}</td><td className="px-4 py-4 font-medium">{money(item.total, item.currency)}</td><td className="px-6 py-4 text-right"><Link href={`/dashboard/orders/${encodeURIComponent(item.id)}`} className="inline-flex rounded-lg border px-3 py-2 text-xs font-semibold">Open</Link></td></tr>)}</tbody></table></div>
            {nextCursor ? <div className="border-t p-4 text-center"><button disabled={loadingMore} onClick={() => void loadMore()} className="rounded-xl border px-5 py-2.5 text-sm font-semibold disabled:opacity-50">{loadingMore ? "Loading..." : "Load more"}</button></div> : null}
          </>}
        </section>
      </div>
    </main>
  );
}

function StatusBadge({ status }: { status: string }) { const styles: Record<string, string> = { confirmed: "border-blue-200 bg-blue-50 text-blue-700", in_progress: "border-amber-200 bg-amber-50 text-amber-700", completed: "border-emerald-200 bg-emerald-50 text-emerald-700", cancelled: "border-neutral-200 bg-neutral-100 text-neutral-500" }; return <span className={`inline-flex shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${styles[status] ?? "bg-neutral-50"}`}>{status.replace("_", " ")}</span>; }
function Stat({ label, value, icon: Icon }: { label: string; value: string | number; icon: typeof ClipboardCheck }) { return <article className="rounded-2xl border bg-white p-4 shadow-sm sm:p-5"><div className="flex items-center justify-between"><p className="text-xs text-neutral-500 sm:text-sm">{label}</p><Icon className="size-4 text-neutral-400" /></div><p className="mt-3 text-xl font-semibold sm:mt-4 sm:text-2xl">{value}</p></article>; }
function Mini({ label, value }: { label: string; value: string }) { return <div className="min-w-0"><p className="text-neutral-400">{label}</p><p className="mt-1 break-words font-medium text-neutral-700">{value}</p></div>; }
