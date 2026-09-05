"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, ReceiptText } from "lucide-react";
import { useRouter } from "next/navigation";

import { ClientPortalError, ClientPortalLoading, ClientPortalPageHeader, ClientPortalStatusBadge, formatPortalDate, formatPortalMoney } from "@/components/client-portal-ui";
import type { ClientPortalOrder } from "@/lib/client-portal-types";

export default function ClientOrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<ClientPortalOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/client-portal/orders", { cache: "no-store" });
        if (response.status === 401) { router.replace("/login"); return; }
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.detail ?? "Unable to load orders");
        if (active) setOrders(payload as ClientPortalOrder[]);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Unable to load orders");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [router]);

  if (loading) return <ClientPortalLoading />;
  if (error) return <ClientPortalError message={error} />;

  return <main className="min-h-screen bg-neutral-100 p-5 sm:p-8 lg:p-10"><div className="mx-auto max-w-[1200px]">
    <ClientPortalPageHeader title="Orders" description="Confirmed work and services purchased through your linked client profiles." />
    {orders.length ? <div className="mt-6 grid gap-4 lg:grid-cols-2">{orders.map((order) => {
      const changed = Number(order.approved_change_value) !== 0;
      return <Link key={order.id} href={`/dashboard/client/orders/${order.id}`} className="group rounded-2xl border bg-white p-5 transition hover:border-neutral-300 hover:shadow-sm"><div className="flex items-start justify-between gap-4"><div className="flex min-w-0 gap-3"><div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100"><ReceiptText className="size-5 text-neutral-500" /></div><div className="min-w-0"><p className="truncate font-semibold">{order.subject || order.order_number}</p><p className="mt-1 text-xs text-neutral-400">{order.order_number} · {formatPortalDate(order.order_date)}</p></div></div><ClientPortalStatusBadge status={order.status} /></div><div className="mt-5 flex items-end justify-between gap-4 border-t pt-4"><div><p className="text-xs text-neutral-400">Current contract</p><p className="mt-1 font-semibold">{formatPortalMoney(order.revised_contract_value, order.currency)}</p>{changed ? <p className="mt-1 text-xs text-neutral-400">Original {formatPortalMoney(order.total, order.currency)}</p> : null}</div><ArrowRight className="size-4 text-neutral-300 transition group-hover:translate-x-1 group-hover:text-neutral-600" /></div></Link>;
    })}</div> : <div className="mt-6 rounded-2xl border bg-white px-5 py-16 text-center"><ReceiptText className="mx-auto size-8 text-neutral-300" /><p className="mt-3 text-sm font-medium">No orders yet</p><p className="mt-1 text-sm text-neutral-400">Orders linked to your client profile will appear here.</p></div>}
  </div></main>;
}
