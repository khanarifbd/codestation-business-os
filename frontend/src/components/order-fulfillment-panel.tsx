"use client";

import { useDashboardSession } from "@/components/dashboard-session-context";

import { History, Loader2, PackageCheck, RotateCcw, Truck, Warehouse as WarehouseIcon } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getApiErrorMessage } from "@/lib/api-error";
import "@/components/commercial/order-detail.css";

export type FulfillmentOrderItem = {
  id: string;
  product_id: string | null;
  item_name_snapshot: string;
  sku_snapshot: string | null;
  item_type_snapshot: string;
  unit_snapshot: string;
  quantity: string | number;
  fulfilled_quantity: string | number;
  remaining_quantity: string | number;
};

type Warehouse = {
  id: string;
  code: string;
  name: string;
  is_default: boolean;
  is_active: boolean;
};

type FulfillmentItem = {
  id: string;
  order_item_id: string;
  product_id: string;
  item_name: string;
  sku: string | null;
  quantity: string | number;
  currency: string;
  base_currency: string;
  unit_cost: string | number;
  total_cost: string | number;
  unit_cost_base: string | number;
  total_cost_base: string | number;
  effective_rate_to_base: string | number;
};

type Fulfillment = {
  id: string;
  fulfillment_number: string;
  order_id: string;
  warehouse_id: string;
  warehouse_name: string;
  fulfillment_date: string;
  status: string;
  reference: string | null;
  currency: string;
  base_currency: string;
  total_cogs: string | number;
  total_cogs_base: string | number;
  reversal_date: string | null;
  reversal_reason: string | null;
  reversed_at: string | null;
  items: FulfillmentItem[];
  created_at: string;
};

const today = () => new Date().toISOString().slice(0, 10);
const quantityText = (value: string | number) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 4 });
const money = (value: string | number, currency: string) => `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const operationKey = (prefix: string) => typeof crypto !== "undefined" && "randomUUID" in crypto
  ? `${prefix}-${crypto.randomUUID()}`
  : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

class FulfillmentRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
type PendingOperation = { signature: string; key: string; confirmed: boolean; beforeStock: string; resultLabel: string; orderId: string; url: string; body: string; reversing: boolean };

export function OrderFulfillmentPanel({
  orderId,
  status,
  items,
  disabled = false,
  onFulfilled,
}: {
  orderId: string;
  orderNumber: string;
  status: string;
  currency: string;
  items: FulfillmentOrderItem[];
  disabled?: boolean;
  onFulfilled: (fulfillmentNumber: string) => Promise<void>;
}) {
  const { tenant } = useDashboardSession();
  const canManageOrders = Boolean(tenant?.is_owner || tenant?.permissions.some(p => p === "*" || p === "orders.manage"));
  const stockItems = useMemo(
    () => items.filter((item) => item.item_type_snapshot === "stock_item" && item.product_id),
    [items],
  );
  const remainingItems = useMemo(
    () => stockItems.filter((item) => Number(item.remaining_quantity || 0) > 0),
    [stockItems],
  );
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [history, setHistory] = useState<Fulfillment[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [fulfillmentDate, setFulfillmentDate] = useState(today());
  const [reference, setReference] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reversing, setReversing] = useState(false);
  const [reverseId, setReverseId] = useState<string | null>(null);
  const [reverseDate, setReverseDate] = useState(today());
  const [reverseReason, setReverseReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmedBeforeStock, setConfirmedBeforeStock] = useState<string | null>(null);
  const [readbackComplete, setReadbackComplete] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const inFlight = useRef(false);
  const operation = useRef<PendingOperation | null>(null);
  const stockSnapshot = JSON.stringify(stockItems.map(item => [item.id, Number(item.fulfilled_quantity), Number(item.remaining_quantity)]).sort((left, right) => String(left[0]).localeCompare(String(right[0]))));
  const refreshRequired = confirmedBeforeStock !== null && (!readbackComplete || stockSnapshot === confirmedBeforeStock);

  const request = useCallback(async (url: string, init?: RequestInit) => {
    const response = await fetch(url, { cache: "no-store", ...init });
    const text = await response.text();
    let payload: unknown = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { detail: "Unexpected server response" }; }
    if (!response.ok) throw new FulfillmentRequestError(getApiErrorMessage(payload, "Fulfillment request failed"), response.status);
    return payload;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [warehousePayload, historyPayload] = await Promise.all([
        request("/api/inventory/warehouses"),
        request(`/api/sales/orders/${encodeURIComponent(orderId)}/fulfillments`),
      ]);
      const activeWarehouses = (warehousePayload as Warehouse[]).filter((item) => item.is_active);
      setWarehouses(activeWarehouses);
      setHistory(historyPayload as Fulfillment[]);
      setWarehouseId((current) => current || activeWarehouses.find((item) => item.is_default)?.id || activeWarehouses[0]?.id || "");
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load fulfillment data.");
      return false;
    } finally {
      setLoading(false);
    }
  }, [orderId, request]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const item of remainingItems) next[item.id] = String(item.remaining_quantity);
    setQuantities(next);
  }, [orderId, remainingItems]);

  function prepareOperation(url: string, body: string, prefix: string) {
    const signature = JSON.stringify([orderId, url, body]);
    let previous = operation.current;
    // A resolved callback is not enough: fresh stock props and history must both arrive.
    if (previous?.confirmed && readbackComplete && stockSnapshot !== previous.beforeStock) {
      operation.current = null;
      previous = null;
    }
    if (previous?.confirmed) {
      setError("This stock action was saved. Refresh its status before another action; do not post it again.");
      return null;
    }
    if (previous && previous.signature !== signature) {
      setError("The previous stock action has an uncertain outcome. Retry the unchanged request with its retained key, or verify fulfillment history before reloading and starting a different action.");
      return null;
    }
    const next = previous ?? { signature, key: operationKey(prefix), confirmed: false, beforeStock: stockSnapshot, resultLabel: "Fulfillment", orderId, url, body, reversing: prefix === "fulfill-reverse" };
    operation.current = next;
    setConfirmedBeforeStock(null);
    setReadbackComplete(false);
    return next;
  }

  async function refreshSavedStatus() {
    const pending = operation.current;
    if (!pending?.confirmed) return false;
    try {
      await onFulfilled(pending.resultLabel);
      if (!await load()) throw new Error("Fulfillment history could not be refreshed.");
      setReadbackComplete(true);
      return true;
    } catch {
      setError("The stock action was saved, but its latest status could not be refreshed. Retry status refresh; do not submit the stock action again.");
      return false;
    }
  }

  function writeFailed(reason: unknown) {
    // Explicit validation/access rejections do not represent a committed posting.
    // Network failures, server errors and conflicts retain the exact operation key.
    if (reason instanceof FulfillmentRequestError && [400, 401, 403, 404, 422].includes(reason.status)) {
      operation.current = null;
      setUncertain(false);
    } else setUncertain(true);
    setError(reason instanceof Error ? reason.message : "The stock action could not be confirmed. Verify history before retrying.");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canManageOrders || disabled || inFlight.current || refreshRequired) return;
    if (!warehouseId) {
      setError("Choose a warehouse before fulfillment.");
      return;
    }
    const lines = remainingItems
      .map((item) => ({ order_item_id: item.id, quantity: Number(quantities[item.id] || 0) }))
      .filter((item) => item.quantity > 0);
    if (lines.length === 0) {
      setError("Enter at least one fulfillment quantity.");
      return;
    }
    for (const line of lines) {
      const source = remainingItems.find((item) => item.id === line.order_item_id);
      if (source && line.quantity > Number(source.remaining_quantity)) {
        setError(`${source.item_name_snapshot} exceeds the remaining order quantity.`);
        return;
      }
    }

    const url = `/api/sales/orders/${encodeURIComponent(orderId)}/fulfillments`;
    const body = JSON.stringify({ warehouse_id: warehouseId, fulfillment_date: fulfillmentDate, reference: reference.trim() || null, items: lines });
    const pending = prepareOperation(url, body, "fulfill");
    if (!pending) return;
    await performOperation(pending);
  }

  function beginReverse(entry: Fulfillment) {
    if (!canManageOrders || disabled || inFlight.current || refreshRequired) return;
    setReverseId(entry.id);
    setReverseDate(today());
    setReverseReason("");
    setError(null);
    setMessage(null);
  }

  async function reverse(entry: Fulfillment) {
    if (!canManageOrders || disabled || inFlight.current || refreshRequired) return;
    const reason = reverseReason.trim();
    if (reason.length < 3) {
      setError("Enter a clear reversal reason (at least 3 characters).");
      return;
    }
    const url = `/api/sales/orders/${encodeURIComponent(orderId)}/fulfillments/${encodeURIComponent(entry.id)}/reverse`;
    const body = JSON.stringify({ reversal_date: reverseDate, reason });
    const pending = prepareOperation(url, body, "fulfill-reverse");
    if (!pending) return;
    await performOperation(pending);
  }

  async function performOperation(pending: PendingOperation) {
    if (!canManageOrders || disabled || inFlight.current || pending.confirmed || pending.orderId !== orderId) return;
    inFlight.current = true;
    if (pending.reversing) setReversing(true); else setSaving(true);
    setError(null); setMessage(null);
    try {
      const result = await request(pending.url, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": pending.key }, body: pending.body }) as Fulfillment;
      pending.confirmed = true;
      const number = result?.fulfillment_number || "Fulfillment";
      pending.resultLabel = pending.reversing ? `${number} reversed` : number;
      setUncertain(false); setConfirmedBeforeStock(pending.beforeStock);
      if (pending.reversing) {
        setReverseId(null); setReverseReason("");
        setMessage(`${number} reversed. Stock and COGS were restored using the original carrying cost.`);
      } else {
        setReference("");
        setMessage(`${number} posted. Stock and COGS were updated together.`);
      }
      await refreshSavedStatus();
    } catch (reason) {
      if (pending.confirmed) setError("This stock action was saved. Refresh status; do not post it again.");
      else writeFailed(reason);
    } finally { inFlight.current = false; setSaving(false); setReversing(false); }
  }

  async function retryUnchanged() {
    const pending = operation.current;
    if (uncertain && pending && !pending.confirmed) await performOperation(pending);
  }

  if (stockItems.length === 0) {
    return (
      <section className="order-fulfillment-empty">
        <div className="flex items-start gap-3">
          <PackageCheck className="mt-0.5 size-5 text-neutral-400" />
          <div><p className="font-semibold">No stock fulfillment required</p><p className="mt-1 text-sm text-neutral-500">This order contains services or non-stock items only. Inventory and COGS are not affected.</p></div>
        </div>
      </section>
    );
  }

  return (
    <section className="order-fulfillment">
      <div className="order-fulfillment-header">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Stock execution</p><h3 className="mt-1 font-semibold">Fulfill / Dispatch</h3><p className="mt-1 text-sm text-neutral-500">Stock moves only when fulfillment is posted. COGS uses the stored inventory carrying cost.</p></div>
          <Truck className="size-5 shrink-0 text-neutral-400" />
        </div>
      </div>

      <div className="order-fulfillment-body">
        <div className="order-stock-ledger" aria-label="Stock quantities">
          {stockItems.map((item) => (
            <div key={item.id} className="order-stock-row">
              <div className="order-stock-identity"><p>{item.item_name_snapshot}</p><span>{item.sku_snapshot || "Stock item"}</span></div>
              <div className="order-stock-quantities">
                <Metric label="Ordered" value={quantityText(item.quantity)} />
                <Metric label="Fulfilled" value={quantityText(item.fulfilled_quantity)} />
                <Metric label="Remaining" value={quantityText(item.remaining_quantity)} strong={Number(item.remaining_quantity) > 0} />
              </div>
            </div>
          ))}
        </div>

        {error ? <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
        {message ? <div role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}

        {uncertain ? <div role="status" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><p>The last stock action may already have completed. An unchanged retry reuses the original request and operation key in this page, not any newly edited fields. Verify fulfillment history before reloading or starting a different action; no automatic retry is performed.</p><button type="button" disabled={!canManageOrders || disabled || saving || reversing || loading} onClick={() => void retryUnchanged()} className="mt-3 min-h-11 rounded-lg border bg-white px-4 font-semibold disabled:opacity-50">Retry unchanged stock action</button></div> : null}
        {refreshRequired ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><p>The stock action is saved. Further actions stay locked until fresh stock quantities and history are loaded.</p><button type="button" disabled={saving || reversing || loading} onClick={() => void refreshSavedStatus()} className="mt-3 min-h-11 rounded-lg border bg-white px-4 font-semibold disabled:opacity-50">Refresh saved status</button></div> : null}

        {loading ? <div role="status" aria-label="Loading fulfillment" className="flex min-h-28 items-center justify-center"><Loader2 className="size-5 animate-spin text-neutral-400" /></div> : !canManageOrders ? <p role="status" className="mt-4 text-sm text-neutral-500">Read-only fulfillment history. Posting or reversing requires order management permission.</p> : remainingItems.length > 0 && status !== "completed" && status !== "cancelled" ? (
          <form onSubmit={submit} className="order-dispatch-form"><fieldset disabled={disabled || saving || reversing || refreshRequired} className="contents">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium">Warehouse<select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border bg-white px-3 text-sm outline-none focus:border-neutral-500"><option value="">Select warehouse</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name} ({warehouse.code}){warehouse.is_default ? " · Default" : ""}</option>)}</select></label>
              <label className="text-sm font-medium">Fulfillment date<input type="date" value={fulfillmentDate} onChange={(event) => setFulfillmentDate(event.target.value)} className="mt-2 h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-neutral-500" /></label>
            </div>
            <label className="block text-sm font-medium">Reference <span className="font-normal text-neutral-400">(optional)</span><input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Delivery note, courier or dispatch reference" className="mt-2 h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-neutral-500" /></label>
            <div className="space-y-2">
              {remainingItems.map((item) => (
                <div key={item.id} className="order-dispatch-line">
                  <div><p className="text-sm font-semibold">{item.item_name_snapshot}</p><p className="mt-1 text-xs text-neutral-400">Remaining {quantityText(item.remaining_quantity)} {item.unit_snapshot}</p></div>
                  <label className="text-xs font-medium text-neutral-500">Dispatch now<input type="number" min="0" max={Number(item.remaining_quantity)} step="0.0001" value={quantities[item.id] ?? ""} onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))} className="mt-1 h-10 w-full rounded-lg border px-3 text-right text-sm outline-none focus:border-neutral-500" /></label>
                </div>
              ))}
            </div>
            {warehouses.length === 0 ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700"><WarehouseIcon className="mr-2 inline size-4" />Create an active warehouse in Inventory before dispatching stock.</div> : null}
            <button disabled={disabled || saving || !warehouseId || warehouses.length === 0} type="submit" className="order-dispatch-submit disabled:opacity-50"><PackageCheck className="size-4" />{saving ? "Posting fulfillment..." : "Post fulfillment"}</button>
          </fieldset></form>
        ) : remainingItems.length === 0 ? <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700"><strong>All stock items fulfilled.</strong> The order can now be completed.</div> : null}

        <div className="order-fulfillment-history">
          <div className="flex items-center gap-2"><History className="size-4 text-neutral-400" /><h4 className="text-sm font-semibold">Fulfillment history</h4></div>
          {history.length === 0 ? <p className="mt-3 text-sm text-neutral-400">No stock has been dispatched for this order yet.</p> : <div className="mt-3 space-y-3">{history.map((entry) => {
            const reversed = entry.status === "reversed";
            const reversingThis = reverseId === entry.id;
            return (
              <article key={entry.id} className="order-fulfillment-entry" data-reversed={reversed || undefined}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">{entry.fulfillment_number}</p><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${reversed ? "bg-neutral-200 text-neutral-600" : "bg-emerald-100 text-emerald-700"}`}>{reversed ? "Reversed" : "Posted"}</span></div>
                    <p className="mt-1 text-xs text-neutral-400">{entry.fulfillment_date} · {entry.warehouse_name}{entry.reference ? ` · ${entry.reference}` : ""}</p>
                    {reversed ? <p className="mt-2 text-xs text-neutral-500">Reversed {entry.reversal_date || "—"}{entry.reversal_reason ? ` · ${entry.reversal_reason}` : ""}</p> : null}
                  </div>
                  <div className="text-left sm:text-right"><p className="text-xs text-neutral-400">Inventory cost {reversed ? "restored" : "issued"}</p><p className="mt-1 text-sm font-semibold">{money(entry.total_cogs, entry.currency)}</p>{entry.base_currency !== entry.currency ? <p className="mt-0.5 text-xs text-neutral-500">Reporting: {money(entry.total_cogs_base, entry.base_currency)}</p> : null}</div>
                </div>
                <dl className="order-fulfillment-item-ledger">{entry.items.map((item) => <div key={item.id}><dt>{item.item_name}</dt><dd>{quantityText(item.quantity)}</dd></div>)}</dl>
                {canManageOrders && !reversed && status !== "cancelled" ? <div className="mt-4 border-t pt-3">
                  {!reversingThis ? <button disabled={disabled || saving || reversing || refreshRequired} type="button" onClick={() => beginReverse(entry)} className="flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold text-neutral-700 disabled:opacity-50"><RotateCcw className="size-3.5" />Reverse fulfillment</button> : <div className="space-y-3 rounded-xl bg-amber-50 p-3">
                    <p className="text-xs leading-5 text-amber-800">Reversal returns the exact dispatched quantity and historical carrying cost, and reverses the COGS journal. This action is auditable.</p>
                    <div className="grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)]">
                      <label className="text-xs font-medium text-neutral-600">Reversal date<input type="date" value={reverseDate} onChange={(event) => setReverseDate(event.target.value)} className="mt-1 h-10 w-full rounded-lg border bg-white px-2 text-sm outline-none" /></label>
                      <label className="text-xs font-medium text-neutral-600">Reason<input value={reverseReason} onChange={(event) => setReverseReason(event.target.value)} placeholder="Why is this dispatch being reversed?" className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm outline-none" /></label>
                    </div>
                    <div className="flex flex-wrap gap-2"><button disabled={saving || reversing || refreshRequired || reverseReason.trim().length < 3} type="button" onClick={() => void reverse(entry)} className="flex h-9 items-center gap-2 rounded-lg bg-neutral-950 px-3 text-xs font-semibold text-white disabled:opacity-50">{reversing ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}{reversing ? "Reversing..." : "Confirm reversal"}</button><button disabled={reversing} type="button" onClick={() => { setReverseId(null); setReverseReason(""); }} className="h-9 rounded-lg border bg-white px-3 text-xs font-semibold disabled:opacity-50">Keep fulfillment</button></div>
                  </div>}
                </div> : null}
              </article>
            );
          })}</div>}
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div><p className="text-neutral-400">{label}</p><p className={`mt-1 ${strong ? "font-semibold text-amber-700" : "font-medium text-neutral-700"}`}>{value}</p></div>;
}
