import type { ReactNode } from "react";

type MoneyFormatter = (amount: string | number, currency: string) => string;

export type FinancialCurrencyRow = {
  currency: string;
  invoiced_revenue: string;
  collected_revenue: string;
  receivables: string;
  expenses: string;
  platform_fees: string;
  transfer_fees: string;
  net_profit: string;
};

export type CurrencyTrendRow = {
  period: string;
  currency: string;
  invoiced_revenue: string;
  collected_revenue: string;
  expenses: string;
  transfer_fees: string;
  net_profit: string;
};

function FinancialFigure({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-neutral-100 bg-neutral-50/80 p-3 sm:p-3.5">
      <dt className="text-[11px] font-medium text-neutral-500">{label}</dt>
      <dd className="mt-2 break-all text-sm font-semibold tabular-nums leading-5 text-neutral-800">{value}</dd>
    </div>
  );
}

export function FinancialPerformanceCard({ row, reportingCurrency, formatMoney }: {
  row: FinancialCurrencyRow;
  reportingCurrency: string;
  formatMoney: MoneyFormatter;
}) {
  const negativeProfit = Number(row.net_profit) < 0;
  const showFees = Number(row.platform_fees) !== 0 || Number(row.transfer_fees) !== 0;
  return (
    <article className="min-w-0 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.035)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-100 px-4 py-4 sm:px-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold tracking-tight text-neutral-900">{row.currency}</h3>
            {row.currency === reportingCurrency ? (
              <span className="rounded-md bg-neutral-100 px-2 py-1 text-[10px] font-semibold text-neutral-600">Reporting currency</span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-neutral-500">Period financial performance</p>
        </div>
        <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-sm font-semibold text-neutral-600">{row.currency}</span>
      </div>
      <div className="px-4 pb-4 pt-4 sm:px-5 sm:pb-5">
        <dl className="grid grid-cols-2 gap-2.5">
          <FinancialFigure label="Invoiced" value={formatMoney(row.invoiced_revenue, row.currency)} />
          <FinancialFigure label="Collected" value={formatMoney(row.collected_revenue, row.currency)} />
          <FinancialFigure label="Receivable" value={formatMoney(row.receivables, row.currency)} />
          <FinancialFigure label="Expenses" value={formatMoney(row.expenses, row.currency)} />
        </dl>
        <dl className={`mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-3 ${negativeProfit ? "border-rose-200 bg-rose-50/70" : "border-neutral-200 bg-neutral-50"}`}>
          <dt className="text-xs font-semibold text-neutral-600">Net profit</dt>
          <dd className={`break-all text-base font-semibold tracking-tight tabular-nums sm:text-lg ${negativeProfit ? "text-rose-700" : "text-neutral-950"}`}>{formatMoney(row.net_profit, row.currency)}</dd>
        </dl>
        {showFees ? (
          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-2 border-t border-neutral-100 pt-3 text-xs text-neutral-500">
            {Number(row.platform_fees) !== 0 ? <div><dt className="inline">Platform fees: </dt><dd className="inline font-semibold tabular-nums text-neutral-700">{formatMoney(row.platform_fees, row.currency)}</dd></div> : null}
            {Number(row.transfer_fees) !== 0 ? <div><dt className="inline">Transfer fees: </dt><dd className="inline font-semibold tabular-nums text-neutral-700">{formatMoney(row.transfer_fees, row.currency)}</dd></div> : null}
          </dl>
        ) : null}
      </div>
    </article>
  );
}

function positiveAmount(value: string): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(number, 0) : 0;
}

export function CurrencyTrendCard({ currency, rows, reportingCurrency, formatMoney, formatPeriod }: {
  currency: string;
  rows: CurrencyTrendRow[];
  reportingCurrency: string;
  formatMoney: MoneyFormatter;
  formatPeriod: (period: string) => string;
}) {
  const maxCollected = Math.max(0, ...rows.map((row) => positiveAmount(row.collected_revenue)));
  return (
    <article className="min-w-0 overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 px-4 py-3.5">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">{currency}</h3>
          <p className="mt-0.5 text-[11px] text-neutral-500">Collected revenue · by period</p>
        </div>
        {currency === reportingCurrency ? <span className="rounded-md bg-neutral-100 px-2 py-1 text-[10px] font-medium text-neutral-600">Reporting currency</span> : null}
      </div>
      <div className="px-4 pb-4 pt-5">
        <div aria-hidden="true" className="flex h-32 items-end gap-2 border-b border-neutral-200 px-1 sm:gap-3">
          {rows.map((row) => (
            <div key={row.period} className="flex h-full min-w-0 flex-1 items-end justify-center">
              <div
                className="w-full max-w-12 rounded-t-md bg-neutral-800/85"
                style={{ height: `${maxCollected ? (positiveAmount(row.collected_revenue) / maxCollected) * 100 : 0}%` }}
              />
            </div>
          ))}
        </div>
        <div aria-hidden="true" className="mt-2 flex gap-2 px-1 text-center text-[10px] text-neutral-500 sm:gap-3">
          {rows.map((row) => <span key={row.period} className="min-w-0 flex-1 truncate">{formatPeriod(row.period).split(" ")[0]}</span>)}
        </div>
        <p className="mt-3 text-[11px] leading-4 text-neutral-500">Bars compare collections within {currency} only. Exact amounts are listed below.</p>
      </div>
      <div className="overflow-x-auto overscroll-x-contain border-t border-neutral-100">
        <table className="w-full min-w-[440px] text-left text-xs">
          <caption className="sr-only">Financial performance by period for {currency}</caption>
          <thead className="bg-neutral-50 text-neutral-500"><tr>
            <th scope="col" className="px-4 py-3 font-medium">Period</th>
            <th scope="col" className="px-3 py-3 text-right font-medium">Invoiced</th>
            <th scope="col" className="px-3 py-3 text-right font-medium">Collected</th>
            <th scope="col" className="px-4 py-3 text-right font-medium">Net</th>
          </tr></thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((row) => <tr key={`${row.period}-${row.currency}`} className="hover:bg-neutral-50/80">
              <th scope="row" className="whitespace-nowrap px-4 py-3 font-medium text-neutral-800">{formatPeriod(row.period)}</th>
              <td className="px-3 py-3 text-right tabular-nums text-neutral-600">{formatMoney(row.invoiced_revenue, row.currency)}</td>
              <td className="px-3 py-3 text-right tabular-nums text-neutral-800">{formatMoney(row.collected_revenue, row.currency)}</td>
              <td className={`px-4 py-3 text-right font-semibold tabular-nums ${Number(row.net_profit) < 0 ? "text-rose-700" : "text-neutral-900"}`}>{formatMoney(row.net_profit, row.currency)}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </article>
  );
}
