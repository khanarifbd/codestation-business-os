"use client";

import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { CurrencySelect } from "@/components/currency-select";
import { MoneyInput } from "@/components/money-input";
import { SearchableSelect } from "@/components/searchable-select";
import { getApiErrorMessage } from "@/lib/api-error";

type ClientOption = { id: string; client_code: string; display_name: string; currency: string | null; contact_name: string | null };
type EmployeeOption = { id: string; employee_code: string; full_name: string };
type Meta = { default_currency: string; default_tax_calculation_mode: string; default_tax_rate: string | number; employees: EmployeeOption[] };
type CatalogOption = { id: string; sku: string; name: string; description: string | null; item_type: string; unit: string; currency: string; selling_price: string | number; tax_rate: string | number | null };
type DraftItem = { product_id: string | null; item_name: string; item_type: "service" | "non_stock_item"; unit: string; description: string; quantity: string; unit_price: string; discount_percent: string; tax_rate: string };

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
  const router = useRouter();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [catalog, setCatalog] = useState<CatalogOption[]>([]);
  const [clientId, setClientId] = useState("");
  const [subject, setSubject] = useState("");
  const [orderDate, setOrderDate] = useState(today());
  const [currency, setCurrency] = useState("");
  const [taxMode, setTaxMode] = useState("exclusive");
  const [assignedEmployeeId, setAssignedEmployeeId] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [items, setItems] = useState<DraftItem[]>([blankItem()]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const [metaResponse, clientsResponse] = await Promise.all([
          fetch("/api/sales/meta", { cache: "no-store" }),
          fetch("/api/sales/client-options?limit=50", { cache: "no-store" }),
        ]);
        const metaPayload = await metaResponse.json().catch(() => null);
        const clientPayload = await clientsResponse.json().catch(() => null);
        if (!metaResponse.ok) throw new Error(getApiErrorMessage(metaPayload, "Could not load order setup"));
        if (!clientsResponse.ok) throw new Error(getApiErrorMessage(clientPayload, "Could not load clients"));
        const typed = metaPayload as Meta;
        setMeta(typed);
        setCurrency(typed.default_currency);
        setTaxMode(typed.default_tax_calculation_mode);
        setItems([blankItem(Number(typed.default_tax_rate || 0))]);
        setClients(clientPayload as ClientOption[]);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not load order setup");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!currency) return;
    void (async () => {
      try {
        const response = await fetch(`/api/sales/catalog-options?currency=${encodeURIComponent(currency)}&limit=200`, { cache: "no-store" });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not load products and services"));
        setCatalog(payload as CatalogOption[]);
      } catch {
        setCatalog([]);
      }
    })();
  }, [currency]);

  const clientOptions = useMemo(() => clients.map(client => ({ value: client.id, label: `${client.client_code} · ${client.display_name}`, keywords: `${client.display_name} ${client.contact_name ?? ""} ${client.client_code}` })), [clients]);
  const employeeOptions = useMemo(() => (meta?.employees ?? []).map(employee => ({ value: employee.id, label: `${employee.full_name} · ${employee.employee_code}` })), [meta]);
  const sourceOptions = useMemo(() => [{ value: "custom:service", label: "+ Custom service" }, { value: "custom:non_stock_item", label: "+ Custom non-stock item" }, ...catalog.map(item => ({ value: `catalog:${item.id}`, label: `${item.sku} · ${item.name}`, keywords: `${item.item_type} ${item.unit} ${item.currency}` }))], [catalog]);
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
    setError(null);
    if (!clientId) { setError("Select a client."); return; }
    if (!orderDate) { setError("Order date is required."); return; }
    if (items.some(item => !(item.item_name || item.description).trim() || !item.description.trim() || Number(item.quantity) <= 0 || Number(item.unit_price) < 0)) {
      setError("Complete all order items.");
      return;
    }
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
      router.push(`/dashboard/orders?order_id=${encodeURIComponent(payload.id)}`);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create order");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <main className="min-h-screen bg-neutral-100 p-5 sm:p-8 lg:p-10"><div className="mx-auto max-w-6xl"><div className="h-96 animate-pulse rounded-2xl border bg-white" /></div></main>;

  return <main className="min-h-screen bg-neutral-100 p-5 sm:p-8 lg:p-10"><div className="mx-auto max-w-6xl space-y-6">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><Link href="/dashboard/orders" className="inline-flex items-center gap-2 text-sm font-medium text-neutral-500 hover:text-neutral-950"><ArrowLeft className="size-4" />Back to orders</Link><h1 className="mt-3 text-3xl font-semibold tracking-tight">Create manual order</h1><p className="mt-2 text-sm text-neutral-500">Use reusable catalog items or one-time custom work without creating a quotation first.</p></div><div className="rounded-xl border bg-white px-4 py-3 text-right"><p className="text-xs uppercase tracking-wide text-neutral-400">Order total</p><p className="mt-1 text-lg font-semibold">{currency || "—"} {total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p></div></header>
    {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

    <section className="rounded-2xl border bg-white p-5 sm:p-6"><div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <SearchableSelect label="Client" required clearable={false} value={clientId} onValueChange={value => { setClientId(value); const client = clients.find(item => item.id === value); if (client?.currency && client.currency !== currency) changeCurrency(client.currency); }} options={clientOptions} placeholder="Select client" searchPlaceholder="Search client..." />
      <Field label="Subject"><input value={subject} onChange={event => setSubject(event.target.value)} className="h-11 w-full rounded-xl border px-3 text-sm" placeholder="Website development" /></Field>
      <Field label="Order date"><input type="date" value={orderDate} onChange={event => setOrderDate(event.target.value)} className="h-11 w-full rounded-xl border px-3 text-sm" /></Field>
      <CurrencySelect label="Currency" required clearable={false} value={currency} onValueChange={changeCurrency} />
      <Field label="Tax calculation"><select value={taxMode} onChange={event => setTaxMode(event.target.value)} className="h-11 w-full rounded-xl border bg-white px-3 text-sm"><option value="exclusive">Tax exclusive</option><option value="inclusive">Tax inclusive</option></select></Field>
      <SearchableSelect label="Assigned employee" value={assignedEmployeeId} onValueChange={setAssignedEmployeeId} options={employeeOptions} placeholder="Unassigned" searchPlaceholder="Search employee..." />
    </div></section>

    <section className="rounded-2xl border bg-white"><div className="flex items-center justify-between border-b p-5"><div><h2 className="font-semibold">Order lines</h2><p className="mt-1 text-sm text-neutral-500">Catalog is optional. Custom projects and services can be entered directly.</p></div><button type="button" onClick={() => setItems(current => [...current, blankItem(Number(meta?.default_tax_rate || 0))])} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium"><Plus className="size-4" />Add line</button></div>
      <div className="space-y-3 p-4 sm:p-5">{items.map((item, index) => { const sourceValue = item.product_id ? `catalog:${item.product_id}` : item.item_type === "non_stock_item" ? "custom:non_stock_item" : "custom:service"; return <div key={index} className="rounded-2xl border p-4"><div className="grid gap-4 lg:grid-cols-[1.4fr_1.4fr_.7fr_.7fr]"><SearchableSelect label="Source" value={sourceValue} onValueChange={value => selectSource(index, value)} options={sourceOptions} searchPlaceholder="Search products and services..." /><Field label="Item / service name"><input disabled={Boolean(item.product_id)} value={item.item_name} onChange={event => updateItem(index, { item_name: event.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm disabled:bg-neutral-50 disabled:text-neutral-500" /></Field><Field label="Quantity"><input type="number" min="0.0001" step="any" value={item.quantity} onChange={event => updateItem(index, { quantity: event.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm" /></Field><Field label="Unit"><input disabled={Boolean(item.product_id)} value={item.unit} onChange={event => updateItem(index, { unit: event.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm disabled:bg-neutral-50 disabled:text-neutral-500" /></Field></div><div className="mt-4 grid gap-4 lg:grid-cols-[2fr_.9fr_.7fr_.7fr_auto]"><Field label="Description"><input value={item.description} onChange={event => updateItem(index, { description: event.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm" /></Field><Field label="Unit price"><MoneyInput value={item.unit_price} onChange={value => updateItem(index, { unit_price: value })} currency={currency} /></Field><Field label="Discount %"><input type="number" min="0" max="100" step="0.01" value={item.discount_percent} onChange={event => updateItem(index, { discount_percent: event.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm" /></Field><Field label="Tax %"><input type="number" min="0" max="100" step="0.01" value={item.tax_rate} onChange={event => updateItem(index, { tax_rate: event.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm" /></Field><div className="flex items-end gap-3"><div className="pb-2 text-right"><p className="text-xs text-neutral-400">Line total</p><p className="mt-1 whitespace-nowrap font-semibold">{currency} {lineTotal(item, taxMode).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p></div><button type="button" disabled={items.length === 1} onClick={() => setItems(current => current.filter((_, itemIndex) => itemIndex !== index))} className="flex size-10 items-center justify-center rounded-lg border disabled:opacity-30"><Trash2 className="size-4" /></button></div></div></div>; })}</div>
    </section>

    <section className="grid gap-4 lg:grid-cols-3"><Field label="Client notes"><textarea value={notes} onChange={event => setNotes(event.target.value)} className="min-h-28 w-full rounded-xl border p-3 text-sm" /></Field><Field label="Terms & conditions"><textarea value={terms} onChange={event => setTerms(event.target.value)} className="min-h-28 w-full rounded-xl border p-3 text-sm" /></Field><Field label="Internal notes"><textarea value={internalNotes} onChange={event => setInternalNotes(event.target.value)} className="min-h-28 w-full rounded-xl border p-3 text-sm" /></Field></section>
    <div className="flex justify-end gap-3"><Link href="/dashboard/orders" className="rounded-xl border bg-white px-5 py-2.5 text-sm font-medium">Cancel</Link><button disabled={saving} onClick={() => void submit()} className="rounded-xl bg-neutral-950 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? "Creating…" : "Create order"}</button></div>
  </div></main>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm"><span className="mb-1.5 block font-medium text-neutral-600">{label}</span>{children}</label>;
}
