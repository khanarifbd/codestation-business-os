"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Building2, CircleDollarSign, Plus } from "lucide-react";

import { AccountingNav } from "@/components/accounting-nav";
import { CurrencySelect } from "@/components/currency-select";
import { MoneyInput } from "@/components/money-input";
import { SearchableSelect } from "@/components/searchable-select";
import { getApiErrorMessage } from "@/lib/api-error";

type Bill = { id: string; bill_number: string; supplier_name: string; bill_date: string; due_date: string | null; currency: string; original_amount: string; amount_paid: string; balance_due: string; expense_ledger_account_id: string; expense_ledger_account_name: string; description: string; reference: string | null; status: string };
type LedgerAccount = { id: string; name: string; category: string; is_active: boolean };
type Account = { id: string; name: string; account_type: string; currency: string; current_balance: string; is_active: boolean };
type Vendor = { id: string; name: string; is_active: boolean };
type ExpenseMeta = { vendors?: Vendor[] };

function money(value: string | number, currency: string) { return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function today() { return new Date().toISOString().slice(0, 10); }

export default function PayablesPage() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [categories, setCategories] = useState<LedgerAccount[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"bill" | "pay" | null>(null);
  const [selected, setSelected] = useState<Bill | null>(null);
  const [billForm, setBillForm] = useState({ supplier_name: "", bill_date: today(), due_date: "", currency: "BDT", amount: "", expense_ledger_account_id: "", description: "", reference: "", notes: "" });
  const [payForm, setPayForm] = useState({ financial_account_id: "", payment_date: today(), amount: "", reference: "", notes: "" });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [billResponse, categoryResponse, accountResponse, metaResponse] = await Promise.all([
        fetch("/api/accounting/payables", { cache: "no-store" }),
        fetch("/api/accounting/chart-of-accounts", { cache: "no-store" }),
        fetch("/api/finance/accounts", { cache: "no-store" }),
        fetch("/api/finance/expense-meta", { cache: "no-store" }),
      ]);
      const [billPayload, categoryPayload, accountPayload, metaPayload] = await Promise.all([
        billResponse.json(), categoryResponse.json(), accountResponse.json(), metaResponse.json(),
      ]);
      if (!billResponse.ok) throw new Error(getApiErrorMessage(billPayload, "Could not load payables"));
      if (!categoryResponse.ok) throw new Error(getApiErrorMessage(categoryPayload, "Could not load expense categories"));
      if (!accountResponse.ok) throw new Error(getApiErrorMessage(accountPayload, "Could not load accounts"));
      setBills(billPayload);
      setCategories(categoryPayload.filter((item: LedgerAccount) => item.category === "expense" && item.is_active));
      setAccounts(accountPayload);
      setVendors(metaResponse.ok ? ((metaPayload as ExpenseMeta).vendors ?? []) : []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load payables"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => { const result = new Map<string, number>(); for (const bill of bills) result.set(bill.currency, (result.get(bill.currency) ?? 0) + Number(bill.balance_due)); return [...result.entries()]; }, [bills]);
  const compatibleAccounts = useMemo(() => selected ? accounts.filter((account) => account.is_active && account.currency === selected.currency) : [], [accounts, selected]);
  const categoryOptions = useMemo(() => categories.map((category) => ({ value: category.id, label: category.name })), [categories]);
  const vendorOptions = useMemo(() => vendors.filter((vendor) => vendor.is_active).map((vendor) => ({ value: vendor.name, label: vendor.name })), [vendors]);
  const paymentAccountOptions = useMemo(() => compatibleAccounts.map((account) => ({ value: account.id, label: `${account.name} · ${money(account.current_balance, account.currency)}`, keywords: `${account.name} ${account.currency} ${account.account_type}` })), [compatibleAccounts]);

  async function submitBill(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      const response = await fetch("/api/accounting/payables", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...billForm, due_date: billForm.due_date || null, amount: Number(billForm.amount), reference: billForm.reference || null, notes: billForm.notes || null }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not record vendor bill"));
      setBillForm({ supplier_name: "", bill_date: today(), due_date: "", currency: "BDT", amount: "", expense_ledger_account_id: "", description: "", reference: "", notes: "" });
      setMode(null); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not record vendor bill"); }
    finally { setSaving(false); }
  }

  function openPayment(bill: Bill) {
    setSelected(bill);
    setPayForm({ financial_account_id: "", payment_date: today(), amount: bill.balance_due, reference: "", notes: "" });
    setMode("pay");
  }

  async function submitPayment(event: FormEvent) {
    event.preventDefault(); if (!selected) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/accounting/payables/${selected.id}/payments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payForm, amount: Number(payForm.amount), reference: payForm.reference || null, notes: payForm.notes || null }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not record vendor payment"));
      setMode(null); setSelected(null); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not record vendor payment"); }
    finally { setSaving(false); }
  }

  return <main className="p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-7xl space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Finance & Accounts</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Supplier payables</h1><p className="mt-2 max-w-3xl text-sm text-neutral-500">Record a bill when the supplier charges you. Your bank balance changes only when you actually pay it.</p></div><button onClick={() => { setMode("bill"); setSelected(null); }} className="inline-flex items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white"><Plus className="size-4" />Record vendor bill</button></div>
    <AccountingNav />
    {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div className="rounded-2xl border bg-white p-5"><p className="text-sm text-neutral-500">Open bills</p><p className="mt-2 text-3xl font-semibold">{bills.length}</p></div><div className="rounded-2xl border bg-white p-5 sm:col-span-1 lg:col-span-3"><p className="text-sm text-neutral-500">Total you owe suppliers</p><div className="mt-2 flex flex-wrap gap-x-8 gap-y-1">{totals.length ? totals.map(([currency, value]) => <p key={currency} className="text-2xl font-semibold">{money(value, currency)}</p>) : <p className="text-2xl font-semibold">0.00</p>}</div></div></section>

    {mode === "bill" ? <section className="rounded-2xl border bg-white p-5"><div className="flex items-center gap-3"><div className="flex size-10 items-center justify-center rounded-xl bg-neutral-100"><Building2 className="size-5" /></div><div><h2 className="font-semibold">Record a vendor bill</h2><p className="mt-1 text-sm text-neutral-500">This creates an expense and payable, but does not reduce cash yet.</p></div></div><form onSubmit={submitBill} className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <SearchableSelect label="Supplier" required clearable={false} allowCustom value={billForm.supplier_name} onValueChange={(value) => setBillForm((current) => ({ ...current, supplier_name: value }))} options={vendorOptions} placeholder="Select or type supplier" searchPlaceholder="Search supplier or type a new name..." />
      <SearchableSelect label="Expense category" required clearable={false} value={billForm.expense_ledger_account_id} onValueChange={(value) => setBillForm((current) => ({ ...current, expense_ledger_account_id: value }))} options={categoryOptions} placeholder="Select category" searchPlaceholder="Search expense category..." />
      <CurrencySelect required clearable={false} value={billForm.currency} onValueChange={(value) => setBillForm((current) => ({ ...current, currency: value }))} />
      <MoneyInput label="Bill amount" currency={billForm.currency} required min={0.01} value={billForm.amount} onValueChange={(value) => setBillForm((current) => ({ ...current, amount: value }))} />
      <Field label="Bill date"><input required type="date" value={billForm.bill_date} onChange={(event) => setBillForm((current) => ({ ...current, bill_date: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
      <Field label="Due date"><input type="date" value={billForm.due_date} onChange={(event) => setBillForm((current) => ({ ...current, due_date: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
      <Field label="Reference"><input value={billForm.reference} onChange={(event) => setBillForm((current) => ({ ...current, reference: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
      <Field label="What is this bill for?"><input required value={billForm.description} onChange={(event) => setBillForm((current) => ({ ...current, description: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5" placeholder="Office rent for August" /></Field>
      <div className="flex items-end justify-end gap-2 md:col-span-2"><button type="button" onClick={() => setMode(null)} className="rounded-xl border px-4 py-2.5 text-sm">Cancel</button><button disabled={saving} className="rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? "Saving…" : "Record bill"}</button></div>
    </form></section> : null}

    {mode === "pay" && selected ? <section className="rounded-2xl border bg-white p-5"><div className="flex items-center gap-3"><div className="flex size-10 items-center justify-center rounded-xl bg-neutral-100"><CircleDollarSign className="size-5" /></div><div><h2 className="font-semibold">Pay {selected.supplier_name}</h2><p className="mt-1 text-sm text-neutral-500">{selected.bill_number} has {money(selected.balance_due, selected.currency)} remaining.</p></div></div><form onSubmit={submitPayment} className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <SearchableSelect label="Pay from / charge to" required clearable={false} value={payForm.financial_account_id} onValueChange={(value) => setPayForm((current) => ({ ...current, financial_account_id: value }))} options={paymentAccountOptions} placeholder="Select account" searchPlaceholder="Search bank, cash or wallet..." />
      <MoneyInput label="Payment amount" currency={selected.currency} required min={0.01} max={Number(selected.balance_due)} value={payForm.amount} onValueChange={(value) => setPayForm((current) => ({ ...current, amount: value }))} hint={`Maximum outstanding: ${money(selected.balance_due, selected.currency)}`} />
      <Field label="Payment date"><input required type="date" value={payForm.payment_date} onChange={(event) => setPayForm((current) => ({ ...current, payment_date: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
      <Field label="Reference"><input value={payForm.reference} onChange={(event) => setPayForm((current) => ({ ...current, reference: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
      <div className="flex items-end justify-end gap-2 md:col-span-2"><button type="button" onClick={() => { setMode(null); setSelected(null); }} className="rounded-xl border px-4 py-2.5 text-sm">Cancel</button><button disabled={saving} className="rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? "Saving…" : "Confirm payment"}</button></div>
    </form></section> : null}

    <section className="rounded-2xl border bg-white p-5"><div><h2 className="font-semibold">Bills waiting for payment</h2><p className="mt-1 text-sm text-neutral-500">Partial payments keep the remaining amount open automatically.</p></div><div className="mt-4 overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="border-b text-left text-xs uppercase tracking-wide text-neutral-400"><th className="px-2 py-3">Bill</th><th className="px-2 py-3">Supplier</th><th className="px-2 py-3">Due date</th><th className="px-2 py-3">Expense</th><th className="px-2 py-3">Total</th><th className="px-2 py-3">Still due</th><th className="px-2 py-3"></th></tr></thead><tbody>{bills.map((bill) => <tr key={bill.id} className="border-b last:border-0"><td className="px-2 py-3"><p className="font-medium">{bill.bill_number}</p><p className="text-xs text-neutral-400">{bill.reference || "No reference"}</p></td><td className="px-2 py-3">{bill.supplier_name}</td><td className="px-2 py-3 text-neutral-500">{bill.due_date || "—"}</td><td className="px-2 py-3">{bill.expense_ledger_account_name}</td><td className="px-2 py-3 tabular-nums">{money(bill.original_amount, bill.currency)}</td><td className="px-2 py-3 font-semibold tabular-nums">{money(bill.balance_due, bill.currency)}</td><td className="px-2 py-3 text-right"><button onClick={() => openPayment(bill)} className="rounded-lg bg-neutral-950 px-3 py-2 text-xs font-medium text-white">Pay bill</button></td></tr>)}</tbody></table>{!loading && bills.length === 0 ? <div className="py-12 text-center"><Building2 className="mx-auto size-8 text-neutral-300" /><p className="mt-3 font-medium">Nothing to pay</p><p className="mt-1 text-sm text-neutral-400">No vendor bills are currently outstanding.</p></div> : null}</div></section>
  </div></main>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="text-sm"><span className="mb-1.5 block font-medium text-neutral-600">{label}</span>{children}</label>; }
