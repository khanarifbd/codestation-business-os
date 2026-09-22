"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownLeft,
  CheckCircle2,
  Clock3,
  Loader2,
  Receipt,
  Search,
  WalletCards,
  X,
} from "lucide-react";

import { FinancialConfirmationDialog } from "@/components/financial-confirmation-dialog";
import { MoneyInput } from "@/components/money-input";
import { SearchableSelect } from "@/components/searchable-select";
import { AppPage, PageHeader, SectionHeader, Surface } from "@/components/ui/app-page";
import { getApiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/cn";

type AgingBucket = "current" | "1-30" | "31-60" | "61-90" | "90+";
type Invoice = {
  id: string;
  client_id: string;
  invoice_number: string;
  client_name: string;
  status: string;
  display_status: string;
  issue_date: string;
  due_date: string | null;
  currency: string;
  total: string | number;
  amount_paid: string | number;
  balance_due: string | number;
  days_overdue: number;
  aging_bucket: AgingBucket;
  available_credit: string | number;
};
type Advance = {
  id: string;
  advance_date: string;
  currency: string;
  original_amount: string | number;
  remaining_amount: string | number;
  reference: string | null;
};
type CurrencyTotal = { currency: string; amount: string | number };
type AgingTotal = { bucket: AgingBucket; currency: string; amount: string | number };
type ReceivablePayload = {
  items: Invoice[];
  next_cursor: string | null;
  open_invoice_count: number;
  overdue_count: number;
  filtered_count: number;
  outstanding_by_currency: CurrencyTotal[];
  credit_by_currency: CurrencyTotal[];
  aging: AgingTotal[];
};
type ReceivableSummary = Pick<
  ReceivablePayload,
  "open_invoice_count" | "overdue_count" | "filtered_count" | "outstanding_by_currency" | "credit_by_currency" | "aging"
>;

const EMPTY_SUMMARY: ReceivableSummary = {
  open_invoice_count: 0,
  overdue_count: 0,
  filtered_count: 0,
  outstanding_by_currency: [],
  credit_by_currency: [],
  aging: [],
};
const AGING_BUCKETS: AgingBucket[] = ["current", "1-30", "31-60", "61-90", "90+"];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function money(value: string | number, currency: string) {
  return `${currency} ${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function bucketLabel(bucket: AgingBucket) {
  return bucket === "current" ? "Current" : `${bucket} days`;
}

export default function ReceivablesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [summary, setSummary] = useState<ReceivableSummary>(EMPTY_SUMMARY);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [advanceLoading, setAdvanceLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [form, setForm] = useState({ advance_id: "", amount: "", application_date: today() });
  const [search, setSearch] = useState("");
  const [aging, setAging] = useState<"all" | AgingBucket>("all");
  const [currency, setCurrency] = useState("all");

  const loadReceivables = useCallback(
    async (cursor?: string, append = false, signal?: AbortSignal) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ limit: "50" });
        if (search.trim()) params.set("search", search.trim());
        if (aging !== "all") params.set("aging", aging);
        if (currency !== "all") params.set("currency", currency);
        if (cursor) params.set("cursor", cursor);
        const response = await fetch(`/api/finance/receivable-page?${params.toString()}`, {
          cache: "no-store",
          signal,
        });
        const payload = (await response.json()) as ReceivablePayload;
        if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not load receivables"));
        setInvoices((current) => (append ? [...current, ...payload.items] : payload.items));
        setNextCursor(payload.next_cursor);
        setSummary({
          open_invoice_count: payload.open_invoice_count,
          overdue_count: payload.overdue_count,
          filtered_count: payload.filtered_count,
          outstanding_by_currency: payload.outstanding_by_currency,
          credit_by_currency: payload.credit_by_currency,
          aging: payload.aging,
        });
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Could not load receivables");
      } finally {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    },
    [aging, currency, search],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => void loadReceivables(undefined, false, controller.signal),
      search.trim() ? 250 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadReceivables]);

  const currencies = useMemo(
    () =>
      [...new Set([...summary.outstanding_by_currency, ...summary.credit_by_currency].map((item) => item.currency))].sort(),
    [summary.credit_by_currency, summary.outstanding_by_currency],
  );

  const agingSummary = useMemo(() => {
    const map = new Map<AgingBucket, CurrencyTotal[]>();
    for (const bucket of AGING_BUCKETS) map.set(bucket, []);
    for (const item of summary.aging) map.get(item.bucket)?.push({ currency: item.currency, amount: item.amount });
    return map;
  }, [summary.aging]);

  const selectedAdvance = advances.find((advance) => advance.id === form.advance_id) ?? null;
  const maxApplication = selected
    ? Math.min(Number(selected.balance_due), Number(selectedAdvance?.remaining_amount ?? 0))
    : 0;
  const advanceOptions = useMemo(
    () =>
      advances.map((advance) => ({
        value: advance.id,
        label: `${advance.advance_date} · ${money(advance.remaining_amount, advance.currency)} remaining`,
        keywords: `${advance.advance_date} ${advance.reference ?? ""} ${advance.currency}`,
      })),
    [advances],
  );
  const hasFilters = Boolean(search || aging !== "all" || currency !== "all");

  async function openApply(invoice: Invoice) {
    setSelected(invoice);
    setAdvances([]);
    setConfirmOpen(false);
    setMessage(null);
    setAdvanceLoading(true);
    setError(null);
    setForm({ advance_id: "", amount: "", application_date: today() });
    try {
      const params = new URLSearchParams({ client_id: invoice.client_id, currency: invoice.currency });
      const response = await fetch(`/api/finance/receivable-advances?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json()) as Advance[];
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not load customer credit"));
      setAdvances(payload);
      const first = payload[0];
      if (first) {
        setForm({
          advance_id: first.id,
          amount: String(Math.min(Number(first.remaining_amount), Number(invoice.balance_due))),
          application_date: today(),
        });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load customer credit");
    } finally {
      setAdvanceLoading(false);
    }
  }

  function closeApply() {
    if (saving) return;
    setSelected(null);
    setAdvances([]);
    setConfirmOpen(false);
  }

  function changeAdvance(value: string) {
    const advance = advances.find((item) => item.id === value);
    setForm((current) => ({
      ...current,
      advance_id: value,
      amount: advance && selected ? String(Math.min(Number(advance.remaining_amount), Number(selected.balance_due))) : "",
    }));
  }

  function reviewApply(event: FormEvent) {
    event.preventDefault();
    if (!selected || !selectedAdvance || Number(form.amount) <= 0) return;
    setConfirmOpen(true);
  }

  async function postApply() {
    if (!selected || !selectedAdvance) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/accounting/customer-advances/${selectedAdvance.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoice_id: selected.id,
          application_date: form.application_date,
          amount: Number(form.amount),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not apply customer advance"));
      const invoiceNumber = selected.invoice_number;
      setMessage(
        `Customer credit applied to ${invoiceNumber}. No bank or wallet balance changed because the money was already received earlier.`,
      );
      setSelected(null);
      setAdvances([]);
      setConfirmOpen(false);
      await loadReceivables();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not apply customer advance");
      setConfirmOpen(false);
    } finally {
      setSaving(false);
    }
  }

  const confirmationDetails = selected
    ? [
        { label: "Invoice", value: selected.invoice_number },
        { label: "Customer", value: selected.client_name },
        { label: "Receivable reduction", value: money(form.amount || 0, selected.currency), emphasis: true },
        { label: "Customer credit reduction", value: money(form.amount || 0, selected.currency) },
        { label: "Bank / wallet movement", value: "None" },
        { label: "Application date", value: form.application_date },
      ]
    : [];

  return (
    <AppPage>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Finance & Accounting"
          title="Receivables"
          description="Track outstanding invoices, prioritize overdue collection and apply customer credit without moving cash twice."
          meta={
            <>
              <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-1">Server-side aging</span>
              <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-1">Currencies stay separate</span>
            </>
          }
          actions={
            <Link
              href="/dashboard/accounting/money-in"
              className="inline-flex items-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-800"
            >
              <ArrowDownLeft className="size-4" />
              Collect money
            </Link>
          }
        />


        {error ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between">
            <span>{error}</span>
            <button type="button" onClick={() => void loadReceivables()} className="font-medium underline underline-offset-2">
              Retry
            </button>
          </div>
        ) : null}
        {message ? (
          <div className="flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            <span>{message}</span>
          </div>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricSurface
            label="Open invoices"
            value={String(summary.open_invoice_count)}
            help={`${summary.overdue_count} overdue`}
            icon={<Receipt className="size-4" />}
          />
          <MetricSurface
            label="Customers owe you"
            values={summary.outstanding_by_currency}
            help="Outstanding invoice balances"
            icon={<WalletCards className="size-4" />}
          />
          <MetricSurface
            label="Overdue invoices"
            value={String(summary.overdue_count)}
            help="Past the organization due date"
            icon={<AlertTriangle className="size-4" />}
          />
          <MetricSurface
            label="Unused customer credit"
            values={summary.credit_by_currency}
            help="Already received; not new cash"
            icon={<Clock3 className="size-4" />}
          />
        </section>

        <Surface className="p-5 sm:p-6">
          <SectionHeader
            title="Receivable aging"
            description="Aging is calculated on the backend using the organization timezone and every open receivable, not just the visible page."
            action={<span className="text-xs text-neutral-400">{summary.filtered_count} matching invoices</span>}
          />
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {AGING_BUCKETS.map((bucket) => {
              const values = agingSummary.get(bucket) ?? [];
              const active = aging === bucket;
              return (
                <button
                  key={bucket}
                  type="button"
                  onClick={() => setAging(active ? "all" : bucket)}
                  className={cn(
                    "min-h-28 rounded-2xl border p-4 text-left transition",
                    active
                      ? "border-neutral-950 bg-neutral-950 text-white shadow-sm"
                      : "border-neutral-200 bg-neutral-50/70 hover:border-neutral-300 hover:bg-white",
                  )}
                >
                  <p className={cn("text-[11px] font-semibold uppercase tracking-[0.12em]", active ? "text-neutral-300" : "text-neutral-400")}>
                    {bucketLabel(bucket)}
                  </p>
                  <div className="mt-3 space-y-1">
                    {values.length ? (
                      values.map((item) => (
                        <p key={item.currency} className="font-semibold tabular-nums">
                          {money(item.amount, item.currency)}
                        </p>
                      ))
                    ) : (
                      <p className="font-semibold tabular-nums">0.00</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </Surface>

        <Surface className="p-4 sm:p-5">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_180px_auto]">
            <label className="relative">
              <Search className="absolute left-3 top-3 size-4 text-neutral-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search invoice or customer..."
                className="h-10 w-full rounded-xl border border-neutral-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100"
              />
            </label>
            <select
              value={aging}
              onChange={(event) => setAging(event.target.value as "all" | AgingBucket)}
              className="h-10 rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100"
            >
              <option value="all">All aging</option>
              <option value="current">Current</option>
              <option value="1-30">1–30 days</option>
              <option value="31-60">31–60 days</option>
              <option value="61-90">61–90 days</option>
              <option value="90+">90+ days</option>
            </select>
            <select
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
              className="h-10 rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100"
            >
              <option value="all">All currencies</option>
              {currencies.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!hasFilters}
              onClick={() => {
                setSearch("");
                setAging("all");
                setCurrency("all");
              }}
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-neutral-200 px-3 text-sm font-medium text-neutral-600 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <X className="size-3.5" />
              Clear
            </button>
          </div>
        </Surface>

        {selected ? (
          <Surface className="overflow-hidden">
            <div className="border-b border-neutral-100 px-5 py-5 sm:px-6">
              <SectionHeader
                title={`Apply customer credit to ${selected.invoice_number}`}
                description="Use money received earlier to reduce Accounts Receivable. This does not create another bank or wallet transaction."
                action={
                  <button type="button" onClick={closeApply} className="rounded-lg p-2 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700">
                    <X className="size-4" />
                  </button>
                }
              />
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <MiniStat label="Invoice balance" value={money(selected.balance_due, selected.currency)} />
                <MiniStat label="Customer credit available" value={money(selected.available_credit, selected.currency)} />
                <MiniStat label="Cash movement" value="None" />
              </div>
            </div>

            <div className="p-5 sm:p-6">
              {advanceLoading ? (
                <div className="flex items-center gap-2 text-sm text-neutral-500">
                  <Loader2 className="size-4 animate-spin" /> Loading customer credit…
                </div>
              ) : advances.length ? (
                <form onSubmit={reviewApply} className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_180px_auto] lg:items-end">
                  <SearchableSelect
                    label="Available customer credit"
                    required
                    clearable={false}
                    value={form.advance_id}
                    onValueChange={changeAdvance}
                    options={advanceOptions}
                    placeholder="Select customer credit"
                    searchPlaceholder="Search date or reference..."
                  />
                  <MoneyInput
                    label="Amount to apply"
                    currency={selected.currency}
                    required
                    min={0.01}
                    max={maxApplication}
                    value={form.amount}
                    onValueChange={(value) => setForm((current) => ({ ...current, amount: value }))}
                    hint={`Maximum available: ${money(maxApplication, selected.currency)}`}
                  />
                  <Field label="Application date">
                    <input
                      required
                      type="date"
                      value={form.application_date}
                      onChange={(event) => setForm((current) => ({ ...current, application_date: event.target.value }))}
                      className="h-10 w-full rounded-xl border border-neutral-200 px-3 text-sm outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100"
                    />
                  </Field>
                  <button
                    disabled={saving || Number(form.amount) <= 0}
                    className="h-10 rounded-xl bg-neutral-950 px-4 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Review application
                  </button>
                </form>
              ) : (
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm leading-6 text-neutral-600">
                  No unused {selected.currency} customer credit is available now. The credit may have been applied by another user since this list loaded. {" "}
                  <Link href="/dashboard/accounting/money-in" className="font-medium text-neutral-950 underline underline-offset-2">
                    Record an advance in Money In
                  </Link>{" "}
                  only if money was actually received before invoicing.
                </div>
              )}
            </div>
          </Surface>
        ) : null}

        <Surface className="overflow-hidden">
          <div className="border-b border-neutral-100 px-5 py-5 sm:px-6">
            <SectionHeader
              title="Outstanding invoices"
              description="Open the invoice for source details, apply matching customer credit, or collect a real payment through Money In."
              action={
                loading && invoices.length ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-neutral-400">
                    <Loader2 className="size-3.5 animate-spin" /> Refreshing
                  </span>
                ) : (
                  <span className="text-xs text-neutral-400">Showing {invoices.length} of {summary.filtered_count}</span>
                )
              }
            />
          </div>

          {loading && !invoices.length ? (
            <ReceivableSkeleton />
          ) : invoices.length ? (
            <>
              <div className="divide-y divide-neutral-100 md:hidden">
                {invoices.map((invoice) => (
                  <ReceivableCard key={invoice.id} invoice={invoice} onApply={openApply} />
                ))}
              </div>
              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-100 bg-neutral-50/70 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-400">
                      <th className="px-6 py-3">Invoice</th>
                      <th className="px-4 py-3">Customer</th>
                      <th className="px-4 py-3">Due</th>
                      <th className="px-4 py-3">Aging</th>
                      <th className="px-4 py-3 text-right">Paid / credit</th>
                      <th className="px-4 py-3 text-right">Still due</th>
                      <th className="px-6 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((invoice) => (
                      <tr key={invoice.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50/70">
                        <td className="px-6 py-4">
                          <Link
                            href={`/dashboard/accounting/invoices/${invoice.id}`}
                            className="font-semibold text-neutral-950 underline-offset-2 hover:underline"
                          >
                            {invoice.invoice_number}
                          </Link>
                          <p className="mt-1 text-xs text-neutral-400">Issued {invoice.issue_date}</p>
                        </td>
                        <td className="px-4 py-4 font-medium text-neutral-700">{invoice.client_name}</td>
                        <td className={cn("px-4 py-4", invoice.days_overdue > 0 ? "font-medium text-red-600" : "text-neutral-500")}>
                          {invoice.due_date || "No due date"}
                        </td>
                        <td className="px-4 py-4">
                          <AgingBadge invoice={invoice} />
                        </td>
                        <td className="px-4 py-4 text-right tabular-nums text-neutral-500">
                          {money(invoice.amount_paid, invoice.currency)}
                        </td>
                        <td className="px-4 py-4 text-right font-semibold tabular-nums text-neutral-950">
                          {money(invoice.balance_due, invoice.currency)}
                          {Number(invoice.available_credit) > 0 ? (
                            <p className="mt-1 text-xs font-normal text-emerald-600">
                              {money(invoice.available_credit, invoice.currency)} credit available
                            </p>
                          ) : null}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex justify-end gap-2">
                            {Number(invoice.available_credit) > 0 ? (
                              <button
                                type="button"
                                onClick={() => void openApply(invoice)}
                                className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50"
                              >
                                Apply credit
                              </button>
                            ) : null}
                            <Link
                              href={`/dashboard/accounting/money-in?invoice_id=${encodeURIComponent(invoice.id)}`}
                              className="rounded-lg bg-neutral-950 px-3 py-2 text-xs font-medium text-white transition hover:bg-neutral-800"
                            >
                              Collect
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {nextCursor ? (
                <div className="flex justify-center border-t border-neutral-100 px-5 py-4">
                  <button
                    type="button"
                    disabled={loadingMore}
                    onClick={() => void loadReceivables(nextCursor, true)}
                    className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50"
                  >
                    {loadingMore ? <Loader2 className="size-4 animate-spin" /> : null}
                    {loadingMore ? "Loading…" : "Load more receivables"}
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <div className="px-6 py-14 text-center">
              <Receipt className="mx-auto size-9 text-neutral-300" />
              <p className="mt-3 font-medium text-neutral-900">
                {hasFilters ? "No receivables match these filters" : "Nothing outstanding"}
              </p>
              <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-neutral-400">
                {hasFilters
                  ? "Clear or change the filters to see other outstanding invoices."
                  : "All current invoices are paid, cancelled, still in draft, or there are no invoices yet."}
              </p>
            </div>
          )}
        </Surface>
      </div>

      <FinancialConfirmationDialog
        open={confirmOpen}
        title="Apply this customer credit?"
        description="This reduces the customer advance liability and Accounts Receivable using money that was already received earlier."
        details={confirmationDetails}
        confirmLabel="Apply customer credit"
        loading={saving}
        warning="No bank or wallet balance should move again. If this is a new cash receipt, use Money In instead of applying customer credit."
        onCancel={() => setConfirmOpen(false)}
        onConfirm={postApply}
      />
    </AppPage>
  );
}

function MetricSurface({
  label,
  value,
  values,
  help,
  icon,
}: {
  label: string;
  value?: string;
  values?: CurrencyTotal[];
  help: string;
  icon: React.ReactNode;
}) {
  return (
    <Surface className="p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-neutral-500">{label}</p>
        <span className="flex size-8 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500">{icon}</span>
      </div>
      <div className="mt-3 space-y-1">
        {values ? (
          values.length ? (
            values.map((item) => (
              <p key={item.currency} className="text-xl font-semibold tabular-nums text-neutral-950">
                {money(item.amount, item.currency)}
              </p>
            ))
          ) : (
            <p className="text-2xl font-semibold tabular-nums text-neutral-950">0.00</p>
          )
        ) : (
          <p className="text-3xl font-semibold tabular-nums text-neutral-950">{value}</p>
        )}
      </div>
      <p className="mt-2 text-xs leading-5 text-neutral-400">{help}</p>
    </Surface>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-400">{label}</p>
      <p className="mt-1.5 font-semibold tabular-nums text-neutral-900">{value}</p>
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

function AgingBadge({ invoice }: { invoice: Invoice }) {
  const overdue = invoice.days_overdue > 0;
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-1 text-xs font-medium",
        overdue ? "bg-red-50 text-red-700" : "bg-neutral-100 text-neutral-600",
      )}
    >
      {overdue ? `${invoice.days_overdue}d overdue` : "Current"}
    </span>
  );
}

function ReceivableCard({ invoice, onApply }: { invoice: Invoice; onApply: (invoice: Invoice) => Promise<void> }) {
  return (
    <article className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/dashboard/accounting/invoices/${invoice.id}`}
            className="font-semibold text-neutral-950 underline-offset-2 hover:underline"
          >
            {invoice.invoice_number}
          </Link>
          <p className="mt-1 truncate text-sm text-neutral-500">{invoice.client_name}</p>
        </div>
        <AgingBadge invoice={invoice} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <MiniStat label="Still due" value={money(invoice.balance_due, invoice.currency)} />
        <MiniStat label="Due date" value={invoice.due_date || "Not set"} />
      </div>
      {Number(invoice.available_credit) > 0 ? (
        <p className="mt-3 text-xs font-medium text-emerald-600">
          {money(invoice.available_credit, invoice.currency)} unused customer credit is available.
        </p>
      ) : null}
      <div className="mt-4 flex gap-2">
        {Number(invoice.available_credit) > 0 ? (
          <button
            type="button"
            onClick={() => void onApply(invoice)}
            className="flex-1 rounded-xl border border-neutral-200 px-3 py-2.5 text-sm font-medium text-neutral-700"
          >
            Apply credit
          </button>
        ) : null}
        <Link
          href={`/dashboard/accounting/money-in?invoice_id=${encodeURIComponent(invoice.id)}`}
          className="flex-1 rounded-xl bg-neutral-950 px-3 py-2.5 text-center text-sm font-medium text-white"
        >
          Collect money
        </Link>
      </div>
    </article>
  );
}

function ReceivableSkeleton() {
  return (
    <div className="space-y-3 p-5 sm:p-6">
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="h-20 animate-pulse rounded-xl bg-neutral-100" />
      ))}
    </div>
  );
}
