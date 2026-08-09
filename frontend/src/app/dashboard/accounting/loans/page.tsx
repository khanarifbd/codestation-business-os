"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Loan = {
  id: string;
  lender_name: string;
  lender_type: string;
  currency: string;
  approved_amount: string;
  disbursed_amount: string;
  undisbursed_amount: string;
  outstanding_principal: string;
  annual_interest_rate: string;
  approval_date: string;
  maturity_date: string | null;
  status: string;
  reference: string | null;
};

type FinancialAccount = {
  id: string;
  name: string;
  account_type: string;
  currency: string;
  current_balance: string;
};

function amount(value: string | number) {
  return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function LoanAccountingPage() {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedLoanId, setSelectedLoanId] = useState("");
  const [mode, setMode] = useState<"approve" | "disburse" | "repay">("approve");
  const [approve, setApprove] = useState({ lender_name: "", lender_type: "bank", currency: "BDT", approved_amount: "", annual_interest_rate: "0", approval_date: today(), maturity_date: "", reference: "", notes: "" });
  const [disburse, setDisburse] = useState({ account_id: "", disbursement_date: today(), principal_amount: "", fee_withheld_amount: "0", reference: "", notes: "" });
  const [repay, setRepay] = useState({ account_id: "", payment_date: today(), principal_amount: "", interest_amount: "0", fee_amount: "0", fee_type: "loan_fee", reference: "", notes: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [loanResponse, accountResponse] = await Promise.all([
        fetch("/api/accounting/loans", { cache: "no-store" }),
        fetch("/api/finance/accounts", { cache: "no-store" }),
      ]);
      const loanPayload = await loanResponse.json();
      const accountPayload = await accountResponse.json();
      if (!loanResponse.ok) throw new Error(loanPayload.detail ?? "Failed to load loans");
      if (!accountResponse.ok) throw new Error(accountPayload.detail ?? "Failed to load financial accounts");
      setLoans(loanPayload);
      setAccounts(accountPayload);
      setSelectedLoanId((current) => current || loanPayload[0]?.id || "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to load loan accounting");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selectedLoan = useMemo(() => loans.find((loan) => loan.id === selectedLoanId) ?? null, [loans, selectedLoanId]);
  const compatibleAccounts = useMemo(() => selectedLoan ? accounts.filter((account) => account.currency === selectedLoan.currency) : accounts, [accounts, selectedLoan]);

  async function submitApprove(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError(null);
    try {
      const response = await fetch("/api/accounting/loans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...approve,
          approved_amount: Number(approve.approved_amount),
          annual_interest_rate: Number(approve.annual_interest_rate || 0),
          maturity_date: approve.maturity_date || null,
          reference: approve.reference || null,
          notes: approve.notes || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail ?? "Failed to approve loan");
      setApprove({ lender_name: "", lender_type: "bank", currency: "BDT", approved_amount: "", annual_interest_rate: "0", approval_date: today(), maturity_date: "", reference: "", notes: "" });
      await load();
      setSelectedLoanId(payload.id);
      setMode("disburse");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Failed to approve loan"); }
    finally { setSaving(false); }
  }

  async function submitDisbursement(event: FormEvent) {
    event.preventDefault();
    if (!selectedLoan) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/accounting/loans/${selectedLoan.id}/disburse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...disburse,
          principal_amount: Number(disburse.principal_amount),
          fee_withheld_amount: Number(disburse.fee_withheld_amount || 0),
          reference: disburse.reference || null,
          notes: disburse.notes || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail ?? "Failed to post disbursement");
      setDisburse({ account_id: "", disbursement_date: today(), principal_amount: "", fee_withheld_amount: "0", reference: "", notes: "" });
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Failed to post disbursement"); }
    finally { setSaving(false); }
  }

  async function submitRepayment(event: FormEvent) {
    event.preventDefault();
    if (!selectedLoan) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/accounting/loans/${selectedLoan.id}/repay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...repay,
          principal_amount: Number(repay.principal_amount || 0),
          interest_amount: Number(repay.interest_amount || 0),
          fee_amount: Number(repay.fee_amount || 0),
          reference: repay.reference || null,
          notes: repay.notes || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail ?? "Failed to post repayment");
      setRepay({ account_id: "", payment_date: today(), principal_amount: "", interest_amount: "0", fee_amount: "0", fee_type: "loan_fee", reference: "", notes: "" });
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Failed to post repayment"); }
    finally { setSaving(false); }
  }

  return <main className="p-4 sm:p-6 lg:p-8">
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">Accounting</p>
        <h1 className="mt-1 text-2xl font-semibold">Loan Accounting</h1>
        <p className="mt-2 max-w-3xl text-sm text-neutral-500">Approval does not change cash or loan liability. Liability begins only when funds are disbursed. Principal, interest and fees are posted separately on repayment.</p>
      </div>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <div className="grid gap-4 lg:grid-cols-4">
        <section className="rounded-2xl border bg-white p-5 lg:col-span-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div><h2 className="font-semibold">Loans</h2><p className="mt-1 text-sm text-neutral-500">Approved, disbursed and outstanding values stay separate.</p></div>
            <div className="flex gap-2">{(["approve", "disburse", "repay"] as const).map((item) => <button key={item} type="button" onClick={() => setMode(item)} className={`rounded-lg px-3 py-2 text-xs font-medium capitalize ${mode === item ? "bg-neutral-950 text-white" : "border bg-white text-neutral-600"}`}>{item}</button>)}</div>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr className="border-b text-left text-xs uppercase tracking-wide text-neutral-400"><th className="px-2 py-3">Lender</th><th className="px-2 py-3">Status</th><th className="px-2 py-3">Approved</th><th className="px-2 py-3">Disbursed</th><th className="px-2 py-3">Undisbursed</th><th className="px-2 py-3">Outstanding</th></tr></thead>
              <tbody>{loans.map((loan) => <tr key={loan.id} onClick={() => setSelectedLoanId(loan.id)} className={`cursor-pointer border-b last:border-0 ${selectedLoanId === loan.id ? "bg-neutral-50" : "hover:bg-neutral-50"}`}><td className="px-2 py-3"><p className="font-medium">{loan.lender_name}</p><p className="text-xs text-neutral-400">{loan.currency} · {loan.reference || "No reference"}</p></td><td className="px-2 py-3 capitalize">{loan.status}</td><td className="px-2 py-3 tabular-nums">{amount(loan.approved_amount)}</td><td className="px-2 py-3 tabular-nums">{amount(loan.disbursed_amount)}</td><td className="px-2 py-3 tabular-nums">{amount(loan.undisbursed_amount)}</td><td className="px-2 py-3 font-medium tabular-nums">{amount(loan.outstanding_principal)}</td></tr>)}</tbody>
            </table>
            {!loading && loans.length === 0 ? <p className="py-10 text-center text-sm text-neutral-400">No loans yet. Approve a loan to begin.</p> : null}
          </div>
        </section>

        <aside className="rounded-2xl border bg-white p-5">
          <h2 className="font-semibold">Posting rule</h2>
          <div className="mt-4 space-y-3 text-sm text-neutral-600">
            <div><p className="font-medium text-neutral-900">Approval</p><p>No cash. No liability.</p></div>
            <div><p className="font-medium text-neutral-900">Disbursement</p><p>Dr Bank / Cash<br/>Cr Loans Payable</p></div>
            <div><p className="font-medium text-neutral-900">Repayment</p><p>Dr Loans Payable<br/>Dr Interest / Fee Expense<br/>Cr Bank / Cash</p></div>
          </div>
        </aside>
      </div>

      {mode === "approve" ? <section className="rounded-2xl border bg-white p-5"><h2 className="font-semibold">Approve / Record Loan Agreement</h2><form onSubmit={submitApprove} className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Field label="Lender name"><input required value={approve.lender_name} onChange={(e) => setApprove((v) => ({ ...v, lender_name: e.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
        <Field label="Lender type"><select value={approve.lender_type} onChange={(e) => setApprove((v) => ({ ...v, lender_type: e.target.value }))} className="w-full rounded-xl border bg-white px-3 py-2.5"><option value="bank">Bank</option><option value="person">Person</option><option value="company">Company</option><option value="investor">Investor</option><option value="other">Other</option></select></Field>
        <Field label="Currency"><input required maxLength={3} value={approve.currency} onChange={(e) => setApprove((v) => ({ ...v, currency: e.target.value.toUpperCase() }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
        <Field label="Approved amount"><input required type="number" min="0.01" step="0.01" value={approve.approved_amount} onChange={(e) => setApprove((v) => ({ ...v, approved_amount: e.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
        <Field label="Annual interest %"><input type="number" min="0" step="0.0001" value={approve.annual_interest_rate} onChange={(e) => setApprove((v) => ({ ...v, annual_interest_rate: e.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
        <Field label="Approval date"><input required type="date" value={approve.approval_date} onChange={(e) => setApprove((v) => ({ ...v, approval_date: e.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
        <Field label="Maturity date"><input type="date" value={approve.maturity_date} onChange={(e) => setApprove((v) => ({ ...v, maturity_date: e.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
        <Field label="Reference"><input value={approve.reference} onChange={(e) => setApprove((v) => ({ ...v, reference: e.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
        <div className="md:col-span-2 lg:col-span-3"><button disabled={saving} className="rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? "Saving…" : "Approve loan"}</button></div>
      </form></section> : null}

      {mode === "disburse" ? <section className="rounded-2xl border bg-white p-5"><h2 className="font-semibold">Post Loan Disbursement</h2>{!selectedLoan ? <p className="mt-3 text-sm text-neutral-500">Select a loan first.</p> : <form onSubmit={submitDisbursement} className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Field label="Loan"><select value={selectedLoanId} onChange={(e) => setSelectedLoanId(e.target.value)} className="w-full rounded-xl border bg-white px-3 py-2.5">{loans.map((loan) => <option key={loan.id} value={loan.id}>{loan.lender_name} — {loan.currency} {amount(loan.undisbursed_amount)} remaining</option>)}</select></Field>
        <Field label="Receive into"><select required value={disburse.account_id} onChange={(e) => setDisburse((v) => ({ ...v, account_id: e.target.value }))} className="w-full rounded-xl border bg-white px-3 py-2.5"><option value="">Select account</option>{compatibleAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} — {account.currency} {amount(account.current_balance)}</option>)}</select></Field>
        <Field label="Disbursement date"><input required type="date" value={disburse.disbursement_date} onChange={(e) => setDisburse((v) => ({ ...v, disbursement_date: e.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
        <Field label="Principal disbursed"><input required type="number" min="0.01" step="0.01" value={disburse.principal_amount} onChange={(e) => setDisburse((v) => ({ ...v, principal_amount: e.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
        <Field label="Fee withheld"><input type="number" min="0" step="0.01" value={disburse.fee_withheld_amount} onChange={(e) => setDisburse((v) => ({ ...v, fee_withheld_amount: e.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
        <Field label="Reference"><input value={disburse.reference} onChange={(e) => setDisburse((v) => ({ ...v, reference: e.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
        <div className="md:col-span-2 lg:col-span-3"><p className="mb-3 text-sm text-neutral-500">Net cash received: {amount(Number(disburse.principal_amount || 0) - Number(disburse.fee_withheld_amount || 0))} {selectedLoan.currency}</p><button disabled={saving} className="rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? "Posting…" : "Post disbursement"}</button></div>
      </form>}</section> : null}

      {mode === "repay" ? <section className="rounded-2xl border bg-white p-5"><h2 className="font-semibold">Post Loan Repayment</h2>{!selectedLoan ? <p className="mt-3 text-sm text-neutral-500">Select a loan first.</p> : <form onSubmit={submitRepayment} className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Field label="Loan"><select value={selectedLoanId} onChange={(e) => setSelectedLoanId(e.target.value)} className="w-full rounded-xl border bg-white px-3 py-2.5">{loans.map((loan) => <option key={loan.id} value={loan.id}>{loan.lender_name} — outstanding {loan.currency} {amount(loan.outstanding_principal)}</option>)}</select></Field>
        <Field label="Pay from"><select required value={repay.account_id} onChange={(e) => setRepay((v) => ({ ...v, account_id: e.target.value }))} className="w-full rounded-xl border bg-white px-3 py-2.5"><option value="">Select account</option>{compatibleAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} — {account.currency} {amount(account.current_balance)}</option>)}</select></Field>
        <Field label="Payment date"><input required type="date" value={repay.payment_date} onChange={(e) => setRepay((v) => ({ ...v, payment_date: e.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
        <Field label="Principal"><input type="number" min="0" step="0.01" value={repay.principal_amount} onChange={(e) => setRepay((v) => ({ ...v, principal_amount: e.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
        <Field label="Interest"><input type="number" min="0" step="0.01" value={repay.interest_amount} onChange={(e) => setRepay((v) => ({ ...v, interest_amount: e.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
        <Field label="Fee"><input type="number" min="0" step="0.01" value={repay.fee_amount} onChange={(e) => setRepay((v) => ({ ...v, fee_amount: e.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
        <div className="md:col-span-2 lg:col-span-3"><p className="mb-3 text-sm text-neutral-500">Cash payment: {amount(Number(repay.principal_amount || 0) + Number(repay.interest_amount || 0) + Number(repay.fee_amount || 0))} {selectedLoan.currency}</p><button disabled={saving} className="rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? "Posting…" : "Post repayment"}</button></div>
      </form>}</section> : null}
    </div>
  </main>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="text-sm"><span className="mb-1.5 block text-neutral-500">{label}</span>{children}</label>;
}
