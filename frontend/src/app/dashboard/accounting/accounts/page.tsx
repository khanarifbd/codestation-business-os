"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Building2, CreditCard, Landmark, Link2, Plus, Smartphone, WalletCards } from "lucide-react";

import { AccountingNav } from "@/components/accounting-nav";
import { SearchableSelect } from "@/components/searchable-select";
import { CURRENCY_OPTIONS } from "@/lib/company-options";

type Account = { id: string; name: string; account_type: string; provider_name: string | null; account_holder_name: string | null; account_reference: string | null; currency: string; opening_balance: string; current_balance: string; is_active: boolean; notes: string | null };
type AccountType = "bank" | "cash" | "mobile_wallet" | "credit_card" | "payment_gateway" | "petty_cash" | "other";
const accountTypes: Array<{ value: AccountType; label: string; help: string }> = [
  { value: "bank", label: "Bank account", help: "Business bank or savings/current account" },
  { value: "cash", label: "Cash", help: "Cash kept in office or with the business" },
  { value: "mobile_wallet", label: "Mobile wallet", help: "bKash, Nagad, Rocket or similar" },
  { value: "credit_card", label: "Credit card", help: "Company credit card. Opening balance means the amount currently owed." },
  { value: "payment_gateway", label: "Payment gateway", help: "Stripe, PayPal, Payoneer, Wise or gateway balance" },
  { value: "petty_cash", label: "Petty cash", help: "Small day-to-day expense cash" },
  { value: "other", label: "Other", help: "Any other financial account" },
];
function money(value: string | number, currency: string) { return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function typeLabel(value: string) { return accountTypes.find((item) => item.value === value)?.label ?? value.replaceAll("_", " "); }
const blankForm = () => ({ name: "", account_type: "bank" as AccountType, provider_name: "", account_holder_name: "", account_reference: "", currency: "BDT", opening_balance: "0", notes: "", payment_url: "", payment_instructions: "" });

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [showForm, setShowForm] = useState(false); const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(blankForm);
  const load = useCallback(async () => { setLoading(true); setError(null); try { const response = await fetch("/api/finance/accounts", { cache: "no-store" }); const payload = await response.json(); if (!response.ok) throw new Error(typeof payload.detail === "string" ? payload.detail : "Could not load accounts"); setAccounts(payload); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load accounts"); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  const totals = useMemo(() => { const result = new Map<string, number>(); for (const item of accounts.filter((account) => account.is_active && account.account_type !== "credit_card")) result.set(item.currency, (result.get(item.currency) ?? 0) + Number(item.current_balance)); return [...result.entries()]; }, [accounts]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      const response = await fetch("/api/accounting/financial-accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, opening_balance: Number(form.opening_balance || 0), provider_name: form.provider_name || null, account_holder_name: form.account_holder_name || null, account_reference: form.account_reference || null, notes: form.notes || null, payment_url: form.payment_url || null, payment_instructions: form.payment_instructions || null }) });
      const payload = await response.json(); if (!response.ok) throw new Error(typeof payload.detail === "string" ? payload.detail : "Could not create account");
      setForm(blankForm()); setShowForm(false); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create account"); } finally { setSaving(false); }
  }

  return <main className="p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-7xl space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Finance & Accounts</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Financial accounts</h1><p className="mt-2 text-sm text-neutral-500">These are the real places where your business keeps money or owes a card balance. Open any account to see its full ledger.</p></div><button type="button" onClick={() => setShowForm((value) => !value)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white"><Plus className="size-4" />Add account</button></div>
    <AccountingNav />
    {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div className="rounded-2xl border bg-white p-5"><p className="text-sm text-neutral-500">Active accounts</p><p className="mt-2 text-3xl font-semibold">{accounts.filter((item) => item.is_active).length}</p></div><div className="rounded-2xl border bg-white p-5 sm:col-span-1 lg:col-span-3"><p className="text-sm text-neutral-500">Available money by currency</p><div className="mt-2 flex flex-wrap gap-x-8 gap-y-1">{totals.length ? totals.map(([currency, value]) => <p key={currency} className="text-2xl font-semibold tabular-nums">{money(value, currency)}</p>) : <p className="text-2xl font-semibold">0.00</p>}</div><p className="mt-1 text-xs text-neutral-400">Credit card liabilities are not counted as available cash.</p></div></section>

    {showForm ? <section className="rounded-2xl border bg-white p-5"><div><h2 className="font-semibold">Add a financial account</h2><p className="mt-1 text-sm text-neutral-500">Choose what this account is in real life. Business OS creates the correct ledger mapping and opening-balance journal automatically.</p></div><form onSubmit={submit} className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <Field label="Account type"><select value={form.account_type} onChange={(e) => setForm((v) => ({ ...v, account_type: e.target.value as AccountType }))} className="w-full rounded-xl border bg-white px-3 py-2.5">{accountTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><p className="mt-1 text-xs text-neutral-400">{accountTypes.find((item) => item.value === form.account_type)?.help}</p></Field>
      <Field label="Account name"><input required value={form.name} onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))} className="w-full rounded-xl border px-3 py-2.5" placeholder="City Bank Business Account" /></Field>
      <SearchableSelect label="Currency" value={form.currency} onValueChange={(currency) => setForm((value) => ({ ...value, currency }))} options={CURRENCY_OPTIONS} placeholder="Select currency" searchPlaceholder="Search currency..." required clearable={false} />
      <Field label="Bank / provider name"><input value={form.provider_name} onChange={(e) => setForm((v) => ({ ...v, provider_name: e.target.value }))} className="w-full rounded-xl border px-3 py-2.5" placeholder="City Bank / Payoneer / Stripe" /></Field>
      <Field label="Account holder"><input value={form.account_holder_name} onChange={(e) => setForm((v) => ({ ...v, account_holder_name: e.target.value }))} className="w-full rounded-xl border px-3 py-2.5" placeholder="CodeStation AI" /></Field>
      <Field label="Account / reference number"><input value={form.account_reference} onChange={(e) => setForm((v) => ({ ...v, account_reference: e.target.value }))} className="w-full rounded-xl border px-3 py-2.5" placeholder="Account number, email or wallet ID" /></Field>
      <Field label={form.account_type === "credit_card" ? "Amount currently owed" : "Opening balance"}><input type="number" min={form.account_type === "credit_card" ? "0" : undefined} step="0.01" value={form.opening_balance} onChange={(e) => setForm((v) => ({ ...v, opening_balance: e.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /><p className="mt-1 text-xs text-neutral-400">{form.account_type === "credit_card" ? "Enter the amount already owed on the card." : "Money already in this account when you start using Business OS."}</p></Field>
      <Field label="Default payment URL"><div className="relative"><Link2 className="absolute left-3 top-3 size-4 text-neutral-400" /><input type="url" value={form.payment_url} onChange={(e) => setForm((v) => ({ ...v, payment_url: e.target.value }))} className="w-full rounded-xl border py-2.5 pl-9 pr-3" placeholder="https://pay.example.com/..." /></div><p className="mt-1 text-xs text-neutral-400">Optional. New invoice payment instructions can prefill this link and generate a QR code.</p></Field>
      <Field label="Notes"><input value={form.notes} onChange={(e) => setForm((v) => ({ ...v, notes: e.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
      <div className="md:col-span-2 lg:col-span-3"><Field label="Default client payment instructions"><textarea value={form.payment_instructions} onChange={(e) => setForm((v) => ({ ...v, payment_instructions: e.target.value }))} className="min-h-24 w-full rounded-xl border px-3 py-2.5" placeholder="Example: Use the invoice number as the payment reference." /><p className="mt-1 text-xs text-neutral-400">Client-facing only. Do not store passwords, card secrets or private credentials here.</p></Field></div>
      <div className="md:col-span-2 lg:col-span-3 flex justify-end"><button disabled={saving} className="min-w-44 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? "Saving…" : "Create account"}</button></div>
    </form></section> : null}

    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{accounts.map((account) => <Link key={account.id} href={`/dashboard/accounting/accounts/${account.id}`} className={`group rounded-2xl border bg-white p-5 transition hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-sm ${account.is_active ? "" : "opacity-60"}`}><div className="flex items-start justify-between gap-4"><div className="flex size-10 items-center justify-center rounded-xl bg-neutral-100">{account.account_type === "bank" ? <Landmark className="size-5" /> : account.account_type === "credit_card" ? <CreditCard className="size-5" /> : account.account_type === "mobile_wallet" ? <Smartphone className="size-5" /> : account.account_type === "payment_gateway" ? <Building2 className="size-5" /> : <WalletCards className="size-5" />}</div><span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs capitalize text-neutral-500">{typeLabel(account.account_type)}</span></div><h3 className="mt-4 font-semibold">{account.name}</h3><p className="mt-1 text-xs text-neutral-400">{account.provider_name || account.account_reference || "No provider/reference"}</p><p className="mt-5 text-2xl font-semibold tabular-nums">{money(account.current_balance, account.currency)}</p><p className="mt-1 text-xs text-neutral-400">{account.account_type === "credit_card" ? "Current amount owed" : "Current balance"}</p><div className="mt-4 flex justify-between border-t pt-3 text-xs text-neutral-400"><span>{account.account_type === "credit_card" ? "Opening owed" : "Opening"} {money(account.opening_balance, account.currency)}</span><span>{account.is_active ? "Active" : "Inactive"}</span></div><div className="mt-4 flex items-center justify-between text-sm font-medium text-neutral-700"><span>View ledger</span><ArrowRight className="size-4 transition group-hover:translate-x-1" /></div></Link>)}{!loading && accounts.length === 0 ? <div className="rounded-2xl border border-dashed bg-white p-10 text-center md:col-span-2 xl:col-span-3"><WalletCards className="mx-auto size-8 text-neutral-300" /><p className="mt-3 font-medium">No financial account yet</p><p className="mt-1 text-sm text-neutral-500">Add your bank, cash or wallet account to start tracking money.</p></div> : null}</section>
  </div></main>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="text-sm"><span className="mb-1.5 block font-medium text-neutral-600">{label}</span>{children}</label>; }
