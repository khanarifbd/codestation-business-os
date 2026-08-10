"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, Loader2, Printer } from "lucide-react";

type ComponentItem = { name: string; amount: string };
type Entry = { id: string; employee_code: string; employee_name: string; currency: string; base_salary: string; allowances: ComponentItem[]; deductions: ComponentItem[]; allowance_total: string; deduction_total: string; tax_amount: string; gross_pay: string; net_pay: string; notes?: string | null };
type Run = { id: string; run_number: string; period_name: string; currency: string; status: string; gross_total: string; net_total: string; entries: Entry[] };
type Tenant = { organization: { name: string; country_code?: string | null; currency?: string; timezone?: string } };

async function api<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.detail || `Request failed (${response.status})`);
  return body as T;
}
function money(value: string | number, currency: string) { return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

export default function PayslipPage() {
  const params = useParams<{ runId: string; entryId: string }>();
  const [run, setRun] = useState<Run | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([api<Run>(`/api/payroll/runs/${params.runId}`), api<Tenant>("/api/tenant")])
      .then(([runData, tenantData]) => { setRun(runData); setTenant(tenantData); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load payslip"));
  }, [params.runId]);

  if (error) return <main className="grid min-h-screen place-items-center p-6"><div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">{error}</div></main>;
  if (!run || !tenant) return <main className="grid min-h-screen place-items-center"><Loader2 className="size-7 animate-spin text-neutral-400"/></main>;
  const entry = run.entries.find((item) => item.id === params.entryId);
  if (!entry) return <main className="grid min-h-screen place-items-center p-6"><div className="rounded-xl border px-5 py-4 text-sm">Payslip entry not found.</div></main>;

  return <main className="min-h-screen bg-neutral-100 p-4 print:bg-white print:p-0 sm:p-8">
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-center justify-between print:hidden"><button onClick={() => window.close()} className="inline-flex h-10 items-center gap-2 rounded-xl border bg-white px-3 text-sm font-medium"><ArrowLeft className="size-4"/>Close</button><button onClick={() => window.print()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white"><Printer className="size-4"/>Print / Save PDF</button></div>
      <article className="rounded-3xl border bg-white p-6 shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none sm:p-10">
        <header className="flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-400">Payslip</p><h1 className="mt-2 text-2xl font-semibold">{tenant.organization.name}</h1><p className="mt-1 text-sm text-neutral-500">Payroll statement</p></div><div className="text-left sm:text-right"><p className="text-sm font-semibold">{run.run_number}</p><p className="mt-1 text-sm text-neutral-500">{run.period_name}</p><span className="mt-2 inline-block rounded-full bg-neutral-100 px-2.5 py-1 text-xs capitalize">{run.status}</span></div></header>

        <section className="grid gap-4 border-b py-6 sm:grid-cols-2"><div><p className="text-xs uppercase tracking-wide text-neutral-400">Employee</p><p className="mt-2 text-lg font-semibold">{entry.employee_name}</p><p className="text-sm text-neutral-500">{entry.employee_code}</p></div><div className="sm:text-right"><p className="text-xs uppercase tracking-wide text-neutral-400">Net pay</p><p className="mt-2 text-2xl font-semibold">{money(entry.net_pay, entry.currency)}</p><p className="text-sm text-neutral-500">Currency: {entry.currency}</p></div></section>

        <section className="grid gap-6 py-6 lg:grid-cols-2"><Breakdown title="Earnings" baseLabel="Base salary" baseAmount={entry.base_salary} items={entry.allowances || []} currency={entry.currency}/><Breakdown title="Deductions" items={[...(entry.deductions || []), ...(Number(entry.tax_amount || 0) > 0 ? [{ name: "Tax / withholding", amount: entry.tax_amount }] : [])]} currency={entry.currency}/></section>

        <section className="grid gap-3 rounded-2xl bg-neutral-50 p-5 sm:grid-cols-3"><Metric label="Gross pay" value={money(entry.gross_pay, entry.currency)}/><Metric label="Total deductions" value={money(Number(entry.deduction_total || 0) + Number(entry.tax_amount || 0), entry.currency)}/><Metric label="Net pay" value={money(entry.net_pay, entry.currency)}/></section>
        {entry.notes ? <section className="mt-6 rounded-2xl border p-4"><p className="text-xs uppercase tracking-wide text-neutral-400">Payroll note</p><p className="mt-2 text-sm text-neutral-700">{entry.notes}</p></section> : null}
        <footer className="mt-10 border-t pt-5 text-xs text-neutral-400">Generated from {tenant.organization.name} Business OS. This document reflects the approved payroll record for the selected period.</footer>
      </article>
    </div>
  </main>;
}

function Breakdown({ title, baseLabel, baseAmount, items, currency }: { title: string; baseLabel?: string; baseAmount?: string; items: ComponentItem[]; currency: string }) {
  return <div><h2 className="font-semibold">{title}</h2><div className="mt-3 overflow-hidden rounded-xl border">{baseLabel && baseAmount ? <Row label={baseLabel} value={money(baseAmount, currency)}/> : null}{items.length ? items.map((item, index) => <Row key={`${item.name}-${index}`} label={item.name} value={money(item.amount, currency)}/>) : !baseLabel ? <div className="px-4 py-5 text-sm text-neutral-400">No deductions</div> : null}</div></div>;
}
function Row({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between border-b px-4 py-3 text-sm last:border-b-0"><span className="text-neutral-600">{label}</span><span className="font-medium">{value}</span></div>; }
function Metric({ label, value }: { label: string; value: string }) { return <div><p className="text-xs text-neutral-400">{label}</p><p className="mt-1 font-semibold">{value}</p></div>; }
