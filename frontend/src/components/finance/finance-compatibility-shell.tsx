"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useDocumentNavigationGuard } from "@/hooks/use-document-navigation-guard";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { InvoicesWorkspaceV2, type InvoiceProtection } from "@/components/invoices-workspace-v2";
import { AccountsWorkspace } from "@/components/accounting-accounts/account-workspace";
import { MoneyInWorkspace } from "@/components/accounting-money-in/money-in-workspace";
import { financeBrowse, financeHref, type FinanceTab } from "@/lib/finance-compatibility-navigation";
import { financeOpenCount, verifiedFinanceSummary, type FinanceSummary } from "@/lib/finance-summary";
import { accountCreateHref } from "@/lib/account-navigation";
import { formatMoneyExact } from "@/lib/sales-money-preview";
import { getApiErrorMessage } from "@/lib/api-error";
import type { InvoiceRegisterLocation } from "@/lib/invoice-register-navigation";

export function FinanceCompatibilityShell() {
  const { tenant, loading } = useDashboardSession();
  if (loading) return <p role="status" className="p-6">Loading Finance…</p>;
  return <FinanceShellContent key={JSON.stringify([tenant?.organization.id, tenant?.membership_id, tenant?.role_id, tenant?.permissions])} />;
}
export function FinanceShellContent() {
  const { tenant } = useDashboardSession(), router = useRouter(), params = useSearchParams();
  const browse = financeBrowse(params.toString()), currentBrowse = useRef(browse);
  const scope = JSON.stringify([tenant?.organization.id, tenant?.membership_id, tenant?.role_id, tenant?.permissions]);
  const activeScope = useRef<string | null>(scope), readEpoch = useRef(0);
  const canView = Boolean(tenant?.permissions.some(p => p === "*" || p === "finance.view"));
  const canManage = Boolean(tenant?.permissions.some(p => p === "*" || p === "finance.manage"));
  const invoiceGuard = useRef<(() => InvoiceProtection) | null>(null);
  const [protection, setProtection] = useState<InvoiceProtection>({ pending: false, unknown: false, open: false });
  const initialTab = browse.client_id ? "invoices" : browse.tab;
  const [tab, setTab] = useState<FinanceTab>(initialTab);
  const [visited, setVisited] = useState<FinanceTab[]>([initialTab]);
  const [createRequest, setCreateRequest] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [summary, setSummary] = useState<FinanceSummary | null>(null), [summaryLoading, setSummaryLoading] = useState(false), [summaryError, setSummaryError] = useState<string | null>(null);
  const requestedTab = browse.client_id ? "invoices" : browse.tab;
  const pending = protection.pending;
  const pendingGuard = useMemo(() => ({ get current() { return Boolean(invoiceGuard.current?.().pending); } }), []);
  useDocumentNavigationGuard(protection.open || protection.unknown, {
    enabled: canView && (protection.open || protection.unknown || protection.pending),
    isBusy: pending, pendingRef: pendingGuard, documentLabel: "invoice",
    discardMessage: protection.unknown ? "Invoice creation may already be saved. Leaving loses this tab's frozen draft protection. Verify company invoice history before any replacement. Leave anyway?" : undefined,
  });
  const ownsScope = useCallback(() => activeScope.current === scope, [scope]);
  useLayoutEffect(() => { activeScope.current = scope; return () => { activeScope.current = null; ++readEpoch.current; }; }, [scope]);
  useLayoutEffect(() => { currentBrowse.current = browse; });
  useLayoutEffect(() => {
    if (invoiceGuard.current?.().pending && requestedTab !== tab) {
      router.replace(financeHref({ ...currentBrowse.current, tab }), { scroll: false });
      return;
    }
    setTab(requestedTab);
  }, [requestedTab, tab, router]);
  useEffect(() => { setVisited(current => current.includes(tab) ? current : [...current, tab]); }, [tab]);
  const registerProtectionGuard = useCallback((guard: (() => InvoiceProtection) | null) => { invoiceGuard.current = guard; }, []);
  const onProtectionChange = useCallback((next: InvoiceProtection) => {
    setProtection(current => current.pending === next.pending && current.unknown === next.unknown && current.open === next.open ? current : next);
  }, []);
  const loadSummary = useCallback(async () => {
    if (!ownsScope() || !canView) return;
    const epoch = ++readEpoch.current, current = () => ownsScope() && epoch === readEpoch.current;
    setSummaryLoading(true); setSummaryError(null); setSummary(null);
    try {
      const response = await fetch("/api/finance/summary", { cache: "no-store" });
      if (!current()) return;
      const payload = await response.json().catch(() => null);
      if (!current()) return;
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Company-wide finance summary is unavailable."));
      setSummary(verifiedFinanceSummary(payload));
    } catch (reason) { if (current()) setSummaryError(reason instanceof Error ? reason.message : "Company-wide finance summary is unavailable."); }
    finally { if (current()) setSummaryLoading(false); }
  }, [canView, ownsScope]);
  useEffect(() => { void loadSummary(); }, [loadSummary]);
  const wasPending = useRef(false);
  useEffect(() => { const settled = wasPending.current && !protection.pending; wasPending.current = protection.pending; if (settled) void loadSummary(); }, [protection.pending, loadSummary]);
  const changeTab = (next: FinanceTab) => {
    if (!ownsScope() || !canView) return;
    if (invoiceGuard.current?.().pending) { setNotice("Wait for the current invoice request before changing tabs."); return; }
    setNotice(null); setVisited(current => current.includes(next) ? current : [...current, next]);
    router.push(financeHref({ ...currentBrowse.current, tab: next }), { scroll: false });
  };
  function newInvoice() {
    if (!ownsScope() || !canView || !canManage) return;
    const state = invoiceGuard.current?.();
    if (state?.pending || state?.unknown) { setNotice("The retained invoice draft must be reviewed before starting another."); return; }
    changeTab("invoices"); setCreateRequest(current => current + 1);
  }
  const onRegisterLocationChange = useCallback((location: InvoiceRegisterLocation) => {
    if (!ownsScope()) return;
    const next = { ...currentBrowse.current, invoice_search: location.filters.search, invoice_status: location.filters.status, invoice_currency: location.filters.currency, invoice_balance: location.filters.balance, invoice_cursor: location.cursor || "" };
    currentBrowse.current = next;
    router.replace(financeHref(next), { scroll: false });
  }, [ownsScope, router]);
  if (!canView) return <main className="p-6"><h1 className="text-2xl font-semibold">Finance information is restricted</h1><p className="mt-3 text-neutral-600">Finance viewing permission is required to verify company records. No financial totals or empty history are inferred.</p></main>;
  const registerLocation: InvoiceRegisterLocation = { filters: { search: browse.invoice_search, status: browse.invoice_status, currency: browse.invoice_currency, balance: browse.invoice_balance as InvoiceRegisterLocation["filters"]["balance"] }, cursor: browse.invoice_cursor || null };
  const metrics = summary ? [["Invoices", summary.invoice_count], ["Draft", summary.draft_count], ["Open invoices", financeOpenCount(summary)], ["Paid invoices", summary.paid_count], ["Confirmed payments", summary.payment_count], ["Active accounts", summary.account_count]] as const : [];
  return <div className="bg-white text-neutral-950">
    <header className="mx-auto max-w-[1500px] space-y-5 px-4 pt-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Invoices, payments and accounts</p><h1 className="mt-2 text-3xl font-semibold">Finance</h1><p className="mt-2 text-sm text-neutral-600">One company-wide overview, with distinct invoice, receipt and account records.</p></div><div className="flex flex-wrap gap-2"><button type="button" disabled={summaryLoading} onClick={() => void loadSummary()} className="rounded-xl border px-4 py-2 text-sm disabled:opacity-50">Refresh overview</button>{canManage ? <><a aria-disabled={pending} tabIndex={pending ? -1 : undefined} onClick={event => { if (invoiceGuard.current?.().pending) event.preventDefault(); }} href={accountCreateHref(financeHref({ ...browse, tab: "accounts" }))} className="rounded-xl border px-4 py-2 text-sm">Add account</a><button type="button" disabled={pending || protection.unknown} onClick={newInvoice} className="rounded-xl bg-neutral-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">New invoice</button></> : null}</div></div>
      <section aria-label="Company-wide finance overview">{summaryLoading ? <p role="status" className="rounded-xl border p-4">Loading company-wide totals…</p> : summaryError ? <div role="alert" className="rounded-xl border p-4"><p>{summaryError}</p><button className="mt-3 rounded-lg bg-neutral-950 px-4 py-2 text-sm text-white" onClick={() => void loadSummary()}>Retry overview read</button></div> : summary ? <><dl className="grid grid-cols-2 gap-3 lg:grid-cols-6">{metrics.map(([label, value]) => <div key={label} className="rounded-xl border p-4"><dt className="text-xs text-neutral-500">{label}</dt><dd className="mt-2 text-2xl font-semibold">{value}</dd>{label === "Open invoices" ? <dd className="mt-2 text-xs text-neutral-600">Overdue: {summary.overdue_count} · included subset, not added again</dd> : null}</div>)}</dl><div className="mt-4 rounded-xl border p-4"><h2 className="font-semibold">Recorded invoice amounts by currency</h2><p className="mt-1 text-xs text-neutral-500">Non-cancelled invoices, including drafts. These are not revenue totals. Different currencies are never combined.</p><div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{summary.by_currency.map(row => <dl key={row.currency} className="rounded-xl bg-neutral-50 p-3 text-sm"><dt className="font-semibold">{row.currency}</dt><dd>Invoiced {formatMoneyExact(row.invoiced, row.currency)}</dd><dd>Paid {formatMoneyExact(row.paid, row.currency)}</dd><dd>Outstanding {formatMoneyExact(row.outstanding, row.currency)}</dd></dl>)}</div></div></> : <p role="status">Company-wide totals are not yet verified.</p>}</section>
      {notice ? <p role="status" className="rounded-xl border p-3 text-sm">{notice}</p> : null}
      {protection.pending || protection.unknown || protection.open ? <div role="status" className="rounded-xl border border-neutral-300 bg-neutral-50 p-4 text-sm"><strong>{protection.pending ? "Invoice request in progress" : protection.unknown ? "Invoice creation outcome unknown" : "Invoice draft retained"}</strong><p className="mt-1">{protection.pending ? "Stay in the invoice workspace until the current request settles. Tab changes are blocked." : protection.unknown ? "The draft remains frozen in this tab. Do not create a replacement solely because a read is unavailable. Reloading loses this document-only protection." : "Your open invoice draft is retained while viewing another Finance tab."}</p>{tab !== "invoices" ? <button type="button" className="mt-2 font-semibold underline" onClick={() => changeTab("invoices")}>Return to retained invoice</button> : null}</div> : null}
      <nav aria-label="Finance sections" className="flex gap-2 overflow-x-auto rounded-xl border p-2">{(["invoices", "payments", "accounts"] as FinanceTab[]).map(value => <button type="button" key={value} disabled={pending && value !== tab} aria-current={tab === value ? "page" : undefined} onClick={() => changeTab(value)} className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold capitalize disabled:opacity-50 ${tab === value ? "bg-neutral-950 text-white" : "bg-white text-neutral-600"}`}>{value}</button>)}</nav>
    </header>
    <div hidden={tab !== "invoices"}>{visited.includes("invoices") || tab === "invoices" ? <InvoicesWorkspaceV2 requestedClientId={browse.client_id || null} returnHref={financeHref({ ...browse, tab: "invoices" })} registerLocation={registerLocation} onRegisterLocationChange={onRegisterLocationChange} initialSource="order" createRequest={createRequest} onProtectionChange={onProtectionChange} registerProtectionGuard={registerProtectionGuard} /> : null}</div>
    <div hidden={tab !== "payments"}>{visited.includes("payments") || tab === "payments" ? <MoneyInWorkspace /> : null}</div>
    <div hidden={tab !== "accounts"}>{visited.includes("accounts") || tab === "accounts" ? <AccountsWorkspace /> : null}</div>
  </div>;
}
