"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleDollarSign,
  HandCoins,
  Landmark,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  WalletCards,
  X,
} from "lucide-react";

import { AccountingNav } from "@/components/accounting-nav";
import { CurrencySelect } from "@/components/currency-select";
import { FinancialConfirmationDialog } from "@/components/financial-confirmation-dialog";
import { MoneyInput } from "@/components/money-input";
import { SearchableSelect } from "@/components/searchable-select";
import { AppPage, PageHeader, SectionHeader, Surface } from "@/components/ui/app-page";
import { confirmDiscardChanges, useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { getApiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/cn";

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
  notes?: string | null;
};

type FinancialAccount = {
  id: string;
  name: string;
  account_type: string;
  currency: string;
  current_balance: string;
};

type ScheduleItem = {
  id: string;
  installment_number: number;
  due_date: string;
  principal_due: string;
  interest_due: string;
  fee_due: string;
  principal_paid: string;
  interest_paid: string;
  fee_paid: string;
  status: string;
};

type Disbursement = {
  id: string;
  date: string;
  account_name: string;
  principal_amount: string;
  fee_withheld_amount: string;
  net_received_amount: string;
  reference: string | null;
  notes: string | null;
  status: string;
};

type Repayment = {
  id: string;
  date: string;
  account_name: string;
  principal_amount: string;
  interest_amount: string;
  reference: string | null;
  notes: string | null;
  status: string;
};

type LoanFee = {
  id: string;
  date: string;
  fee_type: string;
  amount: string;
  payment_status: string;
  reference: string | null;
  notes: string | null;
};

type LoanHistory = {
  disbursements: Disbursement[];
  repayments: Repayment[];
  fees: LoanFee[];
};

type Mode = "new" | "receive" | "repay" | null;

type LifecycleState = "complete" | "current" | "upcoming";

function amount(value: string | number, currency?: string) {
  return `${currency ? `${currency} ` : ""}${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function overdue(date: string, status: string) {
  return Boolean(date && status !== "paid" && date < today());
}

function pretty(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const blankApprove = () => ({
  lender_name: "",
  lender_type: "bank",
  currency: "BDT",
  approved_amount: "",
  annual_interest_rate: "0",
  approval_date: today(),
  maturity_date: "",
  reference: "",
  notes: "",
});

const blankReceive = () => ({
  account_id: "",
  disbursement_date: today(),
  principal_amount: "",
  fee_withheld_amount: "0",
  reference: "",
  notes: "",
});

const blankRepay = () => ({
  account_id: "",
  payment_date: today(),
  principal_amount: "",
  interest_amount: "0",
  fee_amount: "0",
  fee_type: "loan_fee",
  reference: "",
  notes: "",
});

export default function LoanAccountingPage() {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [history, setHistory] = useState<LoanHistory>({ disbursements: [], repayments: [], fees: [] });
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedLoanId, setSelectedLoanId] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [mode, setMode] = useState<Mode>(null);
  const [confirmMode, setConfirmMode] = useState<Mode>(null);
  const [approve, setApprove] = useState(blankApprove());
  const [receive, setReceive] = useState(blankReceive());
  const [repay, setRepay] = useState(blankRepay());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
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
      setSelectedLoanId((current) =>
        current && loanPayload.some((item: Loan) => item.id === current) ? current : loanPayload[0]?.id || "",
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load loans");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadDetail = useCallback(async (loanId: string) => {
    if (!loanId) {
      setSchedule([]);
      setHistory({ disbursements: [], repayments: [], fees: [] });
      return;
    }
    setDetailLoading(true);
    try {
      const [scheduleResponse, historyResponse] = await Promise.all([
        fetch(`/api/accounting/loans/${loanId}/schedule`, { cache: "no-store" }),
        fetch(`/api/accounting/loans/${loanId}/history`, { cache: "no-store" }),
      ]);
      const [schedulePayload, historyPayload] = await Promise.all([scheduleResponse.json(), historyResponse.json()]);
      if (!scheduleResponse.ok) throw new Error(getApiErrorMessage(schedulePayload, "Could not load repayment schedule"));
      if (!historyResponse.ok) throw new Error(getApiErrorMessage(historyPayload, "Could not load loan history"));
      setSchedule(schedulePayload);
      setHistory(historyPayload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load loan details");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDetail(selectedLoanId);
  }, [selectedLoanId, loadDetail]);

  useEffect(() => {
    if (!mode) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mode]);

  const selected = useMemo(() => loans.find((loan) => loan.id === selectedLoanId) ?? null, [loans, selectedLoanId]);
  const filteredLoans = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return loans.filter(
      (loan) =>
        (!normalized || `${loan.lender_name} ${loan.reference ?? ""} ${loan.currency} ${loan.status}`.toLowerCase().includes(normalized)) &&
        (statusFilter === "all" || loan.status === statusFilter),
    );
  }, [loans, query, statusFilter]);
  const compatibleAccounts = useMemo(
    () => (selected ? accounts.filter((account) => account.currency === selected.currency) : accounts),
    [accounts, selected],
  );
  const accountOptions = useMemo(
    () =>
      compatibleAccounts.map((account) => ({
        value: account.id,
        label: `${account.name} · ${amount(account.current_balance, account.currency)}`,
        keywords: `${account.name} ${account.currency} ${account.account_type}`,
      })),
    [compatibleAccounts],
  );
  const nextInstallment = useMemo(() => schedule.find((item) => item.status !== "paid") ?? null, [schedule]);
  const totalInterestPaid = useMemo(
    () =>
      history.repayments.reduce(
        (sum, item) => (item.status === "posted" ? sum + Number(item.interest_amount || 0) : sum),
        0,
      ),
    [history.repayments],
  );
  const totalFeesRecorded = useMemo(
    () =>
      history.fees.reduce((sum, item) => {
        const feeAmount = Number(item.amount || 0);
        if (item.payment_status === "reversed" && feeAmount >= 0) return sum;
        return sum + feeAmount;
      }, 0),
    [history.fees],
  );
  const activeLoanCount = useMemo(
    () => loans.filter((loan) => loan.status === "active" || loan.status === "approved").length,
    [loans],
  );
  const principalByCurrency = useMemo(() => {
    const totals = new Map<string, number>();
    for (const loan of loans) {
      const principal = Number(loan.outstanding_principal || 0);
      if (principal <= 0) continue;
      totals.set(loan.currency, (totals.get(loan.currency) ?? 0) + principal);
    }
    return Array.from(totals.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [loans]);

  const receiveAccount = accounts.find((account) => account.id === receive.account_id) ?? null;
  const repayAccount = accounts.find((account) => account.id === repay.account_id) ?? null;
  const approveDirty =
    mode === "new" &&
    Boolean(
      approve.lender_name ||
        approve.approved_amount ||
        approve.reference ||
        approve.notes ||
        approve.maturity_date ||
        Number(approve.annual_interest_rate || 0) > 0,
    );
  const receiveDirty =
    mode === "receive" &&
    Boolean(
      receive.account_id ||
        receive.principal_amount ||
        receive.reference ||
        receive.notes ||
        Number(receive.fee_withheld_amount || 0) > 0,
    );
  const repayDirty =
    mode === "repay" &&
    Boolean(
      repay.account_id ||
        repay.principal_amount ||
        Number(repay.interest_amount || 0) > 0 ||
        Number(repay.fee_amount || 0) > 0 ||
        repay.reference ||
        repay.notes,
    );
  const dirty = approveDirty || receiveDirty || repayDirty;
  useUnsavedChanges(dirty && !saving);

  const receivePrincipal = Number(receive.principal_amount || 0);
  const receiveFee = Number(receive.fee_withheld_amount || 0);
  const receiveNet = Math.max(0, receivePrincipal - receiveFee);
  const repayPrincipal = Number(repay.principal_amount || 0);
  const repayInterest = Number(repay.interest_amount || 0);
  const repayFee = Number(repay.fee_amount || 0);
  const repayTotal = repayPrincipal + repayInterest + repayFee;

  function closeMode() {
    if (!confirmDiscardChanges(dirty, "Discard this unposted loan form?")) return;
    setMode(null);
    setConfirmMode(null);
  }

  function chooseLoan(id: string) {
    if (!confirmDiscardChanges(dirty, "Switch loans and discard this unposted form?")) return;
    setSelectedLoanId(id);
    setMode(null);
    setConfirmMode(null);
  }

  function startNewLoan() {
    if (!confirmDiscardChanges(dirty)) return;
    setApprove(blankApprove());
    setMode("new");
    setConfirmMode(null);
    setMessage(null);
  }

  function startReceive() {
    if (!selected || !confirmDiscardChanges(dirty)) return;
    setReceive(blankReceive());
    setMode("receive");
    setConfirmMode(null);
    setMessage(null);
  }

  function startRepay() {
    if (!selected || !confirmDiscardChanges(dirty)) return;
    setRepay(blankRepay());
    setMode("repay");
    setConfirmMode(null);
    setMessage(null);
  }

  function reviewApprove(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setConfirmMode("new");
  }

  function reviewReceive(event: FormEvent) {
    event.preventDefault();
    if (selected) setConfirmMode("receive");
  }

  function reviewRepay(event: FormEvent) {
    event.preventDefault();
    if (selected) setConfirmMode("repay");
  }

  async function postApprove() {
    setSaving(true);
    setError(null);
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
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not record loan agreement"));
      setApprove(blankApprove());
      setConfirmMode(null);
      await load();
      setSelectedLoanId(payload.id);
      setMode(null);
      setMessage("Loan agreement recorded. No cash or loan principal was posted until a disbursement is received.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not record loan agreement");
      setConfirmMode(null);
    } finally {
      setSaving(false);
    }
  }

  async function postReceive() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/accounting/loans/${selected.id}/disburse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...receive,
          principal_amount: receivePrincipal,
          fee_withheld_amount: receiveFee,
          reference: receive.reference || null,
          notes: receive.notes || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not receive loan money"));
      setReceive(blankReceive());
      setConfirmMode(null);
      await load();
      await loadDetail(selected.id);
      setMode(null);
      setMessage("Loan money received. Principal liability and the selected financial account were updated together.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not receive loan money");
      setConfirmMode(null);
    } finally {
      setSaving(false);
    }
  }

  async function postRepay() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/accounting/loans/${selected.id}/repay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...repay,
          principal_amount: repayPrincipal,
          interest_amount: repayInterest,
          fee_amount: repayFee,
          reference: repay.reference || null,
          notes: repay.notes || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not record repayment"));
      setRepay(blankRepay());
      setConfirmMode(null);
      await load();
      await loadDetail(selected.id);
      setMode(null);
      setMessage("Repayment posted. Principal reduced the liability while interest and fees stayed separately classified.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not record repayment");
      setConfirmMode(null);
    } finally {
      setSaving(false);
    }
  }

  const approvalDetails = [
    { label: "Lender", value: approve.lender_name || "—" },
    { label: "Approved amount", value: amount(approve.approved_amount || 0, approve.currency), emphasis: true },
    { label: "Annual interest", value: `${approve.annual_interest_rate || 0}%` },
    { label: "Approval date", value: approve.approval_date },
    { label: "Maturity", value: approve.maturity_date || "Not set" },
    ...(approve.reference ? [{ label: "Reference", value: approve.reference }] : []),
  ];

  const receiveDetails = selected
    ? [
        { label: "Loan", value: selected.lender_name },
        { label: "Approved but not received", value: amount(selected.undisbursed_amount, selected.currency) },
        { label: "Principal disbursed", value: amount(receivePrincipal, selected.currency), emphasis: true },
        { label: "Fee withheld", value: amount(receiveFee, selected.currency) },
        { label: "Net cash received", value: amount(receiveNet, selected.currency), emphasis: true },
        { label: "Receive into", value: receiveAccount?.name || "—" },
        { label: "Date", value: receive.disbursement_date },
      ]
    : [];

  const repayDetails = selected
    ? [
        { label: "Loan", value: selected.lender_name },
        { label: "Principal currently due", value: amount(selected.outstanding_principal, selected.currency) },
        { label: "Principal part", value: amount(repayPrincipal, selected.currency) },
        { label: "Interest part", value: amount(repayInterest, selected.currency) },
        { label: "Fee part", value: amount(repayFee, selected.currency) },
        { label: "Total payment", value: amount(repayTotal, selected.currency), emphasis: true },
        { label: "Pay from", value: repayAccount?.name || "—" },
        { label: "Date", value: repay.payment_date },
      ]
    : [];

  const lifecycle = selected ? getLifecycle(selected) : [];

  return (
    <AppPage width="wide">
      <div className="space-y-6">
        <PageHeader
          eyebrow="Finance & Accounts"
          title="Business loans"
          description="Keep the agreement, lender funding, principal liability, repayments, interest and fees in one auditable loan lifecycle. Loan principal is never treated as business revenue."
          meta={
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2.5 py-1">
                <ShieldCheck className="size-3.5 text-emerald-600" /> Principal stays separate from income
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2.5 py-1">
                <CircleDollarSign className="size-3.5" /> Interest and fees stay separately classified
              </span>
            </>
          }
          actions={
            <button
              type="button"
              onClick={startNewLoan}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-800"
            >
              <Plus className="size-4" /> New loan agreement
            </button>
          }
        />

        <AccountingNav />

        {error ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-2 self-start rounded-xl border border-red-200 bg-white px-3 py-2 font-medium text-red-700 sm:self-auto"
            >
              <RefreshCw className="size-4" /> Retry
            </button>
          </div>
        ) : null}

        {message ? (
          <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            <span>{message}</span>
          </div>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-3">
          <Surface className="p-4 sm:p-5">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-neutral-400">Loan records</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-neutral-950">{loading ? "—" : loans.length}</p>
            <p className="mt-1 text-xs text-neutral-500">Approved, active and completed agreements</p>
          </Surface>
          <Surface className="p-4 sm:p-5">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-neutral-400">Open lifecycle</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-neutral-950">{loading ? "—" : activeLoanCount}</p>
            <p className="mt-1 text-xs text-neutral-500">Approved or active loan records</p>
          </Surface>
          <Surface className="p-4 sm:p-5">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-neutral-400">Principal due</p>
            {loading ? (
              <p className="mt-2 text-2xl font-semibold text-neutral-950">—</p>
            ) : principalByCurrency.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {principalByCurrency.map(([currency, value]) => (
                  <span key={currency} className="rounded-lg bg-neutral-100 px-2.5 py-1.5 text-sm font-semibold tabular-nums text-neutral-800">
                    {amount(value, currency)}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-2xl font-semibold text-neutral-950">0.00</p>
            )}
            <p className="mt-2 text-xs text-neutral-500">Currencies remain separate</p>
          </Surface>
        </section>

        <section className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
          <Surface className="h-fit p-3 lg:sticky lg:top-6">
            <div className="px-2 py-2">
              <SectionHeader title="Your loans" description="Search and select a loan to inspect its financial lifecycle." />
            </div>
            <div className="mt-3 space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-3 size-4 text-neutral-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search lender or reference…"
                  className="w-full rounded-xl border border-neutral-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none"
              >
                <option value="all">All statuses</option>
                <option value="approved">Approved</option>
                <option value="active">Active</option>
                <option value="paid">Paid</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            {loading ? (
              <div className="mt-3 space-y-2">
                {[0, 1, 2].map((item) => (
                  <div key={item} className="h-28 animate-pulse rounded-xl bg-neutral-100" />
                ))}
              </div>
            ) : (
              <div className="mt-3 max-h-[660px] space-y-2 overflow-y-auto pr-0.5">
                {filteredLoans.map((loan) => {
                  const active = selectedLoanId === loan.id;
                  return (
                    <button
                      key={loan.id}
                      type="button"
                      onClick={() => chooseLoan(loan.id)}
                      className={cn(
                        "w-full rounded-xl border p-4 text-left transition",
                        active
                          ? "border-neutral-950 bg-neutral-950 text-white shadow-sm"
                          : "border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{loan.lender_name}</p>
                          <p className={cn("mt-1 truncate text-xs", active ? "text-neutral-300" : "text-neutral-400")}>
                            {loan.reference || `${loan.currency} loan`}
                          </p>
                        </div>
                        <StatusBadge status={loan.status} inverted={active} />
                      </div>
                      <p className="mt-4 text-lg font-semibold tabular-nums">{amount(loan.outstanding_principal, loan.currency)}</p>
                      <p className={cn("mt-1 text-xs", active ? "text-neutral-300" : "text-neutral-500")}>principal due</p>
                    </button>
                  );
                })}
                {!filteredLoans.length ? (
                  <div className="rounded-xl border border-dashed border-neutral-200 p-6 text-center">
                    <HandCoins className="mx-auto size-7 text-neutral-300" />
                    <p className="mt-3 text-sm font-medium">No matching loans</p>
                    <p className="mt-1 text-xs text-neutral-400">Try another search or status.</p>
                  </div>
                ) : null}
              </div>
            )}
          </Surface>

          <div className="min-w-0 space-y-4">
            {selected ? (
              <>
                <Surface className="overflow-hidden">
                  <div className="p-5 sm:p-6">
                    <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium uppercase tracking-[0.12em] text-neutral-400">Loan from</span>
                          <StatusBadge status={selected.status} />
                        </div>
                        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950">{selected.lender_name}</h2>
                        <p className="mt-1 text-sm text-neutral-500">
                          {selected.currency} · {selected.annual_interest_rate}% annual interest
                          {selected.maturity_date ? ` · Maturity ${selected.maturity_date}` : ""}
                        </p>
                        {selected.notes ? <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-500">{selected.notes}</p> : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={Number(selected.undisbursed_amount) <= 0 || selected.status === "cancelled"}
                          onClick={startReceive}
                          className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-neutral-800 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <ArrowDownToLine className="size-4" /> Receive money
                        </button>
                        <button
                          type="button"
                          disabled={Number(selected.outstanding_principal) <= 0 || selected.status === "cancelled"}
                          onClick={startRepay}
                          className="inline-flex items-center gap-2 rounded-xl bg-neutral-950 px-3.5 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <WalletCards className="size-4" /> Make repayment
                        </button>
                      </div>
                    </div>

                    <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <Stat label="Loan agreement" value={amount(selected.approved_amount, selected.currency)} help="Maximum approved" />
                      <Stat label="Money received" value={amount(selected.disbursed_amount, selected.currency)} help="Principal actually disbursed" />
                      <Stat label="Principal due" value={amount(selected.outstanding_principal, selected.currency)} help="Liability still outstanding" emphasis />
                      <Stat
                        label="Interest + fees recorded"
                        value={amount(totalInterestPaid + totalFeesRecorded, selected.currency)}
                        help="Never included in principal"
                      />
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <Stat
                        label="Next installment"
                        value={
                          nextInstallment
                            ? amount(
                                Number(nextInstallment.principal_due) + Number(nextInstallment.interest_due) + Number(nextInstallment.fee_due),
                                selected.currency,
                              )
                            : "No schedule"
                        }
                        help={
                          nextInstallment
                            ? `Due ${nextInstallment.due_date}${overdue(nextInstallment.due_date, nextInstallment.status) ? " · OVERDUE" : ""}`
                            : "No repayment schedule recorded"
                        }
                        danger={Boolean(nextInstallment && overdue(nextInstallment.due_date, nextInstallment.status))}
                      />
                      <Stat label="Agreement reference" value={selected.reference || "—"} help={`Approved ${selected.approval_date}`} />
                    </div>
                  </div>

                  <div className="border-t border-neutral-100 bg-neutral-50/70 px-5 py-5 sm:px-6">
                    <p className="text-xs font-medium uppercase tracking-[0.12em] text-neutral-400">Loan lifecycle</p>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      {lifecycle.map((step, index) => (
                        <LifecycleStep key={step.label} index={index + 1} label={step.label} help={step.help} state={step.state} />
                      ))}
                    </div>
                  </div>
                </Surface>

                <Surface className="overflow-hidden">
                  <div className="p-5 sm:p-6">
                    <SectionHeader
                      title="Repayment schedule"
                      description="See principal, interest and fee obligations separately for every installment."
                      action={<CalendarDays className="size-5 text-neutral-300" />}
                    />

                    {detailLoading ? (
                      <div className="mt-5 space-y-2">
                        {[0, 1, 2].map((item) => (
                          <div key={item} className="h-16 animate-pulse rounded-xl bg-neutral-100" />
                        ))}
                      </div>
                    ) : schedule.length ? (
                      <>
                        <div className="mt-5 space-y-3 md:hidden">
                          {schedule.map((item) => (
                            <ScheduleCard key={item.id} item={item} currency={selected.currency} />
                          ))}
                        </div>
                        <div className="mt-5 hidden overflow-x-auto md:block">
                          <table className="min-w-full text-sm">
                            <thead>
                              <tr className="border-b border-neutral-100 text-left text-xs uppercase tracking-wide text-neutral-400">
                                <th className="py-3 pr-4">#</th>
                                <th className="py-3 pr-4">Due</th>
                                <th className="py-3 pr-4">Principal</th>
                                <th className="py-3 pr-4">Interest</th>
                                <th className="py-3 pr-4">Fees</th>
                                <th className="py-3">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {schedule.map((item) => {
                                const isOverdue = overdue(item.due_date, item.status);
                                return (
                                  <tr key={item.id} className="border-b border-neutral-100 last:border-0">
                                    <td className="py-3.5 pr-4 font-medium">{item.installment_number}</td>
                                    <td className={cn("py-3.5 pr-4", isOverdue && "font-medium text-red-600")}>{item.due_date}</td>
                                    <td className="py-3.5 pr-4 tabular-nums">
                                      {amount(item.principal_due, selected.currency)}
                                      <p className="mt-0.5 text-xs text-neutral-400">Paid {amount(item.principal_paid, selected.currency)}</p>
                                    </td>
                                    <td className="py-3.5 pr-4 tabular-nums">
                                      {amount(item.interest_due, selected.currency)}
                                      <p className="mt-0.5 text-xs text-neutral-400">Paid {amount(item.interest_paid, selected.currency)}</p>
                                    </td>
                                    <td className="py-3.5 pr-4 tabular-nums">
                                      {amount(item.fee_due, selected.currency)}
                                      <p className="mt-0.5 text-xs text-neutral-400">Paid {amount(item.fee_paid, selected.currency)}</p>
                                    </td>
                                    <td className="py-3.5">
                                      <StatusBadge status={isOverdue ? "overdue" : item.status} />
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </>
                    ) : (
                      <div className="mt-5 rounded-xl border border-dashed border-neutral-200 p-7 text-center text-sm text-neutral-400">
                        No repayment schedule has been recorded.
                      </div>
                    )}
                  </div>
                </Surface>

                <Surface className="p-5 sm:p-6">
                  <SectionHeader
                    title="Loan history"
                    description="Every lender disbursement, repayment and loan fee remains traceable as posted financial history."
                  />
                  {detailLoading ? (
                    <div className="mt-5 space-y-3">
                      {[0, 1, 2].map((item) => (
                        <div key={item} className="h-20 animate-pulse rounded-xl bg-neutral-100" />
                      ))}
                    </div>
                  ) : (
                    <div className="mt-5 space-y-3">
                      {history.disbursements.map((item) => (
                        <HistoryRow
                          key={`d-${item.id}`}
                          kind="receive"
                          title={
                            item.status === "reversal"
                              ? "Disbursement reversal"
                              : item.status === "reversed"
                                ? "Money received · Reversed"
                                : "Money received"
                          }
                          date={item.date}
                          meta={`${item.account_name} · Principal ${amount(item.principal_amount, selected.currency)} · Net ${amount(item.net_received_amount, selected.currency)}${Number(item.fee_withheld_amount) > 0 ? ` · Fee ${amount(item.fee_withheld_amount, selected.currency)}` : ""}`}
                          reference={item.reference}
                          notes={item.notes}
                        />
                      ))}
                      {history.repayments.map((item) => (
                        <HistoryRow
                          key={`r-${item.id}`}
                          kind="repay"
                          title={item.status === "reversed" ? "Repayment · Reversed" : "Repayment"}
                          date={item.date}
                          meta={`${item.account_name} · Principal ${amount(item.principal_amount, selected.currency)} · Interest ${amount(item.interest_amount, selected.currency)}`}
                          reference={item.reference}
                          notes={item.notes}
                        />
                      ))}
                      {history.fees.map((item) => (
                        <HistoryRow
                          key={`f-${item.id}`}
                          kind="fee"
                          title={`Fee · ${pretty(item.fee_type)}`}
                          date={item.date}
                          meta={`${amount(item.amount, selected.currency)} · ${pretty(item.payment_status)}`}
                          reference={item.reference}
                          notes={item.notes}
                        />
                      ))}
                      {!history.disbursements.length && !history.repayments.length && !history.fees.length ? (
                        <div className="rounded-xl border border-dashed border-neutral-200 p-7 text-center text-sm text-neutral-400">
                          No money movement recorded for this loan yet.
                        </div>
                      ) : null}
                    </div>
                  )}

                  <div className="mt-5 flex items-start gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-500">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-neutral-700" />
                    <div>
                      <p className="font-medium text-neutral-900">Posted loan history</p>
                      <p className="mt-1 leading-5">
                        Disbursements and repayments affect ledgers. Incorrect postings should use controlled reversal/correction instead of silent edits.
                      </p>
                    </div>
                  </div>
                </Surface>
              </>
            ) : (
              <Surface className="border-dashed p-12 text-center">
                <HandCoins className="mx-auto size-9 text-neutral-300" />
                <p className="mt-3 font-medium">{loading ? "Loading loans…" : "Select or create a loan"}</p>
                {!loading && !loans.length ? (
                  <button type="button" onClick={startNewLoan} className="mt-4 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white">
                    Create first loan agreement
                  </button>
                ) : null}
              </Surface>
            )}
          </div>
        </section>
      </div>

      {mode === "new" ? (
        <LoanFormDialog ariaLabel="New loan agreement" onClose={closeMode} closeDisabled={saving}>
          <Surface className="overflow-hidden">
            <div className="border-b border-neutral-100 p-5 pr-14 sm:p-6 sm:pr-16">
              <SectionHeader
                title="Record a new loan agreement"
                description="This captures approval terms only. It does not increase cash or create outstanding principal until the lender actually disburses money."
              />
            </div>
            <form onSubmit={reviewApprove} className="grid xl:grid-cols-[minmax(0,1fr)_330px]">
              <div className="grid gap-4 p-5 sm:p-6 md:grid-cols-2 lg:grid-cols-3">
                <Field label="Lender name">
                  <input
                    required
                    autoFocus
                    value={approve.lender_name}
                    onChange={(event) => setApprove((current) => ({ ...current, lender_name: event.target.value }))}
                    className={inputClass}
                    placeholder="Bank, company or person"
                  />
                </Field>
                <Field label="Lender type">
                  <select
                    value={approve.lender_type}
                    onChange={(event) => setApprove((current) => ({ ...current, lender_type: event.target.value }))}
                    className={inputClass}
                  >
                    <option value="bank">Bank</option>
                    <option value="person">Person</option>
                    <option value="company">Company</option>
                    <option value="investor">Investor</option>
                    <option value="other">Other</option>
                  </select>
                </Field>
                <CurrencySelect
                  required
                  clearable={false}
                  value={approve.currency}
                  onValueChange={(value) => setApprove((current) => ({ ...current, currency: value }))}
                />
                <MoneyInput
                  label="Approved amount"
                  currency={approve.currency}
                  required
                  min={0.01}
                  value={approve.approved_amount}
                  onValueChange={(value) => setApprove((current) => ({ ...current, approved_amount: value }))}
                />
                <Field label="Annual interest %">
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={approve.annual_interest_rate}
                    onChange={(event) => setApprove((current) => ({ ...current, annual_interest_rate: event.target.value }))}
                    className={inputClass}
                  />
                </Field>
                <Field label="Agreement / approval date">
                  <input
                    required
                    type="date"
                    value={approve.approval_date}
                    onChange={(event) => setApprove((current) => ({ ...current, approval_date: event.target.value }))}
                    className={inputClass}
                  />
                </Field>
                <Field label="Maturity date">
                  <input
                    type="date"
                    value={approve.maturity_date}
                    onChange={(event) => setApprove((current) => ({ ...current, maturity_date: event.target.value }))}
                    className={inputClass}
                  />
                </Field>
                <Field label="Reference">
                  <input
                    value={approve.reference}
                    onChange={(event) => setApprove((current) => ({ ...current, reference: event.target.value }))}
                    className={inputClass}
                    placeholder="Agreement / facility reference"
                  />
                </Field>
                <div className="md:col-span-2 lg:col-span-3">
                  <Field label="Notes">
                    <textarea
                      rows={3}
                      value={approve.notes}
                      onChange={(event) => setApprove((current) => ({ ...current, notes: event.target.value }))}
                      className={textareaClass}
                      placeholder="Optional terms or internal context"
                    />
                  </Field>
                </div>
              </div>
              <div className="border-t border-neutral-100 bg-neutral-50/70 p-5 sm:p-6 xl:border-l xl:border-t-0">
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-neutral-400">Agreement preview</p>
                <div className="mt-4 space-y-3">
                  <PreviewRow label="Approved facility" value={amount(approve.approved_amount || 0, approve.currency)} />
                  <PreviewRow label="Annual interest" value={`${approve.annual_interest_rate || 0}%`} />
                  <PreviewRow label="Cash impact now" value="None" />
                  <PreviewRow label="Principal liability now" value="None" />
                </div>
                <div className="mt-5 flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-800">
                  <Landmark className="mt-0.5 size-4 shrink-0" /> Approval and disbursement are separate accounting events.
                </div>
                <div className="mt-5 flex gap-2">
                  <button type="button" onClick={closeMode} className="flex-1 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold">
                    Cancel
                  </button>
                  <button
                    disabled={saving || !approve.lender_name || Number(approve.approved_amount || 0) <= 0}
                    className="flex-1 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    Review agreement
                  </button>
                </div>
              </div>
            </form>
          </Surface>
        </LoanFormDialog>
      ) : null}

      {mode && mode !== "new" && selected ? (
        <LoanFormDialog
          ariaLabel={mode === "receive" ? "Receive loan money" : "Record loan repayment"}
          onClose={closeMode}
          closeDisabled={saving}
        >
          <LoanActionForm
            mode={mode}
            selected={selected}
            receive={receive}
            setReceive={setReceive}
            repay={repay}
            setRepay={setRepay}
            accountOptions={accountOptions}
            receiveAccount={receiveAccount}
            repayAccount={repayAccount}
            receivePrincipal={receivePrincipal}
            receiveFee={receiveFee}
            receiveNet={receiveNet}
            repayPrincipal={repayPrincipal}
            repayInterest={repayInterest}
            repayFee={repayFee}
            repayTotal={repayTotal}
            saving={saving}
            onReceiveSubmit={reviewReceive}
            onRepaySubmit={reviewRepay}
            onCancel={closeMode}
          />
        </LoanFormDialog>
      ) : null}

      <FinancialConfirmationDialog
        open={confirmMode === "new"}
        title="Record this loan agreement?"
        description="This records the approved agreement only. It does not add cash and does not book outstanding principal until money is actually disbursed."
        details={approvalDetails}
        confirmLabel="Record agreement"
        loading={saving}
        warning="Approval is not disbursement. No bank/cash balance or loan principal payable will change at this step."
        onCancel={() => setConfirmMode(null)}
        onConfirm={postApprove}
      />
      <FinancialConfirmationDialog
        open={confirmMode === "receive"}
        title="Post loan disbursement?"
        description="This records money actually received from the lender and creates the corresponding loan principal liability."
        details={receiveDetails}
        confirmLabel="Post money received"
        loading={saving}
        warning="The principal disbursed increases loan principal due. Any withheld fee is posted separately and only the net amount reaches the selected account."
        onCancel={() => setConfirmMode(null)}
        onConfirm={postReceive}
      />
      <FinancialConfirmationDialog
        open={confirmMode === "repay"}
        title="Post loan repayment?"
        description="Check the principal, interest and fee split. The total will be deducted from the selected financial account."
        details={repayDetails}
        confirmLabel="Post repayment"
        loading={saving}
        warning="Principal reduces the loan liability; interest and fees are expenses. Verify the split before posting."
        onCancel={() => setConfirmMode(null)}
        onConfirm={postRepay}
      />
    </AppPage>
  );
}

function LoanFormDialog({
  ariaLabel,
  children,
  onClose,
  closeDisabled = false,
}: {
  ariaLabel: string;
  children: React.ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
        aria-hidden="true"
        onClick={() => {
          if (!closeDisabled) onClose();
        }}
      />
      <div className="relative z-10 max-h-[94dvh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:max-w-6xl sm:rounded-2xl">
        <button
          type="button"
          onClick={onClose}
          disabled={closeDisabled}
          aria-label={`Close ${ariaLabel}`}
          className="absolute right-3 top-3 z-20 flex size-10 items-center justify-center rounded-xl border border-neutral-200 bg-white/95 text-neutral-500 shadow-sm transition hover:bg-neutral-50 hover:text-neutral-950 disabled:cursor-not-allowed disabled:opacity-40 sm:right-4 sm:top-4"
        >
          <X className="size-4" />
        </button>
        {children}
      </div>
    </div>
  );
}

function LoanActionForm({
  mode,
  selected,
  receive,
  setReceive,
  repay,
  setRepay,
  accountOptions,
  receiveAccount,
  repayAccount,
  receivePrincipal,
  receiveFee,
  receiveNet,
  repayPrincipal,
  repayInterest,
  repayFee,
  repayTotal,
  saving,
  onReceiveSubmit,
  onRepaySubmit,
  onCancel,
}: {
  mode: Exclude<Mode, "new" | null>;
  selected: Loan;
  receive: ReturnType<typeof blankReceive>;
  setReceive: React.Dispatch<React.SetStateAction<ReturnType<typeof blankReceive>>>;
  repay: ReturnType<typeof blankRepay>;
  setRepay: React.Dispatch<React.SetStateAction<ReturnType<typeof blankRepay>>>;
  accountOptions: { value: string; label: string; keywords: string }[];
  receiveAccount: FinancialAccount | null;
  repayAccount: FinancialAccount | null;
  receivePrincipal: number;
  receiveFee: number;
  receiveNet: number;
  repayPrincipal: number;
  repayInterest: number;
  repayFee: number;
  repayTotal: number;
  saving: boolean;
  onReceiveSubmit: (event: FormEvent) => void;
  onRepaySubmit: (event: FormEvent) => void;
  onCancel: () => void;
}) {
  const receiving = mode === "receive";
  const receiveValid =
    Boolean(receive.account_id) &&
    receivePrincipal > 0 &&
    receivePrincipal <= Number(selected.undisbursed_amount) &&
    receiveFee >= 0 &&
    receiveFee <= receivePrincipal;
  const repayValid =
    Boolean(repay.account_id) &&
    repayTotal > 0 &&
    repayPrincipal >= 0 &&
    repayPrincipal <= Number(selected.outstanding_principal) &&
    repayInterest >= 0 &&
    repayFee >= 0;

  return (
    <Surface className="overflow-hidden">
      <div className="border-b border-neutral-100 p-5 pr-14 sm:p-6 sm:pr-16">
        <SectionHeader
          title={receiving ? "Receive loan money" : "Record a loan repayment"}
          description={
            receiving
              ? "Record the lender's actual disbursement. Principal becomes a liability; only net cash received reaches the financial account."
              : "Split the payment between principal, interest and fees before posting so liability and expenses remain correct."
          }
        />
      </div>
      <form onSubmit={receiving ? onReceiveSubmit : onRepaySubmit} className="grid xl:grid-cols-[minmax(0,1fr)_330px]">
        <div className="grid gap-4 p-5 sm:p-6 md:grid-cols-2">
          {receiving ? (
            <>
              <div className="md:col-span-2">
                <SearchableSelect
                  label="Receive into"
                  required
                  clearable={false}
                  value={receive.account_id}
                  onValueChange={(value) => setReceive((current) => ({ ...current, account_id: value }))}
                  options={accountOptions}
                  placeholder="Select bank/cash/wallet"
                  searchPlaceholder="Search account..."
                />
                {receiveAccount ? <Hint>Account balance before posting: {amount(receiveAccount.current_balance, receiveAccount.currency)}</Hint> : null}
              </div>
              <MoneyInput
                label="Amount lender disbursed"
                currency={selected.currency}
                required
                min={0.01}
                max={Number(selected.undisbursed_amount)}
                value={receive.principal_amount}
                onValueChange={(value) => setReceive((current) => ({ ...current, principal_amount: value }))}
                hint={`Approved but not yet received: ${amount(selected.undisbursed_amount, selected.currency)}`}
              />
              <MoneyInput
                label="Fee deducted before receiving"
                currency={selected.currency}
                min={0}
                max={receivePrincipal > 0 ? receivePrincipal : undefined}
                value={receive.fee_withheld_amount}
                onValueChange={(value) => setReceive((current) => ({ ...current, fee_withheld_amount: value }))}
              />
              <Field label="Date received">
                <input
                  required
                  type="date"
                  value={receive.disbursement_date}
                  onChange={(event) => setReceive((current) => ({ ...current, disbursement_date: event.target.value }))}
                  className={inputClass}
                />
              </Field>
              <Field label="Reference">
                <input
                  value={receive.reference}
                  onChange={(event) => setReceive((current) => ({ ...current, reference: event.target.value }))}
                  className={inputClass}
                  placeholder="Bank / lender reference"
                />
              </Field>
              <div className="md:col-span-2">
                <Field label="Notes">
                  <textarea
                    rows={3}
                    value={receive.notes}
                    onChange={(event) => setReceive((current) => ({ ...current, notes: event.target.value }))}
                    className={textareaClass}
                    placeholder="Optional internal note"
                  />
                </Field>
              </div>
            </>
          ) : (
            <>
              <div className="md:col-span-2">
                <SearchableSelect
                  label="Pay from"
                  required
                  clearable={false}
                  value={repay.account_id}
                  onValueChange={(value) => setRepay((current) => ({ ...current, account_id: value }))}
                  options={accountOptions}
                  placeholder="Select bank/cash/wallet"
                  searchPlaceholder="Search account..."
                />
                {repayAccount ? <Hint>Account balance before posting: {amount(repayAccount.current_balance, repayAccount.currency)}</Hint> : null}
              </div>
              <MoneyInput
                label="Principal part"
                currency={selected.currency}
                min={0}
                max={Number(selected.outstanding_principal)}
                value={repay.principal_amount}
                onValueChange={(value) => setRepay((current) => ({ ...current, principal_amount: value }))}
                hint={`Principal still due: ${amount(selected.outstanding_principal, selected.currency)}`}
              />
              <MoneyInput
                label="Interest part"
                currency={selected.currency}
                min={0}
                value={repay.interest_amount}
                onValueChange={(value) => setRepay((current) => ({ ...current, interest_amount: value }))}
              />
              <MoneyInput
                label="Other loan fee"
                currency={selected.currency}
                min={0}
                value={repay.fee_amount}
                onValueChange={(value) => setRepay((current) => ({ ...current, fee_amount: value }))}
              />
              <Field label="Payment date">
                <input
                  required
                  type="date"
                  value={repay.payment_date}
                  onChange={(event) => setRepay((current) => ({ ...current, payment_date: event.target.value }))}
                  className={inputClass}
                />
              </Field>
              <Field label="Reference">
                <input
                  value={repay.reference}
                  onChange={(event) => setRepay((current) => ({ ...current, reference: event.target.value }))}
                  className={inputClass}
                  placeholder="Bank / lender reference"
                />
              </Field>
              <div className="md:col-span-2">
                <Field label="Notes">
                  <textarea
                    rows={3}
                    value={repay.notes}
                    onChange={(event) => setRepay((current) => ({ ...current, notes: event.target.value }))}
                    className={textareaClass}
                    placeholder="Optional internal note"
                  />
                </Field>
              </div>
            </>
          )}
        </div>

        <div className="border-t border-neutral-100 bg-neutral-50/70 p-5 sm:p-6 xl:border-l xl:border-t-0">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-neutral-400">Posting preview</p>
          <div className="mt-4 space-y-3">
            {receiving ? (
              <>
                <PreviewRow label="Principal liability added" value={amount(receivePrincipal, selected.currency)} />
                <PreviewRow label="Withheld fee" value={amount(receiveFee, selected.currency)} />
                <PreviewRow label="Net cash received" value={amount(receiveNet, selected.currency)} emphasis />
                <PreviewRow label="Receiving account" value={receiveAccount?.name || "—"} />
              </>
            ) : (
              <>
                <PreviewRow label="Principal reduction" value={amount(repayPrincipal, selected.currency)} />
                <PreviewRow label="Interest expense" value={amount(repayInterest, selected.currency)} />
                <PreviewRow label="Fee expense" value={amount(repayFee, selected.currency)} />
                <PreviewRow label="Total cash payment" value={amount(repayTotal, selected.currency)} emphasis />
              </>
            )}
          </div>

          <div className="mt-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {receiving
              ? "Loan principal is a liability, not revenue. Withheld fees remain separately classified."
              : "Only principal reduces the liability. Interest and loan fees are costs, not principal repayment."}
          </div>

          <div className="mt-5 flex gap-2">
            <button type="button" onClick={onCancel} className="flex-1 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold">
              Cancel
            </button>
            <button
              disabled={saving || (receiving ? !receiveValid : !repayValid)}
              className="flex-1 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              {receiving ? "Review receipt" : "Review repayment"}
            </button>
          </div>
        </div>
      </form>
    </Surface>
  );
}

const inputClass =
  "w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100";
const textareaClass = `${inputClass} min-h-24 resize-y`;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-sm">
      <span className="mb-1.5 block font-medium text-neutral-700">{label}</span>
      {children}
    </label>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1.5 text-xs leading-5 text-neutral-400">{children}</p>;
}

function Stat({
  label,
  value,
  help,
  emphasis = false,
  danger = false,
}: {
  label: string;
  value: string;
  help: string;
  emphasis?: boolean;
  danger?: boolean;
}) {
  return (
    <div className={cn("rounded-xl border border-neutral-100 bg-neutral-50 p-4", danger && "border-red-200 bg-red-50")}>
      <p className={cn("text-xs font-medium uppercase tracking-wide text-neutral-400", danger && "text-red-500")}>{label}</p>
      <p className={cn("mt-2 text-xl font-semibold tabular-nums text-neutral-950", emphasis && "text-2xl", danger && "text-red-700")}>{value}</p>
      <p className={cn("mt-1 text-xs text-neutral-400", danger && "text-red-500")}>{help}</p>
    </div>
  );
}

function PreviewRow({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-neutral-200/70 pb-3 last:border-0 last:pb-0">
      <span className="text-xs text-neutral-500">{label}</span>
      <span className={cn("text-right text-sm font-medium tabular-nums text-neutral-800", emphasis && "font-semibold text-neutral-950")}>{value}</span>
    </div>
  );
}

function StatusBadge({ status, inverted = false }: { status: string; inverted?: boolean }) {
  const normalized = status.toLowerCase();
  if (inverted) {
    return <span className="rounded-full bg-white/10 px-2 py-1 text-[11px] font-medium capitalize text-white">{normalized}</span>;
  }
  const tone =
    normalized === "paid" || normalized === "complete"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-600/10"
      : normalized === "active"
        ? "bg-blue-50 text-blue-700 ring-blue-600/10"
        : normalized === "approved"
          ? "bg-violet-50 text-violet-700 ring-violet-600/10"
          : normalized === "overdue" || normalized === "cancelled"
            ? "bg-red-50 text-red-700 ring-red-600/10"
            : "bg-neutral-100 text-neutral-600 ring-neutral-500/10";
  return <span className={cn("rounded-full px-2 py-1 text-[11px] font-medium capitalize ring-1 ring-inset", tone)}>{normalized}</span>;
}

function LifecycleStep({ index, label, help, state }: { index: number; label: string; help: string; state: LifecycleState }) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3.5",
        state === "complete" && "border-emerald-200 bg-emerald-50/70",
        state === "current" && "border-neutral-300 bg-white shadow-sm",
        state === "upcoming" && "border-neutral-200 bg-neutral-50 text-neutral-400",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex size-6 items-center justify-center rounded-full text-[11px] font-semibold",
            state === "complete" && "bg-emerald-600 text-white",
            state === "current" && "bg-neutral-950 text-white",
            state === "upcoming" && "bg-neutral-200 text-neutral-500",
          )}
        >
          {state === "complete" ? <Check className="size-3.5" /> : index}
        </span>
        <p className={cn("text-sm font-semibold", state === "upcoming" ? "text-neutral-500" : "text-neutral-900")}>{label}</p>
      </div>
      <p className="mt-2 text-xs leading-5 text-neutral-500">{help}</p>
    </div>
  );
}

function getLifecycle(loan: Loan): { label: string; help: string; state: LifecycleState }[] {
  const disbursed = Number(loan.disbursed_amount || 0);
  const outstanding = Number(loan.outstanding_principal || 0);
  const paid = loan.status === "paid" || (disbursed > 0 && outstanding <= 0);
  const cancelled = loan.status === "cancelled";
  return [
    {
      label: "Agreement",
      help: "Terms and approved facility recorded. No cash movement yet.",
      state: "complete",
    },
    {
      label: "Disbursement",
      help: disbursed > 0 ? `${amount(disbursed, loan.currency)} principal received to date.` : "Waiting for lender funding.",
      state: disbursed > 0 ? "complete" : cancelled ? "upcoming" : "current",
    },
    {
      label: "Repayment",
      help: paid ? "Principal has been fully repaid." : outstanding > 0 ? `${amount(outstanding, loan.currency)} principal remains.` : "Starts after funding is received.",
      state: paid ? "complete" : outstanding > 0 ? "current" : "upcoming",
    },
    {
      label: "Closed",
      help: paid ? "Loan lifecycle is financially settled." : cancelled ? "Agreement was cancelled." : "Completes when the loan is financially settled.",
      state: paid || cancelled ? "complete" : "upcoming",
    },
  ];
}

function ScheduleCard({ item, currency }: { item: ScheduleItem; currency: string }) {
  const isOverdue = overdue(item.due_date, item.status);
  return (
    <div className={cn("rounded-xl border border-neutral-200 p-4", isOverdue && "border-red-200 bg-red-50/50")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Installment #{item.installment_number}</p>
          <p className={cn("mt-1 text-xs text-neutral-500", isOverdue && "font-medium text-red-600")}>Due {item.due_date}</p>
        </div>
        <StatusBadge status={isOverdue ? "overdue" : item.status} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <MiniAmount label="Principal" value={amount(item.principal_due, currency)} paid={amount(item.principal_paid, currency)} />
        <MiniAmount label="Interest" value={amount(item.interest_due, currency)} paid={amount(item.interest_paid, currency)} />
        <MiniAmount label="Fees" value={amount(item.fee_due, currency)} paid={amount(item.fee_paid, currency)} />
      </div>
    </div>
  );
}

function MiniAmount({ label, value, paid }: { label: string; value: string; paid: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-neutral-50 p-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">{label}</p>
      <p className="mt-1 truncate text-xs font-semibold tabular-nums text-neutral-800">{value}</p>
      <p className="mt-1 truncate text-[10px] text-neutral-400">Paid {paid}</p>
    </div>
  );
}

function HistoryRow({
  title,
  date,
  meta,
  reference,
  notes,
  kind,
}: {
  title: string;
  date: string;
  meta: string;
  reference: string | null;
  notes: string | null;
  kind: "receive" | "repay" | "fee";
}) {
  const Icon = kind === "receive" ? ArrowDownToLine : kind === "repay" ? WalletCards : CircleDollarSign;
  return (
    <div className="rounded-xl border border-neutral-200 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-600">
            <Icon className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="font-medium text-neutral-950">{title}</p>
            <p className="mt-1 text-sm leading-5 text-neutral-500">{meta}</p>
          </div>
        </div>
        <p className="shrink-0 text-xs text-neutral-400">{date}</p>
      </div>
      {reference ? <p className="mt-3 text-xs text-neutral-400">Reference: {reference}</p> : null}
      {notes ? <p className="mt-2 text-sm leading-5 text-neutral-500">{notes}</p> : null}
    </div>
  );
}
