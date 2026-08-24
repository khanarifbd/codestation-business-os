/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Landmark, Link2, LockKeyhole, Pencil, Printer, QrCode, Save, WalletCards, X } from "lucide-react";

import { SearchableSelect } from "@/components/searchable-select";

type PaymentMethod = "bank_transfer" | "cash" | "card" | "payoneer" | "wise" | "stripe" | "paypal" | "other";

type Destination = {
  id: string;
  name: string;
  account_type: string;
  provider_name: string | null;
  account_holder_name: string | null;
  account_reference: string | null;
  currency: string;
  payment_url: string | null;
  payment_instructions: string | null;
};

type PaymentInstructions = {
  invoice_id: string;
  invoice_number: string;
  invoice_status: string;
  invoice_currency: string;
  payment_method: string | null;
  payment_account_id: string | null;
  payment_account_name: string | null;
  payment_provider: string | null;
  payment_account_holder: string | null;
  payment_account_reference: string | null;
  payment_currency: string | null;
  payment_url: string | null;
  payment_instructions: string | null;
  locked: boolean;
};

type InvoiceItem = {
  id: string;
  item_name_snapshot: string;
  description: string;
  quantity: string | number;
  unit_price: string | number;
  discount_percent: string | number;
  tax_rate: string | number;
  line_total: string | number;
};

type Invoice = {
  id: string;
  invoice_number: string;
  status: string;
  display_status: string;
  subject: string | null;
  issue_date: string;
  due_date: string | null;
  currency: string;
  seller_name_snapshot: string;
  seller_email_snapshot: string | null;
  seller_address_snapshot: string | null;
  seller_tax_identifier_snapshot: string | null;
  client_name_snapshot: string;
  client_contact_snapshot: string | null;
  client_email_snapshot: string | null;
  client_address_snapshot: string | null;
  client_tax_identifier_snapshot: string | null;
  subtotal: string | number;
  discount_total: string | number;
  tax_total: string | number;
  total: string | number;
  amount_paid: string | number;
  balance_due: string | number;
  notes: string | null;
  terms_conditions: string | null;
  items: InvoiceItem[];
};

type PaymentForm = {
  method: PaymentMethod | "";
  accountId: string;
  paymentUrl: string;
  instructions: string;
};

const methodOptions: Array<{ value: PaymentMethod | ""; label: string }> = [
  { value: "", label: "No payment instructions" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "payoneer", label: "Payoneer" },
  { value: "wise", label: "Wise" },
  { value: "stripe", label: "Stripe" },
  { value: "paypal", label: "PayPal" },
  { value: "card", label: "Card / payment link" },
  { value: "cash", label: "Cash" },
  { value: "other", label: "Other" },
];

function money(value: string | number, currency: string) {
  return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function apiError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((item) => item && typeof item === "object" && "msg" in item ? String((item as { msg: unknown }).msg) : String(item)).join(" · ");
  return fallback;
}

function methodLabel(value: string | null) {
  return methodOptions.find((item) => item.value === value)?.label ?? (value ? value.replaceAll("_", " ") : "Not configured");
}

function inferMethod(account: Destination): PaymentMethod {
  if (account.account_type === "bank") return "bank_transfer";
  const provider = (account.provider_name || account.name).toLowerCase();
  if (provider.includes("payoneer")) return "payoneer";
  if (provider.includes("wise")) return "wise";
  if (provider.includes("stripe")) return "stripe";
  if (provider.includes("paypal")) return "paypal";
  if (account.account_type === "cash" || account.account_type === "petty_cash") return "cash";
  return "other";
}

function toForm(payment: PaymentInstructions): PaymentForm {
  return {
    method: (payment.payment_method as PaymentMethod | null) ?? "",
    accountId: payment.payment_account_id ?? "",
    paymentUrl: payment.payment_url ?? "",
    instructions: payment.payment_instructions ?? "",
  };
}

function qrImageUrl(paymentUrl: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(paymentUrl)}`;
}

export function InvoicePaymentWorkspace({ invoiceId }: { invoiceId: string }) {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [payment, setPayment] = useState<PaymentInstructions | null>(null);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [form, setForm] = useState<PaymentForm>({ method: "", accountId: "", paymentUrl: "", instructions: "" });
  const [editing, setEditing] = useState(false);
  const [saveDefaults, setSaveDefaults] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [invoiceResponse, paymentResponse, destinationResponse] = await Promise.all([
        fetch(`/api/finance/invoices/${invoiceId}`, { cache: "no-store" }),
        fetch(`/api/finance/invoices/${invoiceId}/payment-instructions`, { cache: "no-store" }),
        fetch("/api/finance/payment-destinations", { cache: "no-store" }),
      ]);
      const [invoicePayload, paymentPayload, destinationPayload] = await Promise.all([
        invoiceResponse.json(),
        paymentResponse.json(),
        destinationResponse.json(),
      ]);
      if (!invoiceResponse.ok) throw new Error(apiError(invoicePayload, "Could not load invoice preview"));
      if (!paymentResponse.ok) throw new Error(apiError(paymentPayload, "Could not load payment instructions"));
      if (!destinationResponse.ok) throw new Error(apiError(destinationPayload, "Could not load payment destinations"));
      setInvoice(invoicePayload as Invoice);
      setPayment(paymentPayload as PaymentInstructions);
      setDestinations(destinationPayload as Destination[]);
      setForm(toForm(paymentPayload as PaymentInstructions));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load invoice payment details");
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => { void load(); }, [load]);

  const accountOptions = useMemo(() => [
    { value: "", label: "No financial account", description: "Use only a payment link or custom instructions" },
    ...destinations.map((account) => ({
      value: account.id,
      label: `${account.name} · ${account.currency}`,
      description: account.provider_name || account.account_reference || account.account_type.replaceAll("_", " "),
    })),
  ], [destinations]);

  const selectedDestination = useMemo(() => destinations.find((item) => item.id === form.accountId) ?? null, [destinations, form.accountId]);
  const currencyMismatch = Boolean(selectedDestination && invoice && selectedDestination.currency !== invoice.currency);

  function selectDestination(accountId: string) {
    const account = destinations.find((item) => item.id === accountId);
    if (!account) {
      setForm((value) => ({ ...value, accountId: "" }));
      return;
    }
    setForm({
      method: inferMethod(account),
      accountId: account.id,
      paymentUrl: account.payment_url ?? "",
      instructions: account.payment_instructions ?? "",
    });
  }

  function changeMethod(method: PaymentMethod | "") {
    if (!method) {
      setForm({ method: "", accountId: "", paymentUrl: "", instructions: "" });
      setSaveDefaults(false);
      return;
    }
    setForm((value) => ({ ...value, method }));
  }

  async function savePaymentInstructions() {
    if (!invoice || !payment) return;
    if (!form.method && (form.accountId || form.paymentUrl.trim() || form.instructions.trim())) {
      setError("Choose a payment method or clear all payment instructions.");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/finance/invoices/${invoice.id}/payment-instructions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payment_method: form.method || null,
          payment_account_id: form.accountId || null,
          payment_url: form.paymentUrl.trim() || null,
          payment_instructions: form.instructions.trim() || null,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiError(payload, "Could not save payment instructions"));

      let defaultWarning = "";
      if (saveDefaults && form.accountId) {
        const defaultsResponse = await fetch(`/api/finance/payment-destinations/${form.accountId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payment_url: form.paymentUrl.trim() || null, payment_instructions: form.instructions.trim() || null }),
        });
        if (!defaultsResponse.ok) defaultWarning = " Invoice saved, but account defaults could not be updated.";
      }

      setMessage(`Payment instructions saved.${defaultWarning}`);
      setEditing(false);
      setSaveDefaults(false);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save payment instructions");
    } finally {
      setSaving(false);
    }
  }

  function printInvoice() {
    window.print();
  }

  if (loading && !invoice) return <div className="mx-auto max-w-7xl px-4 pb-8 text-sm text-neutral-400 sm:px-6 lg:px-8">Loading payment instructions…</div>;
  if (!invoice || !payment) return <div className="mx-auto max-w-7xl px-4 pb-8 sm:px-6 lg:px-8">{error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}</div>;

  const hasPaymentInstructions = Boolean(payment.payment_method || payment.payment_account_id || payment.payment_url || payment.payment_instructions);
  const canEdit = !payment.locked && invoice.status === "draft";

  return <div className="mx-auto max-w-7xl space-y-6 px-4 pb-10 sm:px-6 lg:px-8">
    <style jsx global>{`
      @media print {
        body * { visibility: hidden !important; }
        #invoice-client-preview, #invoice-client-preview * { visibility: visible !important; }
        #invoice-client-preview { position: absolute !important; inset: 0 auto auto 0 !important; width: 100% !important; margin: 0 !important; border: 0 !important; box-shadow: none !important; }
        #invoice-client-preview .no-print { display: none !important; }
      }
    `}</style>

    {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}

    <section className="rounded-2xl border bg-white p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2"><WalletCards className="size-5" /><h2 className="text-lg font-semibold">Payment instructions</h2>{payment.locked ? <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-1 text-[11px] font-semibold text-neutral-600"><LockKeyhole className="size-3" />Locked</span> : null}</div>
          <p className="mt-1 max-w-2xl text-sm text-neutral-500">Choose how the client should pay this invoice. Bank details are snapshotted so a sent invoice never changes when the account is edited later.</p>
        </div>
        {canEdit && !editing ? <button type="button" onClick={() => { setForm(toForm(payment)); setEditing(true); }} className="inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium"><Pencil className="size-4" />Edit payment details</button> : null}
        {editing ? <div className="flex gap-2"><button type="button" onClick={() => { setForm(toForm(payment)); setEditing(false); setSaveDefaults(false); }} className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium"><X className="size-4" />Cancel</button><button type="button" disabled={saving} onClick={() => void savePaymentInstructions()} className="inline-flex items-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"><Save className="size-4" />{saving ? "Saving…" : "Save"}</button></div> : null}
      </div>

      {editing ? <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Field label="Payment method"><select value={form.method} onChange={(event) => changeMethod(event.target.value as PaymentMethod | "")} className="w-full rounded-xl border bg-white px-3 py-2.5 text-sm">{methodOptions.map((item) => <option key={item.value || "none"} value={item.value}>{item.label}</option>)}</select></Field>
        <SearchableSelect label="Receive into" value={form.accountId} onValueChange={selectDestination} options={accountOptions} placeholder="Select bank, wallet or gateway" searchPlaceholder="Search payment destination..." clearable />
        <div className="md:col-span-2"><Field label="Payment URL"><div className="relative"><Link2 className="absolute left-3 top-3 size-4 text-neutral-400" /><input type="url" value={form.paymentUrl} onChange={(event) => setForm((value) => ({ ...value, paymentUrl: event.target.value }))} className="w-full rounded-xl border py-2.5 pl-9 pr-3 text-sm" placeholder="https://pay.example.com/..." /></div><p className="mt-1 text-xs text-neutral-400">When a URL is present, the client-facing invoice shows a clickable link and QR code.</p></Field></div>
        <div className="md:col-span-2"><Field label="Client payment instructions"><textarea value={form.instructions} onChange={(event) => setForm((value) => ({ ...value, instructions: event.target.value }))} className="min-h-24 w-full rounded-xl border px-3 py-2.5 text-sm" placeholder="Use the invoice number as the payment reference." /></Field></div>
        {currencyMismatch ? <div className="md:col-span-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Invoice currency is <strong>{invoice.currency}</strong>, but the selected destination is <strong>{selectedDestination?.currency}</strong>. Business OS will not invent a converted amount. Record the actual exchange rate when the payment is received.</div> : null}
        {form.accountId ? <label className="md:col-span-2 flex items-start gap-3 rounded-xl border bg-neutral-50 px-4 py-3 text-sm"><input type="checkbox" checked={saveDefaults} onChange={(event) => setSaveDefaults(event.target.checked)} className="mt-1" /><span><strong>Save URL and instructions as defaults for this account</strong><span className="mt-0.5 block text-xs text-neutral-500">Future invoices selecting this account can prefill the same client payment details.</span></span></label> : null}
      </div> : hasPaymentInstructions ? <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Info label="Method" value={methodLabel(payment.payment_method)} />
        <Info label="Destination" value={payment.payment_account_name || "Custom payment link"} />
        <Info label="Provider" value={payment.payment_provider || "—"} />
        <Info label="Currency" value={payment.payment_currency || invoice.currency} />
        {payment.payment_account_holder ? <Info label="Account holder" value={payment.payment_account_holder} /> : null}
        {payment.payment_account_reference ? <Info label="Account / reference" value={payment.payment_account_reference} /> : null}
        {payment.payment_url ? <div className="sm:col-span-2"><p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Payment URL</p><a href={payment.payment_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex max-w-full items-center gap-2 break-all text-sm font-medium text-blue-700 hover:underline">{payment.payment_url}<ExternalLink className="size-3.5 shrink-0" /></a></div> : null}
        {payment.payment_instructions ? <div className="sm:col-span-2 lg:col-span-4"><p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Instructions</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-700">{payment.payment_instructions}</p></div> : null}
      </div> : <div className="mt-6 rounded-xl border border-dashed bg-neutral-50 px-4 py-6 text-center"><QrCode className="mx-auto size-6 text-neutral-300" /><p className="mt-2 text-sm font-medium">No client payment instructions</p><p className="mt-1 text-xs text-neutral-400">Useful for marketplace orders where the platform handles collection.</p></div>}
    </section>

    <section id="invoice-client-preview" className="rounded-3xl border bg-white p-5 shadow-sm sm:p-8 lg:p-10">
      <div className="no-print mb-7 flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Client-facing preview</p><h2 className="mt-1 text-xl font-semibold">Professional invoice</h2><p className="mt-1 text-sm text-neutral-500">Print this view or save it as PDF from your browser.</p></div><button type="button" onClick={printInvoice} className="inline-flex items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white"><Printer className="size-4" />Print / Save PDF</button></div>

      <div className="flex flex-col gap-8 border-b pb-8 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-md"><p className="text-2xl font-semibold tracking-tight">{invoice.seller_name_snapshot}</p>{invoice.seller_address_snapshot ? <p className="mt-3 whitespace-pre-line text-sm leading-6 text-neutral-500">{invoice.seller_address_snapshot}</p> : null}{invoice.seller_email_snapshot ? <p className="mt-1 text-sm text-neutral-500">{invoice.seller_email_snapshot}</p> : null}{invoice.seller_tax_identifier_snapshot ? <p className="mt-1 text-sm text-neutral-500">Tax ID: {invoice.seller_tax_identifier_snapshot}</p> : null}</div>
        <div className="sm:text-right"><p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Invoice</p><p className="mt-1 text-3xl font-semibold">{invoice.invoice_number}</p><span className="mt-3 inline-flex rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold capitalize text-neutral-600">{invoice.display_status.replaceAll("_", " ")}</span></div>
      </div>

      <div className="grid gap-6 border-b py-8 md:grid-cols-2">
        <div><p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Bill to</p><p className="mt-2 font-semibold">{invoice.client_name_snapshot}</p>{invoice.client_contact_snapshot ? <p className="mt-1 text-sm text-neutral-600">{invoice.client_contact_snapshot}</p> : null}{invoice.client_email_snapshot ? <p className="mt-1 text-sm text-neutral-500">{invoice.client_email_snapshot}</p> : null}{invoice.client_address_snapshot ? <p className="mt-2 whitespace-pre-line text-sm leading-6 text-neutral-500">{invoice.client_address_snapshot}</p> : null}{invoice.client_tax_identifier_snapshot ? <p className="mt-1 text-sm text-neutral-500">Tax ID: {invoice.client_tax_identifier_snapshot}</p> : null}</div>
        <div className="grid grid-cols-2 gap-4 md:justify-self-end md:min-w-80"><Meta label="Issue date" value={invoice.issue_date} /><Meta label="Due date" value={invoice.due_date || "—"} /><Meta label="Currency" value={invoice.currency} /><Meta label="Amount due" value={money(invoice.balance_due, invoice.currency)} /></div>
      </div>

      {invoice.subject ? <div className="border-b py-5"><p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Subject</p><p className="mt-2 font-medium">{invoice.subject}</p></div> : null}

      <div className="overflow-x-auto py-7"><table className="w-full min-w-[700px] text-sm"><thead><tr className="border-b text-left text-xs uppercase tracking-wide text-neutral-400"><th className="pb-3 pr-4">Item</th><th className="pb-3 px-3 text-right">Qty</th><th className="pb-3 px-3 text-right">Rate</th><th className="pb-3 px-3 text-right">Discount</th><th className="pb-3 px-3 text-right">Tax</th><th className="pb-3 pl-4 text-right">Amount</th></tr></thead><tbody>{invoice.items.map((item) => <tr key={item.id} className="border-b last:border-0"><td className="py-4 pr-4"><p className="font-medium">{item.item_name_snapshot || item.description}</p>{item.item_name_snapshot && item.description !== item.item_name_snapshot ? <p className="mt-1 max-w-lg text-xs leading-5 text-neutral-500">{item.description}</p> : null}</td><td className="px-3 py-4 text-right tabular-nums">{item.quantity}</td><td className="px-3 py-4 text-right tabular-nums">{money(item.unit_price, invoice.currency)}</td><td className="px-3 py-4 text-right tabular-nums">{Number(item.discount_percent || 0)}%</td><td className="px-3 py-4 text-right tabular-nums">{Number(item.tax_rate || 0)}%</td><td className="py-4 pl-4 text-right font-semibold tabular-nums">{money(item.line_total, invoice.currency)}</td></tr>)}</tbody></table></div>

      <div className="flex justify-end border-b pb-8"><div className="w-full max-w-sm space-y-2 text-sm"><TotalRow label="Subtotal" value={money(invoice.subtotal, invoice.currency)} /><TotalRow label="Discount" value={money(invoice.discount_total, invoice.currency)} /><TotalRow label="Tax" value={money(invoice.tax_total, invoice.currency)} /><div className="my-3 border-t" /><TotalRow label="Total" value={money(invoice.total, invoice.currency)} strong /><TotalRow label="Paid" value={money(invoice.amount_paid, invoice.currency)} /><div className="rounded-xl bg-neutral-950 px-4 py-3 text-white"><div className="flex items-center justify-between gap-4"><span className="font-medium">Amount due</span><span className="text-lg font-semibold tabular-nums">{money(invoice.balance_due, invoice.currency)}</span></div></div></div></div>

      {hasPaymentInstructions ? <div className="grid gap-6 border-b py-8 md:grid-cols-[1fr_auto]"><div><div className="flex items-center gap-2"><Landmark className="size-5" /><h3 className="font-semibold">Payment instructions</h3></div><p className="mt-3 text-sm font-medium">{methodLabel(payment.payment_method)}</p>{payment.payment_provider ? <PaymentLine label="Provider / bank" value={payment.payment_provider} /> : null}{payment.payment_account_name ? <PaymentLine label="Destination" value={payment.payment_account_name} /> : null}{payment.payment_account_holder ? <PaymentLine label="Account holder" value={payment.payment_account_holder} /> : null}{payment.payment_account_reference ? <PaymentLine label="Account / reference" value={payment.payment_account_reference} /> : null}{payment.payment_currency ? <PaymentLine label="Receive currency" value={payment.payment_currency} /> : null}<PaymentLine label="Payment reference" value={invoice.invoice_number} />{payment.payment_instructions ? <p className="mt-4 max-w-2xl whitespace-pre-wrap text-sm leading-6 text-neutral-600">{payment.payment_instructions}</p> : null}{payment.payment_url ? <a href={payment.payment_url} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 break-all text-sm font-semibold text-blue-700 underline underline-offset-4">Open payment link <ExternalLink className="size-4 shrink-0" /></a> : null}</div>{payment.payment_url ? <div className="flex flex-col items-center rounded-2xl border bg-white p-3"><img src={qrImageUrl(payment.payment_url)} alt="QR code for invoice payment link" width={176} height={176} className="size-44" referrerPolicy="no-referrer" /><p className="mt-2 text-center text-[11px] font-medium uppercase tracking-wide text-neutral-400">Scan to pay</p></div> : null}</div> : null}

      {(invoice.notes || invoice.terms_conditions) ? <div className="grid gap-6 pt-8 md:grid-cols-2">{invoice.notes ? <div><p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Notes</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-600">{invoice.notes}</p></div> : null}{invoice.terms_conditions ? <div><p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Terms & conditions</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-600">{invoice.terms_conditions}</p></div> : null}</div> : null}
    </section>
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="text-sm"><span className="mb-1.5 block font-medium text-neutral-600">{label}</span>{children}</label>; }
function Info({ label, value }: { label: string; value: string }) { return <div><p className="text-xs font-medium uppercase tracking-wide text-neutral-400">{label}</p><p className="mt-2 text-sm font-medium text-neutral-800">{value}</p></div>; }
function Meta({ label, value }: { label: string; value: string }) { return <div><p className="text-xs uppercase tracking-wide text-neutral-400">{label}</p><p className="mt-1 text-sm font-semibold">{value}</p></div>; }
function TotalRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) { return <div className={`flex items-center justify-between gap-4 ${strong ? "text-base font-semibold" : "text-neutral-600"}`}><span>{label}</span><span className="tabular-nums">{value}</span></div>; }
function PaymentLine({ label, value }: { label: string; value: string }) { return <div className="mt-2 flex flex-wrap gap-x-2 text-sm"><span className="text-neutral-400">{label}:</span><span className="font-medium text-neutral-700">{value}</span></div>; }
