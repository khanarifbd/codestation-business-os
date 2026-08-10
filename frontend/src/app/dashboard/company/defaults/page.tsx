"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, SlidersHorizontal } from "lucide-react";

type SystemDefaults = {
  id: string;
  organization_id: string;
  default_client_country_code: string | null;
  default_client_currency: string | null;
  default_document_language: string;
  default_lead_status: string;
  default_project_status: string;
  default_order_status: string;
  default_invoice_status: string;
  quotation_validity_days: number;
};

function value(form: FormData, name: string): string | null {
  const result = String(form.get(name) ?? "").trim();
  return result || null;
}

export default function CompanyDefaultsPage() {
  const router = useRouter();
  const [defaults, setDefaults] = useState<SystemDefaults | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/company-settings/system-defaults", { cache: "no-store" });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (response.status === 403) {
        router.replace("/dashboard");
        return;
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.detail ?? "Unable to load system defaults.");
        setLoading(false);
        return;
      }
      setDefaults((await response.json()) as SystemDefaults);
      setLoading(false);
    })();
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/company-settings/system-defaults", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        default_client_country_code: value(form, "default_client_country_code"),
        default_client_currency: value(form, "default_client_currency"),
        default_document_language: value(form, "default_document_language"),
        default_lead_status: value(form, "default_lead_status"),
        default_project_status: value(form, "default_project_status"),
        default_order_status: value(form, "default_order_status"),
        default_invoice_status: value(form, "default_invoice_status"),
        quotation_validity_days: Number(form.get("quotation_validity_days")),
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.detail ?? "Unable to save system defaults.");
      setSaving(false);
      return;
    }

    setDefaults((await response.json()) as SystemDefaults);
    setMessage("System defaults saved");
    setSaving(false);
  }

  if (loading) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center bg-neutral-100">
        <Loader2 className="size-6 animate-spin text-neutral-500" />
      </main>
    );
  }

  if (!defaults) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <div className="rounded-2xl border bg-white p-8 text-center text-sm text-red-600">{error}</div>
      </main>
    );
  }

  const input = "mt-2 h-11 w-full rounded-xl border border-neutral-200 px-3 text-sm outline-none focus:border-neutral-500";

  return (
    <main className="mx-auto max-w-[1100px] px-5 py-8 sm:px-8 lg:px-10">
      <section className="rounded-2xl border bg-white shadow-sm">
        <header className="border-b p-6">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-neutral-950 text-white">
              <SlidersHorizontal className="size-4" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">System Defaults</h1>
              <p className="mt-1 text-sm text-neutral-500">Defaults reused by CRM, projects, orders, quotations, invoices and documents.</p>
            </div>
          </div>
        </header>

        <form onSubmit={submit} className="space-y-6 p-6">
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="text-sm font-medium">
              Default client country (ISO-2)
              <input name="default_client_country_code" defaultValue={defaults.default_client_country_code ?? ""} className={input} placeholder="BD" />
            </label>
            <label className="text-sm font-medium">
              Default client currency (ISO-3)
              <input name="default_client_currency" defaultValue={defaults.default_client_currency ?? ""} className={input} placeholder="BDT" />
            </label>
            <label className="text-sm font-medium">
              Default document language
              <input name="default_document_language" required defaultValue={defaults.default_document_language} className={input} placeholder="en" />
            </label>
            <label className="text-sm font-medium">
              Quotation validity (days)
              <input name="quotation_validity_days" type="number" min="1" max="365" required defaultValue={defaults.quotation_validity_days} className={input} />
            </label>
            <label className="text-sm font-medium">
              Default lead status
              <input name="default_lead_status" required defaultValue={defaults.default_lead_status} className={input} />
            </label>
            <label className="text-sm font-medium">
              Default project status
              <input name="default_project_status" required defaultValue={defaults.default_project_status} className={input} />
            </label>
            <label className="text-sm font-medium">
              Default order status
              <input name="default_order_status" required defaultValue={defaults.default_order_status} className={input} />
            </label>
            <label className="text-sm font-medium">
              Default invoice status
              <input name="default_invoice_status" required defaultValue={defaults.default_invoice_status} className={input} />
            </label>
          </div>

          <div className="rounded-xl border border-dashed bg-neutral-50 p-4 text-sm text-neutral-500">
            These values are tenant-scoped. Future modules may expose custom status builders; the defaults here remain the selected starting values.
          </div>

          {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
          {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

          <div className="flex justify-end border-t pt-5">
            <button disabled={saving} className="flex h-11 items-center gap-2 rounded-xl bg-neutral-950 px-5 text-sm font-semibold text-white disabled:opacity-60">
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save defaults
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
