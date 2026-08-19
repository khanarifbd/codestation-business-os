"use client";

import { CheckCircle2, ClipboardCheck, FolderKanban, Loader2, PlayCircle, Search, X, XCircle } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { OrderFulfillmentPanel, type FulfillmentOrderItem } from "@/components/order-fulfillment-panel";

type Summary = { total: number; confirmed: number; in_progress: number; completed: number; cancelled: number };
type OrderRow = {
  id: string;
  order_number: string;
  quotation_id: string;
  quotation_number: string;
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
type OrderItem = FulfillmentOrderItem & {
  quotation_item_id: string | null;
  sort_order: number;
  description: string;
  unit_price: string | number;
  discount_percent: string | number;
  tax_rate: string | number;
  line_total: string | number;
};
type OrderDetail = OrderRow & {
  source_lead_id: string | null;
  tax_calculation_mode: string;
  seller_name_snapshot: string;
  seller_email_snapshot: string | null;
  seller_address_snapshot: string | null;
  seller_tax_identifier_snapshot: string | null;
  client_name_snapshot: string;
  client_contact_snapshot: string | null;
  client_email_snapshot: string | null;
  client_address_snapshot: string | null;
  client_tax_identifier_snapshot: string | null;
  subtotal: string | number;
  discount_total: string | number;
  tax_total: string | number;
  notes: string | null;
  terms_conditions: string | null;
  internal_notes: string | null;
  confirmed_at: string;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  items: OrderItem[];
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
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
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
    if (!requestedOrderId) return;
    void openDetail(requestedOrderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedOrderId]);

  function matchesCurrentFilters(item: OrderRow) {
    if (statusFilter && item.status !== statusFilter) return false;
    if (!search) return true;
    const needle = search.toLowerCase();
    return `${item.order_number} ${item.quotation_number} ${item.client_name} ${item.subject ?? ""}`.toLowerCase().includes(needle);
  }

  async function openDetail(id: string) {
    setDetailLoading(true);
    setError(null);
    try { setDetail(await api(`/orders/${id}`) as OrderDetail); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load order."); }
    finally { setDetailLoading(false); }
  }

  async function convertQuotation() {
    if (!quotationId || !quotation) return;
    if (quotation.status !== "accepted") {
      setError("Only accepted quotations can become orders.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await api(`/orders/from-quotation/${encodeURIComponent(quotationId)}`, { method: "POST" }) as OrderDetail;
      setMessage(`Order ${created.order_number} created from ${created.quotation_number}`);
      setQuotationOrderLink({ order_id: created.id, order_number: created.order_number, status: created.status });
      setDetail(created);
      if (matchesCurrentFilters(created)) setRows((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      await refreshSummary();
      router.replace(`/dashboard/orders?order_id=${encodeURIComponent(created.id)}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create order.");
    } finally { setSaving(false); }
  }

  async function changeStatus(next: "in_progress" | "completed" | "cancelled", cancellationReason?: string): Promise<boolean> {
    if (!detail) return false;
    setSaving(true);
    setError(null);
    try {
      const updated = await api(`/orders/${detail.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next, ...(next === "cancelled" ? { reason: cancellationReason } : {}) }),
      }) as OrderDetail;
      setDetail(updated);
      setMessage(`Order ${updated.order_number} marked ${updated.status.replace("_", " ")}`);
      setRows((current) => {
        const without = current.filter((item) => item.id !== updated.id);
        return matchesCurrentFilters(updated) ? [updated, ...without] : without;
      });
      await refreshSummary();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update order status.");
      return false;
    } finally { setSaving(false); }
  }

  async function refreshAfterFulfillment(fulfillmentNumber: string) {
    if (!detail) return;
    setError(null);
    const updated = await api(`/orders/${detail.id}`) as OrderDetail;
    setDetail(updated);
    setMessage(`${fulfillmentNumber} posted for ${updated.order_number}. Inventory and COGS are updated.`);
    await Promise.all([refreshSummary(), refreshList()]);
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
    } finally { setLoadingMore(false); }
  }

  return (
    <main className="min-h-screen bg-neutral-100 p-5 sm:p-8 lg:p-10">
      <div className="mx-auto max-w-[1500px]">
        <header><p className="text-sm font-medium text-neutral-500">Sales execution</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Orders</h1><p className="mt-2 text-sm text-neutral-500">Accepted quotations become immutable commercial orders and move through delivery execution.</p></header>

        {quotation ? <section className="mt-6 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-blue-950"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-wide text-blue-500">Quotation handoff</p><h2 className="mt-1 font-semibold">{quotation.quotation_number} · {quotation.client_name_snapshot}</h2><p className="mt-1 text-sm text-blue-700">{money(quotation.total, quotation.currency)} · Status: {quotation.status}</p></div>{quotationOrderLink ? <button onClick={() => void openDetail(quotationOrderLink.order_id)} className="h-11 rounded-xl bg-white px-4 text-sm font-semibold shadow-sm">Open {quotationOrderLink.order_number}</button> : <button disabled={saving || quotation.status !== "accepted"} onClick={() => void convertQuotation()} className="h-11 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Creating..." : "Create Order"}</button>}</div></section> : null}

        <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
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
            <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-400"><tr><th className="px-6 py-3 font-medium">Order</th><th className="px-4 py-3 font-medium">Client</th><th className="px-4 py-3 font-medium">Quotation</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Date</th><th className="px-4 py-3 font-medium">Total</th><th className="px-6 py-3 text-right font-medium">Action</th></tr></thead><tbody className="divide-y">{rows.map((item) => <tr key={item.id} className="hover:bg-neutral-50/70"><td className="px-6 py-4"><p className="font-medium">{item.order_number}</p><p className="mt-1 text-xs text-neutral-400">{item.subject || "Commercial order"}</p></td><td className="px-4 py-4">{item.client_name}</td><td className="px-4 py-4">{item.quotation_number}</td><td className="px-4 py-4"><StatusBadge status={item.status} /></td><td className="px-4 py-4 text-neutral-600">{item.order_date}</td><td className="px-4 py-4 font-medium">{money(item.total, item.currency)}</td><td className="px-6 py-4 text-right"><button onClick={() => void openDetail(item.id)} className="rounded-lg border px-3 py-2 text-xs font-semibold">Open</button></td></tr>)}</tbody></table></div>
            {nextCursor ? <div className="border-t p-4 text-center"><button disabled={loadingMore} onClick={() => void loadMore()} className="rounded-xl border px-5 py-2.5 text-sm font-semibold disabled:opacity-50">{loadingMore ? "Loading..." : "Load more"}</button></div> : null}
          </>}
        </section>
      </div>

      {(detailLoading || detail) ? <OrderDrawer detail={detail} loading={detailLoading} saving={saving} onClose={() => { setDetail(null); if (requestedOrderId) router.replace("/dashboard/orders"); }} onStatus={changeStatus} onProject={(orderId) => router.push(`/dashboard/projects?order_id=${encodeURIComponent(orderId)}`)} onFulfilled={refreshAfterFulfillment} /> : null}
    </main>
  );
}

function OrderDrawer({ detail, loading, saving, onClose, onStatus, onProject, onFulfilled }: { detail: OrderDetail | null; loading: boolean; saving: boolean; onClose: () => void; onStatus: (status: "in_progress" | "completed" | "cancelled", reason?: string) => Promise<boolean>; onProject: (orderId: string) => void; onFulfilled: (fulfillmentNumber: string) => Promise<void> }) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const stockRemaining = detail?.items.some((item) => item.item_type_snapshot === "stock_item" && item.product_id && Number(item.remaining_quantity || 0) > 0) ?? false;
  const hasPostedFulfillment = detail?.items.some((item) => item.item_type_snapshot === "stock_item" && Number(item.fulfilled_quantity || 0) > 0) ?? false;
  const trimmedCancelReason = cancelReason.trim();

  async function confirmCancellation() {
    if (trimmedCancelReason.length < 3) return;
    const success = await onStatus("cancelled", trimmedCancelReason);
    if (success) {
      setCancelOpen(false);
      setCancelReason("");
    }
  }

  return <div className="fixed inset-0 z-50 bg-black/30" onMouseDown={(event) => { if (event.target === event.currentTarget && !cancelOpen) onClose(); }}><aside className="ml-auto h-full w-full max-w-4xl overflow-y-auto bg-white shadow-2xl"><div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-6 py-5"><div><p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Order</p><h2 className="mt-1 text-xl font-semibold">{detail?.order_number ?? "Loading..."}</h2></div><button onClick={onClose} disabled={cancelOpen || saving} className="flex size-10 items-center justify-center rounded-xl border disabled:opacity-40"><X className="size-4" /></button></div>{loading || !detail ? <div className="flex min-h-64 items-center justify-center"><Loader2 className="size-6 animate-spin" /></div> : <div className="space-y-6 p-6">
    <div className="rounded-2xl border p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs uppercase tracking-wide text-neutral-400">Execution status</p><div className="mt-2"><StatusBadge status={detail.status} /></div></div><div className="flex flex-wrap gap-2">{detail.status === "confirmed" ? <><ActionButton disabled={saving} onClick={() => void onStatus("in_progress")} label="Start Order" primary /><ActionButton disabled={saving || hasPostedFulfillment} onClick={() => setCancelOpen(true)} label="Cancel" title={hasPostedFulfillment ? "Return fulfilled stock before cancelling" : undefined} /></> : null}{detail.status === "in_progress" ? <><ActionButton disabled={saving || stockRemaining} onClick={() => void onStatus("completed")} label={stockRemaining ? "Fulfill stock first" : "Complete"} primary title={stockRemaining ? "All tracked stock lines must be fulfilled before completion" : undefined} /><ActionButton disabled={saving || hasPostedFulfillment} onClick={() => setCancelOpen(true)} label="Cancel" title={hasPostedFulfillment ? "Return fulfilled stock before cancelling" : undefined} /></> : null}</div></div>{detail.status === "completed" ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700"><strong>Order completed.</strong> This execution state is final.</div> : null}{detail.status === "cancelled" ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><strong>Order cancelled.</strong><p className="mt-1 whitespace-pre-wrap">{detail.cancellation_reason ? `Reason: ${detail.cancellation_reason}` : "Cancellation reason is unavailable for this older record."}</p></div> : null}{hasPostedFulfillment && detail.status !== "completed" ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">Posted stock fulfillment cannot be cancelled directly. A stock return/reversal is required first.</div> : null}<button onClick={() => onProject(detail.id)} className="mt-4 flex h-10 items-center gap-2 rounded-xl border bg-white px-4 text-sm font-semibold"><FolderKanban className="size-4" /> Project workspace</button></div>

    <OrderFulfillmentPanel orderId={detail.id} orderNumber={detail.order_number} status={detail.status} currency={detail.currency} items={detail.items} disabled={saving} onFulfilled={onFulfilled} />

    <div className="grid gap-4 sm:grid-cols-2"><Info label="Client" value={detail.client_name_snapshot} /><Info label="Quotation" value={detail.quotation_number} /><Info label="Order date" value={detail.order_date} /><Info label="Assigned" value={detail.assigned_employee_name ?? "Unassigned"} /><Info label="Currency" value={detail.currency} /><Info label="Tax mode" value={detail.tax_calculation_mode} /></div>
    <div className="grid gap-5 lg:grid-cols-2"><Snapshot title="From" name={detail.seller_name_snapshot} email={detail.seller_email_snapshot} address={detail.seller_address_snapshot} tax={detail.seller_tax_identifier_snapshot} /><Snapshot title="To" name={detail.client_name_snapshot} email={detail.client_email_snapshot} address={detail.client_address_snapshot} tax={detail.client_tax_identifier_snapshot} /></div>
    {detail.subject ? <div><p className="text-xs uppercase tracking-wide text-neutral-400">Subject</p><p className="mt-1 font-medium">{detail.subject}</p></div> : null}
    <div className="overflow-x-auto rounded-2xl border"><table className="w-full min-w-[860px] text-sm"><thead className="bg-neutral-50 text-xs uppercase text-neutral-400"><tr><th className="px-4 py-3 text-left">Item</th><th className="px-3 py-3 text-right">Ordered</th><th className="px-3 py-3 text-right">Fulfilled</th><th className="px-3 py-3 text-right">Remaining</th><th className="px-3 py-3 text-right">Price</th><th className="px-4 py-3 text-right">Total</th></tr></thead><tbody className="divide-y">{detail.items.map((item) => { const stock = item.item_type_snapshot === "stock_item" && item.product_id; return <tr key={item.id}><td className="px-4 py-3"><p className="font-medium">{item.item_name_snapshot}</p><p className="mt-1 max-w-md text-xs text-neutral-400">{item.sku_snapshot ? `${item.sku_snapshot} · ` : ""}{item.description}</p><p className="mt-1 text-[11px] text-neutral-400">{item.item_type_snapshot.replaceAll("_", " ")} · {item.unit_snapshot} · Disc. {Number(item.discount_percent)}% · Tax {Number(item.tax_rate)}%</p></td><td className="px-3 py-3 text-right">{Number(item.quantity).toLocaleString()}</td><td className="px-3 py-3 text-right">{stock ? Number(item.fulfilled_quantity).toLocaleString() : "—"}</td><td className={`px-3 py-3 text-right ${stock && Number(item.remaining_quantity) > 0 ? "font-semibold text-amber-700" : ""}`}>{stock ? Number(item.remaining_quantity).toLocaleString() : "—"}</td><td className="px-3 py-3 text-right">{money(item.unit_price, detail.currency)}</td><td className="px-4 py-3 text-right font-medium">{money(item.line_total, detail.currency)}</td></tr>; })}</tbody></table></div>
    <div className="ml-auto max-w-sm rounded-2xl border bg-neutral-50 p-5"><TotalRow label="Subtotal" value={money(detail.subtotal, detail.currency)} /><TotalRow label="Discount" value={`- ${money(detail.discount_total, detail.currency)}`} /><TotalRow label="Tax" value={money(detail.tax_total, detail.currency)} /><div className="mt-4 border-t pt-4"><TotalRow label="Total" value={money(detail.total, detail.currency)} strong /></div></div>
    {detail.notes ? <TextBlock label="Client notes" value={detail.notes} /> : null}{detail.terms_conditions ? <TextBlock label="Terms & conditions" value={detail.terms_conditions} /> : null}{detail.internal_notes ? <TextBlock label="Internal notes" value={detail.internal_notes} muted /> : null}
  </div>}</aside>

  {cancelOpen && detail ? <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) { setCancelOpen(false); setCancelReason(""); } }}><div role="dialog" aria-modal="true" aria-labelledby="cancel-order-title" className="w-full max-w-lg rounded-2xl border bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-red-500">Destructive action</p><h3 id="cancel-order-title" className="mt-1 text-xl font-semibold">Cancel {detail.order_number}?</h3><p className="mt-2 text-sm leading-6 text-neutral-500">This ends order execution. The reason is required and will be preserved in the audit trail.</p></div><button type="button" disabled={saving} onClick={() => { setCancelOpen(false); setCancelReason(""); }} className="flex size-9 shrink-0 items-center justify-center rounded-xl border disabled:opacity-40"><X className="size-4" /></button></div><label className="mt-5 block"><span className="text-sm font-semibold">Cancellation reason <span className="text-red-600">*</span></span><textarea autoFocus rows={5} maxLength={1000} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Explain why this order is being cancelled..." className="mt-2 w-full resize-y rounded-xl border px-3 py-3 text-sm outline-none focus:border-neutral-500" /><span className="mt-1 flex justify-between gap-3 text-xs text-neutral-400"><span>{trimmedCancelReason.length > 0 && trimmedCancelReason.length < 3 ? "Enter at least 3 characters." : "This reason becomes part of the permanent order history."}</span><span>{cancelReason.length}/1000</span></span></label><div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" disabled={saving} onClick={() => { setCancelOpen(false); setCancelReason(""); }} className="h-11 rounded-xl border px-4 text-sm font-semibold disabled:opacity-40">Keep order</button><button type="button" disabled={saving || trimmedCancelReason.length < 3} onClick={() => void confirmCancellation()} className="h-11 rounded-xl bg-red-600 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">{saving ? "Cancelling..." : "Cancel order"}</button></div></div></div> : null}
  </div>;
}

function StatusBadge({ status }: { status: string }) { const styles: Record<string, string> = { confirmed: "border-blue-200 bg-blue-50 text-blue-700", in_progress: "border-amber-200 bg-amber-50 text-amber-700", completed: "border-emerald-200 bg-emerald-50 text-emerald-700", cancelled: "bg-neutral-100 text-neutral-500" }; return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${styles[status] ?? "bg-neutral-50"}`}>{status.replace("_", " ")}</span>; }
function Stat({ label, value, icon: Icon }: { label: string; value: string | number; icon: typeof ClipboardCheck }) { return <article className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><p className="text-sm text-neutral-500">{label}</p><Icon className="size-4 text-neutral-400" /></div><p className="mt-4 text-2xl font-semibold">{value}</p></article>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border bg-neutral-50 p-3"><p className="text-xs text-neutral-400">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div>; }
function Snapshot({ title, name, email, address, tax }: { title: string; name: string; email: string | null; address: string | null; tax: string | null }) { return <div className="rounded-2xl border p-4"><p className="text-xs uppercase tracking-wide text-neutral-400">{title}</p><p className="mt-2 font-semibold">{name}</p>{email ? <p className="mt-1 text-sm text-neutral-500">{email}</p> : null}{address ? <p className="mt-1 text-sm leading-5 text-neutral-500">{address}</p> : null}{tax ? <p className="mt-2 text-xs text-neutral-400">Tax ID: {tax}</p> : null}</div>; }
function TotalRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) { return <div className={`mt-2 flex items-center justify-between gap-4 text-sm ${strong ? "text-base font-semibold" : "text-neutral-600"}`}><span>{label}</span><span>{value}</span></div>; }
function TextBlock({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) { return <div className={`rounded-2xl border p-4 ${muted ? "bg-neutral-50" : ""}`}><p className="text-xs uppercase tracking-wide text-neutral-400">{label}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{value}</p></div>; }
function ActionButton({ label, onClick, disabled, primary = false, title }: { label: string; onClick: () => void; disabled?: boolean; primary?: boolean; title?: string }) { return <button title={title} disabled={disabled} onClick={onClick} className={`h-10 rounded-xl px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${primary ? "bg-neutral-950 text-white" : "border bg-white"}`}>{label}</button>; }
