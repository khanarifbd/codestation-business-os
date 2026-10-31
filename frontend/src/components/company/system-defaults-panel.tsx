"use client";

import { useLayoutEffect } from "react";
import { useCompanyDefaults } from "@/hooks/use-company-defaults";
import { useAdministrationReadOwner } from "@/hooks/use-administration-read-owner";
import { Loader2, Save } from "lucide-react";

import { SearchableSelect, type SearchOption } from "@/components/searchable-select";
import { COUNTRY_OPTIONS, LANGUAGE_OPTIONS } from "@/lib/company-options";

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

export type DefaultsLeaveRegistration=(guard:()=>boolean)=>()=>void;
export function SystemDefaultsPanel({registerLeaveGuard}:{registerLeaveGuard?:DefaultsLeaveRegistration}) {
 const owner=useAdministrationReadOwner();
 if(owner.loading||!owner.tenant)return <div role="status">Loading defaults workspace…</div>;
 return <SystemDefaultsContent key={owner.key} registerLeaveGuard={registerLeaveGuard}/>;
}
function SystemDefaultsContent({registerLeaveGuard}:{registerLeaveGuard?:DefaultsLeaveRegistration}) {
 const {confirmLeave,form,loading,saving,error,message,leadStatuses,locked,load,change,save}=useCompanyDefaults();
 useLayoutEffect(()=>registerLeaveGuard?.(confirmLeave),[registerLeaveGuard,confirmLeave]);
  if (loading) return <div className="flex min-h-64 items-center justify-center"><Loader2 className="size-6 animate-spin text-neutral-400" /></div>;
  if (!form) return <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error ?? "System defaults unavailable."}<button type="button" className="ml-3 underline" onClick={()=>void load()}>Retry read</button></div>;

  const leadOptions = leadStatuses.length ? leadStatuses : [{ value: form.default_lead_status, label: form.default_lead_status }];

  return <form onSubmit={save} className="space-y-6">
    <div>
      <h3 className="font-semibold">System defaults</h3>
      <p className="mt-1 text-sm text-neutral-500">Defaults for new business records. Client currency is managed in Currencies & FX so all currency choices stay together.</p>
    </div>

    <fieldset disabled={locked} className="grid gap-5 md:grid-cols-2">
      <SearchableSelect disabled={locked} label="Default client country" name="country" value={form.default_client_country_code} onValueChange={(value) => change("default_client_country_code", value || null)} options={COUNTRY_OPTIONS} placeholder="Select country" searchPlaceholder="Search country..." />
      <SearchableSelect disabled={locked} label="Document language" name="language" value={form.default_document_language} onValueChange={(value) => change("default_document_language", value)} options={LANGUAGE_OPTIONS} placeholder="Select language" searchPlaceholder="Search language..." />
      <label className="block"><span className="text-sm font-semibold">Quotation validity days</span><input type="number" min={1} max={365} value={form.quotation_validity_days} onChange={(event) => change("quotation_validity_days", Number(event.target.value))} className="mt-2 h-11 w-full rounded-xl border px-3 text-sm" /></label>
      <SearchableSelect disabled={locked} label="Default lead status" name="lead" value={form.default_lead_status} onValueChange={(value) => change("default_lead_status", value)} options={leadOptions} placeholder="Select status" />
      <SearchableSelect disabled={locked} label="Default project status" name="project" value={form.default_project_status} onValueChange={(value) => change("default_project_status", value)} options={PROJECT_STATUS_OPTIONS} placeholder="Select status" />
      <SearchableSelect disabled={locked} label="Default order status" name="order" value={form.default_order_status} onValueChange={(value) => change("default_order_status", value)} options={ORDER_STATUS_OPTIONS} placeholder="Select status" />
      <SearchableSelect disabled={locked} label="Default invoice status" name="invoice" value={form.default_invoice_status} onValueChange={(value) => change("default_invoice_status", value)} options={INVOICE_STATUS_OPTIONS} placeholder="Select status" />
    </fieldset>

    <div className="flex justify-end border-t pt-5">
      <button disabled={locked} className="inline-flex h-11 items-center gap-2 rounded-xl bg-neutral-950 px-5 text-sm font-semibold text-white disabled:opacity-50">{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}Save defaults</button>
    </div>

    {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}<button type="button" disabled={saving||loading} className="ml-3 underline" onClick={()=>void load()}>Retry read only</button></div> : null}
    {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
  </form>;
}
