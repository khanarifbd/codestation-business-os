"use client";

import { ArrowLeft, Loader2, Save, UsersRound } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { SearchableSelect } from "@/components/searchable-select";
import { getApiErrorMessage } from "@/lib/api-error";

type OrderDetail = {
  id: string;
  order_number: string;
  quotation_id: string | null;
  client_id: string;
  client_name_snapshot: string;
  source_lead_id: string | null;
  source: string | null;
  external_order_id: string | null;
  subject: string | null;
  status: string;
};

type LeadOption = {
  id: string;
  lead_code: string;
  company_name: string | null;
  contact_name: string;
  source_name: string | null;
  status_name: string;
  converted_client_id: string | null;
};

type LeadPage = {
  items: LeadOption[];
  next_cursor: string | null;
};

export default function EditOrderPage() {
  const params = useParams<{ orderId: string }>();
  const router = useRouter();
  const orderId = params.orderId;
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [leads, setLeads] = useState<LeadOption[]>([]);
  const [sourceLeadId, setSourceLeadId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [crmRestricted, setCrmRestricted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const orderResponse = await fetch(`/api/sales/orders/${encodeURIComponent(orderId)}`, { cache: "no-store" });
        const orderPayload = await orderResponse.json().catch(() => null);
        if (!orderResponse.ok) throw new Error(getApiErrorMessage(orderPayload, "Could not load order"));
        const currentOrder = orderPayload as OrderDetail;
        setOrder(currentOrder);
        setSourceLeadId(currentOrder.source_lead_id || "");

        const leadsResponse = await fetch("/api/crm/leads?converted=true&limit=100", { cache: "no-store" });
        if (leadsResponse.status === 403) {
          setCrmRestricted(true);
          return;
        }
        const leadsPayload = await leadsResponse.json().catch(() => null);
        if (!leadsResponse.ok) throw new Error(getApiErrorMessage(leadsPayload, "Could not load converted leads"));
        const page = leadsPayload as LeadPage;
        setLeads(page.items.filter((lead) => lead.converted_client_id === currentOrder.client_id));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not load order relationships");
      } finally {
        setLoading(false);
      }
    })();
  }, [orderId]);

  const leadOptions = useMemo(() => leads.map((lead) => ({
    value: lead.id,
    label: `${lead.lead_code} · ${lead.company_name || lead.contact_name}`,
    keywords: `${lead.contact_name} ${lead.company_name || ""} ${lead.source_name || ""} ${lead.status_name}`,
  })), [leads]);

  async function save() {
    if (!order || order.quotation_id) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/sales/orders/${encodeURIComponent(order.id)}/source-lead`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_lead_id: sourceLeadId || null }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not update order"));
      router.push(`/dashboard/orders/${encodeURIComponent(order.id)}`);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update order");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <main className="min-h-screen bg-neutral-100 p-5 sm:p-8 lg:p-10"><div className="mx-auto max-w-3xl"><div className="h-72 animate-pulse rounded-3xl border bg-white" /></div></main>;
  }

  if (!order) {
    return <main className="min-h-screen bg-neutral-100 p-5 sm:p-8 lg:p-10"><div className="mx-auto max-w-3xl rounded-3xl border bg-white p-6"><p className="text-sm text-red-600">{error || "Order not found."}</p><Link href="/dashboard/orders" className="mt-4 inline-flex text-sm font-semibold underline">Back to orders</Link></div></main>;
  }

  const detailHref = `/dashboard/orders/${encodeURIComponent(order.id)}`;
  const quotationLocked = Boolean(order.quotation_id);

  return <main className="min-h-screen bg-neutral-100 p-5 sm:p-8 lg:p-10">
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <Link href={detailHref} className="inline-flex items-center gap-2 text-sm font-medium text-neutral-500 transition hover:text-neutral-950"><ArrowLeft className="size-4" />Back to order</Link>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400">Order relationships</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Edit {order.order_number}</h1><p className="mt-2 text-sm text-neutral-500">Keep the sales lineage connected when a quotation was not required.</p></div>
          <span className="self-start rounded-full border bg-white px-3 py-1 text-xs font-semibold capitalize text-neutral-600 sm:self-auto">{order.status.replaceAll("_", " ")}</span>
        </div>
      </header>

      {error ? <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <section className="rounded-3xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-start gap-3 border-b pb-5"><div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100"><UsersRound className="size-5 text-neutral-600" /></div><div><h2 className="font-semibold">Source lead</h2><p className="mt-1 text-sm leading-6 text-neutral-500">Link this order to the CRM opportunity that became <strong className="font-semibold text-neutral-700">{order.client_name_snapshot}</strong>.</p></div></div>

        {quotationLocked ? <div className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-900">This order was created from a quotation. Its source lead is inherited from that quotation and is intentionally read-only.</div> : crmRestricted ? <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">Your role can manage orders but cannot view CRM leads. Ask an administrator with CRM access to link the source lead.</div> : <div className="mt-5 space-y-4">
          <SearchableSelect label="Converted lead" value={sourceLeadId} onValueChange={setSourceLeadId} options={leadOptions} placeholder="No source lead linked" searchPlaceholder="Search converted leads..." />
          <p className="text-xs leading-5 text-neutral-400">Only leads that were converted to this same client are available. This prevents an order from being linked to another client’s opportunity.</p>
          {!leads.length ? <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">No converted CRM lead was found for this client. If this client came from a lead, verify that the lead was converted to this exact client record.</div> : null}
        </div>}
      </section>

      <section className="rounded-3xl border bg-white p-5 sm:p-6">
        <h2 className="font-semibold">Order context</h2>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-2xl bg-neutral-50 p-4"><dt className="text-xs text-neutral-400">Client</dt><dd className="mt-1 font-semibold">{order.client_name_snapshot}</dd></div>
          <div className="rounded-2xl bg-neutral-50 p-4"><dt className="text-xs text-neutral-400">Order source</dt><dd className="mt-1 font-semibold capitalize">{order.source || "Direct / manual"}</dd></div>
          <div className="rounded-2xl bg-neutral-50 p-4 sm:col-span-2"><dt className="text-xs text-neutral-400">External order ID</dt><dd className="mt-1 break-all font-semibold">{order.external_order_id || "—"}</dd></div>
        </dl>
      </section>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Link href={detailHref} className="inline-flex h-11 items-center justify-center rounded-xl border bg-white px-5 text-sm font-semibold">Cancel</Link>
        {!quotationLocked && !crmRestricted ? <button type="button" disabled={saving} onClick={() => void save()} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-neutral-950 px-5 text-sm font-semibold text-white disabled:opacity-50">{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}{saving ? "Saving…" : "Save changes"}</button> : null}
      </div>
    </div>
  </main>;
}
