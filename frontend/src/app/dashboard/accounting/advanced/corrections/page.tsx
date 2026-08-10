"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, RotateCcw, ShieldAlert } from "lucide-react";

import { AccountingNav } from "@/components/accounting-nav";
import { FinancialConfirmationDialog } from "@/components/financial-confirmation-dialog";
import { SearchableSelect } from "@/components/searchable-select";
import { getApiErrorMessage } from "@/lib/api-error";

type CorrectionType = "payment" | "expense" | "transfer";
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

function today() { return new Date().toISOString().slice(0, 10); }
function money(value: string | number, currency: string) { return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function pretty(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (match) => match.toUpperCase()); }

export default function FinancialCorrectionsPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
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
      const response = await fetch("/api/accounting/corrections/candidates?limit=200", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not load reversible transactions"));
      setCandidates(payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load correction center");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => candidates.filter((item) => item.source_type === type), [candidates, type]);
  const selected = useMemo(() => filtered.find((item) => item.source_id === sourceId) ?? null, [filtered, sourceId]);
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
    { label: "Type", value: pretty(selected.source_type) },
    { label: "Original date", value: selected.date },
    { label: "Amount", value: money(selected.amount, selected.currency), emphasis: true },
    { label: "Reversal date", value: reversalDate },
    { label: "Reason", value: reason.trim() || "—" },
  ] : [];

  return <main className="p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-5xl space-y-6">
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
      <div className="flex gap-3"><ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-700" /><div><h2 className="font-semibold text-amber-950">Reversal is permanent accounting history</h2><p className="mt-1 text-sm text-amber-800">The original record stays visible. Business OS creates the opposite financial movement and, when a journal exists, a linked reversal journal. Use a clear reason so future reviewers understand the correction.</p></div></div>
    </section>

    <section className="rounded-2xl border bg-white p-5">
      <h2 className="text-lg font-semibold">Choose transaction to correct</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">{(["payment", "expense", "transfer"] as CorrectionType[]).map((item) => <button key={item} type="button" onClick={() => changeType(item)} className={`rounded-xl border px-4 py-3 text-left ${type === item ? "border-neutral-950 bg-neutral-950 text-white" : "bg-white hover:bg-neutral-50"}`}><p className="font-medium">{pretty(item)}</p><p className={`mt-1 text-xs ${type === item ? "text-neutral-300" : "text-neutral-500"}`}>{item === "payment" ? "Customer invoice collection" : item === "expense" ? "Posted company/project/client expense" : "Transfer between own accounts"}</p></button>)}</div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <SearchableSelect label={`${pretty(type)} record`} required clearable={false} value={sourceId} onValueChange={setSourceId} options={options} placeholder={loading ? "Loading…" : `Select ${type}`} searchPlaceholder={`Search ${type} number, date, amount...`} />
        <label className="text-sm"><span className="mb-1.5 block font-medium text-neutral-600">Reversal date</span><input type="date" required value={reversalDate} onChange={(event) => setReversalDate(event.target.value)} className="w-full rounded-xl border px-3 py-2.5" /></label>
        <label className="text-sm md:col-span-2"><span className="mb-1.5 block font-medium text-neutral-600">Reason for correction</span><textarea required minLength={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Example: Payment was entered against the wrong invoice" className="min-h-24 w-full rounded-xl border px-3 py-2.5" /></label>
      </div>

      {selected ? <div className="mt-5 rounded-xl border bg-neutral-50 p-4 text-sm"><p className="font-medium">{selected.title}</p><p className="mt-1 text-neutral-500">{selected.subtitle}</p><div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs text-neutral-500"><span>Original date: {selected.date}</span><span>Amount: <strong className="text-neutral-900">{money(selected.amount, selected.currency)}</strong></span></div></div> : null}

      <div className="mt-6 flex justify-end"><button type="button" disabled={!selected || reason.trim().length < 3 || saving} onClick={() => setConfirmOpen(true)} className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"><RotateCcw className="size-4" />Review reversal</button></div>
    </section>

    <FinancialConfirmationDialog open={confirmOpen} title={`Reverse ${selected?.number ?? "transaction"}?`} description="Review carefully. This does not delete the original record; it posts the opposite business and accounting movements." confirmLabel={saving ? "Reversing…" : "Confirm reversal"} danger details={details} busy={saving} onCancel={() => setConfirmOpen(false)} onConfirm={() => void reverse()} />
  </div></main>;
}
