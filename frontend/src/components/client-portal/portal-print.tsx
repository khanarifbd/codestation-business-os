"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import QRCode from "@/lib/qrcode-svg";
import { usePortalDocument } from "@/hooks/use-client-portal-document";
import { portalMoney, portalPaymentHref, portalPositive } from "./portal-model";
import { portalDocumentPlaceholder } from "./portal-documents";
import { PortalDatum, PortalItems, PortalNotes, PortalParties, portalDateText } from "./portal-ui";
function PaymentQr({ value }: { value: string }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = root.current;
    if (!container) return;
    const svg = QRCode({ msg: value, dim: 128, pad: 4, ecl: "M", pal: ["#000", "#fff"] });
    svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "QR code for this invoice payment link");
    container.replaceChildren(svg);
    return () => { container.replaceChildren(); };
  }, [value]);
  return <div ref={root} className="cp-payment-qr" />;
}
export function PortalInvoicePrint({ id }: { id: string }) {
  const vm = usePortalDocument("invoices", id), row = vm.record.value, placeholder = portalDocumentPlaceholder(vm);
  if (placeholder || !row) return placeholder;
  const paymentHref = portalPaymentHref(row.payment_url), due = portalPositive(row.balance_due);
  return <main className="cp-page cp-print-page"><div className="cp-container">
    <div className="cp-print-toolbar"><Link href={vm.detailHref} className="cp-button">← Back to invoice</Link><button type="button" className="cp-button cp-primary" onClick={() => { if (vm.record.isCurrent()) window.print(); }}>Print / Save PDF</button></div>
    <article className="cp-print-document">
      <header><div><p className="cp-kicker">Invoice</p><h1>{row.invoice_number}</h1>{row.subject ? <p>{row.subject}</p> : null}</div><strong>{portalMoney(row.total, row.currency)}</strong></header>
      <PortalParties record={row} />
      <dl className="cp-facts"><PortalDatum label="Issued">{portalDateText(row.issue_date)}</PortalDatum><PortalDatum label="Due">{portalDateText(row.due_date)}</PortalDatum><PortalDatum label="Currency">{row.currency}</PortalDatum><PortalDatum label="Status">{row.status.replaceAll("_", " ")}</PortalDatum></dl>
      <PortalItems record={row} />
      <dl className="cp-totals"><PortalDatum label="Paid">{portalMoney(row.amount_paid, row.currency)}</PortalDatum><PortalDatum label="Balance due" emphasis>{portalMoney(row.balance_due, row.currency)}</PortalDatum></dl>
      {due ? <section className="cp-print-payment"><div><h2>Payment information</h2><dl className="cp-payment-details">{row.payment_method ? <PortalDatum label="Method">{row.payment_method.replaceAll("_", " ")}</PortalDatum> : null}{row.payment_account_name ? <PortalDatum label="Account">{row.payment_account_name}</PortalDatum> : null}{row.payment_provider ? <PortalDatum label="Provider">{row.payment_provider}</PortalDatum> : null}{row.payment_account_holder ? <PortalDatum label="Account holder">{row.payment_account_holder}</PortalDatum> : null}{row.payment_account_reference ? <PortalDatum label="Account reference">{row.payment_account_reference}</PortalDatum> : null}{row.payment_currency ? <PortalDatum label="Receive currency">{row.payment_currency}</PortalDatum> : null}<PortalDatum label="Payment reference">{row.invoice_number}</PortalDatum></dl>{row.payment_instructions ? <p className="cp-preserve">{row.payment_instructions}</p> : null}{paymentHref ? <a className="cp-print-pay-url" href={paymentHref} onClick={event => { if (!vm.record.isCurrent()) event.preventDefault(); }} target="_blank" rel="noopener noreferrer">{paymentHref}</a> : null}{row.payment_url && !paymentHref ? <p>The supplied payment link cannot be displayed safely. Contact the issuing company.</p> : null}</div>{paymentHref ? <div><PaymentQr value={paymentHref} /><small>Invoice payment link</small></div> : null}</section> : null}
      <PortalNotes record={row} />
    </article>
  </div></main>;
}
