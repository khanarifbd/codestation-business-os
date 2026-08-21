"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  BadgeDollarSign,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  FolderKanban,
  HandCoins,
  Loader2,
  PackageCheck,
  PlayCircle,
  ReceiptText,
  UserRound,
  UsersRound,
  X,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { OrderFulfillmentPanel, type FulfillmentOrderItem } from "@/components/order-fulfillment-panel";
import { SearchableSelect } from "@/components/searchable-select";

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

type SettlementExpense = {
  id: string;
  expense_number: string;
  category_name: string;
  amount: string | number;
  currency: string;
};

type SettlementState = {
  order_id: string;
  eligible: boolean;
  reason: string | null;
  invoice_id: string | null;
  invoice_number: string | null;
  invoice_status: string | null;
  invoice_total: string | number | null;
  invoice_amount_paid: string | number | null;
  invoice_balance_due: string | number | null;
  invoice_sent_to_client: boolean;
  payment_id: string | null;
  payment_number: string | null;
  account_id: string | null;
  account_name: string | null;
  gross_amount: string | number | null;
  currency: string | null;
  expenses: SettlementExpense[];
};

type SettlementMeta = {
  order_id: string;
  order_number: string;
  currency: string;
  total: string | number;
  accounts: Array<{
    id: string;
    name: string;
    account_type: string;
    currency: string;
    current_balance: string | number;
  }>;
  expense_categories: Array<{
    id: string;
    name: string;
    cost_type: string;
  }>;
};

type SettlementResult = {
  invoice_number: string;
  payment_number: string;
  expense_number: string | null;
  account_name: string;
  currency: string;
  gross_amount: string | number;
  expense_amount: string | number;
  net_amount: string | number;
};

function money(value: string | number | null | undefined, currency: string) {
  return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

export default function OrderDetailPage() {
  const params = useParams<{ orderId: string }>();
  const router = useRouter();
  const orderId = params.orderId;
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [projectAccessRestricted, setProjectAccessRestricted] = useState(false);
  const [leadAccessRestricted, setLeadAccessRestricted] = useState(false);
  const [settlement, setSettlement] = useState<SettlementState | null>(null);
  const [financeAccess, setFinanceAccess] = useState(true);
  const [loading, setLoading] = useState(true);
  const [savingStatus, setSavingStatus] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [settlementMeta, setSettlementMeta] = useState<SettlementMeta | null>(null);
  const [settlementLoading, setSettlementLoading] = useState(false);
  const [settlementSaving, setSettlementSaving] = useState(false);
  const [settlementError, setSettlementError] = useState<string | null>(null);
  const [settlementAccountId, setSettlementAccountId] = useState("");
  const [settlementDate, setSettlementDate] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("0.00");
  const [expenseCategoryId, setExpenseCategoryId] = useState("");
  const [expenseDescription, setExpenseDescription] = useState("");
  const [settlementReference, setSettlementReference] = useState("");
  const [markInvoiceSent, setMarkInvoiceSent] = useState(false);

  const salesApi = useCallback(async (path: string, init?: RequestInit) => {
    const response = await fetch(`/api/sales${path}`, init);
    if (response.status === 401) {
      router.replace("/login");
      throw new Error("Authentication required");
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.detail ?? "Order request failed.");
    return payload;
  }, [router]);

  const loadSettlement = useCallback(async () => {
    const response = await fetch(`/api/finance/orders/${encodeURIComponent(orderId)}/settlement`, { cache: "no-store" });
    if (response.status === 401) {
      router.replace("/login");
      return null;
    }
    if (response.status === 403) {
      setFinanceAccess(false);
      setSettlement(null);
      return null;
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) return null;
    setFinanceAccess(true);
    setSettlement(payload as SettlementState);
    return payload as SettlementState;
  }, [orderId, router]);

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
      setOrder(payload);
      await loadRelated(payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load order.");
    } finally {
      if (showLoader) setLoading(false);
    }
  }, [loadRelated, orderId, salesApi]);

  useEffect(() => { void loadOrder(); }, [loadOrder]);

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
      setMessage(`Order ${updated.order_number} marked ${statusLabel(updated.status).toLowerCase()}.`);
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

  async function openSettlement() {
    if (!order || !financeAccess) return;
    setSettlementOpen(true);
    setSettlementLoading(true);
    setSettlementError(null);
    setSettlementMeta(null);
    setSettlementAccountId("");
    setExpenseAmount("0.00");
    setExpenseCategoryId("");
    setExpenseDescription("");
    setSettlementReference(order.external_order_id || order.order_number);
    setMarkInvoiceSent(false);
    try {
      const response = await fetch(`/api/finance/orders/${encodeURIComponent(order.id)}/settlement-meta`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to load settlement options.");
      setSettlementMeta(payload as SettlementMeta);
    } catch (reason) {
      setSettlementError(reason instanceof Error ? reason.message : "Unable to load settlement options.");
    } finally {
      setSettlementLoading(false);
    }
  }

  async function submitSettlement() {
    if (!order || !settlementMeta) return;
    const expense = Number(expenseAmount || 0);
    if (!settlementAccountId) {
      setSettlementError("Select the account or wallet that received the order payment.");
      return;
    }
    if (!Number.isFinite(expense) || expense < 0) {
      setSettlementError("Enter a valid expense amount.");
      return;
    }
    if (expense > Number(order.total)) {
      setSettlementError("Settlement expense cannot exceed the order total.");
      return;
    }
    if (expense > 0 && !expenseCategoryId) {
      setSettlementError("Select an expense category when an expense amount is entered.");
      return;
    }

    setSettlementSaving(true);
    setSettlementError(null);
    try {
      const response = await fetch(`/api/finance/orders/${encodeURIComponent(order.id)}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: settlementAccountId,
          settlement_date: settlementDate || null,
          expense_amount: expense.toFixed(2),
          expense_category_id: expense > 0 ? expenseCategoryId : null,
          expense_description: expense > 0 ? (expenseDescription.trim() || null) : null,
          mark_invoice_sent_to_client: markInvoiceSent,
          reference: settlementReference.trim() || null,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to settle this order.");
      const result = payload as SettlementResult;
      setSettlementOpen(false);
      setMessage(
        `${result.invoice_number} created and paid via ${result.account_name}${result.expense_number ? `; ${result.expense_number} recorded` : ""}.`,
      );
      await Promise.all([loadOrder(false), loadSettlement()]);
    } catch (reason) {
      setSettlementError(reason instanceof Error ? reason.message : "Unable to settle this order.");
    } finally {
      setSettlementSaving(false);
    }
  }

  if (loading) {
    return <main className="flex min-h-[70vh] items-center justify-center bg-neutral-100 p-6"><Loader2 className="size-6 animate-spin text-neutral-400" /></main>;
  }

  if (!order) {
    return (
      <main className="min-h-screen bg-neutral-100 p-4 sm:p-6 lg:p-10">
        <div className="mx-auto max-w-5xl rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">{error ?? "Order is unavailable."}</div>
      </main>
    );
  }

  const settlementExpenseTotal = settlement?.expenses.reduce((total, item) => total + Number(item.amount || 0), 0) ?? 0;
  const settlementNet = settlement?.gross_amount != null ? Number(settlement.gross_amount) - settlementExpenseTotal : null;
  const previewExpense = Math.max(0, Number(expenseAmount || 0));
  const previewNet = Number(order.total) - (Number.isFinite(previewExpense) ? previewExpense : 0);
  const canSettle = order.status === "completed" && financeAccess && settlement?.eligible === true;

  const accountOptions = settlementMeta?.accounts.map((account) => ({
    value: account.id,
    label: `${account.name} · ${account.currency} · ${money(account.current_balance, account.currency)}`,
    keywords: `${account.account_type} ${account.currency}`,
  })) ?? [];
  const categoryOptions = settlementMeta?.expense_categories.map((category) => ({
    value: category.id,
    label: category.name,
    keywords: category.cost_type,
  })) ?? [];

  return (
    <main className="min-h-screen bg-neutral-100 p-4 sm:p-6 lg:p-10">
      <div className="mx-auto max-w-[1500px] space-y-6">
        <header className="rounded-3xl border bg-white p-5 shadow-sm sm:p-7">
          <Link href="/dashboard/orders" className="inline-flex items-center gap-2 text-sm font-medium text-neutral-500 transition hover:text-neutral-950"><ArrowLeft className="size-4" />Back to orders</Link>
          <div className="mt-5 flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-400">Sales order</p>
                <StatusBadge status={order.status} />
                {order.source ? <span className="rounded-full border bg-neutral-50 px-2.5 py-1 text-xs font-medium text-neutral-600">{order.source}</span> : null}
              </div>
              <h1 className="mt-2 break-words text-2xl font-semibold tracking-tight sm:text-3xl">{order.order_number}</h1>
              <p className="mt-1 break-words text-sm text-neutral-500">{order.subject || `${order.client_name_snapshot} commercial order`}</p>
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-neutral-500">
                <span>{readableDate(order.order_date)}</span>
                <span>{money(order.total, order.currency)}</span>
                {order.external_order_id ? <span>External ID: <strong className="font-medium text-neutral-700">{order.external_order_id}</strong></span> : null}
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap xl:justify-end">
              {project ? <Link href={`/dashboard/projects/${encodeURIComponent(project.project_id)}`} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border bg-white px-4 text-sm font-semibold"><FolderKanban className="size-4" />Open project</Link> : <Link href={`/dashboard/projects?order_id=${encodeURIComponent(order.id)}`} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border bg-white px-4 text-sm font-semibold"><FolderKanban className="size-4" />Project workspace</Link>}
              {canSettle ? <button type="button" onClick={() => void openSettlement()} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white"><CircleDollarSign className="size-4" />Create invoice & settle</button> : null}
            </div>
          </div>
        </header>

        {message ? <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div> : null}
        {error ? <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

        <BusinessFlow order={order} lead={lead} project={project} settlement={settlement} leadAccessRestricted={leadAccessRestricted} projectAccessRestricted={projectAccessRestricted} />

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)] xl:items-start">
          <div className="space-y-6">
            <section className="rounded-3xl border bg-white p-5 shadow-sm sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400">Execution</p><div className="mt-2"><StatusBadge status={order.status} /></div></div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  {order.status === "confirmed" ? <><button disabled={savingStatus} onClick={() => void changeStatus("in_progress")} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-50"><PlayCircle className="size-4" />Start order</button><button disabled={savingStatus || hasPostedFulfillment} onClick={() => setCancelOpen(true)} className="h-11 rounded-xl border px-4 text-sm font-semibold disabled:opacity-40">Cancel</button></> : null}
                  {order.status === "in_progress" ? <><button disabled={savingStatus || stockRemaining} onClick={() => void changeStatus("completed")} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-50"><CheckCircle2 className="size-4" />{stockRemaining ? "Fulfill stock first" : "Complete order"}</button><button disabled={savingStatus || hasPostedFulfillment} onClick={() => setCancelOpen(true)} className="h-11 rounded-xl border px-4 text-sm font-semibold disabled:opacity-40">Cancel</button></> : null}
                </div>
              </div>
              {order.status === "completed" ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><strong>Order completed.</strong> Execution is final. {financeAccess && settlement?.eligible ? "You can now create the invoice and record settlement from this order." : null}</div> : null}
              {order.status === "cancelled" ? <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><strong>Order cancelled.</strong><p className="mt-1 whitespace-pre-wrap">{order.cancellation_reason ? `Reason: ${order.cancellation_reason}` : "Cancellation reason is unavailable for this older record."}</p></div> : null}
              {hasPostedFulfillment && order.status !== "completed" ? <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Posted stock fulfillment cannot be cancelled directly. A stock return/reversal is required first.</div> : null}
            </section>

            <OrderFulfillmentPanel orderId={order.id} orderNumber={order.order_number} status={order.status} currency={order.currency} items={order.items} disabled={savingStatus} onFulfilled={refreshAfterFulfillment} />

            <section className="overflow-hidden rounded-3xl border bg-white shadow-sm">
              <div className="border-b p-5 sm:p-6"><div className="flex items-center gap-2"><PackageCheck className="size-5" /><h2 className="font-semibold">Order items</h2></div><p className="mt-1 text-sm text-neutral-500">Commercial lines captured on this order.</p></div>
              <div className="space-y-3 p-4 md:hidden">
                {order.items.map((item) => <div key={item.id} className="rounded-2xl border p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-words font-medium">{item.item_name_snapshot}</p><p className="mt-1 break-words text-xs text-neutral-500">{item.description}</p></div><p className="shrink-0 text-sm font-semibold">{money(item.line_total, order.currency)}</p></div><div className="mt-4 grid grid-cols-2 gap-3 text-xs"><Metric label="Quantity" value={`${Number(item.quantity)} ${item.unit_snapshot}`} /><Metric label="Unit price" value={money(item.unit_price, order.currency)} /><Metric label="Discount" value={`${Number(item.discount_percent)}%`} /><Metric label="Tax" value={`${Number(item.tax_rate)}%`} />{item.item_type_snapshot === "stock_item" ? <><Metric label="Fulfilled" value={String(Number(item.fulfilled_quantity || 0))} /><Metric label="Remaining" value={String(Number(item.remaining_quantity || 0))} /></> : null}</div></div>)}
              </div>
              <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[900px] text-sm"><thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-400"><tr><th className="px-5 py-3 text-left font-medium">Item</th><th className="px-3 py-3 text-right font-medium">Qty</th><th className="px-3 py-3 text-right font-medium">Fulfilled</th><th className="px-3 py-3 text-right font-medium">Unit price</th><th className="px-3 py-3 text-right font-medium">Discount</th><th className="px-3 py-3 text-right font-medium">Tax</th><th className="px-5 py-3 text-right font-medium">Total</th></tr></thead><tbody className="divide-y">{order.items.map((item) => <tr key={item.id}><td className="px-5 py-4"><p className="font-medium">{item.item_name_snapshot}</p><p className="mt-1 max-w-xl text-xs text-neutral-500">{item.description}</p></td><td className="px-3 py-4 text-right">{Number(item.quantity)} {item.unit_snapshot}</td><td className="px-3 py-4 text-right">{item.item_type_snapshot === "stock_item" ? `${Number(item.fulfilled_quantity || 0)} / ${Number(item.quantity)}` : "—"}</td><td className="px-3 py-4 text-right">{money(item.unit_price, order.currency)}</td><td className="px-3 py-4 text-right">{Number(item.discount_percent)}%</td><td className="px-3 py-4 text-right">{Number(item.tax_rate)}%</td><td className="px-5 py-4 text-right font-semibold">{money(item.line_total, order.currency)}</td></tr>)}</tbody></table></div>
            </section>

            <section className="grid gap-5 lg:grid-cols-2">
              <Snapshot title="From" name={order.seller_name_snapshot} email={order.seller_email_snapshot} address={order.seller_address_snapshot} tax={order.seller_tax_identifier_snapshot} />
              <Snapshot title="To" name={order.client_name_snapshot} email={order.client_email_snapshot} address={order.client_address_snapshot} tax={order.client_tax_identifier_snapshot} />
            </section>

            {(order.notes || order.terms_conditions || order.internal_notes) ? <section className="rounded-3xl border bg-white p-5 shadow-sm sm:p-6"><div className="flex items-center gap-2"><FileText className="size-5" /><h2 className="font-semibold">Notes & terms</h2></div><div className="mt-5 grid gap-4 lg:grid-cols-3">{order.notes ? <TextBlock label="Client notes" value={order.notes} /> : null}{order.terms_conditions ? <TextBlock label="Terms & conditions" value={order.terms_conditions} /> : null}{order.internal_notes ? <TextBlock label="Internal notes" value={order.internal_notes} /> : null}</div></section> : null}
          </div>

          <aside className="space-y-6 xl:sticky xl:top-6">
            <section className="rounded-3xl border bg-white p-5 shadow-sm sm:p-6">
              <h2 className="font-semibold">Order overview</h2>
              <dl className="mt-5 space-y-3 text-sm">
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

            <section className="rounded-3xl border bg-white p-5 shadow-sm sm:p-6">
              <div className="flex items-center gap-2"><BadgeDollarSign className="size-5" /><h2 className="font-semibold">Commercial value</h2></div>
              <dl className="mt-5 space-y-3 text-sm">
                <AmountRow label="Subtotal" value={money(order.subtotal, order.currency)} />
                <AmountRow label="Discount" value={money(order.discount_total, order.currency)} />
                <AmountRow label="Tax" value={money(order.tax_total, order.currency)} />
                <div className="border-t pt-3"><AmountRow label="Order total" value={money(order.total, order.currency)} strong /></div>
              </dl>
            </section>

            <SettlementCard order={order} settlement={settlement} financeAccess={financeAccess} expenseTotal={settlementExpenseTotal} net={settlementNet} onSettle={canSettle ? openSettlement : undefined} />

            <section className="rounded-3xl border bg-white p-5 shadow-sm sm:p-6">
              <h2 className="font-semibold">Lifecycle</h2>
              <div className="mt-5 space-y-4 text-sm"><Lifecycle label="Confirmed" value={order.confirmed_at} done /><Lifecycle label="Started" value={order.started_at} done={Boolean(order.started_at)} /><Lifecycle label="Completed" value={order.completed_at} done={Boolean(order.completed_at)} /><Lifecycle label="Cancelled" value={order.cancelled_at} done={Boolean(order.cancelled_at)} /></div>
            </section>
          </aside>
        </div>
      </div>

      {cancelOpen ? <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingStatus) setCancelOpen(false); }}><div className="w-full rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-3xl sm:p-6"><div className="flex items-start justify-between gap-4"><div><h2 className="font-semibold">Cancel {order.order_number}</h2><p className="mt-1 text-sm text-neutral-500">A cancellation reason is required and will be kept in the audit trail.</p></div><button disabled={savingStatus} onClick={() => setCancelOpen(false)} className="flex size-9 items-center justify-center rounded-xl border"><X className="size-4" /></button></div><label className="mt-5 block text-sm font-medium">Reason<textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} rows={5} maxLength={1000} className="mt-2 w-full rounded-xl border p-3 text-sm outline-none focus:border-neutral-500" placeholder="Why is this order being cancelled?" /></label><div className="mt-5 flex gap-2"><button disabled={savingStatus} onClick={() => setCancelOpen(false)} className="h-11 flex-1 rounded-xl border text-sm font-semibold">Keep order</button><button disabled={savingStatus || cancelReason.trim().length < 3} onClick={() => void confirmCancellation()} className="h-11 flex-1 rounded-xl bg-red-600 text-sm font-semibold text-white disabled:opacity-40">{savingStatus ? "Cancelling…" : "Cancel order"}</button></div></div></div> : null}

      {settlementOpen ? <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget && !settlementSaving) setSettlementOpen(false); }}><div className="max-h-[100dvh] w-full overflow-y-auto bg-white p-5 shadow-2xl sm:max-h-[90vh] sm:max-w-2xl sm:rounded-3xl sm:p-6"><div className="flex items-start justify-between gap-4 border-b pb-5"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400">Order settlement</p><h2 className="mt-1 text-xl font-semibold">Create invoice & settle</h2><p className="mt-1 text-sm text-neutral-500">Create the internal invoice, record the full payment and optionally record one related expense.</p></div><button disabled={settlementSaving} onClick={() => setSettlementOpen(false)} className="flex size-9 shrink-0 items-center justify-center rounded-xl border"><X className="size-4" /></button></div>{settlementLoading ? <div className="flex min-h-64 items-center justify-center"><Loader2 className="size-6 animate-spin text-neutral-400" /></div> : settlementMeta ? <div className="space-y-5 pt-5"><div className="grid grid-cols-2 gap-3"><Metric label="Order total" value={money(order.total, order.currency)} /><Metric label="Net account increase" value={money(Math.max(0, previewNet), order.currency)} /></div><SearchableSelect label="Receive into" value={settlementAccountId} onValueChange={setSettlementAccountId} options={accountOptions} placeholder={`Select ${order.currency} account / wallet`} searchPlaceholder="Search accounts..." required clearable={false} /><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Settlement date<input type="date" value={settlementDate} onChange={(event) => setSettlementDate(event.target.value)} className="mt-2 h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-neutral-500" /><span className="mt-1 block text-xs text-neutral-400">Leave blank to use the company’s current date.</span></label><label className="block text-sm font-medium">Reference<input value={settlementReference} onChange={(event) => setSettlementReference(event.target.value)} maxLength={180} className="mt-2 h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-neutral-500" placeholder="External order ID or reference" /></label></div><div className="rounded-2xl border bg-neutral-50 p-4"><div className="flex items-center gap-2"><ReceiptText className="size-4" /><p className="font-medium">Optional expense / fee</p></div><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Expense amount<input type="number" min="0" step="0.01" value={expenseAmount} onChange={(event) => setExpenseAmount(event.target.value)} className="mt-2 h-11 w-full rounded-xl border bg-white px-3 text-sm outline-none focus:border-neutral-500" /></label><SearchableSelect label="Expense category" value={expenseCategoryId} onValueChange={setExpenseCategoryId} options={categoryOptions} placeholder="Select category" searchPlaceholder="Search categories..." disabled={previewExpense <= 0} /></div><label className="mt-4 block text-sm font-medium">Expense description<input value={expenseDescription} onChange={(event) => setExpenseDescription(event.target.value)} disabled={previewExpense <= 0} maxLength={500} className="mt-2 h-11 w-full rounded-xl border bg-white px-3 text-sm outline-none disabled:bg-neutral-100 disabled:text-neutral-400" placeholder={`Settlement fee for ${order.order_number}`} /></label></div><label className="flex cursor-pointer items-start gap-3 rounded-2xl border p-4"><input type="checkbox" checked={markInvoiceSent} onChange={(event) => setMarkInvoiceSent(event.target.checked)} className="mt-1 size-4 rounded border-neutral-300" /><span><span className="block text-sm font-medium">Mark invoice as sent to client</span><span className="mt-1 block text-xs leading-5 text-neutral-500">Default is off. This is a record-only marker; this action does not email the invoice.</span></span></label><div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-900">V1 quick settlement supports a settlement account in <strong>{order.currency}</strong>. Cross-currency settlement stays in the existing payment/conversion workflow so exchange-rate data is never guessed.</div>{settlementMeta.accounts.length === 0 ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">No active {order.currency} financial account or wallet is available. Create one in Finance & Accounts before settling this order.</div> : null}{settlementError ? <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{settlementError}</div> : null}<div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:justify-end"><button disabled={settlementSaving} onClick={() => setSettlementOpen(false)} className="h-11 rounded-xl border px-5 text-sm font-semibold">Cancel</button><button disabled={settlementSaving || settlementMeta.accounts.length === 0 || !settlementAccountId} onClick={() => void submitSettlement()} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-neutral-950 px-5 text-sm font-semibold text-white disabled:opacity-40">{settlementSaving ? <Loader2 className="size-4 animate-spin" /> : <HandCoins className="size-4" />}{settlementSaving ? "Creating settlement…" : "Create invoice & settle"}</button></div></div> : <div className="py-6">{settlementError ? <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{settlementError}</div> : null}</div>}</div></div> : null}
    </main>
  );
}

function BusinessFlow({ order, lead, project, settlement, leadAccessRestricted, projectAccessRestricted }: { order: OrderDetail; lead: LeadDetail | null; project: ProjectDetail | null; settlement: SettlementState | null; leadAccessRestricted: boolean; projectAccessRestricted: boolean }) {
  const steps = [
    { label: "Lead", icon: UsersRound, primary: lead?.lead.lead_code || (order.source_lead_id ? "Linked" : "No lead"), secondary: lead ? (lead.lead.company_name || lead.lead.contact_name) : leadAccessRestricted ? "Access restricted" : null, done: Boolean(order.source_lead_id) },
    { label: "Client", icon: UserRound, primary: order.client_name_snapshot, secondary: "Client", done: true, href: `/dashboard/clients/${encodeURIComponent(order.client_id)}` },
    { label: "Quotation", icon: FileText, primary: order.quotation_number || "Manual order", secondary: order.quotation_id ? "Source quotation" : null, done: Boolean(order.quotation_id) },
    { label: "Order", icon: PackageCheck, primary: order.order_number, secondary: statusLabel(order.status), done: true, active: true },
    { label: "Project", icon: FolderKanban, primary: project?.project_number || (projectAccessRestricted ? "Linked" : "Not linked"), secondary: project?.name || (projectAccessRestricted ? "Access restricted" : null), done: Boolean(project || projectAccessRestricted), href: project ? `/dashboard/projects/${encodeURIComponent(project.project_id)}` : undefined },
    { label: "Invoice", icon: ReceiptText, primary: settlement?.invoice_number || "Not created", secondary: settlement?.invoice_status ? statusLabel(settlement.invoice_status) : null, done: Boolean(settlement?.invoice_id), href: settlement?.invoice_id ? "/dashboard/invoices" : undefined },
  ];
  return <section className="rounded-3xl border bg-white p-5 shadow-sm sm:p-6"><div><h2 className="font-semibold">Business flow</h2><p className="mt-1 text-sm text-neutral-500">Trace this sale from acquisition through execution and finance.</p></div><div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{steps.map((step) => { const Icon = step.icon; const content = <div className={`h-full rounded-2xl border p-4 transition ${step.active ? "border-neutral-950 bg-neutral-950 text-white" : step.done ? "bg-neutral-50" : "border-dashed bg-white"}`}><div className="flex items-center justify-between gap-2"><Icon className={`size-4 ${step.active ? "text-white/70" : "text-neutral-400"}`} />{step.done && !step.active ? <CheckCircle2 className="size-3.5 text-emerald-500" /> : null}</div><p className={`mt-4 text-[11px] font-semibold uppercase tracking-[0.12em] ${step.active ? "text-white/45" : "text-neutral-400"}`}>{step.label}</p><p className="mt-1 break-words text-sm font-semibold">{step.primary}</p>{step.secondary ? <p className={`mt-1 break-words text-xs ${step.active ? "text-white/55" : "text-neutral-500"}`}>{step.secondary}</p> : null}</div>; return step.href ? <Link key={step.label} href={step.href} className="block">{content}</Link> : <div key={step.label}>{content}</div>; })}</div></section>;
}

function SettlementCard({ order, settlement, financeAccess, expenseTotal, net, onSettle }: { order: OrderDetail; settlement: SettlementState | null; financeAccess: boolean; expenseTotal: number; net: number | null; onSettle?: () => void }) {
  return <section className="rounded-3xl border bg-white p-5 shadow-sm sm:p-6"><div className="flex items-center gap-2"><CircleDollarSign className="size-5" /><h2 className="font-semibold">Invoice & settlement</h2></div>{!financeAccess ? <p className="mt-4 text-sm text-neutral-500">Your role does not have Finance access. Order execution remains available.</p> : settlement?.invoice_id ? <div className="mt-5 space-y-4"><div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><div className="flex items-center gap-2 text-emerald-800"><CheckCircle2 className="size-4" /><p className="font-semibold">{settlement.invoice_number}</p></div><p className="mt-1 text-sm text-emerald-700">{statusLabel(settlement.invoice_status || "invoice")}{settlement.invoice_sent_to_client ? " · marked sent" : " · internal only"}</p></div><dl className="space-y-3 text-sm"><AmountRow label="Invoice total" value={money(settlement.invoice_total, settlement.currency || order.currency)} /><AmountRow label="Paid" value={money(settlement.invoice_amount_paid, settlement.currency || order.currency)} /><AmountRow label="Received into" value={settlement.account_name || "—"} /><AmountRow label="Payment" value={settlement.payment_number || "—"} />{expenseTotal > 0 ? <AmountRow label="Related expense" value={money(expenseTotal, settlement.currency || order.currency)} /> : null}{net != null ? <div className="border-t pt-3"><AmountRow label="Net account increase" value={money(net, settlement.currency || order.currency)} strong /></div> : null}</dl>{settlement.expenses.length ? <div className="mt-4 space-y-2">{settlement.expenses.map((expense) => <div key={expense.id} className="rounded-xl bg-neutral-50 p-3 text-xs"><div className="flex items-center justify-between gap-3"><span className="font-medium">{expense.expense_number} · {expense.category_name}</span><span>{money(expense.amount, expense.currency)}</span></div></div>)}</div> : null}<Link href="/dashboard/invoices" className="mt-4 inline-flex text-xs font-semibold text-neutral-950 underline-offset-4 hover:underline">Open invoices</Link></div> : <div className="mt-5"><p className="text-sm leading-6 text-neutral-500">{settlement?.reason || (order.status === "completed" ? "Create the order invoice, record payment into an account or wallet, and optionally record a related expense." : "Complete the order before settlement.")}</p>{onSettle ? <button type="button" onClick={onSettle} className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white"><CircleDollarSign className="size-4" />Create invoice & settle</button> : null}</div>}</section>;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = { confirmed: "border-blue-200 bg-blue-50 text-blue-700", in_progress: "border-amber-200 bg-amber-50 text-amber-700", completed: "border-emerald-200 bg-emerald-50 text-emerald-700", cancelled: "border-red-200 bg-red-50 text-red-700", paid: "border-emerald-200 bg-emerald-50 text-emerald-700" };
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${styles[status] ?? "border-neutral-200 bg-neutral-50 text-neutral-600"}`}>{statusLabel(status)}</span>;
}

function InfoRow({ label, value, href }: { label: string; value: string; href?: string }) {
  return <div className="flex items-start justify-between gap-4 rounded-xl bg-neutral-50 px-3 py-2.5"><dt className="shrink-0 text-neutral-500">{label}</dt><dd className="min-w-0 break-words text-right font-medium">{href ? <Link href={href} className="underline-offset-4 hover:underline">{value}</Link> : value}</dd></div>;
}

function AmountRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className="flex items-center justify-between gap-4"><dt className="text-neutral-500">{label}</dt><dd className={strong ? "font-semibold text-neutral-950" : "font-medium"}>{value}</dd></div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-neutral-50 p-3"><p className="text-[11px] uppercase tracking-wide text-neutral-400">{label}</p><p className="mt-1 break-words font-medium text-neutral-800">{value}</p></div>;
}

function Snapshot({ title, name, email, address, tax }: { title: string; name: string; email: string | null; address: string | null; tax: string | null }) {
  return <div className="rounded-3xl border bg-white p-5 shadow-sm sm:p-6"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400">{title}</p><p className="mt-3 font-semibold">{name}</p>{email ? <p className="mt-1 break-all text-sm text-neutral-500">{email}</p> : null}{address ? <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-500">{address}</p> : null}{tax ? <p className="mt-2 text-xs text-neutral-400">Tax ID: {tax}</p> : null}</div>;
}

function TextBlock({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl bg-neutral-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">{label}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-700">{value}</p></div>;
}

function Lifecycle({ label, value, done }: { label: string; value: string | null; done: boolean }) {
  return <div className="flex items-start gap-3"><div className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ${done ? "bg-emerald-100 text-emerald-700" : "bg-neutral-100 text-neutral-300"}`}>{done ? <CheckCircle2 className="size-3.5" /> : <span className="size-1.5 rounded-full bg-current" />}</div><div><p className={done ? "font-medium text-neutral-800" : "text-neutral-400"}>{label}</p><p className="mt-0.5 text-xs text-neutral-400">{done ? readableDate(value) : "Not yet"}</p></div></div>;
}
