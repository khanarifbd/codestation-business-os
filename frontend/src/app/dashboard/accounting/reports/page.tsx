"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  FileClock,
  Landmark,
  Loader2,
  RefreshCw,
  Scale,
  TrendingUp,
  WalletCards,
} from "lucide-react";

import { AppPage, PageHeader, SectionHeader, Surface } from "@/components/ui/app-page";
import { getApiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/cn";

type Row = { code: string; name: string; amount: string | number };
type Statements = {
  base_currency: string;
  accounting_currency: string;
  reporting_currency: string;
  reporting_rate: string | number | null;
  reporting_rate_applied: boolean;
  reporting_note: string | null;
  functional_period_start: string;
  functional_period_end: string | null;
  date_from: string;
  date_to: string;
  income: Row[];
  expenses: Row[];
  total_income: string | number;
  total_expenses: string | number;
  net_profit: string | number;
  assets: Row[];
  liabilities: Row[];
  equity: Row[];
  total_assets: string | number;
  total_liabilities: string | number;
  recorded_equity: string | number;
  current_earnings: string | number;
  total_equity: string | number;
  total_liabilities_and_equity: string | number;
  cash_flow: {
    operating: string | number;
    investing: string | number;
    financing: string | number;
    net_change: string | number;
  };
};

type StatementSection = { label: string; rows: Row[] };
type StatementFooter = { label: string; value: string | number; emphasis?: boolean };

function money(value: string | number, currency: string) {
  return `${currency} ${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function signedMoney(value: string | number, currency: string) {
  const numeric = Number(value || 0);
  const prefix = numeric > 0 ? "+" : "";
  return `${prefix}${money(numeric, currency)}`;
}

export default function AccountingReportsPage() {
  const [data, setData] = useState<Statements | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const load = useCallback(async (period?: { from?: string; to?: string }) => {
    setLoading(true);
    setError(null);
    try {
      const from = period?.from ?? dateFrom;
      const to = period?.to ?? dateTo;
      const params = new URLSearchParams();
      if (from) params.set("date_from", from);
      if (to) params.set("date_to", to);
      const response = await fetch(
        `/api/accounting/reports/financial-statements${params.size ? `?${params.toString()}` : ""}`,
        { cache: "no-store" },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, "Could not load financial statements"));
      }
      setData(payload as Statements);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load financial reports");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    void load();
    // Initial load intentionally uses the default fiscal period before a user applies custom dates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currency = data?.base_currency ?? "";
  const balanceDifference = useMemo(
    () =>
      data
        ? Number(data.total_assets || 0) - Number(data.total_liabilities_and_equity || 0)
        : 0,
    [data],
  );
  const balanceSheetBalanced = Math.abs(balanceDifference) < 0.01;
  const reportingConverted = Boolean(
    data && data.reporting_rate_applied && data.accounting_currency !== data.base_currency,
  );

  function resetPeriod() {
    setDateFrom("");
    setDateTo("");
    void load({ from: "", to: "" });
  }

  return (
    <AppPage>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Finance & Accounting"
          title="Financial reports"
          description="Profit & Loss, Balance Sheet and Cash Flow generated directly from posted journals. Reporting presentation never changes the underlying accounting records."
          meta={
            <>
              <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-1">Posted journals only</span>
              <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-1">Functional-currency safe</span>
            </>
          }
          actions={
            <div className="flex flex-wrap gap-2">
              <Link
                href="/dashboard/accounting/reports/account-statement"
                className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50"
              >
                <FileClock className="size-4" />
                Account statement
              </Link>
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
              >
                <RefreshCw className={cn("size-4", loading && "animate-spin")} />
                Refresh
              </button>
            </div>
          }
        />


        {error ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between">
            <span>{error}</span>
            <button type="button" onClick={() => void load()} className="font-medium underline underline-offset-2">
              Retry
            </button>
          </div>
        ) : null}

        {data?.reporting_note ? (
          <div
            className={cn(
              "flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm",
              data.reporting_rate_applied
                ? "border-blue-200 bg-blue-50 text-blue-800"
                : "border-amber-200 bg-amber-50 text-amber-800",
            )}
          >
            {data.reporting_rate_applied ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            )}
            <span>{data.reporting_note}</span>
          </div>
        ) : null}

        <Surface className="p-5 sm:p-6">
          <SectionHeader
            title="Reporting period"
            description="Leave both dates empty to use the organization fiscal-year period allowed by the active functional currency."
            action={
              <button
                type="button"
                onClick={resetPeriod}
                disabled={loading || (!dateFrom && !dateTo)}
                className="text-xs font-medium text-neutral-500 underline-offset-2 hover:underline disabled:opacity-40"
              >
                Use fiscal default
              </button>
            }
          />
          <div className="mt-5 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
            <Field label="From">
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100"
              />
            </Field>
            <Field label="To">
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100"
              />
            </Field>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 md:w-auto"
              >
                {loading ? <Loader2 className="size-4 animate-spin" /> : null}
                Apply period
              </button>
            </div>
          </div>

          {data ? (
            <div className="mt-5 grid gap-3 border-t border-neutral-100 pt-5 sm:grid-cols-2 xl:grid-cols-4">
              <ContextItem label="Statement period" value={`${data.date_from} → ${data.date_to}`} />
              <ContextItem
                label="Functional period"
                value={`${data.functional_period_start}${data.functional_period_end ? ` → ${data.functional_period_end}` : " → current"}`}
              />
              <ContextItem label="Accounting currency" value={data.accounting_currency} />
              <ContextItem
                label="Displayed currency"
                value={
                  reportingConverted && data.reporting_rate
                    ? `${data.base_currency} · rate ${Number(data.reporting_rate).toLocaleString(undefined, { maximumFractionDigits: 8 })}`
                    : data.base_currency
                }
              />
            </div>
          ) : null}
        </Surface>

        {loading && !data ? (
          <ReportSkeleton />
        ) : (
          <>
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricSurface
                icon={<TrendingUp className="size-4" />}
                label="Income"
                value={data ? money(data.total_income, currency) : "—"}
                help="Recognized for the selected period"
              />
              <MetricSurface
                icon={<BarChart3 className="size-4" />}
                label="Expenses"
                value={data ? money(data.total_expenses, currency) : "—"}
                help="Recognized for the selected period"
              />
              <MetricSurface
                icon={<Scale className="size-4" />}
                label="Net profit"
                value={data ? money(data.net_profit, currency) : "—"}
                help="Income minus expenses"
                tone={Number(data?.net_profit ?? 0) < 0 ? "warning" : "default"}
              />
              <MetricSurface
                icon={<WalletCards className="size-4" />}
                label="Net cash movement"
                value={data ? signedMoney(data.cash_flow.net_change, currency) : "—"}
                help="Operating + investing + financing"
              />
            </section>

            <section className="grid gap-4 xl:grid-cols-2">
              <Statement
                title="Profit & Loss"
                subtitle="Income and expenses recognized during the selected period."
                sections={[
                  { label: "Income", rows: data?.income ?? [] },
                  { label: "Expenses", rows: data?.expenses ?? [] },
                ]}
                footer={[
                  { label: "Total income", value: data?.total_income ?? 0 },
                  { label: "Total expenses", value: data?.total_expenses ?? 0 },
                  { label: "Net profit", value: data?.net_profit ?? 0, emphasis: true },
                ]}
                currency={currency}
              />

              <Statement
                title="Balance Sheet"
                subtitle="Cumulative assets, liabilities and equity at the report end date."
                status={
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                      balanceSheetBalanced
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-red-50 text-red-700",
                    )}
                  >
                    {balanceSheetBalanced ? (
                      <CheckCircle2 className="size-3.5" />
                    ) : (
                      <AlertTriangle className="size-3.5" />
                    )}
                    {balanceSheetBalanced ? "Equation balanced" : "Needs review"}
                  </span>
                }
                sections={[
                  { label: "Assets", rows: data?.assets ?? [] },
                  { label: "Liabilities", rows: data?.liabilities ?? [] },
                  { label: "Equity", rows: data?.equity ?? [] },
                ]}
                footer={[
                  { label: "Total assets", value: data?.total_assets ?? 0, emphasis: true },
                  { label: "Total liabilities", value: data?.total_liabilities ?? 0 },
                  { label: "Recorded equity", value: data?.recorded_equity ?? 0 },
                  { label: "Current earnings", value: data?.current_earnings ?? 0 },
                  { label: "Total equity", value: data?.total_equity ?? 0 },
                  { label: "Liabilities + equity", value: data?.total_liabilities_and_equity ?? 0, emphasis: true },
                ]}
                currency={currency}
              />
            </section>

            <Surface className="p-5 sm:p-6">
              <SectionHeader
                title="Cash Flow"
                description="Cash movements are classified from the business event that created each posted journal."
                action={
                  <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs text-neutral-500">
                    Direct posted movement view
                  </span>
                }
              />
              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <CashFlowCard
                  label="Operating"
                  value={data ? data.cash_flow.operating : 0}
                  currency={currency}
                  help="Day-to-day business cash"
                />
                <CashFlowCard
                  label="Investing"
                  value={data ? data.cash_flow.investing : 0}
                  currency={currency}
                  help="Assets and investments"
                />
                <CashFlowCard
                  label="Financing"
                  value={data ? data.cash_flow.financing : 0}
                  currency={currency}
                  help="Loans, capital and investors"
                />
                <CashFlowCard
                  label="Net change"
                  value={data ? data.cash_flow.net_change : 0}
                  currency={currency}
                  help="Total movement for the period"
                  strong
                />
              </div>
            </Surface>

            <Surface className="p-5 sm:p-6">
              <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
                <div>
                  <div className="flex items-center gap-2">
                    <Landmark className="size-4 text-neutral-500" />
                    <h2 className="font-semibold text-neutral-950">Statement integrity</h2>
                  </div>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">
                    Financial statements are produced from posted journal lines in one functional-currency period. A reporting-currency conversion is display-only and does not rewrite historical journal amounts.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <StatusPill ok={balanceSheetBalanced} label={balanceSheetBalanced ? "Balance sheet balanced" : `Balance difference ${money(balanceDifference, currency)}`} />
                  <StatusPill
                    ok={Boolean(data?.reporting_rate_applied)}
                    label={data?.reporting_rate_applied ? `Display currency ${data.base_currency}` : `Showing accounting currency ${data?.accounting_currency ?? "—"}`}
                  />
                </div>
              </div>
            </Surface>
          </>
        )}
      </div>
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

function ContextItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-neutral-400">{label}</p>
      <p className="mt-1 text-sm font-medium text-neutral-800">{value}</p>
    </div>
  );
}

function MetricSurface({
  icon,
  label,
  value,
  help,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  help: string;
  tone?: "default" | "warning";
}) {
  return (
    <Surface className="p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-neutral-500">{label}</p>
        <span className="flex size-8 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500">{icon}</span>
      </div>
      <p className={cn("mt-3 text-2xl font-semibold tracking-tight", tone === "warning" && "text-red-700")}>{value}</p>
      <p className="mt-1 text-xs text-neutral-400">{help}</p>
    </Surface>
  );
}

function Statement({
  title,
  subtitle,
  sections,
  footer,
  currency,
  status,
}: {
  title: string;
  subtitle: string;
  sections: StatementSection[];
  footer: StatementFooter[];
  currency: string;
  status?: React.ReactNode;
}) {
  return (
    <Surface className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-neutral-100 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div>
          <h2 className="font-semibold text-neutral-950">{title}</h2>
          <p className="mt-1 text-sm text-neutral-500">{subtitle}</p>
        </div>
        {status}
      </div>
      <div className="p-5 sm:p-6">
        <div className="space-y-6">
          {sections.map((section) => (
            <div key={section.label}>
              <div className="flex items-center justify-between border-b border-neutral-100 pb-2">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400">{section.label}</p>
                <span className="text-xs text-neutral-400">{section.rows.length} accounts</span>
              </div>
              <div className="divide-y divide-neutral-100">
                {section.rows.length ? (
                  section.rows.map((row) => (
                    <div key={`${section.label}-${row.code}`} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 py-2.5 text-sm">
                      <span className="font-mono text-xs text-neutral-400">{row.code}</span>
                      <span className="min-w-0 truncate text-neutral-700">{row.name}</span>
                      <span className="font-medium tabular-nums text-neutral-950">{money(row.amount, currency)}</span>
                    </div>
                  ))
                ) : (
                  <p className="py-4 text-sm text-neutral-400">No posted activity in this section.</p>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-6 border-t border-neutral-200 pt-3">
          {footer.map((item) => (
            <div
              key={item.label}
              className={cn(
                "flex items-center justify-between gap-4 py-1.5 text-sm",
                item.emphasis && "mt-1 border-t border-neutral-100 pt-3",
              )}
            >
              <span className={cn("text-neutral-500", item.emphasis && "font-medium text-neutral-900")}>{item.label}</span>
              <span className={cn("font-semibold tabular-nums text-neutral-900", item.emphasis && "text-base")}>{money(item.value, currency)}</span>
            </div>
          ))}
        </div>
      </div>
    </Surface>
  );
}

function CashFlowCard({
  label,
  value,
  currency,
  help,
  strong = false,
}: {
  label: string;
  value: string | number;
  currency: string;
  help: string;
  strong?: boolean;
}) {
  const numeric = Number(value || 0);
  return (
    <div className={cn("rounded-2xl border border-neutral-200 p-4", strong ? "bg-neutral-950 text-white" : "bg-neutral-50/70")}>
      <div className="flex items-center justify-between gap-2">
        <p className={cn("text-xs font-medium uppercase tracking-[0.12em]", strong ? "text-neutral-300" : "text-neutral-400")}>{label}</p>
        {numeric >= 0 ? (
          <ArrowUpRight className={cn("size-4", strong ? "text-neutral-300" : "text-emerald-600")} />
        ) : (
          <ArrowDownRight className={cn("size-4", strong ? "text-neutral-300" : "text-red-600")} />
        )}
      </div>
      <p className="mt-2 text-lg font-semibold tabular-nums">{signedMoney(value, currency)}</p>
      <p className={cn("mt-1 text-xs", strong ? "text-neutral-400" : "text-neutral-400")}>{help}</p>
    </div>
  );
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700",
      )}
    >
      {ok ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
      {label}
    </span>
  );
}

function ReportSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-32 animate-pulse rounded-2xl border border-neutral-200 bg-white" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {Array.from({ length: 2 }).map((_, index) => (
          <div key={index} className="h-96 animate-pulse rounded-2xl border border-neutral-200 bg-white" />
        ))}
      </div>
    </div>
  );
}
