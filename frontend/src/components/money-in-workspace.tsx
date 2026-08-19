"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, FileText, FolderKanban, ReceiptText, ShoppingBag, UserRound } from "lucide-react";

import { AccountingNav } from "@/components/accounting-nav";
import { FinancialConfirmationDialog } from "@/components/financial-confirmation-dialog";
import { MoneyInput } from "@/components/money-input";
import { SearchableSelect } from "@/components/searchable-select";
import { confirmDiscardChanges, useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { getApiErrorMessage } from "@/lib/api-error";

type SourceType = "invoice" | "project" | "order" | "advance" | "other";
type RelationType = "" | "client" | "order" | "project";
type Account = { id: string; name: string; account_type: string; currency: string; current_balance: string | number; is_active: boolean };
type Client = { id: string; code: string; name: string; currency: string | null };
type Invoice = { id: string; invoice_number: string; client_name: string; order_id: string | null; project_id: string | null; status: string; display_status: string; currency: string; total: string | number; balance_due: string | number; subject: string | null };
type Project = { id: string; number: string; order_id: string; client_id: string; name: string; currency: string; contract_value: string | number; status: string };
type Order = { id: string; number: string; client_id: string; client_name: string; currency: string; total: string | number; status: string };
type Meta = { clients: Client[]; orders: Order[]; projects: Project[]; accounts: Account[] };
type LedgerAccount = { id: string; name: string; category: string; is_active: boolean };
type MoneyEntry = { id: string; entry_date: string; financial_account_name: string; category_ledger_account_name: string; source_type: string | null; source_label: string | null; currency: string; amount: string | number; description: string; reference: string | null };
type Advance = { id: string; client_name: string; financial_account_name: string; advance_date: string; currency: string; original_amount: string | number; remaining_amount: string | number; reference: string | null };
type MoneyInForm = { source_id: string; account_id: string; amount: string; date: string; method: string; category_id: string; description: string; reference: string; notes: string };

function today() { return new Date().toISOString().slice(0, 10); }
function money(value: string | number, currency: string) { return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function blankForm(): MoneyInForm { return { source_id: "", account_id: "", amount: "", date: today(), method: "bank_transfer", category_id: "", description: "", reference: "", notes: "" }; }

const sourceCards = [
  { value: "invoice" as SourceType, title: "Invoice payment", help: "Pay an existing invoice and update its balance", icon: FileText },
  { value: "project" as SourceType, title: "Project payment", help: "Create/use the project invoice, then record payment", icon: FolderKanban },
  { value: "order" as SourceType, title: "Order payment", help: "Create/use the order invoice, then record payment", icon: ShoppingBag },
  { value: "advance" as SourceType, title: "Client advance", help: "Customer credit before invoicing — not revenue yet", icon: UserRound },
  { value: "other" as SourceType, title: "Other / Additional income", help: "Tips, bonuses or other income without an invoice", icon: ReceiptText },
];

export function MoneyInWorkspace() {
  const [sourceType, setSourceType] = useState<SourceType>("invoice");
  const [relationType, setRelationType] = useState<RelationType>("");
  const [relationId, setRelationId] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [categories, setCategories] = useState<LedgerAccount[]>([]);
  const [entries, setEntries] = useState<MoneyEntry[]>([]);
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [preselectionApplied, setPreselectionApplied] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [form, setForm] = useState<MoneyInForm>(blankForm());

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [metaRes, invRes, coaRes, entryRes, advRes] = await Promise.all([
        fetch("/api/finance/meta", { cache: "no-store" }),
        fetch("/api/finance/invoice-page?limit=100", { cache: "no-store" }),
        fetch("/api/accounting/chart-of-accounts", { cache: "no-store" }),
        fetch("/api/accounting/money?kind=income&limit=50", { cache: "no-store" }),
        fetch("/api/accounting/customer-advances?open_only=true", { cache: "no-store" }),
      ]);
      const [meta, inv, coa, entry, adv] = await Promise.all([metaRes.json(), invRes.json(), coaRes.json(), entryRes.json(), advRes.json()]);
      if (!metaRes.ok) throw new Error(getApiErrorMessage(meta, "Could not load finance data"));
      if (!invRes.ok) throw new Error(getApiErrorMessage(inv, "Could not load invoices"));
      if (!coaRes.ok) throw new Error(getApiErrorMessage(coa, "Could not load income categories"));
      const typed = meta as Meta;
      setAccounts(typed.accounts.filter((account) => account.is_active && account.account_type !== "credit_card"));
      setClients(typed.clients); setProjects(typed.projects); setOrders(typed.orders);
      setInvoices((inv.items ?? []).filter((invoice: Invoice) => Number(invoice.balance_due) > 0 && !["draft", "cancelled", "paid"].includes(invoice.status)));
      setCategories((coa as LedgerAccount[]).filter((category) => category.category === "income" && category.is_active));
      setEntries(entryRes.ok ? entry : []); setAdvances(advRes.ok ? adv : []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load money-in workspace"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (loading || preselectionApplied || !invoices.length || typeof window === "undefined") return;
    const invoiceId = new URLSearchParams(window.location.search).get("invoice_id");
    if (invoiceId) {
      const invoice = invoices.find((item) => item.id === invoiceId);
      if (invoice) {
        setSourceType("invoice");
        setForm((current) => ({ ...current, source_id: invoice.id, amount: String(invoice.balance_due) }));
        setMessage(`Ready to collect ${invoice.invoice_number} from ${invoice.client_name}. Choose where the money was received and review before posting.`);
      }
    }
    setPreselectionApplied(true);
  }, [loading, invoices, preselectionApplied]);

  const sourceInvoice = useMemo(() => sourceType === "invoice" ? invoices.find((invoice) => invoice.id === form.source_id) ?? null : sourceType === "project" ? invoices.find((invoice) => invoice.project_id === form.source_id) ?? null : sourceType === "order" ? invoices.find((invoice) => invoice.order_id === form.source_id) ?? null : null, [sourceType, form.source_id, invoices]);
  const selectedProject = projects.find((project) => project.id === form.source_id);
  const selectedOrder = orders.find((order) => order.id === form.source_id);
  const selectedClient = clients.find((client) => client.id === form.source_id);
  const selectedAccount = accounts.find((account) => account.id === form.account_id) ?? null;
  const selectedCategory = categories.find((category) => category.id === form.category_id) ?? null;
  const sourceCurrency = sourceInvoice?.currency ?? selectedProject?.currency ?? selectedOrder?.currency ?? selectedClient?.currency ?? selectedAccount?.currency ?? "";
  const compatibleAccounts = accounts.filter((account) => !sourceCurrency || account.currency === sourceCurrency);
  const isDirty = Boolean(form.source_id || form.account_id || form.amount || form.category_id || form.description || form.reference || form.notes || relationType || relationId);
  useUnsavedChanges(isDirty && !saving);

  const invoiceOptions = useMemo(() => invoices.map((invoice) => ({ value: invoice.id, label: `${invoice.invoice_number} · ${invoice.client_name} · due ${money(invoice.balance_due, invoice.currency)}`, keywords: `${invoice.invoice_number} ${invoice.client_name} ${invoice.subject ?? ""} ${invoice.currency}` })), [invoices]);
  const projectOptions = useMemo(() => projects.filter((project) => project.status !== "cancelled").map((project) => ({ value: project.id, label: `${project.number} · ${project.name} · ${money(project.contract_value, project.currency)}`, keywords: `${project.number} ${project.name} ${project.currency}` })), [projects]);
  const orderOptions = useMemo(() => orders.filter((order) => order.status !== "cancelled").map((order) => ({ value: order.id, label: `${order.number} · ${order.client_name} · ${money(order.total, order.currency)}`, keywords: `${order.number} ${order.client_name} ${order.currency}` })), [orders]);
  const clientOptions = useMemo(() => clients.map((client) => ({ value: client.id, label: `${client.code} · ${client.name}${client.currency ? ` · ${client.currency}` : ""}`, keywords: `${client.code} ${client.name} ${client.currency ?? ""}` })), [clients]);
  const categoryOptions = useMemo(() => categories.map((category) => ({ value: category.id, label: category.name })), [categories]);
  const accountOptions = useMemo(() => compatibleAccounts.map((account) => ({ value: account.id, label: `${account.name} · ${money(account.current_balance, account.currency)}`, keywords: `${account.name} ${account.currency} ${account.account_type}` })), [compatibleAccounts]);
  const relationOptions = useMemo(() => relationType === "client" ? clientOptions : relationType === "order" ? orders.map((order) => ({ value: order.id, label: `${order.number} · ${order.client_name} · ${money(order.total, order.currency)}`, keywords: `${order.number} ${order.client_name} ${order.currency}` })) : relationType === "project" ? projects.map((project) => ({ value: project.id, label: `${project.number} · ${project.name} · ${money(project.contract_value, project.currency)}`, keywords: `${project.number} ${project.name} ${project.currency}` })) : [], [relationType, clientOptions, orders, projects]);
  const relationLabel = relationType === "client" ? clients.find((item) => item.id === relationId)?.name : relationType === "order" ? orders.find((item) => item.id === relationId)?.number : relationType === "project" ? projects.find((item) => item.id === relationId)?.number : null;

  function reset(type: SourceType) {
    if (!confirmDiscardChanges(isDirty, "Changing the money source will discard the current form. Continue?")) return;
    setSourceType(type); setRelationType(""); setRelationId(""); setForm(blankForm()); setError(null); setMessage(null); setConfirmOpen(false);
  }

  async function ensureInvoice(): Promise<Invoice> {
    if (sourceInvoice) return sourceInvoice;
    if (sourceType !== "project" && sourceType !== "order") throw new Error("Select an invoice");
    const createPath = sourceType === "project" ? `/api/finance/invoices/from-project/${form.source_id}` : `/api/finance/invoices/from-order/${form.source_id}`;
    const createdRes = await fetch(createPath, { method: "POST" }); const created = await createdRes.json();
    if (!createdRes.ok) throw new Error(getApiErrorMessage(created, "Could not create invoice from source"));
    const sendRes = await fetch(`/api/finance/invoices/${created.id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "send" }) });
    const sent = await sendRes.json(); if (!sendRes.ok) throw new Error(getApiErrorMessage(sent, "Could not activate invoice for payment"));
    return sent as Invoice;
  }

  function review(event: FormEvent) {
    event.preventDefault(); setError(null); setMessage(null);
    if (sourceType === "other" && relationType && !relationId) {
      setError("Select the related client, order or project, or choose no relationship.");
      return;
    }
    setConfirmOpen(true);
  }

  async function postMoneyIn() {
    setSaving(true); setError(null); setMessage(null);
    try {
      if (sourceType === "advance") {
        const response = await fetch("/api/accounting/customer-advances", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: form.source_id, financial_account_id: form.account_id, advance_date: form.date, amount: Number(form.amount), reference: form.reference || null, notes: form.notes || null }) });
        const payload = await response.json(); if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not record client advance"));
        setMessage(`Client advance recorded for ${payload.client_name}. It is held as customer credit, not income, until applied to an invoice.`);
      } else if (sourceType === "other") {
        const response = await fetch("/api/accounting/money", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "income", entry_date: form.date, financial_account_id: form.account_id, category_ledger_account_id: form.category_id, amount: Number(form.amount), description: form.description, reference: form.reference || null, notes: form.notes || null, source_type: relationType || null, source_id: relationId || null }) });
        const payload = await response.json(); if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not record income"));
        setMessage("Income recorded. Account balance, accounting ledger and business relationship were updated.");
      } else {
        const invoice = sourceType === "invoice" ? (sourceInvoice ?? (() => { throw new Error("Select an invoice"); })()) : await ensureInvoice();
        const response = await fetch("/api/finance/payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invoice_id: invoice.id, account_id: form.account_id, payment_date: form.date, invoice_amount: Number(form.amount), method: form.method, reference: form.reference || null, notes: form.notes || null }) });
        const payload = await response.json(); if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not record payment"));
        setMessage(`Payment ${payload.payment_number} recorded and linked to ${invoice.invoice_number}.`);
      }
      setConfirmOpen(false); setRelationType(""); setRelationId(""); setForm(blankForm()); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not record money received"); setConfirmOpen(false); }
    finally { setSaving(false); }
  }

  const sourceLabel = sourceType === "invoice" ? sourceInvoice ? `${sourceInvoice.invoice_number} · ${sourceInvoice.client_name}` : "Invoice payment" : sourceType === "project" ? selectedProject ? `${selectedProject.number} · ${selectedProject.name}` : "Project payment" : sourceType === "order" ? selectedOrder ? `${selectedOrder.number} · ${selectedOrder.client_name}` : "Order payment" : sourceType === "advance" ? selectedClient ? `${selectedClient.code} · ${selectedClient.name}` : "Client advance" : selectedCategory?.name || "Other income";
  const confirmationDetails = [
    { label: "Business event", value: sourceCards.find((item) => item.value === sourceType)?.title ?? sourceType },
    { label: "Source", value: sourceLabel },
    ...(sourceType === "other" && relationLabel ? [{ label: "Related to", value: relationLabel }] : []),
    { label: "Amount", value: money(form.amount || 0, sourceCurrency || selectedAccount?.currency || ""), emphasis: true },
    { label: "Account", value: selectedAccount?.name || "—" },
    { label: "Date", value: form.date },
    ...(sourceType !== "advance" && sourceType !== "other" ? [{ label: "Payment method", value: form.method.replaceAll("_", " ") }] : []),
    ...(form.reference ? [{ label: "Reference", value: form.reference }] : []),
  ];

  return <main className="p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-7xl space-y-6">
    <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Finance & Accounts</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Money in</h1><p className="mt-2 max-w-3xl text-sm text-neutral-500">Tell Business OS where the money came from. Sales payments, advances and other income are handled differently automatically.</p></div>
    <AccountingNav />
    {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
    <section className="rounded-2xl border bg-white p-5"><h2 className="text-lg font-semibold">Where did this money come from?</h2><p className="mt-1 text-sm text-neutral-500">Choose the real business event. Business OS handles the accounting in the background.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{sourceCards.map(({ value, title, help, icon: Icon }) => <button key={value} type="button" onClick={() => reset(value)} className={`rounded-2xl border p-4 text-left transition ${sourceType === value ? "border-neutral-950 bg-neutral-950 text-white" : "bg-white hover:bg-neutral-50"}`}><Icon className="size-5" /><p className="mt-3 font-semibold">{title}</p><p className={`mt-1 text-xs ${sourceType === value ? "text-neutral-300" : "text-neutral-500"}`}>{help}</p></button>)}</div>
      {sourceType === "project" || sourceType === "order" ? <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800"><strong>Invoice-backed payment.</strong> This does not post separate income. Business OS will use the linked invoice, or create and send one after confirmation, then record this money as an invoice payment.</div> : null}
      <form onSubmit={review} className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {sourceType === "invoice" ? <SearchableSelect label="Invoice" required clearable={false} value={form.source_id} onValueChange={(value) => setForm((current) => ({ ...current, source_id: value, amount: "" }))} options={invoiceOptions} placeholder="Select outstanding invoice" searchPlaceholder="Search invoice or client..." /> : null}
        {sourceType === "project" ? <div><SearchableSelect label="Project" required clearable={false} value={form.source_id} onValueChange={(value) => setForm((current) => ({ ...current, source_id: value, amount: "" }))} options={projectOptions} placeholder="Select project" searchPlaceholder="Search project..." /><Hint>{sourceInvoice ? `Payment will update ${sourceInvoice.invoice_number} and reduce its balance due.` : "No open invoice exists. After final confirmation, Business OS will create and send the project invoice, then record this payment against it."}</Hint></div> : null}
        {sourceType === "order" ? <div><SearchableSelect label="Order" required clearable={false} value={form.source_id} onValueChange={(value) => setForm((current) => ({ ...current, source_id: value, amount: "" }))} options={orderOptions} placeholder="Select order" searchPlaceholder="Search order or client..." /><Hint>{sourceInvoice ? `Payment will update ${sourceInvoice.invoice_number} and reduce its balance due.` : "No open invoice exists. After final confirmation, Business OS will create and send the order invoice, then record this payment against it."}</Hint></div> : null}
        {sourceType === "advance" ? <div><SearchableSelect label="Client" required clearable={false} value={form.source_id} onValueChange={(value) => setForm((current) => ({ ...current, source_id: value, amount: "" }))} options={clientOptions} placeholder="Select client" searchPlaceholder="Search client..." /><Hint>This is customer credit, not revenue. Apply it later from Receivables.</Hint></div> : null}
        {sourceType === "other" ? <SearchableSelect label="Income category" required clearable={false} value={form.category_id} onValueChange={(value) => setForm((current) => ({ ...current, category_id: value }))} options={categoryOptions} placeholder="Select category" searchPlaceholder="Search income category..." /> : null}
        {sourceType === "other" ? <Field label="Related business record (optional)"><select value={relationType} onChange={(event) => { setRelationType(event.target.value as RelationType); setRelationId(""); }} className="w-full rounded-xl border bg-white px-3 py-2.5"><option value="">No relationship</option><option value="client">Client</option><option value="order">Order</option><option value="project">Project</option></select><Hint>Use this for tips, bonuses or other income that belongs to a client, order or project.</Hint></Field> : null}
        {sourceType === "other" && relationType ? <SearchableSelect label={`Related ${relationType}`} required clearable={false} value={relationId} onValueChange={setRelationId} options={relationOptions} placeholder={`Select ${relationType}`} searchPlaceholder={`Search ${relationType}...`} /> : null}
        <SearchableSelect label="Money received into" required clearable={false} value={form.account_id} onValueChange={(value) => setForm((current) => ({ ...current, account_id: value }))} options={accountOptions} placeholder="Select account" searchPlaceholder="Search bank, cash or wallet..." />
        <MoneyInput label="Amount received" currency={sourceCurrency} required min={0.01} max={sourceInvoice ? Number(sourceInvoice.balance_due) : undefined} value={form.amount} onValueChange={(value) => setForm((current) => ({ ...current, amount: value }))} hint={sourceInvoice ? `Maximum currently due: ${money(sourceInvoice.balance_due, sourceInvoice.currency)}` : undefined} />
        <Field label="Date"><input required type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
        {sourceType !== "other" && sourceType !== "advance" ? <Field label="Payment method"><select value={form.method} onChange={(event) => setForm((current) => ({ ...current, method: event.target.value }))} className="w-full rounded-xl border bg-white px-3 py-2.5"><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="card">Card</option><option value="payoneer">Payoneer</option><option value="wise">Wise</option><option value="stripe">Stripe</option><option value="paypal">PayPal</option><option value="other">Other</option></select></Field> : null}
        {sourceType === "other" ? <Field label="Description"><input required value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5" placeholder="Tip, bonus, referral income..." /></Field> : null}
        <Field label="Reference (optional)"><input value={form.reference} onChange={(event) => setForm((current) => ({ ...current, reference: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
        <div className="flex justify-end md:col-span-2 lg:col-span-3"><button disabled={saving || loading} className="inline-flex items-center gap-2 rounded-xl bg-neutral-950 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"><ArrowDownLeft className="size-4" />Review money received</button></div>
      </form>
    </section>
    <section className="grid gap-4 lg:grid-cols-2"><div className="rounded-2xl border bg-white p-5"><h2 className="font-semibold">Open client advances</h2><p className="mt-1 text-sm text-neutral-500">Money received before invoicing. It remains customer credit until applied.</p><div className="mt-3 divide-y">{advances.slice(0, 8).map((advance) => <div key={advance.id} className="flex items-center justify-between gap-3 py-3"><div><p className="font-medium">{advance.client_name}</p><p className="text-xs text-neutral-400">{advance.advance_date} · {advance.financial_account_name}</p></div><p className="font-semibold">{money(advance.remaining_amount, advance.currency)}</p></div>)}{!loading && !advances.length ? <p className="py-8 text-center text-sm text-neutral-400">No open client advances.</p> : null}</div></div><div className="rounded-2xl border bg-white p-5"><h2 className="font-semibold">Recent other income</h2><p className="mt-1 text-sm text-neutral-500">Direct income can optionally be attributed to a client, order or project.</p><div className="mt-3 divide-y">{entries.slice(0, 8).map((entry) => <div key={entry.id} className="flex items-center justify-between gap-3 py-3"><div><p className="font-medium">{entry.description}</p><p className="text-xs text-neutral-400">{entry.entry_date} · {entry.financial_account_name}{entry.source_label ? ` · ${entry.source_label}` : ""}</p></div><p className="font-semibold">{money(entry.amount, entry.currency)}</p></div>)}{!loading && !entries.length ? <p className="py-8 text-center text-sm text-neutral-400">No direct income records yet.</p> : null}</div></div></section>
  </div>
  <FinancialConfirmationDialog open={confirmOpen} title="Post money received?" description="Check the business event, amount and destination account. Once posted, the transaction updates financial balances and accounting records." details={confirmationDetails} confirmLabel="Post money received" loading={saving} warning="Posted financial transactions should be corrected by reversal/correction, not by silently editing history." onCancel={() => setConfirmOpen(false)} onConfirm={postMoneyIn} />
  </main>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="text-sm"><span className="mb-1.5 block font-medium text-neutral-600">{label}</span>{children}</label>; }
function Hint({ children }: { children: React.ReactNode }) { return <span className="mt-1 block text-xs font-normal text-neutral-400">{children}</span>; }
