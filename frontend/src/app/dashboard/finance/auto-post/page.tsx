"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Repeat2, ShieldAlert, Zap } from "lucide-react";
import { useRouter } from "next/navigation";

type Row = {
  id:string; name:string; description:string; category_name:string; vendor_name:string|null;
  account_name:string; account_currency:string; expense_currency:string; expense_amount:string;
  frequency:string; interval_count:number; next_due_date:string; is_active:boolean; auto_post:boolean;
  eligible:boolean; eligibility_reason:string|null; last_attempt_at:string|null; last_error:string|null;
};

function money(amount:string,currency:string){return `${currency} ${Number(amount).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`}
function pretty(value:string){return value.replaceAll("_"," ").replace(/\b\w/g,m=>m.toUpperCase())}

export default function AutoExpensesPage(){
  const router=useRouter();
  const [rows,setRows]=useState<Row[]>([]); const [loading,setLoading]=useState(true); const [saving,setSaving]=useState<string|null>(null); const [error,setError]=useState<string|null>(null); const [message,setMessage]=useState<string|null>(null);
  const api=useCallback(async(path:string,init?:RequestInit)=>{const r=await fetch(`/api/finance-controls/${path}`,init);if(r.status===401){router.replace('/login');throw new Error('Authentication required')}const d=await r.json().catch(()=>null);if(!r.ok)throw new Error(d?.detail??'Auto Post request failed');return d},[router]);
  const load=useCallback(async()=>{setLoading(true);setError(null);try{setRows(await api('recurring-auto-post') as Row[])}catch(e){setError(e instanceof Error?e.message:'Unable to load Auto Expenses')}finally{setLoading(false)}},[api]);
  useEffect(()=>{void load()},[load]);
  async function toggle(row:Row){setSaving(row.id);setError(null);setMessage(null);try{const updated=await api(`recurring-auto-post/${row.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:!row.auto_post})}) as Row;setRows(current=>current.map(item=>item.id===row.id?updated:item));setMessage(`Auto Post ${updated.auto_post?'enabled':'disabled'} for ${updated.name}.`)}catch(e){setError(e instanceof Error?e.message:'Unable to update Auto Post')}finally{setSaving(null)}}
  if(loading)return <main className="flex min-h-[70vh] items-center justify-center"><Loader2 className="size-7 animate-spin text-neutral-400"/></main>;
  return <main className="min-h-screen bg-neutral-100 p-5 sm:p-8 lg:p-10"><div className="mx-auto max-w-[1400px]">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm text-neutral-500">Automatic fixed recurring costs</p><h1 className="mt-1 text-3xl font-semibold">Auto Expenses</h1><p className="mt-2 max-w-3xl text-sm text-neutral-500">Enable Auto Post for predictable same-currency costs such as office rent, VPS and fixed subscriptions. Cross-currency or variable charges stay Manual Post for accounting accuracy.</p></div><button onClick={()=>void load()} className="rounded-xl border bg-white px-4 py-2.5 text-sm font-semibold"><RefreshCw className="mr-2 inline size-4"/>Refresh</button></header>
    {error?<p className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>:null}{message?<p className="mt-5 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>:null}
    <section className="mt-6 overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="border-b p-5"><h2 className="font-semibold">Recurring schedules</h2><p className="mt-1 text-sm text-neutral-500">The background finance scheduler checks due schedules every hour.</p></div><div className="divide-y">{rows.map(row=><div key={row.id} className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{row.name}</p><span className={`rounded-full px-2 py-1 text-xs font-semibold ${row.auto_post?'bg-emerald-50 text-emerald-700':'bg-neutral-100 text-neutral-500'}`}>{row.auto_post?'Auto Post ON':'Manual Post'}</span>{!row.eligible?<span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700"><ShieldAlert className="mr-1 inline size-3"/>Manual required</span>:null}</div><p className="mt-1 text-sm text-neutral-500">{row.description}</p><p className="mt-2 text-xs text-neutral-400">{row.category_name} · {row.account_name} · {pretty(row.frequency)} every {row.interval_count} · Next {row.next_due_date}</p>{row.eligibility_reason?<p className="mt-2 text-xs text-amber-700">{row.eligibility_reason}</p>:null}{row.last_error?<p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">Last Auto Post failed: {row.last_error}</p>:null}{row.last_attempt_at?<p className="mt-1 text-xs text-neutral-400">Last attempt: {new Date(row.last_attempt_at).toLocaleString()}</p>:null}</div><div className="flex shrink-0 items-center gap-3"><div className="text-right"><p className="font-semibold">{money(row.expense_amount,row.expense_currency)}</p><p className="text-xs text-neutral-400">{row.vendor_name??'No vendor'}</p></div><button disabled={saving===row.id||(!row.eligible&&!row.auto_post)||!row.is_active} onClick={()=>void toggle(row)} className={`min-w-28 rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-40 ${row.auto_post?'border bg-white':'bg-neutral-950 text-white'}`}>{saving===row.id?<Loader2 className="mx-auto size-4 animate-spin"/>:row.auto_post?'Turn off':<><Zap className="mr-1 inline size-4"/>Enable</>}</button></div></div>)}{rows.length===0?<div className="p-12 text-center text-sm text-neutral-400"><Repeat2 className="mx-auto mb-3 size-6"/>Create a recurring expense first in Finance Controls.</div>:null}</div></section>
  </div></main>
}
