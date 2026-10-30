import { invoiceDetailHref } from "@/lib/finance-compatibility-navigation";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, FileText, Trash2 } from "lucide-react";
import { SearchableSelect, type SearchOption } from "@/components/searchable-select";

export function InvoiceField({ label, children }: { label: string; children: ReactNode }) {
  return <label className="invoice-field"><span>{label}</span>{children}</label>;
}

export function InvoiceStatus({ status }: { status: string }) {
  return <span className="invoice-status" data-status={status}>{status.replaceAll("_", " ")}</span>;
}

export function InvoiceCounts({ total, outstanding, overdue }: { total: number; outstanding: number; overdue: number }) {
  return <dl className="invoice-counts" aria-label="Loaded invoice counts">
    <div><dt>Loaded invoices</dt><dd>{total}</dd><dd className="invoice-count-caption">Loaded matching records only</dd></div>
    <div><dt>Outstanding</dt><dd>{outstanding}</dd><dd className="invoice-count-caption">Within the loaded records</dd></div>
    <div data-tone="attention"><dt>Overdue</dt><dd>{overdue}</dd><dd className="invoice-count-caption">Within the loaded records</dd></div>
  </dl>;
}

type RegisterItem = { id: string; invoice_number: string; client_name: string; display_status: string; subject: string | null; issue_date: string; due_date: string | null; currency: string; total: string | number; amount_paid: string | number; balance_due: string | number };
export function InvoiceRegister({ invoices, loading, currentDate, formatMoney, moreAvailable = false, returnHref }: { returnHref?: string | null; moreAvailable?: boolean; invoices: RegisterItem[]; loading: boolean; currentDate: string; formatMoney: (value: string | number, currency: string) => string }) {
  return <div className="invoice-register" aria-busy={loading}>
    <table><caption className="sr-only">Invoices with client, status, dates, total, paid and balance due</caption><thead><tr>{["Invoice", "Client", "Status", "Issue / Due", "Total", "Paid", "Due"].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
      <tbody>{invoices.map((invoice) => <tr key={invoice.id}>
        <td data-label="Invoice" className="invoice-register-number"><Link href={invoiceDetailHref(invoice.id, returnHref)}>{invoice.invoice_number}<ArrowUpRight aria-hidden="true" /></Link><p>{invoice.subject || "No subject"}</p></td>
        <td data-label="Client" className="invoice-register-client">{invoice.client_name}</td>
        <td data-label="Status"><InvoiceStatus status={invoice.display_status} /></td>
        <td data-label="Issue / Due"><span>{invoice.issue_date}</span><p className={invoice.due_date && invoice.due_date < currentDate && Number(invoice.balance_due) > 0 ? "invoice-date-overdue" : "invoice-date-muted"}>Due {invoice.due_date || "—"}</p></td>
        <td data-label="Total">{formatMoney(invoice.total, invoice.currency)}</td>
        <td data-label="Paid">{formatMoney(invoice.amount_paid, invoice.currency)}</td>
        <td data-label="Due" className="invoice-register-balance">{formatMoney(invoice.balance_due, invoice.currency)}</td>
      </tr>)}</tbody>
    </table>
    {!loading && !invoices.length ? <div className="invoice-empty"><FileText aria-hidden="true" /><h3>{moreAvailable ? "No matching invoices in loaded records" : "No matching invoices"}</h3><p>{moreAvailable ? "Load more matching history below; older records may match the combined filters." : "Try clearing or changing the current filters."}</p></div> : null}
    {loading ? <p role="status" className="invoice-loading">Loading invoices…</p> : null}
  </div>;
}

type EditableLine = { product_id: string | null; item_name: string; item_type: "service" | "non_stock_item"; unit: string; description: string; quantity: string; unit_price: string; discount_percent: string; tax_rate: string };
export function InvoiceLineEditor({ line, index, sourceValue, sourceOptions, total, canRemove, onSourceChange, onChange, onRemove }: {
  line: EditableLine; index: number; sourceValue: string; sourceOptions: SearchOption[]; total: string; canRemove: boolean;
  onSourceChange: (value: string) => void; onChange: (patch: Partial<EditableLine>) => void; onRemove: () => void;
}) {
  return <fieldset className="invoice-line-editor">
    <legend>Line {index + 1}</legend>
    <div className="invoice-line-grid">
      <SearchableSelect label="Source" value={sourceValue} onValueChange={onSourceChange} options={sourceOptions} searchPlaceholder="Search products and services..." />
      <InvoiceField label="Item / service name"><input required disabled={Boolean(line.product_id)} value={line.item_name} onChange={(e) => onChange({ item_name: e.target.value })} /></InvoiceField>
      <InvoiceField label="Quantity"><input type="number" min="0.0001" step="any" value={line.quantity} onChange={(e) => onChange({ quantity: e.target.value })} /></InvoiceField>
      <InvoiceField label="Unit"><input disabled={Boolean(line.product_id)} value={line.unit} onChange={(e) => onChange({ unit: e.target.value })} /></InvoiceField>
    </div>
    <div className="invoice-line-pricing">
      <InvoiceField label="Description"><input required value={line.description} onChange={(e) => onChange({ description: e.target.value })} /></InvoiceField>
      <InvoiceField label="Unit price"><input type="number" min="0" step="any" value={line.unit_price} onChange={(e) => onChange({ unit_price: e.target.value })} /></InvoiceField>
      <InvoiceField label="Discount %"><input type="number" min="0" max="100" step="0.01" value={line.discount_percent} onChange={(e) => onChange({ discount_percent: e.target.value })} /></InvoiceField>
      <InvoiceField label="Tax %"><input type="number" min="0" max="100" step="0.01" value={line.tax_rate} onChange={(e) => onChange({ tax_rate: e.target.value })} /></InvoiceField>
    </div>
    <div className="invoice-line-footer"><button type="button" disabled={!canRemove} onClick={onRemove} aria-label={`Remove line ${index + 1}`}><Trash2 aria-hidden="true" />Remove line</button><span>Line total <strong>{total}</strong></span></div>
  </fieldset>;
}
