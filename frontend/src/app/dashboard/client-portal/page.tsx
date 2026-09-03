"use client";

import { useEffect, useState } from "react";
import { Building2, CircleDollarSign, FolderKanban, Loader2, ReceiptText, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";

import { ClientWorkspaceMetricCard } from "@/components/client-workspace-metric-card";
import { ClientWorkspaceSection } from "@/components/client-workspace-section";

type PortalClient = {
  id: string;
  client_code: string;
  display_name: string;
  client_type: string;
  email: string | null;
  phone: string | null;
  currency: string | null;
  is_primary_contact: boolean;
};

type PortalFinancial = {
  currency: string;
  invoice_count: number;
  invoiced_total: string | number;
  balance_due: string | number;
};

type PortalContext = {
  organization_id: string;
  organization_name: string;
  membership_id: string;
  clients: PortalClient[];
  project_count: number;
  financials: PortalFinancial[];
};

function money(value: string | number, currency: string) {
  return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ClientPortalPage() {
  const router = useRouter();
  const [data, setData] = useState<PortalContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/client-portal", { cache: "no-store" });
        if (response.status === 401) { router.replace("/login"); return; }
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.detail ?? "Unable to load client portal");
        if (active) setData(payload as PortalContext);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Unable to load client portal");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [router]);

  if (loading) return <main className="flex min-h-[70vh] items-center justify-center"><Loader2 className="size-7 animate-spin text-neutral-400" /></main>;
  if (!data) return <main className="p-6 sm:p-10"><div className="mx-auto max-w-4xl rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">{error ?? "Client portal unavailable"}</div></main>;

  const totalInvoices = data.financials.reduce((sum, item) => sum + item.invoice_count, 0);

  return <main className="min-h-screen bg-neutral-100 p-5 sm:p-8 lg:p-10"><div className="mx-auto max-w-[1300px]">
    <header><p className="text-sm font-medium text-neutral-500">Client workspace</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">{data.organization_name}</h1><p className="mt-2 max-w-2xl text-sm text-neutral-500">This view is isolated to the client records linked to your account. Company staff, payroll, internal finance and other private workspace data are not available here.</p></header>
    {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

    <div className="mt-7 grid gap-4 sm:grid-cols-3"><ClientWorkspaceMetricCard label="Client profiles" value={data.clients.length} icon={UserRound} variant="large" /><ClientWorkspaceMetricCard label="Projects" value={data.project_count} icon={FolderKanban} variant="large" /><ClientWorkspaceMetricCard label="Invoices" value={totalInvoices} icon={ReceiptText} variant="large" /></div>

    <div className="mt-5 grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
      <ClientWorkspaceSection title="Client profiles" eyebrow="Your relationship" icon={Building2} variant="portal" contentClassName="space-y-3">
        {data.clients.map((client) => <article key={client.id} className="rounded-xl border p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{client.display_name}</p><p className="mt-1 text-xs text-neutral-400">{client.client_code} · {client.client_type}</p></div>{client.is_primary_contact ? <span className="rounded-full bg-neutral-950 px-2.5 py-1 text-[10px] font-semibold text-white">Primary contact</span> : null}</div><div className="mt-4 space-y-1 text-sm text-neutral-500"><p>{client.email ?? "No email"}</p><p>{client.phone ?? "No phone"}</p>{client.currency ? <p>Preferred currency: {client.currency}</p> : null}</div></article>)}
      </ClientWorkspaceSection>

      <ClientWorkspaceSection title="Invoices by currency" eyebrow="Billing overview" icon={CircleDollarSign} variant="portal">
        {data.financials.length ? <div className="space-y-3">{data.financials.map((item) => <div key={item.currency} className="grid gap-3 rounded-xl border p-4 sm:grid-cols-3"><div><p className="text-xs text-neutral-400">Currency</p><p className="mt-1 font-semibold">{item.currency}</p></div><div><p className="text-xs text-neutral-400">Invoiced</p><p className="mt-1 font-semibold">{money(item.invoiced_total, item.currency)}</p><p className="mt-1 text-xs text-neutral-400">{item.invoice_count} invoice{item.invoice_count === 1 ? "" : "s"}</p></div><div><p className="text-xs text-neutral-400">Balance due</p><p className="mt-1 font-semibold">{money(item.balance_due, item.currency)}</p></div></div>)}</div> : <div className="rounded-xl bg-neutral-50 px-4 py-10 text-center text-sm text-neutral-400">No invoices are linked to your client profile yet.</div>}
      </ClientWorkspaceSection>
    </div>
  </div></main>;
}
