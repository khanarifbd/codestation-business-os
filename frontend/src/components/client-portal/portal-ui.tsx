"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { AccountHeading, AccountState } from "@/components/accounting-accounts/account-ui";
import { formatPortalDate, portalStatusLabel } from "@/components/client-portal-ui";
import { portalDecimalText, portalMoney } from "./portal-model";
import type { ClientPortalInvoiceDetail, ClientPortalOrderDetail, ClientPortalQuotationDetail, PortalKind } from "./portal-types";
export const portalTitles: Record<PortalKind, string> = { projects: "Projects", orders: "Orders", quotations: "Quotations", invoices: "Invoices" };
export { formatPortalDate as portalDateText, portalStatusLabel };
export function PortalFrame({ children, active, title, description, organization, backHref, backLabel = "Back to register", actions }: { children: ReactNode; active?: PortalKind; title: string; description: string; organization?: string; backHref?: string; backLabel?: string; actions?: ReactNode }) {
  return <main className="cp-page"><div className="cp-container">
    {backHref ? <Link href={backHref} className="cp-back"><ArrowLeft size={16} aria-hidden="true" />{backLabel}</Link> : null}
    <AccountHeading eyebrow={organization ? `Client portal / ${organization}` : "Client portal"} title={title} description={description} actions={actions} />
    <nav className="cp-nav" aria-label="Client portal"><Link href="/dashboard/client" aria-current={!active ? "page" : undefined}>Overview</Link>{Object.entries(portalTitles).map(([key, label]) => <Link key={key} href={`/dashboard/client/${key}`} aria-current={active === key ? "page" : undefined}>{label}</Link>)}</nav>
    {children}
  </div></main>;
}
export function PortalState({ title, children, loading = false, retry, backHref }: { title: string; children?: ReactNode; loading?: boolean; retry?: () => void; backHref?: string }) {
  return <main className="cp-page"><div className="cp-container">{backHref ? <Link href={backHref} className="cp-back"><ArrowLeft size={16} aria-hidden="true" />Back to register</Link> : null}<AccountState title={title} loading={loading} action={retry ? <button type="button" className="cp-button" onClick={retry}><RefreshCw size={16} aria-hidden="true" />Retry safe read</button> : undefined}>{children}</AccountState></div></main>;
}
export function PortalStatus({ status }: { status: string }) { return <span className="cp-status" data-status={status}>{portalStatusLabel(status)}</span>; }
export function PortalDatum({ label, children, emphasis = false }: { label: string; children: ReactNode; emphasis?: boolean }) { return <div className={emphasis ? "cp-datum cp-emphasis" : "cp-datum"}><dt>{label}</dt><dd>{children ?? "—"}</dd></div>; }
export function PortalPager({ page, pages, total, change }: { page: number; pages: number; total: number; change: (page: number) => void }) { return <div className="cp-pager"><p>Page {page} of {pages} · {total} matching returned records</p><div><button type="button" className="cp-button" disabled={page <= 1} onClick={() => change(page - 1)}><ChevronLeft size={16} aria-hidden="true" />Previous</button><button type="button" className="cp-button" disabled={page >= pages} onClick={() => change(page + 1)}>Next<ChevronRight size={16} aria-hidden="true" /></button></div></div>; }
export function PortalOpen({ href, id }: { href: string; id?: string }) { return <Link href={href} id={id} className="cp-open">View document<ArrowRight size={15} aria-hidden="true" /></Link>; }
type CommercialDocument = ClientPortalInvoiceDetail | ClientPortalOrderDetail | ClientPortalQuotationDetail;
export function PortalParties({ record }: { record: CommercialDocument }) {
  return <section className="cp-parties"><div><h2>From</h2><strong>{record.seller_name}</strong>{record.seller_email ? <p>{record.seller_email}</p> : null}{record.seller_address ? <p className="cp-preserve">{record.seller_address}</p> : null}</div><div><h2>Prepared for</h2><strong>{record.client_name}</strong>{record.client_contact ? <p>{record.client_contact}</p> : null}{record.client_email ? <p>{record.client_email}</p> : null}{record.client_address ? <p className="cp-preserve">{record.client_address}</p> : null}</div></section>;
}
export function PortalItems({ record, order = false }: { record: CommercialDocument; order?: boolean }) {
  return <section className="cp-panel cp-items"><div className="cp-panel-heading"><h2>{order ? "Original items & service periods" : "Items and pricing"}</h2><p>{order ? "Original order snapshot. Approved commercial changes are shown separately in the current contract." : "Saved document amounts. Tax treatment is not inferred or recalculated in the portal."}</p></div>
    <div className="cp-table-scroll" tabIndex={0} role="region" aria-label="Document items"><table className="cp-table cp-item-table"><thead><tr><th scope="col">Item</th><th scope="col">Quantity</th>{order ? <th scope="col">Service period</th> : null}<th scope="col">Unit price</th><th scope="col">Discount / tax</th><th scope="col">Line total</th></tr></thead><tbody>{record.items.map(item => <tr key={item.id}><th scope="row"><strong>{item.item_name}</strong>{item.description ? <p>{item.description}</p> : null}</th><td data-label="Quantity">{portalDecimalText(item.quantity)} {item.unit}</td>{order && "service_duration_months" in item ? <td data-label="Service period">{item.service_start_date || item.service_end_date ? `${formatPortalDate(item.service_start_date)} — ${formatPortalDate(item.service_end_date)}` : item.service_duration_months ? `${item.service_duration_months} month${item.service_duration_months === 1 ? "" : "s"}` : "One-time"}</td> : null}<td data-label="Unit price">{portalMoney(item.unit_price, record.currency)}</td><td data-label="Discount / tax">{portalDecimalText(item.discount_percent)}% / {portalDecimalText(item.tax_rate)}%</td><td data-label="Line total">{portalMoney(item.line_total, record.currency)}</td></tr>)}</tbody></table></div>
    {!record.items.length ? <p className="cp-empty">No item rows were returned for this document.</p> : null}
    <dl className="cp-totals"><PortalDatum label="Subtotal">{portalMoney(record.subtotal, record.currency)}</PortalDatum><PortalDatum label="Discount">{portalMoney(record.discount_total, record.currency)}</PortalDatum><PortalDatum label="Tax">{portalMoney(record.tax_total, record.currency)}</PortalDatum><PortalDatum label={order ? "Original order total" : "Document total"} emphasis>{portalMoney(record.total, record.currency)}</PortalDatum></dl>
  </section>;
}
export function PortalNotes({ record }: { record: CommercialDocument }) { return record.notes || record.terms_conditions ? <div className="cp-notes">{record.notes ? <section className="cp-panel"><h2>Notes</h2><p className="cp-preserve">{record.notes}</p></section> : null}{record.terms_conditions ? <section className="cp-panel"><h2>Terms & conditions</h2><p className="cp-preserve">{record.terms_conditions}</p></section> : null}</div> : null; }
