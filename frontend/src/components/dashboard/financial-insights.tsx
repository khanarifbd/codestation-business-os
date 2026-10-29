import type { ReactNode } from "react";
import "./financial-composition.css";

type MoneyFormatter = (amount: string | number, currency: string) => string;

export type FinancialCurrencyRow = {
  currency: string;
  invoiced_revenue: string;
  direct_income: string;
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
  direct_income: string;
  collected_revenue: string;
  expenses: string;
  transfer_fees: string;
  net_profit: string;
};

function FinancialFigure({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="financial-ledger-figure">
      <dt>{label}</dt>
      <dd>{value}</dd>
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
    <article className="financial-ledger-row">
      <header className="financial-ledger-currency">
        <h3>{row.currency}</h3>
        <p>{row.currency === reportingCurrency ? "Reporting currency" : "Original currency"}</p>
      </header>
      <dl className="financial-ledger-values">
        <FinancialFigure label="Invoiced" value={formatMoney(row.invoiced_revenue, row.currency)} />
        <FinancialFigure label="Direct income" value={formatMoney(row.direct_income, row.currency)} />
        <FinancialFigure label="Collected" value={formatMoney(row.collected_revenue, row.currency)} />
        <FinancialFigure label="Receivable" value={formatMoney(row.receivables, row.currency)} />
        <FinancialFigure label="Expenses" value={formatMoney(row.expenses, row.currency)} />
        <div className={`financial-ledger-figure financial-ledger-margin ${negativeProfit ? "financial-ledger-negative" : ""}`}>
          <dt>Operational margin</dt>
          <dd>{formatMoney(row.net_profit, row.currency)}</dd>
        </div>
      </dl>
      {showFees ? (
        <dl className="financial-ledger-fees">
          {Number(row.platform_fees) !== 0 ? <div><dt>Platform fees</dt><dd>{formatMoney(row.platform_fees, row.currency)}</dd></div> : null}
          {Number(row.transfer_fees) !== 0 ? <div><dt>Transfer fees</dt><dd>{formatMoney(row.transfer_fees, row.currency)}</dd></div> : null}
        </dl>
      ) : null}
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
    <article className="collections-trend">
      <header className="collections-trend-heading">
        <div><p>COLLECTED REVENUE</p><h3>{currency}</h3></div>
        {currency === reportingCurrency ? <span>Reporting currency</span> : <span>Original currency</span>}
      </header>
      {rows.length ? <div className="collections-latest"><span>Latest period · {formatPeriod(rows[rows.length - 1].period)}</span><strong>{formatMoney(rows[rows.length - 1].collected_revenue, currency)}</strong></div> : null}
      <figure className="collections-figure">
        <div aria-hidden="true" className="collections-plot" data-dense={rows.length > 6}>
          <div className="collections-grid"><i /><i /><i /><i /></div>
          {rows.map((row) => (
            <div key={row.period} className="collections-column">
              <div
                className="collections-bar"
                style={{ height: `${maxCollected ? (positiveAmount(row.collected_revenue) / maxCollected) * 100 : 0}%` }}
              >
                <span className="collections-amount">{formatMoney(row.collected_revenue, row.currency)}</span>
              </div>
            </div>
          ))}
        </div>
        <div aria-hidden="true" className="collections-periods">
          {rows.map((row) => <span key={row.period} title={formatPeriod(row.period)}>{formatPeriod(row.period)}</span>)}
        </div>
        <figcaption>Bars compare collections within {currency} only. Exact amounts are listed below.</figcaption>
      </figure>
      <details className="collections-exact-values">
        <summary>View exact period values<span aria-hidden="true" /></summary>
        <div className="collections-table-scroll" tabIndex={0} role="region" aria-label={`Financial performance table for ${currency}; scroll horizontally for all columns`}>

        <table className="w-full min-w-[440px] text-left text-xs">
          <caption className="sr-only">Financial performance by period for {currency}</caption>
          <thead className="bg-neutral-50 text-neutral-500"><tr>
            <th scope="col" className="px-4 py-3 font-medium">Period</th>
            <th scope="col" className="px-3 py-3 text-right font-medium">Invoiced</th>
            <th scope="col" className="px-3 py-3 text-right font-medium">Collected</th>
            <th scope="col" className="px-4 py-3 text-right font-medium">Op. margin</th>
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
      </details>
    </article>
  );
}
