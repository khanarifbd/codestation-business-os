"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, TrendingUp } from "lucide-react";

import { getApiErrorMessage } from "@/lib/api-error";

type Row = {
  product_id: string;
  sku: string;
  name: string;
  currency: string;
  duration_months: number | null;
  quoted_quantity: string;
  quoted_value: string;
  ordered_quantity: string;
  ordered_value: string;
  invoiced_quantity: string;
  invoiced_value: string;
  fully_paid_invoice_value: string;
  active_terms: number;
  upcoming_terms: number;
  expired_terms: number;
};

function money(value: string | number, currency: string) {
  return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function durationLabel(months: number | null) {
  if (months == null) return "One-time";
  return `${months} month${months === 1 ? "" : "s"}`;
}

export function ServiceSalesPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/services/sales-summary", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not load service sales"));
      setRows(Array.isArray(payload) ? payload : []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load service sales");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const topByQuantity = useMemo(
    () => [...rows].sort((a, b) => Number(b.ordered_quantity) - Number(a.ordered_quantity))[0] ?? null,
    [rows],
  );
  const topRevenueByCurrency = useMemo(() => {
    const best = new Map<string, Row>();
    for (const row of rows) {
      const current = best.get(row.currency);
      if (!current || Number(row.ordered_value) > Number(current.ordered_value)) best.set(row.currency, row);
    }
    return [...best.values()].filter((row) => Number(row.ordered_value) > 0);
  }, [rows]);
  const activeTerms = rows.reduce((total, row) => total + row.active_terms, 0);
  const expiringContext = rows.reduce((total, row) => total + row.upcoming_terms, 0);

  return <div className="space-y-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><h2 className="text-xl font-semibold">Service sales</h2><p className="mt-1 text-sm text-neutral-500">Reliable catalog sales history from quotation, order and invoice lines. Different currencies are never combined.</p></div>
      <button onClick={() => void load()} className="inline-flex h-10 items-center gap-2 rounded-xl border bg-white px-3 text-sm font-medium"><RefreshCw className="size-4" />Refresh</button>
    </div>
    {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    {loading ? <div className="rounded-2xl border bg-white p-6 text-sm text-neutral-500">Loading service sales…</div> : <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Catalog services" value={rows.length} note="Active and inactive service SKUs" />
        <Metric label="Active fixed terms" value={activeTerms} note="Current client service periods" />
        <Metric label="Upcoming terms" value={expiringContext} note="Service periods not started yet" />
        <Metric label="Best selling by quantity" value={topByQuantity && Number(topByQuantity.ordered_quantity) > 0 ? topByQuantity.name : "—"} note={topByQuantity && Number(topByQuantity.ordered_quantity) > 0 ? `${Number(topByQuantity.ordered_quantity).toLocaleString()} ordered` : "No orders yet"} />
      </div>

      {topRevenueByCurrency.length ? <div className="rounded-2xl border bg-white p-5"><div className="flex items-center gap-2"><TrendingUp className="size-4 text-neutral-400" /><h3 className="font-semibold">Top ordered revenue by currency</h3></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{topRevenueByCurrency.map((row) => <div key={row.currency} className="rounded-xl bg-neutral-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">{row.currency}</p><p className="mt-2 font-semibold">{row.name}</p><p className="mt-1 text-sm text-neutral-500">{money(row.ordered_value, row.currency)}</p></div>)}</div></div> : null}

      <div className="overflow-x-auto rounded-2xl border bg-white"><table className="w-full min-w-[1180px] text-left text-sm"><thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-400"><tr><th className="px-4 py-3 font-medium">Service</th><th className="px-4 py-3 font-medium">Duration</th><th className="px-4 py-3 font-medium">Quoted</th><th className="px-4 py-3 font-medium">Ordered</th><th className="px-4 py-3 font-medium">Invoiced</th><th className="px-4 py-3 font-medium">Fully-paid invoices</th><th className="px-4 py-3 font-medium">Terms</th></tr></thead><tbody>{rows.map((row) => <tr key={row.product_id} className="border-t"><td className="px-4 py-3"><p className="font-medium">{row.name}</p><p className="text-xs text-neutral-400">{row.sku}</p></td><td className="px-4 py-3">{durationLabel(row.duration_months)}</td><td className="px-4 py-3"><p>{Number(row.quoted_quantity).toLocaleString()} qty</p><p className="text-xs text-neutral-400">{money(row.quoted_value, row.currency)}</p></td><td className="px-4 py-3"><p className="font-medium">{Number(row.ordered_quantity).toLocaleString()} qty</p><p className="text-xs text-neutral-500">{money(row.ordered_value, row.currency)}</p></td><td className="px-4 py-3"><p>{Number(row.invoiced_quantity).toLocaleString()} qty</p><p className="text-xs text-neutral-400">{money(row.invoiced_value, row.currency)}</p></td><td className="px-4 py-3">{money(row.fully_paid_invoice_value, row.currency)}</td><td className="px-4 py-3"><div className="flex flex-wrap gap-1.5"><Pill label={`${row.active_terms} active`} /><Pill label={`${row.upcoming_terms} upcoming`} /><Pill label={`${row.expired_terms} expired`} /></div></td></tr>)}</tbody></table></div>
      {rows.length === 0 ? <div className="rounded-2xl border border-dashed bg-white px-6 py-12 text-center text-sm text-neutral-500">No service catalog items yet.</div> : null}
      <p className="text-xs leading-5 text-neutral-400">“Fully-paid invoices” counts line value only when the whole invoice is paid. Partial invoice payments are not allocated to individual service lines, so Business OS does not invent a misleading line-level collected amount.</p>
    </>}
  </div>;
}

function Metric({ label, value, note }: { label: string; value: React.ReactNode; note: string }) { return <div className="rounded-2xl border bg-white p-5"><p className="text-sm text-neutral-500">{label}</p><div className="mt-2 break-words text-2xl font-semibold">{value}</div><p className="mt-2 text-xs text-neutral-400">{note}</p></div>; }
function Pill({ label }: { label: string }) { return <span className="rounded-lg bg-neutral-100 px-2 py-1 text-xs text-neutral-600">{label}</span>; }
