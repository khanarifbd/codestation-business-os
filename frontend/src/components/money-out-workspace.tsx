"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Eye,
  FolderKanban,
  HandCoins,
  ReceiptText,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  WalletCards,
  X,
} from "lucide-react";

import { AccountingNav } from "@/components/accounting-nav";
import { FinancialConfirmationDialog } from "@/components/financial-confirmation-dialog";
import { MoneyInput } from "@/components/money-input";
import { SearchableSelect } from "@/components/searchable-select";
import { AppPage, PageHeader, SectionHeader, Surface } from "@/components/ui/app-page";
import { confirmDiscardChanges, useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { getApiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/cn";

type Purpose = "company" | "project" | "client";
type Account = { id: string; name: string; currency: string; current_balance: string | number; is_active: boolean };
type Category = { id: string; name: string; cost_type: string; is_active: boolean };
type Vendor = { id: string; name: string; is_active: boolean };
type Client = { id: string; code: string; name: string; currency: string | null };
type Project = { id: string; number: string; name: string; client_id: string; client_name: string; currency: string; status: string };
type Meta = { accounts: Account[]; categories: Category[]; vendors: Vendor[]; clients: Client[]; projects: Project[] };
type Expense = {
  id: string;
  expense_number: string;
  description: string;
  expense_date: string;
  category_name: string;
  account_name: string;
  client_name: string | null;
  project_name: string | null;
  expense_currency: string;
  expense_amount: string | number;
  status: string;
  vendor_name?: string | null;
  payment_method?: string | null;
  reference?: string | null;
  tax_amount?: string | number | null;
  notes?: string | null;
  account_currency?: string | null;
  account_amount?: string | number | null;
};
type ExpenseForm = {
  project_id: string;
  client_id: string;
  category_id: string;
  vendor_id: string;
  account_id: string;
  expense_amount: string;
  account_amount: string;
  expense_date: string;
  description: string;
  payment_method: string;
  reference: string;
  tax_amount: string;
  notes: string;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function money(value: string | number, currency: string) {
  return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pretty(value: string | null | undefined) {
  return value ? value.replaceAll("_", " ").replace(/\b\w/g, (match) => match.toUpperCase()) : "—";
}

function blankForm(): ExpenseForm {
  return {
    project_id: "",
    client_id: "",
    category_id: "",
    vendor_id: "",
    account_id: "",
    expense_amount: "",
    account_amount: "",
    expense_date: today(),
    description: "",
    payment_method: "bank_transfer",
    reference: "",
    tax_amount: "0",
    notes: "",
  };
}

const purposes = [
  { value: "company" as Purpose, title: "Company expense", help: "Office, software, rent, utilities and general business costs", icon: Building2 },
  { value: "project" as Purpose, title: "Project expense", help: "Cost directly related to a project and its profitability", icon: FolderKanban },
  { value: "client" as Purpose, title: "Client-related expense", help: "Cost incurred for a client outside a specific project", icon: Users },
];

export function MoneyOutWorkspace() {
  const [purpose, setPurpose] = useState<Purpose>("company");
  const [meta, setMeta] = useState<Meta>({ accounts: [], categories: [], vendors: [], clients: [], projects: [] });
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [purposeFilter, setPurposeFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [currencyFilter, setCurrencyFilter] = useState("all");
  const [form, setForm] = useState<ExpenseForm>(blankForm());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
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
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const account = meta.accounts.find((item) => item.id === form.account_id) ?? null;
  const project = meta.projects.find((item) => item.id === form.project_id) ?? null;
  const client = meta.clients.find((item) => item.id === (purpose === "project" ? project?.client_id : form.client_id)) ?? null;
  const category = meta.categories.find((item) => item.id === form.category_id) ?? null;
  const vendor = meta.vendors.find((item) => item.id === form.vendor_id) ?? null;
  const expenseCurrency = purpose === "project"
    ? (project?.currency ?? account?.currency ?? "")
    : purpose === "client"
      ? (client?.currency ?? account?.currency ?? "")
      : (account?.currency ?? "");
  const crossCurrency = Boolean(account && expenseCurrency && account.currency !== expenseCurrency);
  const projects = meta.projects.filter((item) => item.status !== "cancelled");
  const activeAccounts = meta.accounts.filter((item) => item.is_active);
  const isDirty = Boolean(
    form.project_id || form.client_id || form.category_id || form.vendor_id || form.account_id || form.expense_amount || form.account_amount || form.description || form.reference || form.notes || Number(form.tax_amount || 0) > 0,
  );
  useUnsavedChanges(isDirty && !saving);

  const filteredExpenses = useMemo(() => {
    const query = search.trim().toLowerCase();
    return expenses.filter((expense) => {
      const expensePurpose = expense.project_name ? "project" : expense.client_name ? "client" : "company";
      return (
        (!query || `${expense.expense_number} ${expense.description} ${expense.project_name ?? ""} ${expense.client_name ?? ""} ${expense.account_name} ${expense.vendor_name ?? ""}`.toLowerCase().includes(query))
        && (purposeFilter === "all" || expensePurpose === purposeFilter)
        && (categoryFilter === "all" || expense.category_name === categoryFilter)
        && (currencyFilter === "all" || expense.expense_currency === currencyFilter)
      );
    });
  }, [expenses, search, purposeFilter, categoryFilter, currencyFilter]);

  const currencies = useMemo(() => Array.from(new Set(expenses.map((expense) => expense.expense_currency))).sort(), [expenses]);
  const expenseCategories = useMemo(() => Array.from(new Set(expenses.map((expense) => expense.category_name))).sort(), [expenses]);
  const totals = useMemo(() => filteredExpenses.reduce<Record<string, number>>((result, expense) => {
    result[expense.expense_currency] = (result[expense.expense_currency] ?? 0) + Number(expense.expense_amount || 0);
    return result;
  }, {}), [filteredExpenses]);

  const projectOptions = useMemo(() => projects.map((item) => ({
    value: item.id,
    label: `${item.number} · ${item.name} · ${item.client_name}`,
    keywords: `${item.number} ${item.name} ${item.client_name} ${item.currency}`,
  })), [projects]);
  const clientOptions = useMemo(() => meta.clients.map((item) => ({
    value: item.id,
    label: `${item.code} · ${item.name}`,
    keywords: `${item.code} ${item.name} ${item.currency ?? ""}`,
  })), [meta.clients]);
  const categoryOptions = useMemo(() => meta.categories.filter((item) => item.is_active).map((item) => ({
    value: item.id,
    label: item.name,
    keywords: item.cost_type,
  })), [meta.categories]);
  const accountOptions = useMemo(() => activeAccounts.map((item) => ({
    value: item.id,
    label: `${item.name} · ${money(item.current_balance, item.currency)}`,
    keywords: `${item.name} ${item.currency}`,
  })), [activeAccounts]);
  const vendorOptions = useMemo(() => meta.vendors.filter((item) => item.is_active).map((item) => ({ value: item.id, label: item.name })), [meta.vendors]);

  const effectiveRate = crossCurrency && Number(form.expense_amount) > 0 && Number(form.account_amount) > 0
    ? Number(form.account_amount) / Number(form.expense_amount)
    : null;

  function changePurpose(next: Purpose) {
    if (!confirmDiscardChanges(isDirty, "Changing expense purpose will discard the current expense form. Continue?")) return;
    setPurpose(next);
    setForm(blankForm());
    setMessage(null);
    setError(null);
    setConfirmOpen(false);
  }

  function review(event: FormEvent) {
    event.preventDefault();
    if (!account) return;
    setError(null);
    setMessage(null);
    setConfirmOpen(true);
  }

  async function postExpense() {
    if (!account) return;
    setSaving(true);
    setError(null);
    setMessage(null);
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
      const response = await fetch("/api/finance/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not record expense"));
      setMessage(`Expense ${payload.expense_number} recorded. Account balance, project/client profitability and accounting records were updated.`);
      setConfirmOpen(false);
      setForm(blankForm());
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not record expense");
      setConfirmOpen(false);
    } finally {
      setSaving(false);
    }
  }

  const purposeLabel = purpose === "project"
    ? (project ? `${project.number} · ${project.name}` : "Project expense")
    : purpose === "client"
      ? (client ? `${client.code} · ${client.name}` : "Client expense")
      : "Company expense";

  const confirmationDetails = [
    { label: "Purpose", value: purposeLabel },
    { label: "Description", value: form.description || "—" },
    { label: "Category", value: category?.name || "—" },
    ...(vendor ? [{ label: "Vendor / supplier", value: vendor.name }] : []),
    { label: "Expense amount", value: money(form.expense_amount || 0, expenseCurrency || account?.currency || ""), emphasis: true },
    ...(crossCurrency && account ? [{ label: "Actual account deduction", value: money(form.account_amount || 0, account.currency), emphasis: true }] : []),
    { label: "Paid from", value: account?.name || "—" },
    { label: "Payment method", value: pretty(form.payment_method) },
    { label: "Date", value: form.expense_date },
    ...(form.reference ? [{ label: "Reference", value: form.reference }] : []),
  ];

  const filtersActive = Boolean(search || purposeFilter !== "all" || categoryFilter !== "all" || currencyFilter !== "all");

  return (
    <AppPage width="wide">
      <div className="space-y-6">
        <PageHeader
          eyebrow="Finance & Accounts"
          title="Money out"
          description="Record what the business paid for and where the money came from. Company, project and client costs stay distinct while the account balance and accounting records update together."
          meta={
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2.5 py-1"><ShieldCheck className="size-3.5 text-emerald-600" /> Posted expenses are auditable</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2.5 py-1"><WalletCards className="size-3.5" /> Cross-currency deductions stay explicit</span>
            </>
          }
        />
        <AccountingNav />

        {error ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between">
            <span>{error}</span>
            <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 self-start rounded-xl border border-red-200 bg-white px-3 py-2 font-medium text-red-700 sm:self-auto">
              <RefreshCw className="size-4" /> Retry
            </button>
          </div>
        ) : null}

        {message ? (
          <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            <span>{message}</span>
          </div>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-3">
          <Surface className="p-4 sm:p-5">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-neutral-400">Posted expenses</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-neutral-950">{loading ? "—" : expenses.length}</p>
            <p className="mt-1 text-xs text-neutral-500">Latest posted records loaded</p>
          </Surface>
          <Surface className="p-4 sm:p-5">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-neutral-400">Payment accounts</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-neutral-950">{loading ? "—" : activeAccounts.length}</p>
            <p className="mt-1 text-xs text-neutral-500">Active accounts available to charge</p>
          </Surface>
          <Surface className="p-4 sm:p-5">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-neutral-400">Currencies in history</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-neutral-950">{loading ? "—" : currencies.length}</p>
            <p className="mt-1 text-xs text-neutral-500">Never combined without conversion</p>
          </Surface>
        </section>

        <Surface className="overflow-hidden">
          <div className="border-b border-neutral-100 p-5 sm:p-6">
            <SectionHeader
              title="1. What was this payment for?"
              description="Choose the real business purpose first. This controls profitability attribution and which supporting fields are required."
            />
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {purposes.map(({ value, title, help, icon: Icon }) => {
                const active = purpose === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => changePurpose(value)}
                    aria-pressed={active}
                    className={cn(
                      "group rounded-2xl border p-4 text-left transition sm:p-5",
                      active
                        ? "border-neutral-950 bg-neutral-950 text-white shadow-sm"
                        : "border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50",
                    )}
                  >
                    <div className={cn("flex size-9 items-center justify-center rounded-xl", active ? "bg-white/10" : "bg-neutral-100 text-neutral-700")}>
                      <Icon className="size-4.5" />
                    </div>
                    <p className="mt-4 text-sm font-semibold">{title}</p>
                    <p className={cn("mt-1 text-xs leading-5", active ? "text-neutral-300" : "text-neutral-500")}>{help}</p>
                  </button>
                );
              })}
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Link href="/dashboard/accounting/payables" className="group flex items-center justify-between gap-4 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 transition hover:border-amber-300">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white text-amber-700 shadow-sm"><ReceiptText className="size-4.5" /></div>
                  <div>
                    <p className="text-sm font-semibold text-neutral-950">Pay an existing supplier bill</p>
                    <p className="mt-1 text-xs leading-5 text-neutral-600">Use Payables so the bill is settled without creating a duplicate expense.</p>
                  </div>
                </div>
                <ArrowRight className="size-4 shrink-0 text-neutral-400 transition group-hover:translate-x-0.5" />
              </Link>
              <Link href="/dashboard/accounting/loans" className="group flex items-center justify-between gap-4 rounded-2xl border border-blue-200 bg-blue-50/60 p-4 transition hover:border-blue-300">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white text-blue-700 shadow-sm"><HandCoins className="size-4.5" /></div>
                  <div>
                    <p className="text-sm font-semibold text-neutral-950">Repay a loan</p>
                    <p className="mt-1 text-xs leading-5 text-neutral-600">Use Loans so principal, interest and charges are split correctly.</p>
                  </div>
                </div>
                <ArrowRight className="size-4 shrink-0 text-neutral-400 transition group-hover:translate-x-0.5" />
              </Link>
            </div>
          </div>

          <form onSubmit={review}>
            <div className="grid xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="space-y-6 p-5 sm:p-6">
                <div>
                  <SectionHeader
                    title="2. Expense details"
                    description="Describe the cost, choose its category and connect it to the project or client when relevant."
                  />
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    {purpose === "project" ? (
                      <div className="md:col-span-2">
                        <SearchableSelect
                          label="Project"
                          required
                          clearable={false}
                          value={form.project_id}
                          onValueChange={(value) => setForm((current) => ({ ...current, project_id: value }))}
                          options={projectOptions}
                          placeholder="Select project"
                          searchPlaceholder="Search project or client..."
                        />
                        {project ? <Hint>Client: {project.client_name} · Project currency: {project.currency}</Hint> : null}
                      </div>
                    ) : null}

                    {purpose === "client" ? (
                      <div className="md:col-span-2">
                        <SearchableSelect
                          label="Client"
                          required
                          clearable={false}
                          value={form.client_id}
                          onValueChange={(value) => setForm((current) => ({ ...current, client_id: value }))}
                          options={clientOptions}
                          placeholder="Select client"
                          searchPlaceholder="Search client..."
                        />
                        {client?.currency ? <Hint>Client currency: {client.currency}</Hint> : null}
                      </div>
                    ) : null}

                    <SearchableSelect
                      label="Expense category"
                      required
                      clearable={false}
                      value={form.category_id}
                      onValueChange={(value) => setForm((current) => ({ ...current, category_id: value }))}
                      options={categoryOptions}
                      placeholder="Select category"
                      searchPlaceholder="Search expense category..."
                    />

                    <div>
                      <SearchableSelect
                        label="Vendor / supplier (optional)"
                        value={form.vendor_id}
                        onValueChange={(value) => setForm((current) => ({ ...current, vendor_id: value }))}
                        options={vendorOptions}
                        placeholder="No vendor"
                        searchPlaceholder="Search vendor..."
                      />
                      <Hint>For a previously recorded supplier bill, pay from Payables instead.</Hint>
                    </div>

                    <div className="md:col-span-2">
                      <Field label="Description">
                        <input
                          required
                          value={form.description}
                          onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                          placeholder={purpose === "project" ? "Hosting, design asset, contractor…" : "What did the business pay for?"}
                          className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100"
                        />
                      </Field>
                    </div>
                  </div>
                </div>

                <div className="border-t border-neutral-100 pt-6">
                  <SectionHeader
                    title="3. Payment details"
                    description="Choose the account actually charged and enter the exact financial amounts shown by the bank, wallet or card."
                  />
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div className="md:col-span-2">
                      <SearchableSelect
                        label="Paid from / charged to"
                        required
                        clearable={false}
                        value={form.account_id}
                        onValueChange={(value) => setForm((current) => ({ ...current, account_id: value, account_amount: "" }))}
                        options={accountOptions}
                        placeholder="Select account"
                        searchPlaceholder="Search account..."
                      />
                      {account ? <Hint>Current balance: {money(account.current_balance, account.currency)} · Account currency: {account.currency}</Hint> : null}
                    </div>

                    <MoneyInput
                      label="Expense amount"
                      currency={expenseCurrency}
                      required
                      min={0.01}
                      value={form.expense_amount}
                      onValueChange={(value) => setForm((current) => ({ ...current, expense_amount: value }))}
                    />

                    {crossCurrency ? (
                      <MoneyInput
                        label={`Actual deducted from ${account?.name ?? "account"}`}
                        currency={account?.currency}
                        required
                        min={0.01}
                        value={form.account_amount}
                        onValueChange={(value) => setForm((current) => ({ ...current, account_amount: value }))}
                        hint="Use the exact amount shown by the bank or wallet. Business OS preserves both currencies and derives the effective exchange rate."
                      />
                    ) : (
                      <Field label="Date">
                        <input
                          required
                          type="date"
                          value={form.expense_date}
                          onChange={(event) => setForm((current) => ({ ...current, expense_date: event.target.value }))}
                          className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100"
                        />
                      </Field>
                    )}

                    {crossCurrency ? (
                      <div className="md:col-span-2 rounded-2xl border border-blue-200 bg-blue-50/60 p-4 text-sm text-blue-900">
                        <p className="font-semibold">Cross-currency payment</p>
                        <p className="mt-1 text-xs leading-5 text-blue-800">
                          Expense stays in {expenseCurrency}; the selected account is reduced in {account?.currency}. Both amounts are stored separately.
                          {effectiveRate ? ` Effective rate: 1 ${expenseCurrency} = ${effectiveRate.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${account?.currency}.` : ""}
                        </p>
                      </div>
                    ) : null}

                    {crossCurrency ? (
                      <Field label="Date">
                        <input
                          required
                          type="date"
                          value={form.expense_date}
                          onChange={(event) => setForm((current) => ({ ...current, expense_date: event.target.value }))}
                          className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100"
                        />
                      </Field>
                    ) : null}

                    <Field label="Payment method">
                      <select
                        value={form.payment_method}
                        onChange={(event) => setForm((current) => ({ ...current, payment_method: event.target.value }))}
                        className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100"
                      >
                        <option value="bank_transfer">Bank transfer</option>
                        <option value="cash">Cash</option>
                        <option value="card">Card</option>
                        <option value="payoneer">Payoneer</option>
                        <option value="wise">Wise</option>
                        <option value="stripe">Stripe</option>
                        <option value="paypal">PayPal</option>
                        <option value="fiverr">Fiverr</option>
                        <option value="other">Other</option>
                      </select>
                    </Field>

                    <MoneyInput
                      label="Tax included (optional)"
                      currency={expenseCurrency}
                      min={0}
                      value={form.tax_amount}
                      onValueChange={(value) => setForm((current) => ({ ...current, tax_amount: value }))}
                    />

                    <Field label="Reference (optional)">
                      <input
                        value={form.reference}
                        onChange={(event) => setForm((current) => ({ ...current, reference: event.target.value }))}
                        placeholder="Bank reference, receipt number…"
                        className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100"
                      />
                    </Field>

                    <div className="md:col-span-2">
                      <Field label="Internal notes (optional)">
                        <textarea
                          value={form.notes}
                          onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                          placeholder="Add internal context for finance or audit review…"
                          className="min-h-24 w-full resize-y rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100"
                        />
                      </Field>
                    </div>
                  </div>
                </div>
              </div>

              <aside className="border-t border-neutral-100 bg-neutral-50/60 p-5 sm:p-6 xl:border-l xl:border-t-0">
                <div className="xl:sticky xl:top-6">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400">Posting preview</p>
                  <h3 className="mt-2 text-base font-semibold text-neutral-950">Review the financial impact</h3>
                  <p className="mt-1 text-sm leading-5 text-neutral-500">Nothing posts until you confirm the final review dialog.</p>

                  <div className="mt-5 space-y-3 rounded-2xl border border-neutral-200 bg-white p-4">
                    <PreviewRow label="Purpose" value={purposeLabel} />
                    <PreviewRow label="Category" value={category?.name || "Not selected"} />
                    <PreviewRow label="Vendor" value={vendor?.name || "None"} />
                    <PreviewRow label="Expense" value={form.expense_amount ? money(form.expense_amount, expenseCurrency || account?.currency || "") : "—"} strong />
                    {crossCurrency && account ? <PreviewRow label="Account deduction" value={form.account_amount ? money(form.account_amount, account.currency) : "—"} strong /> : null}
                    <PreviewRow label="Paid from" value={account?.name || "Not selected"} />
                    <PreviewRow label="Date" value={form.expense_date} />
                  </div>

                  {vendor ? (
                    <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">
                      If {vendor.name} already has an outstanding supplier bill, use Payables instead so the cost is not recorded twice.
                    </div>
                  ) : null}

                  {!activeAccounts.length && !loading ? (
                    <Link href="/dashboard/accounting/accounts" className="mt-4 flex items-center justify-between rounded-2xl border border-dashed border-neutral-300 bg-white p-4 text-sm font-medium text-neutral-700">
                      Add a financial account first <ArrowRight className="size-4" />
                    </Link>
                  ) : null}

                  <button
                    disabled={saving || loading || !activeAccounts.length}
                    className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ArrowUpRight className="size-4" /> Review payment
                  </button>
                </div>
              </aside>
            </div>
          </form>
        </Surface>

        <Surface className="p-5 sm:p-6">
          <SectionHeader
            title="Expense history"
            description="Search, filter and inspect posted expenses. Currency totals remain separated."
            action={
              <div className="flex flex-wrap gap-2 text-xs text-neutral-600">
                {Object.entries(totals).map(([currency, value]) => (
                  <span key={currency} className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1.5 font-medium tabular-nums">{money(value, currency)}</span>
                ))}
              </div>
            }
          />

          <div className="mt-5 grid gap-2 md:grid-cols-2 lg:grid-cols-5">
            <label className="relative lg:col-span-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search expense, project, client, account…"
                className="w-full rounded-xl border border-neutral-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100"
              />
            </label>
            <select value={purposeFilter} onChange={(event) => setPurposeFilter(event.target.value)} className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-neutral-400">
              <option value="all">All purposes</option>
              <option value="company">Company</option>
              <option value="project">Project</option>
              <option value="client">Client</option>
            </select>
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-neutral-400">
              <option value="all">All categories</option>
              {expenseCategories.map((item) => <option key={item}>{item}</option>)}
            </select>
            <select value={currencyFilter} onChange={(event) => setCurrencyFilter(event.target.value)} className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-neutral-400">
              <option value="all">All currencies</option>
              {currencies.map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3 text-xs text-neutral-400">
            <span>{filteredExpenses.length} of {expenses.length} expenses</span>
            {filtersActive ? (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setPurposeFilter("all");
                  setCategoryFilter("all");
                  setCurrencyFilter("all");
                }}
                className="font-medium text-neutral-700 transition hover:text-neutral-950"
              >
                Clear filters
              </button>
            ) : null}
          </div>

          {loading ? (
            <div className="mt-4 space-y-2">
              {[0, 1, 2, 3].map((item) => <div key={item} className="h-16 animate-pulse rounded-xl bg-neutral-100" />)}
            </div>
          ) : filteredExpenses.length ? (
            <>
              <div className="mt-4 hidden overflow-x-auto md:block">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-400">
                      <th className="px-2 py-3">Date</th>
                      <th className="px-2 py-3">Expense</th>
                      <th className="px-2 py-3">Purpose</th>
                      <th className="px-2 py-3">Category</th>
                      <th className="px-2 py-3">Account</th>
                      <th className="px-2 py-3 text-right">Amount</th>
                      <th className="px-2 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredExpenses.map((expense) => (
                      <tr key={expense.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50/70">
                        <td className="whitespace-nowrap px-2 py-3 text-neutral-500">{expense.expense_date}</td>
                        <td className="px-2 py-3">
                          <button type="button" onClick={() => setSelectedExpense(expense)} className="text-left font-semibold text-neutral-950 hover:underline">{expense.expense_number}</button>
                          <p className="mt-0.5 max-w-xs truncate text-xs text-neutral-400">{expense.description}</p>
                        </td>
                        <td className="px-2 py-3 text-neutral-600">{expense.project_name ? `Project · ${expense.project_name}` : expense.client_name ? `Client · ${expense.client_name}` : "Company"}</td>
                        <td className="px-2 py-3 text-neutral-600">{expense.category_name}</td>
                        <td className="px-2 py-3 text-neutral-600">{expense.account_name}</td>
                        <td className="whitespace-nowrap px-2 py-3 text-right font-semibold tabular-nums text-neutral-950">{money(expense.expense_amount, expense.expense_currency)}</td>
                        <td className="px-2 py-3 text-right">
                          <button type="button" onClick={() => setSelectedExpense(expense)} className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-50 hover:text-neutral-950">
                            <Eye className="size-3.5" /> Open
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 grid gap-3 md:hidden">
                {filteredExpenses.map((expense) => (
                  <button
                    key={expense.id}
                    type="button"
                    onClick={() => setSelectedExpense(expense)}
                    className="rounded-2xl border border-neutral-200 bg-white p-4 text-left transition hover:bg-neutral-50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-neutral-950">{expense.expense_number}</p>
                        <p className="mt-0.5 truncate text-xs text-neutral-500">{expense.description}</p>
                      </div>
                      <p className="shrink-0 font-semibold tabular-nums text-neutral-950">{money(expense.expense_amount, expense.expense_currency)}</p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-neutral-500">
                      <span>{expense.expense_date}</span>
                      <span>·</span>
                      <span>{expense.project_name ? `Project · ${expense.project_name}` : expense.client_name ? `Client · ${expense.client_name}` : "Company"}</span>
                      <span>·</span>
                      <span>{expense.category_name}</span>
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="mt-5 rounded-2xl border border-dashed border-neutral-300 bg-neutral-50/60 px-6 py-12 text-center">
              <ReceiptText className="mx-auto size-8 text-neutral-300" />
              <p className="mt-3 text-sm font-semibold text-neutral-800">No matching expenses</p>
              <p className="mt-1 text-sm text-neutral-500">Adjust the filters or post the first expense above.</p>
            </div>
          )}
        </Surface>
      </div>

      {selectedExpense ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/35 backdrop-blur-[1px]" role="dialog" aria-modal="true" aria-label={`Expense ${selectedExpense.expense_number}`}>
          <button type="button" className="absolute inset-0 cursor-default" onClick={() => setSelectedExpense(null)} aria-label="Close expense detail" />
          <aside className="relative h-full w-full max-w-xl overflow-y-auto bg-white p-5 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-400">Expense detail</p>
                <h2 className="mt-1.5 text-2xl font-semibold tracking-tight text-neutral-950">{selectedExpense.expense_number}</h2>
                <p className="mt-1 text-sm text-neutral-500">{selectedExpense.description}</p>
              </div>
              <button type="button" onClick={() => setSelectedExpense(null)} className="rounded-xl border border-neutral-200 p-2 text-neutral-500 transition hover:bg-neutral-50 hover:text-neutral-950" aria-label="Close">
                <X className="size-4.5" />
              </button>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <Detail label="Status" value={pretty(selectedExpense.status)} />
              <Detail label="Date" value={selectedExpense.expense_date} />
              <Detail label="Amount" value={money(selectedExpense.expense_amount, selectedExpense.expense_currency)} strong />
              <Detail label="Category" value={selectedExpense.category_name} />
              <Detail label="Account" value={selectedExpense.account_name} />
              <Detail label="Purpose" value={selectedExpense.project_name ? `Project · ${selectedExpense.project_name}` : selectedExpense.client_name ? `Client · ${selectedExpense.client_name}` : "Company"} />
              <Detail label="Vendor" value={selectedExpense.vendor_name || "—"} />
              <Detail label="Payment method" value={pretty(selectedExpense.payment_method)} />
              <Detail label="Reference" value={selectedExpense.reference || "—"} />
              <Detail label="Tax" value={selectedExpense.tax_amount != null ? money(selectedExpense.tax_amount, selectedExpense.expense_currency) : "—"} />
              {selectedExpense.account_amount != null && selectedExpense.account_currency ? <Detail label="Account deducted" value={money(selectedExpense.account_amount, selectedExpense.account_currency)} strong /> : null}
            </div>

            {selectedExpense.notes ? (
              <div className="mt-4 rounded-2xl bg-neutral-50 p-4">
                <p className="text-xs font-medium uppercase tracking-[0.1em] text-neutral-400">Internal notes</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-700">{selectedExpense.notes}</p>
              </div>
            ) : null}

            <div className="mt-5 rounded-2xl border border-neutral-200 bg-neutral-50/70 p-4 text-sm text-neutral-600">
              <div className="flex items-center gap-2 font-semibold text-neutral-950"><ShieldCheck className="size-4" /> Posted financial record</div>
              <p className="mt-2 leading-6">Correct mistakes with reversal or correction instead of silently editing posted history.</p>
            </div>

            <div className="mt-6 flex justify-end">
              <button type="button" onClick={() => setSelectedExpense(null)} className="rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50">Close</button>
            </div>
          </aside>
        </div>
      ) : null}

      <FinancialConfirmationDialog
        open={confirmOpen}
        title="Post this expense?"
        description="Check the purpose, category, account and exact amount before posting. This action reduces the selected financial account and posts the expense."
        details={confirmationDetails}
        confirmLabel="Post expense"
        loading={saving}
        warning={vendor ? `If ${vendor.name} already has an outstanding supplier bill, pay it from Payables instead. Posting here would create a new expense and could duplicate the cost.` : "After posting, corrections should use reversal/correction rather than silently changing financial history."}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={postExpense}
      />
    </AppPage>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-sm">
      <span className="mb-1.5 block font-medium text-neutral-700">{label}</span>
      {children}
    </label>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <span className="mt-1.5 block text-xs font-normal leading-5 text-neutral-400">{children}</span>;
}

function PreviewRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-neutral-100 pb-3 last:border-0 last:pb-0">
      <span className="text-xs text-neutral-400">{label}</span>
      <span className={cn("max-w-[65%] text-right text-xs text-neutral-700", strong && "font-semibold tabular-nums text-neutral-950")}>{value}</span>
    </div>
  );
}

function Detail({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-xl border border-neutral-200 p-3">
      <p className="text-xs text-neutral-400">{label}</p>
      <p className={cn("mt-1 text-sm font-medium text-neutral-800", strong && "font-semibold tabular-nums text-neutral-950")}>{value}</p>
    </div>
  );
}
