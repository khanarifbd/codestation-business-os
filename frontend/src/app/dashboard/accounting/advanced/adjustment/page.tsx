"use client";

import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Scale,
  SlidersHorizontal,
} from "lucide-react";

import { AccountingNav } from "@/components/accounting-nav";
import { CurrencySelect } from "@/components/currency-select";
import { FinancialConfirmationDialog } from "@/components/financial-confirmation-dialog";
import { MoneyInput } from "@/components/money-input";
import { SearchableSelect } from "@/components/searchable-select";
import { AppPage, PageHeader, SectionHeader, Surface } from "@/components/ui/app-page";
import { getApiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/cn";

type Account = {
  id: string;
  code: string;
  name: string;
  category: string;
  is_active: boolean;
  allow_manual_posting: boolean;
};
type TrialBalance = {
  as_of: string | null;
  accounting_currency: string;
  functional_period_start: string;
};
type AdjustmentForm = {
  entry_date: string;
  debit_account_id: string;
  credit_account_id: string;
  amount: string;
  currency: string;
  reference: string;
  memo: string;
};
type PostedJournal = {
  entry_number: string;
  functional_currency: string;
  total_debit: string | number;
};

const emptyForm: AdjustmentForm = {
  entry_date: "",
  debit_account_id: "",
  credit_account_id: "",
  amount: "",
  currency: "",
  reference: "",
  memo: "",
};
const fieldClass =
  "w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100";

function money(value: string | number, currency: string) {
  return `${currency} ${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function AdjustmentPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [functionalCurrency, setFunctionalCurrency] = useState("");
  const [functionalPeriodStart, setFunctionalPeriodStart] = useState("");
  const [businessDate, setBusinessDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState<AdjustmentForm>(emptyForm);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [accountResponse, trialResponse] = await Promise.all([
        fetch("/api/accounting/chart-of-accounts", { cache: "no-store" }),
        fetch("/api/accounting/trial-balance", { cache: "no-store" }),
      ]);
      const [accountPayload, trialPayload] = await Promise.all([
        accountResponse.json(),
        trialResponse.json(),
      ]);
      if (!accountResponse.ok) {
        throw new Error(getApiErrorMessage(accountPayload, "Could not load ledger accounts"));
      }
      if (!trialResponse.ok) {
        throw new Error(getApiErrorMessage(trialPayload, "Could not load accounting context"));
      }
      const context = trialPayload as TrialBalance;
      setAccounts(
        (accountPayload as Account[]).filter(
          (account) => account.is_active && account.allow_manual_posting,
        ),
      );
      setFunctionalCurrency(context.accounting_currency);
      setFunctionalPeriodStart(context.functional_period_start);
      setBusinessDate(context.as_of ?? "");
      setForm((current) => ({
        ...current,
        entry_date: current.entry_date || context.as_of || "",
        currency: current.currency || context.accounting_currency,
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load accounting adjustment context");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const amount = useMemo(() => Number(form.amount || 0), [form.amount]);
  const accountOptions = useMemo(
    () =>
      accounts.map((account) => ({
        value: account.id,
        label: `${account.code} · ${account.name}`,
        keywords: `${account.code} ${account.name} ${account.category}`,
      })),
    [accounts],
  );
  const debitAccount = useMemo(
    () => accounts.find((account) => account.id === form.debit_account_id) ?? null,
    [accounts, form.debit_account_id],
  );
  const creditAccount = useMemo(
    () => accounts.find((account) => account.id === form.credit_account_id) ?? null,
    [accounts, form.credit_account_id],
  );
  const crossCurrency = Boolean(
    form.currency && functionalCurrency && form.currency !== functionalCurrency,
  );
  const canReview = Boolean(
    form.entry_date &&
      form.currency &&
      form.debit_account_id &&
      form.credit_account_id &&
      form.debit_account_id !== form.credit_account_id &&
      amount > 0 &&
      form.memo.trim(),
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (form.debit_account_id === form.credit_account_id) {
      setError("Debit and credit accounts must be different");
      return;
    }
    if (!canReview) {
      setError("Complete the date, accounts, amount, currency and adjustment reason before review.");
      return;
    }
    setReviewOpen(true);
  }

  async function postAdjustment() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/accounting/journals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entry_date: form.entry_date,
          reference: form.reference || null,
          memo: form.memo.trim(),
          lines: [
            {
              ledger_account_id: form.debit_account_id,
              description: form.memo.trim(),
              currency: form.currency,
              exchange_rate_to_base: 1,
              debit: amount,
              credit: 0,
              original_amount: amount,
            },
            {
              ledger_account_id: form.credit_account_id,
              description: form.memo.trim(),
              currency: form.currency,
              exchange_rate_to_base: 1,
              debit: 0,
              credit: amount,
              original_amount: amount,
            },
          ],
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, "Could not post adjustment"));
      }
      const posted = payload as PostedJournal;
      setReviewOpen(false);
      setMessage(
        `${posted.entry_number} posted at ${money(posted.total_debit, posted.functional_currency)} functional value. Use manual-journal reversal from Advanced Accounting if this adjustment must be undone.`,
      );
      setForm({
        ...emptyForm,
        entry_date: businessDate,
        currency: functionalCurrency,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not post adjustment");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppPage width="normal">
      <div className="space-y-6">
        <PageHeader
          eyebrow="Advanced Accounting"
          title="Accounting adjustment"
          description="Post a deliberate accountant-approved debit and credit when a normal operational workflow is not the right source. Adjustments create posted journals immediately and remain auditable."
          meta={
            <>
              <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-1">Manual-posting accounts only</span>
              <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-1">Closed periods are protected</span>
            </>
          }
          actions={
            <Link
              href="/dashboard/accounting/advanced"
              className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              <ArrowLeft className="size-4" />
              Advanced accounting
            </Link>
          }
        />

        <AccountingNav />

        {error ? (
          <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}
        {message ? (
          <div className="flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            <span>{message}</span>
          </div>
        ) : null}

        {loading ? (
          <div className="flex min-h-72 items-center justify-center rounded-2xl border border-neutral-200 bg-white">
            <Loader2 className="size-6 animate-spin text-neutral-400" />
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,0.7fr)]">
            <Surface className="p-5 sm:p-6">
              <SectionHeader
                title="Post a balanced adjustment"
                description="One source amount is posted to one debit account and one credit account. The backend validates functional-currency balance and period controls before posting."
                action={
                  <div className="flex size-10 items-center justify-center rounded-xl bg-neutral-100 text-neutral-600">
                    <SlidersHorizontal className="size-5" />
                  </div>
                }
              />

              {!accounts.length ? (
                <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  No active ledger accounts currently allow manual posting. Review the Chart of Accounts before creating an adjustment.
                </div>
              ) : null}

              <form onSubmit={submit} className="mt-6 grid gap-4 md:grid-cols-2">
                <Field label="Posting date">
                  <input
                    required
                    type="date"
                    value={form.entry_date}
                    onChange={(event) => setForm((current) => ({ ...current, entry_date: event.target.value }))}
                    className={fieldClass}
                  />
                </Field>
                <CurrencySelect
                  required
                  clearable={false}
                  value={form.currency}
                  onValueChange={(value) => setForm((current) => ({ ...current, currency: value }))}
                />
                <SearchableSelect
                  label="Debit account"
                  required
                  clearable={false}
                  value={form.debit_account_id}
                  onValueChange={(value) => setForm((current) => ({ ...current, debit_account_id: value }))}
                  options={accountOptions.filter((option) => option.value !== form.credit_account_id)}
                  placeholder="Select debit account"
                  searchPlaceholder="Search ledger account..."
                />
                <SearchableSelect
                  label="Credit account"
                  required
                  clearable={false}
                  value={form.credit_account_id}
                  onValueChange={(value) => setForm((current) => ({ ...current, credit_account_id: value }))}
                  options={accountOptions.filter((option) => option.value !== form.debit_account_id)}
                  placeholder="Select credit account"
                  searchPlaceholder="Search ledger account..."
                />
                <MoneyInput
                  label="Source amount"
                  currency={form.currency || functionalCurrency}
                  required
                  min={0.01}
                  value={form.amount}
                  onValueChange={(value) => setForm((current) => ({ ...current, amount: value }))}
                />
                <Field label="Reference (optional)">
                  <input
                    value={form.reference}
                    onChange={(event) => setForm((current) => ({ ...current, reference: event.target.value }))}
                    className={fieldClass}
                    placeholder="Document, ticket or accountant reference"
                  />
                </Field>
                <label className="text-sm md:col-span-2">
                  <span className="mb-1.5 block font-medium text-neutral-600">Reason / memo</span>
                  <textarea
                    required
                    value={form.memo}
                    onChange={(event) => setForm((current) => ({ ...current, memo: event.target.value }))}
                    rows={4}
                    className={fieldClass}
                    placeholder="Why is this adjustment required?"
                  />
                </label>

                {crossCurrency ? (
                  <div className="md:col-span-2 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-800">
                    This is a foreign-currency adjustment. The source amount remains {form.currency}; the backend resolves the configured FX rate for {form.entry_date || "the posting date"} and posts the balanced functional value in {functionalCurrency}. No 1:1 currency assumption is made.
                  </div>
                ) : null}

                <div className="flex justify-end md:col-span-2">
                  <button
                    disabled={saving || !canReview || !accounts.length}
                    className="inline-flex items-center gap-2 rounded-xl bg-neutral-950 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Review adjustment
                  </button>
                </div>
              </form>
            </Surface>

            <div className="space-y-4 xl:sticky xl:top-6 xl:self-start">
              <Surface className="p-5">
                <div className="flex items-center gap-2">
                  <Scale className="size-4 text-neutral-500" />
                  <h2 className="font-semibold text-neutral-950">Posting preview</h2>
                </div>
                <div className="mt-4 divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-neutral-50/70 px-4">
                  <PreviewRow label="Posting date" value={form.entry_date || "—"} />
                  <PreviewRow label="Debit" value={debitAccount ? `${debitAccount.code} · ${debitAccount.name}` : "—"} />
                  <PreviewRow label="Credit" value={creditAccount ? `${creditAccount.code} · ${creditAccount.name}` : "—"} />
                  <PreviewRow label="Source amount" value={amount > 0 && form.currency ? money(amount, form.currency) : "—"} emphasis />
                  <PreviewRow label="Functional currency" value={functionalCurrency || "—"} />
                  <PreviewRow label="Reference" value={form.reference || "—"} />
                </div>
              </Surface>

              <Surface className="p-5">
                <h2 className="font-semibold text-neutral-950">Accounting context</h2>
                <div className="mt-4 space-y-3 text-sm text-neutral-500">
                  <ContextRow label="Business date" value={businessDate || "—"} />
                  <ContextRow label="Functional currency" value={functionalCurrency || "—"} />
                  <ContextRow label="Functional period starts" value={functionalPeriodStart || "—"} />
                  <ContextRow label="Manual-posting accounts" value={String(accounts.length)} />
                </div>
                <p className="mt-4 border-t border-neutral-100 pt-4 text-xs leading-5 text-neutral-400">
                  Use Money In, Money Out, Transfers, Loans, Receivables or Payables instead when this represents a real operational transaction. That keeps financial accounts, subledgers and the General Ledger synchronized.
                </p>
              </Surface>
            </div>
          </div>
        )}
      </div>

      <FinancialConfirmationDialog
        open={reviewOpen}
        title="Post accounting adjustment?"
        description="This creates an immediately posted manual journal. Review the debit, credit and source currency before continuing."
        details={[
          { label: "Posting date", value: form.entry_date || "—" },
          { label: "Debit account", value: debitAccount ? `${debitAccount.code} · ${debitAccount.name}` : "—" },
          { label: "Credit account", value: creditAccount ? `${creditAccount.code} · ${creditAccount.name}` : "—" },
          { label: "Source amount", value: amount > 0 && form.currency ? money(amount, form.currency) : "—", emphasis: true },
          { label: "Functional currency", value: functionalCurrency || "—" },
          { label: "Reference", value: form.reference || "—" },
        ]}
        confirmLabel="Post adjustment"
        loading={saving}
        warning={crossCurrency
          ? `The backend will resolve the configured ${form.currency}/${functionalCurrency} FX rate as of the posting date and will reject the journal if it cannot produce equal functional-currency debit and credit totals.`
          : "Posted adjustments are not edited or deleted. If correction is later required, post a manual-journal reversal from Advanced Accounting so the audit history remains intact."}
        onCancel={() => setReviewOpen(false)}
        onConfirm={postAdjustment}
      />
    </AppPage>
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

function PreviewRow({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 text-sm">
      <span className="text-neutral-500">{label}</span>
      <span className={cn("max-w-[62%] text-right font-medium text-neutral-700", emphasis && "font-semibold text-neutral-950")}>{value}</span>
    </div>
  );
}

function ContextRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span>{label}</span>
      <span className="font-medium text-neutral-800">{value}</span>
    </div>
  );
}
