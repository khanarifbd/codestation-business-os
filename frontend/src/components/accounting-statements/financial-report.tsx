"use client";
import { ArrowDownLeft, ArrowUpRight, FileClock, RefreshCw, Scale } from "lucide-react";
import { useFinancialStatements } from "@/hooks/use-financial-statements";
import { statementDifference, statementMoney, statementScaled, type FinancialStatements } from "./statement-model";
import { StatementDates, StatementDatum, StatementHeading, StatementLines, StatementNotice, StatementState } from "./statement-ui";
import type { StatementSection } from "@/lib/statement-navigation";
const sections: { value: StatementSection; label: string; note: string }[] = [
  { value: "profit-loss", label: "Profit & Loss", note: "Selected period" },
  { value: "balance-sheet", label: "Balance Sheet", note: "At the period end" },
  { value: "cash-flow", label: "Cash Flow", note: "Selected period" },
];
export function FinancialReport() {
  const vm = useFinancialStatements(), data = vm.resource.value;
  return <div className="st-workspace">
    <StatementHeading eyebrow="Accounting / Reports" title="Financial statements" description="Posted-journal results, with a clear boundary between period performance and the financial position at its end." actions={<><a className="aa-secondary" href={vm.accountHref}><FileClock aria-hidden="true"/>Account statement</a><button type="button" className="aa-secondary" disabled={!vm.canView || vm.resource.loading || vm.period.invalid} onClick={() => void vm.resource.refresh()}><RefreshCw aria-hidden="true"/>Refresh</button></>}/>
    {!vm.canView ? <StatementState title="Finance viewing permission required">Management permission alone does not expose financial statements.</StatementState> : <>
      <StatementDates key={`${vm.period.from}:${vm.period.to}`} from={vm.period.from} to={vm.period.to} apply={vm.apply}/>
      <nav className="st-report-nav" aria-label="Financial statements">{sections.map(section => <button key={section.value} type="button" aria-current={vm.period.section === section.value ? "page" : undefined} onClick={() => vm.selectSection(section.value)}><strong>{section.label}</strong><span>{section.note}</span></button>)}</nav>
      {vm.period.invalid ? <StatementState title="Requested dates are invalid">Correct the date fields before loading a report. No financial values are inferred.</StatementState> : vm.resource.loading ? <StatementState title="Loading posted-journal statement" loading/> : vm.resource.error ? <StatementState title="Financial statement unavailable" action={<button type="button" className="aa-secondary" onClick={() => void vm.resource.refresh()}>Retry read</button>}>{vm.resource.error}</StatementState> : data ? <ReportBody data={data} section={vm.period.section}/> : null}
    </>}
  </div>;
}
function ReportBody({ data, section }: { data: FinancialStatements; section: StatementSection }) {
  const currency = data.base_currency, position = section === "balance-sheet", difference = statementDifference(data);
  const totals = section === "profit-loss" ? [{ label: "Income", value: data.total_income }, { label: "Expenses", value: data.total_expenses }, { label: "Net profit / loss", value: data.net_profit }]
    : position ? [{ label: "Total assets", value: data.total_assets }, { label: "Liabilities", value: data.total_liabilities }, { label: "Total equity", value: data.total_equity }]
      : [{ label: "Operating", value: data.cash_flow.operating }, { label: "Investing", value: data.cash_flow.investing }, { label: "Financing", value: data.cash_flow.financing }];
  return <>
    <div className="st-applied"><div><span className="aa-eyebrow">Applied statement</span><strong>{position ? `Position at ${data.date_to}` : `${data.date_from} — ${data.date_to}`}</strong><span>{position ? `Cumulative from ${data.functional_period_start}` : "Selected-period activity"}</span></div><div><span>Display currency</span><strong>{currency}</strong></div></div>
    {data.reporting_note ? <StatementNotice>{data.reporting_note}</StatementNotice> : null}
    <dl className="st-summary">{totals.map(row => <div key={row.label}><dt>{row.label}</dt><dd data-negative={statementScaled(row.value)! < BigInt(0) || undefined}>{statementMoney(row.value, currency)}</dd></div>)}</dl>
    <div className="st-report-layout"><main>
      {section === "profit-loss" ? <><StatementLines title="Income" rows={data.income} currency={currency} totalLabel="Total income" total={data.total_income}/><StatementLines title="Expenses" rows={data.expenses} currency={currency} totalLabel="Total expenses" total={data.total_expenses}/><div className="st-result"><span>Net profit / loss · selected period</span><strong>{statementMoney(data.net_profit, currency)}</strong></div></> : position ? <><StatementLines title="Assets" rows={data.assets} currency={currency} totalLabel="Total assets" total={data.total_assets}/><StatementLines title="Liabilities" rows={data.liabilities} currency={currency} totalLabel="Total liabilities" total={data.total_liabilities}/><StatementLines title="Recorded equity" rows={data.equity} currency={currency} totalLabel="Recorded equity" total={data.recorded_equity}/><div className="st-total"><span>Current earnings · from {data.functional_period_start}</span><strong>{statementMoney(data.current_earnings, currency)}</strong></div><div className="st-total"><span>Total equity, including current earnings</span><strong>{statementMoney(data.total_equity, currency)}</strong></div><div className="st-result"><span>Liabilities + equity</span><strong>{statementMoney(data.total_liabilities_and_equity, currency)}</strong></div></> : <CashStatement data={data}/>}
    </main><aside className="st-context"><p className="aa-eyebrow">Statement context</p><h2>Read the right period.</h2><dl><StatementDatum label="Applied requested period">{data.date_from} — {data.date_to}</StatementDatum><StatementDatum label="Functional-currency period">{data.functional_period_start} — {data.functional_period_end || "Open ended"}</StatementDatum><StatementDatum label="Accounting currency">{data.accounting_currency}</StatementDatum><StatementDatum label="Configured reporting currency">{data.reporting_currency}</StatementDatum><StatementDatum label="Actual display currency">{currency}</StatementDatum><StatementDatum label="Reporting conversion">{data.reporting_rate_applied ? data.accounting_currency === data.base_currency ? "Same currency · no display conversion" : `Current configured rate · ${data.reporting_rate}` : "Not applied; accounting currency shown"}</StatementDatum></dl><p>Reporting conversion changes presentation only. Historical journal amounts remain unchanged.</p>{position ? <div className="st-equation"><Scale aria-hidden="true"/><strong>Displayed equation difference</strong><span>{statementMoney(difference, currency)}</span><p>Assets minus liabilities and equity. A zero difference is not an audit opinion; current display conversion may introduce independent rounding differences.</p></div> : <p>{section === "cash-flow" ? "Cash classifications follow the existing journal source categories. Functional-currency transition openings are excluded from period cash flow." : "Current earnings on the Balance Sheet are cumulative for the functional-currency period, not necessarily this selected period’s profit."}</p>}</aside></div>
  </>;
}
function CashStatement({ data }: { data: FinancialStatements }) {
  const rows = [{ key: "operating", label: "Operating activities", note: "Day-to-day activity by journal source" }, { key: "investing", label: "Investing activities", note: "Asset and investment journal sources" }, { key: "financing", label: "Financing activities", note: "Loans, capital and investor journal sources" }] as const;
  return <section className="st-cash"><h2>Cash movement by activity</h2>{rows.map(row => {
    const amount = data.cash_flow[row.key], cents = statementScaled(amount)!;
    return <div key={row.key} className="st-cash-row" data-negative={cents < BigInt(0) || undefined}><span className="st-cash-sign">{cents > BigInt(0) ? <ArrowDownLeft aria-label="Net inflow"/> : cents < BigInt(0) ? <ArrowUpRight aria-label="Net outflow"/> : <span aria-label="No net change">—</span>}</span><div><h3>{row.label}</h3><p>{row.note}</p></div><strong>{statementMoney(amount, data.base_currency)}</strong></div>;
  })}<div className="st-result"><span>Net cash change · selected period</span><strong>{statementMoney(data.cash_flow.net_change, data.base_currency)}</strong></div></section>;
}
