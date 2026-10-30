"use client";

import { useDashboardSession } from "@/components/dashboard-session-context";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { exactSalesPayload } from "@/lib/exact-sales-decimal";
import { formatMoneyExact } from "@/lib/sales-money-preview";
import { getApiErrorMessage } from "@/lib/api-error";
import { useParams, useRouter } from "next/navigation";
import { CircleDollarSign, FilePlus2, Plus, RefreshCw, Trash2 } from "lucide-react";

import { RelationshipPage, RelationshipHeader } from "@/components/relationships/relationship-ui";
import "@/components/commercial/order-detail.css";

type LineInput = { item_name: string; description: string; quantity: string; unit_price: string; discount_percent: string; tax_rate: string; unit: string; item_type: string };
type Change = { id: string; change_number: string; change_type: string; status: string; title: string; reason: string | null; currency: string; total: string; effective_delta: string; approved_at: string | null };
type Billing = { id: string; title: string; description: string | null; currency: string; amount: string; due_date: string | null; status: string; invoice_id: string | null; invoice_number: string | null };
type Summary = { order_id: string; order_number: string; currency: string; staged_billing_enabled: boolean; original_value: string; approved_change_value: string; revised_contract_value: string; scheduled_value: string; billed_value: string; draft_invoice_value: string; paid_value: string; accounts_receivable: string; remaining_to_bill: string; remaining_to_schedule: string; changes: Change[]; billing_milestones: Billing[] };

const emptyLine = (): LineInput => ({ item_name: "", description: "", quantity: "1", unit_price: "0", discount_percent: "0", tax_rate: "0", unit: "unit", item_type: "service" });
const money = formatMoneyExact;

export default function OrderCommercialPage() {
  const { tenant } = useDashboardSession();
  const canManageOrders = Boolean(tenant?.is_owner || tenant?.permissions.some(p => p === "*" || p === "orders.manage"));
  const canManageFinance = Boolean(tenant?.is_owner || tenant?.permissions.some(p => p === "*" || p === "finance.manage"));
  const params = useParams<{ orderId: string }>();
  const router = useRouter();
  const orderId = params.orderId;
  const scope = JSON.stringify([tenant?.organization.id, tenant?.membership_id, tenant?.role_id, tenant?.is_owner, tenant?.permissions.slice().sort(), orderId]);
  const owner = useMemo(() => ({ scope }), [scope]);
  const activeOwner = useRef<typeof owner | null>(owner);
  const writeEpoch = useRef(0);
  const admissionEpoch = writeEpoch.current;
  const documentKey = JSON.stringify([tenant?.organization.id, orderId]);
  const unknownDocuments = useRef(new Set<string>());
  const readRequired = useRef(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const pending = useRef(false);
  const uncertainWrite = useRef(false);
  const alive = useRef(true);
  const readEpoch = useRef(0);
  const [uncertain, setUncertain] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [billingOpen, setBillingOpen] = useState(false);
  const [changeType, setChangeType] = useState("addition");
  const [changeTitle, setChangeTitle] = useState("");
  const [changeReason, setChangeReason] = useState("");
  const [changeLines, setChangeLines] = useState<LineInput[]>([emptyLine()]);
  const [billingTitle, setBillingTitle] = useState("");
  const [billingDue, setBillingDue] = useState("");
  const [billingOrderChangeId, setBillingOrderChangeId] = useState("");
  const [billingLines, setBillingLines] = useState<LineInput[]>([emptyLine()]);
  useLayoutEffect(() => {
    activeOwner.current = owner;
    alive.current = true;
    pending.current = false;
    uncertainWrite.current = unknownDocuments.current.has(documentKey);
    readRequired.current = false;
    setRefreshRequired(false);
    setBusy(null); setUncertain(uncertainWrite.current); setSummary(null); setError(null);
    setChangeOpen(false); setBillingOpen(false);
    setChangeType("addition"); setChangeTitle(""); setChangeReason(""); setChangeLines([emptyLine()]);
    setBillingTitle(""); setBillingDue(""); setBillingOrderChangeId(""); setBillingLines([emptyLine()]);
    return () => {
      if (activeOwner.current !== owner) return;
      activeOwner.current = null;
      alive.current = false;
      readEpoch.current += 1;
    };
  }, [owner, documentKey]);
  const ownsView = () => alive.current && activeOwner.current === owner;


  const load = useCallback(async (reportFailure = false) => {
    if (!alive.current || activeOwner.current !== owner) return;
    const epoch = ++readEpoch.current;
    const current = () => alive.current && activeOwner.current === owner && epoch === readEpoch.current;
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/sales/orders/${encodeURIComponent(orderId)}/commercial`, { cache: "no-store" });
      if (!current()) return;
      if (response.status === 401) { router.replace("/login"); return; }
      const payload = await response.json().catch(() => null);
      if (!current()) return;
      if (response.status === 403) setSummary(null);
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Unable to load commercial workspace"));
      if (payload?.order_id !== orderId) throw new Error("Commercial order identity could not be verified.");
      setSummary(payload as Summary);
      readRequired.current = false;
      setRefreshRequired(false);
    } catch (reason) {
      if (current()) {
        if (reportFailure) throw reason;
        setError(reason instanceof Error ? reason.message : "Unable to load commercial workspace");
      }
    } finally { if (current()) setLoading(false); }
  }, [orderId, router, owner]);

  useEffect(() => { void load(); }, [load]);

  async function post(path: string, body: unknown, key: string) {
    if (!ownsView() || admissionEpoch !== writeEpoch.current || readRequired.current || (path.endsWith("/invoice") ? !canManageFinance : !canManageOrders) || pending.current || uncertainWrite.current) return null;
    pending.current = true;
    readEpoch.current += 1;
    unknownDocuments.current.add(documentKey);
    const epoch = ++writeEpoch.current;
    const current = () => ownsView() && writeEpoch.current === epoch;
    setBusy(key); setError(null);
    let acknowledged = false, rejected = false;
    try {
      const response = await fetch(`/api/sales/orders/${encodeURIComponent(orderId)}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!current()) return null;
      acknowledged = response.ok;
      if (acknowledged) { readEpoch.current += 1; readRequired.current = true; setRefreshRequired(true); }
      const payload = await response.json().catch(() => null);
      if (!current()) return null;
      rejected = response.status >= 400 && response.status < 500 && response.status !== 408
        && getApiErrorMessage(payload, "").trim().length > 0;
      if (acknowledged || rejected) unknownDocuments.current.delete(documentKey);
      if (response.status === 401 && rejected) router.replace("/login");
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Action failed"));
      if (!current()) return null;
      readRequired.current = true; setRefreshRequired(true);
      try { await load(true); }
      catch { if (current()) setError("Changes were saved, but the view could not be refreshed. Refresh the view without submitting again."); }
      // Successful HTTP status proves the write; a missing body must not invite replay.
      return current() ? payload ?? {} : null;
    } catch (reason) {
      if (current()) {
        if (!acknowledged && !rejected) {
          uncertainWrite.current = true;
          unknownDocuments.current.add(documentKey);
          setUncertain(true);
          setError("The action outcome is uncertain and may already be recorded. Do not submit again. Check the order records before taking further action.");
        } else setError(acknowledged ? "Changes were saved. Refresh the view without submitting again." : reason instanceof Error ? reason.message : "Action failed");
      }
      return null;
    } finally { if (current()) { pending.current = false; setBusy(null); } }
  }

  const payloadLines = (lines: LineInput[]) => lines.map((line) => {
    const decimals = exactSalesPayload(line);
    if (!decimals) throw new Error("Enter valid quantities, prices and percentages (up to four decimal places).");
    return { ...line, ...decimals };
  });
  const updateLine = (lines: LineInput[], setLines: (value: LineInput[]) => void, index: number, field: keyof LineInput, value: string) => setLines(lines.map((line, i) => i === index ? { ...line, [field]: value } : line));

  async function createChange() {
    if (!ownsView() || pending.current || uncertainWrite.current || readRequired.current) return;
    let items;
    try { items = payloadLines(changeLines); } catch (reason) { setError((reason as Error).message); return; }
    const result = await post("/changes", { change_type: changeType, title: changeTitle, reason: changeReason || null, items }, "change-create");
    if (result && ownsView()) { setChangeOpen(false); setChangeTitle(""); setChangeReason(""); setChangeLines([emptyLine()]); }
  }
  async function createBilling() {
    if (!ownsView() || pending.current || uncertainWrite.current || readRequired.current) return;
    let items;
    try { items = payloadLines(billingLines); } catch (reason) { setError((reason as Error).message); return; }
    const result = await post("/billing-milestones", { title: billingTitle, due_date: billingDue || null, order_change_id: billingOrderChangeId || null, items }, "billing-create");
    if (result && ownsView()) { setBillingOpen(false); setBillingTitle(""); setBillingDue(""); setBillingOrderChangeId(""); setBillingLines([emptyLine()]); }
  }

  if (loading && !summary) return <RelationshipPage className="order-commercial-workspace"><div role="status" className="order-loading">Loading commercial workspace…</div></RelationshipPage>;
  if (!summary) return <RelationshipPage className="order-commercial-workspace"><div role="alert" className="relationship-notice" data-tone="error">{error ?? "Commercial workspace unavailable"}</div></RelationshipPage>;

  const metrics = [
    ["Original contract", summary.original_value], ["Approved changes", summary.approved_change_value], ["Revised contract", summary.revised_contract_value],
    ["Scheduled", summary.scheduled_value], ["Remaining to schedule", summary.remaining_to_schedule], ["Draft invoices", summary.draft_invoice_value],
    ["Billed", summary.billed_value], ["Paid", summary.paid_value], ["Accounts receivable", summary.accounts_receivable], ["Remaining to bill", summary.remaining_to_bill],
  ];
  const approvedChanges = summary.changes.filter((change) => change.status === "approved");

  return <RelationshipPage className="order-commercial-workspace"><div className="order-commercial-content">
    <RelationshipHeader eyebrow={`${summary.order_number} / Commercial workspace`} title="Contract, billing & collection" description="Original scope stays intact. Follow approved changes through scheduled billing and recorded collection." actions={<button onClick={() => void load()} className="relationship-secondary"><RefreshCw className="size-4" />Refresh</button>} />
    {refreshRequired ? <div role="status" className="relationship-notice">Changes were saved. Refresh the view before taking another action; do not submit the saved action again.</div> : null}
    {uncertain ? <div role="alert" className="relationship-notice" data-tone="error">This action may already be recorded. Further writes are blocked in this view. Check the order records; refreshing does not prove a retry is safe.</div> : null}
    {error ? <div role="alert" className="relationship-notice" data-tone="error">{error}</div> : null}

    {Number(summary.remaining_to_schedule) > 0 && summary.staged_billing_enabled ? <div className="order-commercial-warning" role="status"><strong>{money(summary.remaining_to_schedule, summary.currency)}</strong> of the revised contract still needs a Billing Schedule. The Order cannot be completed until the commercial schedule is fully covered.</div> : Number(summary.remaining_to_bill) > 0 && summary.staged_billing_enabled ? <div className="order-commercial-warning" role="status"><strong>{money(summary.remaining_to_bill, summary.currency)}</strong> of approved contract value is still unbilled. Issue the remaining milestone invoice or approve a scope reduction before completion.</div> : null}

    <section className="order-commercial-ledger" aria-label={`Commercial summary in ${summary.currency}`}>
      {[{ title: "Contract value", note: "Original scope + approved changes", rows: metrics.slice(0, 3) }, { title: "Billing position", note: "Schedule, drafts and issued invoices", rows: [metrics[3], metrics[4], metrics[5], metrics[6], metrics[9]] }, { title: "Collection", note: "Recorded payments and receivables", rows: metrics.slice(7, 9) }].map((group) => <div key={group.title} className="order-commercial-ledger-group"><header><h2>{group.title}</h2><p>{group.note}</p><span>{summary.currency}</span></header><dl>{group.rows.map(([label, value]) => <div key={label} data-emphasis={label === "Revised contract" || label === "Accounts receivable" || undefined}><dt>{label}</dt><dd>{money(value, summary.currency)}</dd></div>)}</dl></div>)}
    </section>

    <fieldset disabled={Boolean(busy) || uncertain || refreshRequired} className="order-commercial-registers min-w-0" aria-busy={Boolean(busy)}>
    <section className="order-commercial-register order-billing-register"><div className="order-commercial-section-header"><div><h2 className="font-semibold">Billing schedule</h2><p className="mt-1 text-xs text-neutral-400">Schedule only the amount that is currently billable; invoices remain independent receivables.</p></div>{canManageOrders ? <button onClick={() => setBillingOpen((v) => !v)} aria-expanded={billingOpen} className="relationship-primary"><CircleDollarSign className="size-4" />{canManageOrders && billingOpen ? "Close milestone form" : "Add billing milestone"}</button> : null}</div>
      {canManageOrders && billingOpen ? <div className="order-commercial-draft"><div className="grid gap-3 md:grid-cols-3"><input aria-label="Billing milestone title" value={billingTitle} onChange={(e) => setBillingTitle(e.target.value)} placeholder="Billing milestone title" className="h-11 rounded-xl border px-3 text-sm md:col-span-2" /><input aria-label="Billing due date" type="date" value={billingDue} onChange={(e) => setBillingDue(e.target.value)} className="h-11 rounded-xl border px-3 text-sm" />{approvedChanges.length ? <select aria-label="Associated approved change" value={billingOrderChangeId} onChange={(e) => setBillingOrderChangeId(e.target.value)} className="h-11 rounded-xl border bg-white px-3 text-sm md:col-span-3"><option value="">Original order scope / no specific change</option>{approvedChanges.map((change) => <option key={change.id} value={change.id}>{change.change_number} — {change.title}</option>)}</select> : null}</div><LineEditor lines={billingLines} setLines={setBillingLines} updateLine={updateLine} /><div className="mt-4 flex justify-end"><button disabled={!!busy || !billingTitle.trim()} onClick={() => void createBilling()} className="h-10 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-40">Create billing milestone</button></div></div> : null}
      <div className="divide-y">{summary.billing_milestones.length ? summary.billing_milestones.map((item) => <div key={item.id} className="order-commercial-record"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{item.title}</p><span className="rounded-full bg-neutral-100 px-2 py-1 text-[11px] font-semibold uppercase">{item.status}</span></div><p className="mt-1 text-xs text-neutral-400">{item.due_date ? `Due ${item.due_date}` : "No due date"}</p></div><p className="text-lg font-semibold">{money(item.amount, item.currency)}</p></div><div className="mt-4 flex flex-wrap gap-2">{canManageOrders && item.status === "planned" ? <button disabled={!!busy} onClick={() => void post(`/billing-milestones/${item.id}/action`, { action: "mark_billable" }, `bill-${item.id}`)} className="rounded-lg border px-3 py-2 text-xs font-semibold">Mark billable</button> : null}{canManageFinance && item.status === "billable" ? <button disabled={!!busy} onClick={async () => { const invoice = await post(`/billing-milestones/${item.id}/invoice`, {}, `inv-${item.id}`); if (invoice?.invoice_id && ownsView()) router.push(`/dashboard/accounting/invoices/${invoice.invoice_id}`); }} className="inline-flex items-center gap-2 rounded-lg bg-neutral-950 px-3 py-2 text-xs font-semibold text-white"><FilePlus2 className="size-3.5" />Create draft invoice</button> : null}{item.invoice_id ? <Link href={`/dashboard/accounting/invoices/${item.invoice_id}`} className="rounded-lg border px-3 py-2 text-xs font-semibold">Open {item.invoice_number ?? "invoice"}</Link> : null}{canManageOrders && item.status !== "cancelled" && !item.invoice_id ? <button disabled={!!busy} onClick={() => void post(`/billing-milestones/${item.id}/action`, { action: "cancel" }, `bill-${item.id}`)} className="rounded-lg border px-3 py-2 text-xs font-semibold text-red-600">Cancel</button> : null}</div></div>) : <div className="p-10 text-center text-sm text-neutral-400">No billing milestones yet.</div>}</div>
    </section>
    <section className="order-commercial-register order-scope-register"><div className="order-commercial-section-header"><div><h2 className="font-semibold">Scope changes</h2><p className="mt-1 text-xs text-neutral-400">Preserve the original order and record additions or reductions separately.</p></div>{canManageOrders ? <button onClick={() => setChangeOpen((v) => !v)} aria-expanded={changeOpen} className="relationship-secondary"><Plus className="size-4" />{canManageOrders && changeOpen ? "Close change form" : "Add change"}</button> : null}</div>
      {canManageOrders && changeOpen ? <div className="order-commercial-draft"><div className="grid gap-3 md:grid-cols-3"><select aria-label="Change type" value={changeType} onChange={(e) => setChangeType(e.target.value)} className="h-11 rounded-xl border bg-white px-3 text-sm"><option value="addition">Addition</option><option value="reduction">Reduction</option><option value="cancellation">Cancel remaining scope</option></select><input aria-label="Change title" value={changeTitle} onChange={(e) => setChangeTitle(e.target.value)} placeholder="Change title" className="h-11 rounded-xl border px-3 text-sm md:col-span-2" /><textarea aria-label="Reason or commercial note" value={changeReason} onChange={(e) => setChangeReason(e.target.value)} placeholder="Reason / commercial note" className="min-h-20 rounded-xl border p-3 text-sm md:col-span-3" /></div><LineEditor lines={changeLines} setLines={setChangeLines} updateLine={updateLine} /><div className="mt-4 flex justify-end"><button disabled={!!busy || !changeTitle.trim()} onClick={() => void createChange()} className="h-10 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-40">Create draft change</button></div></div> : null}
      <div className="divide-y">{summary.changes.length ? summary.changes.map((change) => <div key={change.id} className="order-commercial-record"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{change.title}</p><span className="rounded-full bg-neutral-100 px-2 py-1 text-[11px] font-semibold uppercase">{change.status}</span></div><p className="mt-1 text-xs text-neutral-400">{change.change_number} · {change.change_type}</p>{change.reason ? <p className="mt-2 text-sm text-neutral-600">{change.reason}</p> : null}</div><p className={`text-lg font-semibold ${Number(change.effective_delta) < 0 ? "text-red-600" : "text-emerald-700"}`}>{Number(change.effective_delta) >= 0 ? "+" : ""}{money(change.effective_delta, change.currency)}</p></div><div className="mt-4 flex flex-wrap gap-2">{canManageOrders && change.status === "draft" ? <button disabled={!!busy} onClick={() => void post(`/changes/${change.id}/action`, { action: "submit" }, `chg-${change.id}`)} className="rounded-lg border px-3 py-2 text-xs font-semibold">Submit for approval</button> : null}{canManageOrders && change.status === "pending" ? <><button disabled={!!busy} onClick={() => void post(`/changes/${change.id}/action`, { action: "approve" }, `chg-${change.id}`)} className="rounded-lg bg-neutral-950 px-3 py-2 text-xs font-semibold text-white">Approve</button><button disabled={!!busy} onClick={() => void post(`/changes/${change.id}/action`, { action: "reject" }, `chg-${change.id}`)} className="rounded-lg border px-3 py-2 text-xs font-semibold">Reject</button></> : null}</div></div>) : <div className="p-10 text-center text-sm text-neutral-400">No scope changes yet.</div>}</div>
    </section>

    </fieldset>
  </div></RelationshipPage>;
}

function LineEditor({ lines, setLines, updateLine }: { lines: LineInput[]; setLines: (value: LineInput[]) => void; updateLine: (lines: LineInput[], setLines: (value: LineInput[]) => void, index: number, field: keyof LineInput, value: string) => void }) {
  return <div className="order-commercial-lines">{lines.map((line, index) => <div key={index} className="order-commercial-line">
    <div className="order-commercial-line-heading"><span>Line {index + 1}</span><button type="button" aria-label={`Remove line ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, i) => i !== index))} className="flex h-10 w-10 items-center justify-center rounded-lg border text-neutral-400 disabled:opacity-30"><Trash2 className="size-4" /></button></div>
    <div className="order-commercial-line-identity"><label>Service / item<input value={line.item_name} onChange={(e) => updateLine(lines, setLines, index, "item_name", e.target.value)} placeholder="Service / item" className="h-10 rounded-lg border px-3 text-sm" /></label><label>Description<input value={line.description} onChange={(e) => updateLine(lines, setLines, index, "description", e.target.value)} placeholder="Description" className="h-10 rounded-lg border px-3 text-sm" /></label></div>
    <div className="order-commercial-line-values"><label>Quantity<input type="number" min="0.0001" step="0.01" value={line.quantity} onChange={(e) => updateLine(lines, setLines, index, "quantity", e.target.value)} className="h-10 rounded-lg border px-3 text-sm" title="Quantity" /></label><label>Unit price<input type="number" min="0" step="0.01" value={line.unit_price} onChange={(e) => updateLine(lines, setLines, index, "unit_price", e.target.value)} className="h-10 rounded-lg border px-3 text-sm" title="Unit price" /></label><label>Tax %<input type="number" min="0" max="100" step="0.01" value={line.tax_rate} onChange={(e) => updateLine(lines, setLines, index, "tax_rate", e.target.value)} className="h-10 rounded-lg border px-3 text-sm" title="Tax %" /></label><label>Discount %<input type="number" min="0" max="100" step="0.01" value={line.discount_percent} onChange={(e) => updateLine(lines, setLines, index, "discount_percent", e.target.value)} className="h-10 rounded-lg border px-3 text-sm" title="Discount %" /></label></div>
  </div>)}<button type="button" onClick={() => setLines([...lines, emptyLine()])} className="inline-flex items-center gap-2 text-sm font-medium text-neutral-600"><Plus className="size-4" />Add line</button></div>;
}
