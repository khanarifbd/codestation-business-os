"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, SlidersHorizontal } from "lucide-react";

import { AccountingNav } from "@/components/accounting-nav";
import { CurrencySelect } from "@/components/currency-select";
import { MoneyInput } from "@/components/money-input";
import { SearchableSelect } from "@/components/searchable-select";
import { getApiErrorMessage } from "@/lib/api-error";

type Account = { id: string; code: string; name: string; category: string; is_active: boolean; allow_manual_posting: boolean };
function today() { return new Date().toISOString().slice(0, 10); }

export default function AdjustmentPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({ entry_date: today(), debit_account_id: "", credit_account_id: "", amount: "", currency: "BDT", reference: "", memo: "" });

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/accounting/chart-of-accounts", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not load ledger accounts"));
      setAccounts(payload.filter((account: Account) => account.is_active && account.allow_manual_posting));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load ledger accounts"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const amount = useMemo(() => Number(form.amount || 0), [form.amount]);
  const accountOptions = useMemo(() => accounts.map((account) => ({ value: account.id, label: `${account.code} · ${account.name}`, keywords: `${account.code} ${account.name} ${account.category}` })), [accounts]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (form.debit_account_id === form.credit_account_id) { setError("Debit and credit accounts must be different"); return; }
    setSaving(true); setError(null); setMessage(null);
    try {
      const response = await fetch("/api/accounting/journals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entry_date: form.entry_date, reference: form.reference || null, memo: form.memo || "Accounting adjustment", lines: [{ ledger_account_id: form.debit_account_id, description: form.memo || "Adjustment", currency: form.currency, exchange_rate_to_base: 1, debit: amount, credit: 0, original_amount: amount }, { ledger_account_id: form.credit_account_id, description: form.memo || "Adjustment", currency: form.currency, exchange_rate_to_base: 1, debit: 0, credit: amount, original_amount: amount }] }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not post adjustment"));
      setMessage(`Adjustment ${payload.entry_number} posted. Use reversal from Advanced Accounting if it needs to be undone.`);
      setForm({ entry_date: today(), debit_account_id: "", credit_account_id: "", amount: "", currency: "BDT", reference: "", memo: "" });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not post adjustment"); }
    finally { setSaving(false); }
  }

  return <main className="p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-5xl space-y-6">
    <div><Link href="/dashboard/accounting/advanced" className="inline-flex items-center gap-2 text-sm text-neutral-500"><ArrowLeft className="size-4" />Advanced accounting</Link><p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Advanced Accounting</p><h1 className="mt-1 text-3xl font-semibold">Accounting adjustment</h1><p className="mt-2 text-sm text-neutral-500">For accountants only. Use normal Money In, Money Out, Transfers, Loans and Payables whenever the event represents a real business transaction.</p></div>
    <AccountingNav />
    {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
    <section className="rounded-2xl border bg-white p-5"><div className="flex items-center gap-3"><div className="flex size-10 items-center justify-center rounded-xl bg-neutral-100"><SlidersHorizontal className="size-5" /></div><div><h2 className="font-semibold">Post a balanced adjustment</h2><p className="mt-1 text-sm text-neutral-500">This creates one debit and one credit of the same amount.</p></div></div>
      <form onSubmit={submit} className="mt-5 grid gap-4 md:grid-cols-2">
        <Field label="Date"><input required type="date" value={form.entry_date} onChange={(event) => setForm((current) => ({ ...current, entry_date: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
        <CurrencySelect required clearable={false} value={form.currency} onValueChange={(value) => setForm((current) => ({ ...current, currency: value }))} />
        <SearchableSelect label="Debit account" required clearable={false} value={form.debit_account_id} onValueChange={(value) => setForm((current) => ({ ...current, debit_account_id: value }))} options={accountOptions.filter((option) => option.value !== form.credit_account_id)} placeholder="Select debit account" searchPlaceholder="Search ledger account..." />
        <SearchableSelect label="Credit account" required clearable={false} value={form.credit_account_id} onValueChange={(value) => setForm((current) => ({ ...current, credit_account_id: value }))} options={accountOptions.filter((option) => option.value !== form.debit_account_id)} placeholder="Select credit account" searchPlaceholder="Search ledger account..." />
        <MoneyInput label="Amount" currency={form.currency} required min={0.01} value={form.amount} onValueChange={(value) => setForm((current) => ({ ...current, amount: value }))} />
        <Field label="Reference (optional)"><input value={form.reference} onChange={(event) => setForm((current) => ({ ...current, reference: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
        <label className="text-sm md:col-span-2"><span className="mb-1.5 block font-medium text-neutral-600">Reason / memo</span><textarea required value={form.memo} onChange={(event) => setForm((current) => ({ ...current, memo: event.target.value }))} rows={3} className="w-full rounded-xl border px-3 py-2.5" placeholder="Why is this adjustment required?" /></label>
        <div className="flex justify-end md:col-span-2"><button disabled={saving || amount <= 0} className="rounded-xl bg-neutral-950 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? "Posting…" : "Post adjustment"}</button></div>
      </form>
    </section>
  </div></main>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="text-sm"><span className="mb-1.5 block font-medium text-neutral-600">{label}</span>{children}</label>; }
