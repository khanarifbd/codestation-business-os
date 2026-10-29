import { reportMoney, trendScale } from "./report-model";
import { trendSeries } from "./report-types";
import type { ReportFinancial, ReportTrend, ReportsOverview } from "./report-types";
import { OperationalReportingNote } from "@/components/dashboard/operational-reporting-note";

function CurrencySummary({ row }: { row: ReportFinancial }) {
  return <div className="or-summary">
    <div className="or-result"><span>Operational margin</span><strong>{reportMoney(row.net_profit, row.currency)}</strong><p>Issued invoices + direct income − expenses − transfer fees</p></div>
    <dl className="or-financial-lines">
      <div><dt>Invoiced <small>By issue date, including tax</small></dt><dd>{reportMoney(row.invoiced_revenue, row.currency)}</dd></div>
      <div><dt>Direct income</dt><dd>{reportMoney(row.direct_income, row.currency)}</dd></div>
      <div><dt>Collected <small>By payment date</small></dt><dd>{reportMoney(row.collected_revenue, row.currency)}</dd></div>
      <div><dt>Expenses <small>Including eligible payroll</small></dt><dd>{reportMoney(row.expenses, row.currency)}</dd></div>
      <div><dt>Transfer fees</dt><dd>{reportMoney(row.transfer_fees, row.currency)}</dd></div>
      <div><dt>Platform fees <small>Already included in expenses</small></dt><dd>{reportMoney(row.platform_fees, row.currency)}</dd></div>
    </dl>
    <div className="or-cohort"><span>Remaining on this invoice cohort</span><strong>{reportMoney(row.receivables, row.currency)}</strong><p>Current unpaid balance of qualifying invoices issued in the selected period. Not a period-end balance or all outstanding invoices.</p></div>
  </div>;
}
export function MonthlyTrend({ rows, currency }: { rows: ReportTrend[]; currency: string }) {
  const selected = rows.filter(row => row.currency === currency).sort((a, b) => a.period.localeCompare(b.period));
  const scale = trendScale(selected, currency);
  if (!selected.length) return <p className="or-empty">No monthly activity was returned for {currency} in this scope.</p>;
  return <div className="or-trend">
    <div className="or-subheading"><h3>Monthly movement</h3><p>{currency} only · {scale.negative ? "Zero centred; signed amounts shown" : "Zero baseline"} · each currency has its own scale</p></div>
    <div className="or-legend" aria-hidden="true">{trendSeries.map(series => <span key={series.key}><i className={`or-tone-${series.tone}`} />{series.label}</span>)}</div>
    <div className="or-months" aria-label={`Monthly movement in ${currency}`}>
      {selected.map(row => <div className="or-month" key={row.period}>
        <h4>{row.period}</h4>
        {trendSeries.map(series => {
          const bar = scale.bar(row[series.key]);
          return <div className="or-chart-row" key={series.key}>
            <span>{series.label}</span>
            <div className="or-track" aria-hidden="true"><i className="or-zero" style={{ left: `${scale.zero}%` }} /><i className={`or-bar or-tone-${series.tone}`} style={{ left: `${bar.left}%`, width: `${bar.width}%` }} /></div>
            <strong>{reportMoney(row[series.key], currency)}</strong>
          </div>;
        })}
      </div>)}
    </div>
    <p className="or-muted">Only returned months are shown. A missing month is not inserted as a confirmed zero.</p>
    <details className="or-data-details"><summary>Read monthly values as a table</summary>
      <div className="or-table-scroll" tabIndex={0} role="region" aria-label={`${currency} monthly values table`}>
        <table className="or-table"><caption>Selected-period monthly values · {currency} · operational basis</caption>
          <thead><tr><th scope="col">Month</th>{trendSeries.map(series => <th scope="col" key={series.key}>{series.label}</th>)}<th scope="col">Transfer fees</th><th scope="col">Operational margin</th></tr></thead>
          <tbody>{selected.map(row => <tr key={row.period}><th scope="row">{row.period}</th>{trendSeries.map(series => <td key={series.key}>{reportMoney(row[series.key], currency)}</td>)}<td>{reportMoney(row.transfer_fees, currency)}</td><td>{reportMoney(row.net_profit, currency)}</td></tr>)}</tbody>
        </table>
      </div>
    </details>
  </div>;
}
export function ReportPerformance({ report }: { report: ReportsOverview }) {
  const currencies = [...new Set([...report.financials.map(row => row.currency), ...report.trend.map(row => row.currency)])].sort();
  return <>
    <div className="or-section-intro"><div><p className="or-kicker">Selected period</p><h2>Performance, without mixing currencies</h2></div><p>Operational results by original currency. Collections follow payment dates; they are not added to invoiced revenue again.</p></div>
    {!currencies.length ? <div className="or-empty">No financial activity was returned for this period and filter scope. Current position is available in its separate section.</div> : currencies.map(currency => {
      const financial = report.financials.find(row => row.currency === currency);
      return <section className="or-currency" key={currency} aria-label={`${currency} performance`}>
        <header><h3>{currency}</h3><span>{report.date_from} — {report.date_to}</span></header>
        <div className="or-performance-grid">{financial ? <CurrencySummary row={financial} /> : <p className="or-empty">No financial summary was returned for {currency}. Monthly values are shown separately, not substituted for a total.</p>}<MonthlyTrend rows={report.trend} currency={currency} /></div>
      </section>;
    })}
    <OperationalReportingNote />
  </>;
}
