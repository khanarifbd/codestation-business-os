"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, FileText, FolderKanban, ReceiptText, ShoppingBag } from "lucide-react";

import { AccountingNav } from "@/components/accounting-nav";

type SourceType = "invoice" | "project" | "order" | "other";
type Account = { id:string; name:string; account_type:string; currency:string; current_balance:string|number; is_active:boolean };
type Invoice = { id:string; invoice_number:string; client_name:string; order_id:string|null; project_id:string|null; status:string; display_status:string; currency:string; total:string|number; balance_due:string|number; subject:string|null };
type Project = { id:string; number:string; order_id:string; client_id:string; name:string; currency:string; contract_value:string|number; status:string };
type Order = { id:string; number:string; client_id:string; client_name:string; currency:string; total:string|number; status:string };
type Meta = { orders:Order[]; projects:Project[]; accounts:Account[] };
type LedgerAccount = { id:string; name:string; category:string; is_active:boolean };
type MoneyEntry = { id:string; entry_date:string; financial_account_name:string; category_ledger_account_name:string; currency:string; amount:string|number; description:string; reference:string|null };

function today(){return new Date().toISOString().slice(0,10)}
function money(value:string|number,currency:string){return `${currency} ${Number(value||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`}

const sourceCards = [
  { value:"invoice" as SourceType, title:"Invoice payment", help:"Customer paid an invoice", icon:FileText },
  { value:"project" as SourceType, title:"Project payment", help:"Money received for a project", icon:FolderKanban },
  { value:"order" as SourceType, title:"Order payment", help:"Money received against an order", icon:ShoppingBag },
  { value:"other" as SourceType, title:"Other income", help:"Income not tied to an invoice, project or order", icon:ReceiptText },
];

export function MoneyInWorkspace(){
  const[sourceType,setSourceType]=useState<SourceType>("invoice");
  const[accounts,setAccounts]=useState<Account[]>([]);const[invoices,setInvoices]=useState<Invoice[]>([]);const[projects,setProjects]=useState<Project[]>([]);const[orders,setOrders]=useState<Order[]>([]);const[categories,setCategories]=useState<LedgerAccount[]>([]);const[entries,setEntries]=useState<MoneyEntry[]>([]);
  const[loading,setLoading]=useState(true);const[saving,setSaving]=useState(false);const[error,setError]=useState<string|null>(null);const[message,setMessage]=useState<string|null>(null);
  const[form,setForm]=useState({source_id:"",account_id:"",amount:"",date:today(),method:"bank_transfer",category_id:"",description:"",reference:"",notes:""});

  const load=useCallback(async()=>{setLoading(true);setError(null);try{
    const [metaRes,invRes,coaRes,entryRes]=await Promise.all([
      fetch("/api/finance/meta",{cache:"no-store"}),fetch("/api/finance/invoice-page?limit=200",{cache:"no-store"}),fetch("/api/accounting/chart-of-accounts",{cache:"no-store"}),fetch("/api/accounting/money?kind=income&limit=50",{cache:"no-store"})
    ]);
    const [meta,inv,coa,entry]=await Promise.all([metaRes.json(),invRes.json(),coaRes.json(),entryRes.json()]);
    if(!metaRes.ok)throw new Error(meta.detail??"Could not load finance data");if(!invRes.ok)throw new Error(inv.detail??"Could not load invoices");if(!coaRes.ok)throw new Error(coa.detail??"Could not load income categories");
    const typed=meta as Meta;setAccounts(typed.accounts.filter(a=>a.is_active&&a.account_type!=="credit_card"));setProjects(typed.projects);setOrders(typed.orders);setInvoices((inv.items??[]).filter((i:Invoice)=>Number(i.balance_due)>0&&!["draft","cancelled","paid"].includes(i.status)));setCategories((coa as LedgerAccount[]).filter(c=>c.category==="income"&&c.is_active));setEntries(entryRes.ok?entry:[]);
  }catch(reason){setError(reason instanceof Error?reason.message:"Could not load money-in workspace")}finally{setLoading(false)}},[]);
  useEffect(()=>{void load()},[load]);

  const sourceInvoice=useMemo(()=>{
    if(sourceType==="invoice")return invoices.find(i=>i.id===form.source_id)??null;
    if(sourceType==="project")return invoices.find(i=>i.project_id===form.source_id)??null;
    if(sourceType==="order")return invoices.find(i=>i.order_id===form.source_id)??null;
    return null;
  },[sourceType,form.source_id,invoices]);
  const selectedProject=projects.find(p=>p.id===form.source_id);const selectedOrder=orders.find(o=>o.id===form.source_id);
  const sourceCurrency=sourceInvoice?.currency??selectedProject?.currency??selectedOrder?.currency??accounts.find(a=>a.id===form.account_id)?.currency??"";
  const compatibleAccounts=accounts.filter(a=>!sourceCurrency||a.currency===sourceCurrency);

  function reset(type:SourceType){setSourceType(type);setForm({source_id:"",account_id:"",amount:"",date:today(),method:"bank_transfer",category_id:"",description:"",reference:"",notes:""});setError(null);setMessage(null)}

  async function ensureInvoice():Promise<Invoice>{
    if(sourceInvoice)return sourceInvoice;
    if(sourceType!=="project"&&sourceType!=="order")throw new Error("Select an invoice");
    const createPath=sourceType==="project"?`/api/finance/invoices/from-project/${form.source_id}`:`/api/finance/invoices/from-order/${form.source_id}`;
    const createdRes=await fetch(createPath,{method:"POST"});const created=await createdRes.json();if(!createdRes.ok)throw new Error(created.detail??"Could not create invoice from source");
    const sendRes=await fetch(`/api/finance/invoices/${created.id}/status`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"send"})});const sent=await sendRes.json();if(!sendRes.ok)throw new Error(sent.detail??"Could not activate invoice for payment");return sent as Invoice;
  }

  async function submit(event:FormEvent){event.preventDefault();setSaving(true);setError(null);setMessage(null);try{
    if(sourceType==="other"){
      const response=await fetch("/api/accounting/money",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({kind:"income",entry_date:form.date,financial_account_id:form.account_id,category_ledger_account_id:form.category_id,amount:Number(form.amount),description:form.description,reference:form.reference||null,notes:form.notes||null})});const payload=await response.json();if(!response.ok)throw new Error(payload.detail??"Could not record income");setMessage("Income recorded. Account balance and accounting ledger were updated.");
    }else{
      const invoice=sourceType==="invoice"?(sourceInvoice??(()=>{throw new Error("Select an invoice")})()):await ensureInvoice();
      const response=await fetch("/api/finance/payments",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({invoice_id:invoice.id,account_id:form.account_id,payment_date:form.date,invoice_amount:Number(form.amount),method:form.method,reference:form.reference||null,notes:form.notes||null})});const payload=await response.json();if(!response.ok)throw new Error(payload.detail??"Could not record payment");setMessage(`Payment ${payload.payment_number} recorded and linked to ${invoice.invoice_number}.`);
    }
    setForm({source_id:"",account_id:"",amount:"",date:today(),method:"bank_transfer",category_id:"",description:"",reference:"",notes:""});await load();
  }catch(reason){setError(reason instanceof Error?reason.message:"Could not record money received")}finally{setSaving(false)}}

  return <main className="p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-7xl space-y-6">
    <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Finance & Accounts</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Money in</h1><p className="mt-2 max-w-3xl text-sm text-neutral-500">Tell Business OS where the money came from. Invoice, project and order links are handled automatically.</p></div>
    <AccountingNav/>{error?<div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>:null}{message?<div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>:null}
    <section className="rounded-2xl border bg-white p-5"><h2 className="text-lg font-semibold">Where did this money come from?</h2><p className="mt-1 text-sm text-neutral-500">Choose the real business event. You do not need to choose debit or credit.</p><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{sourceCards.map(({value,title,help,icon:Icon})=><button key={value} type="button" onClick={()=>reset(value)} className={`rounded-2xl border p-4 text-left transition ${sourceType===value?"border-neutral-950 bg-neutral-950 text-white":"bg-white hover:bg-neutral-50"}`}><Icon className="size-5"/><p className="mt-3 font-semibold">{title}</p><p className={`mt-1 text-xs ${sourceType===value?"text-neutral-300":"text-neutral-500"}`}>{help}</p></button>)}</div>
      <form onSubmit={submit} className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {sourceType==="invoice"?<Field label="Invoice"><select required value={form.source_id} onChange={e=>setForm(v=>({...v,source_id:e.target.value,amount:""}))} className="w-full rounded-xl border bg-white px-3 py-2.5"><option value="">Select outstanding invoice</option>{invoices.map(i=><option key={i.id} value={i.id}>{i.invoice_number} · {i.client_name} · due {money(i.balance_due,i.currency)}</option>)}</select></Field>:null}
        {sourceType==="project"?<Field label="Project"><select required value={form.source_id} onChange={e=>setForm(v=>({...v,source_id:e.target.value,amount:""}))} className="w-full rounded-xl border bg-white px-3 py-2.5"><option value="">Select project</option>{projects.filter(p=>p.status!=="cancelled").map(p=><option key={p.id} value={p.id}>{p.number} · {p.name} · {money(p.contract_value,p.currency)}</option>)}</select><Hint>{sourceInvoice?`Payment will be applied to ${sourceInvoice.invoice_number}.`:"If this project has no invoice yet, Business OS will create one automatically before recording the payment."}</Hint></Field>:null}
        {sourceType==="order"?<Field label="Order"><select required value={form.source_id} onChange={e=>setForm(v=>({...v,source_id:e.target.value,amount:""}))} className="w-full rounded-xl border bg-white px-3 py-2.5"><option value="">Select order</option>{orders.filter(o=>o.status!=="cancelled").map(o=><option key={o.id} value={o.id}>{o.number} · {o.client_name} · {money(o.total,o.currency)}</option>)}</select><Hint>{sourceInvoice?`Payment will be applied to ${sourceInvoice.invoice_number}.`:"If this order has no invoice yet, Business OS will create one automatically before recording the payment."}</Hint></Field>:null}
        {sourceType==="other"?<Field label="Income category"><select required value={form.category_id} onChange={e=>setForm(v=>({...v,category_id:e.target.value}))} className="w-full rounded-xl border bg-white px-3 py-2.5"><option value="">Select category</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>:null}
        <Field label="Money received into"><select required value={form.account_id} onChange={e=>setForm(v=>({...v,account_id:e.target.value}))} className="w-full rounded-xl border bg-white px-3 py-2.5"><option value="">Select account</option>{compatibleAccounts.map(a=><option key={a.id} value={a.id}>{a.name} · {money(a.current_balance,a.currency)}</option>)}</select></Field>
        <Field label="Amount received"><div className="flex rounded-xl border"><span className="border-r px-3 py-2.5 text-sm text-neutral-400">{sourceCurrency||"—"}</span><input required type="number" min="0.01" step="0.01" value={form.amount} onChange={e=>setForm(v=>({...v,amount:e.target.value}))} className="min-w-0 flex-1 rounded-r-xl px-3 py-2.5 outline-none"/></div>{sourceInvoice?<Hint>Maximum currently due: {money(sourceInvoice.balance_due,sourceInvoice.currency)}</Hint>:null}</Field>
        <Field label="Date"><input required type="date" value={form.date} onChange={e=>setForm(v=>({...v,date:e.target.value}))} className="w-full rounded-xl border px-3 py-2.5"/></Field>
        {sourceType!=="other"?<Field label="Payment method"><select value={form.method} onChange={e=>setForm(v=>({...v,method:e.target.value}))} className="w-full rounded-xl border bg-white px-3 py-2.5"><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="card">Card</option><option value="payoneer">Payoneer</option><option value="wise">Wise</option><option value="stripe">Stripe</option><option value="paypal">PayPal</option><option value="other">Other</option></select></Field>:null}
        {sourceType==="other"?<Field label="Description"><input required value={form.description} onChange={e=>setForm(v=>({...v,description:e.target.value}))} className="w-full rounded-xl border px-3 py-2.5" placeholder="What was this income for?"/></Field>:null}
        <Field label="Reference (optional)"><input value={form.reference} onChange={e=>setForm(v=>({...v,reference:e.target.value}))} className="w-full rounded-xl border px-3 py-2.5"/></Field>
        <div className="md:col-span-2 lg:col-span-3 flex justify-end"><button disabled={saving||loading} className="inline-flex items-center gap-2 rounded-xl bg-neutral-950 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"><ArrowDownLeft className="size-4"/>{saving?"Saving…":"Confirm money received"}</button></div>
      </form>
    </section>
    <section className="rounded-2xl border bg-white p-5"><h2 className="font-semibold">Recent other income</h2><p className="mt-1 text-sm text-neutral-500">Invoice, project and order payments remain in Invoices/Receivables. This list only shows direct income not tied to those records.</p><div className="mt-4 overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="border-b text-left text-xs uppercase tracking-wide text-neutral-400"><th className="px-2 py-3">Date</th><th className="px-2 py-3">Description</th><th className="px-2 py-3">Category</th><th className="px-2 py-3">Account</th><th className="px-2 py-3 text-right">Amount</th></tr></thead><tbody>{entries.map(e=><tr key={e.id} className="border-b last:border-0"><td className="px-2 py-3">{e.entry_date}</td><td className="px-2 py-3">{e.description}</td><td className="px-2 py-3">{e.category_ledger_account_name}</td><td className="px-2 py-3">{e.financial_account_name}</td><td className="px-2 py-3 text-right font-medium">{money(e.amount,e.currency)}</td></tr>)}</tbody></table>{!loading&&!entries.length?<p className="py-10 text-center text-sm text-neutral-400">No direct income records yet.</p>:null}</div></section>
  </div></main>
}

function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="text-sm"><span className="mb-1.5 block font-medium text-neutral-600">{label}</span>{children}</label>}
function Hint({children}:{children:React.ReactNode}){return <span className="mt-1 block text-xs font-normal text-neutral-400">{children}</span>}
