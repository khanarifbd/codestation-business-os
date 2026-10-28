"use client";
import Link from "next/link";
import { RefreshCw, Printer, ExternalLink, ArrowRight } from "lucide-react";
import { usePortalDocument } from "@/hooks/use-client-portal-document";
import type { PortalRead } from "@/hooks/use-client-portal-resource";
import type { PortalContext } from "./portal-types";
import { portalMoney, portalPaymentHref, portalPositive } from "./portal-model";
import { PortalDatum, PortalFrame, PortalItems, PortalNotes, PortalParties, PortalState, PortalStatus, portalDateText } from "./portal-ui";

type ReadGate = {
  scope: { loading: boolean };
  context: PortalRead<PortalContext>;
  record: { value: unknown; loading: boolean; error: string | null };
  validId: boolean;
  backHref: string;
  refresh: () => void;
};
export function portalDocumentPlaceholder(vm: ReadGate) {
  if (vm.scope.loading || vm.context.loading) return <PortalState title="Verifying linked-client access" loading backHref={vm.backHref} />;
  if (!vm.context.value) return <PortalState title="Client portal access unavailable" backHref={vm.backHref} retry={vm.refresh}>{vm.context.error || "Linked-client access could not be verified."} Previous document information and actions are hidden.</PortalState>;
  if (!vm.validId) return <PortalState title="Invalid document address" backHref={vm.backHref}>Return to the register and choose a shared document.</PortalState>;
  if (vm.record.loading) return <PortalState title="Loading this document" loading backHref={vm.backHref}>Previous document information and actions are hidden.</PortalState>;
  if (vm.record.error || !vm.record.value) return <PortalState title="Document unavailable" backHref={vm.backHref} retry={vm.refresh}>{vm.record.error || "No verified document was returned."} Choose another shared document or retry loading this one.</PortalState>;
  return null;
}
function Refresh({ onClick }: { onClick: () => void }) {
  return <button type="button" className="cp-button" onClick={onClick}><RefreshCw size={16} aria-hidden="true" />Refresh document</button>;
}
export function PortalProjectDocument({ id }: { id: string }) {
  const vm = usePortalDocument("projects", id), row = vm.record.value, placeholder = portalDocumentPlaceholder(vm);
  if (placeholder || !row) return placeholder;
  return <PortalFrame active="projects" title={row.name} organization={vm.context.value?.organization_name} description="Project information and milestones explicitly shared with your client profile." backHref={vm.backHref} backLabel="Back to projects" actions={<Refresh onClick={vm.refresh} />}>
    <div className="cp-document-title"><span>{row.project_number}</span><PortalStatus status={row.status} /><span>{vm.clientName(row.client_id)}</span></div>
    <dl className="cp-facts"><PortalDatum label="Task-based progress" emphasis>{row.progress_percent}%</PortalDatum><PortalDatum label="Contract value">{portalMoney(row.contract_value, row.currency)}</PortalDatum><PortalDatum label="Planned start">{portalDateText(row.planned_start_date)}</PortalDatum><PortalDatum label="Due date">{portalDateText(row.due_date)}</PortalDatum></dl>
    <section className="cp-panel cp-delivery"><div><p className="cp-kicker">Delivery context</p><h2>Progress and lifecycle are distinct</h2><p>Progress reflects recorded task progress. It does not approve a milestone or complete the project automatically.</p><div className="cp-progress" role="progressbar" aria-label="Project task-based progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={row.progress_percent}><span style={{ width: `${row.progress_percent}%` }} /></div></div><dl><PortalDatum label="Actually started">{portalDateText(row.actual_started_at)}</PortalDatum><PortalDatum label="Completed">{portalDateText(row.completed_at)}</PortalDatum></dl></section>
    {row.description ? <section className="cp-panel"><h2>Project scope</h2><p className="cp-preserve">{row.description}</p></section> : null}
    <section className="cp-panel"><div className="cp-panel-heading"><h2>Shared milestones</h2><p>Only milestones explicitly shared with your client profile appear here.</p></div>
      {row.milestones.length ? <div className="cp-milestones">{row.milestones.map(milestone => <article key={milestone.id}><div><h3>{milestone.title}</h3>{milestone.description ? <p>{milestone.description}</p> : null}<small>Due {portalDateText(milestone.due_date)} · completed {portalDateText(milestone.completed_at)}</small></div><PortalStatus status={milestone.status} /><strong>{milestone.progress_percent}%</strong></article>)}</div> : <p className="cp-empty">No client-visible milestones were returned.</p>}
    </section>
  </PortalFrame>;
}
export function PortalOrderDocument({ id }: { id: string }) {
  const vm = usePortalDocument("orders", id), row = vm.record.value, placeholder = portalDocumentPlaceholder(vm);
  if (placeholder || !row) return placeholder;
  return <PortalFrame active="orders" title={row.subject || row.order_number} organization={vm.context.value?.organization_name} description="Original order scope and current approved contract value are shown separately." backHref={vm.backHref} backLabel="Back to orders" actions={<Refresh onClick={vm.refresh} />}>
    <div className="cp-document-title"><span>{row.order_number}</span><PortalStatus status={row.status} />{row.quotation_id ? <Link href={`/dashboard/client/quotations/${row.quotation_id}`} className="cp-open">View linked quotation<ArrowRight size={15} aria-hidden="true" /></Link> : null}</div>
    <dl className="cp-facts"><PortalDatum label="Current contract" emphasis>{portalMoney(row.revised_contract_value, row.currency)}</PortalDatum><PortalDatum label="Original order">{portalMoney(row.total, row.currency)}</PortalDatum><PortalDatum label="Approved changes">{portalMoney(row.approved_change_value, row.currency)}</PortalDatum><PortalDatum label="Order date">{portalDateText(row.order_date)}</PortalDatum></dl>
    <PortalParties record={row} />
    <dl className="cp-timeline"><PortalDatum label="Confirmed">{portalDateText(row.confirmed_at)}</PortalDatum><PortalDatum label="Started">{portalDateText(row.started_at)}</PortalDatum><PortalDatum label="Completed">{portalDateText(row.completed_at)}</PortalDatum><PortalDatum label="Cancelled">{portalDateText(row.cancelled_at)}</PortalDatum></dl>
    <PortalItems record={row} order /><PortalNotes record={row} />
  </PortalFrame>;
}
export function PortalQuotationDocument({ id }: { id: string }) {
  const vm = usePortalDocument("quotations", id), row = vm.record.value, placeholder = portalDocumentPlaceholder(vm);
  if (placeholder || !row) return placeholder;
  const decisionHref = (decision: string) => `/dashboard/client/quotations/${encodeURIComponent(id)}/decision?decision=${decision}&return_to=${encodeURIComponent(vm.backHref)}`;
  return <PortalFrame active="quotations" title={row.subject || row.quotation_number} organization={vm.context.value?.organization_name} description="Read the shared quotation, then open a separate decision review when available." backHref={vm.backHref} backLabel="Back to quotations" actions={<Refresh onClick={vm.refresh} />}>
    <div className="cp-document-title"><span>{row.quotation_number}</span><PortalStatus status={row.status} /><span>{row.client_name}</span></div>
    <dl className="cp-facts"><PortalDatum label="Quotation total" emphasis>{portalMoney(row.total, row.currency)}</PortalDatum><PortalDatum label="Issued">{portalDateText(row.issue_date)}</PortalDatum><PortalDatum label="Valid until">{portalDateText(row.valid_until)}</PortalDatum><PortalDatum label="Current status"><PortalStatus status={row.status} /></PortalDatum></dl>
    {row.status === "sent" ? <section className="cp-decision-entry"><div><h2>Ready to review your decision?</h2><p>Only the latest sent revision can receive a decision. Acceptance updates this quotation; it does not create an order.</p></div><div><a className="cp-button cp-primary" href={decisionHref("accepted")} onClick={event => { if (!vm.record.isCurrent()) event.preventDefault(); }}>Review acceptance</a><a className="cp-button cp-danger" href={decisionHref("rejected")} onClick={event => { if (!vm.record.isCurrent()) event.preventDefault(); }}>Review rejection</a></div></section> : null}
    <PortalParties record={row} />
    <dl className="cp-timeline"><PortalDatum label="Accepted">{portalDateText(row.accepted_at)}</PortalDatum><PortalDatum label="Rejected">{portalDateText(row.rejected_at)}</PortalDatum></dl>
    <PortalItems record={row} /><PortalNotes record={row} />
  </PortalFrame>;
}
export function PortalInvoiceDocument({ id }: { id: string }) {
  const vm = usePortalDocument("invoices", id), row = vm.record.value, placeholder = portalDocumentPlaceholder(vm);
  if (placeholder || !row) return placeholder;
  const paymentHref = portalPaymentHref(row.payment_url), canPay = Boolean(paymentHref && portalPositive(row.balance_due));
  return <PortalFrame active="invoices" title={row.subject || row.invoice_number} organization={vm.context.value?.organization_name} description="Saved invoice totals, payment instructions and confirmed receipts for this document." backHref={vm.backHref} backLabel="Back to invoices" actions={<><Refresh onClick={vm.refresh} /><Link className="cp-button" onClick={event => { if (!vm.record.isCurrent()) event.preventDefault(); }} href={`/dashboard/client/invoices/${encodeURIComponent(id)}/print?return_to=${encodeURIComponent(vm.backHref)}`}><Printer size={16} aria-hidden="true" />Print / Save PDF</Link>{canPay ? <a className="cp-button cp-primary" href={paymentHref!} onClick={event => { if (!vm.record.isCurrent()) event.preventDefault(); }} target="_blank" rel="noopener noreferrer">Open payment link<ExternalLink size={16} aria-hidden="true" /></a> : null}</>}>
    <div className="cp-document-title"><span>{row.invoice_number}</span><PortalStatus status={row.status} /><span>{row.client_name}</span></div>
    <dl className="cp-facts"><PortalDatum label="Current balance due" emphasis>{portalMoney(row.balance_due, row.currency)}</PortalDatum><PortalDatum label="Invoice total">{portalMoney(row.total, row.currency)}</PortalDatum><PortalDatum label="Paid">{portalMoney(row.amount_paid, row.currency)}</PortalDatum><PortalDatum label="Due date">{portalDateText(row.due_date)}</PortalDatum></dl>
    <PortalParties record={row} /><p className="cp-muted">Issued {portalDateText(row.issue_date)}. A payment link or redirect is not proof of payment; only confirmed receipts appear below.</p>
    <PortalItems record={row} />
    <section className="cp-panel"><div className="cp-panel-heading"><h2>Payment information</h2><p>Follow the issuing company’s payment instructions. Opening a payment link does not confirm a receipt.</p></div><dl className="cp-payment-details"><PortalDatum label="Method">{row.payment_method?.replaceAll("_", " ") || "—"}</PortalDatum><PortalDatum label="Account">{row.payment_account_name || "—"}</PortalDatum>{row.payment_provider ? <PortalDatum label="Provider">{row.payment_provider}</PortalDatum> : null}{row.payment_account_holder ? <PortalDatum label="Account holder">{row.payment_account_holder}</PortalDatum> : null}{row.payment_account_reference ? <PortalDatum label="Account reference">{row.payment_account_reference}</PortalDatum> : null}{row.payment_currency ? <PortalDatum label="Receive currency">{row.payment_currency}</PortalDatum> : null}<PortalDatum label="Invoice reference">{row.invoice_number}</PortalDatum></dl>{row.payment_instructions ? <p className="cp-preserve cp-instructions">{row.payment_instructions}</p> : null}{row.payment_url && !paymentHref ? <p className="cp-error">The supplied payment link cannot be opened safely. Contact the issuing company for payment instructions.</p> : null}{canPay ? <a className="cp-button" href={paymentHref!} onClick={event => { if (!vm.record.isCurrent()) event.preventDefault(); }} target="_blank" rel="noopener noreferrer">Open payment link<ExternalLink size={16} aria-hidden="true" /></a> : null}</section>
    <section className="cp-panel"><div className="cp-panel-heading"><h2>Confirmed payment history</h2><p>Invoice-specific confirmed receipts only. Pending and reversed payments are not included.</p></div>{row.payments.length ? <div className="cp-payments">{row.payments.map(payment => <article key={payment.id}><div><strong>{portalDateText(payment.payment_date)}</strong><p>{payment.method.replaceAll("_", " ")}{payment.reference ? ` · ${payment.reference}` : ""}</p></div><strong>{portalMoney(payment.invoice_amount, payment.invoice_currency)}</strong></article>)}</div> : <p className="cp-empty">No confirmed payments were returned for this invoice.</p>}</section>
    <PortalNotes record={row} />
  </PortalFrame>;
}
