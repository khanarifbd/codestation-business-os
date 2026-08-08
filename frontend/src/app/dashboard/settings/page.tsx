"use client";

import { FormEvent, useEffect, useState } from "react";
import { Loader2, Save, Settings2 } from "lucide-react";

import { SearchableSelect, type SearchOption } from "@/components/searchable-select";
import { COUNTRY_OPTIONS, CURRENCY_OPTIONS, LANGUAGE_OPTIONS } from "@/lib/company-options";

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

type LeadStatus = {
  name: string;
  slug: string;
  is_active: boolean;
};

type CrmMeta = { statuses: LeadStatus[] };

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

export default function SettingsPage() {
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
          fetch("/api/settings/system-defaults", { cache: "no-store" }),
          fetch("/api/crm/meta", { cache: "no-store" }),
        ]);

        const settingsPayload = await settingsResponse.json().catch(() => null);
        if (!settingsResponse.ok) throw new Error(settingsPayload?.detail ?? "Unable to load settings");
        setForm(settingsPayload as Defaults);

        if (crmResponse.ok) {
          const crmPayload = (await crmResponse.json()) as CrmMeta;
          setLeadStatuses(
            crmPayload.statuses
              .filter((status) => status.is_active)
              .map((status) => ({ value: status.slug, label: status.name })),
          );
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Unable to load settings");
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
      const response = await fetch("/api/settings/system-defaults", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to save settings");
      setForm(payload as Defaults);
      setMessage("Business defaults saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save settings");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <main className="flex min-h-[70vh] items-center justify-center"><Loader2 className="size-6 animate-spin" /></main>;
  }
  if (!form) return <main className="p-8 text-sm text-red-700">{error ?? "Settings unavailable"}</main>;

  const leadOptions = leadStatuses.length
    ? leadStatuses
    : [{ value: form.default_lead_status, label: form.default_lead_status }];

  return (
    <main className="min-h-screen bg-neutral-100 p-5 sm:p-8 lg:p-10">
      <div className="mx-auto max-w-5xl">
        <p className="text-sm text-neutral-500">Company-wide behaviour</p>
        <h1 className="mt-1 text-3xl font-semibold">Settings</h1>

        <form onSubmit={save} className="mt-7 rounded-2xl border bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <Settings2 className="size-5" />
            <div>
              <h2 className="font-semibold">System defaults</h2>
              <p className="text-sm text-neutral-500">New records inherit these values; existing historical documents are not rewritten.</p>
            </div>
          </div>

          <div className="mt-6 grid gap-5 md:grid-cols-2">
            <div>
              <SearchableSelect
                label="Default client country"
                name="default_client_country_code"
                value={form.default_client_country_code}
                onValueChange={(value) => setForm({ ...form, default_client_country_code: value })}
                options={COUNTRY_OPTIONS}
                placeholder="Select country"
                searchPlaceholder="Search country or ISO code..."
              />
              <p className="mt-1 text-xs text-neutral-400">Used as the default country for new client and CRM records.</p>
            </div>

            <div>
              <SearchableSelect
                label="Default client currency"
                name="default_client_currency"
                value={form.default_client_currency}
                onValueChange={(value) => setForm({ ...form, default_client_currency: value })}
                options={CURRENCY_OPTIONS}
                placeholder="Select currency"
                searchPlaceholder="Search currency or ISO code..."
              />
              <p className="mt-1 text-xs text-neutral-400">Used as the default transaction currency for new clients.</p>
            </div>

            <div>
              <SearchableSelect
                label="Document language"
                name="default_document_language"
                value={form.default_document_language}
                onValueChange={(value) => setForm({ ...form, default_document_language: value })}
                options={LANGUAGE_OPTIONS}
                placeholder="Select language"
                searchPlaceholder="Search language..."
              />
              <p className="mt-1 text-xs text-neutral-400">Default language for generated quotations, invoices and business documents.</p>
            </div>

            <label className="block">
              <span className="text-sm font-semibold">Quotation validity days</span>
              <input
                type="number"
                min={1}
                max={3650}
                value={form.quotation_validity_days}
                onChange={(event) => setForm({ ...form, quotation_validity_days: Number(event.target.value) })}
                className="mt-2 h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none transition focus:border-neutral-500"
              />
              <span className="mt-1 block text-xs text-neutral-400">Default validity period for new quotations.</span>
            </label>

            <div>
              <SearchableSelect
                label="Default lead status"
                name="default_lead_status"
                value={form.default_lead_status}
                onValueChange={(value) => setForm({ ...form, default_lead_status: value })}
                options={leadOptions}
                placeholder="Select lead status"
                searchPlaceholder="Search pipeline status..."
              />
              <p className="mt-1 text-xs text-neutral-400">Loaded from your active CRM pipeline statuses.</p>
            </div>

            <div>
              <SearchableSelect
                label="Default project status"
                name="default_project_status"
                value={form.default_project_status}
                onValueChange={(value) => setForm({ ...form, default_project_status: value })}
                options={PROJECT_STATUS_OPTIONS}
                placeholder="Select project status"
              />
              <p className="mt-1 text-xs text-neutral-400">Initial project lifecycle status when applicable.</p>
            </div>

            <div>
              <SearchableSelect
                label="Default order status"
                name="default_order_status"
                value={form.default_order_status}
                onValueChange={(value) => setForm({ ...form, default_order_status: value })}
                options={ORDER_STATUS_OPTIONS}
                placeholder="Select order status"
              />
              <p className="mt-1 text-xs text-neutral-400">Only valid initial order states are available.</p>
            </div>

            <div>
              <SearchableSelect
                label="Default invoice status"
                name="default_invoice_status"
                value={form.default_invoice_status}
                onValueChange={(value) => setForm({ ...form, default_invoice_status: value })}
                options={INVOICE_STATUS_OPTIONS}
                placeholder="Select invoice status"
              />
              <p className="mt-1 text-xs text-neutral-400">Paid and partially-paid are payment-driven and cannot be defaults.</p>
            </div>
          </div>

          {error ? <p className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
          {message ? <p className="mt-5 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p> : null}

          <div className="mt-6 flex justify-end">
            <button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save settings
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
