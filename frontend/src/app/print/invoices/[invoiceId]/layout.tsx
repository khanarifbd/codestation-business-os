import type { ReactNode } from "react";

export default function InvoicePrintLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <style>{`
        @page {
          size: A4;
          margin: 5mm 6mm 6mm;
        }

        @media print {
          .print-sheet {
            font-size: 9.25px !important;
            line-height: 1.25 !important;
            widows: 2;
            orphans: 2;
          }

          .print-sheet > header {
            padding-bottom: 2mm !important;
          }

          .print-sheet > header > div {
            gap: 3mm !important;
          }

          .print-sheet > header > div > div:first-child {
            gap: 2.5mm !important;
          }

          .print-sheet > header [aria-label$="document mark"] {
            width: 9.5mm !important;
            height: 9.5mm !important;
            border-radius: 2.5mm !important;
            font-size: 11px !important;
          }

          .print-sheet > header h1 {
            margin-top: 0.7mm !important;
            font-size: 18px !important;
            line-height: 1.05 !important;
          }

          .print-sheet > header span {
            margin-top: 1mm !important;
            padding: 0.7mm 1.6mm !important;
            font-size: 8px !important;
          }

          .print-sheet > header > div > div:last-child {
            max-width: 72mm !important;
          }

          .print-sheet > header > div > div:last-child > p:first-child {
            font-size: 11.5px !important;
          }

          .print-sheet > header > div > div:last-child p {
            margin-top: 0.5mm !important;
            font-size: 8.3px !important;
            line-height: 1.25 !important;
          }

          /* Bill-to and invoice metadata. */
          .print-sheet > header + section {
            margin-top: 2.2mm !important;
            gap: 2.5mm !important;
          }

          .print-sheet > header + section > div {
            padding: 2.5mm 3mm !important;
            border-radius: 3mm !important;
          }

          .print-sheet > header + section p {
            margin-top: 0.6mm !important;
            font-size: 8.5px !important;
            line-height: 1.25 !important;
          }

          .print-sheet > header + section > div:first-child > p:nth-child(2) {
            font-size: 13px !important;
            line-height: 1.1 !important;
          }

          .print-sheet > header + section > div:last-child > div {
            gap: 1.8mm 3mm !important;
            font-size: 8.8px !important;
          }

          .print-sheet > header + section > div:last-child p {
            font-size: 8px !important;
          }

          /* Subject / balance hero. */
          .print-sheet > section.print-dark-bg {
            margin-top: 2.2mm !important;
            padding: 2.7mm 3.2mm !important;
            border-radius: 3mm !important;
          }

          .print-sheet > section.print-dark-bg > div {
            gap: 3mm !important;
          }

          .print-sheet > section.print-dark-bg h2 {
            margin-top: 0.6mm !important;
            font-size: 15px !important;
            line-height: 1.1 !important;
          }

          .print-sheet > section.print-dark-bg h2 + p {
            margin-top: 0.8mm !important;
            font-size: 8px !important;
            line-height: 1.25 !important;
          }

          .print-sheet > section.print-dark-bg > div > div:last-child > p:nth-child(2) {
            margin-top: 0.6mm !important;
            font-size: 16px !important;
          }

          .print-sheet > section.print-dark-bg > div > div:last-child > p:last-child {
            margin-top: 0.5mm !important;
            font-size: 7.5px !important;
          }

          /* Standard print headings: keep titles, drop explanatory copy to save page height. */
          .print-sheet > div.mt-9 {
            margin-top: 2.4mm !important;
          }

          .print-sheet > div.mt-9 > p:first-child,
          .print-sheet .payment-card > div > p:first-child {
            font-size: 7.5px !important;
          }

          .print-sheet > div.mt-9 > h2,
          .print-sheet .payment-card > div > h2 {
            margin-top: 0.3mm !important;
            font-size: 12.5px !important;
            line-height: 1.1 !important;
          }

          .print-sheet > div.mt-9 > p:last-child,
          .print-sheet .payment-card > div > p:last-child {
            display: none !important;
          }

          /* Pricing table: compact normal invoices; long invoices can still paginate. */
          .print-sheet > section:has(> table) {
            margin-top: 1.4mm !important;
            break-after: avoid-page;
            page-break-after: avoid;
          }

          .print-sheet table {
            font-size: 8.1px !important;
          }

          .print-sheet table th {
            padding: 1.1mm 1.6mm !important;
            font-size: 7.2px !important;
          }

          .print-sheet table td {
            padding: 1.25mm 1.6mm !important;
            line-height: 1.2 !important;
          }

          .print-sheet table td p {
            margin-top: 0.3mm !important;
            line-height: 1.2 !important;
          }

          .print-sheet table td div {
            margin-top: 0.4mm !important;
            font-size: 6.8px !important;
          }

          .print-sheet thead {
            display: table-header-group;
          }

          .print-sheet tr {
            break-inside: avoid;
            page-break-inside: avoid;
          }

          /* Summary stays with a short item table. */
          .print-sheet .invoice-summary-card {
            margin-top: 1.8mm !important;
            max-width: 72mm !important;
            padding: 2.2mm 2.8mm !important;
            border-radius: 3mm !important;
            break-before: avoid-page;
            page-break-before: avoid;
          }

          .print-sheet .invoice-summary-card > div {
            margin-top: 0.6mm !important;
            font-size: 8.4px !important;
          }

          .print-sheet .invoice-summary-card > div.mt-4 {
            margin-top: 1.2mm !important;
            padding-top: 1.2mm !important;
          }

          .print-sheet .invoice-summary-card > div:last-child {
            margin-top: 1.2mm !important;
            padding: 1.6mm 2.3mm !important;
            border-radius: 2.5mm !important;
          }

          .print-sheet .invoice-summary-card > div:last-child span:first-child {
            font-size: 8.5px !important;
          }

          .print-sheet .invoice-summary-card > div:last-child span:last-child {
            font-size: 11.5px !important;
          }

          /* Force payment content into two columns in print even when A4 content width is below Tailwind md. */
          .print-sheet .payment-card {
            margin-top: 2.4mm !important;
            padding: 2.5mm 3mm !important;
            border-radius: 3mm !important;
            break-inside: avoid;
            page-break-inside: avoid;
          }

          .print-sheet .payment-card > div.mt-5 {
            margin-top: 1.6mm !important;
            display: grid !important;
            grid-template-columns: minmax(0, 1fr) auto !important;
            gap: 3mm !important;
            align-items: start !important;
          }

          .print-sheet .payment-card .mt-2 {
            margin-top: 0.45mm !important;
            font-size: 7.8px !important;
            line-height: 1.2 !important;
          }

          .print-sheet .payment-card p.mt-4 {
            margin-top: 0.8mm !important;
            font-size: 7.8px !important;
            line-height: 1.2 !important;
          }

          .print-sheet .payment-card div:has(> svg[aria-label="QR code for invoice payment link"]) {
            width: 18mm !important;
            height: 18mm !important;
            padding: 1mm !important;
            border-radius: 2.5mm !important;
          }

          .print-sheet .payment-card svg[aria-label="QR code for invoice payment link"] {
            width: 16mm !important;
            height: 16mm !important;
          }

          .print-sheet .payment-card div:has(> svg[aria-label="QR code for invoice payment link"]) + p {
            margin-top: 0.5mm !important;
            font-size: 6.5px !important;
          }

          /* Paid status / notes / terms. */
          .print-sheet > section.avoid-break.mt-9 {
            margin-top: 2.2mm !important;
            padding: 2.3mm 2.8mm !important;
            border-radius: 3mm !important;
          }

          .print-sheet .notes-card {
            margin-top: 2.2mm !important;
            display: grid !important;
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
            gap: 2.2mm !important;
            break-inside: avoid;
            page-break-inside: avoid;
          }

          .print-sheet .notes-card > div {
            padding: 2.2mm 2.6mm !important;
            border-radius: 3mm !important;
          }

          .print-sheet .notes-card > div > p:first-child {
            font-size: 7.2px !important;
          }

          .print-sheet .notes-card > div > p:last-child {
            margin-top: 0.8mm !important;
            font-size: 7.5px !important;
            line-height: 1.2 !important;
          }

          .print-sheet > footer {
            margin-top: 2.4mm !important;
            padding-top: 1.6mm !important;
            break-inside: avoid;
            page-break-inside: avoid;
          }

          .print-sheet > footer > div {
            gap: 3mm !important;
            font-size: 7.5px !important;
          }

          .print-sheet > footer p {
            margin-top: 0.3mm !important;
          }
        }
      `}</style>
    </>
  );
}
