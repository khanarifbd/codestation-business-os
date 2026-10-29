import type { ReactNode } from "react";

/** Shared document chrome only; create/edit state and financial calculations stay on each page. */
export function OrderEditorSectionHeading({ number, title, description, actions }: { number: string; title: string; description: string; actions?: ReactNode }) {
  return <header className="order-editor-section-heading"><div className="order-editor-section-label"><span className="order-editor-section-number" aria-hidden="true">{number}</span><div><h2>{title}</h2><p>{description}</p></div></div>{actions ? <div className="order-editor-section-actions">{actions}</div> : null}</header>;
}

export function OrderEditorSummary({ amount, currency, date, taxMode, status }: { amount: ReactNode; currency: string; date: string; taxMode: string; status?: ReactNode }) {
  return <aside className="order-editor-summary" aria-label="Current order summary"><div className="order-editor-summary-top"><p>Order summary</p>{status}</div><div className="order-editor-summary-value"><p>Order total</p><strong>{amount}</strong><small>Current line items, discounts and taxes.</small></div><dl className="order-editor-summary-details"><div><dt>Currency</dt><dd>{currency || "—"}</dd></div><div><dt>Order date</dt><dd>{date || "—"}</dd></div><div><dt>Tax calculation</dt><dd>{taxMode === "inclusive" ? "Tax inclusive" : "Tax exclusive"}</dd></div></dl><p className="order-editor-summary-note">Review the client, line items and commercial notes before saving.</p></aside>;
}
