"use client";

import { formatMoneyExact, salesLinePreview, sumMoneyExact } from "@/lib/sales-money-preview";

import { appendUniqueInvoices, blankInvoiceFilters, INVOICE_STATUSES, invoiceRegisterUrl, verifiedInvoicePage, type InvoiceRegisterFilters, invoiceLocationKey, type InvoiceRegisterLocation } from "@/lib/invoice-register-navigation";

import Link from "next/link";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { FormEvent, useCallback, useEffect, useMemo, useState, useRef, useLayoutEffect } from "react";
import { Plus, Search, X } from "lucide-react";
import { AppPage, PageHeader } from "@/components/ui/app-page";
import { InvoiceCounts, InvoiceField as Field, InvoiceLineEditor, InvoiceRegister } from "@/components/invoices/invoice-ui";
import "@/components/invoices/invoice-design.css";

import { SearchableSelect } from "@/components/searchable-select";
import { getApiErrorMessage } from "@/lib/api-error";
import { CURRENCY_OPTIONS } from "@/lib/company-options";

type Source = "client" | "order" | "project";
type PaymentMethod = "bank_transfer" | "cash" | "card" | "payoneer" | "wise" | "stripe" | "paypal" | "other";
type PaymentDestination = { id: string; name: string; account_type: string; provider_name: string | null; account_holder_name: string | null; account_reference: string | null; currency: string; payment_url: string | null; payment_instructions: string | null; gateway_connection_id?: string | null };
type PaymentForm = { method: PaymentMethod | ""; accountId: string; url: string; instructions: string };
const blankPayment = (): PaymentForm => ({ method: "", accountId: "", url: "", instructions: "" });
const paymentMethods: { value: PaymentMethod | ""; label: string }[] = [
  { value: "", label: "No payment instructions" }, { value: "bank_transfer", label: "Bank transfer" },
  { value: "payoneer", label: "Payoneer" }, { value: "wise", label: "Wise" },
  { value: "stripe", label: "Stripe" }, { value: "paypal", label: "PayPal" },
  { value: "card", label: "Card / payment link" }, { value: "cash", label: "Cash" }, { value: "other", label: "Other" },
];
function inferPaymentMethod(account: PaymentDestination): PaymentMethod {
  const provider = `${account.provider_name ?? ""} ${account.name}`.toLowerCase();
  if (provider.includes("payoneer")) return "payoneer";
  if (provider.includes("wise")) return "wise";
  if (provider.includes("stripe")) return "stripe";
  if (provider.includes("paypal")) return "paypal";
  if (account.account_type === "bank") return "bank_transfer";
  if (account.account_type === "cash" || account.account_type === "petty_cash") return "cash";
  return "other";
}
type Client = { id: string; code: string; name: string; currency: string | null };
type Order = { id: string; number: string; client_id: string; client_name: string; currency: string; total: string | number; status: string };
type Project = { id: string; number: string; order_id: string | null; client_id: string; name: string; currency: string; contract_value: string | number; status: string };
type Meta = { clients: Client[]; orders: Order[]; projects: Project[] };
type Invoice = { id: string; invoice_number: string; client_name: string; order_id: string | null; project_id: string | null; status: string; display_status: string; subject: string | null; issue_date: string; due_date: string | null; currency: string; total: string | number; amount_paid: string | number; balance_due: string | number };
type CatalogItem = { id: string; sku: string; name: string; description: string | null; item_type: string; unit: string; currency: string; selling_price: string | number; tax_code_id: string | null; is_active: boolean };
type TaxCode = { id: string; tax_kind: string; rate: string | number; is_active?: boolean };
type Line = { product_id: string | null; item_name: string; item_type: "service" | "non_stock_item"; unit: string; description: string; quantity: string; unit_price: string; discount_percent: string; tax_rate: string };

const blank = (): Line => ({ product_id: null, item_name: "", item_type: "service", unit: "unit", description: "", quantity: "1", unit_price: "0", discount_percent: "0", tax_rate: "0" });
const today = () => new Date().toISOString().slice(0, 10);
function money(value: string | number, currency: string) { return formatMoneyExact(value, currency); }
function pretty(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function lineTotal(line: Line, taxMode: string) { return salesLinePreview(line, taxMode)?.total ?? ""; }

export type InvoiceProtection = { pending: boolean; unknown: boolean; open: boolean };
type WorkspaceProps = {
  requestedClientId?: string | null; returnHref?: string | null;
  registerLocation?: InvoiceRegisterLocation;
  onRegisterLocationChange?: (location: InvoiceRegisterLocation) => void;
  createRequest?: number; initialSource?: Source;
  onProtectionChange?: (protection: InvoiceProtection) => void;
  registerProtectionGuard?: (guard: (() => InvoiceProtection) | null) => void;
};
export function InvoicesWorkspaceV2(props: WorkspaceProps = {}) {
  const { tenant } = useDashboardSession();
  return <InvoicesWorkspaceContent key={JSON.stringify([tenant?.organization?.id, tenant?.membership_id, tenant?.role_id, tenant?.permissions])} {...props} />;
}
export function InvoicesWorkspaceContent({ requestedClientId = null, returnHref, registerLocation, onRegisterLocationChange, createRequest = 0, initialSource = "project", onProtectionChange, registerProtectionGuard }: WorkspaceProps = {}) {
  const { tenant } = useDashboardSession();
  const scope = JSON.stringify([tenant?.organization?.id, tenant?.membership_id, tenant?.role_id, tenant?.permissions]);
  const activeScope = useRef<string | null>(scope), mounted = useRef(true), readEpoch = useRef(0), writePending = useRef(false), writeUnknown = useRef(false), writeAcknowledged = useRef(false);
  const activeClientIntent = useRef<string | null>(requestedClientId);
  useLayoutEffect(() => {
    registerProtectionGuard?.(() => ({ pending: writePending.current, unknown: writeUnknown.current, open: createOpen.current }));
    return () => registerProtectionGuard?.(null);
  }, [registerProtectionGuard]);
  useLayoutEffect(() => { activeClientIntent.current = requestedClientId; return () => { activeClientIntent.current = null; }; }, [requestedClientId]);
  useLayoutEffect(() => { const epoch = readEpoch; activeScope.current = scope; mounted.current = true; return () => { activeScope.current = null; mounted.current = false; ++epoch.current; }; }, [scope]);
  const ownsScope = useCallback(() => mounted.current && activeScope.current === scope, [scope]);
  const canView = Boolean(tenant?.permissions.some(value => value === "*" || value === "finance.view"));
  const canManage = Boolean(tenant?.permissions.some(value => value === "*" || value === "finance.manage"));
  const [unknownCreate, setUnknownCreate] = useState(false);
  const createOpen = useRef(false), setupAvailable = useRef(false);
  const [setupReady, setSetupReady] = useState(false);
  const draftGeneration = useRef(0);
  const consumedClientIntent = useRef<string | null>(null);
  const generation = draftGeneration.current;
  const canChangeDraft = () => createOpen.current && generation === draftGeneration.current && ownsScope() && canManage && !writePending.current && !writeUnknown.current && !writeAcknowledged.current;
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const cursorOwner = useRef<string | null>(null), registerPending = useRef(false);
  const appliedFilterOwner = useRef<InvoiceRegisterFilters>(registerLocation?.filters ?? blankInvoiceFilters());
  const startingCursor = useRef<string | null>(registerLocation?.cursor ?? null);
  const syncedLocation = useRef(invoiceLocationKey(registerLocation ?? { filters: blankInvoiceFilters(), cursor: null }));
  const [historyStartsAtCursor, setHistoryStartsAtCursor] = useState(Boolean(registerLocation?.cursor));
  const [appliedFilters, setAppliedFilters] = useState<InvoiceRegisterFilters>(() => registerLocation?.filters ?? blankInvoiceFilters());
  const [loadingMore, setLoadingMore] = useState(false);
  const [registerReady, setRegisterReady] = useState(false);
  const [meta, setMeta] = useState<Meta>({ clients: [], orders: [], projects: [] });
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [source, setSource] = useState<Source>(initialSource);
  const [form, setForm] = useState({ source_id: "", client_id: "", subject: "", issue_date: today(), due_date: "", currency: "", tax_calculation_mode: "exclusive", notes: "", terms_conditions: "", lines: [blank()] });
  const [payment, setPayment] = useState<PaymentForm>(blankPayment);
  const [destinations, setDestinations] = useState<PaymentDestination[]>([]);
  const [destinationsLoading, setDestinationsLoading] = useState(false);
  const [destinationsError, setDestinationsError] = useState<string | null>(null);
  const [query, setQuery] = useState(registerLocation?.filters.search ?? "");
  const [statusFilter, setStatusFilter] = useState(registerLocation?.filters.status ?? "all");
  const [currencyFilter, setCurrencyFilter] = useState(registerLocation?.filters.currency ?? "all");
  const [dueFilter, setDueFilter] = useState<"all" | "overdue" | "outstanding" | "paid">(registerLocation?.filters.balance ?? "all");

  const notifyLocation = useCallback((filters: InvoiceRegisterFilters, cursor: string | null) => {
    if (!onRegisterLocationChange) return;
    startingCursor.current = cursor;
    const location = { filters, cursor };
    syncedLocation.current = invoiceLocationKey(location);
    onRegisterLocationChange?.(location);
  }, [onRegisterLocationChange]);
  useEffect(() => { onProtectionChange?.({ pending: saving, unknown: unknownCreate, open: showForm }); }, [onProtectionChange, saving, unknownCreate, showForm]);

  const load = useCallback(async () => {
    if (!ownsScope() || !canView) return;
    const epoch = ++readEpoch.current;
    const current = () => ownsScope() && epoch === readEpoch.current;
    setHistoryStartsAtCursor(Boolean(startingCursor.current));
    registerPending.current = true; cursorOwner.current = null; setNextCursor(null); setInvoices([]); setRegisterReady(false); setLoadingMore(false);
    setLoading(true); setError(null); setSetupReady(false); setupAvailable.current = false;
    try {
      const requests = [
        canManage ? fetch("/api/finance/meta", { cache: "no-store" }) : null,
        fetch(invoiceRegisterUrl(appliedFilterOwner.current, startingCursor.current), { cache: "no-store" }),
        canManage ? fetch("/api/inventory/products", { cache: "no-store" }) : null,
        canManage ? fetch("/api/accounting/tax/codes", { cache: "no-store" }) : null,
      ];
      const results = await Promise.all(requests.map(async request => {
        try { const response = await request; return response ? { response, payload: await response.json().catch(() => null) } : null; }
        catch { return null; }
      }));
      if (!current()) return;
      const [metadata, register, products, taxes] = results;
      if (!register?.response.ok) throw new Error(getApiErrorMessage(register?.payload, "Could not load invoices"));
      const page = verifiedInvoicePage<Invoice>(register.payload);
      setInvoices(appendUniqueInvoices([], page.items)); setRegisterReady(true);
      cursorOwner.current = page.next_cursor; setNextCursor(page.next_cursor);
      if (canManage) {
        if (!metadata?.response.ok || !Array.isArray(metadata.payload?.clients) || !Array.isArray(metadata.payload?.orders) || !Array.isArray(metadata.payload?.projects) || !products?.response.ok || !Array.isArray(products.payload) || !taxes?.response.ok || !Array.isArray(taxes.payload)) {
          setMeta({ clients: [], orders: [], projects: [] }); setCatalog([]); setTaxCodes([]);
          setError("Invoices loaded, but creation setup is unavailable. Retry loading before creating a draft."); return;
        }
        setMeta(metadata.payload); setCatalog(products.payload); setTaxCodes(taxes.payload); setSetupReady(true); setupAvailable.current = true;
      }
    } catch (reason) { if (current()) { setInvoices([]); setError(reason instanceof Error ? reason.message : "Could not load invoices"); } }
    finally { if (current()) { registerPending.current = false; setLoading(false); } }
  }, [ownsScope, canView, canManage]);
  const loadMore = useCallback(async () => {
    if (!ownsScope() || !canView || registerPending.current || !nextCursor || cursorOwner.current !== nextCursor || JSON.stringify(appliedFilterOwner.current) !== JSON.stringify(appliedFilters)) return;
    registerPending.current = true;
    const epoch = ++readEpoch.current;
    const current = () => ownsScope() && epoch === readEpoch.current;
    setLoadingMore(true); setError(null);
    try {
      const response = await fetch(invoiceRegisterUrl(appliedFilters, nextCursor), { cache: "no-store" });
      if (!current()) return;
      const payload = await response.json().catch(() => null);
      if (!current()) return;
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not load older invoices"));
      const page = verifiedInvoicePage<Invoice>(payload);
      if (page.next_cursor === nextCursor) throw new Error("Invoice pagination did not advance. Retry loading older invoices.");
      setInvoices(rows => appendUniqueInvoices(rows, page.items));
      notifyLocation(appliedFilters, nextCursor);
      cursorOwner.current = page.next_cursor; setNextCursor(page.next_cursor);
    } catch (reason) { if (current()) setError(reason instanceof Error ? reason.message : "Could not load older invoices"); }
    finally { if (current()) { registerPending.current = false; setLoadingMore(false); } }
  }, [ownsScope, canView, nextCursor, appliedFilters, notifyLocation]);
  function applyFilters(event?: FormEvent) {
    event?.preventDefault();
    if (!ownsScope() || !canView) return;
    const filters: InvoiceRegisterFilters = { search: query.trim(), status: statusFilter, currency: currencyFilter, balance: dueFilter };
    appliedFilterOwner.current = filters; setAppliedFilters(filters); notifyLocation(filters, null);
    void load();
  }
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!registerLocation || !ownsScope() || syncedLocation.current === invoiceLocationKey(registerLocation)) return;
    const { filters, cursor } = registerLocation;
    syncedLocation.current = invoiceLocationKey(registerLocation); startingCursor.current = cursor;
    appliedFilterOwner.current = filters; setAppliedFilters(filters);
    setQuery(filters.search); setStatusFilter(filters.status); setCurrencyFilter(filters.currency); setDueFilter(filters.balance);
    void load();
  }, [registerLocation, ownsScope, load]);
  function restartFirstPage() { if (!ownsScope() || !canView) return; notifyLocation(appliedFilterOwner.current, null); void load(); }

  useEffect(() => {
    if (!showForm || !canManage || !ownsScope()) return;
    const controller = new AbortController();
    setDestinationsLoading(true);
    setDestinationsError(null);
    void (async () => {
      try {
        const response = await fetch("/api/finance/payment-destinations", { cache: "no-store", signal: controller.signal });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not load payment destinations"));
        if (!Array.isArray(payload) || payload.some(row => !row || typeof row.id !== "string")) throw new Error("Payment destinations could not be verified.");
        if (!controller.signal.aborted && ownsScope()) setDestinations(payload as PaymentDestination[]);
      } catch (reason) {
        if (!controller.signal.aborted && ownsScope()) setDestinationsError(reason instanceof Error ? reason.message : "Could not load payment destinations");
      } finally {
        if (!controller.signal.aborted && ownsScope()) setDestinationsLoading(false);
      }
    })();
    return () => controller.abort();
  }, [showForm, ownsScope, canManage]);

  const applyClientIntent = useCallback(() => {
    if (!requestedClientId || activeClientIntent.current !== requestedClientId || consumedClientIntent.current === requestedClientId || !ownsScope() || !canView || !canManage || !setupReady || !setupAvailable.current) return;
    consumedClientIntent.current = requestedClientId;
    // A URL is only a prefill request, never permission to replace a live draft.
    if (createOpen.current || writePending.current || writeUnknown.current || writeAcknowledged.current) return;
    const client = meta.clients.find(item => item.id === requestedClientId);
    if (!client) { setMessage("The requested client is unavailable in this company. Choose a verified client when creating an invoice."); return; }
    ++draftGeneration.current; createOpen.current = true;
    setSource("client");
    setForm({ source_id: "", client_id: client.id, subject: "", issue_date: today(), due_date: "", currency: client.currency || "", tax_calculation_mode: "exclusive", notes: "", terms_conditions: "", lines: [blank()] });
    setPayment(blankPayment()); setError(null); setMessage(null); setShowForm(true);
  }, [requestedClientId, ownsScope, canView, canManage, setupReady, meta.clients]);
  useEffect(() => { applyClientIntent(); }, [applyClientIntent]);

  const projectOptions = useMemo(() => meta.projects.filter((p) => p.status !== "cancelled").map((p) => ({ value: p.id, label: `${p.number} · ${p.name} · ${money(p.contract_value, p.currency)}`, keywords: `${p.number} ${p.name} ${p.currency} ${p.contract_value}` })), [meta.projects]);
  const orderOptions = useMemo(() => meta.orders.filter((o) => o.status !== "cancelled").map((o) => ({ value: o.id, label: `${o.number} · ${o.client_name} · ${money(o.total, o.currency)}`, keywords: `${o.number} ${o.client_name} ${o.currency} ${o.total}` })), [meta.orders]);
  const clientOptions = useMemo(() => meta.clients.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}`, keywords: `${c.code} ${c.name}` })), [meta.clients]);
  const availableCatalog = useMemo(() => catalog.filter((item) => item.is_active && (!form.currency || item.currency === form.currency)), [catalog, form.currency]);
  const lineSourceOptions = useMemo(() => [{ value: "custom:service", label: "+ Custom service" }, { value: "custom:non_stock_item", label: "+ Custom non-stock item" }, ...availableCatalog.map((item) => ({ value: `catalog:${item.id}`, label: `${item.sku} · ${item.name}`, keywords: `${item.item_type} ${item.unit}` }))], [availableCatalog]);
  const statusOptions = INVOICE_STATUSES;
  const currencyOptions = CURRENCY_OPTIONS;
  const filteredInvoices = useMemo(() => {
    // Server filters cover full history. This intersection is needed only when
    // a raw status and the separate overdue balance control are both selected.
    return invoices.filter(invoice => appliedFilters.balance !== "overdue" || appliedFilters.status === "all" || appliedFilters.status === "overdue" || invoice.status === appliedFilters.status);
  }, [appliedFilters, invoices]);
  const overdueCount = useMemo(() => invoices.filter((invoice) => invoice.display_status === "overdue").length, [invoices]);
  const outstandingCount = useMemo(() => invoices.filter((invoice) => Number(invoice.balance_due) > 0 && !["draft", "cancelled"].includes(invoice.status)).length, [invoices]);
  const draftTotal = useMemo(() => sumMoneyExact(form.lines.map(line => lineTotal(line, form.tax_calculation_mode))), [form.lines, form.tax_calculation_mode]);
  const selectedDestination = destinations.find((item) => item.id === payment.accountId) ?? null;
  const invoiceCurrency = source === "client" ? form.currency : source === "order"
    ? meta.orders.find((item) => item.id === form.source_id)?.currency
    : meta.projects.find((item) => item.id === form.source_id)?.currency;
  const paymentAccountOptions = [
    { value: "", label: "No financial account", description: "Payment link or custom instructions only" },
    ...destinations.map((account) => ({
      value: account.id, label: `${account.name} · ${account.currency}`,
      description: account.provider_name || account.account_reference || account.account_type.replaceAll("_", " "),
      keywords: `${account.provider_name ?? ""} ${account.name} ${account.currency} ${account.account_reference ?? ""}`,
    })),
  ];
  function changeDraft(update: (current: typeof form) => typeof form) { if (!canChangeDraft()) return; ++draftGeneration.current; setForm(update); }
  function changePayment(update: (current: PaymentForm) => PaymentForm) { if (!canChangeDraft()) return; ++draftGeneration.current; setPayment(update); }
  function selectClient(value: string) {
    if (!canChangeDraft()) return;
    const client = meta.clients.find(item => item.id === value);
    ++draftGeneration.current;
    setForm(current => ({ ...current, client_id: value, currency: client?.currency || current.currency, lines: client?.currency && current.lines.some(line => line.product_id) ? [blank()] : current.lines }));
    if (client?.currency && form.lines.some(line => line.product_id)) setError("Currency changed. Catalog lines were cleared so different currencies cannot be mixed.");
  }
  function selectPaymentDestination(accountId: string) { if (!canChangeDraft()) return; ++draftGeneration.current;
    const account = destinations.find((item) => item.id === accountId);
    if (!account) { setPayment((current) => ({ ...current, accountId: "" })); return; }
    setPayment({ method: inferPaymentMethod(account), accountId: account.id, url: account.payment_url ?? "", instructions: account.payment_instructions ?? "" });
  }

  function resetSource(next: Source) { if (!canChangeDraft()) return; ++draftGeneration.current; setSource(next); setForm({ source_id: "", client_id: "", subject: "", issue_date: today(), due_date: "", currency: "", tax_calculation_mode: "exclusive", notes: "", terms_conditions: "", lines: [blank()] }); setError(null); }
  function clearFilters() { if (!ownsScope() || !canView) return; setQuery(""); setStatusFilter("all"); setCurrencyFilter("all"); setDueFilter("all"); const filters = blankInvoiceFilters(); appliedFilterOwner.current = filters; setAppliedFilters(filters); notifyLocation(filters, null); void load(); }
  function updateLine(index: number, patch: Partial<Line>) { if (!canChangeDraft()) return; ++draftGeneration.current; setForm((current) => ({ ...current, lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line) })); }
  function changeManualCurrency(value: string) { if (!canChangeDraft()) return; ++draftGeneration.current; setForm((current) => ({ ...current, currency: value, lines: current.lines.some((line) => line.product_id) ? [blank()] : current.lines })); if (form.lines.some((line) => line.product_id)) setError("Currency changed. Catalog lines were cleared so different currencies cannot be mixed."); }
  function selectLineSource(index: number, value: string) { if (!canChangeDraft()) return;
    if (value === "custom:service" || value === "custom:non_stock_item") { updateLine(index, { product_id: null, item_name: "", item_type: value.endsWith("non_stock_item") ? "non_stock_item" : "service", unit: "unit", description: "", unit_price: "0", tax_rate: "0" }); return; }
    const product = availableCatalog.find((item) => item.id === value.replace("catalog:", ""));
    if (!product) return;
    const tax = taxCodes.find((item) => item.id === product.tax_code_id && item.tax_kind === "sales" && item.is_active !== false);
    updateLine(index, { product_id: product.id, item_name: product.name, item_type: product.item_type === "non_stock_item" ? "non_stock_item" : "service", unit: product.unit, description: product.description || product.name, unit_price: String(product.selling_price), tax_rate: String(tax?.rate ?? 0) });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canChangeDraft() || !canView || !createOpen.current || !setupAvailable.current || !showForm) return;
    writePending.current = true;
    let dispatched = false, definiteRejection = false;
    setSaving(true); setError(null); setMessage(null);
    try {
      if (!payment.method && (payment.accountId || payment.url.trim() || payment.instructions.trim())) throw new Error("Choose a payment method or clear payment details.");
      const paymentDetails = payment.method ? {
        payment_method: payment.method, payment_account_id: payment.accountId || null,
        payment_url: payment.url.trim() || null, payment_instructions: payment.instructions.trim() || null,
      } : null;
      const post = (url: string, init: RequestInit) => { dispatched = true; return fetch(url, init); };
      let response: Response;
      if (source === "project") response = await post(`/api/finance/invoices/from-project/${form.source_id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payment_details: paymentDetails }) });
      else if (source === "order") response = await post(`/api/finance/invoices/from-order/${form.source_id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payment_details: paymentDetails }) });
      else {
        if (form.lines.some((line) => !(line.item_name || line.description).trim() || !line.description.trim() || Number(line.quantity) <= 0 || Number(line.unit_price) < 0)) throw new Error("Complete all invoice lines.");
        response = await post("/api/finance/invoices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: form.client_id, subject: form.subject || null, issue_date: form.issue_date, due_date: form.due_date || null, currency: form.currency || null, tax_calculation_mode: form.tax_calculation_mode, notes: form.notes || null, terms_conditions: form.terms_conditions || null, payment_details: paymentDetails, items: form.lines.map((line) => ({ product_id: line.product_id, item_name: line.item_name || line.description, item_type: line.item_type, unit: line.unit || "unit", description: line.description, quantity: Number(line.quantity), unit_price: Number(line.unit_price), discount_percent: Number(line.discount_percent || 0), tax_rate: Number(line.tax_rate || 0) })) }) });
      }
      if (response.ok && ownsScope()) writeAcknowledged.current = true;
      const payload = await response.json().catch(() => null);
      if (!ownsScope()) return;
      if (!response.ok) {
        definiteRejection = response.status >= 400 && response.status < 500 && ![408, 409].includes(response.status) && getApiErrorMessage(payload, "").trim().length > 0 && getApiErrorMessage(payload, "").trim() !== "Unexpected upstream response";
        throw new Error(getApiErrorMessage(payload, "Could not create invoice"));
      }
      const label = typeof payload?.invoice_number === "string" ? `Invoice ${payload.invoice_number}` : "The invoice";
      setMessage(`${label} was acknowledged as created. Review the saved record before sending; do not repeat this draft submission.`);
      createOpen.current = false; setShowForm(false); await load();
    } catch (reason) {
      if (!ownsScope()) return;
      if (dispatched && !writeAcknowledged.current && !definiteRejection) { writeUnknown.current = true; setUnknownCreate(true); }
      setError(writeUnknown.current ? "Invoice creation outcome is unknown. It may already exist. Do not submit again; review saved invoices. A missing or similarly named row does not prove failure. Reloading or leaving loses this document-only protection." : writeAcknowledged.current ? "The invoice was created, but the latest register could not be opened. Review saved invoices; do not submit again." : reason instanceof Error ? reason.message : "Could not create invoice");
    } finally { writePending.current = false; if (ownsScope()) setSaving(false); }
  }
  function openCreate() {
    if (generation !== draftGeneration.current || !ownsScope() || !canView || !canManage || !setupAvailable.current || writePending.current || writeUnknown.current || createOpen.current) return;
    ++draftGeneration.current; createOpen.current = true;
    if (writeAcknowledged.current) {
      writeAcknowledged.current = false;
      setSource(initialSource); setForm({ source_id: "", client_id: "", subject: "", issue_date: today(), due_date: "", currency: "", tax_calculation_mode: "exclusive", notes: "", terms_conditions: "", lines: [blank()] }); setPayment(blankPayment());
    }
    setShowForm(true);
  }
  function closeCreate() { if (canChangeDraft()) { createOpen.current = false; ++draftGeneration.current; setShowForm(false); } }
  const consumedCreateRequest = useRef(0);
  useEffect(() => {
    if (!createRequest || createRequest === consumedCreateRequest.current || !setupReady || !ownsScope()) return;
    consumedCreateRequest.current = createRequest;
    openCreate();
  });


  return <AppPage className="invoice-page" width="normal"><div className="space-y-6">
    <PageHeader className="invoice-heading" eyebrow="Finance & Accounts" title="Invoices" description="From first draft to final payment. Keep every invoice, balance and next step in view." actions={canManage ? <button disabled={saving || unknownCreate || !setupReady} onClick={openCreate} className="invoice-primary"><Plus className="size-4" />New invoice</button> : undefined} />
    {error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    {message ? <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}

    {unknownCreate ? <div role="alert" className="rounded-xl border border-neutral-300 bg-white p-4"><strong>Creation outcome unknown</strong><p>This draft is frozen. Review invoices in a separate tab before considering any replacement; an absent row is not proof of failure. Reloading loses this local protection.</p><a href="/dashboard/accounting/invoices" target="_blank" rel="noopener noreferrer">Review saved invoices</a><button type="button" disabled={loading} onClick={() => void load()}>Refresh read-only register</button></div> : null}
    {registerReady ? <InvoiceCounts total={invoices.length} outstanding={outstandingCount} overdue={overdueCount} /> : <p role="status" className="text-sm text-neutral-500">{loading ? "Loading invoice counts…" : "Invoice counts unavailable until the register is verified."}</p>}

    {showForm && canManage ? <section className="invoice-create" aria-labelledby="invoice-create-title">
      <div className="invoice-create-heading"><div><p className="invoice-eyebrow">NEW DRAFT</p><h2 id="invoice-create-title">Create invoice</h2><p className="mt-1 text-sm text-neutral-500">Project and order invoices copy their locked sales snapshot. Manual client invoices can use catalog or custom lines.</p></div><button type="button" aria-label="Close create invoice" disabled={saving || unknownCreate} onClick={closeCreate} className="invoice-close"><X className="size-5" /></button></div>
      <div className="invoice-source-tabs" aria-label="Invoice source">{(["project", "order", "client"] as Source[]).map((item) => <button type="button" disabled={saving || unknownCreate} key={item} aria-pressed={source === item} onClick={() => resetSource(item)} className={`rounded-xl px-4 py-2 text-sm font-medium ${source === item ? "bg-neutral-950 text-white" : "border"}`}>{item === "client" ? "Direct client invoice" : item === "project" ? "From project" : "From order"}</button>)}</div>
      <form onSubmit={submit} className="invoice-create-form"><fieldset disabled={saving || unknownCreate} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: "contents" }}>
        {source === "project" ? <><SearchableSelect label="Project" required clearable={false} value={form.source_id} onValueChange={(value) => changeDraft((v) => ({ ...v, source_id: value }))} options={projectOptions} placeholder="Select project" searchPlaceholder="Search project..." />{!projectOptions.length ? <p className="text-xs text-neutral-500">No uninvoiced projects are available. A full active invoice can only be created once per project/order.</p> : null}</> : null}
        {source === "order" ? <><SearchableSelect label="Order" required clearable={false} value={form.source_id} onValueChange={(value) => changeDraft((v) => ({ ...v, source_id: value }))} options={orderOptions} placeholder="Select order" searchPlaceholder="Search order..." />{!orderOptions.length ? <p className="text-xs text-neutral-500">No uninvoiced orders are available.</p> : null}</> : null}
        {source === "client" ? <><div className="invoice-recipient-grid">
          <SearchableSelect label="Client" required clearable={false} value={form.client_id} onValueChange={selectClient} options={clientOptions} placeholder="Select client" searchPlaceholder="Search client..." />
          <Field label="Subject"><input value={form.subject} onChange={(e) => changeDraft((v) => ({ ...v, subject: e.target.value }))} className="h-11 w-full rounded-xl border px-3 text-sm" placeholder="Website development" /></Field>
          <SearchableSelect label="Currency" required clearable={false} value={form.currency} onValueChange={changeManualCurrency} options={CURRENCY_OPTIONS} placeholder="Select currency" searchPlaceholder="Search currency..." />
          <Field label="Issue date"><input required type="date" value={form.issue_date} onChange={(e) => changeDraft((v) => ({ ...v, issue_date: e.target.value }))} className="h-11 w-full rounded-xl border px-3 text-sm" /></Field>
          <Field label="Due date"><input type="date" value={form.due_date} onChange={(e) => changeDraft((v) => ({ ...v, due_date: e.target.value }))} className="h-11 w-full rounded-xl border px-3 text-sm" /></Field>
          <Field label="Tax calculation"><select value={form.tax_calculation_mode} onChange={(e) => changeDraft((v) => ({ ...v, tax_calculation_mode: e.target.value }))} className="h-11 w-full rounded-xl border bg-white px-3 text-sm"><option value="exclusive">Tax exclusive</option><option value="inclusive">Tax inclusive</option></select></Field>
        </div>
        <div><div className="mb-3 flex items-center justify-between"><div><h3 className="font-medium">Invoice lines</h3><p className="mt-1 text-xs text-neutral-400">Catalog is optional. One-time project/service billing does not create inventory items.</p></div><button type="button" onClick={() => changeDraft((v) => ({ ...v, lines: [...v.lines, blank()] }))} className="rounded-lg border px-3 py-2 text-sm font-medium">+ Add line</button></div>
          <div className="invoice-lines">{form.lines.map((line, index) => { const sourceValue = line.product_id ? `catalog:${line.product_id}` : line.item_type === "non_stock_item" ? "custom:non_stock_item" : "custom:service"; return <InvoiceLineEditor key={index} line={line} index={index} sourceValue={sourceValue} sourceOptions={lineSourceOptions} total={money(lineTotal(line, form.tax_calculation_mode), form.currency || "")} canRemove={form.lines.length !== 1} onSourceChange={(value) => selectLineSource(index, value)} onChange={(patch) => updateLine(index, patch)} onRemove={() => changeDraft((v) => ({ ...v, lines: v.lines.filter((_, i) => i !== index) }))} />; })}</div>
          <div className="mt-4 flex justify-end rounded-xl bg-neutral-50 p-4"><div className="text-right"><p className="text-xs uppercase tracking-wide text-neutral-400">Estimated total</p><p className="mt-1 text-lg font-semibold">{money(draftTotal, form.currency || "")}</p>{draftTotal === "" ? <p role="status" className="mt-2 text-xs text-amber-800">Estimate unavailable. Check quantity, price, discount and tax.</p> : null}</div></div>
        </div><Field label="Client notes"><textarea value={form.notes} onChange={(e) => changeDraft((v) => ({ ...v, notes: e.target.value }))} className="min-h-24 w-full rounded-xl border p-3 text-sm" /></Field><Field label="Terms and conditions (optional)"><textarea value={form.terms_conditions} onChange={(e) => changeDraft((v) => ({ ...v, terms_conditions: e.target.value }))} className="min-h-24 w-full rounded-xl border p-3 text-sm" /></Field></> : null}
        <section className="invoice-payment-instructions space-y-4">
          <div><h3 className="font-semibold">Payment instructions</h3><p className="mt-1 text-xs text-neutral-500">Set the payment method, destination and link now. These details are saved with the draft and locked when it is sent.</p></div>
          {destinationsError ? <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{destinationsError} You can still enter a custom payment link.</p> : null}
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Payment method"><select value={payment.method} onChange={(event) => { const method = event.target.value as PaymentMethod | ""; changePayment((current) => method ? { ...current, method } : blankPayment()); }} className="h-11 w-full rounded-xl border bg-white px-3 text-sm">{paymentMethods.map((item) => <option key={item.value || "none"} value={item.value}>{item.label}</option>)}</select></Field>
            <div><SearchableSelect label="Receive into" value={payment.accountId} onValueChange={selectPaymentDestination} options={paymentAccountOptions} placeholder={destinationsLoading ? "Loading accounts..." : "Select bank, wallet or gateway"} searchPlaceholder="Search account, provider, currency..." clearable /></div>
            <div className="md:col-span-2"><Field label="Payment URL"><input type="url" maxLength={1000} value={payment.url} onChange={(event) => changePayment((current) => ({ ...current, url: event.target.value }))} className="h-11 w-full rounded-xl border bg-white px-3 text-sm" placeholder="https://payoneer.com/..." /></Field><p className="mt-1 text-xs text-neutral-500">A saved payment URL appears as a link and QR code on the client invoice.</p></div>
            <div className="md:col-span-2"><Field label="Client payment instructions"><textarea maxLength={5000} value={payment.instructions} onChange={(event) => changePayment((current) => ({ ...current, instructions: event.target.value }))} className="min-h-24 w-full rounded-xl border bg-white p-3 text-sm" placeholder="Use the invoice number as the payment reference." /></Field></div>
          </div>
          {payment.method === "stripe" && selectedDestination && !selectedDestination.gateway_connection_id ? <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">This Stripe financial account is not linked to a connected Stripe Gateway. You can create the draft, but automatic Stripe Checkout will be unavailable until you open <Link href={`/dashboard/accounting/accounts/${selectedDestination.id}`} className="font-semibold underline">this Financial Account</Link> and choose <strong>Edit account & gateway</strong>.</p> : null}
          {selectedDestination && invoiceCurrency && selectedDestination.currency !== invoiceCurrency ? <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Invoice currency is <strong>{invoiceCurrency}</strong>, while the payment destination is <strong>{selectedDestination.currency}</strong>. Enter the actual exchange rate when recording a payment; no conversion is assumed here.</p> : null}
        </section>
        <div className="invoice-create-footer"><p>Created as a draft. Review before sending.</p><button disabled={saving || ((source === "project" || source === "order") && !form.source_id)} className="invoice-primary">{saving ? "Creating…" : "Create draft invoice"}</button></div>
      </fieldset></form>
    </section> : null}

    <section className="invoice-list-surface" aria-labelledby="invoice-register-title">
      <div className="invoice-register-heading"><div><h2 id="invoice-register-title">Invoice register</h2><p>Open an invoice to review its details, actions and payment history.</p></div><span>Balances stay in their original currency</span></div>
      <form className="invoice-filters" onSubmit={applyFilters}><div className="invoice-filter-grid">
        <label className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400"/><input aria-label="Search invoices" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search invoice, client, subject..." className="h-11 w-full rounded-xl border bg-white pl-10 pr-3 text-sm outline-none focus:border-neutral-500"/></label>
        <select aria-label="Invoice status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-11 rounded-xl border bg-white px-3 text-sm"><option value="all">All statuses</option>{statusOptions.filter((status) => status !== "all").map((status) => <option key={status} value={status}>{pretty(status)}</option>)}</select>
        <select aria-label="Invoice currency" value={currencyFilter} onChange={(event) => setCurrencyFilter(event.target.value)} className="h-11 rounded-xl border bg-white px-3 text-sm"><option value="all">All currencies</option>{currencyOptions.map((currency) => <option key={currency.value} value={currency.value}>{currency.label}</option>)}</select>
        <select aria-label="Invoice balance" value={dueFilter} onChange={(event) => setDueFilter(event.target.value as typeof dueFilter)} className="h-11 rounded-xl border bg-white px-3 text-sm"><option value="all">All balances</option><option value="outstanding">Outstanding</option><option value="overdue">Overdue</option><option value="paid">Paid</option></select>
        <div className="invoice-filter-actions"><button type="submit" disabled={!canView} className="h-11 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-40">Apply filters</button>
        <button type="button" onClick={clearFilters} disabled={!query && statusFilter === "all" && currencyFilter === "all" && dueFilter === "all" && !appliedFilters.search && appliedFilters.status === "all" && appliedFilters.currency === "all" && appliedFilters.balance === "all"} className="h-11 rounded-xl border bg-white px-4 text-sm font-medium disabled:opacity-40">Clear</button></div>
      </div><p className="mt-3 text-xs text-neutral-500">Showing {filteredInvoices.length} of {invoices.length} loaded records. Apply filters to search the full history. Counts describe loaded records, not company-wide totals.{nextCursor ? " Older matching records are available below." : registerReady ? historyStartsAtCursor ? " End of history from this cursor page." : " All matching records have been loaded." : ""}</p></form>
      {historyStartsAtCursor ? <div role="status" className="flex flex-wrap items-center justify-between gap-3 border-b p-4 text-sm text-neutral-600"><p>Returned to this cursor page. Earlier pages are not loaded.</p><button type="button" className="invoice-primary" disabled={loading} onClick={restartFirstPage}>Restart from first page</button></div> : null}
      {registerReady || loading ? <InvoiceRegister returnHref={returnHref} invoices={filteredInvoices} moreAvailable={Boolean(nextCursor)} loading={loading} currentDate={today()} formatMoney={money} /> : null}
      {nextCursor ? <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4"><p className="text-sm text-neutral-500" role="status">{loadingMore ? "Loading older invoices…" : "Continue through the matching invoice history."}</p><button type="button" className="invoice-primary" disabled={loading || loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Loading…" : "Load more invoices"}</button></div> : null}
    </section>
  </div></AppPage>;
}

