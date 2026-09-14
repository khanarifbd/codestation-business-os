"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  CreditCard,
  FileClock,
  Landmark,
  Loader2,
  Search,
  WalletCards,
} from "lucide-react";

import { AccountingNav } from "@/components/accounting-nav";
import { SearchableSelect } from "@/components/searchable-select";
import { AppPage, PageHeader, SectionHeader, Surface } from "@/components/ui/app-page";
import { getApiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/cn";

type Account = {
  id: string;
  name: string;
  account_type: string;
  currency: string;
  current_balance: string | number;
  is_active: boolean;
};
type Tx = {
  id: string;
  transaction_date: string;
  direction: "credit" | "debit";
  amount: string | number;
  currency: string;
  source_type: string;
  reference: string | null;
  description: string | null;
  created_at: string;
};
type LedgerPage = { items: Tx[]; next_cursor: string | null };

type DirectionFilter = "all" | "credit" | "debit";

function money(value: string | number, currency: string) {
  return `${currency} ${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function pretty(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function isCreditCard(account: Account | null) {
  return account?.account_type === "credit_card";
}

function movementLabel(account: Account | null, direction: "credit" | "debit") {
  if (isCreditCard(account)) return direction === "credit" ? "Charge / increase owed" : "Payment / decrease owed";
  return direction === "credit" ? "Money in" : "Money out";
}

export default function AccountStatementPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [rows, setRows] = useState<Tx[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<DirectionFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const selected = accounts.find((account) => account.id === accountId) ?? null;
  const accountOptions = useMemo(
    () =>
      accounts.map((account) => ({
        value: account.id,
        label: `${account.name} · ${account.currency} · ${pretty(account.account_type)}`,
        keywords: `${account.name} ${account.currency} ${account.account_type}`,
      })),
    [accounts],
  );

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/finance/accounts", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not load accounts"));
      const result = payload as Account[];
      setAccounts(result);
      setAccountId((current) => current || result.find((item) => item.is_active)?.id || result[0]?.id || "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load accounts");
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const loadLedger = useCallback(
    async (cursor?: string, append = false, signal?: AbortSignal) => {
      if (!accountId) {
        setRows([]);
        setNextCursor(null);
        return;
      }
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ limit: "50" });
        if (search.trim()) params.set("search", search.trim());
        if (direction !== "all") params.set("direction", direction);
        if (dateFrom) params.set("date_from", dateFrom);
        if (dateTo) params.set("date_to", dateTo);
        if (cursor) params.set("cursor", cursor);
        const response = await fetch(`/api/finance/accounts/${accountId}/ledger-page?${params.toString()}`, {
          cache: "no-store",
          signal,
        });
        const payload = (await response.json()) as LedgerPage;
        if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not load statement"));
        setRows((current) => (append ? [...current, ...payload.items] : payload.items));
        setNextCursor(payload.next_cursor);
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Could not load statement");
      } finally {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    },
    [accountId, dateFrom, dateTo, direction, search],
  );

  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => void loadLedger(undefined, false, controller.signal),
      search.trim() ? 250 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [accountId, loadLedger]);

  const hasFilters = Boolean(search || direction !== "all" || dateFrom || dateTo);
  const cardAccount = isCreditCard(selected);

  function resetFilters() {
    setSearch("");
    setDirection("all");
    setDateFrom("");
    setDateTo("");
  }

  return (
    <AppPage>
      <div className="space-y-6">
        <Link
          href="/dashboard/accounting/reports"
          className="inline-flex items-center gap-2 text-sm text-neutral-500 transition hover:text-neutral-950"
        >
          <ArrowLeft className="size-4" />
          Financial reports
        </Link>

        <PageHeader
          eyebrow="Finance & Accounting"
          title="Account statement"
          description="Inspect every posted movement for one bank, cash, wallet, gateway or credit-card account without mixing currencies or accounts."
          meta={
            <>
              <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-1">One account · one currency</span>
              <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-1">Cursor-paginated history</span>
            </>
          }
        />

        <AccountingNav />

        {error ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => (accountId ? void loadLedger() : void loadAccounts())}
              className="font-medium underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        ) : null}

        <Surface className="p-5 sm:p-6">
          <SectionHeader
            title="Financial account"
            description="Select the exact account whose operational ledger you want to inspect."
          />
          <div className="mt-5 max-w-2xl">
            <SearchableSelect
              label="Account"
              required
              clearable={false}
              value={accountId}
              onValueChange={setAccountId}
              options={accountOptions}
              placeholder={accountsLoading ? "Loading accounts…" : "Select account"}
              searchPlaceholder="Search account, type or currency..."
              disabled={accountsLoading}
            />
          </div>

          {selected ? (
            <div className="mt-5 grid gap-3 border-t border-neutral-100 pt-5 sm:grid-cols-2 xl:grid-cols-4">
              <AccountMetric
                icon={cardAccount ? <CreditCard className="size-4" /> : <WalletCards className="size-4" />}
                label={cardAccount ? "Amount owed" : "Current balance"}
                value={money(selected.current_balance, selected.currency)}
              />
              <AccountMetric icon={<Landmark className="size-4" />} label="Account type" value={pretty(selected.account_type)} />
              <AccountMetric icon={<FileClock className="size-4" />} label="Currency" value={selected.currency} />
              <AccountMetric
                icon={selected.is_active ? <ArrowUpRight className="size-4" /> : <ArrowDownLeft className="size-4" />}
                label="Status"
                value={selected.is_active ? "Active" : "Inactive"}
              />
            </div>
          ) : null}
        </Surface>

        {selected ? (
          <Surface className="overflow-hidden">
            <div className="border-b border-neutral-100 p-5 sm:p-6">
              <SectionHeader
                title="Transaction history"
                description={
                  cardAccount
                    ? "For credit cards, charges increase the liability and payments reduce it."
                    : "Credits increase cash-like accounts; debits reduce them."
                }
                action={<span className="text-xs text-neutral-400">Showing {rows.length} loaded movements</span>}
              />

              <div className="mt-5 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                <div className="relative xl:col-span-2">
                  <Search className="pointer-events-none absolute left-3 top-3 size-4 text-neutral-400" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search description, reference or source…"
                    className="w-full rounded-xl border border-neutral-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100"
                  />
                </div>
                <select
                  value={direction}
                  onChange={(event) => setDirection(event.target.value as DirectionFilter)}
                  className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100"
                >
                  <option value="all">All movements</option>
                  <option value="credit">{cardAccount ? "Charges / increases" : "Money in"}</option>
                  <option value="debit">{cardAccount ? "Payments / decreases" : "Money out"}</option>
                </select>
                <input
                  aria-label="Statement from date"
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                  className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100"
                />
                <input
                  aria-label="Statement to date"
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                  className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100"
                />
              </div>
              {hasFilters ? (
                <div className="mt-3 flex justify-end">
                  <button type="button" onClick={resetFilters} className="text-xs font-medium text-neutral-500 hover:text-neutral-900">
                    Clear filters
                  </button>
                </div>
              ) : null}
            </div>

            {loading ? (
              <div className="space-y-3 p-5 sm:p-6">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="h-14 animate-pulse rounded-xl bg-neutral-100" />
                ))}
              </div>
            ) : rows.length ? (
              <>
                <div className="hidden overflow-x-auto md:block">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-neutral-100 text-left text-xs font-medium uppercase tracking-[0.12em] text-neutral-400">
                        <th className="px-5 py-3">Date</th>
                        <th className="px-4 py-3">Description</th>
                        <th className="px-4 py-3">Source</th>
                        <th className="px-4 py-3">Reference</th>
                        <th className="px-5 py-3 text-right">{cardAccount ? "Charge / increase" : "Money in"}</th>
                        <th className="px-5 py-3 text-right">{cardAccount ? "Payment / decrease" : "Money out"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50/70">
                          <td className="whitespace-nowrap px-5 py-3 text-neutral-600">{row.transaction_date}</td>
                          <td className="max-w-md px-4 py-3">
                            <p className="font-medium text-neutral-900">{row.description || "Account movement"}</p>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-neutral-500">{pretty(row.source_type)}</td>
                          <td className="max-w-48 truncate px-4 py-3 text-neutral-500">{row.reference || "—"}</td>
                          <td className="whitespace-nowrap px-5 py-3 text-right font-semibold tabular-nums text-neutral-900">
                            {row.direction === "credit" ? money(row.amount, row.currency) : "—"}
                          </td>
                          <td className="whitespace-nowrap px-5 py-3 text-right font-semibold tabular-nums text-neutral-900">
                            {row.direction === "debit" ? money(row.amount, row.currency) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="divide-y divide-neutral-100 md:hidden">
                  {rows.map((row) => (
                    <div key={row.id} className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="font-medium text-neutral-900">{row.description || "Account movement"}</p>
                          <p className="mt-1 text-xs text-neutral-400">{row.transaction_date} · {pretty(row.source_type)}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className={cn("font-semibold tabular-nums", row.direction === "credit" ? "text-emerald-700" : "text-neutral-900")}>
                            {money(row.amount, row.currency)}
                          </p>
                          <p className="mt-1 text-xs text-neutral-400">{movementLabel(selected, row.direction)}</p>
                        </div>
                      </div>
                      {row.reference ? <p className="mt-2 text-xs text-neutral-500">Reference: {row.reference}</p> : null}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="px-5 py-14 text-center">
                <Landmark className="mx-auto size-9 text-neutral-300" />
                <p className="mt-3 font-medium text-neutral-900">No matching account movements</p>
                <p className="mt-1 text-sm text-neutral-400">
                  {hasFilters ? "Try clearing the statement filters." : "Posted movements for this account will appear here."}
                </p>
              </div>
            )}

            {nextCursor ? (
              <div className="border-t border-neutral-100 p-4 text-center">
                <button
                  type="button"
                  onClick={() => void loadLedger(nextCursor, true)}
                  disabled={loadingMore}
                  className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50"
                >
                  {loadingMore ? <Loader2 className="size-4 animate-spin" /> : null}
                  {loadingMore ? "Loading…" : "Load more movements"}
                </button>
              </div>
            ) : null}
          </Surface>
        ) : (
          <Surface className="px-5 py-14 text-center">
            <Landmark className="mx-auto size-9 text-neutral-300" />
            <p className="mt-3 font-medium text-neutral-900">Select a financial account</p>
            <p className="mt-1 text-sm text-neutral-400">Its statement history will appear here.</p>
          </Surface>
        )}
      </div>
    </AppPage>
  );
}

function AccountMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-neutral-50/60 p-4">
      <div className="flex items-center gap-2 text-neutral-400">
        {icon}
        <p className="text-xs font-medium uppercase tracking-[0.12em]">{label}</p>
      </div>
      <p className="mt-2 font-semibold text-neutral-900">{value}</p>
    </div>
  );
}
