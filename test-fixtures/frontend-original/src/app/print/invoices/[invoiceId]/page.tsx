"use client";

import { ArrowLeft, ExternalLink, Landmark, Loader2, Printer } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import QRCode from "@/lib/qrcode-svg";

type InvoiceItem = {
  id: string;
  source_order_item_id: string | null;
  product_id: string | null;
  sort_order: number;
  item_name_snapshot: string;
  sku_snapshot: string | null;
  item_type_snapshot: string;
  unit_snapshot: string;
  description: string;
  quantity: string | number;
  unit_price: string | number;
  discount_percent: string | number;
  tax_rate: string | number;
  line_subtotal: string | number;
  discount_amount: string | number;
  taxable_amount: string | number;
  tax_amount: string | number;
  line_total: string | number;
};

type InvoiceDetail = {
  id: string;
  invoice_number: string;
  client_id: string;
  client_name: string;
  order_id: string | null;
  project_id: string | null;
  quotation_id: string | null;
  status: string;
  display_status: string;
  subject: string | null;
  issue_date: string;
  due_date: string | null;
  currency: string;
  tax_calculation_mode: string;
  seller_name_snapshot: string;
  seller_email_snapshot: string | null;
  seller_address_snapshot: string | null;
  seller_tax_identifier_snapshot: string | null;
  client_name_snapshot: string;
  client_contact_snapshot: string | null;
  client_email_snapshot: string | null;
  client_address_snapshot: string | null;
  client_tax_identifier_snapshot: string | null;
  subtotal: string | number;
  discount_total: string | number;
  tax_total: string | number;
  total: string | number;
  amount_paid: string | number;
  balance_due: string | number;
  notes: string | null;
  terms_conditions: string | null;
  sent_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  items: InvoiceItem[];
};

type PaymentInstructions = {
  invoice_id: string;
  invoice_number: string;
  invoice_status: string;
  invoice_currency: string;
  payment_method: string | null;
  payment_account_id: string | null;
  payment_account_name: string | null;
  payment_provider: string | null;
  payment_account_holder: string | null;
  payment_account_reference: string | null;
  payment_currency: string | null;
  payment_url: string | null;
  payment_instructions: string | null;
  locked: boolean;
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  bank_transfer: "Bank transfer",
  payoneer: "Payoneer",
  wise: "Wise",
  stripe: "Stripe",
  paypal: "PayPal",
  card: "Card / payment link",
  cash: "Cash",
  other: "Other",
};

function money(value: string | number | null | undefined, currency: string) {
  return `${currency} ${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function humanize(value: string | null | undefined) {
  if (!value) return "—";
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function sellerMonogram(name: string) {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
  return letters || "I";
}

function apiError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) =>
        item && typeof item === "object" && "msg" in item
          ? String((item as { msg: unknown }).msg)
          : String(item),
      )
      .join(" · ");
  }
  return fallback;
}

function paymentMethodLabel(value: string | null) {
  return value ? PAYMENT_METHOD_LABELS[value] ?? humanize(value) : "Payment";
}

function LocalPaymentQr({ value }: { value: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const svg = QRCode({ msg: value, dim: 148, pad: 4, ecl: "M", pal: ["#000", "#fff"] });
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "QR code for invoice payment link");
    svg.classList.add("size-[148px]");
    container.replaceChildren(svg);
    return () => {
      container.replaceChildren();
    };
  }, [value]);

  return <div ref={containerRef} className="size-[148px]" />;
}

export default function InvoicePrintPage() {
  const params = useParams<{ invoiceId: string }>();
  const router = useRouter();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [payment, setPayment] = useState<PaymentInstructions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [invoiceResponse, paymentResponse] = await Promise.all([
          fetch(`/api/finance/invoices/${encodeURIComponent(params.invoiceId)}`, { cache: "no-store" }),
          fetch(`/api/finance/invoices/${encodeURIComponent(params.invoiceId)}/payment-instructions`, {
            cache: "no-store",
          }),
        ]);

        if (invoiceResponse.status === 401 || paymentResponse.status === 401) {
          router.replace("/login");
          return;
        }

        const [invoicePayload, paymentPayload] = await Promise.all([
          invoiceResponse.json().catch(() => null),
          paymentResponse.json().catch(() => null),
        ]);

        if (!invoiceResponse.ok) throw new Error(apiError(invoicePayload, "Unable to load invoice."));
        if (!paymentResponse.ok) {
          throw new Error(apiError(paymentPayload, "Unable to load invoice payment instructions."));
        }

        if (active) {
          setInvoice(invoicePayload as InvoiceDetail);
          setPayment(paymentPayload as PaymentInstructions);
        }
      } catch (reason) {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Unable to load invoice.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [params.invoiceId, router]);

  useEffect(() => {
    if (!invoice) return;
    const previousTitle = document.title;
    const safeNumber = invoice.invoice_number.replace(/[^a-zA-Z0-9._-]+/g, "-");
    document.title = safeNumber;
    return () => {
      document.title = previousTitle;
    };
  }, [invoice]);

  const sortedItems = useMemo(
    () => [...(invoice?.items ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    [invoice],
  );

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-100">
        <Loader2 className="size-7 animate-spin text-neutral-400" />
      </main>
    );
  }

  if (error || !invoice || !payment) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-100 p-6">
        <div className="rounded-2xl border bg-white p-8 text-center shadow-sm">
          <p className="font-semibold">Invoice unavailable</p>
          <p className="mt-2 text-sm text-neutral-500">{error ?? "Invoice not found"}</p>
        </div>
      </main>
    );
  }

  const monogram = sellerMonogram(invoice.seller_name_snapshot);
  const amountPaid = Number(invoice.amount_paid || 0);
  const balanceDue = Number(invoice.balance_due || 0);
  const isPaid = balanceDue <= 0 && Number(invoice.total || 0) > 0;
  const hasPaymentInstructions = Boolean(
    payment.payment_method ||
      payment.payment_account_id ||
      payment.payment_url ||
      payment.payment_instructions,
  );
  const showPaymentInstructions = hasPaymentInstructions && balanceDue > 0;
  const sellerContact = invoice.seller_email_snapshot || "";

  return (
    <main className="min-h-screen overflow-x-auto bg-neutral-100 px-4 py-8 text-neutral-950 print:overflow-visible print:bg-white print:p-0">
      <style jsx global>{`
        @page {
          size: A4;
          margin: 8mm;
        }

        /* Match the A4 content box on screen with the printable A4 content area. */
        .print-sheet {
          box-sizing: border-box;
          width: 210mm;
          max-width: none;
          min-height: 297mm;
          padding: 8mm;
        }

        /*
         * Shared compact A4 typesetting. Apply to both screen preview and print
         * rather than shrinking only in @media print (which caused mismatches).
         * Preserve readable QR size and allow truly long invoices to paginate.
         */
        .print-sheet {
          font-size: 11px;
          line-height: 1.3;
        }
        .print-sheet .text-xs { font-size: 9px; }
        .print-sheet .text-sm { font-size: 10.5px; line-height: 1.3; }
        .print-sheet .text-base { font-size: 12px; }
        .print-sheet .text-lg { font-size: 13px; }
        .print-sheet .text-xl { font-size: 16px; }
        .print-sheet .text-2xl { font-size: 18px; }
        .print-sheet .text-3xl { font-size: 23px; }
        .print-sheet .leading-6 { line-height: 1.4; }
        .print-sheet .leading-5 { line-height: 1.35; }
        .print-sheet .mt-9 { margin-top: 12px; }
        .print-sheet .mt-7 { margin-top: 10px; }
        .print-sheet .mt-5 { margin-top: 9px; }
        .print-sheet .mt-4 { margin-top: 8px; }
        .print-sheet .mt-3 { margin-top: 6px; }
        .print-sheet .mt-2 { margin-top: 4px; }
        .print-sheet .mt-1 { margin-top: 2px; }
        .print-sheet .mt-1\.5 { margin-top: 3px; }
        .print-sheet .pb-7 { padding-bottom: 11px; }
        .print-sheet .pt-5 { padding-top: 8px; }
        .print-sheet .p-6 { padding: 12px; }
        .print-sheet .p-5 { padding: 11px; }
        .print-sheet .p-3 { padding: 8px; }
        .print-sheet .px-4 { padding-left: 10px; padding-right: 10px; }
        .print-sheet .py-3 { padding-top: 7px; padding-bottom: 7px; }
        .print-sheet .gap-8 { gap: 12px; }
        .print-sheet .gap-7 { gap: 11px; }
        .print-sheet .gap-6 { gap: 10px; }
        .print-sheet .gap-5 { gap: 9px; }
        .print-sheet .gap-4 { gap: 8px; }
        .print-sheet .gap-y-4 { row-gap: 7px; }
        .print-sheet [aria-label$="document mark"] {
          width: 40px;
          height: 40px;
          border-radius: 11px;
        }
        .print-sheet .invoice-summary-card {
          padding: 12px;
        }
        .print-sheet .invoice-summary-card > div.mt-4 {
          margin-top: 9px;
          padding-top: 9px;
        }
        .print-sheet .payment-card {
          padding: 12px;
        }
        .print-sheet .payment-card a {
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        .print-sheet .payment-card div:has(> svg[aria-label="QR code for invoice payment link"]) {
          width: 112px;
          height: 112px;
          flex-shrink: 0;
        }
        .print-sheet .payment-card svg[aria-label="QR code for invoice payment link"] {
          width: 112px;
          height: 112px;
        }
        .print-sheet .notes-card > div { padding: 11px; }
        .print-sheet .avoid-break,
        .print-sheet .invoice-summary-card,
        .print-sheet .payment-card,
        .print-sheet .notes-card {
          break-inside: avoid;
          page-break-inside: avoid;
        }

        @media print {
          html,
          body {
            background: white !important;
            min-width: 0 !important;
            print-color-adjust: exact !important;
            -webkit-print-color-adjust: exact !important;
          }

          .print-actions {
            display: none !important;
          }

          .print-sheet {
            box-shadow: none !important;
            border: 0 !important;
            margin: 0 !important;
            /* @page reserves the same 8mm inset used by screen preview. */
            width: 194mm !important;
            max-width: none !important;
            min-height: 0 !important;
            padding: 0 !important;
          }

          .avoid-break,
          .invoice-summary-card,
          .payment-card,
          .notes-card {
            break-inside: avoid;
            page-break-inside: avoid;
          }

          thead {
            display: table-header-group;
          }

          tr {
            break-inside: avoid;
            page-break-inside: avoid;
          }

          .print-muted-bg {
            background: #f5f5f5 !important;
          }

          .print-dark-bg {
            background: #171717 !important;
            color: #ffffff !important;
          }
        }
      `}</style>

      <div className="print-actions mx-auto mb-4 flex max-w-[210mm] items-center justify-between gap-3">
        <Link
          href={`/dashboard/accounting/invoices/${encodeURIComponent(invoice.id)}`}
          className="flex h-10 items-center gap-2 rounded-xl border bg-white px-4 text-sm font-semibold"
        >
          <ArrowLeft className="size-4" /> Back
        </Link>
        <div className="flex items-center gap-3">
          <p className="hidden text-xs text-neutral-500 sm:block">
            Choose “Save as PDF” in the print dialog to download.
          </p>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex h-10 items-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white"
          >
            <Printer className="size-4" /> Print / Save PDF
          </button>
        </div>
      </div>

      <article className="print-sheet mx-auto bg-white shadow-xl ring-1 ring-neutral-200 print:min-h-0">
        <header className="avoid-break border-b border-neutral-200 pb-7">
          <div className="flex items-start justify-between gap-8">
            <div className="flex min-w-0 items-start gap-4">
              <div
                aria-label={`${invoice.seller_name_snapshot} document mark`}
                className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-neutral-950 text-lg font-semibold tracking-tight text-white"
              >
                {monogram}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Invoice</p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight">{invoice.invoice_number}</h1>
                <span className="mt-3 inline-flex rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs font-semibold">
                  {humanize(invoice.display_status)}
                </span>
              </div>
            </div>

            <div className="max-w-[285px] text-right">
              <p className="text-lg font-semibold">{invoice.seller_name_snapshot}</p>
              {invoice.seller_email_snapshot ? (
                <p className="mt-1 text-sm text-neutral-500">{invoice.seller_email_snapshot}</p>
              ) : null}
              {invoice.seller_address_snapshot ? (
                <p className="mt-1 whitespace-pre-line text-sm leading-5 text-neutral-500">
                  {invoice.seller_address_snapshot}
                </p>
              ) : null}
              {invoice.seller_tax_identifier_snapshot ? (
                <p className="mt-2 text-xs text-neutral-400">Tax ID: {invoice.seller_tax_identifier_snapshot}</p>
              ) : null}
            </div>
          </div>
        </header>

        <section className="avoid-break mt-7 grid grid-cols-[1.15fr_.85fr] gap-7">
          <div className="rounded-2xl border border-neutral-200 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Bill to</p>
            <p className="mt-2 text-xl font-semibold">{invoice.client_name_snapshot}</p>
            {invoice.client_contact_snapshot ? (
              <p className="mt-1 text-sm text-neutral-600">Attn: {invoice.client_contact_snapshot}</p>
            ) : null}
            {invoice.client_email_snapshot ? (
              <p className="mt-1 text-sm text-neutral-500">{invoice.client_email_snapshot}</p>
            ) : null}
            {invoice.client_address_snapshot ? (
              <p className="mt-2 whitespace-pre-line text-sm leading-5 text-neutral-500">
                {invoice.client_address_snapshot}
              </p>
            ) : null}
            {invoice.client_tax_identifier_snapshot ? (
              <p className="mt-2 text-xs text-neutral-400">Tax ID: {invoice.client_tax_identifier_snapshot}</p>
            ) : null}
          </div>

          <div className="print-muted-bg rounded-2xl bg-neutral-50 p-5">
            <div className="grid grid-cols-2 gap-x-5 gap-y-4 text-sm">
              <Meta label="Issue date" value={formatDate(invoice.issue_date)} />
              <Meta label="Due date" value={formatDate(invoice.due_date)} />
              <Meta label="Currency" value={invoice.currency} />
              <Meta
                label="Tax mode"
                value={invoice.tax_calculation_mode === "inclusive" ? "Tax inclusive" : "Tax exclusive"}
              />
            </div>
          </div>
        </section>

        <section className="print-dark-bg avoid-break mt-7 rounded-2xl bg-neutral-950 p-6 text-white">
          <div className="flex items-start justify-between gap-8">
            <div className="min-w-0 max-w-[58%]">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-400">Invoice for</p>
              <h2 className="mt-2 text-2xl font-semibold leading-tight">
                {invoice.subject || invoice.client_name_snapshot}
              </h2>
              <p className="mt-3 text-sm leading-6 text-neutral-300">
                {isPaid
                  ? invoice.paid_at
                    ? `Paid in full on ${formatDate(invoice.paid_at.slice(0, 10))}.`
                    : "This invoice has been paid in full."
                  : invoice.due_date
                    ? `Payment is due by ${formatDate(invoice.due_date)}.`
                    : "Please pay the outstanding balance according to the payment instructions below."}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xs uppercase tracking-wide text-neutral-400">Balance due</p>
              <p className="mt-2 text-2xl font-semibold">{money(invoice.balance_due, invoice.currency)}</p>
              <p className="mt-2 text-xs text-neutral-400">Invoice total {money(invoice.total, invoice.currency)}</p>
            </div>
          </div>
        </section>

        <DocumentHeading
          eyebrow="Billing"
          title="Invoice items"
          description="The amounts below reflect the billed products and services, including applicable discounts and taxes."
        />

        <section className="mt-4 overflow-hidden rounded-xl border border-neutral-200">
          <table className="w-full border-collapse text-xs">
            <thead className="print-muted-bg bg-neutral-50 uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-3 py-3 text-left">Item / service</th>
                <th className="px-2 py-3 text-right">Qty</th>
                <th className="px-2 py-3 text-right">Unit price</th>
                <th className="px-2 py-3 text-right">Discount</th>
                <th className="px-2 py-3 text-right">Tax</th>
                <th className="px-3 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {sortedItems.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-3 align-top">
                    <p className="font-semibold text-neutral-800">
                      {item.item_name_snapshot || item.description}
                    </p>
                    {item.description && item.description !== item.item_name_snapshot ? (
                      <p className="mt-1 whitespace-pre-wrap leading-5 text-neutral-500">{item.description}</p>
                    ) : null}
                    <div className="mt-1.5 flex flex-wrap gap-x-2 text-[10px] text-neutral-400">
                      {item.sku_snapshot ? <span>SKU: {item.sku_snapshot}</span> : null}
                      {item.unit_snapshot ? <span>Unit: {item.unit_snapshot}</span> : null}
                    </div>
                  </td>
                  <td className="px-2 py-3 text-right align-top">
                    {Number(item.quantity).toLocaleString()}
                  </td>
                  <td className="px-2 py-3 text-right align-top">{money(item.unit_price, invoice.currency)}</td>
                  <td className="px-2 py-3 text-right align-top">
                    {Number(item.discount_percent) > 0 ? `${Number(item.discount_percent)}%` : "—"}
                  </td>
                  <td className="px-2 py-3 text-right align-top">
                    {Number(item.tax_rate) > 0 ? `${Number(item.tax_rate)}%` : "—"}
                  </td>
                  <td className="px-3 py-3 text-right align-top font-semibold">
                    {money(item.line_total, invoice.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="invoice-summary-card mt-5 ml-auto w-full max-w-sm rounded-2xl border border-neutral-200 p-5">
          <Total label="Subtotal" value={money(invoice.subtotal, invoice.currency)} />
          {Number(invoice.discount_total) > 0 ? (
            <Total label="Discount" value={`- ${money(invoice.discount_total, invoice.currency)}`} />
          ) : null}
          <Total label="Tax" value={money(invoice.tax_total, invoice.currency)} />
          <div className="mt-4 border-t border-neutral-200 pt-4">
            <Total label="Invoice total" value={money(invoice.total, invoice.currency)} strong />
          </div>
          {amountPaid > 0 ? <Total label="Paid" value={`- ${money(invoice.amount_paid, invoice.currency)}`} /> : null}
          <div className="mt-4 rounded-xl bg-neutral-950 px-4 py-3 text-white">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm font-medium">Balance due</span>
              <span className="text-lg font-semibold">{money(invoice.balance_due, invoice.currency)}</span>
            </div>
          </div>
        </section>

        {showPaymentInstructions ? (
          <section className="payment-card mt-9 rounded-2xl border border-neutral-200 p-6">
            <DocumentHeading
              eyebrow="Payment"
              title="Payment instructions"
              description="Use the invoice number as the payment reference unless a different reference is stated below."
              compact
            />
            <div className="mt-5 grid grid-cols-[minmax(0,1fr)_auto] gap-7">
              <div>
                <div className="flex items-center gap-2">
                  <Landmark className="size-4" />
                  <p className="font-semibold">{paymentMethodLabel(payment.payment_method)}</p>
                </div>
                {payment.payment_provider ? (
                  <PaymentLine label="Provider / bank" value={payment.payment_provider} />
                ) : null}
                {payment.payment_account_name ? (
                  <PaymentLine label="Destination" value={payment.payment_account_name} />
                ) : null}
                {payment.payment_account_holder ? (
                  <PaymentLine label="Account holder" value={payment.payment_account_holder} />
                ) : null}
                {payment.payment_account_reference ? (
                  <PaymentLine label="Account / reference" value={payment.payment_account_reference} />
                ) : null}
                {payment.payment_currency ? (
                  <PaymentLine label="Receive currency" value={payment.payment_currency} />
                ) : null}
                <PaymentLine label="Payment reference" value={invoice.invoice_number} />

                {payment.payment_instructions ? (
                  <p className="mt-4 max-w-xl whitespace-pre-wrap text-sm leading-6 text-neutral-600">
                    {payment.payment_instructions}
                  </p>
                ) : null}
                {payment.payment_url ? (
                  <a
                    href={payment.payment_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-4 inline-flex max-w-full items-center gap-2 break-all text-sm font-semibold text-blue-700 underline underline-offset-4"
                  >
                    <span>{payment.payment_url}</span>
                    <ExternalLink className="size-4 shrink-0 print:hidden" />
                  </a>
                ) : null}
              </div>
              {payment.payment_url ? (
                <div className="flex flex-col items-center self-start rounded-2xl border bg-white p-3">
                  <LocalPaymentQr value={payment.payment_url} />
                  <p className="mt-2 text-center text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                    Scan to pay
                  </p>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {invoice.notes || invoice.terms_conditions ? (
          <section className="notes-card mt-9 grid grid-cols-2 gap-4">
            {invoice.notes ? (
              <div className="rounded-2xl border border-neutral-200 p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Notes</p>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-neutral-600">{invoice.notes}</p>
              </div>
            ) : null}
            {invoice.terms_conditions ? (
              <div className="rounded-2xl border border-neutral-200 p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  Terms & conditions
                </p>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-neutral-600">
                  {invoice.terms_conditions}
                </p>
              </div>
            ) : null}
          </section>
        ) : null}

        <footer className="avoid-break mt-9 border-t border-neutral-200 pt-5">
          <div className="flex items-end justify-between gap-6 text-xs text-neutral-400">
            <div>
              <p className="font-semibold text-neutral-500">{invoice.seller_name_snapshot}</p>
              {sellerContact ? <p className="mt-1">{sellerContact}</p> : null}
            </div>
            <div className="text-right">
              <p>{invoice.invoice_number}</p>
              <p className="mt-1">Invoice · {humanize(invoice.display_status)}</p>
            </div>
          </div>
        </footer>
      </article>
    </main>
  );
}

function DocumentHeading({
  eyebrow,
  title,
  description,
  compact = false,
}: {
  eyebrow: string;
  title: string;
  description: string;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "" : "mt-9"}>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-400">{eyebrow}</p>
      <h2 className="mt-1 text-xl font-semibold">{title}</h2>
      <p className="mt-1 max-w-3xl text-sm leading-6 text-neutral-500">{description}</p>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-neutral-400">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}

function Total({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={`mt-2 flex items-center justify-between gap-4 ${
        strong ? "text-base font-semibold" : "text-sm text-neutral-600"
      }`}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function PaymentLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-2 text-sm">
      <span className="text-neutral-400">{label}:</span>
      <span className="font-medium text-neutral-700">{value}</span>
    </div>
  );
}
