"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, BarChart3, Building2, CircleDollarSign, FolderKanban, Loader2, ReceiptText, Users } from "lucide-react";

type TenantContext = { organization: { id: string; name: string; country_code: string; timezone: string; currency: string }; role: string };
type FinancialRow = { currency: string; invoiced_revenue: string; collected_revenue: string; receivables: string; expenses: string; platform_fees: string; transfer_fees: string; net_profit: string };
type Overview = { date_from: string; date_to: string; financials: FinancialRow[]; accounts: { account_id: string; account_name: string; account_type: string; currency: string; balance: string }[]; operations: { active_clients: number; open_orders: number; active_projects: number; overdue_tasks: number; due_followups: number; open_invoices: number }; projects: { project_id: string; project_number: string; project_name: string; client_name: string; currency: string; estimated_profit: string; margin_percent: string | null }[] };

function monthStart() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; }
function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function money(value: string | number, currency: string) { return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

export default function DashboardPage() {
  const router = useRouter();
  const [tenant, setTenant] = useState<TenantContext | null>(null);
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void (async () => {
    try {
      const tenantResponse = await fetch("/api/tenant", { cache: "no-store" });
      if (tenantResponse.status === 401) { router.replace("/login"); return; }
      if (!tenantResponse.ok) throw new Error("Unable to load company workspace");
      const current = await tenantResponse.json() as TenantContext;
      setTenant(current);
      const params = new URLSearchParams({ date_from: monthStart(), date_to: today() });
      const reportResponse = await fetch(`/api/reports/overview?${params}`, { cache: "no-store" });
      if (reportResponse.ok) setData(await reportResponse.json() as Overview);
      else if (reportResponse.status !== 403) throw new Error("Unable to load dashboard metrics");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load dashboard"); }
    finally { setLoading(false); }
  })(); }, [router]);

  const company = tenant?.organization;
  const primary = useMemo(() => data?.financials.find((row) => row.currency === company?.currency) ?? null, [data, company?.currency]);

  if (loading) return <main className="flex min-h-[70vh] items-center justify-center"><Loader2 className="size-7 animate-spin text-neutral-400"/></main>;
  if (!tenant || !company) return <main className="p-8 text-sm text-red-700">{error ?? "Workspace unavailable"}</main>;

  if (!data) return <main className="min-h-screen bg-neutral-100 p-5 sm:p-8 lg:p-10"><div className="mx-auto max-w-[1500px]"><h1 className="text-3xl font-semibold">{company.name}</h1><div className="mt-6 rounded-2xl border bg-white p-6"><p className="font-semibold">Employee workspace</p><p className="mt-2 text-sm text-neutral-500">Business financial reports are restricted by role permissions. Your project and task workspace remains available from Projects.</p></div></div></main>;

  return <main className="min-h-screen bg-neutral-100 p-5 sm:p-8 lg:p-10">
    <div className="mx-auto max-w-[1500px]">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm text-neutral-500">Business overview · {data.date_from} — {data.date_to}</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">{company.name}</h1></div><Link href="/dashboard/reports" className="inline-flex items-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white"><BarChart3 className="size-4"/>Open reports</Link></header>

      <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card label="Active clients" value={String(data.operations.active_clients)} note="Current client base" icon={Users}/>
        <Card label="Open orders" value={String(data.operations.open_orders)} note="Not completed or cancelled" icon={ReceiptText}/>
        <Card label="Active projects" value={String(data.operations.active_projects)} note="Planned, active or on hold" icon={FolderKanban}/>
        <Card label="Month net profit" value={primary ? money(primary.net_profit, primary.currency) : `${company.currency} 0.00`} note="Invoiced revenue less expenses & transfer fees" icon={CircleDollarSign}/>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
        <section className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between"><div><p className="text-sm text-neutral-500">This month</p><h2 className="mt-1 text-xl font-semibold">Financial snapshot</h2></div><CircleDollarSign className="size-6 text-neutral-300"/></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{primary ? <><Mini label="Invoiced" value={money(primary.invoiced_revenue, primary.currency)}/><Mini label="Collected" value={money(primary.collected_revenue, primary.currency)}/><Mini label="Receivable" value={money(primary.receivables, primary.currency)}/><Mini label="Expenses" value={money(primary.expenses, primary.currency)}/></> : <p className="text-sm text-neutral-400">No {company.currency} financial activity this month.</p>}</div>
          {data.financials.filter((row) => row.currency !== company.currency).length ? <div className="mt-5 border-t pt-4"><p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Other currencies</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{data.financials.filter((row) => row.currency !== company.currency).map((row) => <div key={row.currency} className="flex items-center justify-between rounded-xl bg-neutral-50 px-4 py-3 text-sm"><span className="font-semibold">{row.currency}</span><span>Net {money(row.net_profit, row.currency)}</span></div>)}</div></div> : null}
        </section>

        <section className="rounded-2xl border bg-white p-6 shadow-sm"><p className="text-sm text-neutral-500">Needs attention</p><h2 className="mt-1 text-xl font-semibold">Operations</h2><div className="mt-5 space-y-3"><AlertRow label="Overdue tasks" value={data.operations.overdue_tasks} href="/dashboard/projects"/><AlertRow label="Due follow-ups" value={data.operations.due_followups} href="/dashboard/crm"/><AlertRow label="Open invoices" value={data.operations.open_invoices} href="/dashboard/finance"/></div></section>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <section className="rounded-2xl border bg-white p-6 shadow-sm"><div className="flex items-center justify-between"><h2 className="font-semibold">Account position</h2><Link href="/dashboard/finance" className="text-xs font-semibold text-neutral-500">Finance →</Link></div><div className="mt-4 divide-y">{data.accounts.slice(0, 8).map((row) => <div key={row.account_id} className="flex items-center justify-between py-3 text-sm"><div><p className="font-medium">{row.account_name}</p><p className="text-xs capitalize text-neutral-400">{row.account_type}</p></div><p className="font-semibold">{money(row.balance, row.currency)}</p></div>)}</div></section>
        <section className="rounded-2xl border bg-white p-6 shadow-sm"><div className="flex items-center justify-between"><h2 className="font-semibold">Project profitability</h2><Link href="/dashboard/reports" className="text-xs font-semibold text-neutral-500">Full report →</Link></div><div className="mt-4 divide-y">{data.projects.slice(0, 6).map((row) => <div key={row.project_id} className="flex items-center justify-between gap-4 py-3 text-sm"><div className="min-w-0"><p className="truncate font-medium">{row.project_number} · {row.project_name}</p><p className="truncate text-xs text-neutral-400">{row.client_name}</p></div><div className="shrink-0 text-right"><p className="font-semibold">{money(row.estimated_profit, row.currency)}</p><p className="text-xs text-neutral-400">{row.margin_percent == null ? "—" : `${Number(row.margin_percent).toFixed(1)}% margin`}</p></div></div>)}</div></section>
      </div>
    </div>
  </main>;
}

function Card({ label, value, note, icon: Icon }: { label: string; value: string; note: string; icon: typeof Users }) { return <article className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><p className="text-sm text-neutral-500">{label}</p><Icon className="size-4 text-neutral-300"/></div><p className="mt-4 text-3xl font-semibold tracking-tight">{value}</p><p className="mt-2 text-xs text-neutral-400">{note}</p></article>; }
function Mini({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-neutral-50 p-4"><p className="text-xs text-neutral-400">{label}</p><p className="mt-2 font-semibold">{value}</p></div>; }
function AlertRow({ label, value, href }: { label: string; value: number; href: string }) { return <Link href={href} className="flex items-center justify-between rounded-xl border px-4 py-3 hover:bg-neutral-50"><div className="flex items-center gap-3"><AlertTriangle className={`size-4 ${value ? "text-amber-500" : "text-neutral-300"}`}/><span className="text-sm font-medium">{label}</span></div><div className="flex items-center gap-2"><span className="text-sm font-semibold">{value}</span><ArrowRight className="size-3.5 text-neutral-300"/></div></Link>; }
