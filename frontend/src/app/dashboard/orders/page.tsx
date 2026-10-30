"use client";

import { useDashboardSession } from "@/components/dashboard-session-context";

import Link from "next/link";
import { ORDER_LIST_PATH, orderCreateHref, orderDocumentHref, safeOrderReturnHref } from "@/lib/order-navigation";
import { CheckCircle2, ClipboardCheck, Loader2, PlayCircle, Plus, Search, ArrowUpRight, XCircle } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RelationshipHeader, RelationshipNotice, RelationshipPage } from "@/components/relationships/relationship-ui";
import "@/components/commercial/orders-register.css";

type Summary = { total: number; confirmed: number; in_progress: number; completed: number; cancelled: number };
type CurrencyValue = { currency: string; amount: string | number };
type ValueSummary = {
  total: CurrencyValue[];
  confirmed: CurrencyValue[];
  in_progress: CurrencyValue[];
  completed: CurrencyValue[];
  cancelled: CurrencyValue[];
};
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

function compactMoney(value: string | number, currency: string) {
  return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export default function OrdersPage() {
  const { tenant } = useDashboardSession();
  const canManageOrders = Boolean(tenant?.is_owner || tenant?.permissions.some(p => p === "*" || p === "orders.manage"));
  const router = useRouter();
  const searchParams = useSearchParams();
  const quotationId = searchParams.get("quotation_id");
  const requestedOrderId = searchParams.get("order_id");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [valueSummary, setValueSummary] = useState<ValueSummary | null>(null);
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const cleanListHref = safeOrderReturnHref(`${ORDER_LIST_PATH}?${searchParams}`);
  const listParams = new URLSearchParams(cleanListHref.split("?")[1] || "");
  const search = listParams.get("search") || "";
  const statusFilter = listParams.get("status") || "";
  const pages = Number(listParams.get("pages") || "1");
  const requestedFocus = listParams.get("focus");
  const [reloadKey, setReloadKey] = useState(0);
  const [quotation, setQuotation] = useState<QuotationMini | null>(null);
  const [quotationOrderLink, setQuotationOrderLink] = useState<OrderLink | null>(null);
  const listRequest = useRef(0);
  const conversionPending = useRef(false);
  const pageCache = useRef<{ query: string; pages: OrderPage[] } | null>(null);

  function updateBrowse(nextSearch: string, nextStatus: string, nextPages = 1) {
    const params = new URLSearchParams();
    if (nextSearch) params.set("search", nextSearch);
    if (nextStatus) params.set("status", nextStatus);
    if (nextPages > 1) params.set("pages", String(nextPages));
    // Retain the existing quotation handoff while browsing its resulting order list.
    if (quotationId) params.set("quotation_id", quotationId);
    router.push(`${ORDER_LIST_PATH}${params.size ? `?${params}` : ""}`, { scroll: false });
  }
  function returnFor(id: string) {
    const params = new URLSearchParams(cleanListHref.split("?")[1] || "");
    params.set("focus", id);
    return safeOrderReturnHref(`${ORDER_LIST_PATH}?${params}`);
  }

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
    const [summaryPayload, valuePayload] = await Promise.all([
      api("/orders/summary"),
      api("/order-value-summary"),
    ]);
    setSummary(summaryPayload as Summary);
    setValueSummary(valuePayload as ValueSummary);
  }, [api]);

  // Summary belongs to all company orders, not the filtered register.
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void Promise.all([api("/orders/summary", { signal: controller.signal }), api("/order-value-summary", { signal: controller.signal })])
      .then(([counts, values]) => { if (active) { setSummary(counts as Summary); setValueSummary(values as ValueSummary); } })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Unable to load order summary."); });
    return () => { active = false; controller.abort(); };
  }, [api]);

  // Cursor pages are cached only within this mounted register. The URL is the
  // reproducible browse context; no customer data is persisted in the browser.
  useEffect(() => {
    const request = ++listRequest.current;
    const controller = new AbortController();
    let active = true;
    const current = () => active && request === listRequest.current;
    const previous = pageCache.current;
    const cached = previous?.query === query ? [...previous.pages] : [];
    const appending = cached.length > 0 && pages > cached.length;
    if (!cached.length) { setRows([]); setNextCursor(null); }
    setListLoading(!appending);
    setLoadingMore(appending);
    setError(null);
    void (async () => {
      try {
        while (cached.length < pages) {
          const cursor = cached.length ? cached[cached.length - 1].next_cursor : null;
          if (cached.length && !cursor) break;
          const params = new URLSearchParams(query);
          if (cursor) params.set("cursor", cursor);
          const payload = await api(`/orders?${params}`, { signal: controller.signal }) as OrderPage;
          if (!current()) return;
          cached.push(payload);
        }
        if (!current()) return;
        pageCache.current = { query, pages: cached };
        const visible = cached.slice(0, pages);
        setRows(visible.flatMap(page => page.items));
        setNextCursor(visible.at(-1)?.next_cursor || null);
      } catch (reason) {
        if (current()) setError(reason instanceof Error ? reason.message : "Unable to load orders.");
      } finally {
        if (current()) { setLoading(false); setListLoading(false); setLoadingMore(false); }
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [api, query, pages, reloadKey]);

  useEffect(() => {
    if (!loading && !listLoading && requestedFocus) {
      document.getElementById(`order-row-${requestedFocus}`)?.focus();
    }
  }, [loading, listLoading, requestedFocus, rows]);

  useEffect(() => {
    if (!quotationId) {
      setQuotation(null);
      setQuotationOrderLink(null);
      return;
    }
    let active = true;
    setQuotation(null);
    setQuotationOrderLink(null);
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
    if (requestedOrderId) router.replace(orderDocumentHref(requestedOrderId, "view", cleanListHref));
  }, [requestedOrderId, router, cleanListHref]);

  async function convertQuotation() {
    if (!canManageOrders || !quotationId || !quotation || quotation.id !== quotationId || conversionPending.current) return;
    if (quotation.status !== "accepted") {
      setError("Only accepted quotations can become orders.");
      return;
    }
    conversionPending.current = true;
    setSaving(true);
    setError(null);
    try {
      const created = await api(`/orders/from-quotation/${encodeURIComponent(quotationId)}`, { method: "POST" }) as OrderRow;
      setMessage(`Order ${created.order_number} created from ${quotation.quotation_number}`);
      setQuotationOrderLink({ order_id: created.id, order_number: created.order_number, status: created.status });
      await refreshSummary();
      router.push(orderDocumentHref(created.id, "view", cleanListHref));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create order.");
    } finally {
      conversionPending.current = false;
      setSaving(false);
    }
  }

  function loadMore() {
    if (!nextCursor || loadingMore) return;
    updateBrowse(search, statusFilter, pages + 1);
  }

  return (
    <RelationshipPage className="orders-register-page">
      <RelationshipHeader eyebrow="SALES / EXECUTION" title="Orders" description="From confirmed scope to completed work. Keep delivery and commercial context together." actions={canManageOrders ? <a href={orderCreateHref(cleanListHref)} className="relationship-primary"><Plus aria-hidden="true" />New order</a> : undefined} />

      {quotation && quotation.id === quotationId ? <section className="order-quotation-handoff" aria-label="Quotation handoff"><div><p>Quotation handoff</p><h2>{quotation.quotation_number} · {quotation.client_name_snapshot}</h2><span>{money(quotation.total, quotation.currency)} · Status: {quotation.status}</span></div>{quotationOrderLink ? <Link href={orderDocumentHref(quotationOrderLink.order_id, "view", cleanListHref)} className="relationship-secondary">Open {quotationOrderLink.order_number}</Link> : canManageOrders ? <button disabled={saving || quotation.status !== "accepted"} onClick={() => void convertQuotation()} className="relationship-primary">{saving ? "Creating..." : "Create Order"}</button> : <span>Read-only order handoff</span>}</section> : null}

      <div className="orders-overview-desktop"><OrderSummary summary={summary} valueSummary={valueSummary} /></div>
      <details className="orders-overview-mobile"><summary><span>All orders <strong>{summary?.total ?? "—"}</strong></span><span>Counts & values by currency</span></summary><OrderSummary summary={summary} valueSummary={valueSummary} /></details>
      {message ? <RelationshipNotice tone="success">{message}</RelationshipNotice> : null}
      {error ? <RelationshipNotice tone="error">{error}<button className="relationship-secondary" onClick={() => { pageCache.current = null; setReloadKey(key => key + 1); }}>Retry register</button></RelationshipNotice> : null}

      <section className="orders-register" aria-label="Order register">
        <div className="orders-register-heading"><div><h2>Order register</h2><p>Open an order to review its delivery, billing and source document.</p></div><span>{rows.length} records loaded</span></div>
        <div className="orders-filters">
          <form key={search} onSubmit={(event) => { event.preventDefault(); const value = new FormData(event.currentTarget).get("search"); updateBrowse(String(value || "").trim(), statusFilter); }} className="orders-search"><Search aria-hidden="true" /><input name="search" aria-label="Search orders" defaultValue={search} placeholder="Search order, quotation, client..." /><button type="submit" aria-label="Apply order search">Search</button></form>
          <select aria-label="Filter orders by status" value={statusFilter} onChange={(event) => updateBrowse(search, event.target.value)}><option value="">All statuses</option><option value="confirmed">Confirmed</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select>
          <button onClick={() => updateBrowse("", "")} className="relationship-secondary">Reset</button>
        </div>
        {loading || listLoading ? <div className="orders-register-empty" role="status"><Loader2 className="animate-spin" /><p>Loading orders…</p></div> : rows.length === 0 ? <div className="orders-register-empty"><ClipboardCheck /><h2>{error ? "Order register unavailable" : "No orders found"}</h2><p>{error ? "The register could not be loaded. Check the message above and retry when ready." : "Create an order or convert an accepted quotation. Try adjusting your search or status filter."}</p></div> : <>
          <OrdersRegister rows={rows} returnFor={returnFor} />
          {nextCursor ? <div className="orders-register-footer"><button disabled={loadingMore} onClick={() => void loadMore()} className="relationship-secondary">{loadingMore ? "Loading..." : "Load more"}</button></div> : null}
        </>}
      </section>
    </RelationshipPage>
  );
}

function OrderSummary({ summary, valueSummary }: { summary: Summary | null; valueSummary: ValueSummary | null }) {
  return <><section className="orders-summary" aria-label="All company order counts and values by status">
        <Stat label="Total" value={summary?.total ?? "—"} values={valueSummary?.total ?? []} icon={ClipboardCheck} />
        <Stat label="Confirmed" value={summary?.confirmed ?? "—"} values={valueSummary?.confirmed ?? []} icon={ClipboardCheck} />
        <Stat label="In progress" value={summary?.in_progress ?? "—"} values={valueSummary?.in_progress ?? []} icon={PlayCircle} />
        <Stat label="Completed" value={summary?.completed ?? "—"} values={valueSummary?.completed ?? []} icon={CheckCircle2} />
        <Stat label="Cancelled" value={summary?.cancelled ?? "—"} values={valueSummary?.cancelled ?? []} icon={XCircle} />
      </section>
      <p className="orders-currency-note">All company orders · order value shown in each original currency · no combined currency total</p></>;
}

/** A single row mapping supplies both desktop columns and mobile cards. */
function OrdersRegister({ rows, returnFor }: { rows: OrderRow[]; returnFor: (id: string) => string }) {
  return <table className="orders-table"><caption className="sr-only">Orders, client, quotation source, execution status, date and value</caption><thead><tr><th>Order / scope</th><th>Client</th><th>Source quotation</th><th>Status</th><th>Order date</th><th>Value</th><th><span className="sr-only">Open order</span></th></tr></thead><tbody>{rows.map((item) => <tr key={item.id}>
    <td className="order-identity"><Link id={`order-row-${item.id}`} href={orderDocumentHref(item.id, "view", returnFor(item.id))} className="order-number">{item.order_number}</Link><p>{item.subject || "Commercial order"}</p></td>
    <td data-label="Client">{item.client_name}</td>
    <td data-label="Source quotation"><span className="order-source">{item.quotation_number || "Manual"}</span></td>
    <td className="order-stage"><StatusBadge status={item.status} /></td>
    <td data-label="Order date" className="order-date">{item.order_date}</td>
    <td data-label="Value" className="order-value">{money(item.total, item.currency)}</td>
    <td className="order-open"><Link href={orderDocumentHref(item.id, "view", returnFor(item.id))} aria-label={`Open order ${item.order_number}`}><span>Open</span><ArrowUpRight aria-hidden="true" /></Link></td>
  </tr>)}</tbody></table>;
}

function StatusBadge({ status }: { status: string }) { const styles: Record<string, string> = { confirmed: "border-blue-200 bg-blue-50 text-blue-700", in_progress: "border-amber-200 bg-amber-50 text-amber-700", completed: "border-emerald-200 bg-emerald-50 text-emerald-700", cancelled: "border-neutral-200 bg-neutral-100 text-neutral-500" }; return <span className={`inline-flex shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${styles[status] ?? "bg-neutral-50"}`}>{status.replace("_", " ")}</span>; }
function Stat({ label, value, values, icon: Icon }: { label: string; value: string | number; values: CurrencyValue[]; icon: typeof ClipboardCheck }) {
  return <article className="order-summary-cell"><div className="order-summary-title"><p>{label}</p><Icon aria-hidden="true" /></div><strong>{value}</strong><div className="order-summary-values" aria-label={`${label} order value by currency`}>{values.length ? values.map((item) => <span key={item.currency}>{compactMoney(item.amount, item.currency)}</span>) : <span className="order-no-value">{value === "—" ? "Not loaded" : "No order value"}</span>}</div></article>;
}
