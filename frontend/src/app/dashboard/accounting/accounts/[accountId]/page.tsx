"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Download, Landmark, Loader2 } from "lucide-react";
import { useParams } from "next/navigation";

import { AccountingNav } from "@/components/accounting-nav";
import { CursorPager } from "@/components/cursor-pager";
import { getApiErrorMessage } from "@/lib/api-error";

type Account = { id: string; name: string; account_type: string; provider_name: string | null; account_reference: string | null; currency: string; opening_balance: string | number; current_balance: string | number; is_active: boolean };
type Transaction = { id: string; transaction_date: string; direction: "credit" | "debit" | string; amount: string | number; currency: string; source_type: string; source_id: string; reference: string | null; description: string | null; created_at: string };
type LedgerPage = { items: Transaction[]; next_cursor: string | null };

function money(value: string | number, currency: string) { return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function prettySource(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase()); }
function csvCell(value: string | number | null | undefined) { const text = String(value ?? ""); return `"${text.replaceAll('"', '""')}"`; }

export default function AccountLedgerPage() {
  const params = useParams<{ accountId: string }>();
  const accountId = params.accountId;
  const [account, setAccount] = useState<Account | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState("all");
  const [sourceType, setSourceType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [pageSize, setPageSize] = useState(20);
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const page = cursorStack.length;
  const currentCursor = cursorStack[cursorStack.length - 1];

  const loadAccount = useCallback(async () => {
    const response = await fetch("/api/finance/accounts", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not load account"));
    const selected = (payload as Account[]).find((item) => item.id === accountId) ?? null;
    if (!selected) throw new Error("Financial account not found");
    setAccount(selected);
  }, [accountId]);

  const loadPage = useCallback(async (cursor: string | null) => {
    setLoading(true); setError(null);
    try {
      const query = new URLSearchParams({ limit: String(pageSize) });
      if (cursor) query.set("cursor", cursor);
      if (search.trim()) query.set("search", search.trim());
      if (direction !== "all") query.set("direction", direction);
      if (sourceType.trim()) query.set("source_type", sourceType.trim());
      if (dateFrom) query.set("date_from", dateFrom);
      if (dateTo) query.set("date_to", dateTo);
      const response = await fetch(`/api/finance/accounts/${accountId}/ledger-page?${query.toString()}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not load account statement"));
      const typed = payload as LedgerPage;
      setTransactions(typed.items ?? []);
      setNextCursor(typed.next_cursor ?? null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load account statement"); }
    finally { setLoading(false); }
  }, [accountId, pageSize, search, direction, sourceType, dateFrom, dateTo]);

  useEffect(() => { void loadAccount().catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load account")); }, [loadAccount]);
  useEffect(() => { const timer = window.setTimeout(() => void loadPage(currentCursor), 250); return () => window.clearTimeout(timer); }, [loadPage, currentCursor]);

  const totals = useMemo(() => transactions.reduce((sum, item) => ({ credit: sum.credit + (item.direction === "credit" ? Number(item.amount) : 0), debit: sum.debit + (item.direction === "debit" ? Number(item.amount) : 0) }), { credit: 0, debit: 0 }), [transactions]);
  const sourceTypes = useMemo(() => Array.from(new Set(transactions.map((item) => item.source_type))).sort(), [transactions]);
  const activeFilters = Boolean(search || direction !== "all" || sourceType || dateFrom || dateTo);
  function resetPaging() { setCursorStack([null]); setNextCursor(null); }
  function changeFilter(action: () => void) { action(); resetPaging(); }

  function exportCsv() {
    if (!account || !transactions.length) return;
    const header = ["Date", "Description", "Source", "Source ID", "Reference", "Debit", "Credit"];
    const lines = transactions.map((item) => [item.transaction_date, item.description || prettySource(item.source_type), prettySource(item.source_type), item.source_id, item.reference || "", item.direction === "debit" ? item.amount : "", item.direction === "credit" ? item.amount : ""]);
    const csv = [header, ...lines].map((row) => row.map(csvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${account.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-statement-page-${page}.csv`; anchor.click(); URL.revokeObjectURL(url);
  }

  if (!account && loading) return <main className="flex min-h-[70vh] items-center justify-center"><Loader2 className="size-7 animate-spin text-neutral-400" /></main>;

  return <main className="p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-7xl space-y-6">
    <div><Link href="/dashboard/accounting/accounts" className="inline-flex items-center gap-2 text-sm font-medium text-neutral-500 hover:text-neutral-950"><ArrowLeft className="size-4" />Back to accounts</Link><div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Finance & Accounts · Account Statement</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">{account?.name ?? "Account statement"}</h1><p className="mt-2 text-sm text-neutral-500">{account?.provider_name || account?.account_reference || "Full transaction history for this account."}</p></div>{account ? <div className="rounded-2xl border bg-white px-5 py-4 text-right"><p className="text-xs text-neutral-400">Current balance</p><p className="mt-1 text-2xl font-semibold tabular-nums">{money(account.current_balance, account.currency)}</p></div> : null}</div></div>
    <AccountingNav />
    {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

    {account ? <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div className="rounded-2xl border bg-white p-5"><p className="text-sm text-neutral-500">Opening balance</p><p className="mt-2 text-2xl font-semibold tabular-nums">{money(account.opening_balance, account.currency)}</p></div><div className="rounded-2xl border bg-white p-5"><div className="flex items-center justify-between"><p className="text-sm text-neutral-500">Credit · this page</p><ArrowDownLeft className="size-4 text-neutral-400" /></div><p className="mt-2 text-2xl font-semibold tabular-nums">{money(totals.credit, account.currency)}</p></div><div className="rounded-2xl border bg-white p-5"><div className="flex items-center justify-between"><p className="text-sm text-neutral-500">Debit · this page</p><ArrowUpRight className="size-4 text-neutral-400" /></div><p className="mt-2 text-2xl font-semibold tabular-nums">{money(totals.debit, account.currency)}</p></div><div className="rounded-2xl border bg-white p-5"><div className="flex items-center justify-between"><p className="text-sm text-neutral-500">Current balance</p><Landmark className="size-4 text-neutral-400" /></div><p className="mt-2 text-2xl font-semibold tabular-nums">{money(account.current_balance, account.currency)}</p></div></section> : null}

    <section className="overflow-hidden rounded-2xl border bg-white"><div className="border-b p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="font-semibold">Account statement</h2><p className="mt-1 text-sm text-neutral-500">Search and filter on the server so large ledgers remain fast.</p></div><button type="button" disabled={!transactions.length} onClick={exportCsv} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium disabled:opacity-40"><Download className="size-4" />Export this page</button></div><div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-[1fr_160px_190px_160px_160px_auto]"><input value={search} onChange={(e) => changeFilter(() => setSearch(e.target.value))} placeholder="Search description, reference or source…" className="rounded-xl border px-3 py-2.5 text-sm"/><select value={direction} onChange={(e) => changeFilter(() => setDirection(e.target.value))} className="rounded-xl border bg-white px-3 py-2.5 text-sm"><option value="all">Money In & Out</option><option value="credit">Credit / Money In</option><option value="debit">Debit / Money Out</option></select><select value={sourceType} onChange={(e) => changeFilter(() => setSourceType(e.target.value))} className="rounded-xl border bg-white px-3 py-2.5 text-sm"><option value="">All source types</option>{sourceTypes.map((value) => <option key={value} value={value}>{prettySource(value)}</option>)}</select><input type="date" value={dateFrom} onChange={(e) => changeFilter(() => setDateFrom(e.target.value))} className="rounded-xl border px-3 py-2.5 text-sm"/><input type="date" value={dateTo} onChange={(e) => changeFilter(() => setDateTo(e.target.value))} className="rounded-xl border px-3 py-2.5 text-sm"/>{activeFilters ? <button onClick={() => { setSearch(""); setDirection("all"); setSourceType(""); setDateFrom(""); setDateTo(""); resetPaging(); }} className="rounded-xl border px-3 py-2.5 text-sm">Clear</button> : <span />}</div></div>
      <div className="overflow-x-auto"><table className="min-w-[1050px] w-full text-sm"><thead><tr className="border-b text-left text-xs uppercase tracking-wide text-neutral-400"><th className="px-4 py-3">Date</th><th className="px-4 py-3">Description</th><th className="px-4 py-3">Source</th><th className="px-4 py-3">Reference</th><th className="px-4 py-3 text-right">Debit</th><th className="px-4 py-3 text-right">Credit</th></tr></thead><tbody>{transactions.map((item) => <tr key={item.id} className="border-b last:border-0 hover:bg-neutral-50"><td className="px-4 py-3 whitespace-nowrap">{item.transaction_date}</td><td className="px-4 py-3"><p className="font-medium">{item.description || prettySource(item.source_type)}</p><p className="mt-1 font-mono text-[11px] text-neutral-400">{item.source_id}</p></td><td className="px-4 py-3"><span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-600">{prettySource(item.source_type)}</span></td><td className="px-4 py-3">{item.reference || "—"}</td><td className="px-4 py-3 text-right font-medium tabular-nums">{item.direction === "debit" ? money(item.amount, item.currency) : "—"}</td><td className="px-4 py-3 text-right font-medium tabular-nums">{item.direction === "credit" ? money(item.amount, item.currency) : "—"}</td></tr>)}</tbody></table>{!loading && !transactions.length ? <div className="py-14 text-center"><p className="font-medium">No matching account transactions</p><p className="mt-1 text-sm text-neutral-400">Change the filters or select another date range.</p></div> : null}</div>
      <CursorPager page={page} pageSize={pageSize} shownCount={transactions.length} hasPrevious={cursorStack.length > 1} hasNext={Boolean(nextCursor)} loading={loading} onPrevious={() => setCursorStack((stack) => stack.length > 1 ? stack.slice(0, -1) : stack)} onNext={() => { if (nextCursor) setCursorStack((stack) => [...stack, nextCursor]); }} onPageSizeChange={(value) => { setPageSize(value); resetPaging(); }} />
    </section>
  </div></main>;
}
