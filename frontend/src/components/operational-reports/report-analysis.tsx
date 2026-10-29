import { reportMoney, reportPercent } from "./report-model";
import type { ReportClient, ReportProject, ReportsOverview } from "./report-types";

const operationLabels = {
  active_clients: "Active clients", open_orders: "Open orders", active_projects: "Active projects",
  overdue_tasks: "Overdue tasks", due_followups: "Due follow-ups", open_invoices: "Open invoices",
} as const;
export function ReportPosition({ report, currency }: { report: ReportsOverview; currency: string }) {
  return <>
    <div className="or-section-intro"><div><p className="or-kicker">Current position</p><h2>A snapshot of the workspace now</h2></div><p>Not an as-of-date report. Selected dates, client and project do not apply to this section.</p></div>
    <section className="or-panel"><h3>Organization-wide operations</h3><p className="or-muted">All financial filters, including currency, are ignored for these current counts.</p>
      <dl className="or-operations">{Object.entries(operationLabels).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{report.operations[key as keyof typeof operationLabels]}</dd></div>)}</dl>
      <p className="or-muted">Active projects include planned and on-hold work. Open invoices include drafts and exclude paid or cancelled invoices. Overdue tasks use the organization&apos;s date.</p>
    </section>
    <section className="or-panel"><div className="or-subheading"><h3>Active account balances</h3><p>Current recorded balances · {currency || "all currencies, shown separately"}. Only the currency filter applies.</p></div>
      {!report.accounts.length ? <p className="or-empty">No active accounts were returned for this currency scope.</p> : <div className="or-accounts">{report.accounts.map(row => <article key={row.account_id}><div><h4>{row.account_name}</h4><p>{row.account_type.replaceAll("_", " ")}{row.account_type === "credit_card" ? " · card balance, not available cash" : ""}</p></div><strong>{reportMoney(row.balance, row.currency)}</strong></article>)}</div>}
      <p className="or-muted">Opening balances plus recorded credits less debits. No cross-currency balance total or period-end position is inferred.</p>
    </section>
  </>;
}
function ActivityCells({ row, costLabel }: { row: ReportProject | ReportClient; costLabel: string }) {
  return <><td data-label="Invoiced">{reportMoney(row.invoiced_revenue, row.currency)}</td><td data-label="Collected">{reportMoney(row.collected_revenue, row.currency)}</td><td data-label={costLabel}>{reportMoney(row.direct_expenses, row.currency)}</td><td data-label="Estimated profit">{reportMoney(row.estimated_profit, row.currency)}</td><td data-label="Margin">{reportPercent(row.margin_percent)}</td></>;
}
export function ReportProjects({ rows }: { rows: ReportProject[] }) {
  return <>
    <div className="or-section-intro"><div><p className="or-kicker">Selected project population</p><h2>Project performance</h2></div><p>Up to 100 newest-created projects after currency, client and project filters. No server pagination or full-population count is available.</p></div>
    <p className="or-scope-note">Project selection itself is not date-limited. Invoiced, collected and direct cost use the selected period; contract value is the saved project amount. Profit and margin use the server&apos;s invoice-minus-direct-cost basis.</p>
    <div className="or-panel or-table-panel"><div className="or-table-scroll" tabIndex={0} role="region" aria-label="Project performance table"><table className="or-table or-responsive-table">
      <caption>{rows.length} project{rows.length === 1 ? "" : "s"} returned · newest 100 maximum, not all matching projects</caption>
      <thead><tr><th scope="col">Project / client</th><th scope="col">Contract value</th><th scope="col">Invoiced</th><th scope="col">Collected</th><th scope="col">Direct cost</th><th scope="col">Estimated profit</th><th scope="col">Margin</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.project_id}><th scope="row"><strong>{row.project_number}</strong><span>{row.project_name}</span><small>{row.client_name} · {row.currency}</small></th><td data-label="Contract value">{reportMoney(row.contract_value, row.currency)}</td><ActivityCells row={row} costLabel="Direct cost" /></tr>)}</tbody>
    </table></div>{!rows.length ? <p className="or-empty">No projects were returned for this scope. This is not a claim that the organization has no projects.</p> : null}</div>
  </>;
}
export function ReportClients({ rows, projectFiltered }: { rows: ReportClient[]; projectFiltered: boolean }) {
  return <>
    <div className="or-section-intro"><div><p className="or-kicker">Client-attributed activity</p><h2>Client performance</h2></div><p>Activity for the first 100 clients alphabetically, after an optional client filter. Each nonzero currency bucket is separate, so the table may contain more than 100 rows.</p></div>
    <p className={projectFiltered ? "or-scope-note or-warning" : "or-scope-note"}><strong>Project filter does not apply here.</strong> Selected dates, currency and client do apply. Linked cost includes all posted client-attributed expense categories, not only direct costs. No server pagination or full-population count is available.</p>
    <div className="or-panel or-table-panel"><div className="or-table-scroll" tabIndex={0} role="region" aria-label="Client performance table"><table className="or-table or-responsive-table">
      <caption>{rows.length} client-currency row{rows.length === 1 ? "" : "s"} returned · capped underlying client selection</caption>
      <thead><tr><th scope="col">Client / currency</th><th scope="col">Invoiced</th><th scope="col">Collected</th><th scope="col">Linked cost</th><th scope="col">Estimated profit</th><th scope="col">Margin</th></tr></thead>
      <tbody>{rows.map(row => <tr key={`${row.client_id}:${row.currency}`}><th scope="row"><strong>{row.client_name}</strong><small>{row.currency}</small></th><ActivityCells row={row} costLabel="Linked cost" /></tr>)}</tbody>
    </table></div>{!rows.length ? <p className="or-empty">No nonzero client-attributed activity was returned from this selected client population.</p> : null}</div>
  </>;
}
