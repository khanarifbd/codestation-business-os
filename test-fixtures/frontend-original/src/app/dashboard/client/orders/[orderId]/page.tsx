"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CalendarDays, FileText, ReceiptText } from "lucide-react";
import { useParams, useRouter } from "next/navigation";

import { ClientPortalError, ClientPortalLoading, ClientPortalPageHeader, ClientPortalStatusBadge, formatPortalDate, formatPortalMoney } from "@/components/client-portal-ui";
import type { ClientPortalOrderDetail } from "@/lib/client-portal-types";

export default function ClientOrderDetailPage() {
  const params = useParams<{ orderId: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<ClientPortalOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/client-portal/orders/${encodeURIComponent(params.orderId)}`, { cache: "no-store" });
        if (response.status === 401) { router.replace("/login"); return; }
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.detail ?? "Unable to load order");
        if (active) setOrder(payload as ClientPortalOrderDetail);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Unable to load order");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [params.orderId, router]);

  if (loading) return <ClientPortalLoading />;
  if (!order) return <ClientPortalError message={error ?? "Order not found"} />;

  const contractChanged = Number(order.approved_change_value) !== 0;

  return <main className="min-h-screen bg-neutral-100 p-5 sm:p-8 lg:p-10"><div className="mx-auto max-w-[1150px]">
    <ClientPortalPageHeader title={order.subject || order.order_number} description="Order details and service periods linked to your client account." backHref="/dashboard/client/orders" />
    <div className="mt-5 flex flex-wrap items-center gap-2"><span className="text-sm font-medium text-neutral-400">{order.order_number}</span><ClientPortalStatusBadge status={order.status} />{order.quotation_id ? <Link href={`/dashboard/client/quotations/${order.quotation_id}`} className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium text-neutral-600">View quotation<FileText className="size-3" /></Link> : null}</div>

    <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-2xl border bg-white p-5"><p className="text-xs font-medium uppercase tracking-[0.12em] text-neutral-400">Current contract</p><p className="mt-2 text-xl font-semibold">{formatPortalMoney(order.revised_contract_value, order.currency)}</p>{contractChanged ? <p className="mt-1 text-xs text-neutral-400">Original {formatPortalMoney(order.total, order.currency)}</p> : null}</div>
      <div className="rounded-2xl border bg-white p-5"><p className="text-xs font-medium uppercase tracking-[0.12em] text-neutral-400">Approved changes</p><p className="mt-2 text-xl font-semibold">{Number(order.approved_change_value) > 0 ? "+" : ""}{formatPortalMoney(order.approved_change_value, order.currency)}</p></div>
      <div className="rounded-2xl border bg-white p-5"><div className="flex items-center gap-2 text-neutral-400"><CalendarDays className="size-4" /><p className="text-xs font-medium uppercase tracking-[0.12em]">Order date</p></div><p className="mt-2 text-xl font-semibold">{formatPortalDate(order.order_date)}</p></div>
      <div className="rounded-2xl border bg-white p-5"><p className="text-xs font-medium uppercase tracking-[0.12em] text-neutral-400">Completed</p><p className="mt-2 text-xl font-semibold">{formatPortalDate(order.completed_at)}</p></div>
    </div>

    <section className="mt-5 rounded-2xl border bg-white p-5 sm:p-6"><div className="flex items-center gap-2"><ReceiptText className="size-4 text-neutral-400" /><h2 className="font-semibold">Order information</h2></div><div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4"><div><p className="text-xs text-neutral-400">From</p><p className="mt-1 text-sm font-medium">{order.seller_name}</p>{order.seller_email ? <p className="mt-1 text-xs text-neutral-500">{order.seller_email}</p> : null}</div><div><p className="text-xs text-neutral-400">Ordered for</p><p className="mt-1 text-sm font-medium">{order.client_name}</p>{order.client_email ? <p className="mt-1 text-xs text-neutral-500">{order.client_email}</p> : null}</div><div><p className="text-xs text-neutral-400">Confirmed</p><p className="mt-1 text-sm font-medium">{formatPortalDate(order.confirmed_at)}</p></div><div><p className="text-xs text-neutral-400">Currency</p><p className="mt-1 text-sm font-medium">{order.currency}</p></div></div></section>

    <section className="mt-5 overflow-hidden rounded-2xl border bg-white"><div className="border-b px-5 py-4 sm:px-6"><h2 className="font-semibold">Original items & services</h2>{contractChanged ? <p className="mt-1 text-xs text-neutral-400">This table preserves the original order scope. Approved commercial changes are reflected in the current contract value above.</p> : null}</div><div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-neutral-50 text-xs uppercase tracking-[0.08em] text-neutral-400"><tr><th className="px-5 py-3 font-medium">Item</th><th className="px-4 py-3 font-medium">Qty</th><th className="px-4 py-3 font-medium">Service period</th><th className="px-4 py-3 font-medium">Unit price</th><th className="px-5 py-3 text-right font-medium">Total</th></tr></thead><tbody className="divide-y">{order.items.map((item) => <tr key={item.id}><td className="px-5 py-4"><p className="font-medium">{item.item_name}</p>{item.description ? <p className="mt-1 max-w-xl text-xs leading-5 text-neutral-500">{item.description}</p> : null}</td><td className="px-4 py-4 text-neutral-600">{Number(item.quantity).toLocaleString()} {item.unit}</td><td className="px-4 py-4 text-neutral-600">{item.service_start_date || item.service_end_date ? <><span>{formatPortalDate(item.service_start_date)}</span><span className="mx-1">→</span><span>{formatPortalDate(item.service_end_date)}</span></> : item.service_duration_months ? `${item.service_duration_months} month${item.service_duration_months === 1 ? "" : "s"}` : "One-time"}</td><td className="px-4 py-4 text-neutral-600">{formatPortalMoney(item.unit_price, order.currency)}</td><td className="px-5 py-4 text-right font-semibold">{formatPortalMoney(item.line_total, order.currency)}</td></tr>)}</tbody></table></div><div className="ml-auto grid max-w-md gap-2 border-t px-5 py-5 text-sm sm:px-6"><div className="flex justify-between gap-4"><span className="text-neutral-500">Subtotal</span><span className="font-medium">{formatPortalMoney(order.subtotal, order.currency)}</span></div><div className="flex justify-between gap-4"><span className="text-neutral-500">Discount</span><span className="font-medium">{formatPortalMoney(order.discount_total, order.currency)}</span></div><div className="flex justify-between gap-4"><span className="text-neutral-500">Tax</span><span className="font-medium">{formatPortalMoney(order.tax_total, order.currency)}</span></div><div className="flex justify-between gap-4 border-t pt-2 text-base"><span className="font-semibold">Original order total</span><span className="font-semibold">{formatPortalMoney(order.total, order.currency)}</span></div></div></section>

    {(order.notes || order.terms_conditions) ? <section className="mt-5 grid gap-5 sm:grid-cols-2">{order.notes ? <div className="rounded-2xl border bg-white p-5"><h2 className="font-semibold">Notes</h2><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-neutral-600">{order.notes}</p></div> : null}{order.terms_conditions ? <div className="rounded-2xl border bg-white p-5"><h2 className="font-semibold">Terms & conditions</h2><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-neutral-600">{order.terms_conditions}</p></div> : null}</section> : null}
  </div></main>;
}
