import type { ReactNode } from "react";

export default function InvoicePrintLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <style>{`
        @page {
          size: A4;
          margin: 7mm 8mm 8mm;
        }

        @media print {
          .print-sheet {
            font-size: 10.5px !important;
            line-height: 1.35 !important;
            widows: 2;
            orphans: 2;
          }

          .print-sheet > header {
            padding-bottom: 3mm !important;
          }

          .print-sheet > header > div {
            gap: 4mm !important;
          }

          .print-sheet > header > div > div:first-child {
            gap: 3mm !important;
          }

          .print-sheet > header [aria-label$="document mark"] {
            width: 11mm !important;
            height: 11mm !important;
            border-radius: 3mm !important;
            font-size: 13px !important;
          }

          .print-sheet > header h1 {
            margin-top: 1mm !important;
            font-size: 21px !important;
            line-height: 1.08 !important;
          }

          .print-sheet > header span {
            margin-top: 1.5mm !important;
            padding: 1mm 2mm !important;
            font-size: 9px !important;
          }

          .print-sheet > header > div > div:last-child {
            max-width: 70mm !important;
          }

          .print-sheet > header > div > div:last-child > p:first-child {
            font-size: 13px !important;
          }

          .print-sheet > header > div > div:last-child p {
            margin-top: 1mm !important;
            font-size: 9.5px !important;
            line-height: 1.35 !important;
          }

          .print-sheet > header + section {
            margin-top: 3mm !important;
            gap: 3mm !important;
          }

          .print-sheet > header + section > div {
            padding: 3.5mm !important;
            border-radius: 4mm !important;
          }

          .print-sheet > header + section p {
            margin-top: 1mm !important;
          }

          .print-sheet > header + section > div:first-child > p:nth-child(2) {
            font-size: 15px !important;
            line-height: 1.15 !important;
          }

          .print-sheet > header + section > div:last-child > div {
            gap: 2.5mm 4mm !important;
            font-size: 10px !important;
          }

          .print-sheet > section.print-dark-bg {
            margin-top: 3mm !important;
            padding: 3.5mm 4mm !important;
            border-radius: 4mm !important;
          }

          .print-sheet > section.print-dark-bg > div {
            gap: 4mm !important;
          }

          .print-sheet > section.print-dark-bg h2 {
            margin-top: 1mm !important;
            font-size: 17px !important;
            line-height: 1.15 !important;
          }

          .print-sheet > section.print-dark-bg h2 + p {
            margin-top: 1.5mm !important;
            font-size: 9.5px !important;
            line-height: 1.35 !important;
          }

          .print-sheet > section.print-dark-bg > div > div:last-child > p:nth-child(2) {
            margin-top: 1mm !important;
            font-size: 18px !important;
          }

          .print-sheet > section.print-dark-bg > div > div:last-child > p:last-child {
            margin-top: 1mm !important;
            font-size: 9px !important;
          }

          .print-sheet > div.mt-9 {
            margin-top: 3.5mm !important;
          }

          .print-sheet > div.mt-9 > p:first-child,
          .print-sheet .payment-card > div > p:first-child {
            font-size: 8.5px !important;
          }

          .print-sheet > div.mt-9 > h2,
          .print-sheet .payment-card > div > h2 {
            margin-top: 0.5mm !important;
            font-size: 14px !important;
            line-height: 1.15 !important;
          }

          .print-sheet > div.mt-9 > p:last-child,
          .print-sheet .payment-card > div > p:last-child {
            margin-top: 0.5mm !important;
            font-size: 9px !important;
            line-height: 1.35 !important;
          }

          .print-sheet > section:has(> table) {
            margin-top: 2mm !important;
            break-after: avoid-page;
            page-break-after: avoid;
          }

          .print-sheet table {
            font-size: 9px !important;
          }

          .print-sheet table th {
            padding: 1.6mm 2mm !important;
            font-size: 8px !important;
          }

          .print-sheet table td {
            padding: 1.8mm 2mm !important;
            line-height: 1.3 !important;
          }

          .print-sheet table td p {
            margin-top: 0.6mm !important;
            line-height: 1.3 !important;
          }

          .print-sheet table td div {
            margin-top: 0.8mm !important;
            font-size: 7.5px !important;
          }

          .print-sheet thead {
            display: table-header-group;
          }

          .print-sheet tr {
            break-inside: avoid;
            page-break-inside: avoid;
          }

          .print-sheet .invoice-summary-card {
            margin-top: 2.5mm !important;
            max-width: 76mm !important;
            padding: 3mm 3.5mm !important;
            border-radius: 4mm !important;
            break-before: avoid-page;
            page-break-before: avoid;
          }

          .print-sheet .invoice-summary-card > div {
            margin-top: 1mm !important;
            font-size: 9.5px !important;
          }

          .print-sheet .invoice-summary-card > div.mt-4 {
            margin-top: 2mm !important;
            padding-top: 2mm !important;
          }

          .print-sheet .invoice-summary-card > div:last-child {
            margin-top: 2mm !important;
            padding: 2.2mm 3mm !important;
            border-radius: 3mm !important;
          }

          .print-sheet .invoice-summary-card > div:last-child span:first-child {
            font-size: 9.5px !important;
          }

          .print-sheet .invoice-summary-card > div:last-child span:last-child {
            font-size: 13px !important;
          }

          .print-sheet .payment-card {
            margin-top: 3.5mm !important;
            padding: 3.5mm 4mm !important;
            border-radius: 4mm !important;
            break-inside: avoid;
            page-break-inside: avoid;
          }

          .print-sheet .payment-card > div.mt-5 {
            margin-top: 2.5mm !important;
            gap: 4mm !important;
          }

          .print-sheet .payment-card .mt-2 {
            margin-top: 0.8mm !important;
            font-size: 9px !important;
          }

          .print-sheet .payment-card p.mt-4 {
            margin-top: 1.5mm !important;
            font-size: 9px !important;
            line-height: 1.35 !important;
          }

          .print-sheet .payment-card div:has(> svg[aria-label="QR code for invoice payment link"]) {
            width: 24mm !important;
            height: 24mm !important;
            padding: 1.5mm !important;
            border-radius: 3mm !important;
          }

          .print-sheet .payment-card svg[aria-label="QR code for invoice payment link"] {
            width: 21mm !important;
            height: 21mm !important;
          }

          .print-sheet .payment-card div:has(> svg[aria-label="QR code for invoice payment link"]) + p {
            margin-top: 1mm !important;
            font-size: 7px !important;
          }

          .print-sheet > section.avoid-break.mt-9 {
            margin-top: 3mm !important;
            padding: 3mm 3.5mm !important;
            border-radius: 4mm !important;
          }

          .print-sheet .notes-card {
            margin-top: 3mm !important;
            gap: 3mm !important;
            break-inside: avoid;
            page-break-inside: avoid;
          }

          .print-sheet .notes-card > div {
            padding: 3mm 3.5mm !important;
            border-radius: 4mm !important;
          }

          .print-sheet .notes-card > div > p:last-child {
            margin-top: 1.5mm !important;
            font-size: 8.8px !important;
            line-height: 1.35 !important;
          }

          .print-sheet > footer {
            margin-top: 3.5mm !important;
            padding-top: 2.5mm !important;
            break-inside: avoid;
            page-break-inside: avoid;
          }

          .print-sheet > footer > div {
            gap: 4mm !important;
            font-size: 8.5px !important;
          }

          .print-sheet > footer p {
            margin-top: 0.5mm !important;
          }
        }
      `}</style>
    </>
  );
}
