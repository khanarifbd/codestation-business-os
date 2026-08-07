"use client";

import { ArrowLeft, Loader2, Printer } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type QuotationItem = {
  id: string;
  description: string;
  quantity: string | number;
  unit_price: string | number;
  discount_percent: string | number;
  tax_rate: string | number;
  line_total: string | number;
};

type QuotationDetail = {
  id: string;
  quotation_number: string;
  status: string;
  subject: string | null;
  issue_date: string;
  valid_until: string | null;
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
  notes: string | null;
  terms_conditions: string | null;
  items: QuotationItem[];
};

function money(value: string | number, currency: string) {
  const amount = Number(value || 0);
  return `${currency} ${amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function QuotationPrintPage() {
  const params = useParams<{ quotationId: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<QuotationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/sales/quotations/${encodeURIComponent(params.quotationId)}`);
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.detail ?? "Unable to load quotation.");
        if (active) setDetail(payload as QuotationDetail);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Unable to load quotation.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [params.quotationId, router]);

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center bg-neutral-100"><Loader2 className="size-7 animate-spin text-neutral-400" /></main>;
  }
  if (error || !detail) {
    return <main className="flex min-h-screen items-center justify-center bg-neutral-100 p-6"><div className="rounded-2xl border bg-white p-8 text-center shadow-sm"><p className="font-semibold">Quotation unavailable</p><p className="mt-2 text-sm text-neutral-500">{error ?? "Quotation not found"}</p></div></main>;
  }

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-8 text-neutral-950 print:bg-white print:p-0">
      <style jsx global>{`
        @page { size: A4; margin: 14mm; }
        @media print {
          html, body { background: white !important; }
          .print-actions { display: none !important; }
          .print-sheet { box-shadow: none !important; border: 0 !important; margin: 0 !important; width: 100% !important; max-width: none !important; }
          .avoid-break { break-inside: avoid; page-break-inside: avoid; }
          tr { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>

      <div className="print-actions mx-auto mb-4 flex max-w-[210mm] items-center justify-between gap-3">
        <Link href="/dashboard/quotations" className="flex h-10 items-center gap-2 rounded-xl border bg-white px-4 text-sm font-semibold"><ArrowLeft className="size-4" /> Back</Link>
        <button onClick={() => window.print()} className="flex h-10 items-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white"><Printer className="size-4" /> Print / Save PDF</button>
      </div>

      <article className="print-sheet mx-auto min-h-[297mm] w-full max-w-[210mm] bg-white p-8 shadow-xl ring-1 ring-neutral-200 print:min-h-0 print:p-0">
        <header className="flex items-start justify-between gap-8 border-b border-neutral-200 pb-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-400">Quotation</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">{detail.quotation_number}</h1>
            <p className="mt-2 text-sm capitalize text-neutral-500">Status: {detail.status}</p>
          </div>
          <div className="max-w-[280px] text-right">
            <p className="text-lg font-semibold">{detail.seller_name_snapshot}</p>
            {detail.seller_email_snapshot ? <p className="mt-1 text-sm text-neutral-500">{detail.seller_email_snapshot}</p> : null}
            {detail.seller_address_snapshot ? <p className="mt-1 whitespace-pre-line text-sm leading-5 text-neutral-500">{detail.seller_address_snapshot}</p> : null}
            {detail.seller_tax_identifier_snapshot ? <p className="mt-2 text-xs text-neutral-400">Tax ID: {detail.seller_tax_identifier_snapshot}</p> : null}
          </div>
        </header>

        <section className="avoid-break mt-8 grid grid-cols-2 gap-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Prepared for</p>
            <p className="mt-2 text-lg font-semibold">{detail.client_name_snapshot}</p>
            {detail.client_contact_snapshot ? <p className="mt-1 text-sm text-neutral-600">Attn: {detail.client_contact_snapshot}</p> : null}
            {detail.client_email_snapshot ? <p className="mt-1 text-sm text-neutral-500">{detail.client_email_snapshot}</p> : null}
            {detail.client_address_snapshot ? <p className="mt-1 whitespace-pre-line text-sm leading-5 text-neutral-500">{detail.client_address_snapshot}</p> : null}
            {detail.client_tax_identifier_snapshot ? <p className="mt-2 text-xs text-neutral-400">Tax ID: {detail.client_tax_identifier_snapshot}</p> : null}
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <Meta label="Issue date" value={detail.issue_date} />
            <Meta label="Valid until" value={detail.valid_until ?? "—"} />
            <Meta label="Currency" value={detail.currency} />
            <Meta label="Tax mode" value={detail.tax_calculation_mode} />
          </div>
        </section>

        {detail.subject ? <section className="avoid-break mt-8 rounded-xl bg-neutral-50 px-5 py-4"><p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Subject</p><p className="mt-1 font-semibold">{detail.subject}</p></section> : null}

        <section className="mt-8 overflow-hidden rounded-xl border border-neutral-200">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
              <tr><th className="px-4 py-3 text-left">Description</th><th className="px-3 py-3 text-right">Qty</th><th className="px-3 py-3 text-right">Unit price</th><th className="px-3 py-3 text-right">Discount</th><th className="px-3 py-3 text-right">Tax</th><th className="px-4 py-3 text-right">Total</th></tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {detail.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 align-top leading-5">{item.description}</td>
                  <td className="px-3 py-3 text-right align-top">{Number(item.quantity).toLocaleString()}</td>
                  <td className="px-3 py-3 text-right align-top">{money(item.unit_price, detail.currency)}</td>
                  <td className="px-3 py-3 text-right align-top">{Number(item.discount_percent)}%</td>
                  <td className="px-3 py-3 text-right align-top">{Number(item.tax_rate)}%</td>
                  <td className="px-4 py-3 text-right align-top font-medium">{money(item.line_total, detail.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="avoid-break mt-6 ml-auto w-full max-w-sm rounded-xl bg-neutral-50 p-5">
          <Total label="Subtotal" value={money(detail.subtotal, detail.currency)} />
          <Total label="Discount" value={`- ${money(detail.discount_total, detail.currency)}`} />
          <Total label="Tax" value={money(detail.tax_total, detail.currency)} />
          <div className="mt-4 border-t border-neutral-200 pt-4"><Total label="Total" value={money(detail.total, detail.currency)} strong /></div>
        </section>

        {detail.notes ? <TextSection title="Notes" value={detail.notes} /> : null}
        {detail.terms_conditions ? <TextSection title="Terms & Conditions" value={detail.terms_conditions} /> : null}

        <footer className="avoid-break mt-10 border-t border-neutral-200 pt-5 text-xs text-neutral-400">
          <p>Generated from CodeStation AI Business OS. This document uses the seller and client snapshots stored with the quotation.</p>
        </footer>
      </article>
    </main>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs uppercase tracking-wide text-neutral-400">{label}</p><p className="mt-1 font-medium capitalize">{value}</p></div>;
}
function Total({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className={`mt-2 flex items-center justify-between gap-4 ${strong ? "text-base font-semibold" : "text-sm text-neutral-600"}`}><span>{label}</span><span>{value}</span></div>;
}
function TextSection({ title, value }: { title: string; value: string }) {
  return <section className="avoid-break mt-8"><p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">{title}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-600">{value}</p></section>;
}
