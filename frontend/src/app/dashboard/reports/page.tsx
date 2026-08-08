"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarDays, CircleDollarSign, Loader2, RefreshCw, Users, FolderKanban } from "lucide-react";
import { useRouter } from "next/navigation";

type FinancialRow = { currency: string; invoiced_revenue: string; collected_revenue: string; receivables: string; expenses: string; platform_fees: string; transfer_fees: string; net_profit: string };
type TrendRow = { period: string; currency: string; invoiced_revenue: string; collected_revenue: string; expenses: string; transfer_fees: string; net_profit: string };
type AccountRow = { account_id: string; account_name: string; account_type: string; currency: string; balance: string };
type ProjectRow = { project_id: string; project_number: string; project_name: string; client_name: string; currency: string; contract_value: string; invoiced_revenue: string; collected_revenue: string; direct_expenses: string; estimated_profit: string; margin_percent: string | null };
type ClientRow = { client_id: string; client_name: string; currency: string; invoiced_revenue: string; collected_revenue: string; direct_expenses: string; estimated_profit: string; margin_percent: string | null };
type Overview = { date_from: string; date_to: string; financials: FinancialRow[]; trend: TrendRow[]; accounts: AccountRow[]; operations: { active_clients: number; open_orders: number; active_projects: number; overdue_tasks: number; due_followups: number; open_invoices: number }; projects: ProjectRow[]; clients: ClientRow[] };
type Meta = { currencies: string[]; clients: { id: string; label: string }[]; projects: { id: string; label: string }[] };

function monthStart() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; }
function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function money(value: string | number, currency: string) { return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function pct(value: string | null) { return value == null ? "—" : `${Number(value).toFixed(2)}%`; }

export default function ReportsPage() {
  const router = useRouter();
  const [meta, setMeta] = useState<Meta>({ currencies: [], clients: [], projects: [] });
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ date_from: monthStart(), date_to: today(), currency: "", client_id: "", project_id: "" });

  const api = useCallback(async (path: string) => {
    const response = await fetch(`/api/reports${path}`, { cache: "no-store" });
    if (response.status === 401) { router.replace("/login"); throw new Error("Authentication required"); }
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.detail ?? "Unable to load reports");
    return payload;
  }, [router]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
      const [overview, reportMeta] = await Promise.all([api(`/overview?${params.toString()}`), api("/meta")]);
      setData(overview as Overview); setMeta(reportMeta as Meta);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load reports"); }
    finally { setLoading(false); }
  }, [api, filters]);

  useEffect(() => { void load(); }, [load]);

  const selectedCurrency = filters.currency || (data?.financials.length === 1 ? data.financials[0].currency : "");
  const visibleFinancials = useMemo(() => selectedCurrency ? data?.financials.filter((row) => row.currency === selectedCurrency) ?? [] : data?.financials ?? [], [data, selectedCurrency]);
  const maxTrend = useMemo(() => Math.max(1, ...(data?.trend.map((row) => Math.max(Number(row.invoiced_revenue), Number(row.expenses), Number(row.collected_revenue))) ?? [1])), [data]);

  return <main className="min-h-screen bg-neutral-100 p-5 sm:p-7 lg:p-9">
    <div className="mx-auto max-w-[1600px]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><p className="text-sm text-neutral-500">Business intelligence</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Reports</h1><p className="mt-2 max-w-3xl text-sm text-neutral-500">Revenue, cash collection, expenses, receivables and profitability stay currency-safe. No currencies are combined without an FX reporting layer.</p></div>
        <button onClick={() => void load()} className="inline-flex items-center justify-center gap-2 rounded-xl border bg-white px-4 py-2.5 text-sm font-semibold"><RefreshCw className="size-4"/>Refresh</button>
      </div>

      <section className="mt-6 grid gap-3 rounded-2xl border bg-white p-4 shadow-sm sm:grid-cols-2 xl:grid-cols-5">
        <Filter label="From"><input type="date" value={filters.date_from} onChange={(e) => setFilters((f) => ({ ...f, date_from: e.target.value }))} className="h-10 w-full rounded-lg border px-3"/></Filter>
        <Filter label="To"><input type="date" value={filters.date_to} onChange={(e) => setFilters((f) => ({ ...f, date_to: e.target.value }))} className="h-10 w-full rounded-lg border px-3"/></Filter>
        <Filter label="Currency"><select value={filters.currency} onChange={(e) => setFilters((f) => ({ ...f, currency: e.target.value }))} className="h-10 w-full rounded-lg border px-3"><option value="">All separately</option>{meta.currencies.map((v) => <option key={v} value={v}>{v}</option>)}</select></Filter>
        <Filter label="Client"><select value={filters.client_id} onChange={(e) => setFilters((f) => ({ ...f, client_id: e.target.value, project_id: "" }))} className="h-10 w-full rounded-lg border px-3"><option value="">All clients</option>{meta.clients.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select></Filter>
        <Filter label="Project"><select value={filters.project_id} onChange={(e) => setFilters((f) => ({ ...f, project_id: e.target.value }))} className="h-10 w-full rounded-lg border px-3"><option value="">All projects</option>{meta.projects.filter((p) => !filters.client_id || data?.projects.some((r) => r.project_id === p.id)).map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select></Filter>
      </section>

      {error ? <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {loading && !data ? <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="size-7 animate-spin text-neutral-400"/></div> : null}

      {data ? <>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
          <Metric label="Active clients" value={String(data.operations.active_clients)} icon={Users}/>
          <Metric label="Open orders" value={String(data.operations.open_orders)} icon={CircleDollarSign}/>
          <Metric label="Active projects" value={String(data.operations.active_projects)} icon={FolderKanban}/>
          <Metric label="Overdue tasks" value={String(data.operations.overdue_tasks)} tone={data.operations.overdue_tasks ? "danger" : "normal"}/>
          <Metric label="Due follow-ups" value={String(data.operations.due_followups)} tone={data.operations.due_followups ? "warn" : "normal"}/>
          <Metric label="Open invoices" value={String(data.operations.open_invoices)}/>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          {visibleFinancials.length ? visibleFinancials.map((row) => <section key={row.currency} className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between"><div><p className="text-sm text-neutral-500">Financial performance</p><h2 className="mt-1 text-xl font-semibold">{row.currency}</h2></div><CircleDollarSign className="size-6 text-neutral-300"/></div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MoneyMetric label="Invoiced" value={money(row.invoiced_revenue, row.currency)}/><MoneyMetric label="Collected" value={money(row.collected_revenue, row.currency)}/><MoneyMetric label="Receivable" value={money(row.receivables, row.currency)}/><MoneyMetric label="Net profit" value={money(row.net_profit, row.currency)} emphasis/>
              <MoneyMetric label="Expenses" value={money(row.expenses, row.currency)}/><MoneyMetric label="Platform fees" value={money(row.platform_fees, row.currency)}/><MoneyMetric label="Transfer fees" value={money(row.transfer_fees, row.currency)}/>
            </div>
          </section>) : <section className="rounded-2xl border bg-white p-6 text-sm text-neutral-500">No financial activity exists for the selected period.</section>}

          <section className="rounded-2xl border bg-white p-5 shadow-sm">
            <div><p className="text-sm text-neutral-500">Current position</p><h2 className="mt-1 text-xl font-semibold">Account balances</h2></div>
            <div className="mt-4 divide-y">{data.accounts.map((row) => <div key={row.account_id} className="flex items-center justify-between gap-4 py-3"><div><p className="font-medium">{row.account_name}</p><p className="text-xs capitalize text-neutral-400">{row.account_type}</p></div><p className="font-semibold">{money(row.balance, row.currency)}</p></div>)}</div>
          </section>
        </div>

        <section className="mt-5 rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2"><BarChart3 className="size-5 text-neutral-400"/><div><h2 className="font-semibold">Monthly trend</h2><p className="text-sm text-neutral-500">Invoiced, collected and expense movement by currency.</p></div></div>
          <div className="mt-5 space-y-4">{data.trend.map((row) => <div key={`${row.period}-${row.currency}`} className="grid gap-2 md:grid-cols-[110px_80px_1fr] md:items-center"><div className="text-sm font-medium">{row.period}</div><div className="text-xs font-semibold text-neutral-400">{row.currency}</div><div className="space-y-1"><Bar label="Invoiced" value={Number(row.invoiced_revenue)} max={maxTrend}/><Bar label="Collected" value={Number(row.collected_revenue)} max={maxTrend}/><Bar label="Expenses" value={Number(row.expenses)} max={maxTrend}/></div></div>)}</div>
        </section>

        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          <DataTable title="Project profitability" headers={["Project", "Client", "Revenue", "Direct cost", "Profit", "Margin"]} rows={data.projects.map((r) => [<div key={r.project_id}><p className="font-medium">{r.project_number}</p><p className="text-xs text-neutral-400">{r.project_name}</p></div>, r.client_name, money(r.invoiced_revenue, r.currency), money(r.direct_expenses, r.currency), money(r.estimated_profit, r.currency), pct(r.margin_percent)])}/>
          <DataTable title="Client profitability" headers={["Client", "Currency", "Revenue", "Direct cost", "Profit", "Margin"]} rows={data.clients.map((r) => [r.client_name, r.currency, money(r.invoiced_revenue, r.currency), money(r.direct_expenses, r.currency), money(r.estimated_profit, r.currency), pct(r.margin_percent)])}/>
        </div>
      </> : null}
    </div>
  </main>;
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) { return <label className="text-xs font-semibold text-neutral-500"><span className="mb-1.5 block">{label}</span>{children}</label>; }
function Metric({ label, value, icon: Icon, tone = "normal" }: { label: string; value: string; icon?: typeof CalendarDays; tone?: "normal" | "warn" | "danger" }) { return <article className={`rounded-2xl border bg-white p-4 shadow-sm ${tone === "danger" ? "border-red-200" : tone === "warn" ? "border-amber-200" : ""}`}><div className="flex items-center justify-between"><p className="text-xs text-neutral-500">{label}</p>{Icon ? <Icon className="size-4 text-neutral-300"/> : null}</div><p className="mt-3 text-2xl font-semibold">{value}</p></article>; }
function MoneyMetric({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) { return <div className={`rounded-xl p-3 ${emphasis ? "bg-neutral-950 text-white" : "bg-neutral-50"}`}><p className={`text-xs ${emphasis ? "text-neutral-300" : "text-neutral-400"}`}>{label}</p><p className="mt-2 text-sm font-semibold">{value}</p></div>; }
function Bar({ label, value, max }: { label: string; value: number; max: number }) { return <div className="grid grid-cols-[70px_1fr_100px] items-center gap-2 text-xs"><span className="text-neutral-400">{label}</span><div className="h-2 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-neutral-800" style={{ width: `${Math.max(1, Math.min(100, (value / max) * 100))}%` }}/></div><span className="text-right font-medium">{value.toLocaleString()}</span></div>; }
function DataTable({ title, headers, rows }: { title: string; headers: string[]; rows: React.ReactNode[][] }) { return <section className="overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="border-b p-5"><h2 className="font-semibold">{title}</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b text-xs uppercase text-neutral-400"><tr>{headers.map((h) => <th key={h} className="p-3">{h}</th>)}</tr></thead><tbody className="divide-y">{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} className="p-3">{cell}</td>)}</tr>)}</tbody></table>{!rows.length ? <div className="p-8 text-center text-sm text-neutral-400">No data for the selected period.</div> : null}</div></section>; }
