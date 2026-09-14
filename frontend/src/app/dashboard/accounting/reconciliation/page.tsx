"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleDollarSign,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  WalletCards,
} from "lucide-react";

import { AccountingNav } from "@/components/accounting-nav";
import { FinancialConfirmationDialog } from "@/components/financial-confirmation-dialog";
import { SearchableSelect } from "@/components/searchable-select";
import { AppPage, PageHeader, SectionHeader, Surface } from "@/components/ui/app-page";
import { cn } from "@/lib/cn";

type Account = {
  id: string;
  name: string;
  account_type: string;
  currency: string;
  last_reconciled_date?: string | null;
  last_statement_balance?: string | null;
};
type Meta = { accounts: Account[] };
type Session = {
  id: string;
  account_id: string;
  account_name: string;
  currency: string;
  statement_start_date?: string | null;
  statement_end_date: string;
  statement_ending_balance: string;
  cleared_book_balance: string;
  difference: string;
  status: string;
  matched_transactions: number;
  notes?: string | null;
  finalized_at?: string | null;
  created_at?: string;
};
type Tx = {
  id: string;
  transaction_date: string;
  direction: string;
  amount: string;
  currency: string;
  source_type: string;
  reference?: string | null;
  description?: string | null;
  selected: boolean;
};
type Detail = Session & { transactions: Tx[]; unmatched_count: number };
type Confirmation = "finalize" | "discard" | null;

const inputClass =
  "mt-1.5 h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none transition focus:border-neutral-500";
const textareaClass =
  "mt-1.5 min-h-24 w-full rounded-xl border border-neutral-200 bg-white px-3 py-3 text-sm outline-none transition focus:border-neutral-500";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.detail || "Request failed");
  return body as T;
}

function money(value: string | number, currency: string) {
  return `${currency} ${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function pretty(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function statusTone(status: string) {
  return status === "finalized"
    ? "bg-emerald-50 text-emerald-700 ring-emerald-600/10"
    : "bg-amber-50 text-amber-700 ring-amber-600/10";
}

export default function ReconciliationPage() {
  const [meta, setMeta] = useState<Meta>({ accounts: [] });
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [accountId, setAccountId] = useState("");
  const [endDate, setEndDate] = useState("");
  const [statementBalance, setStatementBalance] = useState("");
  const [notes, setNotes] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatus, setHistoryStatus] = useState<"all" | "draft" | "finalized">("all");
  const [txSearch, setTxSearch] = useState("");
  const [txFilter, setTxFilter] = useState<"all" | "matched" | "unmatched">("all");
  const [confirmation, setConfirmation] = useState<Confirmation>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [m, s] = await Promise.all([
        api<Meta>("/api/accounting/reconciliations/meta"),
        api<Session[]>("/api/accounting/reconciliations"),
      ]);
      setMeta(m);
      setSessions(s);
      setAccountId((current) => current || m.accounts[0]?.id || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load reconciliation");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function open(id: string) {
    setBusy(true);
    setError(null);
    try {
      const detail = await api<Detail>(`/api/accounting/reconciliations/${id}`);
      setSelected(detail);
      setSessions((current) =>
        current.map((row) =>
          row.id === id
            ? {
                ...row,
                cleared_book_balance: detail.cleared_book_balance,
                difference: detail.difference,
                status: detail.status,
                matched_transactions: detail.matched_transactions,
                finalized_at: detail.finalized_at,
              }
            : row,
        ),
      );
      return detail;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open reconciliation");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const row = await api<Session>("/api/accounting/reconciliations", {
        method: "POST",
        body: JSON.stringify({
          account_id: accountId,
          statement_end_date: endDate,
          statement_ending_balance: statementBalance,
          notes: notes || null,
        }),
      });
      setSuccess("Reconciliation draft created. Match only the transactions that appear on the statement.");
      setEndDate("");
      setStatementBalance("");
      setNotes("");
      await load();
      await open(row.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create reconciliation");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(tx: Tx) {
    if (!selected || selected.status !== "draft") return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/accounting/reconciliations/${selected.id}/transactions/${tx.id}`, {
        method: tx.selected ? "DELETE" : "POST",
      });
      await open(selected.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update matched transaction");
    } finally {
      setBusy(false);
    }
  }

  async function finalize() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const row = await api<Session>(`/api/accounting/reconciliations/${selected.id}/finalize`, {
        method: "POST",
        body: "{}",
      });
      setConfirmation(null);
      setSuccess("Reconciliation finalized. The matched statement period is now locked.");
      await open(row.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not finalize reconciliation");
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    if (!selected || selected.status !== "draft") return;
    const discardedId = selected.id;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await api(`/api/accounting/reconciliations/${discardedId}`, { method: "DELETE" });
      setConfirmation(null);
      setSelected(null);
      setSuccess("Draft discarded. No financial transactions were deleted or changed.");
      setSessions((current) => current.filter((row) => row.id !== discardedId));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not discard reconciliation draft");
    } finally {
      setBusy(false);
    }
  }

  const account = useMemo(() => meta.accounts.find((item) => item.id === accountId) ?? null, [meta.accounts, accountId]);
  const draftCount = useMemo(() => sessions.filter((row) => row.status === "draft").length, [sessions]);
  const finalizedCount = sessions.length - draftCount;
  const accountsNeverReconciled = useMemo(() => meta.accounts.filter((item) => !item.last_reconciled_date).length, [meta.accounts]);

  const historyRows = useMemo(() => {
    const search = historySearch.trim().toLowerCase();
    return sessions.filter((row) => {
      if (historyStatus !== "all" && row.status !== historyStatus) return false;
      if (!search) return true;
      return [row.account_name, row.currency, row.statement_start_date, row.statement_end_date, row.notes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(search);
    });
  }, [sessions, historySearch, historyStatus]);

  const visibleTransactions = useMemo(() => {
    if (!selected) return [];
    const search = txSearch.trim().toLowerCase();
    return selected.transactions.filter((tx) => {
      if (txFilter === "matched" && !tx.selected) return false;
      if (txFilter === "unmatched" && tx.selected) return false;
      if (!search) return true;
      return [tx.description, tx.source_type, tx.reference, tx.transaction_date, tx.amount, tx.currency]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(search);
    });
  }, [selected, txSearch, txFilter]);

  const accountOptions = useMemo(
    () =>
      meta.accounts.map((item) => ({
        value: item.id,
        label: `${item.name} · ${item.currency}`,
        keywords: `${item.account_type} ${item.last_reconciled_date ?? "never reconciled"}`,
      })),
    [meta.accounts],
  );

  if (loading) {
    return (
      <AppPage>
        <div className="flex min-h-[65vh] items-center justify-center text-neutral-500">
          <Loader2 className="size-6 animate-spin" />
        </div>
      </AppPage>
    );
  }

  return (
    <AppPage>
      <PageHeader
        eyebrow="Finance & Accounts"
        title="Account reconciliation"
        description="Match Business OS account movements to the real bank, wallet, gateway or card statement. Reconciliation never creates income or expense; it verifies that the operational account record agrees with the external statement."
        meta={
          <>
            <span className="rounded-full border bg-white px-2.5 py-1">Zero difference required to finalize</span>
            <span className="rounded-full border bg-white px-2.5 py-1">Finalized periods are locked</span>
            <span className="rounded-full border bg-white px-2.5 py-1">Amounts stay in account currency</span>
          </>
        }
      />

      <div className="mt-6">
        <AccountingNav />
      </div>

      {error ? <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {success ? <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div> : null}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon={WalletCards} label="Reconcileable accounts" value={String(meta.accounts.length)} detail="Active financial accounts" />
        <SummaryCard icon={CircleDollarSign} label="Open drafts" value={String(draftCount)} detail="Finish or discard before starting another for the same account" />
        <SummaryCard icon={CheckCircle2} label="Finalized" value={String(finalizedCount)} detail="Locked statement periods" />
        <SummaryCard icon={ShieldCheck} label="Never reconciled" value={String(accountsNeverReconciled)} detail="Accounts without a finalized statement" />
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]">
        <Surface className="p-5 sm:p-6">
          <SectionHeader
            title="Start a statement reconciliation"
            description="Enter the statement exactly as received. Business OS derives the next statement period from the last finalized reconciliation."
          />
          <form onSubmit={create} className="mt-5 space-y-4">
            <SearchableSelect
              label="Financial account"
              name="reconciliation_account"
              value={accountId}
              onValueChange={setAccountId}
              options={accountOptions}
              required
              placeholder="Select account"
              searchPlaceholder="Search account or currency..."
            />

            {account ? (
              <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3.5 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-neutral-800">{pretty(account.account_type)} · {account.currency}</span>
                  <span className="text-xs text-neutral-400">Statement currency must be {account.currency}</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-neutral-500">
                  {account.last_reconciled_date
                    ? `Last finalized through ${account.last_reconciled_date}${account.last_statement_balance ? ` at ${money(account.last_statement_balance, account.currency)}` : ""}.`
                    : "No finalized reconciliation exists yet; this will establish the first cleared statement position."}
                </p>
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-neutral-600">
                Statement end date
                <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} required className={inputClass} />
              </label>
              <label className="text-sm font-medium text-neutral-600">
                Statement ending balance
                <div className="mt-1.5 flex h-11 overflow-hidden rounded-xl border border-neutral-200 bg-white">
                  <span className="flex min-w-16 items-center justify-center border-r px-3 text-sm font-medium text-neutral-400">{account?.currency ?? "—"}</span>
                  <input
                    type="number"
                    step="0.01"
                    value={statementBalance}
                    onChange={(event) => setStatementBalance(event.target.value)}
                    required
                    className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none"
                    placeholder="0.00"
                  />
                </div>
              </label>
            </div>

            <label className="block text-sm font-medium text-neutral-600">
              Statement note / reference
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} className={textareaClass} placeholder="Optional bank statement ID, card cycle or internal note" />
            </label>

            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3.5 text-xs leading-5 text-blue-800">
              Missing bank fees, interest, charges or receipts should be recorded through the correct Money In / Money Out workflow first. Reconciliation only matches existing account movements; it does not create accounting entries.
            </div>

            <button
              disabled={busy || !accountId || !endDate || statementBalance === ""}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Create reconciliation draft
            </button>
          </form>
        </Surface>

        <Surface className="overflow-hidden">
          <div className="p-5 sm:p-6">
            <SectionHeader
              title="Reconciliation history"
              description="Review drafts and finalized statement periods without combining balances across currencies."
              action={
                <button onClick={() => void load()} disabled={busy} className="rounded-xl border border-neutral-200 p-2.5 text-neutral-500 hover:bg-neutral-50 disabled:opacity-40" aria-label="Refresh reconciliation history">
                  <RefreshCw className={cn("size-4", busy && "animate-spin")} />
                </button>
              }
            />
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <label className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
                <input value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Search account, date or note" className="h-10 w-full rounded-xl border border-neutral-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-neutral-500" />
              </label>
              <select value={historyStatus} onChange={(event) => setHistoryStatus(event.target.value as typeof historyStatus)} className="h-10 rounded-xl border border-neutral-200 bg-white px-3 text-sm text-neutral-600 outline-none">
                <option value="all">All statuses</option>
                <option value="draft">Draft</option>
                <option value="finalized">Finalized</option>
              </select>
            </div>
          </div>

          <div className="border-t border-neutral-100">
            {historyRows.length ? (
              <div className="divide-y divide-neutral-100">
                {historyRows.map((row) => {
                  const active = selected?.id === row.id;
                  return (
                    <button
                      key={row.id}
                      onClick={() => void open(row.id)}
                      className={cn("grid w-full gap-3 px-5 py-4 text-left transition sm:grid-cols-[1fr_auto] sm:items-center sm:px-6", active ? "bg-neutral-50" : "hover:bg-neutral-50/70")}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate font-medium text-neutral-900">{row.account_name}</p>
                          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", statusTone(row.status))}>{pretty(row.status)}</span>
                        </div>
                        <p className="mt-1 text-xs text-neutral-400">
                          {row.statement_start_date ? `${row.statement_start_date} → ` : "Through "}{row.statement_end_date} · {row.matched_transactions} matched
                        </p>
                        {row.notes ? <p className="mt-1 truncate text-xs text-neutral-500">{row.notes}</p> : null}
                      </div>
                      <div className="sm:text-right">
                        <p className="text-sm font-semibold tabular-nums text-neutral-900">{money(row.statement_ending_balance, row.currency)}</p>
                        <p className={cn("mt-1 text-xs tabular-nums", Number(row.difference) === 0 ? "text-emerald-600" : "text-amber-600")}>Difference {money(row.difference, row.currency)}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="px-6 py-14 text-center text-sm text-neutral-400">No reconciliation matches the current filters.</div>
            )}
          </div>
        </Surface>
      </div>

      {selected ? (
        <Surface className="mt-6 overflow-hidden">
          <div className="p-5 sm:p-6">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-400">{selected.account_name} · {selected.currency}</p>
                <h2 className="mt-1.5 text-xl font-semibold text-neutral-950">Statement matching</h2>
                <p className="mt-1 text-sm text-neutral-500">
                  {selected.statement_start_date ? `${selected.statement_start_date} → ` : "Through "}{selected.statement_end_date}
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-3 xl:min-w-[590px]">
                <Metric label="Statement" value={money(selected.statement_ending_balance, selected.currency)} />
                <Metric label="Cleared books" value={money(selected.cleared_book_balance, selected.currency)} />
                <Metric label="Difference" value={money(selected.difference, selected.currency)} strong={Number(selected.difference) === 0} warning={Number(selected.difference) !== 0} />
              </div>
            </div>

            {selected.status === "draft" ? (
              <div className="mt-5 flex flex-col gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3.5 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm font-medium text-neutral-800">{selected.matched_transactions} matched · {selected.unmatched_count} still unmatched</p>
                  <p className="mt-1 text-xs leading-5 text-neutral-500">Outstanding legitimate transactions may remain unmatched. Finalization is allowed only when the selected cleared movements reproduce the external statement balance exactly.</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button onClick={() => setConfirmation("discard")} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-40">
                    <Trash2 className="size-4" /> Discard draft
                  </button>
                  <button
                    disabled={busy || Number(selected.difference) !== 0}
                    onClick={() => setConfirmation("finalize")}
                    className="inline-flex items-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    <CheckCircle2 className="size-4" /> Finalize reconciliation
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-5 inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm font-medium text-emerald-700">
                <CheckCircle2 className="size-4" /> Finalized and locked{selected.finalized_at ? ` · ${new Date(selected.finalized_at).toLocaleString()}` : ""}
              </div>
            )}

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <label className="relative flex-1 sm:max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
                <input value={txSearch} onChange={(event) => setTxSearch(event.target.value)} placeholder="Search transaction, reference or amount" className="h-10 w-full rounded-xl border border-neutral-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-neutral-500" />
              </label>
              <div className="flex rounded-xl border border-neutral-200 bg-white p-1">
                {(["all", "matched", "unmatched"] as const).map((value) => (
                  <button key={value} onClick={() => setTxFilter(value)} className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold capitalize", txFilter === value ? "bg-neutral-950 text-white" : "text-neutral-500 hover:bg-neutral-50")}>{value}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="hidden overflow-x-auto border-t border-neutral-100 md:block">
            <table className="w-full min-w-[880px] text-sm">
              <thead className="bg-neutral-50 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
                <tr>
                  <th className="px-5 py-3">Matched</th>
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Description</th>
                  <th className="px-5 py-3">Reference</th>
                  <th className="px-5 py-3 text-right">Money out</th>
                  <th className="px-5 py-3 text-right">Money in</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {visibleTransactions.map((tx) => (
                  <tr key={tx.id} className={tx.selected ? "bg-emerald-50/35" : ""}>
                    <td className="px-5 py-3.5">
                      <input type="checkbox" checked={tx.selected} disabled={busy || selected.status !== "draft"} onChange={() => void toggle(tx)} className="size-4 rounded border-neutral-300" />
                    </td>
                    <td className="px-5 py-3.5 text-neutral-600">{tx.transaction_date}</td>
                    <td className="px-5 py-3.5">
                      <p className="font-medium text-neutral-900">{tx.description || pretty(tx.source_type)}</p>
                      <p className="mt-0.5 text-xs text-neutral-400">{pretty(tx.source_type)}</p>
                    </td>
                    <td className="px-5 py-3.5 text-neutral-500">{tx.reference || "—"}</td>
                    <td className="px-5 py-3.5 text-right font-medium tabular-nums">{tx.direction === "debit" ? money(tx.amount, tx.currency) : "—"}</td>
                    <td className="px-5 py-3.5 text-right font-medium tabular-nums">{tx.direction === "credit" ? money(tx.amount, tx.currency) : "—"}</td>
                  </tr>
                ))}
                {!visibleTransactions.length ? (
                  <tr><td colSpan={6} className="px-5 py-14 text-center text-neutral-400">No transactions match the current filters.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="divide-y divide-neutral-100 border-t border-neutral-100 md:hidden">
            {visibleTransactions.map((tx) => (
              <div key={tx.id} className={cn("p-4", tx.selected && "bg-emerald-50/35")}>
                <div className="flex items-start gap-3">
                  <input type="checkbox" checked={tx.selected} disabled={busy || selected.status !== "draft"} onChange={() => void toggle(tx)} className="mt-1 size-4 rounded border-neutral-300" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-neutral-900">{tx.description || pretty(tx.source_type)}</p>
                        <p className="mt-1 text-xs text-neutral-400">{tx.transaction_date} · {pretty(tx.source_type)}</p>
                      </div>
                      <p className={cn("shrink-0 text-sm font-semibold tabular-nums", tx.direction === "credit" ? "text-emerald-700" : "text-neutral-900")}>{tx.direction === "credit" ? "+" : "−"}{money(tx.amount, tx.currency)}</p>
                    </div>
                    <p className="mt-2 text-xs text-neutral-500">Reference: {tx.reference || "—"}</p>
                  </div>
                </div>
              </div>
            ))}
            {!visibleTransactions.length ? <div className="px-4 py-12 text-center text-sm text-neutral-400">No transactions match the current filters.</div> : null}
          </div>
        </Surface>
      ) : null}

      <FinancialConfirmationDialog
        open={confirmation === "finalize" && Boolean(selected)}
        title="Finalize this reconciliation?"
        description="Finalization locks the matched statement period. Use this only after the external statement and cleared Business OS movements agree exactly."
        details={selected ? [
          { label: "Account", value: `${selected.account_name} · ${selected.currency}` },
          { label: "Statement through", value: selected.statement_end_date },
          { label: "Statement balance", value: money(selected.statement_ending_balance, selected.currency), emphasis: true },
          { label: "Cleared books", value: money(selected.cleared_book_balance, selected.currency) },
          { label: "Difference", value: money(selected.difference, selected.currency), emphasis: true },
          { label: "Matched transactions", value: String(selected.matched_transactions) },
        ] : []}
        confirmLabel="Finalize reconciliation"
        loading={busy}
        warning="Finalized reconciliation matching cannot be edited. Any missing fee, interest, receipt or correction must be recorded through its proper financial workflow rather than forced into reconciliation."
        onCancel={() => setConfirmation(null)}
        onConfirm={finalize}
      />

      <FinancialConfirmationDialog
        open={confirmation === "discard" && Boolean(selected)}
        title="Discard this draft?"
        description="This removes the unfinished reconciliation session and its matching selections only."
        details={selected ? [
          { label: "Account", value: `${selected.account_name} · ${selected.currency}` },
          { label: "Statement through", value: selected.statement_end_date },
          { label: "Matched selections", value: String(selected.matched_transactions) },
          { label: "Current difference", value: money(selected.difference, selected.currency) },
        ] : []}
        confirmLabel="Discard draft"
        loading={busy}
        warning="No FinancialTransaction, account balance, journal entry, income or expense is deleted by discarding a reconciliation draft."
        onCancel={() => setConfirmation(null)}
        onConfirm={discard}
      />
    </AppPage>
  );
}

function Metric({ label, value, strong = false, warning = false }: { label: string; value: string; strong?: boolean; warning?: boolean }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-3.5 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-neutral-400">{label}</p>
      <p className={cn("mt-1.5 text-sm font-semibold tabular-nums text-neutral-900", strong && "text-emerald-700", warning && "text-amber-700")}>{value}</p>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, detail }: { icon: typeof WalletCards; label: string; value: string; detail: string }) {
  return (
    <Surface className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-neutral-500">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950">{value}</p>
          <p className="mt-1 text-xs leading-5 text-neutral-400">{detail}</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-2.5 text-neutral-500"><Icon className="size-4" /></div>
      </div>
    </Surface>
  );
}
