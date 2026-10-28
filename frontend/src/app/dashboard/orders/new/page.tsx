"use client";

/* Native exits intentionally preserve the full-document boundary used by the unsaved-changes guard. */

import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { CurrencySelect } from "@/components/currency-select";
import { MoneyInput } from "@/components/money-input";
import { SearchableSelect } from "@/components/searchable-select";
import { getApiErrorMessage } from "@/lib/api-error";
import { useDocumentNavigationGuard } from "@/hooks/use-document-navigation-guard";
import { orderDocumentHref, orderReturnHref } from "@/lib/order-navigation";
import { RelationshipHeader } from "@/components/relationships/relationship-ui";
import { OrderEditorSectionHeading, OrderEditorSummary } from "@/components/commercial/order-editor-ui";
import "@/components/commercial/order-editor.css";

type ClientOption = { id: string; client_code: string; display_name: string; currency: string | null; contact_name: string | null };
type EmployeeOption = { id: string; employee_code: string; full_name: string };
type Meta = { default_currency: string; default_tax_calculation_mode: string; default_tax_rate: string | number; employees: EmployeeOption[] };
type CatalogOption = { id: string; sku: string; name: string; description: string | null; item_type: string; unit: string; currency: string; selling_price: string | number; tax_rate: string | number | null };
type DraftItem = { product_id: string | null; item_name: string; item_type: "service" | "non_stock_item"; unit: string; description: string; quantity: string; unit_price: string; discount_percent: string; tax_rate: string };

const ORDER_SOURCE_OPTIONS = [
  { value: "fiverr", label: "Fiverr" },
  { value: "upwork", label: "Upwork" },
  { value: "website", label: "Website" },
  { value: "referral", label: "Referral" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "facebook", label: "Facebook" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "direct", label: "Direct" },
  { value: "freelancer", label: "Freelancer.com" },
  { value: "peopleperhour", label: "PeoplePerHour" },
  { value: "contra", label: "Contra" },
  { value: "toptal", label: "Toptal" },
  { value: "other", label: "Other" },
];

const today = () => new Date().toISOString().slice(0, 10);
const blankItem = (taxRate = 0): DraftItem => ({ product_id: null, item_name: "", item_type: "service", unit: "unit", description: "", quantity: "1", unit_price: "0", discount_percent: "0", tax_rate: String(taxRate) });

function lineTotal(item: DraftItem, taxMode: string) {
  const quantity = Number(item.quantity || 0);
  const price = Number(item.unit_price || 0);
  const discountRate = Number(item.discount_percent || 0) / 100;
  const taxRate = Number(item.tax_rate || 0) / 100;
  const subtotal = quantity * price;
  const afterDiscount = Math.max(0, subtotal - subtotal * discountRate);
  if (taxMode === "inclusive") return afterDiscount;
  return afterDiscount + afterDiscount * taxRate;
}

export default function NewManualOrderPage() {
  // Keep the initial date and defaults stable while asynchronous setup is loading.
  const [initialDraft] = useState(() => ({
    clientId: "", subject: "", orderDate: today(), currency: "", taxMode: "exclusive",
    assignedEmployeeId: "", orderSource: "", externalOrderId: "", notes: "", terms: "",
    internalNotes: "", items: [blankItem()],
  }));
  const [meta, setMeta] = useState<Meta | null>(null);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [catalog, setCatalog] = useState<CatalogOption[]>([]);
  const [clientId, setClientId] = useState(initialDraft.clientId);
  const [subject, setSubject] = useState(initialDraft.subject);
  const [orderDate, setOrderDate] = useState(initialDraft.orderDate);
  const [currency, setCurrency] = useState(initialDraft.currency);
  const [taxMode, setTaxMode] = useState(initialDraft.taxMode);
  const [assignedEmployeeId, setAssignedEmployeeId] = useState(initialDraft.assignedEmployeeId);
  const [orderSource, setOrderSource] = useState(initialDraft.orderSource);
  const [externalOrderId, setExternalOrderId] = useState(initialDraft.externalOrderId);
  const [notes, setNotes] = useState(initialDraft.notes);
  const [terms, setTerms] = useState(initialDraft.terms);
  const [internalNotes, setInternalNotes] = useState(initialDraft.internalNotes);
  const [items, setItems] = useState<DraftItem[]>(initialDraft.items);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const loadRequestRef = useRef(0);
  const saveInFlightRef = useRef(false);
  const [cleanSnapshot, setCleanSnapshot] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const returnHref = orderReturnHref(searchParams.toString());
  const draftSnapshot = JSON.stringify({ clientId, subject, orderDate, currency, taxMode, assignedEmployeeId, orderSource, externalOrderId, notes, terms, internalNotes, items });
  const hasChanges = !loading && Boolean(meta) && (saving || (cleanSnapshot !== null && cleanSnapshot !== draftSnapshot));
  const navigation = useDocumentNavigationGuard(hasChanges, { documentLabel: "order", isBusy: saving });

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; loadRequestRef.current += 1; };
  }, []);

  useEffect(() => {
    let active = true;
    const request = ++loadRequestRef.current;
    const isCurrent = () => active && mountedRef.current && request === loadRequestRef.current;
    void (async () => {
      setLoading(true);
      setCleanSnapshot(null);
      try {
        const [metaResponse, clientsResponse] = await Promise.all([
          fetch("/api/sales/meta", { cache: "no-store" }),
          fetch("/api/sales/client-options?limit=50", { cache: "no-store" }),
        ]);
        const metaPayload = await metaResponse.json().catch(() => null);
        const clientPayload = await clientsResponse.json().catch(() => null);
        if (!metaResponse.ok) throw new Error(getApiErrorMessage(metaPayload, "Could not load order setup"));
        if (!clientsResponse.ok) throw new Error(getApiErrorMessage(clientPayload, "Could not load clients"));
        if (!isCurrent()) return;
        const typed = metaPayload as Meta;
        const loadedDraft = {
          ...initialDraft,
          currency: typed.default_currency,
          taxMode: typed.default_tax_calculation_mode,
          items: [blankItem(Number(typed.default_tax_rate || 0))],
        };
        setMeta(typed);
        setCurrency(loadedDraft.currency);
        setTaxMode(loadedDraft.taxMode);
        setItems(loadedDraft.items);
        setClients(clientPayload as ClientOption[]);
        setCleanSnapshot(JSON.stringify(loadedDraft));
      } catch (reason) {
        if (!isCurrent()) return;
        setError(reason instanceof Error ? reason.message : "Could not load order setup");
      } finally {
        if (isCurrent()) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [initialDraft]);

  useEffect(() => {
    if (!currency) return;
    let active = true;
    setCatalog([]);
    void (async () => {
      try {
        const response = await fetch(`/api/sales/catalog-options?currency=${encodeURIComponent(currency)}&limit=200`, { cache: "no-store" });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not load products and services"));
        if (active && mountedRef.current) setCatalog(payload as CatalogOption[]);
      } catch {
        if (active && mountedRef.current) setCatalog([]);
      }
    })();
    return () => { active = false; };
  }, [currency]);

  const clientOptions = useMemo(() => clients.map(client => ({ value: client.id, label: `${client.client_code} · ${client.display_name}`, keywords: `${client.display_name} ${client.contact_name ?? ""} ${client.client_code}` })), [clients]);
  const employeeOptions = useMemo(() => (meta?.employees ?? []).map(employee => ({ value: employee.id, label: `${employee.full_name} · ${employee.employee_code}` })), [meta]);
  const lineSourceOptions = useMemo(() => [{ value: "custom:service", label: "+ Custom service" }, { value: "custom:non_stock_item", label: "+ Custom non-stock item" }, ...catalog.map(item => ({ value: `catalog:${item.id}`, label: `${item.sku} · ${item.name}`, keywords: `${item.item_type} ${item.unit} ${item.currency}` }))], [catalog]);
  const total = useMemo(() => items.reduce((sum, item) => sum + lineTotal(item, taxMode), 0), [items, taxMode]);

  function updateItem(index: number, patch: Partial<DraftItem>) {
    setItems(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  function selectSource(index: number, value: string) {
    if (value === "custom:service" || value === "custom:non_stock_item") {
      updateItem(index, { product_id: null, item_name: "", item_type: value.endsWith("non_stock_item") ? "non_stock_item" : "service", unit: "unit", description: "", unit_price: "0" });
      return;
    }
    const product = catalog.find(item => item.id === value.replace("catalog:", ""));
    if (!product) return;
    updateItem(index, {
      product_id: product.id,
      item_name: product.name,
      item_type: product.item_type === "non_stock_item" ? "non_stock_item" : "service",
      unit: product.unit,
      description: product.description || product.name,
      unit_price: String(product.selling_price),
      tax_rate: String(product.tax_rate ?? 0),
    });
  }

  function changeCurrency(value: string) {
    setCurrency(value);
    if (items.some(item => item.product_id)) {
      setItems([blankItem(Number(meta?.default_tax_rate || 0))]);
      setError("Currency changed. Catalog lines were cleared so items from different currencies cannot be mixed.");
    }
  }

  async function submit() {
    if (saveInFlightRef.current || loading || !meta) return;
    setError(null);
    if (!clientId) { setError("Select a client."); return; }
    if (!orderDate) { setError("Order date is required."); return; }
    if (items.some(item => !(item.item_name || item.description).trim() || !item.description.trim() || Number(item.quantity) <= 0 || Number(item.unit_price) < 0)) {
      setError("Complete all order items.");
      return;
    }
    saveInFlightRef.current = true;
    setSaving(true);
    try {
      const response = await fetch("/api/sales/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          subject: subject.trim() || null,
          order_date: orderDate,
          currency,
          tax_calculation_mode: taxMode,
          assigned_employee_id: assignedEmployeeId || null,
          source: orderSource.trim() || null,
          external_order_id: externalOrderId.trim() || null,
          notes: notes.trim() || null,
          terms_conditions: terms.trim() || null,
          internal_notes: internalNotes.trim() || null,
          items: items.map(item => ({
            product_id: item.product_id,
            item_name: item.item_name || item.description,
            item_type: item.item_type,
            unit: item.unit || "unit",
            description: item.description.trim(),
            quantity: Number(item.quantity),
            unit_price: Number(item.unit_price),
            discount_percent: Number(item.discount_percent || 0),
            tax_rate: Number(item.tax_rate || 0),
          })),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not create order"));
      if (!mountedRef.current) return;
      setCleanSnapshot(draftSnapshot);
      navigation.markClean();
      navigation.navigate(orderDocumentHref(payload.id, "view", returnHref), { discard: true, replace: true });
    } catch (reason) {
      if (!mountedRef.current) return;
      setError(reason instanceof Error ? reason.message : "Could not create order");
    } finally {
      saveInFlightRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  }

  if (loading) return <main className="order-editor-page"><div className="order-editor-loading" role="status" aria-label="Loading order editor"><div className="h-96 animate-pulse rounded-2xl border bg-white" /></div></main>;

  if (!meta) return <main className="order-editor-page"><div className="order-editor-unavailable" role="alert"><h1>Order setup unavailable</h1><p>{error || "Could not load order setup."}</p><a href={returnHref}>Back to orders</a></div></main>;

  return <main className="order-editor-page"><div className="order-editor-content">
    <div className="order-editor-back"><a href={returnHref} className="inline-flex items-center gap-2 text-sm font-medium text-neutral-500 hover:text-neutral-950"><ArrowLeft className="size-4" />Back to orders</a></div>
      <RelationshipHeader eyebrow="SALES / MANUAL ORDER" title="Create manual order" description="Use reusable catalog items or one-time custom work without creating a quotation first." />
    {error ? <div role="alert" className="order-editor-notice order-editor-notice-error">{error}</div> : null}

    {saving ? <div className="order-editor-notice order-editor-notice-info" role="status">Saving… If you leave now, check the order before retrying because the result may be uncertain.</div> : null}
    <div className="order-editor-composition">
      <OrderEditorSummary amount={<>{currency || "—"} {total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>} currency={currency} date={orderDate} taxMode={taxMode} />
      <div className="order-editor-main">
      <section className="order-editor-section order-editor-setup"><OrderEditorSectionHeading number="01" title="Client & order details" description="Set the client, source, currency and ownership for this order." /><div className="order-editor-fields">
      <SearchableSelect disabled={saving} label="Client" required clearable={false} value={clientId} onValueChange={value => { setClientId(value); const client = clients.find(item => item.id === value); if (client?.currency && client.currency !== currency) changeCurrency(client.currency); }} options={clientOptions} placeholder="Select client" searchPlaceholder="Search client..." />
      <Field label="Subject"><input disabled={saving} value={subject} onChange={event => setSubject(event.target.value)} className="h-11 w-full rounded-xl border px-3 text-sm" placeholder="Website development" /></Field>
      <Field label="Order date"><input disabled={saving} type="date" value={orderDate} onChange={event => setOrderDate(event.target.value)} className="h-11 w-full rounded-xl border px-3 text-sm" /></Field>
      <SearchableSelect disabled={saving} label="Order source" value={orderSource} onValueChange={setOrderSource} options={ORDER_SOURCE_OPTIONS} placeholder="Select or type source" searchPlaceholder="Search or type source..." allowCustom />
      <Field label="External order ID"><input disabled={saving} maxLength={180} value={externalOrderId} onChange={event => setExternalOrderId(event.target.value)} className="h-11 w-full rounded-xl border px-3 text-sm" placeholder="Fiverr / Upwork / platform reference" /><p className="mt-1 text-xs text-neutral-400">Optional reference used to match this Business OS order with the original platform order.</p></Field>
      <CurrencySelect disabled={saving} label="Currency" required clearable={false} value={currency} onValueChange={changeCurrency} />
      <Field label="Tax calculation"><select disabled={saving} value={taxMode} onChange={event => setTaxMode(event.target.value)} className="h-11 w-full rounded-xl border bg-white px-3 text-sm"><option value="exclusive">Tax exclusive</option><option value="inclusive">Tax inclusive</option></select></Field>
      <SearchableSelect disabled={saving} label="Assigned employee" value={assignedEmployeeId} onValueChange={setAssignedEmployeeId} options={employeeOptions} placeholder="Unassigned" searchPlaceholder="Search employee..." />
    </div></section>

    <section className="order-editor-section order-editor-lines"><OrderEditorSectionHeading number="02" title="Order lines" description="Catalog is optional. Custom projects and services can be entered directly." actions={<button disabled={saving} type="button" onClick={() => setItems(current => [...current, blankItem(Number(meta?.default_tax_rate || 0))])} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium"><Plus className="size-4" />Add line</button>} />
        <div className="order-editor-lines-content">{items.map((item, index) => { const sourceValue = item.product_id ? `catalog:${item.product_id}` : item.item_type === "non_stock_item" ? "custom:non_stock_item" : "custom:service"; return <div key={index} className="order-editor-line"><header className="order-editor-line-header"><span>Line {index + 1}</span><span>{item.product_id ? "Catalog item" : "Custom item"}</span></header><div className="order-editor-line-identity"><SearchableSelect disabled={saving} label="Item source" value={sourceValue} onValueChange={value => selectSource(index, value)} options={lineSourceOptions} searchPlaceholder="Search products and services..." /><Field label="Item / service name"><input disabled={saving || Boolean(item.product_id)} value={item.item_name} onChange={event => updateItem(index, { item_name: event.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm disabled:bg-neutral-50 disabled:text-neutral-500" /></Field><Field label="Quantity"><input disabled={saving} type="number" min="0.0001" step="any" value={item.quantity} onChange={event => updateItem(index, { quantity: event.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm" /></Field><Field label="Unit"><input disabled={saving || Boolean(item.product_id)} value={item.unit} onChange={event => updateItem(index, { unit: event.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm disabled:bg-neutral-50 disabled:text-neutral-500" /></Field></div><div className="order-editor-line-pricing"><Field label="Description"><input disabled={saving} value={item.description} onChange={event => updateItem(index, { description: event.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm" /></Field><Field label="Unit price"><MoneyInput disabled={saving} value={item.unit_price} onChange={value => updateItem(index, { unit_price: value })} currency={currency} /></Field><Field label="Discount %"><input disabled={saving} type="number" min="0" max="100" step="0.01" value={item.discount_percent} onChange={event => updateItem(index, { discount_percent: event.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm" /></Field><Field label="Tax %"><input disabled={saving} type="number" min="0" max="100" step="0.01" value={item.tax_rate} onChange={event => updateItem(index, { tax_rate: event.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm" /></Field><div className="order-editor-line-total"><div><p className="text-xs text-neutral-400">Line total</p><p className="mt-1 whitespace-nowrap font-semibold">{currency} {lineTotal(item, taxMode).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p></div><button type="button" disabled={saving || items.length === 1} onClick={() => setItems(current => current.filter((_, itemIndex) => itemIndex !== index))} className="flex size-10 items-center justify-center rounded-lg border disabled:opacity-30"><Trash2 className="size-4" aria-hidden="true" /><span className="sr-only">Remove line {index + 1}</span></button></div></div></div>; })}</div>
    </section>

    <section className="order-editor-section order-editor-notes"><OrderEditorSectionHeading number="03" title="Notes & terms" description="Keep client-facing notes, commercial terms and internal context distinct." /><div className="order-editor-notes-fields"><Field label="Client notes"><textarea disabled={saving} value={notes} onChange={event => setNotes(event.target.value)} className="min-h-28 w-full rounded-xl border p-3 text-sm" /></Field><Field label="Terms & conditions"><textarea disabled={saving} value={terms} onChange={event => setTerms(event.target.value)} className="min-h-28 w-full rounded-xl border p-3 text-sm" /></Field><Field label="Internal notes"><textarea disabled={saving} value={internalNotes} onChange={event => setInternalNotes(event.target.value)} className="min-h-28 w-full rounded-xl border p-3 text-sm" /></Field></div></section>
      </div></div>
    <footer className="order-editor-footer"><p>Review the details, then create the order.</p><div className="order-editor-footer-actions"><a href={returnHref} className="rounded-xl border bg-white px-5 py-2.5 text-sm font-medium">Cancel</a><button disabled={saving} onClick={() => void submit()} className="rounded-xl bg-neutral-950 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? "Creating…" : "Create order"}</button></div></footer>
  </div></main>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="order-editor-field"><span className="mb-1.5 block font-medium text-neutral-600">{label}</span>{children}</label>;
}
