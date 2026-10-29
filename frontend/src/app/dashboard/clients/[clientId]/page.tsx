"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Banknote,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  CircleDollarSign,
  FileText,
  FolderKanban,
  Loader2,
  Mail,
  MapPin,
  Phone,
  ReceiptText,
  UserRound,
} from "lucide-react";

import { ClientAccessSection } from "@/components/client-access-section";
import { ClientExternalProfilesSection } from "@/components/client-external-profiles-section";
import { ClientCredentialsSection, ClientDocumentsSection, ClientNotesSection } from "@/components/client-resources-sections";
import { ClientServicesSection } from "@/components/client-services-section";
import { ClientWorkspaceMetricCard } from "@/components/client-workspace-metric-card";
import { ClientWorkspaceSection } from "@/components/client-workspace-section";
import { RelationshipPage } from "@/components/relationships/relationship-ui";
import { COUNTRY_OPTIONS } from "@/lib/company-options";
import "@/components/relationships/client-detail.css";

type ClientDetail = {
  id: string; client_code: string; client_type: string; display_name: string; legal_name: string | null;
  contact_name: string | null; email: string | null; billing_email: string | null; phone: string | null;
  whatsapp: string | null; website: string | null; country_code: string | null; state_region: string | null;
  city: string | null; postal_code: string | null; address_line1: string | null; address_line2: string | null;
  tax_identifier: string | null; currency: string | null; assigned_employee_id: string | null;
  assigned_employee_name: string | null; status: string; notes: string | null; source_lead_id: string | null;
  source_lead_code: string | null; source_lead_status: string | null; created_at: string; updated_at: string;
};
type Access = { clients_manage: boolean; quotations: boolean; quotations_manage: boolean; orders: boolean; projects: boolean; finance: boolean; finance_manage: boolean };
type Counts = { quotations: number | null; orders: number | null; projects: number | null; active_projects: number | null; invoices: number | null; overdue_invoices: number | null };
type CurrencyAmount = { currency: string; amount: string | number };
type InvoiceCurrencySummary = { currency: string; invoiced: string | number; paid: string | number; outstanding: string | number };
type Quotation = { id: string; quotation_number: string; status: string; subject: string | null; issue_date: string; valid_until: string | null; currency: string; total: string | number; created_at: string };
type Order = { id: string; order_number: string; quotation_id: string | null; status: string; subject: string | null; order_date: string; currency: string; total: string | number; created_at: string };
type Project = { id: string; project_number: string; order_id: string; quotation_id: string; name: string; status: string; priority: string; progress_percent: number; due_date: string | null; currency: string; contract_value: string | number; created_at: string };
type Invoice = { id: string; invoice_number: string; order_id: string | null; project_id: string | null; status: string; display_status: string; subject: string | null; issue_date: string; due_date: string | null; currency: string; total: string | number; amount_paid: string | number; balance_due: string | number; created_at: string };
type Payment = { id: string; payment_number: string; invoice_id: string; invoice_number: string; payment_date: string; invoice_currency: string; invoice_amount: string | number; account_currency: string; account_amount: string | number; method: string; reference: string | null; created_at: string };
type Timeline = { kind: string; title: string; subtitle: string | null; occurred_at: string; href: string | null };
type Workspace = { client: ClientDetail; access: Access; counts: Counts; business_value: CurrencyAmount[]; invoice_summary: InvoiceCurrencySummary[]; quotations: Quotation[]; orders: Order[]; projects: Project[]; invoices: Invoice[]; payments: Payment[]; timeline: Timeline[] };
type Tab = "overview" | "sales" | "projects" | "finance" | "activity" | "access" | "services" | "notes" | "documents" | "credentials";

function pretty(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase()); }
function money(value: string | number, currency: string) { return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function date(value: string | null) { return value ? new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(new Date(`${value.length === 10 ? `${value}T00:00:00` : value}`)) : "—"; }
function dateTime(value: string) { return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
function statusClass(status: string) {
  const value = status.toLowerCase();
  if (["active", "paid", "completed", "accepted", "confirmed", "won"].includes(value)) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (["overdue", "cancelled", "rejected", "lost"].includes(value)) return "border-red-200 bg-red-50 text-red-700";
  if (["sent", "in_progress", "qualified"].includes(value)) return "border-blue-200 bg-blue-50 text-blue-700";
  if (["partially_paid", "on_hold", "draft"].includes(value)) return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-neutral-200 bg-neutral-50 text-neutral-600";
}

export default function ClientWorkspacePage() {
  const params = useParams<{ clientId: string }>();
  const router = useRouter();
  const clientId = params.clientId;
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/crm/clients/${encodeURIComponent(clientId)}/workspace?limit=50`, { cache: "no-store" });
      if (response.status === 401) { router.replace("/login"); return; }
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to load client workspace.");
      setWorkspace(payload as Workspace);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load client workspace.");
    } finally { setLoading(false); }
  }, [clientId, router]);

  useEffect(() => { void load(); }, [load]);

  const tabs = useMemo(() => {
    if (!workspace) return [{ value: "overview" as Tab, label: "Overview" }];
    return [
      { value: "overview" as Tab, label: "Overview" },
      ...(workspace.access.quotations || workspace.access.orders ? [{ value: "sales" as Tab, label: "Sales" }] : []),
      ...(workspace.access.projects ? [{ value: "projects" as Tab, label: "Projects" }] : []),
      ...(workspace.access.finance ? [{ value: "finance" as Tab, label: "Invoices & Payments" }] : []),
      { value: "activity" as Tab, label: "Activity" },
      { value: "access" as Tab, label: "Access & Profiles" },
      { value: "services" as Tab, label: "Services" },
      { value: "notes" as Tab, label: "Notes" },
      { value: "documents" as Tab, label: "Documents" },
      { value: "credentials" as Tab, label: "Credentials" },
    ];
  }, [workspace]);

  if (loading) return <main className="client-detail-workspace flex min-h-[70vh] items-center justify-center" role="status" aria-label="Loading client workspace"><Loader2 className="size-7 animate-spin text-neutral-400" /></main>;
  if (error || !workspace) return <main className="client-detail-workspace min-h-screen bg-[var(--app-canvas)] p-4 sm:p-8"><div className="mx-auto max-w-6xl"><Link href="/dashboard/clients" className="inline-flex items-center gap-2 text-sm font-medium text-neutral-500"><ArrowLeft className="size-4" />Back to clients</Link><div role="alert" className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 sm:mt-6 sm:p-5">{error ?? "Client workspace unavailable."}</div></div></main>;

  const { client, access, counts } = workspace;
  const country = COUNTRY_OPTIONS.find((item) => item.value === client.country_code)?.label ?? client.country_code ?? "—";
  const address = [client.address_line1, client.address_line2, client.city, client.state_region, client.postal_code, client.country_code].filter(Boolean).join(", ") || "—";

  return <RelationshipPage className="client-detail-workspace"><div className="client-detail-content">
    <header className="client-relationship-header">
      <div className="min-w-0">
        <Link href="/dashboard/clients" className="inline-flex items-center gap-2 text-sm font-medium text-neutral-500 hover:text-neutral-900"><ArrowLeft className="size-4" />Clients</Link>
        <div className="client-relationship-title"><h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight sm:text-4xl">{client.display_name}</h1><Status value={client.status} /></div>
        <div className="client-relationship-meta"><span>{client.client_code}</span><span>· {pretty(client.client_type)}</span>{client.country_code ? <span>· {country}</span> : null}{client.currency ? <span>· Default {client.currency}</span> : null}{client.assigned_employee_name ? <span className="break-words">· Owner {client.assigned_employee_name}</span> : null}</div>
        <p className="mt-2 break-words text-xs leading-5 text-neutral-400 sm:text-sm">{client.source_lead_code ? `Originated from CRM · ${client.source_lead_code} · ${client.source_lead_status ?? "Converted"}` : "Direct client record"}</p>
      </div>
      <div className="client-context-actions">
        {access.clients_manage ? <Link href={`/dashboard/clients?edit=${encodeURIComponent(client.id)}`} className="inline-flex h-11 w-full items-center justify-center rounded-xl border bg-white px-4 text-sm font-semibold sm:w-auto">Edit client</Link> : null}
        {access.quotations_manage && client.status === "active" ? <Link href={`/dashboard/quotations?client_id=${encodeURIComponent(client.id)}`} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white sm:w-auto"><FileText className="size-4 shrink-0" />Create quotation</Link> : null}
        {access.finance_manage && client.status === "active" ? <Link href={`/dashboard/finance?client_id=${encodeURIComponent(client.id)}`} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border bg-white px-4 text-sm font-semibold sm:w-auto"><ReceiptText className="size-4 shrink-0" />Create invoice</Link> : null}
      </div>
    </header>

    <div className="client-summary-composition">
      <section className="client-financial-ledger" aria-label="Client financial summary">
        <div className="client-ledger-heading"><h2>Financial relationship</h2><p>Original currencies · no combined currency total</p></div>
        <div className="client-ledger-metrics">
          <MoneyCard title="Contracted business" icon={BriefcaseBusiness} rows={workspace.business_value} restricted={!access.orders} note="Non-cancelled orders" />
          <InvoiceMoneyCard title="Invoiced" icon={ReceiptText} rows={workspace.invoice_summary} field="invoiced" restricted={!access.finance} />
          <InvoiceMoneyCard title="Paid" icon={Banknote} rows={workspace.invoice_summary} field="paid" restricted={!access.finance} />
          <InvoiceMoneyCard title="Outstanding" icon={CircleDollarSign} rows={workspace.invoice_summary} field="outstanding" restricted={!access.finance} />
        </div>
        {(workspace.business_value.length > 1 || workspace.invoice_summary.length > 1) ? <p className="client-currency-note">Amounts shown here remain separated by currency; no combined currency total.</p> : null}
      </section>
      <aside className="client-relationship-context" aria-label="Relationship context">
        <div className="client-context-heading"><h2>Relationship at a glance</h2><p>Collection status and history</p></div>
        <div className="client-context-counts">
          <CountCard label="Overdue invoices" value={counts.overdue_invoices} icon={CalendarClock} restricted={!access.finance} />
          <CountCard label="Relationship" value={Math.max(1, Math.floor((Date.now() - new Date(client.created_at).getTime()) / 86400000))} secondary="days" icon={UserRound} />
        </div>
        <div className="client-primary-contact"><span>Primary contact</span><strong>{client.contact_name ?? "—"}</strong><p>{client.email ?? "No email recorded"}</p></div>
      </aside>
    </div>

    <section className="client-operation-rail" aria-label="Client workspace counts">
      <CountCard label="Quotations" value={counts.quotations} icon={FileText} restricted={!access.quotations} />
      <CountCard label="Orders" value={counts.orders} icon={BriefcaseBusiness} restricted={!access.orders} />
      <CountCard label="Projects" value={counts.projects} secondary={counts.active_projects !== null ? `${counts.active_projects} active` : undefined} icon={FolderKanban} restricted={!access.projects} />
      <CountCard label="Invoices" value={counts.invoices} icon={ReceiptText} restricted={!access.finance} />
    </section>

    <nav className="client-workspace-tabs" aria-label="Client workspace sections"><div>{tabs.map((item) => <button key={item.value} onClick={() => setTab(item.value)} aria-current={tab === item.value ? "page" : undefined} className={tab === item.value ? "is-active" : ""}>{item.label}</button>)}</div></nav>

    {tab === "overview" ? <Overview workspace={workspace} country={country} address={address} /> : null}
    {tab === "sales" ? <SalesTab quotations={workspace.quotations} orders={workspace.orders} access={access} /> : null}
    {tab === "projects" ? <ProjectsTab projects={workspace.projects} /> : null}
    {tab === "finance" ? <FinanceTab invoices={workspace.invoices} payments={workspace.payments} /> : null}
    {tab === "activity" ? <ActivityTab events={workspace.timeline} /> : null}
    {tab === "access" ? <AccessProfilesTab clientId={clientId} /> : null}
    {tab === "services" ? <ServicesTab clientId={clientId} /> : null}
    {tab === "notes" ? <div className="mt-4 sm:mt-5"><ClientNotesSection clientId={clientId} canManage={access.clients_manage} /></div> : null}
    {tab === "documents" ? <div className="mt-4 sm:mt-5"><ClientDocumentsSection clientId={clientId} canManage={access.clients_manage} /></div> : null}
    {tab === "credentials" ? <div className="mt-4 sm:mt-5"><ClientCredentialsSection clientId={clientId} canManage={access.clients_manage} /></div> : null}
  </div></RelationshipPage>;
}

function Overview({ workspace, country, address }: { workspace: Workspace; country: string; address: string }) {
  const { client, projects, invoices, timeline, access } = workspace;
  return <div className="client-overview-grid">
    <div className="client-overview-work">
      {access.projects ? <Section className="client-current-projects" title="Current projects" action={<Link href="/dashboard/projects" className="text-sm font-semibold text-neutral-500 hover:text-neutral-950">All projects</Link>}><div className="client-project-ledger">{projects.filter((item) => !["completed", "cancelled"].includes(item.status)).slice(0, 4).map((item) => <ProjectCard key={item.id} item={item} />)}{projects.filter((item) => !["completed", "cancelled"].includes(item.status)).length === 0 ? <Empty text="No active projects for this client." /> : null}</div></Section> : null}
      {access.finance ? <Section className="client-recent-invoices" title="Recent invoices" action={<Link href="/dashboard/finance" className="text-sm font-semibold text-neutral-500 hover:text-neutral-950">Finance workspace</Link>}><div className="divide-y">{invoices.slice(0, 5).map((item) => <InvoiceRow key={item.id} item={item} />)}{invoices.length === 0 ? <Empty text="No invoices for this client yet." /> : null}</div></Section> : null}
      <Section className="client-activity-surface" title="Recent activity"><div className="client-timeline">{timeline.slice(0, 7).map((item, index) => <TimelineRow key={`${item.kind}-${item.occurred_at}-${index}`} item={item} />)}</div></Section>
    </div>
    <aside className="client-overview-profile">
      <Section className="client-profile-surface" title="Client profile"><dl className="space-y-4 text-sm"><Detail icon={Building2} label="Legal name" value={client.legal_name ?? client.display_name} /><Detail icon={UserRound} label="Contact person" value={client.contact_name ?? "—"} /><Detail icon={Mail} label="Email" value={client.email ?? "—"} /><Detail icon={Mail} label="Billing email" value={client.billing_email ?? "—"} /><Detail icon={Phone} label="Phone" value={client.phone ?? "—"} /><Detail icon={MapPin} label="Country" value={country} /><Detail icon={MapPin} label="Address" value={address} /></dl></Section>
      <Section className="client-business-surface" title="Business details"><dl className="space-y-4 text-sm"><PlainDetail label="Default currency" value={client.currency ?? "—"} /><PlainDetail label="Tax / VAT identifier" value={client.tax_identifier ?? "—"} /><PlainDetail label="Assigned owner" value={client.assigned_employee_name ?? "Unassigned"} /><PlainDetail label="Website" value={client.website ?? "—"} /><PlainDetail label="Created" value={dateTime(client.created_at)} /></dl>{client.notes ? <div className="mt-5 border-t pt-4"><p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Notes</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-600">{client.notes}</p></div> : null}</Section>
    </aside>
  </div>;
}

function SalesTab({ quotations, orders, access }: { quotations: Quotation[]; orders: Order[]; access: Access }) {
  return <div className="mt-4 space-y-4 sm:mt-5 sm:space-y-5">
    {access.quotations ? <Section title={`Quotations · ${quotations.length}`}>
      {quotations.length ? <>
        <div className="space-y-3 md:hidden">{quotations.map((item) => <article key={item.id} className="rounded-xl border bg-neutral-50/60 p-4">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold">{item.quotation_number}</p><p className="mt-1 break-words text-xs text-neutral-400">{item.subject ?? "No subject"}</p></div><Status value={item.status} /></div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-xs"><div><p className="text-neutral-400">Issue date</p><p className="mt-1 font-medium text-neutral-700">{date(item.issue_date)}</p></div><div><p className="text-neutral-400">Valid until</p><p className="mt-1 font-medium text-neutral-700">{date(item.valid_until)}</p></div><div className="col-span-2"><p className="text-neutral-400">Value</p><p className="mt-1 break-words text-sm font-semibold text-neutral-900">{money(item.total, item.currency)}</p></div></div>
          <Link href={`/dashboard/quotations?quotation_id=${encodeURIComponent(item.id)}`} className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-xl border bg-white text-xs font-semibold">Open quotation</Link>
        </article>)}</div>
        <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[820px] text-left text-sm"><thead className="border-b text-xs uppercase tracking-wide text-neutral-400"><tr><th className="pb-3 font-medium">Quotation</th><th className="pb-3 font-medium">Status</th><th className="pb-3 font-medium">Issue / Valid</th><th className="pb-3 font-medium">Value</th><th className="pb-3 text-right font-medium">Open</th></tr></thead><tbody className="divide-y">{quotations.map((item) => <tr key={item.id}><td className="py-4"><p className="font-semibold">{item.quotation_number}</p><p className="mt-1 text-xs text-neutral-400">{item.subject ?? "No subject"}</p></td><td><Status value={item.status} /></td><td><p>{date(item.issue_date)}</p><p className="mt-1 text-xs text-neutral-400">Valid {date(item.valid_until)}</p></td><td className="font-medium">{money(item.total, item.currency)}</td><td className="text-right"><Link href={`/dashboard/quotations?quotation_id=${encodeURIComponent(item.id)}`} className="rounded-lg border px-3 py-2 text-xs font-semibold">Open</Link></td></tr>)}</tbody></table></div>
      </> : <Empty text="No quotations for this client." />}
    </Section> : null}

    {access.orders ? <Section title={`Orders · ${orders.length}`}>
      {orders.length ? <>
        <div className="space-y-3 md:hidden">{orders.map((item) => <article key={item.id} className="rounded-xl border bg-neutral-50/60 p-4">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold">{item.order_number}</p><p className="mt-1 break-words text-xs text-neutral-400">{item.subject ?? "No subject"}</p></div><Status value={item.status} /></div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-xs"><div><p className="text-neutral-400">Order date</p><p className="mt-1 font-medium text-neutral-700">{date(item.order_date)}</p></div><div><p className="text-neutral-400">Value</p><p className="mt-1 break-words font-semibold text-neutral-900">{money(item.total, item.currency)}</p></div></div>
          <Link href={`/dashboard/orders?order_id=${encodeURIComponent(item.id)}`} className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-xl border bg-white text-xs font-semibold">Open order</Link>
        </article>)}</div>
        <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[820px] text-left text-sm"><thead className="border-b text-xs uppercase tracking-wide text-neutral-400"><tr><th className="pb-3 font-medium">Order</th><th className="pb-3 font-medium">Status</th><th className="pb-3 font-medium">Order date</th><th className="pb-3 font-medium">Value</th><th className="pb-3 text-right font-medium">Open</th></tr></thead><tbody className="divide-y">{orders.map((item) => <tr key={item.id}><td className="py-4"><p className="font-semibold">{item.order_number}</p><p className="mt-1 text-xs text-neutral-400">{item.subject ?? "No subject"}</p></td><td><Status value={item.status} /></td><td>{date(item.order_date)}</td><td className="font-medium">{money(item.total, item.currency)}</td><td className="text-right"><Link href={`/dashboard/orders?order_id=${encodeURIComponent(item.id)}`} className="rounded-lg border px-3 py-2 text-xs font-semibold">Open</Link></td></tr>)}</tbody></table></div>
      </> : <Empty text="No orders for this client." />}
    </Section> : null}
  </div>;
}

function ProjectsTab({ projects }: { projects: Project[] }) {
  return <Section className="mt-5" title={`Projects · ${projects.length}`}><div className="client-project-ledger">{projects.map((item) => <ProjectCard key={item.id} item={item} />)}{projects.length === 0 ? <Empty text="No projects for this client." /> : null}</div></Section>;
}

function FinanceTab({ invoices, payments }: { invoices: Invoice[]; payments: Payment[] }) {
  return <div className="mt-4 space-y-4 sm:mt-5 sm:space-y-5">
    <Section title={`Invoices · ${invoices.length}`}><div className="divide-y">{invoices.map((item) => <InvoiceRow key={item.id} item={item} />)}{invoices.length === 0 ? <Empty text="No invoices for this client." /> : null}</div></Section>
    <Section title={`Payments · ${payments.length}`}>
      {payments.length ? <>
        <div className="space-y-3 md:hidden">{payments.map((item) => <article key={item.id} className="rounded-xl border bg-neutral-50/60 p-4">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold">{item.payment_number}</p><p className="mt-1 break-words text-xs text-neutral-400">{item.reference ?? "No reference"}</p></div><span className="shrink-0 rounded-full border bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-600">{pretty(item.method)}</span></div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-xs"><div className="min-w-0"><p className="text-neutral-400">Invoice</p><Link className="mt-1 block break-words font-medium text-neutral-800 hover:underline" href={`/dashboard/finance/invoices/${encodeURIComponent(item.invoice_id)}`}>{item.invoice_number}</Link></div><div><p className="text-neutral-400">Payment date</p><p className="mt-1 font-medium text-neutral-700">{date(item.payment_date)}</p></div><div className="min-w-0"><p className="text-neutral-400">Invoice amount</p><p className="mt-1 break-words font-medium text-neutral-700">{money(item.invoice_amount, item.invoice_currency)}</p></div><div className="min-w-0"><p className="text-neutral-400">Received</p><p className="mt-1 break-words font-semibold text-neutral-900">{money(item.account_amount, item.account_currency)}</p></div></div>
          <Link href={`/dashboard/finance/invoices/${encodeURIComponent(item.invoice_id)}`} className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-xl border bg-white text-xs font-semibold">Open invoice</Link>
        </article>)}</div>
        <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[900px] text-left text-sm"><thead className="border-b text-xs uppercase tracking-wide text-neutral-400"><tr><th className="pb-3 font-medium">Payment</th><th className="pb-3 font-medium">Invoice</th><th className="pb-3 font-medium">Date</th><th className="pb-3 font-medium">Invoice amount</th><th className="pb-3 font-medium">Received</th><th className="pb-3 font-medium">Method</th></tr></thead><tbody className="divide-y">{payments.map((item) => <tr key={item.id}><td className="py-4"><p className="font-semibold">{item.payment_number}</p><p className="mt-1 text-xs text-neutral-400">{item.reference ?? "No reference"}</p></td><td><Link className="font-medium hover:underline" href={`/dashboard/finance/invoices/${encodeURIComponent(item.invoice_id)}`}>{item.invoice_number}</Link></td><td>{date(item.payment_date)}</td><td>{money(item.invoice_amount, item.invoice_currency)}</td><td>{money(item.account_amount, item.account_currency)}</td><td>{pretty(item.method)}</td></tr>)}</tbody></table></div>
      </> : <Empty text="No confirmed payments for this client." />}
    </Section>
  </div>;
}

function ActivityTab({ events }: { events: Timeline[] }) {
  return <Section className="mt-5 client-activity-surface" title="Relationship timeline"><div className="client-timeline">{events.map((item, index) => <TimelineRow key={`${item.kind}-${item.occurred_at}-${index}`} item={item} />)}{events.length === 0 ? <Empty text="No activity yet." /> : null}</div></Section>;
}

function AccessProfilesTab({ clientId }: { clientId: string }) {
  return <div className="mt-5 space-y-5">
    <ClientExternalProfilesSection clientId={clientId} />
    <ClientAccessSection clientId={clientId} />
  </div>;
}

function ServicesTab({ clientId }: { clientId: string }) {
  return <div className="mt-5"><ClientServicesSection clientId={clientId} /></div>;
}

function CountCard({ label, value, secondary, icon: Icon, restricted = false }: { label: string; value: number | null; secondary?: string; icon: typeof FileText; restricted?: boolean }) { return <ClientWorkspaceMetricCard label={label} value={value} secondary={secondary} icon={Icon} restricted={restricted} />; }
function MoneyCard({ title, icon: Icon, rows, restricted, note }: { title: string; icon: typeof FileText; rows: CurrencyAmount[]; restricted: boolean; note?: string }) { return <article className="client-money-column"><div className="flex items-center justify-between gap-2"><p className="min-w-0 text-xs leading-4 text-neutral-500 sm:text-sm">{title}</p><Icon className="size-4 shrink-0 text-neutral-400" /></div>{restricted ? <p className="mt-4 text-xs font-medium text-neutral-400 sm:mt-5 sm:text-sm">Restricted by role</p> : rows.length ? <div className="mt-3 space-y-1 sm:mt-4">{rows.map((item) => <p key={item.currency} className="break-words text-base font-semibold tabular-nums sm:text-xl">{money(item.amount, item.currency)}</p>)}</div> : <p className="mt-3 text-lg font-semibold sm:mt-4 sm:text-xl">—</p>}{note && !restricted ? <p className="mt-2 text-[11px] leading-4 text-neutral-400 sm:text-xs">{note}</p> : null}</article>; }
function InvoiceMoneyCard({ title, icon, rows, field, restricted }: { title: string; icon: typeof FileText; rows: InvoiceCurrencySummary[]; field: "invoiced" | "paid" | "outstanding"; restricted: boolean }) { return <MoneyCard title={title} icon={icon} restricted={restricted} rows={rows.map((item) => ({ currency: item.currency, amount: item[field] }))} />; }
function Section({ title, action, children, className = "" }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) { return <ClientWorkspaceSection title={title} action={action} className={`client-workspace-section ${className}`}>{children}</ClientWorkspaceSection>; }
function Status({ value }: { value: string }) { return <span className={`inline-flex shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${statusClass(value)}`}>{pretty(value)}</span>; }
function Empty({ text }: { text: string }) { return <div className="col-span-full py-8 text-center text-sm text-neutral-400 sm:py-10">{text}</div>; }
function Detail({ icon: Icon, label, value }: { icon: typeof Building2; label: string; value: string }) { return <div className="flex gap-3"><Icon className="mt-0.5 size-4 shrink-0 text-neutral-400" /><div className="min-w-0"><dt className="text-xs text-neutral-400">{label}</dt><dd className="mt-1 break-words font-medium text-neutral-800">{value}</dd></div></div>; }
function PlainDetail({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs text-neutral-400">{label}</dt><dd className="mt-1 break-words font-medium text-neutral-800">{value}</dd></div>; }
function ProjectCard({ item }: { item: Project }) { return <Link href={`/dashboard/projects/${encodeURIComponent(item.id)}`} className="client-project-row"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-words font-semibold">{item.name}</p><p className="mt-1 text-xs text-neutral-400">{item.project_number}</p></div><Status value={item.status} /></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-neutral-900" style={{ width: `${Math.max(0, Math.min(100, item.progress_percent))}%` }} /></div><div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-neutral-500"><span>{item.progress_percent}% complete</span><span>Due {date(item.due_date)}</span></div><p className="mt-3 break-words text-sm font-semibold">{money(item.contract_value, item.currency)}</p></Link>; }
function InvoiceRow({ item }: { item: Invoice }) { return <Link href={`/dashboard/finance/invoices/${encodeURIComponent(item.id)}`} className="client-invoice-row"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{item.invoice_number}</p><Status value={item.display_status} /></div><p className="mt-1 break-words text-xs text-neutral-400">{item.subject ?? "No subject"} · Due {date(item.due_date)}</p></div><div className="min-w-0 sm:text-right"><p className="break-words font-semibold">{money(item.total, item.currency)}</p><p className="mt-1 break-words text-xs text-neutral-400">Paid {money(item.amount_paid, item.currency)} · Balance {money(item.balance_due, item.currency)}</p></div></Link>; }
function TimelineRow({ item }: { item: Timeline }) { const content = <div className="client-timeline-row"><div className="mt-1 size-2.5 shrink-0 rounded-full bg-neutral-300" /><div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{item.title}</p>{item.subtitle ? <p className="mt-1 break-words text-xs text-neutral-500">{item.subtitle}</p> : null}<p className="mt-1 text-xs text-neutral-400">{dateTime(item.occurred_at)}</p></div></div>; return item.href ? <Link href={item.href}>{content}</Link> : content; }
