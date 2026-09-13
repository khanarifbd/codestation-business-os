import type { ReactNode } from "react";

export default function QuotationPrintLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <style>{`
        @page {
          size: A4;
          margin: 9mm 10mm 10mm;
        }

        @media print {
          .print-sheet {
            widows: 3;
            orphans: 3;
          }

          /* Keep the document readable; recover space from layout spacing, not font size. */
          .print-sheet > header {
            padding-bottom: 4mm !important;
          }

          .print-sheet > header > div {
            gap: 5mm !important;
          }

          .print-sheet > header h1 {
            margin-top: 2mm !important;
          }

          .print-sheet > header > div > div:first-child > div:last-child > div {
            margin-top: 2.5mm !important;
          }

          /* Prepared-for / quotation metadata row. */
          .print-sheet > header + section {
            margin-top: 4mm !important;
            gap: 4mm !important;
          }

          .print-sheet > header + section > div {
            padding: 4mm !important;
          }

          /* Project investment hero. */
          .print-sheet > section.print-dark-bg {
            margin-top: 4mm !important;
            padding: 4.5mm !important;
          }

          .print-sheet > section.print-dark-bg > div {
            gap: 5mm !important;
          }

          /* Prepared-by / revision note. */
          .print-sheet > section.print-dark-bg + section {
            margin-top: 3mm !important;
            padding-bottom: 3mm !important;
          }

          /* Standard section rhythm throughout the printed document. */
          .print-sheet > div.mt-9 {
            margin-top: 5mm !important;
          }

          .print-sheet > section.mt-4 {
            margin-top: 2.5mm !important;
          }

          .print-sheet > section.mt-5 {
            margin-top: 3mm !important;
          }

          .print-sheet > section.mt-9 {
            margin-top: 5mm !important;
          }

          .print-sheet > section.mt-10 {
            margin-top: 6mm !important;
          }

          /* A short pricing table and its totals should behave as one logical block. */
          .print-sheet > div:has(+ section > table) {
            break-after: avoid-page;
            page-break-after: avoid;
          }

          .print-sheet section:has(> table) {
            break-after: avoid-page;
            page-break-after: avoid;
          }

          .print-sheet section:has(> table) + section.avoid-break {
            break-before: avoid-page;
            page-break-before: avoid;
            margin-top: 2.5mm !important;
            padding: 4mm !important;
          }

          /* Long tables may span pages, but rows remain intact and headers repeat. */
          .print-sheet table th,
          .print-sheet table td {
            padding-top: 2mm !important;
            padding-bottom: 2mm !important;
          }

          .print-sheet thead {
            display: table-header-group;
          }

          .print-sheet tr {
            break-inside: avoid;
            page-break-inside: avoid;
          }

          /* Client-facing cards stay whole and use tighter print-only padding. */
          .print-sheet .proposal-card,
          .print-sheet .milestone-card {
            padding: 4mm !important;
            break-inside: avoid;
            page-break-inside: avoid;
          }

          .print-sheet .payment-row {
            padding: 3.5mm 4mm !important;
            break-inside: avoid;
            page-break-inside: avoid;
          }

          .print-sheet .acceptance-block {
            padding: 5mm !important;
            break-inside: avoid;
            page-break-inside: avoid;
          }

          .print-sheet .acceptance-block > div.mt-9 {
            margin-top: 5mm !important;
            gap: 7mm !important;
          }

          .print-sheet > footer {
            margin-top: 5mm !important;
            padding-top: 3mm !important;
            break-inside: avoid;
            page-break-inside: avoid;
          }
        }
      `}</style>
    </>
  );
}
