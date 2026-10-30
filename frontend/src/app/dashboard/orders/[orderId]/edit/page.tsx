"use client";

import { useDashboardSession } from "@/components/dashboard-session-context";

import { exactSalesPayload, exactSalesLinePreview } from "@/lib/exact-sales-decimal";
import { formatMoneyExact, salesTotalsPreview } from "@/lib/sales-money-preview";
import "@/components/commercial/order-field-focus.css";

/* Native exits intentionally preserve the full-document boundary used by the unsaved-changes guard. */

import { ArrowLeft, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";
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
type LeadOption = { id: string; lead_code: string; company_name: string | null; contact_name: string; source_name: string | null; status_name: string; converted_client_id: string | null };
type LeadPage = { items: LeadOption[]; next_cursor: string | null };
type EditState = { order_id: string; can_edit: boolean; reason: string | null };

type OrderItem = {
  product_id: string | null;
  item_name_snapshot: string;
  item_type_snapshot: string;
  unit_snapshot: string;
  description: string;
  quantity: string | number;
  unit_price: string | number;
  discount_percent: string | number;
  tax_rate: string | number;
};

type OrderDetail = {
  id: string;
  order_number: string;
  quotation_id: string | null;
  client_id: string;
  client_name_snapshot: string;
  source_lead_id: string | null;
  assigned_employee_id: string | null;
  source: string | null;
  external_order_id: string | null;
  subject: string | null;
  status: string;
  order_date: string;
  currency: string;
  tax_calculation_mode: string;
  notes: string | null;
  terms_conditions: string | null;
  internal_notes: string | null;
  items: OrderItem[];
};

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

const blankItem = (taxRate = 0): DraftItem => ({ product_id: null, item_name: "", item_type: "service", unit: "unit", description: "", quantity: "1", unit_price: "0", discount_percent: "0", tax_rate: String(taxRate) });

function lineTotal(item: DraftItem, taxMode: string) {
  return exactSalesLinePreview(item, taxMode)?.total ?? "invalid";
}

export default function EditOrderPage() {
  const { tenant } = useDashboardSession();
  const canManageOrders = Boolean(tenant?.is_owner || tenant?.permissions.some(p => p === "*" || p === "orders.manage"));
  const params = useParams<{ orderId: string }>();
  const orderId = params.orderId;

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [leads, setLeads] = useState<LeadOption[]>([]);
  const [catalog, setCatalog] = useState<CatalogOption[]>([]);
  const [crmRestricted, setCrmRestricted] = useState(false);

  const [clientId, setClientId] = useState("");
  const [sourceLeadId, setSourceLeadId] = useState("");
  const [subject, setSubject] = useState("");
  const [orderDate, setOrderDate] = useState("");
  const [currency, setCurrency] = useState("");
  const [taxMode, setTaxMode] = useState("exclusive");
  const [assignedEmployeeId, setAssignedEmployeeId] = useState("");
  const [orderSource, setOrderSource] = useState("");
  const [externalOrderId, setExternalOrderId] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [items, setItems] = useState<DraftItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const loadRequestRef = useRef(0);
  const saveInFlightRef = useRef(false);
  const [cleanSnapshot, setCleanSnapshot] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const returnHref = orderReturnHref(searchParams.toString());
  const draftSnapshot = JSON.stringify({ clientId, sourceLeadId, subject, orderDate, currency, taxMode, assignedEmployeeId, orderSource, externalOrderId, notes, terms, internalNotes, items });
  const hasChanges = !loading && Boolean(meta) && Boolean(order) && Boolean(editState?.can_edit) && (saving || (cleanSnapshot !== null && cleanSnapshot !== draftSnapshot));
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
      setOrder(null);
      setEditState(null);
      setCrmRestricted(false);
      setLeads([]);
      setError(null);
      try {
        const [orderResponse, stateResponse, metaResponse, clientsResponse] = await Promise.all([
          fetch(`/api/sales/orders/${encodeURIComponent(orderId)}`, { cache: "no-store" }),
          fetch(`/api/sales/orders/${encodeURIComponent(orderId)}/manual-edit-state`, { cache: "no-store" }),
          fetch("/api/sales/meta", { cache: "no-store" }),
          fetch("/api/sales/client-options?limit=100", { cache: "no-store" }),
        ]);

        const orderPayload = await orderResponse.json().catch(() => null);
        const statePayload = await stateResponse.json().catch(() => null);
        const metaPayload = await metaResponse.json().catch(() => null);
        const clientsPayload = await clientsResponse.json().catch(() => null);
        if (!orderResponse.ok) throw new Error(getApiErrorMessage(orderPayload, "Could not load order"));
        if (!stateResponse.ok) throw new Error(getApiErrorMessage(statePayload, "Could not load order edit status"));
        if (!metaResponse.ok) throw new Error(getApiErrorMessage(metaPayload, "Could not load order setup"));
        if (!clientsResponse.ok) throw new Error(getApiErrorMessage(clientsPayload, "Could not load clients"));

        if (!isCurrent()) return;
        const currentOrder = orderPayload as OrderDetail;
        setOrder(currentOrder);
        setEditState(statePayload as EditState);
        setMeta(metaPayload as Meta);
        setClients(clientsPayload as ClientOption[]);
        const loadedItems: DraftItem[] = currentOrder.items.map((item) => ({
          product_id: item.product_id,
          item_name: item.item_name_snapshot,
          item_type: item.item_type_snapshot === "non_stock_item" ? "non_stock_item" : "service",
          unit: item.unit_snapshot || "unit",
          description: item.description,
          quantity: String(item.quantity),
          unit_price: String(item.unit_price),
          discount_percent: String(item.discount_percent || 0),
          tax_rate: String(item.tax_rate || 0),
        }));
        const loadedDraft = {
          clientId: currentOrder.client_id,
          sourceLeadId: currentOrder.source_lead_id || "",
          subject: currentOrder.subject || "",
          orderDate: currentOrder.order_date,
          currency: currentOrder.currency,
          taxMode: currentOrder.tax_calculation_mode || "exclusive",
          assignedEmployeeId: currentOrder.assigned_employee_id || "",
          orderSource: currentOrder.source || "",
          externalOrderId: currentOrder.external_order_id || "",
          notes: currentOrder.notes || "",
          terms: currentOrder.terms_conditions || "",
          internalNotes: currentOrder.internal_notes || "",
          items: loadedItems,
        };
        setClientId(loadedDraft.clientId);
        setSourceLeadId(loadedDraft.sourceLeadId);
        setSubject(loadedDraft.subject);
        setOrderDate(loadedDraft.orderDate);
        setCurrency(loadedDraft.currency);
        setTaxMode(loadedDraft.taxMode);
        setAssignedEmployeeId(loadedDraft.assignedEmployeeId);
        setOrderSource(loadedDraft.orderSource);
        setExternalOrderId(loadedDraft.externalOrderId);
        setNotes(loadedDraft.notes);
        setTerms(loadedDraft.terms);
        setInternalNotes(loadedDraft.internalNotes);
        setItems(loadedDraft.items);
        setCleanSnapshot(JSON.stringify(loadedDraft));

        const leadsResponse = await fetch("/api/crm/leads?converted=true&limit=100", { cache: "no-store" });
        if (!isCurrent()) return;
        if (leadsResponse.status === 403) {
          setCrmRestricted(true);
        } else {
          const leadsPayload = await leadsResponse.json().catch(() => null);
          if (!leadsResponse.ok) throw new Error(getApiErrorMessage(leadsPayload, "Could not load converted leads"));
          if (isCurrent()) setLeads((leadsPayload as LeadPage).items);
        }
      } catch (reason) {
        if (!isCurrent()) return;
        setError(reason instanceof Error ? reason.message : "Could not load order");
      } finally {
        if (isCurrent()) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [orderId]);

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

  const canEdit = canManageOrders && Boolean(editState?.can_edit);
  const clientOptions = useMemo(() => clients.map((client) => ({ value: client.id, label: `${client.client_code} · ${client.display_name}`, keywords: `${client.display_name} ${client.contact_name ?? ""} ${client.client_code}` })), [clients]);
  const employeeOptions = useMemo(() => (meta?.employees ?? []).map((employee) => ({ value: employee.id, label: `${employee.full_name} · ${employee.employee_code}` })), [meta]);
  const convertedLeads = useMemo(() => leads.filter((lead) => lead.converted_client_id === clientId), [clientId, leads]);
  const leadOptions = useMemo(() => convertedLeads.map((lead) => ({ value: lead.id, label: `${lead.lead_code} · ${lead.company_name || lead.contact_name}`, keywords: `${lead.contact_name} ${lead.company_name || ""} ${lead.source_name || ""} ${lead.status_name}` })), [convertedLeads]);
  const lineSourceOptions = useMemo(() => [{ value: "custom:service", label: "+ Custom service" }, { value: "custom:non_stock_item", label: "+ Custom non-stock item" }, ...catalog.map((item) => ({ value: `catalog:${item.id}`, label: `${item.sku} · ${item.name}`, keywords: `${item.item_type} ${item.unit} ${item.currency}` }))], [catalog]);
  const totals = useMemo(() => salesTotalsPreview(items.map(item => exactSalesLinePreview(item, taxMode))), [items, taxMode]);
  const total = totals.total;

  function updateItem(index: number, patch: Partial<DraftItem>) {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  function selectItemSource(index: number, value: string) {
    if (value === "custom:service" || value === "custom:non_stock_item") {
      updateItem(index, { product_id: null, item_name: "", item_type: value.endsWith("non_stock_item") ? "non_stock_item" : "service", unit: "unit", description: "", unit_price: "0" });
      return;
    }
    const product = catalog.find((item) => item.id === value.replace("catalog:", ""));
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
    if (value === currency) return;
    setCurrency(value);
    if (items.some((item) => item.product_id)) {
      setItems([blankItem(Number(meta?.default_tax_rate || 0))]);
      setNotice("Currency changed. Catalog-linked lines were cleared so items from different currencies cannot be mixed.");
    }
  }

  function changeClient(value: string) {
    if (value === clientId) return;
    setClientId(value);
    const matches = leads.filter((lead) => lead.converted_client_id === value);
    setSourceLeadId(matches.length === 1 ? matches[0].id : "");
    const client = clients.find((item) => item.id === value);
    if (client?.currency && client.currency !== currency) changeCurrency(client.currency);
  }

  async function save() {
    if (saveInFlightRef.current || loading || !order || !canEdit) return;
    setError(null);
    setNotice(null);
    if (!clientId) { setError("Select a client."); return; }
    if (!orderDate) { setError("Order date is required."); return; }
    if (!items.length || items.some((item) => !(item.item_name || item.description).trim() || !item.description.trim() || !exactSalesPayload(item) || !exactSalesLinePreview(item, taxMode))) {
      setError("Complete all order items with valid quantities, prices and percentages (up to four decimal places).");
      return;
    }

    if (Object.values(totals).some(value => value === "")) { setError("Order totals exceed the supported accounting range. Review the line amounts."); return; }
    saveInFlightRef.current = true;
    setSaving(true);
    try {
      const response = await fetch(`/api/sales/orders/${encodeURIComponent(order.id)}/manual`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          source_lead_id: sourceLeadId || null,
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
          items: items.map((item) => ({
            product_id: item.product_id,
            item_name: item.item_name || item.description,
            item_type: item.item_type,
            unit: item.unit || "unit",
            description: item.description.trim(),
            ...exactSalesPayload(item)!,
          })),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not update order"));
      if (!mountedRef.current) return;
      setCleanSnapshot(draftSnapshot);
      navigation.markClean();
      navigation.navigate(orderDocumentHref(order.id, "view", returnHref), { discard: true });
    } catch (reason) {
      if (!mountedRef.current) return;
      setError(reason instanceof Error ? reason.message : "Could not update order");
    } finally {
      saveInFlightRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  }

  if (loading) {
    return <main className="order-editor-page"><div className="order-editor-loading" role="status" aria-label="Loading order editor"><div className="h-96 animate-pulse rounded-3xl border bg-white" /></div></main>;
  }

  if (!order) {
    return <main className="order-editor-page"><div className="order-editor-unavailable" role="alert"><p className="text-sm text-red-600">{error || "Order not found."}</p><a href={returnHref} className="mt-4 inline-flex text-sm font-semibold underline">Back to orders</a></div></main>;
  }

  const detailHref = orderDocumentHref(order.id, "view", returnHref);

  return <main className="order-editor-page">
    <div className="order-editor-content">
      <div className="order-editor-back"><a href={detailHref} className="inline-flex items-center gap-2 text-sm font-medium text-neutral-500 hover:text-neutral-950"><ArrowLeft className="size-4" />Back to order</a></div>
      <RelationshipHeader eyebrow="SALES / MANUAL ORDER" title={`Edit ${order.order_number}`} description="Update the manual order while it is still safe to change its commercial details." />

      {!canManageOrders ? <p role="status" className="order-editor-notice">Read-only order. Editing requires order management permission.</p> : null}
      {!canEdit && editState?.reason ? <div role="status" className="order-editor-notice order-editor-notice-locked"><strong>Order locked.</strong> {editState.reason}</div> : null}
      {notice ? <div role="status" className="order-editor-notice order-editor-notice-info">{notice}</div> : null}
      {error ? <div role="alert" className="order-editor-notice order-editor-notice-error">{error}</div> : null}

      {saving ? <div className="order-editor-notice order-editor-notice-info" role="status">Saving… If you leave now, check the order before retrying because the result may be uncertain.</div> : null}
      <div className="order-editor-composition">
      <OrderEditorSummary amount={<>{formatMoneyExact(total || "invalid", currency || "—")}</>} currency={currency} date={orderDate} taxMode={taxMode} status={<span className="order-editor-status">{order.status.replaceAll("_", " ")}</span>} />
      <div className="order-editor-main">
      <section className="order-editor-section order-editor-setup">
        <OrderEditorSectionHeading number="01" title="Client & order details" description="Set the client, source, currency and ownership for this order." />
        <div className="order-editor-fields">
          <SearchableSelect label="Client" required clearable={false} disabled={!canEdit || saving} value={clientId} onValueChange={changeClient} options={clientOptions} placeholder="Select client" searchPlaceholder="Search client..." />
          {crmRestricted ? <Field label="Source lead"><div className="flex h-11 items-center rounded-xl border bg-neutral-50 px-3 text-sm text-neutral-500">{sourceLeadId ? "Linked CRM lead · access restricted" : "No source lead linked"}</div></Field> : <SearchableSelect label="Source lead" disabled={!canEdit || saving} value={sourceLeadId} onValueChange={setSourceLeadId} options={leadOptions} placeholder="No source lead" searchPlaceholder="Search converted leads..." />}
          <Field label="Subject"><input disabled={!canEdit || saving} value={subject} onChange={(event) => setSubject(event.target.value)} className="h-11 w-full rounded-xl border px-3 text-sm disabled:bg-neutral-50 disabled:text-neutral-500" placeholder="Website development" /></Field>
          <Field label="Order date"><input disabled={!canEdit || saving} type="date" value={orderDate} onChange={(event) => setOrderDate(event.target.value)} className="h-11 w-full rounded-xl border px-3 text-sm disabled:bg-neutral-50 disabled:text-neutral-500" /></Field>
          <SearchableSelect label="Order source" disabled={!canEdit || saving} value={orderSource} onValueChange={setOrderSource} options={ORDER_SOURCE_OPTIONS} placeholder="Select or type source" searchPlaceholder="Search or type source..." allowCustom />
          <Field label="External order ID"><input disabled={!canEdit || saving} maxLength={180} value={externalOrderId} onChange={(event) => setExternalOrderId(event.target.value)} className="h-11 w-full rounded-xl border px-3 text-sm disabled:bg-neutral-50 disabled:text-neutral-500" placeholder="Fiverr / Upwork / platform reference" /><p className="mt-1 text-xs text-neutral-400">Optional external marketplace or platform reference.</p></Field>
          <CurrencySelect label="Currency" required clearable={false} disabled={!canEdit || saving} value={currency} onValueChange={changeCurrency} />
          <Field label="Tax calculation"><select disabled={!canEdit || saving} value={taxMode} onChange={(event) => setTaxMode(event.target.value)} className="h-11 w-full rounded-xl border bg-white px-3 text-sm disabled:bg-neutral-50 disabled:text-neutral-500"><option value="exclusive">Tax exclusive</option><option value="inclusive">Tax inclusive</option></select></Field>
          <SearchableSelect label="Assigned employee" disabled={!canEdit || saving} value={assignedEmployeeId} onValueChange={setAssignedEmployeeId} options={employeeOptions} placeholder="Unassigned" searchPlaceholder="Search employee..." />
        </div>
        {!crmRestricted && clientId ? <p className="mt-4 text-xs leading-5 text-neutral-400">Source Lead only shows CRM leads converted to the selected client. This prevents cross-client sales lineage.</p> : null}
      </section>

      <section className="order-editor-section order-editor-lines"><OrderEditorSectionHeading number="02" title="Order lines" description="Update services, quantities, rates, discounts and taxes before execution begins." actions={<button disabled={!canEdit || saving} type="button" onClick={() => setItems((current) => [...current, blankItem(Number(meta?.default_tax_rate || 0))])} className="inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium disabled:opacity-40"><Plus className="size-4" />Add line</button>} />
        <div className="order-editor-lines-content">{items.map((item, index) => { const sourceValue = item.product_id ? `catalog:${item.product_id}` : item.item_type === "non_stock_item" ? "custom:non_stock_item" : "custom:service"; return <div key={index} className="order-editor-line"><header className="order-editor-line-header"><span>Line {index + 1}</span><span>{item.product_id ? "Catalog item" : "Custom item"}</span></header><div className="order-editor-line-identity"><SearchableSelect label="Item source" disabled={!canEdit || saving} value={sourceValue} onValueChange={(value) => selectItemSource(index, value)} options={lineSourceOptions} searchPlaceholder="Search products and services..." /><Field label="Item / service name"><input disabled={!canEdit || saving || Boolean(item.product_id)} value={item.item_name} onChange={(event) => updateItem(index, { item_name: event.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm disabled:bg-neutral-50 disabled:text-neutral-500" /></Field><Field label="Quantity"><input disabled={!canEdit || saving} type="number" min="0.0001" step="any" value={item.quantity} onChange={(event) => updateItem(index, { quantity: event.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm disabled:bg-neutral-50 disabled:text-neutral-500" /></Field><Field label="Unit"><input disabled={!canEdit || saving || Boolean(item.product_id)} value={item.unit} onChange={(event) => updateItem(index, { unit: event.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm disabled:bg-neutral-50 disabled:text-neutral-500" /></Field></div><div className="order-editor-line-pricing"><Field label="Description"><input disabled={!canEdit || saving} value={item.description} onChange={(event) => updateItem(index, { description: event.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm disabled:bg-neutral-50 disabled:text-neutral-500" /></Field><Field label="Unit price"><MoneyInput step={0.0001} disabled={!canEdit || saving} value={item.unit_price} onChange={(value) => updateItem(index, { unit_price: value })} currency={currency} /></Field><Field label="Discount %"><input disabled={!canEdit || saving} type="number" min="0" max="100" step="0.01" value={item.discount_percent} onChange={(event) => updateItem(index, { discount_percent: event.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm disabled:bg-neutral-50 disabled:text-neutral-500" /></Field><Field label="Tax %"><input disabled={!canEdit || saving} type="number" min="0" max="100" step="0.01" value={item.tax_rate} onChange={(event) => updateItem(index, { tax_rate: event.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm disabled:bg-neutral-50 disabled:text-neutral-500" /></Field><div className="order-editor-line-total"><div><p className="text-xs text-neutral-400">Line total</p><p className="mt-1 whitespace-nowrap font-semibold">{formatMoneyExact(lineTotal(item, taxMode), currency)}</p></div><button type="button" disabled={!canEdit || saving || items.length === 1} onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="flex size-10 items-center justify-center rounded-lg border disabled:opacity-30"><Trash2 className="size-4" aria-hidden="true" /><span className="sr-only">Remove line {index + 1}</span></button></div></div></div>; })}</div>
      </section>

      <section className="order-editor-section order-editor-notes"><OrderEditorSectionHeading number="03" title="Notes & terms" description="Keep client-facing notes, commercial terms and internal context distinct." /><div className="order-editor-notes-fields"><Field label="Client notes"><textarea disabled={!canEdit || saving} value={notes} onChange={(event) => setNotes(event.target.value)} className="min-h-28 w-full rounded-xl border p-3 text-sm disabled:bg-neutral-50 disabled:text-neutral-500" /></Field><Field label="Terms & conditions"><textarea disabled={!canEdit || saving} value={terms} onChange={(event) => setTerms(event.target.value)} className="min-h-28 w-full rounded-xl border p-3 text-sm disabled:bg-neutral-50 disabled:text-neutral-500" /></Field><Field label="Internal notes"><textarea disabled={!canEdit || saving} value={internalNotes} onChange={(event) => setInternalNotes(event.target.value)} className="min-h-28 w-full rounded-xl border p-3 text-sm disabled:bg-neutral-50 disabled:text-neutral-500" /></Field></div></section>
      </div></div>

      <footer className="order-editor-footer"><p>{canEdit ? "Review your updates before saving." : "This order is read-only."}</p><div className="order-editor-footer-actions"><a href={detailHref} className="inline-flex h-11 items-center justify-center rounded-xl border bg-white px-5 text-sm font-medium">Cancel</a>{canEdit ? <button disabled={saving} onClick={() => void save()} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-neutral-950 px-5 text-sm font-medium text-white disabled:opacity-50">{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}{saving ? "Saving…" : "Save changes"}</button> : null}</div></footer>
    </div>
  </main>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="order-editor-field"><span className="mb-1.5 block font-medium text-neutral-600">{label}</span>{children}</label>;
}
