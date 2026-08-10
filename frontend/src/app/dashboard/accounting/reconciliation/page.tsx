"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, RefreshCw, Scale, WalletCards } from "lucide-react";

import { AccountingNav } from "@/components/accounting-nav";

type Account = { id:string; name:string; account_type:string; currency:string; last_reconciled_date?:string|null; last_statement_balance?:string|null };
type Meta = { accounts:Account[] };
type Session = { id:string; account_id:string; account_name:string; currency:string; statement_start_date?:string|null; statement_end_date:string; statement_ending_balance:string; cleared_book_balance:string; difference:string; status:string; matched_transactions:number; notes?:string|null; finalized_at?:string|null };
type Tx = { id:string; transaction_date:string; direction:string; amount:string; currency:string; source_type:string; reference?:string|null; description?:string|null; selected:boolean };
type Detail = Session & { transactions:Tx[]; unmatched_count:number };

async function api<T>(url:string, init?:RequestInit):Promise<T>{
  const response=await fetch(url,{cache:"no-store",...init,headers:{"Content-Type":"application/json",...(init?.headers||{})}});
  const body=response.status===204?null:await response.json().catch(()=>null);
  if(!response.ok) throw new Error(body?.detail||"Request failed");
  return body as T;
}
function money(value:string|number,currency:string){return `${currency} ${Number(value||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`}

export default function ReconciliationPage(){
  const[meta,setMeta]=useState<Meta>({accounts:[]}); const[sessions,setSessions]=useState<Session[]>([]); const[selected,setSelected]=useState<Detail|null>(null);
  const[loading,setLoading]=useState(true); const[busy,setBusy]=useState(false); const[error,setError]=useState<string|null>(null); const[success,setSuccess]=useState<string|null>(null);
  const[accountId,setAccountId]=useState(""); const[endDate,setEndDate]=useState(""); const[statementBalance,setStatementBalance]=useState(""); const[notes,setNotes]=useState("");

  const load=useCallback(async()=>{setLoading(true);setError(null);try{const[m,s]=await Promise.all([api<Meta>("/api/accounting/reconciliations/meta"),api<Session[]>("/api/accounting/reconciliations")]);setMeta(m);setSessions(s);if(!accountId&&m.accounts.length)setAccountId(m.accounts[0].id);}catch(e){setError(e instanceof Error?e.message:"Could not load reconciliation")}finally{setLoading(false)}},[accountId]);
  useEffect(()=>{void load()},[load]);
  async function open(id:string){setBusy(true);setError(null);try{setSelected(await api<Detail>(`/api/accounting/reconciliations/${id}`))}catch(e){setError(e instanceof Error?e.message:"Could not open reconciliation")}finally{setBusy(false)}}
  async function create(e:FormEvent){e.preventDefault();setBusy(true);setError(null);setSuccess(null);try{const row=await api<Session>("/api/accounting/reconciliations",{method:"POST",body:JSON.stringify({account_id:accountId,statement_end_date:endDate,statement_ending_balance:statementBalance,notes:notes||null})});setSuccess("Reconciliation draft created. Match the transactions that appear on the statement.");setEndDate("");setStatementBalance("");setNotes("");await load();await open(row.id)}catch(e){setError(e instanceof Error?e.message:"Could not create reconciliation")}finally{setBusy(false)}}
  async function toggle(tx:Tx){if(!selected||selected.status!=="draft")return;setBusy(true);setError(null);try{await api(tx.selected?`/api/accounting/reconciliations/${selected.id}/transactions/${tx.id}`:`/api/accounting/reconciliations/${selected.id}/transactions/${tx.id}`,{method:tx.selected?"DELETE":"POST"});await open(selected.id);await load()}catch(e){setError(e instanceof Error?e.message:"Could not update matched transaction")}finally{setBusy(false)}}
  async function finalize(){if(!selected)return;setBusy(true);setError(null);setSuccess(null);try{const row=await api<Session>(`/api/accounting/reconciliations/${selected.id}/finalize`,{method:"POST",body:"{}"});setSuccess("Bank reconciliation finalized and locked.");await load();await open(row.id)}catch(e){setError(e instanceof Error?e.message:"Could not finalize reconciliation")}finally{setBusy(false)}}

  const account=useMemo(()=>meta.accounts.find(a=>a.id===accountId),[meta.accounts,accountId]);
  return <main className="p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-7xl space-y-6">
    <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Finance control</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Bank Reconciliation</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">Match Business OS transactions to the real bank, wallet or gateway statement. A reconciliation can only be finalized when the difference is exactly zero.</p></div>
    <AccountingNav />
    {error?<div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>:null}{success?<div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>:null}

    <section className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
      <form onSubmit={create} className="rounded-2xl border bg-white p-5"><div className="flex items-center gap-2"><WalletCards className="size-5"/><h2 className="font-semibold">Start reconciliation</h2></div><p className="mt-1 text-sm text-neutral-500">Enter the ending balance exactly as shown by the statement.</p>
        <div className="mt-5 space-y-4"><label className="block text-sm font-medium">Account<select value={accountId} onChange={e=>setAccountId(e.target.value)} required className="mt-1.5 w-full rounded-xl border px-3 py-2.5 font-normal">{meta.accounts.map(a=><option key={a.id} value={a.id}>{a.name} · {a.currency}</option>)}</select></label>
          {account?.last_reconciled_date?<div className="rounded-xl bg-neutral-50 p-3 text-xs text-neutral-500">Last reconciled through <b className="text-neutral-800">{account.last_reconciled_date}</b>{account.last_statement_balance?` · ${money(account.last_statement_balance,account.currency)}`:""}</div>:null}
          <label className="block text-sm font-medium">Statement end date<input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} required className="mt-1.5 w-full rounded-xl border px-3 py-2.5 font-normal"/></label>
          <label className="block text-sm font-medium">Statement ending balance<input type="number" step="0.01" value={statementBalance} onChange={e=>setStatementBalance(e.target.value)} required className="mt-1.5 w-full rounded-xl border px-3 py-2.5 font-normal" placeholder="0.00"/></label>
          <label className="block text-sm font-medium">Notes<textarea value={notes} onChange={e=>setNotes(e.target.value)} className="mt-1.5 min-h-20 w-full rounded-xl border px-3 py-2.5 font-normal" placeholder="Optional statement reference or note"/></label>
          <button disabled={busy||!accountId} className="w-full rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">Create draft</button></div>
      </form>
      <div className="rounded-2xl border bg-white p-5"><div className="flex items-center justify-between"><div><h2 className="font-semibold">Reconciliation history</h2><p className="mt-1 text-sm text-neutral-500">Draft and finalized statement periods.</p></div><button onClick={()=>void load()} className="rounded-xl border p-2" aria-label="Refresh"><RefreshCw className="size-4"/></button></div>
        <div className="mt-4 divide-y">{sessions.map(row=><button key={row.id} onClick={()=>void open(row.id)} className="flex w-full items-center justify-between gap-4 py-3 text-left"><div><p className="font-medium">{row.account_name}</p><p className="text-xs text-neutral-400">Through {row.statement_end_date} · {row.matched_transactions} matched</p></div><div className="text-right"><p className="text-sm font-medium">{money(row.statement_ending_balance,row.currency)}</p><p className={`text-xs ${row.status==="finalized"?"text-emerald-600":"text-amber-600"}`}>{row.status}</p></div></button>)}{!loading&&sessions.length===0?<p className="py-10 text-center text-sm text-neutral-400">No reconciliation yet.</p>:null}</div>
      </div>
    </section>

    {selected?<section className="rounded-2xl border bg-white"><div className="border-b p-5"><div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between"><div><p className="text-xs uppercase tracking-wider text-neutral-400">{selected.account_name} · through {selected.statement_end_date}</p><h2 className="mt-1 text-xl font-semibold">Statement matching</h2></div><div className="grid grid-cols-3 gap-3 text-right"><Metric label="Statement" value={money(selected.statement_ending_balance,selected.currency)}/><Metric label="Cleared books" value={money(selected.cleared_book_balance,selected.currency)}/><Metric label="Difference" value={money(selected.difference,selected.currency)} strong={Number(selected.difference)===0}/></div></div>
        {selected.status==="draft"?<div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-neutral-50 p-3"><p className="text-sm text-neutral-600">Select every transaction that appears on the statement. Missing bank fees or interest should first be recorded with Money In / Money Out.</p><button disabled={busy||Number(selected.difference)!==0} onClick={()=>void finalize()} className="inline-flex items-center gap-2 rounded-xl bg-neutral-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"><CheckCircle2 className="size-4"/>Finalize</button></div>:<div className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700"><CheckCircle2 className="size-4"/>Finalized and locked</div>}</div>
        <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-sm"><thead className="bg-neutral-50 text-left text-xs uppercase tracking-wider text-neutral-400"><tr><th className="px-5 py-3">Matched</th><th className="px-5 py-3">Date</th><th className="px-5 py-3">Description</th><th className="px-5 py-3">Reference</th><th className="px-5 py-3 text-right">Money out</th><th className="px-5 py-3 text-right">Money in</th></tr></thead><tbody className="divide-y">{selected.transactions.map(tx=><tr key={tx.id} className={tx.selected?"bg-emerald-50/40":""}><td className="px-5 py-3"><input type="checkbox" checked={tx.selected} disabled={busy||selected.status!=="draft"} onChange={()=>void toggle(tx)} className="size-4"/></td><td className="px-5 py-3">{tx.transaction_date}</td><td className="px-5 py-3"><p className="font-medium">{tx.description||tx.source_type.replaceAll("_"," ")}</p><p className="text-xs text-neutral-400">{tx.source_type}</p></td><td className="px-5 py-3 text-neutral-500">{tx.reference||"—"}</td><td className="px-5 py-3 text-right tabular-nums">{tx.direction==="debit"?money(tx.amount,tx.currency):"—"}</td><td className="px-5 py-3 text-right tabular-nums">{tx.direction==="credit"?money(tx.amount,tx.currency):"—"}</td></tr>)}{selected.transactions.length===0?<tr><td colSpan={6} className="px-5 py-12 text-center text-neutral-400">No unreconciled transactions through this statement date.</td></tr>:null}</tbody></table></div>
      </section>:null}
  </div></main>
}
function Metric({label,value,strong=false}:{label:string;value:string;strong?:boolean}){return <div className="min-w-28"><p className="text-xs text-neutral-400">{label}</p><p className={`mt-1 text-sm font-semibold tabular-nums ${strong?"text-emerald-600":""}`}>{value}</p></div>}
