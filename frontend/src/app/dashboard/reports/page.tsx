"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarDays, CircleDollarSign, Loader2, RefreshCw, Users, FolderKanban } from "lucide-react";
import { useRouter } from "next/navigation";
import { SearchableSelect } from "@/components/searchable-select";

type FinancialRow = { currency: string; invoiced_revenue: string; collected_revenue: string; receivables: string; expenses: string; platform_fees: string; transfer_fees: string; net_profit: string };
type TrendRow = { period: string; currency: string; invoiced_revenue: string; collected_revenue: string; expenses: string; transfer_fees: string; net_profit: string };
type AccountRow = { account_id: string; account_name: string; account_type: string; currency: string; balance: string };
type ProjectRow = { project_id: string; project_number: string; project_name: string; client_name: string; currency: string; contract_value: string; invoiced_revenue: string; collected_revenue: string; direct_expenses: string; estimated_profit: string; margin_percent: string | null };
type ClientRow = { client_id: string; client_name: string; currency: string; invoiced_revenue: string; collected_revenue: string; direct_expenses: string; estimated_profit: string; margin_percent: string | null };
type Overview = { date_from: string; date_to: string; financials: FinancialRow[]; trend: TrendRow[]; accounts: AccountRow[]; operations: { active_clients: number; open_orders: number; active_projects: number; overdue_tasks: number; due_followups: number; open_invoices: number }; projects: ProjectRow[]; clients: ClientRow[] };
type Meta = { currencies: string[]; clients: { id: string; label: string }[]; projects: { id: string; label: string }[] };
type Filters = { date_from:string; date_to:string; currency:string; client_id:string; project_id:string };

function monthStart() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; }
function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function money(value: string | number, currency: string) { return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function pct(value: string | null) { return value == null ? "—" : `${Number(value).toFixed(2)}%`; }
const initialFilters = ():Filters => ({date_from:monthStart(),date_to:today(),currency:"",client_id:"",project_id:""});

export default function ReportsPage() {
  const router = useRouter();
  const [meta, setMeta] = useState<Meta>({ currencies: [], clients: [], projects: [] });
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [applied, setApplied] = useState<Filters>(initialFilters);

  const api = useCallback(async (path: string) => {
    const response = await fetch(`/api/reports${path}`, { cache: "no-store" });
    if (response.status === 401) { router.replace("/login"); throw new Error("Authentication required"); }
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.detail ?? "Unable to load reports");
    return payload;
  }, [router]);

  const loadOverview = useCallback(async (next:Filters, first=false) => {
    first ? setLoading(true) : setRefreshing(true); setError(null);
    try {
      const params = new URLSearchParams(); Object.entries(next).forEach(([key,value])=>{if(value)params.set(key,value)});
      setData(await api(`/overview?${params.toString()}`) as Overview);
    } catch(reason) { setError(reason instanceof Error ? reason.message : "Unable to load reports"); }
    finally { setLoading(false); setRefreshing(false); }
  },[api]);

  useEffect(() => { void (async()=>{
    try { const [overview, reportMeta] = await Promise.all([api(`/overview?date_from=${applied.date_from}&date_to=${applied.date_to}`), api("/meta")]); setData(overview as Overview); setMeta(reportMeta as Meta); }
    catch(reason){setError(reason instanceof Error?reason.message:"Unable to load reports");}
    finally{setLoading(false);}
  })(); // metadata is intentionally loaded once; filter edits must not refetch it
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[api]);

  function applyFilters(){ setApplied(filters); void loadOverview(filters); }
  function resetFilters(){ const next=initialFilters(); setFilters(next); setApplied(next); void loadOverview(next); }

  const selectedCurrency = applied.currency || (data?.financials.length === 1 ? data.financials[0].currency : "");
  const visibleFinancials = useMemo(() => selectedCurrency ? data?.financials.filter((row) => row.currency === selectedCurrency) ?? [] : data?.financials ?? [], [data, selectedCurrency]);
  const maxTrend = useMemo(() => Math.max(1, ...(data?.trend.map((row) => Math.max(Number(row.invoiced_revenue), Number(row.expenses), Number(row.collected_revenue))) ?? [1])), [data]);
  const dirty = JSON.stringify(filters)!==JSON.stringify(applied);

  return <main className="min-h-screen bg-neutral-100 p-5 sm:p-7 lg:p-9"><div className="mx-auto max-w-[1600px]">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-sm text-neutral-500">Business intelligence</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Reports</h1><p className="mt-2 max-w-3xl text-sm text-neutral-500">Revenue, collection, expenses, receivables and profitability — without combining currencies implicitly.</p></div><button disabled={refreshing} onClick={()=>void loadOverview(applied)} className="inline-flex items-center justify-center gap-2 rounded-xl border bg-white px-4 py-2.5 text-sm font-semibold disabled:opacity-50"><RefreshCw className={`size-4 ${refreshing?"animate-spin":""}`}/>Refresh</button></div>

    <section className="mt-6 rounded-2xl border bg-white p-4 shadow-sm"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Filter label="From"><input type="date" value={filters.date_from} onChange={e=>setFilters(f=>({...f,date_from:e.target.value}))} className="h-11 w-full rounded-xl border px-3 text-sm"/></Filter>
      <Filter label="To"><input type="date" value={filters.date_to} onChange={e=>setFilters(f=>({...f,date_to:e.target.value}))} className="h-11 w-full rounded-xl border px-3 text-sm"/></Filter>
      <SearchableSelect label="Currency" name="currency" value={filters.currency} onValueChange={v=>setFilters(f=>({...f,currency:v}))} placeholder="All separately" options={[{value:"",label:"All separately"},...meta.currencies.map(v=>({value:v,label:v}))]}/>
      <SearchableSelect label="Client" name="client_id" value={filters.client_id} onValueChange={v=>setFilters(f=>({...f,client_id:v,project_id:""}))} placeholder="All clients" searchPlaceholder="Search clients..." options={[{value:"",label:"All clients"},...meta.clients.map(v=>({value:v.id,label:v.label}))]}/>
      <SearchableSelect label="Project" name="project_id" value={filters.project_id} onValueChange={v=>setFilters(f=>({...f,project_id:v}))} placeholder="All projects" searchPlaceholder="Search projects..." options={[{value:"",label:"All projects"},...meta.projects.map(v=>({value:v.id,label:v.label}))]}/>
    </div><div className="mt-4 flex items-center justify-end gap-2 border-t pt-4"><button onClick={resetFilters} className="rounded-xl border px-4 py-2.5 text-sm font-semibold">Reset</button><button disabled={!dirty||refreshing} onClick={applyFilters} className="rounded-xl bg-neutral-950 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Apply filters</button></div></section>

    {error?<div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>:null}
    {loading&&!data?<div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="size-7 animate-spin text-neutral-400"/></div>:null}
    {data?<><div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-6"><Metric label="Active clients" value={String(data.operations.active_clients)} icon={Users}/><Metric label="Open orders" value={String(data.operations.open_orders)} icon={CircleDollarSign}/><Metric label="Active projects" value={String(data.operations.active_projects)} icon={FolderKanban}/><Metric label="Overdue tasks" value={String(data.operations.overdue_tasks)} tone={data.operations.overdue_tasks?"danger":"normal"}/><Metric label="Due follow-ups" value={String(data.operations.due_followups)} tone={data.operations.due_followups?"warn":"normal"}/><Metric label="Open invoices" value={String(data.operations.open_invoices)}/></div>
    <div className="mt-5 grid gap-4 xl:grid-cols-2">{visibleFinancials.length?visibleFinancials.map(row=><section key={row.currency} className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><p className="text-sm text-neutral-500">Financial performance</p><h2 className="mt-1 text-xl font-semibold">{row.currency}</h2></div><CircleDollarSign className="size-6 text-neutral-300"/></div><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><MoneyMetric label="Invoiced" value={money(row.invoiced_revenue,row.currency)}/><MoneyMetric label="Collected" value={money(row.collected_revenue,row.currency)}/><MoneyMetric label="Receivable" value={money(row.receivables,row.currency)}/><MoneyMetric label="Net profit" value={money(row.net_profit,row.currency)} emphasis/><MoneyMetric label="Expenses" value={money(row.expenses,row.currency)}/><MoneyMetric label="Platform fees" value={money(row.platform_fees,row.currency)}/><MoneyMetric label="Transfer fees" value={money(row.transfer_fees,row.currency)}/></div></section>):<section className="rounded-2xl border bg-white p-6 text-sm text-neutral-500">No financial activity exists for the selected period.</section>}<section className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-sm text-neutral-500">Current position</p><h2 className="mt-1 text-xl font-semibold">Account balances</h2><div className="mt-4 divide-y">{data.accounts.map(row=><div key={row.account_id} className="flex items-center justify-between gap-4 py-3"><div><p className="font-medium">{row.account_name}</p><p className="text-xs capitalize text-neutral-400">{row.account_type}</p></div><p className="font-semibold">{money(row.balance,row.currency)}</p></div>)}</div></section></div>
    <section className="mt-5 rounded-2xl border bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><BarChart3 className="size-5 text-neutral-400"/><div><h2 className="font-semibold">Monthly trend</h2><p className="text-sm text-neutral-500">Invoiced, collected and expense movement by currency.</p></div></div><div className="mt-5 space-y-4">{data.trend.map(row=><div key={`${row.period}-${row.currency}`} className="grid gap-2 md:grid-cols-[110px_80px_1fr] md:items-center"><div className="text-sm font-medium">{row.period}</div><div className="text-xs font-semibold text-neutral-400">{row.currency}</div><div className="space-y-1"><Bar label="Invoiced" value={Number(row.invoiced_revenue)} max={maxTrend}/><Bar label="Collected" value={Number(row.collected_revenue)} max={maxTrend}/><Bar label="Expenses" value={Number(row.expenses)} max={maxTrend}/></div></div>)}</div></section>
    <div className="mt-5 grid gap-5 xl:grid-cols-2"><DataTable title="Project profitability" headers={["Project","Client","Revenue","Direct cost","Profit","Margin"]} rows={data.projects.map(r=>[<div key={r.project_id}><p className="font-medium">{r.project_number}</p><p className="text-xs text-neutral-400">{r.project_name}</p></div>,r.client_name,money(r.invoiced_revenue,r.currency),money(r.direct_expenses,r.currency),money(r.estimated_profit,r.currency),pct(r.margin_percent)])}/><DataTable title="Client profitability" headers={["Client","Currency","Revenue","Direct cost","Profit","Margin"]} rows={data.clients.map(r=>[r.client_name,r.currency,money(r.invoiced_revenue,r.currency),money(r.direct_expenses,r.currency),money(r.estimated_profit,r.currency),pct(r.margin_percent)])}/></div></>:null}
  </div></main>;
}
function Filter({label,children}:{label:string;children:React.ReactNode}){return <label className="text-xs font-semibold text-neutral-500"><span className="mb-1.5 block">{label}</span>{children}</label>}
function Metric({label,value,icon:Icon,tone="normal"}:{label:string;value:string;icon?:typeof CalendarDays;tone?:"normal"|"warn"|"danger"}){return <article className={`rounded-2xl border bg-white p-4 shadow-sm ${tone==="danger"?"border-red-200":tone==="warn"?"border-amber-200":""}`}><div className="flex items-center justify-between"><p className="text-xs text-neutral-500">{label}</p>{Icon?<Icon className="size-4 text-neutral-300"/>:null}</div><p className="mt-3 text-2xl font-semibold">{value}</p></article>}
function MoneyMetric({label,value,emphasis}:{label:string;value:string;emphasis?:boolean}){return <div className={`rounded-xl p-3 ${emphasis?"bg-neutral-950 text-white":"bg-neutral-50"}`}><p className={`text-xs ${emphasis?"text-neutral-300":"text-neutral-400"}`}>{label}</p><p className="mt-2 text-sm font-semibold">{value}</p></div>}
function Bar({label,value,max}:{label:string;value:number;max:number}){return <div className="grid grid-cols-[70px_1fr_100px] items-center gap-2 text-xs"><span className="text-neutral-400">{label}</span><div className="h-2 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-neutral-800" style={{width:`${Math.max(1,Math.min(100,(value/max)*100))}%`}}/></div><span className="text-right font-medium">{value.toLocaleString()}</span></div>}
function DataTable({title,headers,rows}:{title:string;headers:string[];rows:React.ReactNode[][]}){return <section className="overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="border-b p-5"><h2 className="font-semibold">{title}</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b text-xs uppercase text-neutral-400"><tr>{headers.map(h=><th key={h} className="p-3">{h}</th>)}</tr></thead><tbody className="divide-y">{rows.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j} className="p-3">{cell}</td>)}</tr>)}</tbody></table>{!rows.length?<div className="p-8 text-center text-sm text-neutral-400">No data for the selected period.</div>:null}</div></section>}
