"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CalendarClock, RefreshCw } from "lucide-react";

import { getApiErrorMessage } from "@/lib/api-error";

type Service = {
  order_item_id: string;
  order_id: string;
  order_number: string;
  order_status: string;
  product_id: string | null;
  sku: string | null;
  name: string;
  quantity: string;
  currency: string;
  line_total: string;
  duration_months: number | null;
  start_date: string | null;
  end_date: string | null;
  service_status: "one_time" | "upcoming" | "active" | "expired" | string;
};

function money(value: string | number, currency: string) { return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function date(value: string | null) { return value ? new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(new Date(`${value}T00:00:00`)) : "—"; }
function durationLabel(months: number | null) { return months == null ? "One-time" : `${months} month${months === 1 ? "" : "s"}`; }
function statusClass(status: string) {
  if (status === "active") return "bg-emerald-50 text-emerald-700";
  if (status === "upcoming") return "bg-blue-50 text-blue-700";
  if (status === "expired") return "bg-neutral-100 text-neutral-500";
  return "bg-violet-50 text-violet-700";
}

export function ClientServicesSection({ clientId }: { clientId: string }) {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [startDate, setStartDate] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/services/clients/${encodeURIComponent(clientId)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (response.status === 403) { setServices([]); return; }
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not load client services"));
      setServices(Array.isArray(payload) ? payload : []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load client services");
    } finally { setLoading(false); }
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  async function savePeriod(service: Service) {
    if (!startDate) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/services/order-items/${encodeURIComponent(service.order_item_id)}/period`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start_date: startDate }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not update service period"));
      setEditing(null); setStartDate(""); await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update service period");
    } finally { setSaving(false); }
  }

  if (loading) return <section className="rounded-2xl border bg-white p-5"><p className="text-sm text-neutral-500">Loading client services…</p></section>;
  if (!services.length && !error) return <section className="rounded-2xl border bg-white p-5"><div className="flex items-center justify-between"><div><h2 className="font-semibold">Services</h2><p className="mt-1 text-sm text-neutral-500">No ordered service for this client yet.</p></div><CalendarClock className="size-5 text-neutral-300" /></div></section>;

  return <section className="rounded-2xl border bg-white p-5 shadow-sm">
    <div className="flex items-start justify-between gap-4"><div><h2 className="font-semibold">Services & support terms</h2><p className="mt-1 text-sm text-neutral-500">Ordered services and their fixed-term entitlement periods.</p></div><button onClick={() => void load()} className="rounded-lg border p-2 text-neutral-500"><RefreshCw className="size-4" /></button></div>
    {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    <div className="mt-4 divide-y">{services.map((service) => <div key={service.order_item_id} className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{service.name}</p><span className={`rounded-lg px-2 py-1 text-xs font-medium ${statusClass(service.service_status)}`}>{service.service_status.replaceAll("_", " ")}</span></div><p className="mt-1 text-xs text-neutral-400">{service.sku || "Custom service"} · <Link href={`/dashboard/orders?order_id=${encodeURIComponent(service.order_id)}`} className="font-medium hover:text-neutral-700">{service.order_number}</Link> · {durationLabel(service.duration_months)}</p></div><div className="shrink-0 text-left lg:text-right"><p className="font-semibold">{money(service.line_total, service.currency)}</p><p className="mt-1 text-xs text-neutral-400">Qty {Number(service.quantity).toLocaleString()}</p></div></div>
      {service.duration_months != null ? <div className="mt-3 flex flex-col gap-3 rounded-xl bg-neutral-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Service period</p><p className="mt-1 text-sm font-medium">{date(service.start_date)} → {date(service.end_date)}</p></div>{editing === service.order_item_id ? <div className="flex flex-wrap items-end gap-2"><label className="grid gap-1 text-xs text-neutral-500"><span>Start date</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="h-9 rounded-lg border bg-white px-2 text-sm text-neutral-900" /></label><button disabled={saving || !startDate} onClick={() => void savePeriod(service)} className="h-9 rounded-lg bg-neutral-950 px-3 text-xs font-semibold text-white disabled:opacity-40">{saving ? "Saving…" : "Save"}</button><button onClick={() => { setEditing(null); setStartDate(""); }} className="h-9 rounded-lg border bg-white px-3 text-xs">Cancel</button></div> : <button onClick={() => { setEditing(service.order_item_id); setStartDate(service.start_date ?? ""); }} className="h-9 rounded-lg border bg-white px-3 text-xs font-medium">Change start date</button>}</div> : null}
    </div>)}</div>
  </section>;
}
