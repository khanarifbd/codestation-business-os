"use client";

import { Loader2, Save, SlidersHorizontal } from "lucide-react";
import { useCompanyDefaults } from "@/hooks/use-company-defaults";
import { useAdministrationReadOwner } from "@/hooks/use-administration-read-owner";
export default function CompanyDefaultsPage(){const owner=useAdministrationReadOwner();if(owner.loading||!owner.tenant)return <main role="status">Loading defaults workspace…</main>;return <DefaultsContent key={owner.key}/>;}
function DefaultsContent(){
 const {form:defaults,loading,saving,error,message,locked,load,change,save:submit}=useCompanyDefaults();
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
        <div className="rounded-2xl border bg-white p-8 text-center text-sm text-red-600">{error}<button type="button" disabled={saving||loading} className="ml-3 underline" onClick={()=>void load()}>Retry read only</button></div>
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
          <fieldset disabled={locked} className="grid gap-5 sm:grid-cols-2">
            <label className="text-sm font-medium">
              Default client country (ISO-2)
              <input name="default_client_country_code" maxLength={2} value={defaults.default_client_country_code ?? ""} onChange={event=>change("default_client_country_code",event.target.value || null)} className={input} placeholder="BD" />
            </label>
            <label className="text-sm font-medium">
              Default client currency (ISO-3)
              <input name="default_client_currency" maxLength={3} value={defaults.default_client_currency ?? ""} onChange={event=>change("default_client_currency",event.target.value || null)} className={input} placeholder="BDT" />
            </label>
            <label className="text-sm font-medium">
              Default document language
              <input name="default_document_language" minLength={2} maxLength={16} required value={defaults.default_document_language} onChange={event=>change("default_document_language",event.target.value)} className={input} placeholder="en" />
            </label>
            <label className="text-sm font-medium">
              Quotation validity (days)
              <input name="quotation_validity_days" type="number" min="1" max="365" required value={defaults.quotation_validity_days} onChange={event=>change("quotation_validity_days",Number(event.target.value))} className={input} />
            </label>
            <label className="text-sm font-medium">
              Default lead status
              <input name="default_lead_status" maxLength={64} required value={defaults.default_lead_status} onChange={event=>change("default_lead_status",event.target.value)} className={input} />
            </label>
            <label className="text-sm font-medium">
              Default project status
              <input name="default_project_status" maxLength={64} required value={defaults.default_project_status} onChange={event=>change("default_project_status",event.target.value)} className={input} />
            </label>
            <label className="text-sm font-medium">
              Default order status
              <input name="default_order_status" maxLength={64} required value={defaults.default_order_status} onChange={event=>change("default_order_status",event.target.value)} className={input} />
            </label>
            <label className="text-sm font-medium">
              Default invoice status
              <input name="default_invoice_status" maxLength={64} required value={defaults.default_invoice_status} onChange={event=>change("default_invoice_status",event.target.value)} className={input} />
            </label>
          </fieldset>

          <div className="rounded-xl border border-dashed bg-neutral-50 p-4 text-sm text-neutral-500">
            These values are tenant-scoped. Future modules may expose custom status builders; the defaults here remain the selected starting values.
          </div>

          {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
          {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}<button type="button" disabled={saving||loading} className="ml-3 underline" onClick={()=>void load()}>Retry read only</button></div> : null}

          <div className="flex justify-end border-t pt-5">
            <button disabled={locked} className="flex h-11 items-center gap-2 rounded-xl bg-neutral-950 px-5 text-sm font-semibold text-white disabled:opacity-60">
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save defaults
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
