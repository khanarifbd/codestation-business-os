import Link from "next/link";

/** Operational source totals are deliberately not the accrual general ledger. */
export function OperationalReportingNote() {
  return (
    <p className="mt-3 text-xs leading-5 text-neutral-500">
      Operational margin, not accrual net profit: issued invoice totals (including tax) plus direct income,
      less posted expenses, approved payroll and transfer fees. Platform fees recorded as posted expenses are included.
      Supplier bills, inventory cost of sales, depreciation, Stripe processing fees posted only to the ledger and other journal-only adjustments are not included.
      Client/project filters exclude unallocated payroll and transfer fees. Compare with the{" "}
      <Link href="/dashboard/accounting/reports" className="font-medium text-neutral-700 underline">
        accrual Profit &amp; Loss
      </Link>{" "}
      for the same period; it uses journal revenue and expenses, excluding sales tax.
    </p>
  );
}
