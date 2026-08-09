"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";


type LedgerAccount = {
  id: string;
  code: string;
  name: string;
  category: "asset" | "liability" | "equity" | "income" | "expense";
  subtype: string | null;
  normal_balance: "debit" | "credit";
  parent_id: string | null;
  system_key: string | null;
  is_system: boolean;
  is_active: boolean;
  allow_manual_posting: boolean;
  notes: string | null;
};

type TrialBalance = {
  total_debit: string;
  total_credit: string;
  rows: Array<{
    ledger_account_id: string;
    code: string;
    name: string;
    category: LedgerAccount["category"];
    debit: string;
    credit: string;
    balance: string;
  }>;
};

const categories: LedgerAccount["category"][] = ["asset", "liability", "equity", "income", "expense"];

function money(value: string | number) {
  return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function AccountingPage() {
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [trial, setTrial] = useState<TrialBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", category: "asset" as LedgerAccount["category"], subtype: "", normal_balance: "debit" as "debit" | "credit", parent_id: "", notes: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [accountsResponse, trialResponse] = await Promise.all([
        fetch("/api/accounting/chart-of-accounts", { cache: "no-store" }),
        fetch("/api/accounting/trial-balance", { cache: "no-store" }),
      ]);
      const accountsPayload = await accountsResponse.json();
      const trialPayload = await trialResponse.json();
      if (!accountsResponse.ok) throw new Error(accountsPayload.detail ?? "Failed to load chart of accounts");
      if (!trialResponse.ok) throw new Error(trialPayload.detail ?? "Failed to load trial balance");
      setAccounts(accountsPayload);
      setTrial(trialPayload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to load accounting data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const summary = useMemo(() => categories.map((category) => ({
    category,
    count: accounts.filter((account) => account.category === category && account.is_active).length,
  })), [accounts]);

  function changeCategory(category: LedgerAccount["category"]) {
    setForm((current) => ({
      ...current,
      category,
      normal_balance: category === "asset" || category === "expense" ? "debit" : "credit",
      parent_id: "",
    }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/accounting/chart-of-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.code,
          name: form.name,
          category: form.category,
          subtype: form.subtype || null,
          normal_balance: form.normal_balance,
          parent_id: form.parent_id || null,
          notes: form.notes || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail ?? "Failed to create ledger account");
      setForm({ code: "", name: "", category: "asset", subtype: "", normal_balance: "debit", parent_id: "", notes: "" });
      setShowForm(false);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to create ledger account");
    } finally {
      setSaving(false);
    }
  }

  return <main className="p-4 sm:p-6 lg:p-8">
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">Finance foundation</p>
          <h1 className="mt-1 text-2xl font-semibold">Accounting</h1>
          <p className="mt-2 max-w-3xl text-sm text-neutral-500">Chart of Accounts, double-entry journals and trial balance. Existing bank, cash and wallet balances remain compatible while the accounting engine is rolled out.</p>
        </div>
        <button type="button" onClick={() => setShowForm((value) => !value)} className="rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-800">
          {showForm ? "Close" : "New ledger account"}
        </button>
      </div>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {summary.map((item) => <div key={item.category} className="rounded-2xl border bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">{item.category}</p>
          <p className="mt-2 text-2xl font-semibold">{item.count}</p>
          <p className="text-xs text-neutral-500">active accounts</p>
        </div>)}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border bg-white p-5 lg:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <div><h2 className="font-semibold">Trial Balance</h2><p className="mt-1 text-sm text-neutral-500">Posted journal lines in base accounting value.</p></div>
            <button type="button" onClick={() => void load()} className="rounded-lg border px-3 py-2 text-xs font-medium text-neutral-600 hover:bg-neutral-50">Refresh</button>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-neutral-50 p-4"><p className="text-xs uppercase tracking-wide text-neutral-400">Total debit</p><p className="mt-1 text-lg font-semibold">{money(trial?.total_debit ?? 0)}</p></div>
            <div className="rounded-xl bg-neutral-50 p-4"><p className="text-xs uppercase tracking-wide text-neutral-400">Total credit</p><p className="mt-1 text-lg font-semibold">{money(trial?.total_credit ?? 0)}</p></div>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr className="border-b text-left text-xs uppercase tracking-wide text-neutral-400"><th className="px-2 py-3">Code</th><th className="px-2 py-3">Account</th><th className="px-2 py-3">Debit</th><th className="px-2 py-3">Credit</th><th className="px-2 py-3">Balance</th></tr></thead>
              <tbody>{trial?.rows.filter((row) => Number(row.debit) !== 0 || Number(row.credit) !== 0).map((row) => <tr key={row.ledger_account_id} className="border-b last:border-0"><td className="px-2 py-3 font-mono text-xs">{row.code}</td><td className="px-2 py-3">{row.name}</td><td className="px-2 py-3 tabular-nums">{money(row.debit)}</td><td className="px-2 py-3 tabular-nums">{money(row.credit)}</td><td className="px-2 py-3 tabular-nums">{money(row.balance)}</td></tr>)}</tbody>
            </table>
            {!loading && trial && trial.rows.every((row) => Number(row.debit) === 0 && Number(row.credit) === 0) ? <p className="py-8 text-center text-sm text-neutral-400">No posted journals yet.</p> : null}
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-5">
          <h2 className="font-semibold">Accounting rules</h2>
          <div className="mt-4 space-y-3 text-sm text-neutral-600">
            <p>Every journal must have equal non-zero debit and credit totals.</p>
            <p>Closed accounting periods block new journal posting.</p>
            <p>System accounts cannot have their account code changed.</p>
            <p>Bank, cash and wallet accounts are mapped under Cash & Cash Equivalents during migration.</p>
          </div>
        </div>
      </section>

      {showForm ? <section className="rounded-2xl border bg-white p-5">
        <h2 className="font-semibold">Create ledger account</h2>
        <form onSubmit={submit} className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <label className="text-sm"><span className="mb-1.5 block text-neutral-500">Account code</span><input required value={form.code} onChange={(event) => setForm((value) => ({ ...value, code: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5 outline-none focus:border-neutral-500" placeholder="6300" /></label>
          <label className="text-sm"><span className="mb-1.5 block text-neutral-500">Account name</span><input required value={form.name} onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5 outline-none focus:border-neutral-500" placeholder="Software subscriptions" /></label>
          <label className="text-sm"><span className="mb-1.5 block text-neutral-500">Category</span><select value={form.category} onChange={(event) => changeCategory(event.target.value as LedgerAccount["category"])} className="w-full rounded-xl border bg-white px-3 py-2.5">{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
          <label className="text-sm"><span className="mb-1.5 block text-neutral-500">Subtype</span><input value={form.subtype} onChange={(event) => setForm((value) => ({ ...value, subtype: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5" placeholder="software_expense" /></label>
          <label className="text-sm"><span className="mb-1.5 block text-neutral-500">Normal balance</span><select value={form.normal_balance} onChange={(event) => setForm((value) => ({ ...value, normal_balance: event.target.value as "debit" | "credit" }))} className="w-full rounded-xl border bg-white px-3 py-2.5"><option value="debit">Debit</option><option value="credit">Credit</option></select></label>
          <label className="text-sm"><span className="mb-1.5 block text-neutral-500">Parent account</span><select value={form.parent_id} onChange={(event) => setForm((value) => ({ ...value, parent_id: event.target.value }))} className="w-full rounded-xl border bg-white px-3 py-2.5"><option value="">No parent</option>{accounts.filter((account) => account.category === form.category && account.is_active).map((account) => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}</select></label>
          <label className="text-sm md:col-span-2 lg:col-span-3"><span className="mb-1.5 block text-neutral-500">Notes</span><textarea value={form.notes} onChange={(event) => setForm((value) => ({ ...value, notes: event.target.value }))} className="min-h-24 w-full rounded-xl border px-3 py-2.5" /></label>
          <div className="md:col-span-2 lg:col-span-3"><button disabled={saving} className="rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? "Saving…" : "Create account"}</button></div>
        </form>
      </section> : null}

      <section className="rounded-2xl border bg-white p-5">
        <div className="flex items-center justify-between"><div><h2 className="font-semibold">Chart of Accounts</h2><p className="mt-1 text-sm text-neutral-500">Default system accounts plus organization-specific ledger accounts.</p></div><span className="text-sm text-neutral-400">{accounts.length} accounts</span></div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead><tr className="border-b text-left text-xs uppercase tracking-wide text-neutral-400"><th className="px-2 py-3">Code</th><th className="px-2 py-3">Name</th><th className="px-2 py-3">Category</th><th className="px-2 py-3">Normal</th><th className="px-2 py-3">Type</th></tr></thead>
            <tbody>{accounts.map((account) => <tr key={account.id} className="border-b last:border-0"><td className="px-2 py-3 font-mono text-xs">{account.code}</td><td className="px-2 py-3 font-medium">{account.name}</td><td className="px-2 py-3 capitalize">{account.category}</td><td className="px-2 py-3 capitalize">{account.normal_balance}</td><td className="px-2 py-3 text-neutral-500">{account.is_system ? "System" : "Custom"}</td></tr>)}</tbody>
          </table>
          {loading ? <p className="py-8 text-center text-sm text-neutral-400">Loading accounting data…</p> : null}
        </div>
      </section>
    </div>
  </main>;
}
