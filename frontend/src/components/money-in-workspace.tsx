"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownLeft,
  CheckCircle2,
  FileText,
  FolderKanban,
  Info,
  ReceiptText,
  RefreshCw,
  ShoppingBag,
  UserRound,
  WalletCards,
} from "lucide-react";

import { FinancialConfirmationDialog } from "@/components/financial-confirmation-dialog";
import { MoneyInput } from "@/components/money-input";
import { SearchableSelect } from "@/components/searchable-select";
import { AppPage, PageHeader, SectionHeader, Surface } from "@/components/ui/app-page";
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

function today() {
  return new Date().toISOString().slice(0, 10);
}

function money(value: string | number, currency: string) {
  return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function blankForm(): MoneyInForm {
  return { source_id: "", account_id: "", amount: "", date: today(), method: "bank_transfer", category_id: "", description: "", reference: "", notes: "" };
}

const sourceCards = [
  { value: "invoice" as SourceType, title: "Invoice payment", help: "Collect against an existing invoice and reduce its balance due.", icon: FileText },
  { value: "project" as SourceType, title: "Project payment", help: "Use or create the project invoice, then record its payment.", icon: FolderKanban },
  { value: "order" as SourceType, title: "Order payment", help: "Use or create the order invoice, then record its payment.", icon: ShoppingBag },
  { value: "advance" as SourceType, title: "Client advance", help: "Receive customer credit before invoicing. This is not revenue yet.", icon: UserRound },
  { value: "other" as SourceType, title: "Other income", help: "Record tips, bonuses or other income without an invoice.", icon: ReceiptText },
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
  const postingKeyRef = useRef<string | null>(null);

  useEffect(() => {
    postingKeyRef.current = null;
  }, [sourceType, relationType, relationId, form]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
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
      setClients(typed.clients);
      setProjects(typed.projects);
      setOrders(typed.orders);
      setInvoices((inv.items ?? []).filter((invoice: Invoice) => Number(invoice.balance_due) > 0 && !["draft", "cancelled", "paid"].includes(invoice.status)));
      setCategories((coa as LedgerAccount[]).filter((category) => category.category === "income" && category.is_active));
      setEntries(entryRes.ok ? entry : []);
      setAdvances(advRes.ok ? adv : []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load money-in workspace");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  const sourceInvoice = useMemo(
    () => sourceType === "invoice"
      ? invoices.find((invoice) => invoice.id === form.source_id) ?? null
      : sourceType === "project"
        ? invoices.find((invoice) => invoice.project_id === form.source_id) ?? null
        : sourceType === "order"
          ? invoices.find((invoice) => invoice.order_id === form.source_id) ?? null
          : null,
    [sourceType, form.source_id, invoices],
  );
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
  const relationOptions = useMemo(() => relationType === "client"
    ? clientOptions
    : relationType === "order"
      ? orders.map((order) => ({ value: order.id, label: `${order.number} · ${order.client_name} · ${money(order.total, order.currency)}`, keywords: `${order.number} ${order.client_name} ${order.currency}` }))
      : relationType === "project"
        ? projects.map((project) => ({ value: project.id, label: `${project.number} · ${project.name} · ${money(project.contract_value, project.currency)}`, keywords: `${project.number} ${project.name} ${project.currency}` }))
        : [], [relationType, clientOptions, orders, projects]);
  const relationLabel = relationType === "client"
    ? clients.find((item) => item.id === relationId)?.name
    : relationType === "order"
      ? orders.find((item) => item.id === relationId)?.number
      : relationType === "project"
        ? projects.find((item) => item.id === relationId)?.number
        : null;

  function reset(type: SourceType) {
    if (!confirmDiscardChanges(isDirty, "Changing the money source will discard the current form. Continue?")) return;
    setSourceType(type);
    setRelationType("");
    setRelationId("");
    setForm(blankForm());
    setError(null);
    setMessage(null);
    setConfirmOpen(false);
  }

  async function ensureInvoice(): Promise<Invoice> {
    if (sourceInvoice) return sourceInvoice;
    if (sourceType !== "project" && sourceType !== "order") throw new Error("Select an invoice");
    const createPath = sourceType === "project" ? `/api/finance/invoices/from-project/${form.source_id}` : `/api/finance/invoices/from-order/${form.source_id}`;
    const createdRes = await fetch(createPath, { method: "POST" });
    const created = await createdRes.json();
    if (!createdRes.ok) throw new Error(getApiErrorMessage(created, "Could not create invoice from source"));
    const sendRes = await fetch(`/api/finance/invoices/${created.id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "send" }) });
    const sent = await sendRes.json();
    if (!sendRes.ok) throw new Error(getApiErrorMessage(sent, "Could not activate invoice for payment"));
    return sent as Invoice;
  }

  function review(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (sourceType === "other" && relationType && !relationId) {
      setError("Select the related client, order or project, or choose no relationship.");
      return;
    }
    setConfirmOpen(true);
  }

  async function postMoneyIn() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const idempotencyKey = postingKeyRef.current ?? crypto.randomUUID();
      postingKeyRef.current = idempotencyKey;
      const mutationHeaders = { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey };
      if (sourceType === "advance") {
        const response = await fetch("/api/accounting/customer-advances", { method: "POST", headers: mutationHeaders, body: JSON.stringify({ client_id: form.source_id, financial_account_id: form.account_id, advance_date: form.date, amount: Number(form.amount), reference: form.reference || null, notes: form.notes || null }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not record client advance"));
        setMessage(`Client advance recorded for ${payload.client_name}. It is held as customer credit, not income, until applied to an invoice.`);
      } else if (sourceType === "other") {
        const response = await fetch("/api/accounting/money", { method: "POST", headers: mutationHeaders, body: JSON.stringify({ kind: "income", entry_date: form.date, financial_account_id: form.account_id, category_ledger_account_id: form.category_id, amount: Number(form.amount), description: form.description, reference: form.reference || null, notes: form.notes || null, source_type: relationType || null, source_id: relationId || null }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not record income"));
        setMessage("Income recorded. Account balance, accounting ledger and business relationship were updated.");
      } else {
        const invoice = sourceType === "invoice" ? (sourceInvoice ?? (() => { throw new Error("Select an invoice"); })()) : await ensureInvoice();
        const response = await fetch("/api/finance/payments", { method: "POST", headers: mutationHeaders, body: JSON.stringify({ invoice_id: invoice.id, account_id: form.account_id, payment_date: form.date, invoice_amount: Number(form.amount), method: form.method, reference: form.reference || null, notes: form.notes || null }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not record payment"));
        setMessage(`Payment ${payload.payment_number} recorded and linked to ${invoice.invoice_number}.`);
      }
      setConfirmOpen(false);
      setRelationType("");
      setRelationId("");
      postingKeyRef.current = null;
      setForm(blankForm());
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not record money received");
      setConfirmOpen(false);
    } finally {
      setSaving(false);
    }
  }

  const sourceLabel = sourceType === "invoice"
    ? sourceInvoice ? `${sourceInvoice.invoice_number} · ${sourceInvoice.client_name}` : "Invoice payment"
    : sourceType === "project"
      ? selectedProject ? `${selectedProject.number} · ${selectedProject.name}` : "Project payment"
      : sourceType === "order"
        ? selectedOrder ? `${selectedOrder.number} · ${selectedOrder.client_name}` : "Order payment"
        : sourceType === "advance"
          ? selectedClient ? `${selectedClient.code} · ${selectedClient.name}` : "Client advance"
          : selectedCategory?.name || "Other income";
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

  return (
    <AppPage width="wide">
      <div className="space-y-6">
        <PageHeader
          eyebrow="Finance & Accounts"
          title="Money in"
          description="Record how money entered the business. Choose the real business event first; Business OS keeps invoice, customer-credit and accounting treatment separate automatically."
          meta={
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2.5 py-1"><CheckCircle2 className="size-3.5 text-emerald-600" /> Double-entry protected</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2.5 py-1"><WalletCards className="size-3.5" /> Currency-matched accounts only</span>
            </>
          }
        />

        {error ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between">
            <span>{error}</span>
            <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 self-start rounded-xl border border-red-200 bg-white px-3 py-2 font-medium text-red-700 sm:self-auto">
              <RefreshCw className="size-4" /> Retry
            </button>
          </div>
        ) : null}
        {message ? <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 size-4 shrink-0" /><span>{message}</span></div> : null}

        <section className="grid gap-3 sm:grid-cols-3">
          <Metric label="Outstanding invoices" value={loading ? "—" : invoices.length.toLocaleString()} help="Invoices currently available for collection" />
          <Metric label="Open client advances" value={loading ? "—" : advances.length.toLocaleString()} help="Customer credit not yet applied to invoices" />
          <Metric label="Receiving accounts" value={loading ? "—" : accounts.length.toLocaleString()} help="Active non-credit-card accounts" />
        </section>

        <Surface className="overflow-hidden">
          <div className="border-b border-neutral-200/80 p-5 sm:p-6">
            <SectionHeader
              title="1. Choose the business event"
              description="The event type decides how receivables, revenue and customer credit are posted."
            />
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {sourceCards.map(({ value, title, help, icon: Icon }) => {
                const active = sourceType === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => reset(value)}
                    aria-pressed={active}
                    className={`group rounded-2xl border p-4 text-left transition ${active ? "border-neutral-950 bg-neutral-950 text-white shadow-sm" : "border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50"}`}
                  >
                    <div className={`flex size-9 items-center justify-center rounded-xl ${active ? "bg-white/10" : "bg-neutral-100 text-neutral-700"}`}><Icon className="size-4.5" /></div>
                    <p className="mt-4 text-sm font-semibold">{title}</p>
                    <p className={`mt-1.5 text-xs leading-5 ${active ? "text-neutral-300" : "text-neutral-500"}`}>{help}</p>
                  </button>
                );
              })}
            </div>
            {sourceType === "project" || sourceType === "order" ? (
              <div className="mt-4 flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-900">
                <Info className="mt-1 size-4 shrink-0" />
                <p><strong>Invoice-backed payment.</strong> This does not post separate income. Business OS uses the linked invoice, or creates and sends one after confirmation, then records this as an invoice payment.</p>
              </div>
            ) : null}
          </div>

          {loading ? (
            <div className="grid gap-4 p-5 sm:p-6 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-20 animate-pulse rounded-2xl bg-neutral-100" />)}
            </div>
          ) : (
            <form onSubmit={review}>
              <div className="grid gap-6 p-5 sm:p-6 xl:grid-cols-[minmax(0,1fr)_340px]">
                <div className="space-y-6">
                  <FormGroup title="2. Identify the source" description="Select the invoice, project, order, client or income category that explains this receipt.">
                    <div className="grid gap-4 md:grid-cols-2">
                      {sourceType === "invoice" ? <SearchableSelect label="Invoice" required clearable={false} value={form.source_id} onValueChange={(value) => setForm((current) => ({ ...current, source_id: value, amount: "" }))} options={invoiceOptions} placeholder="Select outstanding invoice" searchPlaceholder="Search invoice or client..." /> : null}
                      {sourceType === "project" ? <div><SearchableSelect label="Project" required clearable={false} value={form.source_id} onValueChange={(value) => setForm((current) => ({ ...current, source_id: value, amount: "" }))} options={projectOptions} placeholder="Select project" searchPlaceholder="Search project..." /><Hint>{sourceInvoice ? `Payment will update ${sourceInvoice.invoice_number} and reduce its balance due.` : "No open invoice exists. After confirmation, Business OS will create and send the project invoice before recording payment."}</Hint></div> : null}
                      {sourceType === "order" ? <div><SearchableSelect label="Order" required clearable={false} value={form.source_id} onValueChange={(value) => setForm((current) => ({ ...current, source_id: value, amount: "" }))} options={orderOptions} placeholder="Select order" searchPlaceholder="Search order or client..." /><Hint>{sourceInvoice ? `Payment will update ${sourceInvoice.invoice_number} and reduce its balance due.` : "No open invoice exists. After confirmation, Business OS will create and send the order invoice before recording payment."}</Hint></div> : null}
                      {sourceType === "advance" ? <div><SearchableSelect label="Client" required clearable={false} value={form.source_id} onValueChange={(value) => setForm((current) => ({ ...current, source_id: value, amount: "" }))} options={clientOptions} placeholder="Select client" searchPlaceholder="Search client..." /><Hint>This remains customer credit, not revenue, until it is applied to an invoice.</Hint></div> : null}
                      {sourceType === "other" ? <SearchableSelect label="Income category" required clearable={false} value={form.category_id} onValueChange={(value) => setForm((current) => ({ ...current, category_id: value }))} options={categoryOptions} placeholder="Select category" searchPlaceholder="Search income category..." /> : null}
                      {sourceType === "other" ? <Field label="Related business record (optional)"><select value={relationType} onChange={(event) => { setRelationType(event.target.value as RelationType); setRelationId(""); }} className={controlClass}><option value="">No relationship</option><option value="client">Client</option><option value="order">Order</option><option value="project">Project</option></select><Hint>Attribute direct income to a client, order or project when appropriate.</Hint></Field> : null}
                      {sourceType === "other" && relationType ? <SearchableSelect label={`Related ${relationType}`} required clearable={false} value={relationId} onValueChange={setRelationId} options={relationOptions} placeholder={`Select ${relationType}`} searchPlaceholder={`Search ${relationType}...`} /> : null}
                    </div>
                  </FormGroup>

                  <FormGroup title="3. Receiving details" description="Record where the funds arrived, the amount received and the transaction date.">
                    <div className="grid gap-4 md:grid-cols-2">
                      <SearchableSelect label="Money received into" required clearable={false} value={form.account_id} onValueChange={(value) => setForm((current) => ({ ...current, account_id: value }))} options={accountOptions} placeholder="Select account" searchPlaceholder="Search bank, cash or wallet..." />
                      <MoneyInput label="Amount received" currency={sourceCurrency} required min={0.01} max={sourceInvoice ? Number(sourceInvoice.balance_due) : undefined} value={form.amount} onValueChange={(value) => setForm((current) => ({ ...current, amount: value }))} hint={sourceInvoice ? `Maximum currently due: ${money(sourceInvoice.balance_due, sourceInvoice.currency)}` : undefined} />
                      <Field label="Date"><input required type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} className={controlClass} /></Field>
                      {sourceType !== "other" && sourceType !== "advance" ? <Field label="Payment method"><select value={form.method} onChange={(event) => setForm((current) => ({ ...current, method: event.target.value }))} className={controlClass}><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="card">Card</option><option value="payoneer">Payoneer</option><option value="wise">Wise</option><option value="stripe">Stripe</option><option value="paypal">PayPal</option><option value="other">Other</option></select></Field> : null}
                      {sourceType === "other" ? <Field label="Description"><input required value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className={controlClass} placeholder="Tip, bonus, referral income..." /></Field> : null}
                      <Field label="Reference (optional)"><input value={form.reference} onChange={(event) => setForm((current) => ({ ...current, reference: event.target.value }))} className={controlClass} placeholder="Bank reference, transaction ID..." /></Field>
                      <div className="md:col-span-2"><Field label="Internal notes (optional)"><textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} className={`${controlClass} min-h-24 resize-y`} placeholder="Internal context for this receipt" /></Field></div>
                    </div>
                    {sourceCurrency && !compatibleAccounts.length ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">No active receiving account uses {sourceCurrency}. Add a {sourceCurrency} financial account before posting this receipt.</div> : null}
                  </FormGroup>
                </div>

                <aside className="self-start rounded-2xl border border-neutral-200 bg-neutral-50/70 p-5 xl:sticky xl:top-6">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-400">Posting preview</p>
                  <h3 className="mt-2 text-base font-semibold text-neutral-950">Review before confirmation</h3>
                  <div className="mt-5 space-y-4 text-sm">
                    <PreviewRow label="Business event" value={sourceCards.find((item) => item.value === sourceType)?.title ?? sourceType} />
                    <PreviewRow label="Source" value={sourceLabel} />
                    <PreviewRow label="Currency" value={sourceCurrency || "Select a source/account"} />
                    <PreviewRow label="Receiving account" value={selectedAccount?.name || "Not selected"} />
                    <PreviewRow label="Amount" value={form.amount ? money(form.amount, sourceCurrency || selectedAccount?.currency || "") : "Not entered"} strong />
                  </div>
                  <div className="mt-5 border-t border-neutral-200 pt-4 text-xs leading-5 text-neutral-500">
                    {sourceType === "advance" ? "Customer advances remain a liability/customer credit until applied to an invoice." : sourceType === "other" ? "Direct income posts to the selected income category and receiving account." : "Invoice-backed receipts reduce receivables and increase the selected financial account."}
                  </div>
                  <button disabled={saving || loading || Boolean(sourceCurrency && !compatibleAccounts.length)} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50">
                    <ArrowDownLeft className="size-4" /> Review money received
                  </button>
                </aside>
              </div>
            </form>
          )}
        </Surface>

        <section className="grid gap-4 xl:grid-cols-2">
          <Surface className="p-5 sm:p-6">
            <SectionHeader title="Open client advances" description="Customer funds received before invoicing. Each amount remains separate in its own currency." />
            <div className="mt-4 divide-y divide-neutral-100">
              {loading ? <ActivitySkeleton /> : advances.slice(0, 8).map((advance) => <div key={advance.id} className="flex items-start justify-between gap-4 py-3.5"><div className="min-w-0"><p className="truncate text-sm font-medium text-neutral-900">{advance.client_name}</p><p className="mt-1 text-xs text-neutral-400">{advance.advance_date} · {advance.financial_account_name}</p></div><p className="shrink-0 text-sm font-semibold tabular-nums text-neutral-950">{money(advance.remaining_amount, advance.currency)}</p></div>)}
              {!loading && !advances.length ? <EmptyActivity icon={<UserRound className="size-5" />} title="No open client advances" description="Advance receipts that still need to be applied will appear here." /> : null}
            </div>
          </Surface>

          <Surface className="p-5 sm:p-6">
            <SectionHeader title="Recent direct income" description="Non-invoice income with optional client, order or project attribution." />
            <div className="mt-4 divide-y divide-neutral-100">
              {loading ? <ActivitySkeleton /> : entries.slice(0, 8).map((entry) => <div key={entry.id} className="flex items-start justify-between gap-4 py-3.5"><div className="min-w-0"><p className="truncate text-sm font-medium text-neutral-900">{entry.description}</p><p className="mt-1 text-xs text-neutral-400">{entry.entry_date} · {entry.financial_account_name}{entry.source_label ? ` · ${entry.source_label}` : ""}</p></div><p className="shrink-0 text-sm font-semibold tabular-nums text-neutral-950">{money(entry.amount, entry.currency)}</p></div>)}
              {!loading && !entries.length ? <EmptyActivity icon={<ReceiptText className="size-5" />} title="No direct income records" description="Income that is not tied to an invoice will appear here." /> : null}
            </div>
          </Surface>
        </section>
      </div>

      <FinancialConfirmationDialog
        open={confirmOpen}
        title="Post money received?"
        description="Check the business event, amount and destination account. Once posted, the transaction updates financial balances and accounting records."
        details={confirmationDetails}
        confirmLabel="Post money received"
        loading={saving}
        warning="Posted financial transactions should be corrected by reversal/correction, not by silently editing history."
        onCancel={() => setConfirmOpen(false)}
        onConfirm={postMoneyIn}
      />
    </AppPage>
  );
}

const controlClass = "w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-950 outline-none transition placeholder:text-neutral-400 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100";

function Metric({ label, value, help }: { label: string; value: string; help: string }) {
  return <Surface className="p-4 sm:p-5"><p className="text-xs font-medium text-neutral-500">{label}</p><p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-neutral-950">{value}</p><p className="mt-1 text-xs leading-5 text-neutral-400">{help}</p></Surface>;
}

function FormGroup({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section><div className="mb-4"><h3 className="text-sm font-semibold text-neutral-950">{title}</h3><p className="mt-1 text-xs leading-5 text-neutral-500">{description}</p></div>{children}</section>;
}

function PreviewRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className="flex items-start justify-between gap-4"><span className="text-neutral-500">{label}</span><span className={`max-w-[190px] text-right ${strong ? "font-semibold text-neutral-950" : "font-medium text-neutral-800"}`}>{value}</span></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="text-sm"><span className="mb-1.5 block font-medium text-neutral-700">{label}</span>{children}</label>;
}

function Hint({ children }: { children: React.ReactNode }) {
  return <span className="mt-1.5 block text-xs font-normal leading-5 text-neutral-400">{children}</span>;
}

function ActivitySkeleton() {
  return <div className="space-y-3 py-2">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-12 animate-pulse rounded-xl bg-neutral-100" />)}</div>;
}

function EmptyActivity({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return <div className="py-8 text-center"><div className="mx-auto flex size-10 items-center justify-center rounded-xl bg-neutral-100 text-neutral-400">{icon}</div><p className="mt-3 text-sm font-medium text-neutral-700">{title}</p><p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-neutral-400">{description}</p></div>;
}
