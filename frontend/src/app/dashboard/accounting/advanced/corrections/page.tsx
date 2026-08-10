"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, History, RotateCcw, ShieldAlert } from "lucide-react";

import { AccountingNav } from "@/components/accounting-nav";
import { FinancialConfirmationDialog } from "@/components/financial-confirmation-dialog";
import { SearchableSelect } from "@/components/searchable-select";
import { getApiErrorMessage } from "@/lib/api-error";

type CorrectionType = "payment" | "expense" | "transfer" | "payable_payment" | "loan_disbursement" | "loan_repayment";
type Candidate = {
  source_type: CorrectionType;
  source_id: string;
  number: string;
  date: string;
  amount: string | number;
  currency: string;
  title: string;
  subtitle: string;
};
type CorrectionHistory = {
  id: string;
  source_type: CorrectionType;
  source_id: string | null;
  action: string;
  message: string | null;
  reason: string | null;
  reversal_date: string | null;
  reversal_journal_id: string | null;
  status: string;
  actor_user_id: string | null;
  created_at: string;
};
type TypeOption = { value: CorrectionType; title: string; help: string };

const correctionTypes: TypeOption[] = [
  { value: "payment", title: "Customer payment", help: "Invoice collection recorded in Money In" },
  { value: "expense", title: "Expense", help: "Posted company, project or client expense" },
  { value: "transfer", title: "Account transfer", help: "Transfer between your own financial accounts" },
  { value: "payable_payment", title: "Supplier payment", help: "Payment made against a supplier bill" },
  { value: "loan_disbursement", title: "Loan received", help: "Loan principal disbursed into a business account" },
  { value: "loan_repayment", title: "Loan repayment", help: "Principal, interest or fee paid to a lender" },
];

function today() { return new Date().toISOString().slice(0, 10); }
function money(value: string | number, currency: string) { return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function pretty(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (match) => match.toUpperCase()); }
function sourceHref(item: CorrectionHistory) {
  if (item.source_type === "expense") return "/dashboard/accounting/money-out";
  if (item.source_type === "transfer") return "/dashboard/accounting/transfers";
  if (item.source_type === "payable_payment") return "/dashboard/accounting/payables";
  if (item.source_type === "loan_disbursement" || item.source_type === "loan_repayment") return "/dashboard/accounting/loans";
  return "/dashboard/accounting/invoices";
}

export default function FinancialCorrectionsPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [history, setHistory] = useState<CorrectionHistory[]>([]);
  const [type, setType] = useState<CorrectionType>("payment");
  const [sourceId, setSourceId] = useState("");
  const [reason, setReason] = useState("");
  const [reversalDate, setReversalDate] = useState(today());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [candidateResponse, historyResponse] = await Promise.all([
        fetch("/api/accounting/corrections/candidates?limit=200", { cache: "no-store" }),
        fetch("/api/accounting/corrections/history?limit=100", { cache: "no-store" }),
      ]);
      const [candidatePayload, historyPayload] = await Promise.all([candidateResponse.json(), historyResponse.json()]);
      if (!candidateResponse.ok) throw new Error(getApiErrorMessage(candidatePayload, "Could not load reversible transactions"));
      if (!historyResponse.ok) throw new Error(getApiErrorMessage(historyPayload, "Could not load correction history"));
      setCandidates(candidatePayload);
      setHistory(historyPayload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load correction center");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => candidates.filter((item) => item.source_type === type), [candidates, type]);
  const selected = useMemo(() => filtered.find((item) => item.source_id === sourceId) ?? null, [filtered, sourceId]);
  const selectedType = correctionTypes.find((item) => item.value === type) ?? correctionTypes[0];
  const options = useMemo(() => filtered.map((item) => ({
    value: item.source_id,
    label: `${item.title} · ${money(item.amount, item.currency)}`,
    keywords: `${item.number} ${item.title} ${item.subtitle} ${item.currency} ${item.date}`,
  })), [filtered]);

  function changeType(next: CorrectionType) {
    setType(next); setSourceId(""); setReason(""); setMessage(null); setError(null);
  }

  async function reverse() {
    if (!selected || reason.trim().length < 3) return;
    setSaving(true); setError(null); setMessage(null);
    try {
      const response = await fetch("/api/accounting/corrections/reverse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_type: selected.source_type, source_id: selected.source_id, reason: reason.trim(), reversal_date: reversalDate }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not reverse transaction"));
      setMessage(`${payload.number} reversed successfully. ${payload.accounting_note}`);
      setConfirmOpen(false); setSourceId(""); setReason("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not reverse transaction");
      setConfirmOpen(false);
    } finally { setSaving(false); }
  }

  const details = selected ? [
    { label: "Transaction", value: selected.title },
    { label: "Type", value: selectedType.title },
    { label: "Original date", value: selected.date },
    { label: "Amount", value: money(selected.amount, selected.currency), emphasis: true },
    { label: "Reversal date", value: reversalDate },
    { label: "Reason", value: reason.trim() || "—" },
  ] : [];

  return <main className="p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-6xl space-y-6">
    <div>
      <Link href="/dashboard/accounting/advanced" className="inline-flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-950"><ArrowLeft className="size-4" />Advanced accounting</Link>
      <p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Finance & Accounts</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">Financial correction center</h1>
      <p className="mt-2 max-w-3xl text-sm text-neutral-500">Reverse an incorrect posted business transaction without deleting history. Business balances, accounting journal and audit trail are corrected together.</p>
    </div>
    <AccountingNav />

    {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}

    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
      <div className="flex gap-3"><ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-700" /><div><h2 className="font-semibold text-amber-950">Reversal is permanent accounting history</h2><p className="mt-1 text-sm text-amber-800">The original record stays visible. Business OS creates the opposite financial movement and a linked reversal journal. Loan disbursements with dependent principal repayments are protected—you must reverse those repayments first.</p></div></div>
    </section>

    <section className="rounded-2xl border bg-white p-5">
      <h2 className="text-lg font-semibold">Choose transaction to correct</h2>
      <p className="mt-1 text-sm text-neutral-500">Select the business event first. Business OS will restore the related receivable, payable, account or loan balance automatically.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{correctionTypes.map((item) => <button key={item.value} type="button" onClick={() => changeType(item.value)} className={`rounded-xl border px-4 py-3 text-left ${type === item.value ? "border-neutral-950 bg-neutral-950 text-white" : "bg-white hover:bg-neutral-50"}`}><p className="font-medium">{item.title}</p><p className={`mt-1 text-xs ${type === item.value ? "text-neutral-300" : "text-neutral-500"}`}>{item.help}</p></button>)}</div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <SearchableSelect label={`${selectedType.title} record`} required clearable={false} value={sourceId} onValueChange={setSourceId} options={options} placeholder={loading ? "Loading…" : filtered.length ? `Select ${selectedType.title.toLowerCase()}` : "No reversible records"} searchPlaceholder={`Search ${selectedType.title.toLowerCase()} by number, date, amount...`} />
        <label className="text-sm"><span className="mb-1.5 block font-medium text-neutral-600">Reversal date</span><input type="date" required value={reversalDate} onChange={(event) => setReversalDate(event.target.value)} className="w-full rounded-xl border px-3 py-2.5" /></label>
        <label className="text-sm md:col-span-2"><span className="mb-1.5 block font-medium text-neutral-600">Reason for correction</span><textarea required minLength={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Example: Supplier payment was recorded from the wrong bank account" className="min-h-24 w-full rounded-xl border px-3 py-2.5" /></label>
      </div>

      {selected ? <div className="mt-5 rounded-xl border bg-neutral-50 p-4 text-sm"><p className="font-medium">{selected.title}</p><p className="mt-1 text-neutral-500">{selected.subtitle}</p><div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs text-neutral-500"><span>Original date: {selected.date}</span><span>Amount: <strong className="text-neutral-900">{money(selected.amount, selected.currency)}</strong></span></div></div> : null}

      {type === "loan_disbursement" ? <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">Loan disbursement reversal is dependency-aware. If part of that principal was already repaid, reverse the related repayment first.</div> : null}
      {type === "payable_payment" ? <div className="mt-4 rounded-xl border bg-neutral-50 px-4 py-3 text-sm text-neutral-600">Reversing a supplier payment re-opens the bill for the reversed amount and restores the selected financial account balance.</div> : null}
      {type === "loan_repayment" ? <div className="mt-4 rounded-xl border bg-neutral-50 px-4 py-3 text-sm text-neutral-600">Reversing a loan repayment restores principal outstanding and reverses interest/fee expense together with the cash movement.</div> : null}

      <div className="mt-6 flex justify-end"><button type="button" disabled={!selected || reason.trim().length < 3 || saving} onClick={() => setConfirmOpen(true)} className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"><RotateCcw className="size-4" />Review reversal</button></div>
    </section>

    <section className="rounded-2xl border bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><History className="size-5" /><h2 className="text-lg font-semibold">Correction history</h2></div><p className="mt-1 text-sm text-neutral-500">Permanent audit trail of reversed financial transactions. Original records remain intact.</p></div><span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-600">{history.length} recent corrections</span></div>
      <div className="mt-4 overflow-x-auto rounded-xl border"><table className="min-w-full text-sm"><thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500"><tr><th className="px-4 py-3">Reversal date</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Reason</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Journal</th><th className="px-4 py-3">Source</th></tr></thead><tbody className="divide-y">
        {history.map((item) => <tr key={item.id} className="align-top"><td className="whitespace-nowrap px-4 py-3"><p className="font-medium">{item.reversal_date || "—"}</p><p className="mt-1 text-xs text-neutral-400">{new Date(item.created_at).toLocaleString()}</p></td><td className="px-4 py-3"><span className="rounded-full bg-red-50 px-2 py-1 text-xs font-medium text-red-700">{pretty(item.source_type)}</span></td><td className="max-w-md px-4 py-3"><p className="font-medium text-neutral-800">{item.reason || item.message || "Correction reversal"}</p><p className="mt-1 break-all text-xs text-neutral-400">Source ID: {item.source_id || "—"}</p></td><td className="px-4 py-3"><span className="rounded-full bg-neutral-100 px-2 py-1 text-xs font-semibold text-neutral-700">{pretty(item.status || "reversed")}</span></td><td className="px-4 py-3">{item.reversal_journal_id ? <Link href="/dashboard/accounting/advanced" className="inline-flex items-center gap-1 font-medium text-neutral-700 hover:text-neutral-950">View journal <ExternalLink className="size-3.5" /></Link> : <span className="text-xs text-neutral-400">No journal</span>}</td><td className="px-4 py-3"><Link href={sourceHref(item)} className="inline-flex items-center gap-1 font-medium text-neutral-700 hover:text-neutral-950">Open source <ExternalLink className="size-3.5" /></Link></td></tr>)}
        {!loading && history.length === 0 ? <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-neutral-500">No financial corrections have been posted yet.</td></tr> : null}
      </tbody></table></div>
    </section>

    <FinancialConfirmationDialog open={confirmOpen} title={`Reverse ${selected?.number ?? "transaction"}?`} description="Review carefully. This does not delete the original record; it posts the opposite business and accounting movements." confirmLabel="Confirm reversal" warning="This action preserves the original record and posts an auditable reversal. It should only be used to correct an incorrect financial posting." details={details} loading={saving} onCancel={() => setConfirmOpen(false)} onConfirm={() => void reverse()} />
  </div></main>;
}
