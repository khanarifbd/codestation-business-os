"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Printer } from "lucide-react";

type ComponentItem = { name: string; amount: string };
type Payslip = {
  organization: { name: string; country_code?: string | null; currency?: string; timezone?: string };
  run: { id: string; run_number: string; period_name: string; period_start: string; period_end: string; pay_date: string; status: string };
  entry: {
    id: string;
    employee_code: string;
    employee_name: string;
    currency: string;
    base_salary: string;
    allowances: ComponentItem[];
    deductions: ComponentItem[];
    allowance_total: string;
    deduction_total: string;
    tax_amount: string;
    gross_pay: string;
    net_pay: string;
    notes?: string | null;
  };
};

async function api<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.detail || `Request failed (${response.status})`);
  return body as T;
}

function money(value: string | number, currency: string) {
  return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function EmployeePayslipPage() {
  const params = useParams<{ entryId: string }>();
  const [payslip, setPayslip] = useState<Payslip | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api<Payslip>(`/api/hr/self/payslips/${encodeURIComponent(params.entryId)}`)
      .then((payload) => { if (active) setPayslip(payload); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Unable to load payslip"); });
    return () => { active = false; };
  }, [params.entryId]);

  if (error) {
    return <main className="grid min-h-[70vh] place-items-center bg-neutral-100 p-6"><div className="max-w-md rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">{error}</div></main>;
  }
  if (!payslip) {
    return <main className="grid min-h-[70vh] place-items-center bg-neutral-100"><Loader2 className="size-7 animate-spin text-neutral-400" /></main>;
  }

  const { organization, run, entry } = payslip;
  const deductions = [
    ...(entry.deductions || []),
    ...(Number(entry.tax_amount || 0) > 0 ? [{ name: "Tax / withholding", amount: entry.tax_amount }] : []),
  ];

  return <main className="min-h-screen bg-neutral-100 p-4 print:bg-white print:p-0 sm:p-8">
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-center justify-between gap-3 print:hidden">
        <Link href="/dashboard/hr/me" className="inline-flex h-10 items-center gap-2 rounded-xl border bg-white px-3 text-sm font-medium hover:bg-neutral-50"><ArrowLeft className="size-4" />My HR & Pay</Link>
        <button type="button" onClick={() => window.print()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white"><Printer className="size-4" />Print / Save PDF</button>
      </div>

      <article className="rounded-3xl border bg-white p-6 shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none sm:p-10">
        <header className="flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-400">Employee payslip</p><h1 className="mt-2 text-2xl font-semibold">{organization.name}</h1><p className="mt-1 text-sm text-neutral-500">Approved payroll statement</p></div>
          <div className="text-left sm:text-right"><p className="text-sm font-semibold">{run.run_number}</p><p className="mt-1 text-sm text-neutral-500">{run.period_name}</p><p className="mt-1 text-xs text-neutral-400">Pay date {run.pay_date}</p><span className="mt-2 inline-block rounded-full bg-neutral-100 px-2.5 py-1 text-xs capitalize">{run.status}</span></div>
        </header>

        <section className="grid gap-4 border-b py-6 sm:grid-cols-2">
          <div><p className="text-xs uppercase tracking-wide text-neutral-400">Employee</p><p className="mt-2 text-lg font-semibold">{entry.employee_name}</p><p className="text-sm text-neutral-500">{entry.employee_code}</p></div>
          <div className="sm:text-right"><p className="text-xs uppercase tracking-wide text-neutral-400">Net pay</p><p className="mt-2 text-2xl font-semibold">{money(entry.net_pay, entry.currency)}</p><p className="text-sm text-neutral-500">{run.period_start} — {run.period_end}</p></div>
        </section>

        <section className="grid gap-6 py-6 lg:grid-cols-2">
          <Breakdown title="Earnings" baseLabel="Base salary" baseAmount={entry.base_salary} items={entry.allowances || []} currency={entry.currency} />
          <Breakdown title="Deductions" items={deductions} currency={entry.currency} />
        </section>

        <section className="grid gap-3 rounded-2xl bg-neutral-50 p-5 sm:grid-cols-3">
          <Metric label="Gross pay" value={money(entry.gross_pay, entry.currency)} />
          <Metric label="Total deductions" value={money(Number(entry.deduction_total || 0) + Number(entry.tax_amount || 0), entry.currency)} />
          <Metric label="Net pay" value={money(entry.net_pay, entry.currency)} />
        </section>

        {entry.notes ? <section className="mt-6 rounded-2xl border p-4"><p className="text-xs uppercase tracking-wide text-neutral-400">Payroll note</p><p className="mt-2 text-sm text-neutral-700">{entry.notes}</p></section> : null}
        <footer className="mt-10 border-t pt-5 text-xs leading-5 text-neutral-400">Generated from {organization.name} Business OS. This self-service document exposes only the authenticated employee&apos;s approved payroll entry.</footer>
      </article>
    </div>
  </main>;
}

function Breakdown({ title, baseLabel, baseAmount, items, currency }: { title: string; baseLabel?: string; baseAmount?: string; items: ComponentItem[]; currency: string }) {
  return <div><h2 className="font-semibold">{title}</h2><div className="mt-3 overflow-hidden rounded-xl border">{baseLabel && baseAmount ? <Row label={baseLabel} value={money(baseAmount, currency)} /> : null}{items.length ? items.map((item, index) => <Row key={`${item.name}-${index}`} label={item.name} value={money(item.amount, currency)} />) : !baseLabel ? <div className="px-4 py-5 text-sm text-neutral-400">No deductions</div> : null}</div></div>;
}
function Row({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between border-b px-4 py-3 text-sm last:border-b-0"><span className="text-neutral-600">{label}</span><span className="font-medium">{value}</span></div>; }
function Metric({ label, value }: { label: string; value: string }) { return <div><p className="text-xs text-neutral-400">{label}</p><p className="mt-1 font-semibold">{value}</p></div>; }
