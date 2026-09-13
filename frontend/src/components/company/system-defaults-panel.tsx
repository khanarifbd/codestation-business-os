"use client";

import { FormEvent, useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";

import { SearchableSelect, type SearchOption } from "@/components/searchable-select";
import { COUNTRY_OPTIONS, LANGUAGE_OPTIONS } from "@/lib/company-options";

type Defaults = {
  default_client_country_code: string | null;
  default_client_currency: string | null;
  default_document_language: string;
  default_lead_status: string;
  default_project_status: string;
  default_order_status: string;
  default_invoice_status: string;
  quotation_validity_days: number;
};

type CrmMeta = { statuses: { name: string; slug: string; is_active: boolean }[] };

const PROJECT_STATUS_OPTIONS: SearchOption[] = [
  { value: "planned", label: "Planned" },
  { value: "active", label: "Active" },
];
const ORDER_STATUS_OPTIONS: SearchOption[] = [
  { value: "draft", label: "Draft" },
  { value: "confirmed", label: "Confirmed" },
];
const INVOICE_STATUS_OPTIONS: SearchOption[] = [
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
];

export function SystemDefaultsPanel() {
  const [form, setForm] = useState<Defaults | null>(null);
  const [leadStatuses, setLeadStatuses] = useState<SearchOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [settingsResponse, crmResponse] = await Promise.all([
          fetch("/api/company-settings/system-defaults", { cache: "no-store" }),
          fetch("/api/crm/meta", { cache: "no-store" }),
        ]);
        const payload = await settingsResponse.json().catch(() => null);
        if (!settingsResponse.ok) throw new Error(payload?.detail ?? "Unable to load system defaults.");
        setForm(payload as Defaults);
        if (crmResponse.ok) {
          const crm = await crmResponse.json() as CrmMeta;
          setLeadStatuses(crm.statuses.filter((item) => item.is_active).map((item) => ({ value: item.slug, label: item.name })));
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Unable to load system defaults.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/company-settings/system-defaults", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to save system defaults.");
      setForm(payload as Defaults);
      setMessage("System defaults saved. New records will use these values; historical records are unchanged.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save system defaults.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="flex min-h-64 items-center justify-center"><Loader2 className="size-6 animate-spin text-neutral-400" /></div>;
  if (!form) return <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error ?? "System defaults unavailable."}</div>;

  const leadOptions = leadStatuses.length ? leadStatuses : [{ value: form.default_lead_status, label: form.default_lead_status }];

  return <form onSubmit={save} className="space-y-6">
    <div>
      <h3 className="font-semibold">System defaults</h3>
      <p className="mt-1 text-sm text-neutral-500">Defaults for new business records. Client currency is managed in Currencies & FX so all currency choices stay together.</p>
    </div>

    <div className="grid gap-5 md:grid-cols-2">
      <SearchableSelect label="Default client country" name="country" value={form.default_client_country_code} onValueChange={(value) => setForm({ ...form, default_client_country_code: value || null })} options={COUNTRY_OPTIONS} placeholder="Select country" searchPlaceholder="Search country..." />
      <SearchableSelect label="Document language" name="language" value={form.default_document_language} onValueChange={(value) => setForm({ ...form, default_document_language: value })} options={LANGUAGE_OPTIONS} placeholder="Select language" searchPlaceholder="Search language..." />
      <label className="block"><span className="text-sm font-semibold">Quotation validity days</span><input type="number" min={1} max={365} value={form.quotation_validity_days} onChange={(event) => setForm({ ...form, quotation_validity_days: Number(event.target.value) })} className="mt-2 h-11 w-full rounded-xl border px-3 text-sm" /></label>
      <SearchableSelect label="Default lead status" name="lead" value={form.default_lead_status} onValueChange={(value) => setForm({ ...form, default_lead_status: value })} options={leadOptions} placeholder="Select status" />
      <SearchableSelect label="Default project status" name="project" value={form.default_project_status} onValueChange={(value) => setForm({ ...form, default_project_status: value })} options={PROJECT_STATUS_OPTIONS} placeholder="Select status" />
      <SearchableSelect label="Default order status" name="order" value={form.default_order_status} onValueChange={(value) => setForm({ ...form, default_order_status: value })} options={ORDER_STATUS_OPTIONS} placeholder="Select status" />
      <SearchableSelect label="Default invoice status" name="invoice" value={form.default_invoice_status} onValueChange={(value) => setForm({ ...form, default_invoice_status: value })} options={INVOICE_STATUS_OPTIONS} placeholder="Select status" />
    </div>

    <div className="flex justify-end border-t pt-5">
      <button disabled={saving} className="inline-flex h-11 items-center gap-2 rounded-xl bg-neutral-950 px-5 text-sm font-semibold text-white disabled:opacity-50">{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}Save defaults</button>
    </div>

    {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
  </form>;
}
