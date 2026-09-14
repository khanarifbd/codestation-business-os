"use client";

import Link from "next/link";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";

import { AccountingNav } from "@/components/accounting-nav";
import { FinancialConfirmationDialog } from "@/components/financial-confirmation-dialog";
import { SearchableSelect } from "@/components/searchable-select";
import { AppPage, PageHeader, SectionHeader, Surface } from "@/components/ui/app-page";
import { getApiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/cn";

type Category = "asset" | "liability" | "equity" | "income" | "expense";
type LedgerAccount = {
  id: string;
  code: string;
  name: string;
  category: Category;
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
  as_of: string | null;
  accounting_currency: string;
  functional_period_start: string;
  total_debit: string | number;
  total_credit: string | number;
  rows: Array<{
    ledger_account_id: string;
    code: string;
    name: string;
    category: Category;
    debit: string | number;
    credit: string | number;
    balance: string | number;
  }>;
};
type Journal = {
  id: string;
  entry_number: string;
  entry_date: string;
  functional_currency: string;
  status: string;
  source_type: string;
  source_id: string | null;
  reference: string | null;
  memo: string | null;
  total_debit: string | number;
  total_credit: string | number;
  created_at: string;
  posted_at: string;
  lines: Array<{
    id: string;
    account_code: string;
    account_name: string;
    description: string | null;
    currency: string;
    exchange_rate_to_base: string | number;
    debit: string | number;
    credit: string | number;
    original_amount: string | number;
  }>;
};
type JournalFilter = "all" | "manual" | "operational" | "reversal";
type AccountStatusFilter = "all" | "active" | "inactive";

type AccountForm = {
  code: string;
  name: string;
  category: Category;
  subtype: string;
  normal_balance: "debit" | "credit";
  parent_id: string;
  allow_manual_posting: boolean;
  notes: string;
};

const categories: Category[] = ["asset", "liability", "equity", "income", "expense"];
const blankForm: AccountForm = {
  code: "",
  name: "",
  category: "asset",
  subtype: "",
  normal_balance: "debit",
  parent_id: "",
  allow_manual_posting: true,
  notes: "",
};
const fieldClass =
  "w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100";

function number(value: string | number) {
  return Number(value || 0);
}

function money(value: string | number, currency?: string) {
  const amount = number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency ? `${currency} ${amount}` : amount;
}

function pretty(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function isOperational(sourceType: string) {
  return !["manual", "reversal", "functional_currency_transition"].includes(sourceType);
}

export default function AdvancedAccountingPage() {
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [trial, setTrial] = useState<TrialBalance | null>(null);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [loading, setLoading] = useState(true);
  const [trialLoading, setTrialLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pendingReverse, setPendingReverse] = useState<Journal | null>(null);
  const [trialAsOf, setTrialAsOf] = useState("");
  const [trialSearch, setTrialSearch] = useState("");
  const [journalSearch, setJournalSearch] = useState("");
  const [journalFilter, setJournalFilter] = useState<JournalFilter>("all");
  const [accountSearch, setAccountSearch] = useState("");
  const [accountCategory, setAccountCategory] = useState<"all" | Category>("all");
  const [accountStatus, setAccountStatus] = useState<AccountStatusFilter>("all");
  const [form, setForm] = useState<AccountForm>(blankForm);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [accountResponse, trialResponse, journalResponse] = await Promise.all([
        fetch("/api/accounting/chart-of-accounts?include_inactive=true", { cache: "no-store" }),
        fetch("/api/accounting/trial-balance", { cache: "no-store" }),
        fetch("/api/accounting/journals?limit=200", { cache: "no-store" }),
      ]);
      const [accountPayload, trialPayload, journalPayload] = await Promise.all([
        accountResponse.json(),
        trialResponse.json(),
        journalResponse.json(),
      ]);
      if (!accountResponse.ok) {
        throw new Error(getApiErrorMessage(accountPayload, "Could not load chart of accounts"));
      }
      if (!trialResponse.ok) {
        throw new Error(getApiErrorMessage(trialPayload, "Could not load trial balance"));
      }
      if (!journalResponse.ok) {
        throw new Error(getApiErrorMessage(journalPayload, "Could not load journals"));
      }
      setAccounts(accountPayload as LedgerAccount[]);
      setTrial(trialPayload as TrialBalance);
      setJournals(journalPayload as Journal[]);
      setTrialAsOf((trialPayload as TrialBalance).as_of ?? "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load advanced accounting");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const balanced = useMemo(
    () => Math.abs(number(trial?.total_debit ?? 0) - number(trial?.total_credit ?? 0)) < 0.005,
    [trial],
  );

  const activeAccounts = useMemo(() => accounts.filter((account) => account.is_active), [accounts]);
  const manualPostingAccounts = useMemo(
    () => activeAccounts.filter((account) => account.allow_manual_posting),
    [activeAccounts],
  );
  const parentOptions = useMemo(
    () =>
      activeAccounts
        .filter((account) => account.category === form.category)
        .map((account) => ({
          value: account.id,
          label: `${account.code} · ${account.name}`,
          keywords: `${account.code} ${account.name} ${account.subtype ?? ""}`,
        })),
    [activeAccounts, form.category],
  );
  const reversedIds = useMemo(
    () => new Set(journals.filter((journal) => journal.source_type === "reversal" && journal.source_id).map((journal) => journal.source_id as string)),
    [journals],
  );

  const visibleTrialRows = useMemo(() => {
    const needle = trialSearch.trim().toLowerCase();
    return (trial?.rows ?? []).filter((row) => {
      if (!needle) return true;
      return `${row.code} ${row.name} ${row.category}`.toLowerCase().includes(needle);
    });
  }, [trial, trialSearch]);

  const visibleJournals = useMemo(() => {
    const needle = journalSearch.trim().toLowerCase();
    return journals.filter((journal) => {
      if (journalFilter === "manual" && journal.source_type !== "manual") return false;
      if (journalFilter === "reversal" && journal.source_type !== "reversal") return false;
      if (journalFilter === "operational" && !isOperational(journal.source_type)) return false;
      if (!needle) return true;
      const lineText = journal.lines.map((line) => `${line.account_code} ${line.account_name} ${line.description ?? ""}`).join(" ");
      return `${journal.entry_number} ${journal.source_type} ${journal.reference ?? ""} ${journal.memo ?? ""} ${lineText}`
        .toLowerCase()
        .includes(needle);
    });
  }, [journalFilter, journalSearch, journals]);

  const visibleAccounts = useMemo(() => {
    const needle = accountSearch.trim().toLowerCase();
    return accounts.filter((account) => {
      if (accountCategory !== "all" && account.category !== accountCategory) return false;
      if (accountStatus === "active" && !account.is_active) return false;
      if (accountStatus === "inactive" && account.is_active) return false;
      if (!needle) return true;
      return `${account.code} ${account.name} ${account.category} ${account.subtype ?? ""} ${account.notes ?? ""}`
        .toLowerCase()
        .includes(needle);
    });
  }, [accountCategory, accountSearch, accountStatus, accounts]);

  function changeCategory(category: Category) {
    setForm((current) => ({
      ...current,
      category,
      normal_balance: category === "asset" || category === "expense" ? "debit" : "credit",
      parent_id: "",
    }));
  }

  async function refreshTrial(asOf = trialAsOf) {
    setTrialLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (asOf) params.set("as_of", asOf);
      const response = await fetch(`/api/accounting/trial-balance${params.size ? `?${params.toString()}` : ""}`, {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, "Could not load trial balance"));
      }
      setTrial(payload as TrialBalance);
      setTrialAsOf((payload as TrialBalance).as_of ?? asOf);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load trial balance");
    } finally {
      setTrialLoading(false);
    }
  }

  async function createAccount(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/accounting/chart-of-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          subtype: form.subtype || null,
          parent_id: form.parent_id || null,
          notes: form.notes || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, "Could not create ledger account"));
      }
      setForm(blankForm);
      setShowAccountForm(false);
      setMessage(`Ledger account ${payload.code} · ${payload.name} created.`);
      const accountResponse = await fetch("/api/accounting/chart-of-accounts?include_inactive=true", { cache: "no-store" });
      const accountPayload = await accountResponse.json();
      if (!accountResponse.ok) {
        throw new Error(getApiErrorMessage(accountPayload, "Ledger account was created, but the chart could not be refreshed"));
      }
      setAccounts(accountPayload as LedgerAccount[]);
      await refreshTrial();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create ledger account");
    } finally {
      setSaving(false);
    }
  }

  async function reverse(entry: Journal) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/accounting/journals/${entry.id}/reverse`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, "Could not reverse journal"));
      }
      setPendingReverse(null);
      setMessage(`${entry.entry_number} reversed with ${payload.entry_number}. The original journal remains in the audit trail.`);
      const [trialResponse, journalResponse] = await Promise.all([
        fetch(`/api/accounting/trial-balance${trialAsOf ? `?as_of=${encodeURIComponent(trialAsOf)}` : ""}`, { cache: "no-store" }),
        fetch("/api/accounting/journals?limit=200", { cache: "no-store" }),
      ]);
      const [trialPayload, journalPayload] = await Promise.all([trialResponse.json(), journalResponse.json()]);
      if (!trialResponse.ok) throw new Error(getApiErrorMessage(trialPayload, "Journal reversed, but trial balance refresh failed"));
      if (!journalResponse.ok) throw new Error(getApiErrorMessage(journalPayload, "Journal reversed, but journal history refresh failed"));
      setTrial(trialPayload as TrialBalance);
      setJournals(journalPayload as Journal[]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not reverse journal");
    } finally {
      setSaving(false);
    }
  }

  const accountingCurrency = trial?.accounting_currency ?? "—";

  return (
    <AppPage>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Finance & Accounting"
          title="Advanced accounting"
          description="Accountant workspace for Trial Balance, Journal History and Chart of Accounts. Operational transactions should still be corrected from their source workflow so subledgers and the General Ledger stay synchronized."
          meta={
            <>
              <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-1">Finance manage protected</span>
              <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-1">Posted journals are auditable</span>
            </>
          }
          actions={
            <>
              <Link
                href="/dashboard/accounting/advanced/adjustment"
                className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50"
              >
                <SlidersHorizontal className="size-4" />
                New adjustment
              </Link>
              <button
                type="button"
                onClick={() => setShowAccountForm((value) => !value)}
                className="inline-flex items-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-800"
              >
                <Plus className="size-4" />
                Ledger account
              </button>
            </>
          }
        />

        <AccountingNav />

        {error ? (
          <div className="flex items-start justify-between gap-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <span>{error}</span>
            <button type="button" onClick={() => void load()} className="shrink-0 font-medium underline underline-offset-2">
              Reload
            </button>
          </div>
        ) : null}
        {message ? (
          <div className="flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            <span>{message}</span>
          </div>
        ) : null}

        {loading ? (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="h-80 animate-pulse rounded-2xl border border-neutral-200 bg-white lg:col-span-2" />
            <div className="h-80 animate-pulse rounded-2xl border border-neutral-200 bg-white" />
          </div>
        ) : (
          <>
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric
                label="Trial balance"
                value={balanced ? "Balanced" : "Needs review"}
                help={trial?.as_of ? `As of ${trial.as_of}` : "Current period"}
                ok={balanced}
              />
              <Metric
                label="Accounting currency"
                value={accountingCurrency}
                help={trial?.functional_period_start ? `Period from ${trial.functional_period_start}` : "Functional currency"}
              />
              <Metric
                label="Active ledger accounts"
                value={String(activeAccounts.length)}
                help={`${manualPostingAccounts.length} allow manual posting`}
              />
              <Metric
                label="Recent journals"
                value={String(journals.length)}
                help="Latest 200 entries at most"
              />
            </section>

            <section className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(280px,0.8fr)]">
              <Surface className="overflow-hidden">
                <div className="border-b border-neutral-100 p-5 sm:p-6">
                  <SectionHeader
                    title="Trial Balance"
                    description="Posted debits and credits for one functional-currency period. Totals are never raw-summed across currency-period changes."
                    action={
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                          balanced ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700",
                        )}
                      >
                        {balanced ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
                        {balanced ? "Balanced" : "Needs review"}
                      </span>
                    }
                  />
                  <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(180px,0.7fr)_minmax(220px,1fr)_auto]">
                    <Field label="As of">
                      <input
                        type="date"
                        value={trialAsOf}
                        onChange={(event) => setTrialAsOf(event.target.value)}
                        className={fieldClass}
                      />
                    </Field>
                    <Field label="Find ledger account">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
                        <input
                          value={trialSearch}
                          onChange={(event) => setTrialSearch(event.target.value)}
                          placeholder="Code, name or category"
                          className={`${fieldClass} pl-9`}
                        />
                      </div>
                    </Field>
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={() => void refreshTrial()}
                        disabled={trialLoading}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 sm:w-auto"
                      >
                        {trialLoading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                        Apply
                      </button>
                    </div>
                  </div>
                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <Small label="Total debit" value={money(trial?.total_debit ?? 0, accountingCurrency)} />
                    <Small label="Total credit" value={money(trial?.total_credit ?? 0, accountingCurrency)} />
                  </div>
                </div>

                <div className="hidden overflow-x-auto md:block">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-neutral-100 bg-neutral-50/70 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
                        <th className="px-5 py-3">Code</th>
                        <th className="px-4 py-3">Account</th>
                        <th className="px-4 py-3">Category</th>
                        <th className="px-4 py-3 text-right">Debit</th>
                        <th className="px-4 py-3 text-right">Credit</th>
                        <th className="px-5 py-3 text-right">Net Dr/(Cr)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleTrialRows.map((row) => (
                        <tr key={row.ledger_account_id} className="border-b border-neutral-100 last:border-0">
                          <td className="px-5 py-3 font-mono text-xs text-neutral-500">{row.code}</td>
                          <td className="px-4 py-3 font-medium text-neutral-800">{row.name}</td>
                          <td className="px-4 py-3 text-neutral-500">{pretty(row.category)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{money(row.debit)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{money(row.credit)}</td>
                          <td className="px-5 py-3 text-right font-medium tabular-nums">{money(row.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="divide-y divide-neutral-100 md:hidden">
                  {visibleTrialRows.map((row) => (
                    <div key={row.ledger_account_id} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-neutral-900">{row.code} · {row.name}</p>
                          <p className="mt-1 text-xs text-neutral-400">{pretty(row.category)}</p>
                        </div>
                        <p className="font-medium tabular-nums">{money(row.balance, accountingCurrency)}</p>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-neutral-500">
                        <span>Debit {money(row.debit)}</span>
                        <span className="text-right">Credit {money(row.credit)}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {!visibleTrialRows.length ? <EmptyState text="No ledger accounts match this Trial Balance search." /> : null}
              </Surface>

              <Surface className="p-5 sm:p-6">
                <ShieldCheck className="size-5 text-neutral-500" />
                <h2 className="mt-3 font-semibold text-neutral-950">Accounting guardrails</h2>
                <div className="mt-4 space-y-4 text-sm leading-6 text-neutral-500">
                  <Guardrail title="Operational events post automatically">Use Money In, Money Out, Transfers, Loans, Receivables and Payables for normal business events.</Guardrail>
                  <Guardrail title="Closed periods stay locked">Manual postings and reversals are rejected inside a closed accounting period.</Guardrail>
                  <Guardrail title="Financial-account ledgers are protected">Bank, cash, wallet and gateway ledgers cannot accept manual journals because their operational balance must match the General Ledger.</Guardrail>
                  <Guardrail title="Operational journals are not reversed here">Payments, expenses, transfers, supplier payments and loan events must use their correction workflow so subledgers stay synchronized.</Guardrail>
                  <Guardrail title="Manual journals remain auditable">A reversal creates a separate opposite journal; it never deletes the original entry.</Guardrail>
                </div>
              </Surface>
            </section>

            <Surface className="overflow-hidden">
              <div className="border-b border-neutral-100 p-5 sm:p-6">
                <SectionHeader
                  title="Recent journal entries"
                  description="Trace the latest 200 accounting entries to the business event that created them. Manual reversal is deliberately limited to accountant-created journals."
                  action={
                    <button
                      type="button"
                      onClick={() => void load()}
                      disabled={loading}
                      className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-xs font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
                    >
                      <RefreshCw className="size-3.5" /> Refresh
                    </button>
                  }
                />
                <div className="mt-5 grid gap-3 md:grid-cols-[1fr_220px]">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
                    <input
                      value={journalSearch}
                      onChange={(event) => setJournalSearch(event.target.value)}
                      placeholder="Search entry, reference, memo or account"
                      className={`${fieldClass} pl-9`}
                    />
                  </div>
                  <select
                    value={journalFilter}
                    onChange={(event) => setJournalFilter(event.target.value as JournalFilter)}
                    className={fieldClass}
                  >
                    <option value="all">All sources</option>
                    <option value="manual">Manual adjustments</option>
                    <option value="operational">Operational journals</option>
                    <option value="reversal">Reversals</option>
                  </select>
                </div>
              </div>

              <div className="hidden overflow-x-auto lg:block">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-100 bg-neutral-50/70 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
                      <th className="px-5 py-3">Entry</th>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Source</th>
                      <th className="px-4 py-3">Reference</th>
                      <th className="px-4 py-3 text-right">Debit</th>
                      <th className="px-4 py-3 text-right">Credit</th>
                      <th className="px-5 py-3 text-right">Control</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleJournals.map((journal) => (
                      <JournalTableRow
                        key={journal.id}
                        journal={journal}
                        expanded={expanded === journal.id}
                        reversed={reversedIds.has(journal.id)}
                        saving={saving}
                        onToggle={() => setExpanded((current) => (current === journal.id ? null : journal.id))}
                        onReverse={() => setPendingReverse(journal)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="divide-y divide-neutral-100 lg:hidden">
                {visibleJournals.map((journal) => (
                  <JournalCard
                    key={journal.id}
                    journal={journal}
                    expanded={expanded === journal.id}
                    reversed={reversedIds.has(journal.id)}
                    saving={saving}
                    onToggle={() => setExpanded((current) => (current === journal.id ? null : journal.id))}
                    onReverse={() => setPendingReverse(journal)}
                  />
                ))}
              </div>
              {!visibleJournals.length ? <EmptyState text="No journal entries match these filters." /> : null}
            </Surface>

            {showAccountForm ? (
              <Surface className="p-5 sm:p-6">
                <SectionHeader
                  title="Create ledger account"
                  description="Add a Chart of Accounts entry only when accounting or reporting requires it. System-mapped financial ledgers stay protected by the backend."
                  action={
                    <button
                      type="button"
                      onClick={() => setShowAccountForm(false)}
                      className="text-xs font-medium text-neutral-500 hover:text-neutral-900"
                    >
                      Close form
                    </button>
                  }
                />
                <form onSubmit={createAccount} className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <Field label="Code">
                    <input
                      required
                      value={form.code}
                      onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))}
                      className={fieldClass}
                      placeholder="e.g. 6150"
                    />
                  </Field>
                  <Field label="Name">
                    <input
                      required
                      value={form.name}
                      onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                      className={fieldClass}
                      placeholder="Ledger account name"
                    />
                  </Field>
                  <Field label="Category">
                    <select
                      value={form.category}
                      onChange={(event) => changeCategory(event.target.value as Category)}
                      className={fieldClass}
                    >
                      {categories.map((category) => (
                        <option key={category} value={category}>{pretty(category)}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Subtype">
                    <input
                      value={form.subtype}
                      onChange={(event) => setForm((current) => ({ ...current, subtype: event.target.value }))}
                      className={fieldClass}
                      placeholder="Optional classification"
                    />
                  </Field>
                  <Field label="Normal balance">
                    <select
                      value={form.normal_balance}
                      onChange={(event) => setForm((current) => ({ ...current, normal_balance: event.target.value as "debit" | "credit" }))}
                      className={fieldClass}
                    >
                      <option value="debit">Debit</option>
                      <option value="credit">Credit</option>
                    </select>
                  </Field>
                  <SearchableSelect
                    label="Parent account"
                    value={form.parent_id}
                    onValueChange={(value) => setForm((current) => ({ ...current, parent_id: value }))}
                    options={parentOptions}
                    placeholder="No parent"
                    searchPlaceholder="Search parent account..."
                  />
                  <label className="flex items-start gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm md:col-span-2 xl:col-span-1">
                    <input
                      type="checkbox"
                      checked={form.allow_manual_posting}
                      onChange={(event) => setForm((current) => ({ ...current, allow_manual_posting: event.target.checked }))}
                      className="mt-0.5 size-4 rounded border-neutral-300"
                    />
                    <span>
                      <span className="font-medium text-neutral-800">Allow manual posting</span>
                      <span className="mt-1 block text-xs leading-5 text-neutral-500">Turn this off for control or summary accounts that should only receive system-generated postings.</span>
                    </span>
                  </label>
                  <label className="text-sm md:col-span-2 xl:col-span-3">
                    <span className="mb-1.5 block font-medium text-neutral-600">Notes</span>
                    <textarea
                      value={form.notes}
                      onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                      rows={3}
                      className={fieldClass}
                      placeholder="Purpose, reporting use or accountant guidance"
                    />
                  </label>
                  <div className="flex justify-end md:col-span-2 xl:col-span-3">
                    <button
                      disabled={saving}
                      className="inline-flex items-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                      {saving ? "Saving…" : "Create ledger account"}
                    </button>
                  </div>
                </form>
              </Surface>
            ) : null}

            <Surface className="overflow-hidden">
              <div className="border-b border-neutral-100 p-5 sm:p-6">
                <SectionHeader
                  title="Chart of Accounts"
                  description="System and custom ledger accounts, including inactive records and manual-posting controls."
                  action={<span className="text-xs text-neutral-400">{visibleAccounts.length} of {accounts.length} accounts</span>}
                />
                <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_180px_160px]">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
                    <input
                      value={accountSearch}
                      onChange={(event) => setAccountSearch(event.target.value)}
                      placeholder="Search code, name, subtype or notes"
                      className={`${fieldClass} pl-9`}
                    />
                  </div>
                  <select
                    value={accountCategory}
                    onChange={(event) => setAccountCategory(event.target.value as "all" | Category)}
                    className={fieldClass}
                  >
                    <option value="all">All categories</option>
                    {categories.map((category) => <option key={category} value={category}>{pretty(category)}</option>)}
                  </select>
                  <select
                    value={accountStatus}
                    onChange={(event) => setAccountStatus(event.target.value as AccountStatusFilter)}
                    className={fieldClass}
                  >
                    <option value="all">All statuses</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-100 bg-neutral-50/70 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
                      <th className="px-5 py-3">Code</th>
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Category</th>
                      <th className="px-4 py-3">Normal</th>
                      <th className="px-4 py-3">Posting</th>
                      <th className="px-5 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleAccounts.map((account) => (
                      <tr key={account.id} className="border-b border-neutral-100 last:border-0">
                        <td className="px-5 py-3 font-mono text-xs text-neutral-500">{account.code}</td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-neutral-800">{account.name}</p>
                          <p className="mt-0.5 text-xs text-neutral-400">{account.is_system ? "System" : "Custom"}{account.subtype ? ` · ${pretty(account.subtype)}` : ""}</p>
                        </td>
                        <td className="px-4 py-3 text-neutral-500">{pretty(account.category)}</td>
                        <td className="px-4 py-3 text-neutral-500">{pretty(account.normal_balance)}</td>
                        <td className="px-4 py-3">
                          <PostingBadge allowed={account.allow_manual_posting} />
                        </td>
                        <td className="px-5 py-3">
                          <StatusBadge active={account.is_active} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="divide-y divide-neutral-100 md:hidden">
                {visibleAccounts.map((account) => (
                  <div key={account.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-neutral-900">{account.code} · {account.name}</p>
                        <p className="mt-1 text-xs text-neutral-400">{pretty(account.category)} · {pretty(account.normal_balance)} · {account.is_system ? "System" : "Custom"}</p>
                      </div>
                      <StatusBadge active={account.is_active} />
                    </div>
                    <div className="mt-3"><PostingBadge allowed={account.allow_manual_posting} /></div>
                    {account.notes ? <p className="mt-3 text-xs leading-5 text-neutral-500">{account.notes}</p> : null}
                  </div>
                ))}
              </div>
              {!visibleAccounts.length ? <EmptyState text="No Chart of Accounts records match these filters." /> : null}
            </Surface>
          </>
        )}
      </div>

      <FinancialConfirmationDialog
        open={Boolean(pendingReverse)}
        title="Reverse manual journal?"
        description="This posts a separate journal with the debit and credit sides reversed. The original journal remains unchanged for audit history."
        details={pendingReverse ? [
          { label: "Journal", value: pendingReverse.entry_number, emphasis: true },
          { label: "Entry date", value: pendingReverse.entry_date },
          { label: "Functional amount", value: money(pendingReverse.total_debit, pendingReverse.functional_currency), emphasis: true },
          { label: "Reference", value: pendingReverse.reference || "—" },
        ] : []}
        confirmLabel="Post reversal"
        loading={saving}
        warning="Only manual journals can be reversed here. The backend will reject closed periods, sealed functional-currency periods and journals that have already been reversed."
        onCancel={() => setPendingReverse(null)}
        onConfirm={() => pendingReverse ? reverse(pendingReverse) : undefined}
      />
    </AppPage>
  );
}

function Metric({
  label,
  value,
  help,
  ok,
}: {
  label: string;
  value: string;
  help: string;
  ok?: boolean;
}) {
  return (
    <Surface className="p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-neutral-500">{label}</p>
        {ok !== undefined ? (
          ok ? <CheckCircle2 className="size-4 text-emerald-600" /> : <AlertTriangle className="size-4 text-red-600" />
        ) : null}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950">{value}</p>
      <p className="mt-1 text-xs text-neutral-400">{help}</p>
    </Surface>
  );
}

function Small({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-neutral-50 p-4">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-neutral-400">{label}</p>
      <p className="mt-1 text-base font-semibold tabular-nums text-neutral-900">{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-sm">
      <span className="mb-1.5 block font-medium text-neutral-600">{label}</span>
      {children}
    </label>
  );
}

function Guardrail({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-medium text-neutral-800">{title}</p>
      <p className="mt-0.5">{children}</p>
    </div>
  );
}

function JournalTableRow({
  journal,
  expanded,
  reversed,
  saving,
  onToggle,
  onReverse,
}: {
  journal: Journal;
  expanded: boolean;
  reversed: boolean;
  saving: boolean;
  onToggle: () => void;
  onReverse: () => void;
}) {
  return (
    <>
      <tr className="border-b border-neutral-100 last:border-0">
        <td className="px-5 py-3">
          <button type="button" onClick={onToggle} className="inline-flex items-center gap-1.5 font-medium text-neutral-900 hover:underline">
            {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            {journal.entry_number}
          </button>
        </td>
        <td className="px-4 py-3 text-neutral-500">{journal.entry_date}</td>
        <td className="px-4 py-3"><SourceBadge sourceType={journal.source_type} /></td>
        <td className="px-4 py-3 text-neutral-500">{journal.reference || "—"}</td>
        <td className="px-4 py-3 text-right font-medium tabular-nums">{money(journal.total_debit, journal.functional_currency)}</td>
        <td className="px-4 py-3 text-right font-medium tabular-nums">{money(journal.total_credit, journal.functional_currency)}</td>
        <td className="px-5 py-3 text-right">
          <JournalControl journal={journal} reversed={reversed} saving={saving} onReverse={onReverse} />
        </td>
      </tr>
      {expanded ? (
        <tr className="border-b border-neutral-100 bg-neutral-50/60">
          <td colSpan={7} className="px-5 py-4">
            <JournalLines journal={journal} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function JournalCard({
  journal,
  expanded,
  reversed,
  saving,
  onToggle,
  onReverse,
}: {
  journal: Journal;
  expanded: boolean;
  reversed: boolean;
  saving: boolean;
  onToggle: () => void;
  onReverse: () => void;
}) {
  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <button type="button" onClick={onToggle} className="inline-flex items-center gap-1.5 font-medium text-neutral-900">
            {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            {journal.entry_number}
          </button>
          <p className="mt-1 text-xs text-neutral-400">{journal.entry_date} · {journal.reference || "No reference"}</p>
        </div>
        <SourceBadge sourceType={journal.source_type} />
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-xs text-neutral-400">Functional total</p>
          <p className="mt-0.5 font-semibold tabular-nums">{money(journal.total_debit, journal.functional_currency)}</p>
        </div>
        <JournalControl journal={journal} reversed={reversed} saving={saving} onReverse={onReverse} />
      </div>
      {expanded ? <div className="mt-4 rounded-xl bg-neutral-50 p-3"><JournalLines journal={journal} /></div> : null}
    </div>
  );
}

function JournalLines({ journal }: { journal: Journal }) {
  return (
    <div>
      {journal.memo ? <p className="mb-3 text-sm text-neutral-600">{journal.memo}</p> : null}
      <div className="space-y-2">
        {journal.lines.map((line) => (
          <div key={line.id} className="grid gap-1 rounded-xl border border-neutral-200 bg-white p-3 text-xs sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-4">
            <div>
              <p className="font-medium text-neutral-800">{line.account_code} · {line.account_name}</p>
              <p className="mt-0.5 text-neutral-400">{line.description || "No line description"}</p>
              <p className="mt-1 text-neutral-500">Original: {money(line.original_amount, line.currency)}{line.currency !== journal.functional_currency ? ` · FX ${Number(line.exchange_rate_to_base).toLocaleString(undefined, { maximumFractionDigits: 8 })}` : ""}</p>
            </div>
            <span className="tabular-nums text-neutral-600">Dr {money(line.debit, journal.functional_currency)}</span>
            <span className="tabular-nums text-neutral-600">Cr {money(line.credit, journal.functional_currency)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function JournalControl({
  journal,
  reversed,
  saving,
  onReverse,
}: {
  journal: Journal;
  reversed: boolean;
  saving: boolean;
  onReverse: () => void;
}) {
  if (journal.source_type === "reversal") {
    return <span className="text-xs font-medium text-neutral-400">Reversal entry</span>;
  }
  if (journal.source_type === "functional_currency_transition") {
    return <span className="text-xs font-medium text-amber-700">Protected transition</span>;
  }
  if (journal.source_type !== "manual") {
    return <span className="text-xs font-medium text-blue-700">Correct in source workflow</span>;
  }
  if (reversed) {
    return <span className="text-xs font-medium text-neutral-400">Already reversed</span>;
  }
  return (
    <button
      type="button"
      disabled={saving}
      onClick={onReverse}
      className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
    >
      <RotateCcw className="size-3.5" />
      Reverse
    </button>
  );
}

function SourceBadge({ sourceType }: { sourceType: string }) {
  const tone = sourceType === "manual"
    ? "bg-violet-50 text-violet-700"
    : sourceType === "reversal"
      ? "bg-neutral-100 text-neutral-600"
      : sourceType === "functional_currency_transition"
        ? "bg-amber-50 text-amber-700"
        : "bg-blue-50 text-blue-700";
  return <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-medium", tone)}>{pretty(sourceType)}</span>;
}

function PostingBadge({ allowed }: { allowed: boolean }) {
  return (
    <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-medium", allowed ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-600")}>
      {allowed ? "Manual allowed" : "Protected"}
    </span>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-medium", active ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-500")}>
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="px-5 py-10 text-center">
      <BookOpen className="mx-auto size-7 text-neutral-300" />
      <p className="mt-2 text-sm text-neutral-400">{text}</p>
    </div>
  );
}
