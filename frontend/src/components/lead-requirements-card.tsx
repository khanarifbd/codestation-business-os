"use client";

import { Plus, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { SearchableSelect } from "@/components/searchable-select";
import { getApiErrorMessage } from "@/lib/api-error";

type CatalogItem = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  item_type: string;
  unit: string;
  currency: string;
  selling_price: string | number;
  tax_rate: string | number | null;
};

type Interest = {
  id: string;
  product_id: string | null;
  sort_order: number;
  item_name_snapshot: string;
  description: string | null;
  item_type_snapshot: string;
  unit_snapshot: string;
  currency: string;
  quantity: string | number;
  estimated_unit_price: string | number | null;
  notes: string | null;
};

type DraftInterest = {
  product_id: string | null;
  item_name: string;
  item_type: "service" | "non_stock_item";
  unit: string;
  description: string;
  quantity: string;
  estimated_unit_price: string;
  notes: string;
};

const emptyRequirement = (): DraftInterest => ({
  product_id: null,
  item_name: "",
  item_type: "service",
  unit: "unit",
  description: "",
  quantity: "1",
  estimated_unit_price: "",
  notes: "",
});

export function LeadRequirementsCard({
  leadId,
  currency,
  convertedClientId,
}: {
  leadId: string;
  currency: string;
  convertedClientId: string | null;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Interest[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [drafts, setDrafts] = useState<DraftInterest[]>([]);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [interestResponse, catalogResponse] = await Promise.all([
        fetch(`/api/crm/leads/${encodeURIComponent(leadId)}/interests`, { cache: "no-store" }),
        fetch(`/api/crm/catalog-options?currency=${encodeURIComponent(currency)}&limit=200`, { cache: "no-store" }),
      ]);
      const interestPayload = await interestResponse.json().catch(() => null);
      const catalogPayload = await catalogResponse.json().catch(() => null);
      if (!interestResponse.ok) throw new Error(getApiErrorMessage(interestPayload, "Could not load lead requirements"));
      if (!catalogResponse.ok) throw new Error(getApiErrorMessage(catalogPayload, "Could not load products and services"));
      setRows(interestPayload as Interest[]);
      setCatalog(catalogPayload as CatalogItem[]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load lead requirements");
    } finally {
      setLoading(false);
    }
  }, [currency, leadId]);

  useEffect(() => { void load(); }, [load]);

  const sourceOptions = useMemo(() => [
    { value: "custom:service", label: "+ Custom service / project" },
    { value: "custom:non_stock_item", label: "+ Custom non-stock item" },
    ...catalog.map((item) => ({
      value: `catalog:${item.id}`,
      label: `${item.sku} · ${item.name}`,
      keywords: `${item.item_type} ${item.unit} ${item.currency}`,
    })),
  ], [catalog]);

  function beginEdit() {
    setDrafts(rows.length ? rows.map((row) => ({
      product_id: row.product_id,
      item_name: row.item_name_snapshot,
      item_type: row.item_type_snapshot === "non_stock_item" ? "non_stock_item" : "service",
      unit: row.unit_snapshot || "unit",
      description: row.description || row.item_name_snapshot,
      quantity: String(row.quantity || 1),
      estimated_unit_price: row.estimated_unit_price == null ? "" : String(row.estimated_unit_price),
      notes: row.notes || "",
    })) : [emptyRequirement()]);
    setMessage(null);
    setError(null);
    setEditing(true);
  }

  function patch(index: number, values: Partial<DraftInterest>) {
    setDrafts((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...values } : row));
  }

  function chooseSource(index: number, value: string) {
    if (value === "custom:service" || value === "custom:non_stock_item") {
      patch(index, {
        product_id: null,
        item_name: "",
        item_type: value.endsWith("non_stock_item") ? "non_stock_item" : "service",
        unit: value === "custom:service" ? "project" : "unit",
        description: "",
        estimated_unit_price: "",
      });
      return;
    }
    const product = catalog.find((item) => item.id === value.replace("catalog:", ""));
    if (!product) return;
    patch(index, {
      product_id: product.id,
      item_name: product.name,
      item_type: product.item_type === "non_stock_item" ? "non_stock_item" : "service",
      unit: product.unit,
      description: product.description || product.name,
      estimated_unit_price: String(product.selling_price),
    });
  }

  async function save() {
    if (drafts.some((row) => !(row.item_name || row.description).trim() || Number(row.quantity) <= 0)) {
      setError("Complete each requirement name and quantity.");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/crm/leads/${encodeURIComponent(leadId)}/interests`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interests: drafts.map((row) => ({
            product_id: row.product_id,
            item_name: row.item_name || null,
            item_type: row.item_type,
            unit: row.unit || "unit",
            description: row.description || row.item_name || null,
            quantity: Number(row.quantity),
            estimated_unit_price: row.estimated_unit_price === "" ? null : Number(row.estimated_unit_price),
            notes: row.notes.trim() || null,
          })),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not save lead requirements"));
      setRows(payload as Interest[]);
      setEditing(false);
      setMessage("Lead requirements saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save lead requirements");
    } finally {
      setSaving(false);
    }
  }

  return <section className="rounded-2xl border bg-white p-4 sm:p-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h3 className="font-semibold">Interested products & services</h3>
        <p className="mt-1 text-xs leading-5 text-neutral-500">Capture reusable catalog interests or one-time custom requirements. This does not move stock or create accounting entries.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {!editing ? <button type="button" onClick={beginEdit} className="rounded-lg border px-3 py-2 text-xs font-semibold">{rows.length ? "Edit requirements" : "Add requirements"}</button> : null}
        {convertedClientId ? <button type="button" onClick={() => router.push(`/dashboard/quotations?lead_id=${encodeURIComponent(leadId)}`)} className="rounded-lg bg-neutral-950 px-3 py-2 text-xs font-semibold text-white">Create quotation →</button> : null}
      </div>
    </div>

    {!convertedClientId ? <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2.5 text-xs text-amber-700">Convert this lead to a client before creating a quotation. Requirements will remain linked to the lead.</div> : null}
    {error ? <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">{error}</div> : null}
    {message ? <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700">{message}</div> : null}

    {loading ? <div className="mt-4 h-20 animate-pulse rounded-xl bg-neutral-100" /> : editing ? <div className="mt-4 space-y-3">
      {drafts.map((row, index) => {
        const sourceValue = row.product_id ? `catalog:${row.product_id}` : row.item_type === "non_stock_item" ? "custom:non_stock_item" : "custom:service";
        return <div key={index} className="rounded-xl border bg-neutral-50/50 p-3">
          <div className="grid gap-3 lg:grid-cols-[1.5fr_1.4fr_.6fr_.7fr]">
            <SearchableSelect label="Requirement source" value={sourceValue} onValueChange={(value) => chooseSource(index, value)} options={sourceOptions} searchPlaceholder="Search catalog..." />
            <Field label="Requirement name"><input disabled={Boolean(row.product_id)} value={row.item_name} onChange={(event) => patch(index, { item_name: event.target.value })} className="h-10 w-full rounded-lg border px-3 text-sm disabled:bg-neutral-100 disabled:text-neutral-500" /></Field>
            <Field label="Quantity"><input type="number" min="0.0001" step="any" value={row.quantity} onChange={(event) => patch(index, { quantity: event.target.value })} className="h-10 w-full rounded-lg border px-3 text-sm" /></Field>
            <Field label="Unit"><input disabled={Boolean(row.product_id)} value={row.unit} onChange={(event) => patch(index, { unit: event.target.value })} className="h-10 w-full rounded-lg border px-3 text-sm disabled:bg-neutral-100 disabled:text-neutral-500" /></Field>
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-[1.7fr_.8fr_1fr_auto]">
            <Field label="Requirement / scope"><input value={row.description} onChange={(event) => patch(index, { description: event.target.value })} className="h-10 w-full rounded-lg border px-3 text-sm" /></Field>
            <Field label={`Estimated unit value (${currency})`}><input type="number" min="0" step="any" value={row.estimated_unit_price} onChange={(event) => patch(index, { estimated_unit_price: event.target.value })} className="h-10 w-full rounded-lg border px-3 text-sm" /></Field>
            <Field label="Notes"><input value={row.notes} onChange={(event) => patch(index, { notes: event.target.value })} className="h-10 w-full rounded-lg border px-3 text-sm" /></Field>
            <button type="button" disabled={drafts.length === 1} onClick={() => setDrafts((current) => current.filter((_, rowIndex) => rowIndex !== index))} className="mt-6 flex size-10 items-center justify-center rounded-lg border bg-white disabled:opacity-30" title="Remove requirement"><Trash2 className="size-4" /></button>
          </div>
        </div>;
      })}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => setDrafts((current) => [...current, emptyRequirement()])} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold"><Plus className="size-3.5" />Add requirement</button>
        <div className="flex gap-2"><button type="button" disabled={saving} onClick={() => setEditing(false)} className="rounded-lg border px-3 py-2 text-xs font-semibold">Cancel</button><button type="button" disabled={saving} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-lg bg-neutral-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><Save className="size-3.5" />{saving ? "Saving…" : "Save requirements"}</button></div>
      </div>
    </div> : rows.length ? <div className="mt-4 divide-y rounded-xl border">
      {rows.map((row) => <div key={row.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium">{row.item_name_snapshot}</p><p className="mt-0.5 text-xs text-neutral-400">{row.product_id ? "Catalog" : "Custom"} · {row.item_type_snapshot.replaceAll("_", " ")} · {Number(row.quantity)} {row.unit_snapshot}</p>{row.description && row.description !== row.item_name_snapshot ? <p className="mt-1 text-xs text-neutral-500">{row.description}</p> : null}</div><div className="text-left sm:text-right"><p className="text-xs text-neutral-400">Estimated</p><p className="text-sm font-medium">{row.estimated_unit_price == null ? "Not set" : `${row.currency} ${(Number(row.quantity) * Number(row.estimated_unit_price)).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}</p></div></div>)}
    </div> : <div className="mt-4 rounded-xl border border-dashed px-4 py-6 text-center text-xs text-neutral-500">No product, service or custom requirement has been added yet.</div>}
  </section>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-neutral-600"><span className="mb-1.5 block">{label}</span>{children}</label>;
}
