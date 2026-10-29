import { useState, type FormEvent, type ReactNode } from "react";
import { CalendarDays } from "lucide-react";
import { AccountHeading, AccountState } from "@/components/accounting-accounts/account-ui";
import { statementDate, statementMoney, type StatementRow } from "./statement-model";
export { AccountHeading as StatementHeading, AccountState as StatementState };
export function StatementNotice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div className="st-notice" data-error={error || undefined} role={error ? "alert" : "status"}>{children}</div>;
}
export function StatementField({ label, children }: { label: string; children: ReactNode }) {
  return <label className="st-field"><span>{label}</span>{children}</label>;
}
export function StatementDates({ from, to, apply }: { from: string; to: string; apply: (from: string, to: string) => boolean }) {
  const [draftFrom, setFrom] = useState(from), [draftTo, setTo] = useState(to), [error, setError] = useState(false);
  function submit(event: FormEvent) {
    event.preventDefault();
    const valid = (!draftFrom || statementDate(draftFrom)) && (!draftTo || statementDate(draftTo));
    setError(!valid || !apply(draftFrom, draftTo));
  }
  return <form className="st-period" onSubmit={submit}>
    <div className="st-period-label"><CalendarDays aria-hidden="true"/><div><strong>Requested period</strong><span>Blank dates use the organization fiscal default.</span></div></div>
    <StatementField label="From"><input type="date" value={draftFrom} onChange={event => setFrom(event.target.value)}/></StatementField>
    <StatementField label="To"><input type="date" value={draftTo} onChange={event => setTo(event.target.value)}/></StatementField>
    <div className="st-filter-actions"><button className="aa-primary">Apply period</button><button type="button" className="st-text-button" onClick={() => { setFrom(""); setTo(""); setError(!apply("", "")); }}>Use fiscal default</button></div>
    {error ? <p className="st-inline-error" role="alert">Enter valid dates before applying the period.</p> : null}
    {draftFrom !== from || draftTo !== to ? <p className="st-draft-note">Date edits are not applied to the displayed report until you choose Apply period.</p> : null}
  </form>;
}
export function StatementLines({ title, rows, currency, totalLabel, total }: { title: string; rows: StatementRow[]; currency: string; totalLabel: string; total: string | number }) {
  return <section className="st-ledger-section"><h3>{title}<span>{rows.length} returned ledger lines</span></h3>
    {rows.length ? <table className="st-lines"><caption className="sr-only">{title} in {currency}</caption><thead><tr><th>Ledger account</th><th>Amount · {currency}</th></tr></thead><tbody>{rows.map(row => <tr key={row.code}><td><span className="st-ledger-code">{row.code}</span><strong>{row.name}</strong></td><td>{statementMoney(row.amount, currency)}</td></tr>)}</tbody></table> : <p className="st-empty-lines">No {title.toLowerCase()} lines returned in this statement.</p>}
    <div className="st-total"><span>{totalLabel}</span><strong>{statementMoney(total, currency)}</strong></div>
  </section>;
}
export function StatementDatum({ label, children }: { label: string; children: ReactNode }) { return <div><dt>{label}</dt><dd>{children}</dd></div>; }
