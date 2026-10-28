"use client";

import Link from "next/link";
import { formatMoneyExact } from "@/lib/sales-money-preview";
import { transferCents } from "@/components/accounting-transfers/transfer-model";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  BadgeDollarSign,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  FolderKanban,
  Loader2,
  PackageCheck,
  PlayCircle,
  ReceiptText,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { OrderFulfillmentPanel, type FulfillmentOrderItem } from "@/components/order-fulfillment-panel";
import { RelationshipPage } from "@/components/relationships/relationship-ui";
import { orderDocumentHref, orderReturnHref } from "@/lib/order-navigation";
import "@/components/commercial/order-detail.css";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { settlementScope, useOrderSettlementState } from "@/hooks/use-order-settlement";
import type { SettlementState } from "@/components/commercial/order-settlement-model";

type OrderItem = FulfillmentOrderItem & {
  quotation_item_id: string | null;
  sort_order: number;
  description: string;
  unit_price: string | number;
  discount_percent: string | number;
  tax_rate: string | number;
  line_subtotal: string | number;
  discount_amount: string | number;
  taxable_amount: string | number;
  tax_amount: string | number;
  line_total: string | number;
};

type OrderDetail = {
  id: string;
  order_number: string;
  quotation_id: string | null;
  quotation_number: string | null;
  client_id: string;
  source_lead_id: string | null;
  assigned_employee_id: string | null;
  assigned_employee_name: string | null;
  source: string | null;
  external_order_id: string | null;
  status: string;
  subject: string | null;
  order_date: string;
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
  internal_notes: string | null;
  confirmed_at: string;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  items: OrderItem[];
  created_at: string;
  updated_at: string;
};

type LeadDetail = {
  lead: {
    id: string;
    lead_code: string;
    company_name: string | null;
    contact_name: string;
    source_name: string | null;
    status_name: string;
  };
};

type ProjectLink = { project_id: string; project_number: string; status: string };
type ProjectDetail = ProjectLink & {
  name: string;
  priority: string;
  project_manager_name: string | null;
  progress_percent?: number;
};

function money(value: string | number | null | undefined, currency: string) {
  return formatMoneyExact(value || 0, currency);
}

/** Read-display only. The state API does not supply converted amounts for mixed-currency expenses. */
function settlementDisplayTotals(settlement: SettlementState | null, orderCurrency: string) {
  const currency = settlement?.currency || orderCurrency;
  const unavailable = { expenseTotal: null, net: null, unavailable: true };
  if (settlement?.expenses.some(expense => expense.currency !== currency)) return unavailable;
  let expenseCents = BigInt(0);
  for (const expense of settlement?.expenses || []) {
    const cents = transferCents(expense.amount);
    if (cents === null) return unavailable;
    expenseCents += cents;
  }
  const decimal = (value: bigint) => { const magnitude = value < BigInt(0) ? -value : value; return `${value < BigInt(0) ? "-" : ""}${magnitude / BigInt(100)}.${String(magnitude % BigInt(100)).padStart(2, "0")}`; };
  const gross = settlement?.gross_amount == null ? null : transferCents(settlement.gross_amount);
  if (settlement?.gross_amount != null && gross === null) return unavailable;
  return { expenseTotal: decimal(expenseCents), net: gross === null ? null : decimal(gross - expenseCents), unavailable: false };
}

function readableDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

export default function OrderDetailRoute() {
  const { tenant, loading } = useDashboardSession();
  const { orderId } = useParams<{ orderId: string }>();
  if (loading) return <RelationshipPage><p role="status">Loading order access…</p></RelationshipPage>;
  return <OrderDetailPage key={settlementScope(tenant, orderId)} />;
}

function OrderDetailPage() {
  const params = useParams<{ orderId: string }>();
  const router = useRouter();
  const orderId = params.orderId;
  const { tenant } = useDashboardSession();
  const query = useSearchParams();
  const canManageFinance = Boolean(tenant?.permissions.some(p => p === "*" || p === "finance.manage"));
  const settlementRead = useOrderSettlementState(orderId);
  const settlement = settlementRead.value;
  const financeAccess = settlementRead.canView && !settlementRead.denied;
  const settlementHref = orderDocumentHref(orderId, "settlement", orderReturnHref(query.toString()));
  const alive = useRef(true);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [projectAccessRestricted, setProjectAccessRestricted] = useState(false);
  const [leadAccessRestricted, setLeadAccessRestricted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingStatus, setSavingStatus] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const salesApi = useCallback(async (path: string, init?: RequestInit) => {
    const response = await fetch(`/api/sales${path}`, init);
    if (response.status === 401 && alive.current) {
      router.replace("/login");
      throw new Error("Authentication required");
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.detail ?? "Order request failed.");
    return payload;
  }, [router]);

  const loadSettlement = settlementRead.load;

  const loadRelated = useCallback(async (sourceOrder: OrderDetail) => {
    setLead(null);
    setProject(null);
    setLeadAccessRestricted(false);
    setProjectAccessRestricted(false);

    const tasks: Promise<void>[] = [];
    if (sourceOrder.source_lead_id) {
      tasks.push((async () => {
        const response = await fetch(`/api/crm/leads/${encodeURIComponent(sourceOrder.source_lead_id!)}`, { cache: "no-store" });
        if (response.status === 403) {
          setLeadAccessRestricted(true);
          return;
        }
        if (!response.ok) return;
        setLead(await response.json() as LeadDetail);
      })());
    }

    tasks.push((async () => {
      const response = await fetch(`/api/projects/order/${encodeURIComponent(sourceOrder.id)}/link`, { cache: "no-store" });
      if (response.status === 403) {
        setProjectAccessRestricted(true);
        return;
      }
      if (!response.ok) return;
      const link = await response.json() as ProjectLink | null;
      if (!link) return;
      const detailResponse = await fetch(`/api/projects/${encodeURIComponent(link.project_id)}`, { cache: "no-store" });
      if (detailResponse.status === 403) {
        setProjectAccessRestricted(true);
        setProject({ ...link, name: link.project_number, priority: "—", project_manager_name: null });
        return;
      }
      if (!detailResponse.ok) {
        setProject({ ...link, name: link.project_number, priority: "—", project_manager_name: null });
        return;
      }
      const detail = await detailResponse.json();
      setProject({
        project_id: detail.id,
        project_number: detail.project_number,
        status: detail.status,
        name: detail.name,
        priority: detail.priority,
        project_manager_name: detail.project_manager_name,
        progress_percent: detail.progress_percent,
      });
    })());

    tasks.push(loadSettlement().then(() => undefined));
    await Promise.allSettled(tasks);
  }, [loadSettlement]);

  const loadOrder = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true);
    setError(null);
    try {
      const payload = await salesApi(`/orders/${encodeURIComponent(orderId)}`) as OrderDetail;
      if (!alive.current) return;
      if (!payload || payload.id !== orderId) throw new Error("Order identity could not be verified.");
      setOrder(payload);
      await loadRelated(payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load order.");
    } finally {
      if (showLoader) setLoading(false);
    }
  }, [loadRelated, orderId, salesApi]);

  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void loadOrder(); }); return () => { active = false; }; }, [loadOrder]);

  const stockRemaining = useMemo(
    () => order?.items.some((item) => item.item_type_snapshot === "stock_item" && item.product_id && Number(item.remaining_quantity || 0) > 0) ?? false,
    [order],
  );
  const hasPostedFulfillment = useMemo(
    () => order?.items.some((item) => item.item_type_snapshot === "stock_item" && Number(item.fulfilled_quantity || 0) > 0) ?? false,
    [order],
  );

  async function changeStatus(next: "in_progress" | "completed" | "cancelled", reason?: string) {
    if (!order) return false;
    if (next === "completed" && !window.confirm("Complete this order? This marks execution as finished and may lock downstream actions until the order is reopened.")) return false;
    const reopening = order.status === "completed" && next === "in_progress";
    if (reopening && !window.confirm("Reopen this order? The order will return to In Progress so execution and project setup can continue.")) return false;
    setSavingStatus(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await salesApi(`/orders/${encodeURIComponent(order.id)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next, ...(next === "cancelled" ? { reason } : {}) }),
      }) as OrderDetail;
      setOrder(updated);
      setMessage(reopening ? `Order ${updated.order_number} reopened and returned to In Progress.` : `Order ${updated.order_number} marked ${statusLabel(updated.status).toLowerCase()}.`);
      await loadRelated(updated);
      return true;
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : "Unable to update order status.");
      return false;
    } finally {
      setSavingStatus(false);
    }
  }

  async function confirmCancellation() {
    const reason = cancelReason.trim();
    if (reason.length < 3) return;
    if (await changeStatus("cancelled", reason)) {
      setCancelOpen(false);
      setCancelReason("");
    }
  }

  async function refreshAfterFulfillment(fulfillmentNumber: string) {
    setMessage(`${fulfillmentNumber} posted. Inventory and COGS are updated.`);
    await loadOrder(false);
  }

  if (loading) {
    return <RelationshipPage className="order-detail-workspace"><div role="status" className="order-loading"><Loader2 className="size-5 animate-spin" />Loading order…</div></RelationshipPage>;
  }

  if (!order) {
    return (
      <RelationshipPage className="order-detail-workspace">
        <div className="order-unavailable"><OrderBackLink /><h1>Order unavailable</h1><p role="alert">{error ?? "Order is unavailable."}</p></div>
      </RelationshipPage>
    );
  }

  const settlementTotals = settlementDisplayTotals(settlement, order.currency);
  const settlementExpenseTotal = settlementTotals.expenseTotal;
  const settlementNet = settlementTotals.net;
  const canSettle = order.id === orderId && order.status === "completed" && canManageFinance && financeAccess && !settlementRead.loading && !settlementRead.error && settlement?.eligible === true;

  return (
    <RelationshipPage className="order-detail-workspace">
      <div className="order-detail-content">
        <header className="order-identity">
          <OrderBackLink />
          <div className="order-identity-main">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="relationship-eyebrow">Sales / Order workspace</p>
                <StatusBadge status={order.status} />
                {order.source ? <span className="rounded-full border bg-neutral-50 px-2.5 py-1 text-xs font-medium text-neutral-600">{order.source}</span> : null}
              </div>
              <h1 className="mt-2 break-words text-2xl font-semibold tracking-tight sm:text-3xl">{order.order_number}</h1>
              <p className="mt-1 break-words text-sm text-neutral-500">{order.subject || `${order.client_name_snapshot} commercial order`}</p>
              <div className="order-identity-meta">
                <span>{readableDate(order.order_date)}</span>
                {order.external_order_id ? <span>External ID: <strong className="font-medium text-neutral-700">{order.external_order_id}</strong></span> : null}
              </div>
            </div>
            <div className="order-identity-right"><div className="order-identity-total"><span>Order total · {order.currency}</span><strong>{money(order.total, order.currency)}</strong></div><div className="order-identity-actions">
              {project ? <Link href={`/dashboard/projects/${encodeURIComponent(project.project_id)}`} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border bg-white px-4 text-sm font-semibold"><FolderKanban className="size-4" />Open project</Link> : ["confirmed", "in_progress"].includes(order.status) ? <Link href={`/dashboard/projects?order_id=${encodeURIComponent(order.id)}`} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border bg-white px-4 text-sm font-semibold"><FolderKanban className="size-4" />Project workspace</Link> : null}
              {canSettle ? <a href={settlementHref} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white"><CircleDollarSign className="size-4" />Create invoice & settle</a> : null}
            </div></div>
          </div>
        </header>

        {message ? <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div> : null}
        {error ? <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

            <section className="order-execution">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="order-execution-label"><p className="relationship-eyebrow">Execution</p><h2><StatusBadge status={order.status} /></h2></div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  {order.status === "confirmed" ? <><button disabled={savingStatus} onClick={() => void changeStatus("in_progress")} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-50"><PlayCircle className="size-4" />Start order</button><button disabled={savingStatus || hasPostedFulfillment} onClick={() => setCancelOpen(true)} className="h-11 rounded-xl border px-4 text-sm font-semibold disabled:opacity-40">Cancel</button></> : null}
                  {order.status === "in_progress" ? <><button disabled={savingStatus || stockRemaining} onClick={() => void changeStatus("completed")} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-50"><CheckCircle2 className="size-4" />{stockRemaining ? "Fulfill stock first" : "Complete order"}</button><button disabled={savingStatus || hasPostedFulfillment} onClick={() => setCancelOpen(true)} className="h-11 rounded-xl border px-4 text-sm font-semibold disabled:opacity-40">Cancel</button></> : null}
                  {order.status === "completed" ? <button disabled={savingStatus} onClick={() => void changeStatus("in_progress")} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border bg-white px-4 text-sm font-semibold disabled:opacity-50"><PlayCircle className="size-4" />Reopen order</button> : null}
                </div>
              </div>
              {order.status === "completed" ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><strong>Order completed.</strong> Reopen it if execution or project setup needs to continue. {canSettle ? "You can also create the invoice and record settlement from this completed order." : null}</div> : null}
              {order.status === "cancelled" ? <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><strong>Order cancelled.</strong><p className="mt-1 whitespace-pre-wrap">{order.cancellation_reason ? `Reason: ${order.cancellation_reason}` : "Cancellation reason is unavailable for this older record."}</p></div> : null}
              {hasPostedFulfillment && order.status !== "completed" ? <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Posted stock fulfillment cannot be cancelled directly. A stock return/reversal is required first.</div> : null}
            </section>

        <BusinessFlow order={order} lead={lead} project={project} settlement={settlement} leadAccessRestricted={leadAccessRestricted} projectAccessRestricted={projectAccessRestricted} settlementUnavailable={Boolean(settlementRead.loading || settlementRead.error || !financeAccess)} />

        <div className="order-detail-columns">
          <div className="order-detail-main">
            <OrderFulfillmentPanel orderId={order.id} orderNumber={order.order_number} status={order.status} currency={order.currency} items={order.items} disabled={savingStatus} onFulfilled={refreshAfterFulfillment} />

            <section className="order-lines order-surface">
              <div className="order-section-heading"><div className="flex items-center gap-2"><PackageCheck className="size-5" /><h2 className="font-semibold">Order items</h2></div><p className="mt-1 text-sm text-neutral-500">Commercial lines captured on this order.</p></div>
              {order.items.length === 0 ? <p className="order-empty-lines">No line items are available on this order.</p> : null}
              <div className="order-mobile-lines md:hidden">
                {order.items.map((item) => <div key={item.id} className="order-mobile-line"><div className="order-line-heading"><div className="min-w-0"><p className="break-words font-medium">{item.item_name_snapshot}</p><p className="mt-1 break-words text-xs text-neutral-500">{item.description}</p></div><p className="order-line-amount">{money(item.line_total, order.currency)}</p></div><div className="order-line-facts"><Metric label="Quantity" value={`${Number(item.quantity)} ${item.unit_snapshot}`} /><Metric label="Unit price" value={money(item.unit_price, order.currency)} /><Metric label="Discount" value={`${Number(item.discount_percent)}%`} /><Metric label="Tax" value={`${Number(item.tax_rate)}%`} />{item.item_type_snapshot === "stock_item" ? <><Metric label="Fulfilled" value={String(Number(item.fulfilled_quantity || 0))} /><Metric label="Remaining" value={String(Number(item.remaining_quantity || 0))} /></> : null}</div></div>)}
              </div>
              <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[900px] text-sm"><thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-400"><tr><th className="px-5 py-3 text-left font-medium">Item</th><th className="px-3 py-3 text-right font-medium">Qty</th><th className="px-3 py-3 text-right font-medium">Fulfilled</th><th className="px-3 py-3 text-right font-medium">Unit price</th><th className="px-3 py-3 text-right font-medium">Discount</th><th className="px-3 py-3 text-right font-medium">Tax</th><th className="px-5 py-3 text-right font-medium">Total</th></tr></thead><tbody className="divide-y">{order.items.map((item) => <tr key={item.id}><td className="px-5 py-4"><p className="font-medium">{item.item_name_snapshot}</p><p className="mt-1 max-w-xl text-xs text-neutral-500">{item.description}</p></td><td className="px-3 py-4 text-right">{Number(item.quantity)} {item.unit_snapshot}</td><td className="px-3 py-4 text-right">{item.item_type_snapshot === "stock_item" ? `${Number(item.fulfilled_quantity || 0)} / ${Number(item.quantity)}` : "—"}</td><td className="px-3 py-4 text-right">{money(item.unit_price, order.currency)}</td><td className="px-3 py-4 text-right">{Number(item.discount_percent)}%</td><td className="px-3 py-4 text-right">{Number(item.tax_rate)}%</td><td className="px-5 py-4 text-right font-semibold">{money(item.line_total, order.currency)}</td></tr>)}</tbody></table></div>
            </section>

            <section className="order-snapshots" aria-label="Order address snapshots">
              <Snapshot title="From" name={order.seller_name_snapshot} email={order.seller_email_snapshot} address={order.seller_address_snapshot} tax={order.seller_tax_identifier_snapshot} />
              <Snapshot title="To" name={order.client_name_snapshot} email={order.client_email_snapshot} address={order.client_address_snapshot} tax={order.client_tax_identifier_snapshot} />
            </section>

            {(order.notes || order.terms_conditions || order.internal_notes) ? <section className="order-surface order-notes"><div className="flex items-center gap-2"><FileText className="size-5" /><h2 className="font-semibold">Notes & terms</h2></div><div className="order-note-ledger">{order.notes ? <TextBlock label="Client notes" value={order.notes} /> : null}{order.terms_conditions ? <TextBlock label="Terms & conditions" value={order.terms_conditions} /> : null}{order.internal_notes ? <TextBlock label="Internal notes" value={order.internal_notes} /> : null}</div></section> : null}
          </div>

          <aside className="order-detail-aside">
            <section className="order-surface order-value">
              <div className="flex items-center gap-2"><BadgeDollarSign className="size-5" /><h2 className="font-semibold">Commercial value</h2></div>
              <dl className="mt-5 space-y-3 text-sm">
                <AmountRow label="Subtotal" value={money(order.subtotal, order.currency)} />
                <AmountRow label="Discount" value={money(order.discount_total, order.currency)} />
                <AmountRow label="Tax" value={money(order.tax_total, order.currency)} />
                <div className="border-t pt-3"><AmountRow label="Order total" value={money(order.total, order.currency)} strong /></div>
              </dl>
            </section>

            <SettlementCard order={order} settlement={settlement} financeAccess={financeAccess} expenseTotal={settlementExpenseTotal} net={settlementNet} totalsUnavailable={settlementTotals.unavailable} settlementHref={canSettle ? settlementHref : undefined} readError={settlementRead.error} readLoading={settlementRead.loading} onRetry={() => void loadSettlement()} />

            <section className="order-surface order-context">
              <h2 className="font-semibold">Order overview</h2>
              <dl className="order-context-ledger">
                <InfoRow label="Client" value={order.client_name_snapshot} href={`/dashboard/clients/${encodeURIComponent(order.client_id)}`} />
                <InfoRow label="Lead" value={lead ? `${lead.lead.lead_code} · ${lead.lead.company_name || lead.lead.contact_name}` : order.source_lead_id ? (leadAccessRestricted ? "Linked · access restricted" : "Linked lead") : "No source lead"} />
                <InfoRow label="Quotation" value={order.quotation_number || "Manual order"} href={order.quotation_id ? "/dashboard/quotations" : undefined} />
                <InfoRow label="Project" value={project ? `${project.project_number} · ${project.name}` : projectAccessRestricted ? "Linked · access restricted" : "Not linked"} href={project ? `/dashboard/projects/${encodeURIComponent(project.project_id)}` : undefined} />
                <InfoRow label="Assigned" value={order.assigned_employee_name || "Unassigned"} />
                <InfoRow label="Order date" value={readableDate(order.order_date)} />
                <InfoRow label="Currency" value={order.currency} />
                <InfoRow label="Tax mode" value={statusLabel(order.tax_calculation_mode)} />
                <InfoRow label="Order source" value={order.source || "Direct / not specified"} />
                <InfoRow label="External order ID" value={order.external_order_id || "—"} />
              </dl>
            </section>

            <section className="order-surface order-lifecycle">
              <h2 className="font-semibold">Lifecycle</h2>
              <div className="mt-5 space-y-4 text-sm"><Lifecycle label="Confirmed" value={order.confirmed_at} done /><Lifecycle label="Started" value={order.started_at} done={Boolean(order.started_at)} /><Lifecycle label="Completed" value={order.completed_at} done={Boolean(order.completed_at)} /><Lifecycle label="Cancelled" value={order.cancelled_at} done={Boolean(order.cancelled_at)} /></div>
            </section>
          </aside>
        </div>
      </div>

      {cancelOpen ? <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingStatus) setCancelOpen(false); }}><OrderDialog label={`Cancel ${order.order_number}`} busy={savingStatus} onClose={() => setCancelOpen(false)} className="w-full rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-3xl sm:p-6"><div className="flex items-start justify-between gap-4"><div><h2 className="font-semibold">Cancel {order.order_number}</h2><p className="mt-1 text-sm text-neutral-500">A cancellation reason is required and will be kept in the audit trail.</p></div><button aria-label="Close cancellation" disabled={savingStatus} onClick={() => setCancelOpen(false)} className="flex size-9 items-center justify-center rounded-xl border"><X className="size-4" /></button></div><label className="mt-5 block text-sm font-medium">Reason<textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} rows={5} maxLength={1000} className="mt-2 w-full rounded-xl border p-3 text-sm outline-none focus:border-neutral-500" placeholder="Why is this order being cancelled?" /></label><div className="mt-5 flex gap-2"><button disabled={savingStatus} onClick={() => setCancelOpen(false)} className="h-11 flex-1 rounded-xl border text-sm font-semibold">Keep order</button><button disabled={savingStatus || cancelReason.trim().length < 3} onClick={() => void confirmCancellation()} className="h-11 flex-1 rounded-xl bg-red-600 text-sm font-semibold text-white disabled:opacity-40">{savingStatus ? "Cancelling…" : "Cancel order"}</button></div></OrderDialog></div> : null}


    </RelationshipPage>
  );
}

function BusinessFlow({ order, lead, project, settlement, leadAccessRestricted, projectAccessRestricted, settlementUnavailable }: { order: OrderDetail; lead: LeadDetail | null; project: ProjectDetail | null; settlement: SettlementState | null; leadAccessRestricted: boolean; projectAccessRestricted: boolean; settlementUnavailable?: boolean }) {
  const steps = [
    { label: "Lead", icon: UsersRound, primary: lead?.lead.lead_code || (order.source_lead_id ? "Linked" : "No lead"), secondary: lead ? (lead.lead.company_name || lead.lead.contact_name) : leadAccessRestricted ? "Access restricted" : null, done: Boolean(order.source_lead_id) },
    { label: "Client", icon: UserRound, primary: order.client_name_snapshot, secondary: "Client", done: true, href: `/dashboard/clients/${encodeURIComponent(order.client_id)}` },
    { label: "Quotation", icon: FileText, primary: order.quotation_number || "Manual order", secondary: order.quotation_id ? "Source quotation" : null, done: Boolean(order.quotation_id) },
    { label: "Order", icon: PackageCheck, primary: order.order_number, secondary: statusLabel(order.status), done: true, active: true },
    { label: "Project", icon: FolderKanban, primary: project?.project_number || (projectAccessRestricted ? "Linked" : "Not linked"), secondary: project?.name || (projectAccessRestricted ? "Access restricted" : null), done: Boolean(project || projectAccessRestricted), href: project ? `/dashboard/projects/${encodeURIComponent(project.project_id)}` : undefined },
    { label: "Invoice", icon: ReceiptText, primary: settlement?.invoice_number || (settlementUnavailable ? "Unavailable" : "Not created"), secondary: settlement?.invoice_status ? statusLabel(settlement.invoice_status) : null, done: Boolean(settlement?.invoice_id), href: settlement?.invoice_id ? "/dashboard/accounting/invoices" : undefined },
  ];
  return <section className="order-trace" aria-label="Business flow">
    <div className="order-trace-title"><h2>Business flow</h2><p>Linked records</p></div>
    <ol className="order-trace-steps">{steps.map((step) => {
      const Icon = step.icon;
      const content = <><span className="order-trace-label"><Icon aria-hidden="true" />{step.label}{step.done && !step.active ? <CheckCircle2 aria-hidden="true" /> : null}</span><strong>{step.primary}</strong>{step.secondary ? <small>{step.secondary}</small> : null}</>;
      return <li key={step.label} data-active={step.active || undefined} data-linked={step.done || undefined}>{step.href ? <Link href={step.href}>{content}</Link> : <div>{content}</div>}</li>;
    })}</ol>
  </section>;
}

function SettlementCard({ order, settlement, financeAccess, expenseTotal, net, totalsUnavailable, settlementHref, readError, readLoading, onRetry }: { order: OrderDetail; settlement: SettlementState | null; financeAccess: boolean; expenseTotal: string | null; net: string | null; totalsUnavailable?: boolean; settlementHref?: string; readError?: string | null; readLoading?: boolean; onRetry?: () => void }) {
  return <section className="order-surface order-settlement"><div className="flex items-center gap-2"><CircleDollarSign className="size-5" /><h2 className="font-semibold">Invoice & settlement</h2></div>{!financeAccess ? <p className="mt-4 text-sm text-neutral-500">Your role does not have Finance access. Order execution remains available.</p> : readLoading ? <p role="status" className="mt-4 text-sm">Loading settlement state…</p> : readError ? <div className="mt-4 text-sm"><p role="alert">{readError} No failed read is treated as an unpaid order.</p><button type="button" className="mt-3 min-h-11 underline" onClick={onRetry}>Retry settlement state</button></div> : settlement?.invoice_id ? <div className="mt-5 space-y-4"><div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><div className="flex items-center gap-2 text-emerald-800"><CheckCircle2 className="size-4" /><p className="font-semibold">{settlement.invoice_number}</p></div><p className="mt-1 text-sm text-emerald-700">{statusLabel(settlement.invoice_status || "invoice")}{settlement.invoice_sent_to_client ? " · marked sent" : " · internal only"}</p></div><dl className="space-y-3 text-sm"><AmountRow label="Invoice total" value={money(settlement.invoice_total, settlement.currency || order.currency)} /><AmountRow label="Paid" value={money(settlement.invoice_amount_paid, settlement.currency || order.currency)} /><AmountRow label="Received into" value={settlement.account_name || "—"} /><AmountRow label="Payment" value={settlement.payment_number || "—"} />{expenseTotal !== null && transferCents(expenseTotal)! > BigInt(0) ? <AmountRow label="Related expense" value={money(expenseTotal, settlement.currency || order.currency)} /> : null}{net != null ? <div className="border-t pt-3"><AmountRow label="Gross less linked expenses" value={money(net, settlement.currency || order.currency)} strong /></div> : null}</dl>{net != null ? <p className="text-xs text-neutral-500">Same-currency gross less linked posted expenses; this is not a verified receiving-account balance change.</p> : null}{totalsUnavailable ? <p className="text-sm text-amber-800">Combined related expense and gross less linked expenses are unavailable: linked amounts use different currencies or could not be verified. Each expense keeps its original currency below; no conversion is inferred.</p> : null}{settlement.expenses.length ? <div className="mt-4 space-y-2">{settlement.expenses.map((expense) => <div key={expense.id} className="rounded-xl bg-neutral-50 p-3 text-xs"><div className="flex items-center justify-between gap-3"><span className="font-medium">{expense.expense_number} · {expense.category_name}</span><span>{money(expense.amount, expense.currency)}</span></div></div>)}</div> : null}<Link href="/dashboard/accounting/invoices" className="mt-4 inline-flex text-xs font-semibold text-neutral-950 underline-offset-4 hover:underline">Open invoices</Link></div> : <div className="mt-5"><p className="text-sm leading-6 text-neutral-500">{settlement?.reason || (order.status === "completed" ? "Create the order invoice, record payment into an account or wallet, and optionally record a related expense." : "Complete the order before settlement.")}</p>{settlementHref ? <a href={settlementHref} className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white"><CircleDollarSign className="size-4" />Create invoice & settle</a> : null}</div>}</section>;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = { confirmed: "border-blue-200 bg-blue-50 text-blue-700", in_progress: "border-amber-200 bg-amber-50 text-amber-700", completed: "border-emerald-200 bg-emerald-50 text-emerald-700", cancelled: "border-red-200 bg-red-50 text-red-700", paid: "border-emerald-200 bg-emerald-50 text-emerald-700" };
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${styles[status] ?? "border-neutral-200 bg-neutral-50 text-neutral-600"}`}>{statusLabel(status)}</span>;
}

function InfoRow({ label, value, href }: { label: string; value: string; href?: string }) {
  return <div className="order-info-row"><dt className="shrink-0 text-neutral-500">{label}</dt><dd className="min-w-0 break-words text-right font-medium">{href ? <Link href={href} className="underline-offset-4 hover:underline">{value}</Link> : value}</dd></div>;
}

function AmountRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className="order-amount-row"><dt className="text-neutral-500">{label}</dt><dd className={strong ? "font-semibold text-neutral-950" : "font-medium"}>{value}</dd></div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="order-fact"><p className="text-[11px] uppercase tracking-wide text-neutral-400">{label}</p><p className="mt-1 break-words font-medium text-neutral-800">{value}</p></div>;
}

function Snapshot({ title, name, email, address, tax }: { title: string; name: string; email: string | null; address: string | null; tax: string | null }) {
  return <div className="order-snapshot"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400">{title}</p><p className="mt-3 font-semibold">{name}</p>{email ? <p className="mt-1 break-all text-sm text-neutral-500">{email}</p> : null}{address ? <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-500">{address}</p> : null}{tax ? <p className="mt-2 text-xs text-neutral-400">Tax ID: {tax}</p> : null}</div>;
}

function TextBlock({ label, value }: { label: string; value: string }) {
  return <div className="order-note"><p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">{label}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-700">{value}</p></div>;
}

function Lifecycle({ label, value, done }: { label: string; value: string | null; done: boolean }) {
  return <div className="order-lifecycle-row"><div className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ${done ? "bg-emerald-100 text-emerald-700" : "bg-neutral-100 text-neutral-300"}`}>{done ? <CheckCircle2 className="size-3.5" /> : <span className="size-1.5 rounded-full bg-current" />}</div><div><p className={done ? "font-medium text-neutral-800" : "text-neutral-400"}>{label}</p><p className="mt-0.5 text-xs text-neutral-400">{done ? readableDate(value) : "Not yet"}</p></div></div>;
}

function orderDialogFocusable(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'))
    .filter(element => element.getClientRects().length > 0 && !element.closest('[hidden], [inert]'));
}

function orderDialogKeyDown(event: KeyboardEvent<HTMLDivElement>, busy: boolean, onClose: () => void) {
  if (event.defaultPrevented) return;
  const dialog = event.currentTarget;
  if (event.key === "Escape") {
    // The existing SearchableSelect owns Escape while its listbox is expanded.
    if (dialog.querySelector('[aria-expanded="true"][aria-haspopup="listbox"]')) return;
    event.preventDefault();
    if (!busy) onClose();
    return;
  }
  if (event.key !== "Tab") return;
  const controls = orderDialogFocusable(dialog);
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (!first) { event.preventDefault(); dialog.focus(); return; }
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
    event.preventDefault(); first.focus();
  }
}

function OrderDialog({ label, busy, onClose, className, children }: { label: string; busy: boolean; onClose: () => void; className: string; children: ReactNode }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusInside = () => (orderDialogFocusable(dialog)[0] || dialog).focus();
    focusInside();
    const retainFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) focusInside();
    };
    document.addEventListener("focusin", retainFocus);
    return () => {
      document.removeEventListener("focusin", retainFocus);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={label} aria-busy={busy} tabIndex={-1} className={`order-dialog ${className}`} onKeyDown={event => orderDialogKeyDown(event, busy, onClose)}>{children}</div>;
}


function OrderBackLink() {
  const searchParams = useSearchParams();
  return <Link href={orderReturnHref(searchParams.toString())} className="order-back-link"><ArrowLeft className="size-4" />Back to orders</Link>;
}
