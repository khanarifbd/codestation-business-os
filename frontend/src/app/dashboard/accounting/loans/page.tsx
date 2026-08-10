"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, CircleCheck, HandCoins, Plus, WalletCards } from "lucide-react";

import { AccountingNav } from "@/components/accounting-nav";
import { CurrencySelect } from "@/components/currency-select";
import { MoneyInput } from "@/components/money-input";
import { SearchableSelect } from "@/components/searchable-select";
import { getApiErrorMessage } from "@/lib/api-error";

type Loan = { id: string; lender_name: string; lender_type: string; currency: string; approved_amount: string; disbursed_amount: string; undisbursed_amount: string; outstanding_principal: string; annual_interest_rate: string; approval_date: string; maturity_date: string | null; status: string; reference: string | null };
type FinancialAccount = { id: string; name: string; account_type: string; currency: string; current_balance: string };
type Mode = "new" | "receive" | "repay" | null;

function amount(value: string | number, currency?: string) { return `${currency ? `${currency} ` : ""}${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function today() { return new Date().toISOString().slice(0, 10); }

export default function LoanAccountingPage() {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedLoanId, setSelectedLoanId] = useState("");
  const [mode, setMode] = useState<Mode>(null);
  const [approve, setApprove] = useState({ lender_name: "", lender_type: "bank", currency: "BDT", approved_amount: "", annual_interest_rate: "0", approval_date: today(), maturity_date: "", reference: "", notes: "" });
  const [receive, setReceive] = useState({ account_id: "", disbursement_date: today(), principal_amount: "", fee_withheld_amount: "0", reference: "", notes: "" });
  const [repay, setRepay] = useState({ account_id: "", payment_date: today(), principal_amount: "", interest_amount: "0", fee_amount: "0", fee_type: "loan_fee", reference: "", notes: "" });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [loanResponse, accountResponse] = await Promise.all([
        fetch("/api/accounting/loans", { cache: "no-store" }),
        fetch("/api/finance/accounts", { cache: "no-store" }),
      ]);
      const [loanPayload, accountPayload] = await Promise.all([loanResponse.json(), accountResponse.json()]);
      if (!loanResponse.ok) throw new Error(getApiErrorMessage(loanPayload, "Could not load loans"));
      if (!accountResponse.ok) throw new Error(getApiErrorMessage(accountPayload, "Could not load accounts"));
      setLoans(loanPayload);
      setAccounts(accountPayload);
      setSelectedLoanId((current) => current || loanPayload[0]?.id || "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load loans"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(() => loans.find((loan) => loan.id === selectedLoanId) ?? null, [loans, selectedLoanId]);
  const compatibleAccounts = useMemo(() => selected ? accounts.filter((account) => account.currency === selected.currency) : accounts, [accounts, selected]);
  const accountOptions = useMemo(() => compatibleAccounts.map((account) => ({ value: account.id, label: `${account.name} · ${amount(account.current_balance, account.currency)}`, keywords: `${account.name} ${account.currency} ${account.account_type}` })), [compatibleAccounts]);

  async function submitApprove(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      const response = await fetch("/api/accounting/loans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...approve, approved_amount: Number(approve.approved_amount), annual_interest_rate: Number(approve.annual_interest_rate || 0), maturity_date: approve.maturity_date || null, reference: approve.reference || null, notes: approve.notes || null }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not record loan agreement"));
      setApprove({ lender_name: "", lender_type: "bank", currency: "BDT", approved_amount: "", annual_interest_rate: "0", approval_date: today(), maturity_date: "", reference: "", notes: "" });
      await load(); setSelectedLoanId(payload.id); setMode(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not record loan agreement"); }
    finally { setSaving(false); }
  }

  async function submitReceive(event: FormEvent) {
    event.preventDefault(); if (!selected) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/accounting/loans/${selected.id}/disburse`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...receive, principal_amount: Number(receive.principal_amount), fee_withheld_amount: Number(receive.fee_withheld_amount || 0), reference: receive.reference || null, notes: receive.notes || null }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not receive loan money"));
      setReceive({ account_id: "", disbursement_date: today(), principal_amount: "", fee_withheld_amount: "0", reference: "", notes: "" });
      await load(); setMode(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not receive loan money"); }
    finally { setSaving(false); }
  }

  async function submitRepay(event: FormEvent) {
    event.preventDefault(); if (!selected) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/accounting/loans/${selected.id}/repay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...repay, principal_amount: Number(repay.principal_amount || 0), interest_amount: Number(repay.interest_amount || 0), fee_amount: Number(repay.fee_amount || 0), reference: repay.reference || null, notes: repay.notes || null }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not record repayment"));
      setRepay({ account_id: "", payment_date: today(), principal_amount: "", interest_amount: "0", fee_amount: "0", fee_type: "loan_fee", reference: "", notes: "" });
      await load(); setMode(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not record repayment"); }
    finally { setSaving(false); }
  }

  return <main className="p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-7xl space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Finance & Accounts</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Business loans</h1><p className="mt-2 max-w-3xl text-sm text-neutral-500">You only choose what happened in real life. The system handles loan liability, bank balance, interest and fees automatically.</p></div><button onClick={() => setMode("new")} className="inline-flex items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white"><Plus className="size-4" />New loan agreement</button></div>
    <AccountingNav />
    {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

    <section className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="rounded-2xl border bg-white p-3"><div className="px-2 py-2"><h2 className="font-semibold">Your loans</h2><p className="mt-1 text-xs text-neutral-400">Select one to see what to do next.</p></div><div className="mt-2 space-y-2">{loans.map((loan) => <button key={loan.id} type="button" onClick={() => { setSelectedLoanId(loan.id); setMode(null); }} className={`w-full rounded-xl border p-4 text-left transition ${selectedLoanId === loan.id ? "border-neutral-950 bg-neutral-950 text-white" : "bg-white hover:bg-neutral-50"}`}><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{loan.lender_name}</p><p className={`mt-1 text-xs ${selectedLoanId === loan.id ? "text-neutral-300" : "text-neutral-400"}`}>{loan.reference || "No reference"}</p></div><span className={`rounded-full px-2 py-1 text-[11px] capitalize ${selectedLoanId === loan.id ? "bg-white/10" : "bg-neutral-100 text-neutral-500"}`}>{loan.status}</span></div><p className="mt-4 text-lg font-semibold">{amount(loan.outstanding_principal, loan.currency)} due</p></button>)}{!loading && loans.length === 0 ? <div className="rounded-xl border border-dashed p-6 text-center"><HandCoins className="mx-auto size-7 text-neutral-300" /><p className="mt-3 text-sm font-medium">No loans yet</p><p className="mt-1 text-xs text-neutral-400">Create a loan agreement first.</p></div> : null}</div></div>

      <div className="space-y-4">{selected ? <>
        <div className="rounded-2xl border bg-white p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm text-neutral-500">Loan from</p><h2 className="mt-1 text-2xl font-semibold">{selected.lender_name}</h2><p className="mt-1 text-sm text-neutral-400">{selected.currency} · {selected.annual_interest_rate}% annual interest{selected.maturity_date ? ` · Due ${selected.maturity_date}` : ""}</p></div><div className="flex flex-wrap gap-2"><button type="button" disabled={Number(selected.undisbursed_amount) <= 0} onClick={() => setMode("receive")} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium disabled:opacity-40"><ArrowDownToLine className="size-4" />Receive money</button><button type="button" disabled={Number(selected.outstanding_principal) <= 0} onClick={() => setMode("repay")} className="inline-flex items-center gap-2 rounded-xl bg-neutral-950 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"><WalletCards className="size-4" />Make repayment</button></div></div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Loan agreement" value={amount(selected.approved_amount, selected.currency)} help="Maximum approved" /><Stat label="Money received" value={amount(selected.disbursed_amount, selected.currency)} help="Actually received so far" /><Stat label="Still available" value={amount(selected.undisbursed_amount, selected.currency)} help="Approved but not received" /><Stat label="Principal still due" value={amount(selected.outstanding_principal, selected.currency)} help="Amount you still owe" /></div>
        </div>
        <div className="rounded-2xl border bg-white p-5"><h3 className="font-semibold">How this loan works</h3><div className="mt-4 grid gap-3 md:grid-cols-3"><Step done title="1. Agreement recorded" text={`${amount(selected.approved_amount, selected.currency)} approved. This alone does not change your bank balance.`} /><Step done={Number(selected.disbursed_amount) > 0} title="2. Money received" text={Number(selected.disbursed_amount) > 0 ? `${amount(selected.disbursed_amount, selected.currency)} has reached your financial accounts.` : "When the lender sends money, click Receive money and choose where it arrived."} /><Step done={Number(selected.outstanding_principal) === 0 && Number(selected.disbursed_amount) > 0} title="3. Repay over time" text={Number(selected.outstanding_principal) > 0 ? `${amount(selected.outstanding_principal, selected.currency)} principal is still payable. Interest and fees are tracked separately.` : "No principal is currently outstanding."} /></div></div>
      </> : <div className="rounded-2xl border border-dashed bg-white p-12 text-center"><HandCoins className="mx-auto size-9 text-neutral-300" /><p className="mt-3 font-medium">Select or create a loan</p><p className="mt-1 text-sm text-neutral-500">The next action will be shown here.</p></div>}</div>
    </section>

    {mode ? <section className="rounded-2xl border bg-white p-5"><div className="mb-5"><h2 className="text-lg font-semibold">{mode === "new" ? "Record a new loan agreement" : mode === "receive" ? "Receive loan money" : "Record a loan repayment"}</h2><p className="mt-1 text-sm text-neutral-500">{mode === "new" ? "This records the agreement only. No bank balance changes yet." : mode === "receive" ? "Choose the account where the lender actually sent the money." : "Tell us how much of this payment was principal, interest and fees."}</p></div>
      {mode === "new" ? <form onSubmit={submitApprove} className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Field label="Lender name"><input required value={approve.lender_name} onChange={(event) => setApprove((current) => ({ ...current, lender_name: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
        <Field label="Lender type"><select value={approve.lender_type} onChange={(event) => setApprove((current) => ({ ...current, lender_type: event.target.value }))} className="w-full rounded-xl border bg-white px-3 py-2.5"><option value="bank">Bank</option><option value="person">Person</option><option value="company">Company</option><option value="investor">Investor</option><option value="other">Other</option></select></Field>
        <CurrencySelect required clearable={false} value={approve.currency} onValueChange={(value) => setApprove((current) => ({ ...current, currency: value }))} />
        <MoneyInput label="Approved amount" currency={approve.currency} required min={0.01} value={approve.approved_amount} onValueChange={(value) => setApprove((current) => ({ ...current, approved_amount: value }))} />
        <Field label="Annual interest %"><input type="number" min="0" step="0.0001" value={approve.annual_interest_rate} onChange={(event) => setApprove((current) => ({ ...current, annual_interest_rate: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
        <Field label="Agreement / approval date"><input required type="date" value={approve.approval_date} onChange={(event) => setApprove((current) => ({ ...current, approval_date: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
        <Field label="Maturity date"><input type="date" value={approve.maturity_date} onChange={(event) => setApprove((current) => ({ ...current, maturity_date: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
        <Field label="Reference"><input value={approve.reference} onChange={(event) => setApprove((current) => ({ ...current, reference: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
        <div className="flex items-end gap-2"><button disabled={saving} className="flex-1 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? "Saving…" : "Save agreement"}</button><button type="button" onClick={() => setMode(null)} className="rounded-xl border px-4 py-2.5 text-sm">Cancel</button></div>
      </form> : null}

      {mode === "receive" && selected ? <form onSubmit={submitReceive} className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <SearchableSelect label="Receive into" required clearable={false} value={receive.account_id} onValueChange={(value) => setReceive((current) => ({ ...current, account_id: value }))} options={accountOptions} placeholder="Select bank/cash/wallet" searchPlaceholder="Search account..." />
        <MoneyInput label="Amount lender disbursed" currency={selected.currency} required min={0.01} max={Number(selected.undisbursed_amount)} value={receive.principal_amount} onValueChange={(value) => setReceive((current) => ({ ...current, principal_amount: value }))} hint={`Still available: ${amount(selected.undisbursed_amount, selected.currency)}`} />
        <MoneyInput label="Fee deducted before receiving" currency={selected.currency} min={0} value={receive.fee_withheld_amount} onValueChange={(value) => setReceive((current) => ({ ...current, fee_withheld_amount: value }))} />
        <Field label="Date received"><input required type="date" value={receive.disbursement_date} onChange={(event) => setReceive((current) => ({ ...current, disbursement_date: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
        <Field label="Reference"><input value={receive.reference} onChange={(event) => setReceive((current) => ({ ...current, reference: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
        <div className="flex items-end gap-2"><button disabled={saving} className="flex-1 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? "Posting…" : "Confirm money received"}</button><button type="button" onClick={() => setMode(null)} className="rounded-xl border px-4 py-2.5 text-sm">Cancel</button></div>
      </form> : null}

      {mode === "repay" && selected ? <form onSubmit={submitRepay} className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <SearchableSelect label="Pay from" required clearable={false} value={repay.account_id} onValueChange={(value) => setRepay((current) => ({ ...current, account_id: value }))} options={accountOptions} placeholder="Select bank/cash/wallet" searchPlaceholder="Search account..." />
        <MoneyInput label="Principal part" currency={selected.currency} min={0} max={Number(selected.outstanding_principal)} value={repay.principal_amount} onValueChange={(value) => setRepay((current) => ({ ...current, principal_amount: value }))} hint={`Principal still due: ${amount(selected.outstanding_principal, selected.currency)}`} />
        <MoneyInput label="Interest part" currency={selected.currency} min={0} value={repay.interest_amount} onValueChange={(value) => setRepay((current) => ({ ...current, interest_amount: value }))} />
        <MoneyInput label="Other loan fee" currency={selected.currency} min={0} value={repay.fee_amount} onValueChange={(value) => setRepay((current) => ({ ...current, fee_amount: value }))} />
        <Field label="Payment date"><input required type="date" value={repay.payment_date} onChange={(event) => setRepay((current) => ({ ...current, payment_date: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
        <Field label="Reference"><input value={repay.reference} onChange={(event) => setRepay((current) => ({ ...current, reference: event.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
        <div className="flex justify-end gap-2 md:col-span-2 lg:col-span-3"><button type="button" onClick={() => setMode(null)} className="rounded-xl border px-4 py-2.5 text-sm">Cancel</button><button disabled={saving} className="rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? "Posting…" : "Confirm repayment"}</button></div>
      </form> : null}
    </section> : null}
  </div></main>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="text-sm"><span className="mb-1.5 block font-medium text-neutral-600">{label}</span>{children}</label>; }
function Stat({ label, value, help }: { label: string; value: string; help: string }) { return <div className="rounded-xl bg-neutral-50 p-4"><p className="text-xs font-medium uppercase tracking-wide text-neutral-400">{label}</p><p className="mt-2 text-xl font-semibold tabular-nums">{value}</p><p className="mt-1 text-xs text-neutral-400">{help}</p></div>; }
function Step({ done, title, text }: { done: boolean; title: string; text: string }) { return <div className="rounded-xl border p-4"><div className="flex items-center gap-2"><div className={`flex size-7 items-center justify-center rounded-full ${done ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-400"}`}>{done ? <CircleCheck className="size-4" /> : <span className="size-2 rounded-full bg-current" />}</div><p className="font-medium">{title}</p></div><p className="mt-3 text-sm leading-5 text-neutral-500">{text}</p></div>; }
