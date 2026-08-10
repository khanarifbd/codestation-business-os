"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Building2, CircleDollarSign, ExternalLink, Plus, Search, X } from "lucide-react";

import { AccountingNav } from "@/components/accounting-nav";
import { CurrencySelect } from "@/components/currency-select";
import { MoneyInput } from "@/components/money-input";
import { SearchableSelect } from "@/components/searchable-select";
import { getApiErrorMessage } from "@/lib/api-error";

type Bill = { id: string; bill_number: string; supplier_name: string; bill_date: string; due_date: string | null; currency: string; original_amount: string; amount_paid: string; balance_due: string; expense_ledger_account_id: string; expense_ledger_account_name: string; description: string; reference: string | null; notes?: string | null; status: string };
type Payment = { id: string; bill_id: string; financial_account_id: string; financial_account_name: string; payment_date: string; currency: string; amount: string; reference: string | null; notes: string | null };
type LedgerAccount = { id: string; name: string; category: string; is_active: boolean };
type Account = { id: string; name: string; account_type: string; currency: string; current_balance: string; is_active: boolean };
type Vendor = { id: string; name: string; is_active: boolean };
type ExpenseMeta = { vendors?: Vendor[] };

function money(value: string | number, currency: string) { return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function today() { return new Date().toISOString().slice(0, 10); }
function isOverdue(bill: Bill) { return Boolean(bill.due_date && Number(bill.balance_due) > 0 && bill.due_date < today()); }

export default function PayablesPage() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [categories, setCategories] = useState<LedgerAccount[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"bill" | "pay" | null>(null);
  const [selected, setSelected] = useState<Bill | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");
  const [currencyFilter, setCurrencyFilter] = useState("all");
  const [billForm, setBillForm] = useState({ supplier_name: "", bill_date: today(), due_date: "", currency: "BDT", amount: "", expense_ledger_account_id: "", description: "", reference: "", notes: "" });
  const [payForm, setPayForm] = useState({ financial_account_id: "", payment_date: today(), amount: "", reference: "", notes: "" });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [billResponse, categoryResponse, accountResponse, metaResponse] = await Promise.all([
        fetch("/api/accounting/payables?include_paid=true&limit=500", { cache: "no-store" }),
        fetch("/api/accounting/chart-of-accounts", { cache: "no-store" }),
        fetch("/api/finance/accounts", { cache: "no-store" }),
        fetch("/api/finance/expense-meta", { cache: "no-store" }),
      ]);
      const [billPayload, categoryPayload, accountPayload, metaPayload] = await Promise.all([billResponse.json(), categoryResponse.json(), accountResponse.json(), metaResponse.json()]);
      if (!billResponse.ok) throw new Error(getApiErrorMessage(billPayload, "Could not load payables"));
      if (!categoryResponse.ok) throw new Error(getApiErrorMessage(categoryPayload, "Could not load expense categories"));
      if (!accountResponse.ok) throw new Error(getApiErrorMessage(accountPayload, "Could not load accounts"));
      setBills(billPayload);
      setCategories(categoryPayload.filter((item: LedgerAccount) => item.category === "expense" && item.is_active));
      setAccounts(accountPayload);
      setVendors(metaResponse.ok ? ((metaPayload as ExpenseMeta).vendors ?? []) : []);
      setSelected((current) => current ? (billPayload.find((item: Bill) => item.id === current.id) ?? null) : null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load payables"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const loadPayments = useCallback(async (billId: string) => {
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/accounting/payables/${billId}/payments`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not load payment history"));
      setPayments(payload);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load payment history"); }
    finally { setDetailLoading(false); }
  }, []);
  useEffect(() => { if (selected) void loadPayments(selected.id); else setPayments([]); }, [selected?.id, loadPayments]);

  const openBills = useMemo(() => bills.filter((bill) => Number(bill.balance_due) > 0), [bills]);
  const totals = useMemo(() => { const result = new Map<string, number>(); for (const bill of openBills) result.set(bill.currency, (result.get(bill.currency) ?? 0) + Number(bill.balance_due)); return [...result.entries()]; }, [openBills]);
  const compatibleAccounts = useMemo(() => selected ? accounts.filter((account) => account.is_active && account.currency === selected.currency) : [], [accounts, selected]);
  const categoryOptions = useMemo(() => categories.map((category) => ({ value: category.id, label: category.name })), [categories]);
  const vendorOptions = useMemo(() => vendors.filter((vendor) => vendor.is_active).map((vendor) => ({ value: vendor.name, label: vendor.name })), [vendors]);
  const paymentAccountOptions = useMemo(() => compatibleAccounts.map((account) => ({ value: account.id, label: `${account.name} · ${money(account.current_balance, account.currency)}`, keywords: `${account.name} ${account.currency} ${account.account_type}` })), [compatibleAccounts]);
  const currencies = useMemo(() => [...new Set(bills.map((bill) => bill.currency))].sort(), [bills]);
  const filteredBills = useMemo(() => {
    const q = query.trim().toLowerCase();
    return bills.filter((bill) => {
      const matchesQuery = !q || `${bill.bill_number} ${bill.supplier_name} ${bill.description} ${bill.reference ?? ""}`.toLowerCase().includes(q);
      const statusOk = statusFilter === "all" || (statusFilter === "open" && Number(bill.balance_due) > 0) || (statusFilter === "overdue" && isOverdue(bill)) || (statusFilter === "paid" && Number(bill.balance_due) === 0) || (statusFilter === "partial" && Number(bill.amount_paid) > 0 && Number(bill.balance_due) > 0);
      const currencyOk = currencyFilter === "all" || bill.currency === currencyFilter;
      return matchesQuery && statusOk && currencyOk;
    });
  }, [bills, query, statusFilter, currencyFilter]);

  async function submitBill(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      const response = await fetch("/api/accounting/payables", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...billForm, due_date: billForm.due_date || null, amount: Number(billForm.amount), reference: billForm.reference || null, notes: billForm.notes || null }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not record vendor bill"));
      setBillForm({ supplier_name: "", bill_date: today(), due_date: "", currency: "BDT", amount: "", expense_ledger_account_id: "", description: "", reference: "", notes: "" });
      setMode(null); await load(); setSelected(payload);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not record vendor bill"); }
    finally { setSaving(false); }
  }

  function openPayment(bill: Bill) {
    setSelected(bill); setPayForm({ financial_account_id: "", payment_date: today(), amount: bill.balance_due, reference: "", notes: "" }); setMode("pay");
  }

  async function submitPayment(event: FormEvent) {
    event.preventDefault(); if (!selected) return;
    const billId = selected.id;
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/accounting/payables/${billId}/payments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payForm, amount: Number(payForm.amount), reference: payForm.reference || null, notes: payForm.notes || null }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not record vendor payment"));
      setMode(null); await load(); await loadPayments(billId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not record vendor payment"); }
    finally { setSaving(false); }
  }

  return <main className="p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-7xl space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Finance & Accounts</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Supplier payables</h1><p className="mt-2 max-w-3xl text-sm text-neutral-500">Bills, due dates, partial payments and supplier payment history in one place.</p></div><button onClick={() => { setMode("bill"); setSelected(null); }} className="inline-flex items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white"><Plus className="size-4" />Record vendor bill</button></div>
    <AccountingNav />
    {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div className="rounded-2xl border bg-white p-5"><p className="text-sm text-neutral-500">Open bills</p><p className="mt-2 text-3xl font-semibold">{openBills.length}</p><p className="mt-1 text-xs text-neutral-400">{openBills.filter(isOverdue).length} overdue</p></div><div className="rounded-2xl border bg-white p-5 sm:col-span-1 lg:col-span-3"><p className="text-sm text-neutral-500">Total you owe suppliers</p><div className="mt-2 flex flex-wrap gap-x-8 gap-y-1">{totals.length ? totals.map(([currency, value]) => <p key={currency} className="text-2xl font-semibold">{money(value, currency)}</p>) : <p className="text-2xl font-semibold">0.00</p>}</div></div></section>

    {mode === "bill" ? <section className="rounded-2xl border bg-white p-5"><div className="flex items-center gap-3"><div className="flex size-10 items-center justify-center rounded-xl bg-neutral-100"><Building2 className="size-5" /></div><div><h2 className="font-semibold">Record a vendor bill</h2><p className="mt-1 text-sm text-neutral-500">This creates an expense and payable, but does not reduce cash yet.</p></div></div><form onSubmit={submitBill} className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3"><SearchableSelect label="Supplier" required clearable={false} allowCustom value={billForm.supplier_name} onValueChange={(value) => setBillForm((current) => ({ ...current, supplier_name: value }))} options={vendorOptions} placeholder="Select or type supplier" searchPlaceholder="Search supplier or type a new name..." /><SearchableSelect label="Expense category" required clearable={false} value={billForm.expense_ledger_account_id} onValueChange={(value) => setBillForm((current) => ({ ...current, expense_ledger_account_id: value }))} options={categoryOptions} placeholder="Select category" searchPlaceholder="Search expense category..." /><CurrencySelect required clearable={false} value={billForm.currency} onValueChange={(value) => setBillForm((current) => ({ ...current, currency: value }))} /><MoneyInput label="Bill amount" currency={billForm.currency} required min={0.01} value={billForm.amount} onValueChange={(value) => setBillForm((current) => ({ ...current, amount: value }))} /><Field label="Bill date"><input required type="date" value={billForm.bill_date} onChange={(event) => setBillForm((current) => ({ ...current, bill_date: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field><Field label="Due date"><input type="date" value={billForm.due_date} onChange={(event) => setBillForm((current) => ({ ...current, due_date: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field><Field label="Reference"><input value={billForm.reference} onChange={(event) => setBillForm((current) => ({ ...current, reference: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field><Field label="What is this bill for?"><input required value={billForm.description} onChange={(event) => setBillForm((current) => ({ ...current, description: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5" placeholder="Office rent for August" /></Field><div className="flex items-end justify-end gap-2 md:col-span-2"><button type="button" onClick={() => setMode(null)} className="rounded-xl border px-4 py-2.5 text-sm">Cancel</button><button disabled={saving} className="rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? "Saving…" : "Record bill"}</button></div></form></section> : null}

    {selected ? <section className="rounded-2xl border bg-white p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2"><h2 className="text-xl font-semibold">{selected.bill_number}</h2><span className={`rounded-full px-2 py-1 text-xs ${isOverdue(selected)?"bg-red-50 text-red-700":"bg-neutral-100 text-neutral-600"}`}>{isOverdue(selected)?"Overdue":selected.status.replaceAll("_"," ")}</span></div><p className="mt-1 text-sm text-neutral-500">{selected.supplier_name} · {selected.description}</p></div><div className="flex items-center gap-2">{Number(selected.balance_due)>0?<button onClick={() => openPayment(selected)} className="rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white">Pay bill</button>:null}<button onClick={()=>{setSelected(null);setMode(null)}} className="rounded-xl border p-2.5"><X className="size-4"/></button></div></div><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Stat label="Original bill" value={money(selected.original_amount,selected.currency)}/><Stat label="Paid" value={money(selected.amount_paid,selected.currency)}/><Stat label="Still due" value={money(selected.balance_due,selected.currency)}/><Stat label="Due date" value={selected.due_date || "No due date"}/></div><div className="mt-5 grid gap-4 md:grid-cols-2"><Info label="Expense category" value={selected.expense_ledger_account_name}/><Info label="Reference" value={selected.reference || "—"}/><Info label="Bill date" value={selected.bill_date}/><Info label="Notes" value={selected.notes || "—"}/></div><div className="mt-6 border-t pt-5"><h3 className="font-semibold">Payment history</h3><p className="mt-1 text-sm text-neutral-500">Every partial or full payment remains attached to this bill.</p>{detailLoading?<p className="mt-4 text-sm text-neutral-400">Loading payments…</p>:payments.length?<div className="mt-4 space-y-3">{payments.map((payment)=><div key={payment.id} className="rounded-xl border p-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{money(payment.amount,payment.currency)}</p><p className="mt-1 text-sm text-neutral-500">Paid from {payment.financial_account_name}</p></div><p className="text-sm text-neutral-400">{payment.payment_date}</p></div>{payment.reference?<p className="mt-2 text-xs text-neutral-400">Reference: {payment.reference}</p>:null}{payment.notes?<p className="mt-2 text-sm text-neutral-500">{payment.notes}</p>:null}</div>)}</div>:<div className="mt-4 rounded-xl border border-dashed p-6 text-center text-sm text-neutral-400">No payments recorded yet.</div>}</div></section>:null}

    {mode === "pay" && selected ? <section className="rounded-2xl border bg-white p-5"><div className="flex items-center gap-3"><div className="flex size-10 items-center justify-center rounded-xl bg-neutral-100"><CircleDollarSign className="size-5" /></div><div><h2 className="font-semibold">Pay {selected.supplier_name}</h2><p className="mt-1 text-sm text-neutral-500">{selected.bill_number} has {money(selected.balance_due, selected.currency)} remaining.</p></div></div><form onSubmit={submitPayment} className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3"><SearchableSelect label="Pay from / charge to" required clearable={false} value={payForm.financial_account_id} onValueChange={(value) => setPayForm((current) => ({ ...current, financial_account_id: value }))} options={paymentAccountOptions} placeholder="Select account" searchPlaceholder="Search bank, cash or wallet..." /><MoneyInput label="Payment amount" currency={selected.currency} required min={0.01} max={Number(selected.balance_due)} value={payForm.amount} onValueChange={(value) => setPayForm((current) => ({ ...current, amount: value }))} hint={`Maximum outstanding: ${money(selected.balance_due, selected.currency)}`} /><Field label="Payment date"><input required type="date" value={payForm.payment_date} onChange={(event) => setPayForm((current) => ({ ...current, payment_date: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field><Field label="Reference"><input value={payForm.reference} onChange={(event) => setPayForm((current) => ({ ...current, reference: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field><div className="flex items-end justify-end gap-2 md:col-span-2"><button type="button" onClick={() => setMode(null)} className="rounded-xl border px-4 py-2.5 text-sm">Cancel</button><button disabled={saving} className="rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? "Saving…" : "Confirm payment"}</button></div></form></section> : null}

    <section className="rounded-2xl border bg-white p-5"><div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div><h2 className="font-semibold">Supplier bills</h2><p className="mt-1 text-sm text-neutral-500">Search open, overdue, partially paid and paid bills.</p></div><div className="grid gap-2 sm:grid-cols-3"><div className="relative"><Search className="absolute left-3 top-3 size-4 text-neutral-400"/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search bill or supplier…" className="w-full rounded-xl border py-2.5 pl-9 pr-3 text-sm"/></div><select value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value)} className="rounded-xl border bg-white px-3 py-2.5 text-sm"><option value="open">Open</option><option value="overdue">Overdue</option><option value="partial">Partially paid</option><option value="paid">Paid</option><option value="all">All</option></select><select value={currencyFilter} onChange={(e)=>setCurrencyFilter(e.target.value)} className="rounded-xl border bg-white px-3 py-2.5 text-sm"><option value="all">All currencies</option>{currencies.map((currency)=><option key={currency} value={currency}>{currency}</option>)}</select></div></div><p className="mt-3 text-xs text-neutral-400">Showing {filteredBills.length} of {bills.length} bills</p><div className="mt-4 overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="border-b text-left text-xs uppercase tracking-wide text-neutral-400"><th className="px-2 py-3">Bill</th><th className="px-2 py-3">Supplier</th><th className="px-2 py-3">Due date</th><th className="px-2 py-3">Expense</th><th className="px-2 py-3">Total</th><th className="px-2 py-3">Still due</th><th className="px-2 py-3"></th></tr></thead><tbody>{filteredBills.map((bill) => <tr key={bill.id} className="border-b last:border-0 hover:bg-neutral-50"><td className="px-2 py-3"><button onClick={()=>{setSelected(bill);setMode(null)}} className="inline-flex items-center gap-1 font-medium hover:underline">{bill.bill_number}<ExternalLink className="size-3"/></button><p className="text-xs text-neutral-400">{bill.reference || "No reference"}</p></td><td className="px-2 py-3">{bill.supplier_name}</td><td className={`px-2 py-3 ${isOverdue(bill)?"font-medium text-red-600":"text-neutral-500"}`}>{bill.due_date || "—"}</td><td className="px-2 py-3">{bill.expense_ledger_account_name}</td><td className="px-2 py-3 tabular-nums">{money(bill.original_amount, bill.currency)}</td><td className="px-2 py-3 font-semibold tabular-nums">{money(bill.balance_due, bill.currency)}</td><td className="px-2 py-3 text-right"><div className="flex justify-end gap-2"><button onClick={()=>{setSelected(bill);setMode(null)}} className="rounded-lg border px-3 py-2 text-xs font-medium">Open</button>{Number(bill.balance_due)>0?<button onClick={() => openPayment(bill)} className="rounded-lg bg-neutral-950 px-3 py-2 text-xs font-medium text-white">Pay</button>:null}</div></td></tr>)}</tbody></table>{!loading && filteredBills.length === 0 ? <div className="py-12 text-center"><Building2 className="mx-auto size-8 text-neutral-300" /><p className="mt-3 font-medium">No matching bills</p></div> : null}</div></section>
  </div></main>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="text-sm"><span className="mb-1.5 block font-medium text-neutral-600">{label}</span>{children}</label>; }
function Stat({label,value}:{label:string;value:string}) { return <div className="rounded-xl bg-neutral-50 p-4"><p className="text-xs uppercase tracking-wide text-neutral-400">{label}</p><p className="mt-2 text-lg font-semibold">{value}</p></div>; }
function Info({label,value}:{label:string;value:string}) { return <div><p className="text-xs uppercase tracking-wide text-neutral-400">{label}</p><p className="mt-1 text-sm text-neutral-700">{value}</p></div>; }
