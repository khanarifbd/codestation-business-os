"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Building2, FolderKanban, HandCoins, ReceiptText, Search, Users } from "lucide-react";

import { AccountingNav } from "@/components/accounting-nav";
import { MoneyInput } from "@/components/money-input";
import { SearchableSelect } from "@/components/searchable-select";
import { getApiErrorMessage } from "@/lib/api-error";

type Purpose = "company" | "project" | "client";
type Account = { id: string; name: string; currency: string; current_balance: string | number; is_active: boolean };
type Category = { id: string; name: string; cost_type: string; is_active: boolean };
type Vendor = { id: string; name: string; is_active: boolean };
type Client = { id: string; code: string; name: string; currency: string | null };
type Project = { id: string; number: string; name: string; client_id: string; client_name: string; currency: string; status: string };
type Meta = { accounts: Account[]; categories: Category[]; vendors: Vendor[]; clients: Client[]; projects: Project[] };
type Expense = { id: string; expense_number: string; description: string; expense_date: string; category_name: string; account_name: string; client_name: string | null; project_name: string | null; expense_currency: string; expense_amount: string | number; status: string };

function today() { return new Date().toISOString().slice(0, 10); }
function money(value: string | number, currency: string) { return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

const purposes = [
  { value: "company" as Purpose, title: "Company expense", help: "Office, software, rent, utilities and general business costs", icon: Building2 },
  { value: "project" as Purpose, title: "Project expense", help: "Cost directly related to a project", icon: FolderKanban },
  { value: "client" as Purpose, title: "Client-related expense", help: "Cost incurred for a client outside a specific project", icon: Users },
];

export function MoneyOutWorkspace() {
  const [purpose, setPurpose] = useState<Purpose>("company");
  const [meta, setMeta] = useState<Meta>({ accounts: [], categories: [], vendors: [], clients: [], projects: [] });
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({ project_id: "", client_id: "", category_id: "", vendor_id: "", account_id: "", expense_amount: "", account_amount: "", expense_date: today(), description: "", payment_method: "bank_transfer", reference: "", tax_amount: "0", notes: "" });
  const [expenseQuery, setExpenseQuery] = useState("");
  const [expensePurposeFilter, setExpensePurposeFilter] = useState<"all" | Purpose>("all");
  const [expenseCurrencyFilter, setExpenseCurrencyFilter] = useState("all");
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [metaResponse, expenseResponse] = await Promise.all([
        fetch("/api/finance/expense-meta", { cache: "no-store" }),
        fetch("/api/finance/expenses?status=posted&limit=50", { cache: "no-store" }),
      ]);
      const metaPayload = await metaResponse.json();
      const expensePayload = await expenseResponse.json();
      if (!metaResponse.ok) throw new Error(getApiErrorMessage(metaPayload, "Could not load expense setup"));
      if (!expenseResponse.ok) throw new Error(getApiErrorMessage(expensePayload, "Could not load expenses"));
      setMeta(metaPayload);
      setExpenses(expensePayload.items ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load money-out workspace");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const account = meta.accounts.find((item) => item.id === form.account_id) ?? null;
  const project = meta.projects.find((item) => item.id === form.project_id) ?? null;
  const client = meta.clients.find((item) => item.id === (purpose === "project" ? project?.client_id : form.client_id)) ?? null;
  const expenseCurrency = purpose === "project" ? (project?.currency ?? account?.currency ?? "") : purpose === "client" ? (client?.currency ?? account?.currency ?? "") : (account?.currency ?? "");
  const crossCurrency = Boolean(account && expenseCurrency && account.currency !== expenseCurrency);
  const projects = meta.projects.filter((item) => item.status !== "cancelled");

  const projectOptions = useMemo(() => projects.map((item) => ({ value: item.id, label: `${item.number} · ${item.name} · ${item.client_name}`, keywords: `${item.number} ${item.name} ${item.client_name} ${item.currency}` })), [projects]);
  const clientOptions = useMemo(() => meta.clients.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}`, keywords: `${item.code} ${item.name} ${item.currency ?? ""}` })), [meta.clients]);
  const categoryOptions = useMemo(() => meta.categories.filter((item) => item.is_active).map((item) => ({ value: item.id, label: item.name, keywords: item.cost_type })), [meta.categories]);
  const accountOptions = useMemo(() => meta.accounts.filter((item) => item.is_active).map((item) => ({ value: item.id, label: `${item.name} · ${money(item.current_balance, item.currency)}`, keywords: `${item.name} ${item.currency}` })), [meta.accounts]);
  const vendorOptions = useMemo(() => meta.vendors.filter((item) => item.is_active).map((item) => ({ value: item.id, label: item.name })), [meta.vendors]);
  const expenseCurrencies = useMemo(() => Array.from(new Set(expenses.map((expense) => expense.expense_currency))), [expenses]);
  const expenseCategories = useMemo(() => Array.from(new Set(expenses.map((expense) => expense.category_name))).sort(), [expenses]);
  const filteredExpenses = useMemo(() => {
    const needle = expenseQuery.trim().toLowerCase();
    return expenses.filter((expense) => {
      if (needle && !`${expense.expense_number} ${expense.description} ${expense.category_name} ${expense.account_name} ${expense.client_name ?? ""} ${expense.project_name ?? ""} ${expense.expense_currency}`.toLowerCase().includes(needle)) return false;
      const expensePurpose: Purpose = expense.project_name ? "project" : expense.client_name ? "client" : "company";
      if (expensePurposeFilter !== "all" && expensePurpose !== expensePurposeFilter) return false;
      if (expenseCurrencyFilter !== "all" && expense.expense_currency !== expenseCurrencyFilter) return false;
      if (expenseCategoryFilter !== "all" && expense.category_name !== expenseCategoryFilter) return false;
      return true;
    });
  }, [expenseCategoryFilter, expenseCurrencyFilter, expensePurposeFilter, expenseQuery, expenses]);
  const expenseTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const expense of filteredExpenses) totals.set(expense.expense_currency, (totals.get(expense.expense_currency) ?? 0) + Number(expense.expense_amount || 0));
    return [...totals.entries()];
  }, [filteredExpenses]);

  function changePurpose(next: Purpose) {
    setPurpose(next);
    setForm((current) => ({ ...current, project_id: "", client_id: "", account_amount: "" }));
    setMessage(null); setError(null);
  }
  function clearExpenseFilters() { setExpenseQuery(""); setExpensePurposeFilter("all"); setExpenseCurrencyFilter("all"); setExpenseCategoryFilter("all"); }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!account) return;
    setSaving(true); setError(null); setMessage(null);
    try {
      const body = {
        description: form.description,
        category_id: form.category_id,
        account_id: account.id,
        vendor_id: form.vendor_id || null,
        client_id: purpose === "client" ? form.client_id : null,
        project_id: purpose === "project" ? form.project_id : null,
        expense_date: form.expense_date,
        expense_currency: expenseCurrency,
        expense_amount: Number(form.expense_amount),
        account_amount: crossCurrency ? Number(form.account_amount) : null,
        tax_amount: Number(form.tax_amount || 0),
        payment_method: form.payment_method,
        reference: form.reference || null,
        notes: form.notes || null,
      };
      const response = await fetch("/api/finance/expenses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not record expense"));
      setMessage(`Expense ${payload.expense_number} recorded. Account balance, project/client profitability and accounting records were updated.`);
      setForm({ project_id: "", client_id: "", category_id: "", vendor_id: "", account_id: "", expense_amount: "", account_amount: "", expense_date: today(), description: "", payment_method: "bank_transfer", reference: "", tax_amount: "0", notes: "" });
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not record expense"); }
    finally { setSaving(false); }
  }

  return <main className="p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-7xl space-y-6">
    <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Finance & Accounts</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Money out</h1><p className="mt-2 max-w-3xl text-sm text-neutral-500">Tell Business OS what the payment was for. Project, client and company expense tracking happens automatically.</p></div>
    <AccountingNav />
    {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
    <section className="rounded-2xl border bg-white p-5"><h2 className="text-lg font-semibold">What was this payment for?</h2><p className="mt-1 text-sm text-neutral-500">Choose the business purpose first. Only relevant fields will be shown.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{purposes.map(({ value, title, help, icon: Icon }) => <button key={value} type="button" onClick={() => changePurpose(value)} className={`rounded-2xl border p-4 text-left ${purpose === value ? "border-neutral-950 bg-neutral-950 text-white" : "hover:bg-neutral-50"}`}><Icon className="size-5" /><p className="mt-3 font-semibold">{title}</p><p className={`mt-1 text-xs ${purpose === value ? "text-neutral-300" : "text-neutral-500"}`}>{help}</p></button>)}<Link href="/dashboard/accounting/payables" className="rounded-2xl border p-4 hover:bg-neutral-50"><ReceiptText className="size-5" /><p className="mt-3 font-semibold">Supplier bill payment</p><p className="mt-1 text-xs text-neutral-500">Pay an existing vendor bill without creating a second expense.</p></Link><Link href="/dashboard/accounting/loans" className="rounded-2xl border p-4 hover:bg-neutral-50"><HandCoins className="size-5" /><p className="mt-3 font-semibold">Loan repayment</p><p className="mt-1 text-xs text-neutral-500">Split principal, interest and fees correctly.</p></Link></div>
      <form onSubmit={submit} className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {purpose === "project" ? <div><SearchableSelect label="Project" required clearable={false} value={form.project_id} onValueChange={(value) => setForm((current) => ({ ...current, project_id: value }))} options={projectOptions} placeholder="Select project" searchPlaceholder="Search project or client..." />{project ? <Hint>Client: {project.client_name} · Project currency: {project.currency}</Hint> : null}</div> : null}
        {purpose === "client" ? <SearchableSelect label="Client" required clearable={false} value={form.client_id} onValueChange={(value) => setForm((current) => ({ ...current, client_id: value }))} options={clientOptions} placeholder="Select client" searchPlaceholder="Search client..." /> : null}
        <SearchableSelect label="Expense category" required clearable={false} value={form.category_id} onValueChange={(value) => setForm((current) => ({ ...current, category_id: value }))} options={categoryOptions} placeholder="Select category" searchPlaceholder="Search expense category..." />
        <SearchableSelect label="Paid from / charged to" required clearable={false} value={form.account_id} onValueChange={(value) => setForm((current) => ({ ...current, account_id: value, account_amount: "" }))} options={accountOptions} placeholder="Select account" searchPlaceholder="Search account..." />
        <MoneyInput label="Expense amount" currency={expenseCurrency} required min={0.01} value={form.expense_amount} onValueChange={(value) => setForm((current) => ({ ...current, expense_amount: value }))} />
        {crossCurrency ? <MoneyInput label={`Actual deducted from ${account?.name ?? "account"}`} currency={account?.currency} required min={0.01} value={form.account_amount} onValueChange={(value) => setForm((current) => ({ ...current, account_amount: value }))} hint="Use the exact amount shown by the bank/wallet. Business OS calculates the effective exchange rate." /> : null}
        <Field label="Description"><input required value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder={purpose === "project" ? "Hosting, design asset, contractor…" : "What did the business pay for?"} className="w-full rounded-xl border px-3 py-2.5" /></Field>
        <div><SearchableSelect label="Vendor / supplier (optional)" value={form.vendor_id} onValueChange={(value) => setForm((current) => ({ ...current, vendor_id: value }))} options={vendorOptions} placeholder="No vendor" searchPlaceholder="Search vendor..." /><Hint>Use Payables instead if this is payment against a previously recorded vendor bill.</Hint></div>
        <Field label="Date"><input required type="date" value={form.expense_date} onChange={(event) => setForm((current) => ({ ...current, expense_date: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
        <Field label="Payment method"><select value={form.payment_method} onChange={(event) => setForm((current) => ({ ...current, payment_method: event.target.value }))} className="w-full rounded-xl border bg-white px-3 py-2.5"><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="card">Card</option><option value="payoneer">Payoneer</option><option value="wise">Wise</option><option value="stripe">Stripe</option><option value="paypal">PayPal</option><option value="fiverr">Fiverr</option><option value="other">Other</option></select></Field>
        <MoneyInput label="Tax included (optional)" currency={expenseCurrency} min={0} value={form.tax_amount} onValueChange={(value) => setForm((current) => ({ ...current, tax_amount: value }))} />
        <Field label="Reference (optional)"><input value={form.reference} onChange={(event) => setForm((current) => ({ ...current, reference: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
        <div className="flex justify-end md:col-span-2 lg:col-span-3"><button disabled={saving || loading} className="inline-flex items-center gap-2 rounded-xl bg-neutral-950 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"><ArrowUpRight className="size-4" />{saving ? "Saving…" : "Confirm payment"}</button></div>
      </form>
    </section>
    <section className="overflow-hidden rounded-2xl border bg-white">
      <div className="border-b p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><h2 className="font-semibold">Expense history</h2><p className="mt-1 text-sm text-neutral-500">Search and filter company, project and client-related expenses from one source of truth.</p></div><div className="flex flex-wrap gap-2">{expenseTotals.map(([currency, value]) => <span key={currency} className="rounded-full bg-neutral-100 px-3 py-1.5 text-xs font-medium">{money(value, currency)}</span>)}</div></div></div>
      <div className="border-b bg-neutral-50/60 p-4"><div className="grid gap-3 lg:grid-cols-[minmax(250px,1.5fr)_repeat(3,minmax(150px,0.7fr))_auto]">
        <label className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400"/><input value={expenseQuery} onChange={(event) => setExpenseQuery(event.target.value)} placeholder="Search expense, project, client, account..." className="h-11 w-full rounded-xl border bg-white pl-10 pr-3 text-sm outline-none focus:border-neutral-500"/></label>
        <select value={expensePurposeFilter} onChange={(event) => setExpensePurposeFilter(event.target.value as "all" | Purpose)} className="h-11 rounded-xl border bg-white px-3 text-sm"><option value="all">All purposes</option><option value="company">Company</option><option value="project">Project</option><option value="client">Client</option></select>
        <select value={expenseCategoryFilter} onChange={(event) => setExpenseCategoryFilter(event.target.value)} className="h-11 rounded-xl border bg-white px-3 text-sm"><option value="all">All categories</option>{expenseCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select>
        <select value={expenseCurrencyFilter} onChange={(event) => setExpenseCurrencyFilter(event.target.value)} className="h-11 rounded-xl border bg-white px-3 text-sm"><option value="all">All currencies</option>{expenseCurrencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select>
        <button type="button" onClick={clearExpenseFilters} disabled={!expenseQuery && expensePurposeFilter === "all" && expenseCurrencyFilter === "all" && expenseCategoryFilter === "all"} className="h-11 rounded-xl border bg-white px-4 text-sm font-medium disabled:opacity-40">Clear</button>
      </div><p className="mt-3 text-xs text-neutral-400">Showing {filteredExpenses.length} of {expenses.length} recent expenses</p></div>
      <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="border-b text-left text-xs uppercase tracking-wide text-neutral-400"><th className="px-4 py-3">Date</th><th className="px-4 py-3">Expense</th><th className="px-4 py-3">Purpose</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">Account</th><th className="px-4 py-3 text-right">Amount</th></tr></thead><tbody>{filteredExpenses.map((expense) => <tr key={expense.id} className="border-b last:border-0 hover:bg-neutral-50/60"><td className="px-4 py-3 text-neutral-500">{expense.expense_date}</td><td className="px-4 py-3"><p className="font-medium">{expense.description}</p><p className="text-xs font-medium text-neutral-400">{expense.expense_number}</p></td><td className="px-4 py-3">{expense.project_name ? `Project · ${expense.project_name}` : expense.client_name ? `Client · ${expense.client_name}` : "Company"}</td><td className="px-4 py-3">{expense.category_name}</td><td className="px-4 py-3">{expense.account_name}</td><td className="px-4 py-3 text-right font-medium">{money(expense.expense_amount, expense.expense_currency)}</td></tr>)}</tbody></table>{!loading && !filteredExpenses.length ? <div className="py-12 text-center"><ReceiptText className="mx-auto size-8 text-neutral-300"/><p className="mt-3 font-medium">No matching expenses</p><p className="mt-1 text-sm text-neutral-400">Try clearing or changing the current filters.</p></div> : null}</div>
    </section>
  </div></main>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="text-sm"><span className="mb-1.5 block font-medium text-neutral-600">{label}</span>{children}</label>; }
function Hint({ children }: { children: React.ReactNode }) { return <span className="mt-1 block text-xs font-normal text-neutral-400">{children}</span>; }
