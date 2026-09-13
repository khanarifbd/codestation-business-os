"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, Plus, RotateCcw, SlidersHorizontal } from "lucide-react";

import { AccountingNav } from "@/components/accounting-nav";
import { SearchableSelect } from "@/components/searchable-select";
import { getApiErrorMessage } from "@/lib/api-error";

type LedgerAccount = { id: string; code: string; name: string; category: "asset" | "liability" | "equity" | "income" | "expense"; subtype: string | null; normal_balance: "debit" | "credit"; parent_id: string | null; system_key: string | null; is_system: boolean; is_active: boolean; allow_manual_posting: boolean; notes: string | null };
type TrialBalance = { total_debit: string; total_credit: string; rows: Array<{ ledger_account_id: string; code: string; name: string; category: LedgerAccount["category"]; debit: string; credit: string; balance: string }> };
type Journal = { id: string; entry_number: string; entry_date: string; status: string; source_type: string; source_id: string | null; reference: string | null; memo: string | null; total_debit: string; total_credit: string; created_at: string; posted_at: string; lines: Array<{ id: string; account_code: string; account_name: string; description: string | null; currency: string; debit: string; credit: string; original_amount: string }> };

const categories: LedgerAccount["category"][] = ["asset", "liability", "equity", "income", "expense"];
function money(value: string | number) { return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function pretty(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (match) => match.toUpperCase()); }

export default function AdvancedAccountingPage() {
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [trial, setTrial] = useState<TrialBalance | null>(null);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [form, setForm] = useState({ code: "", name: "", category: "asset" as LedgerAccount["category"], subtype: "", normal_balance: "debit" as "debit" | "credit", parent_id: "", notes: "" });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const sync = await fetch("/api/accounting/sync", { method: "POST" });
      if (!sync.ok && sync.status !== 403) {
        const payload = await sync.json().catch(() => null);
        setMessage(payload ? `Sync note: ${getApiErrorMessage(payload, "Accounting sync needs review")}` : null);
      }
      const [accountResponse, trialResponse, journalResponse] = await Promise.all([
        fetch("/api/accounting/chart-of-accounts", { cache: "no-store" }),
        fetch("/api/accounting/trial-balance", { cache: "no-store" }),
        fetch("/api/accounting/journals?limit=100", { cache: "no-store" }),
      ]);
      const [accountPayload, trialPayload, journalPayload] = await Promise.all([accountResponse.json(), trialResponse.json(), journalResponse.json()]);
      if (!accountResponse.ok) throw new Error(getApiErrorMessage(accountPayload, "Could not load chart of accounts"));
      if (!trialResponse.ok) throw new Error(getApiErrorMessage(trialPayload, "Could not load trial balance"));
      if (!journalResponse.ok) throw new Error(getApiErrorMessage(journalPayload, "Could not load journals"));
      setAccounts(accountPayload); setTrial(trialPayload); setJournals(journalPayload);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load advanced accounting"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const balanced = useMemo(() => Number(trial?.total_debit ?? 0) === Number(trial?.total_credit ?? 0), [trial]);
  const parentOptions = useMemo(() => accounts.filter((account) => account.category === form.category && account.is_active).map((account) => ({ value: account.id, label: `${account.code} · ${account.name}`, keywords: `${account.code} ${account.name} ${account.subtype ?? ""}` })), [accounts, form.category]);

  function changeCategory(category: LedgerAccount["category"]) {
    setForm((current) => ({ ...current, category, normal_balance: category === "asset" || category === "expense" ? "debit" : "credit", parent_id: "" }));
  }

  async function createAccount(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      const response = await fetch("/api/accounting/chart-of-accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, subtype: form.subtype || null, parent_id: form.parent_id || null, notes: form.notes || null }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not create ledger account"));
      setForm({ code: "", name: "", category: "asset", subtype: "", normal_balance: "debit", parent_id: "", notes: "" });
      setShowAccountForm(false); setMessage("Ledger account created."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create ledger account"); }
    finally { setSaving(false); }
  }

  async function reverse(entry: Journal) {
    setSaving(true); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/accounting/journals/${entry.id}/reverse`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not reverse journal"));
      setMessage(`${entry.entry_number} reversed with ${payload.entry_number}.`); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not reverse journal"); }
    finally { setSaving(false); }
  }

  return <main className="p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-7xl space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Finance & Accounts</p><h1 className="mt-1 text-3xl font-semibold">Advanced accounting</h1><p className="mt-2 text-sm text-neutral-500">For accountants and advanced users only. Daily business operations belong in the normal Finance & Accounts screens.</p></div><div className="flex flex-wrap gap-2"><Link href="/dashboard/accounting/advanced/adjustment" className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2.5 text-sm font-medium"><SlidersHorizontal className="size-4" />New adjustment</Link><button onClick={() => setShowAccountForm((value) => !value)} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2.5 text-sm font-medium"><Plus className="size-4" />Ledger account</button></div></div>
    <AccountingNav />
    {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    {message ? <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-600">{message}</div> : null}

    <section className="grid gap-4 lg:grid-cols-3"><div className="rounded-2xl border bg-white p-5 lg:col-span-2"><div className="flex items-center justify-between"><div><h2 className="font-semibold">Trial balance</h2><p className="mt-1 text-sm text-neutral-500">Every posted entry must remain balanced.</p></div><span className={`rounded-full px-3 py-1 text-xs font-medium ${balanced ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{balanced ? "Balanced" : "Needs review"}</span></div><div className="mt-4 grid grid-cols-2 gap-3"><Small label="Total debit" value={money(trial?.total_debit ?? 0)} /><Small label="Total credit" value={money(trial?.total_credit ?? 0)} /></div><div className="mt-4 max-h-72 overflow-auto"><table className="min-w-full text-sm"><thead className="sticky top-0 bg-white"><tr className="border-b text-left text-xs uppercase text-neutral-400"><th className="px-2 py-3">Code</th><th>Account</th><th>Debit</th><th>Credit</th></tr></thead><tbody>{trial?.rows.filter((row) => Number(row.debit) || Number(row.credit)).map((row) => <tr key={row.ledger_account_id} className="border-b last:border-0"><td className="px-2 py-3 font-mono text-xs">{row.code}</td><td>{row.name}</td><td>{money(row.debit)}</td><td>{money(row.credit)}</td></tr>)}</tbody></table>{!loading && trial?.rows.every((row) => !Number(row.debit) && !Number(row.credit)) ? <p className="py-10 text-center text-sm text-neutral-400">No posted journals yet.</p> : null}</div></div><div className="rounded-2xl border bg-white p-5"><BookOpen className="size-5" /><h2 className="mt-3 font-semibold">Safe controls</h2><div className="mt-4 space-y-3 text-sm text-neutral-500"><p>Operational screens create accounting records automatically.</p><p>Closed periods reject new postings.</p><p>System ledger codes are protected.</p><p>Use reversal instead of deleting a posted journal.</p><p>Use Adjustment only for accountant-approved corrections.</p></div></div></section>

    <section className="rounded-2xl border bg-white p-5"><h2 className="font-semibold">Journal history</h2><p className="mt-1 text-sm text-neutral-500">Trace accounting entries back to the business event that created them.</p><div className="mt-4 overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="border-b text-left text-xs uppercase text-neutral-400"><th className="px-2 py-3">Entry</th><th>Date</th><th>Source</th><th>Reference</th><th>Debit</th><th>Credit</th><th></th></tr></thead><tbody>{journals.map((journal) => <tr key={journal.id} className="border-b last:border-0"><td className="px-2 py-3"><button onClick={() => setExpanded(expanded === journal.id ? null : journal.id)} className="font-medium hover:underline">{journal.entry_number}</button>{expanded === journal.id ? <div className="mt-2 space-y-1 text-xs text-neutral-500">{journal.lines.map((line) => <p key={line.id}>{line.account_code} · {line.account_name} — Dr {money(line.debit)} / Cr {money(line.credit)} {line.currency}</p>)}</div> : null}</td><td>{journal.entry_date}</td><td>{pretty(journal.source_type)}</td><td>{journal.reference || "—"}</td><td>{money(journal.total_debit)}</td><td>{money(journal.total_credit)}</td><td className="text-right">{journal.source_type !== "reversal" ? <button disabled={saving} onClick={() => void reverse(journal)} className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs"><RotateCcw className="size-3.5" />Reverse</button> : <span className="text-xs text-neutral-400">Reversal</span>}</td></tr>)}</tbody></table></div></section>

    {showAccountForm ? <section className="rounded-2xl border bg-white p-5"><h2 className="font-semibold">Create ledger account</h2><p className="mt-1 text-sm text-neutral-500">Only add a Chart of Accounts entry when an accountant or reporting requirement needs it.</p><form onSubmit={createAccount} className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <Field label="Code"><input required value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
      <Field label="Name"><input required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
      <Field label="Category"><select value={form.category} onChange={(event) => changeCategory(event.target.value as LedgerAccount["category"])} className="w-full rounded-xl border bg-white px-3 py-2.5">{categories.map((category) => <option key={category} value={category}>{pretty(category)}</option>)}</select></Field>
      <Field label="Subtype"><input value={form.subtype} onChange={(event) => setForm((current) => ({ ...current, subtype: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
      <Field label="Normal balance"><select value={form.normal_balance} onChange={(event) => setForm((current) => ({ ...current, normal_balance: event.target.value as "debit" | "credit" }))} className="w-full rounded-xl border bg-white px-3 py-2.5"><option value="debit">Debit</option><option value="credit">Credit</option></select></Field>
      <SearchableSelect label="Parent account" value={form.parent_id} onValueChange={(value) => setForm((current) => ({ ...current, parent_id: value }))} options={parentOptions} placeholder="No parent" searchPlaceholder="Search parent account..." />
      <div className="flex justify-end lg:col-span-3"><button disabled={saving} className="rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? "Saving…" : "Create ledger account"}</button></div>
    </form></section> : null}

    <section className="rounded-2xl border bg-white p-5"><div className="flex items-center justify-between"><div><h2 className="font-semibold">Chart of Accounts</h2><p className="mt-1 text-sm text-neutral-500">System and custom accounting accounts.</p></div><span className="text-sm text-neutral-400">{accounts.length} accounts</span></div><div className="mt-4 overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="border-b text-left text-xs uppercase text-neutral-400"><th className="px-2 py-3">Code</th><th>Name</th><th>Category</th><th>Normal</th><th>Type</th></tr></thead><tbody>{accounts.map((account) => <tr key={account.id} className="border-b last:border-0"><td className="px-2 py-3 font-mono text-xs">{account.code}</td><td>{account.name}</td><td>{pretty(account.category)}</td><td>{pretty(account.normal_balance)}</td><td className="text-neutral-500">{account.is_system ? "System" : "Custom"}</td></tr>)}</tbody></table></div></section>
  </div></main>;
}

function Small({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-neutral-50 p-4"><p className="text-xs uppercase text-neutral-400">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="text-sm"><span className="mb-1.5 block font-medium text-neutral-600">{label}</span>{children}</label>; }
