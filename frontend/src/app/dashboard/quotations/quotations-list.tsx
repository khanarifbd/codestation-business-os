"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, FileText, Loader2, Plus, RefreshCw, Search } from "lucide-react";
import { RelationshipHeader } from "@/components/relationships/relationship-ui";
import { QUOTATION_LIST_PATH, QUOTATION_STATUSES, quotationCreateHref, quotationDocumentHref, safeQuotationReturnHref } from "@/lib/quotation-navigation";
import "@/components/commercial/quotation-workspace.css";
import "@/components/commercial/quotations-list.css";

type QuotationRow = { id: string; quotation_number: string; client_name: string; subject: string | null; status: string; valid_until: string | null; currency: string; total: string | number; is_expired: boolean };
type Summary = { total: number; draft: number; sent: number; accepted: number; rejected: number; cancelled: number };
type Page = { items: QuotationRow[]; next_cursor: string | null };
const formatMoney = (value: string | number, currency: string) => `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function QuotationsList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const canonical = safeQuotationReturnHref(`${QUOTATION_LIST_PATH}?${searchParams}`);
  const filters = new URLSearchParams(canonical.split("?")[1] || "");
  const search = filters.get("search") || "";
  const status = filters.get("status") || "";
  const pages = Number(filters.get("pages") || 1);
  const focusId = filters.get("focus");
  const legacyQuotation = searchParams.get("quotation_id");
  const legacyLead = searchParams.get("lead_id");
  const legacyClient = searchParams.get("client_id");
  const legacy = Boolean(legacyQuotation || legacyLead || legacyClient);
  const [rows, setRows] = useState<QuotationRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const requestId = useRef(0);
  const listRef = useRef<HTMLElement>(null);

  const api = useCallback(async (path: string, signal: AbortSignal) => {
    const response = await fetch(`/api/sales${path}`, { signal });
    if (response.status === 401) { router.replace("/login"); throw new Error("Authentication required"); }
    const payload = await response.json().catch(() => null);
    if (response.status === 403) throw new Error("Your company role does not have permission to manage quotations.");
    if (!response.ok) throw new Error(typeof payload?.detail === "string" ? payload.detail : "Unable to load quotations. Please retry.");
    return payload;
  }, [router]);

  useEffect(() => {
    if (legacyQuotation) { router.replace(quotationDocumentHref(legacyQuotation, "view", canonical)); return; }
    if (!legacyLead && !legacyClient) return;
    const destination = new URL(quotationCreateHref(canonical), window.location.origin);
    if (legacyLead) destination.searchParams.set("lead_id", legacyLead);
    else if (legacyClient) destination.searchParams.set("client_id", legacyClient);
    // Native entry creates the document boundary used by the unsaved-change guard.
    window.location.replace(`${destination.pathname}${destination.search}`);
  }, [canonical, legacyClient, legacyLead, legacyQuotation, router]);

  useEffect(() => {
    if (legacy) return;
    const controller = new AbortController();
    const request = ++requestId.current;
    async function load() {
      setLoading(true); setError(null);
      try {
        const query = new URLSearchParams({ limit: "30" });
        if (search) query.set("search", search);
        if (status) query.set("status", status);
        const [first, counts] = await Promise.all([api(`/quotations?${query}`, controller.signal) as Promise<Page>, api("/quotations/summary", controller.signal) as Promise<Summary>]);
        let items = first.items;
        let cursor = first.next_cursor;
        for (let page = 1; page < pages && cursor; page += 1) {
          query.set("cursor", cursor);
          const next = await api(`/quotations?${query}`, controller.signal) as Page;
          items = [...items, ...next.items]; cursor = next.next_cursor;
        }
        if (request !== requestId.current || controller.signal.aborted) return;
        setRows(items); setNextCursor(cursor); setSummary(counts);
      } catch (reason) {
        if (request !== requestId.current || controller.signal.aborted) return;
        setRows([]); setNextCursor(null); setSummary(null);
        setError(reason instanceof Error ? reason.message : "Unable to load quotations.");
      } finally {
        if (request === requestId.current && !controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => { controller.abort(); requestId.current += 1; };
  }, [api, legacy, pages, refresh, search, status]);

  useEffect(() => {
    if (loading || !focusId) return;
    const target = Array.from(listRef.current?.querySelectorAll<HTMLAnchorElement>("a[data-quotation-id]") || []).find(link => link.dataset.quotationId === focusId);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest" });
  }, [focusId, loading]);

  function updateFilters(next: { search?: string; status?: string; pages?: number }) {
    const query = new URLSearchParams();
    const nextSearch = next.search ?? search;
    const nextStatus = next.status ?? status;
    if (nextSearch.trim()) query.set("search", nextSearch.trim());
    if (nextStatus) query.set("status", nextStatus);
    if ((next.pages || 1) > 1) query.set("pages", String(next.pages));
    router.replace(`${QUOTATION_LIST_PATH}${query.size ? `?${query}` : ""}`, { scroll: false });
  }

  function rowReturnHref(id: string) {
    const query = new URLSearchParams(canonical.split("?")[1] || "");
    query.set("focus", id);
    return `${QUOTATION_LIST_PATH}?${query}`;
  }

  if (legacy) return <main className="quotation-workspace"><p role="status">Opening quotation workspace…</p></main>;
  return <main className="quotation-workspace quotation-browse"><div className="quotation-page-content">
    <RelationshipHeader eyebrow="SALES / QUOTATIONS" title="Quotations" description="Find the proposal. Open the document. Keep every revision in context." actions={<>
      <button type="button" className="quotation-browse-action" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={15} aria-hidden="true" /> Refresh</button>
      {/* Native document entry is intentional: it makes browser Back honor beforeunload in the editor. */}
      <a className="quotation-browse-action is-primary" href={quotationCreateHref(canonical)}><Plus size={16} aria-hidden="true" /> New quotation</a>
    </>} />
    <section className="quotation-browse-summary" aria-label="All quotation counts">
      {([['total','All quotations'],['draft','Drafts'],['sent','Awaiting decision'],['accepted','Accepted'],['rejected','Rejected'],['cancelled','Cancelled']] as const).map(([key,label]) => <div key={key}><span>{label}</span><strong>{summary ? summary[key] : "—"}</strong></div>)}
    </section>
    <p className="quotation-browse-scope">Counts include all quotations. The register below reflects your search and status filter.</p>
    {error ? <div role="alert" className="quotation-notice quotation-notice-error">{error} <button type="button" onClick={() => setRefresh(value => value + 1)}>Retry</button></div> : null}
    <section ref={listRef} className="quotation-register" aria-label="Quotation register" aria-busy={loading}>
      <div className="quotation-register-toolbar"><div className="quotation-register-title"><h2>Proposal register</h2><p>View first. Edit drafts in their own workspace.</p></div><div className="quotation-register-filters">
        <form key={search} onSubmit={event => { event.preventDefault(); updateFilters({ search: String(new FormData(event.currentTarget).get("search") || "") }); }}>
          <Search size={15} aria-hidden="true" /><input name="search" aria-label="Search quotations" defaultValue={search} placeholder="Quotation, client or project" /><button type="submit" aria-label="Apply quotation search">Search</button>
        </form>
        <div className="quotation-status-filter"><select aria-label="Filter quotations by status" value={status} onChange={event => updateFilters({ status: event.target.value })}><option value="">All statuses</option>{QUOTATION_STATUSES.map(value => <option key={value} value={value}>{value[0].toUpperCase()+value.slice(1)}</option>)}</select><button type="button" onClick={() => updateFilters({ search: "", status: "" })}>Reset</button></div>
      </div></div>
      <div className="quotation-register-columns" aria-hidden="true"><span>Quotation / project</span><span>Client</span><span>Status</span><span>Valid until</span><span>Document value</span><span>Open</span></div>
      <div className="quotation-browse-rows">
        {loading ? <div className="quotation-browse-empty" role="status"><Loader2 className="animate-spin" size={22} /><span>Loading quotations…</span></div> : rows.length === 0 ? <div className="quotation-browse-empty"><FileText size={29} aria-hidden="true" /><h3>{search || status ? "No quotations match this view" : error ? "Register unavailable" : "No quotations yet"}</h3><p>{search || status ? "Try another search or clear the filters." : error ? "Retry without leaving your browse context." : "Create a draft to start a proposal."}</p>{search || status ? <button type="button" className="quotation-browse-action" onClick={() => updateFilters({ search: "", status: "" })}>Clear filters</button> : null}</div> : rows.map(row => <Link prefetch={false} data-quotation-id={row.id} key={row.id} href={quotationDocumentHref(row.id, "view", rowReturnHref(row.id))} className="quotation-register-row" aria-label={`View quotation ${row.quotation_number}, ${row.status}, for ${row.client_name}`}>
          <span className="quotation-register-identity"><strong>{row.quotation_number}</strong><small>{row.subject || "No project title"}</small></span><span className="quotation-register-client">{row.client_name}</span><span className="quotation-register-stage"><span className="quotation-browse-status" data-status={row.status}>{row.status}{row.is_expired ? " · expired" : ""}</span></span><span className="quotation-register-validity"><small>Valid until</small>{row.valid_until || "—"}</span><span className="quotation-register-value">{formatMoney(row.total,row.currency)}</span><span className="quotation-browse-open">View <ArrowUpRight size={14} aria-hidden="true" /></span>
        </Link>)}
      </div>
      <footer className="quotation-browse-footer"><span>{loading ? "Updating register" : `${rows.length} quotation${rows.length === 1 ? "" : "s"} loaded`} · Values retain their document currency</span>{nextCursor && !loading ? <button type="button" className="quotation-browse-action" onClick={() => updateFilters({ pages: pages + 1 })}>Load more quotations</button> : null}</footer>
    </section>
  </div></main>;
}
