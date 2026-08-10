"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowDownLeft, ArrowUpRight, Landmark, Loader2 } from "lucide-react";
import { useParams } from "next/navigation";

import { AccountingNav } from "@/components/accounting-nav";

type Account = {
  id: string;
  name: string;
  account_type: string;
  provider_name: string | null;
  account_reference: string | null;
  currency: string;
  opening_balance: string | number;
  current_balance: string | number;
  is_active: boolean;
};

type Transaction = {
  id: string;
  transaction_date: string;
  direction: "credit" | "debit" | string;
  amount: string | number;
  currency: string;
  source_type: string;
  source_id: string;
  reference: string | null;
  description: string | null;
  created_at: string;
};

type LedgerRow = Transaction & { running_balance: number };

function money(value: string | number, currency: string) {
  return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function prettySource(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function apiError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const message = detail.map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "msg" in item && typeof (item as { msg?: unknown }).msg === "string") return (item as { msg: string }).msg;
      return null;
    }).filter(Boolean).join(" · ");
    if (message) return message;
  }
  return fallback;
}

export default function AccountLedgerPage() {
  const params = useParams<{ accountId: string }>();
  const accountId = params.accountId;
  const [account, setAccount] = useState<Account | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [accountsRes, ledgerRes] = await Promise.all([
        fetch("/api/finance/accounts", { cache: "no-store" }),
        fetch(`/api/finance/accounts/${accountId}/ledger?limit=500`, { cache: "no-store" }),
      ]);
      const [accountsPayload, ledgerPayload] = await Promise.all([accountsRes.json(), ledgerRes.json()]);
      if (!accountsRes.ok) throw new Error(apiError(accountsPayload, "Could not load account"));
      if (!ledgerRes.ok) throw new Error(apiError(ledgerPayload, "Could not load account ledger"));
      const selected = (accountsPayload as Account[]).find((item) => item.id === accountId) ?? null;
      if (!selected) throw new Error("Financial account not found");
      setAccount(selected);
      setTransactions(ledgerPayload as Transaction[]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load account ledger");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo<LedgerRow[]>(() => {
    if (!account) return [];
    let running = Number(account.opening_balance || 0);
    const ascending = [...transactions].sort((a, b) => {
      const dateCompare = a.transaction_date.localeCompare(b.transaction_date);
      if (dateCompare !== 0) return dateCompare;
      return a.created_at.localeCompare(b.created_at);
    });
    const withBalance = ascending.map((item) => {
      running += item.direction === "credit" ? Number(item.amount) : -Number(item.amount);
      return { ...item, running_balance: running };
    });
    return withBalance.reverse();
  }, [account, transactions]);

  const totals = useMemo(() => {
    let credit = 0;
    let debit = 0;
    for (const item of transactions) {
      if (item.direction === "credit") credit += Number(item.amount);
      else debit += Number(item.amount);
    }
    return { credit, debit };
  }, [transactions]);

  if (loading) return <main className="flex min-h-[70vh] items-center justify-center"><Loader2 className="size-7 animate-spin text-neutral-400" /></main>;

  return <main className="p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-7xl space-y-6">
    <div>
      <Link href="/dashboard/accounting/accounts" className="inline-flex items-center gap-2 text-sm font-medium text-neutral-500 hover:text-neutral-950"><ArrowLeft className="size-4" />Back to accounts</Link>
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Finance & Accounts · Account Ledger</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{account?.name ?? "Account ledger"}</h1>
          <p className="mt-2 text-sm text-neutral-500">{account?.provider_name || account?.account_reference || "Full transaction history for this account."}</p>
        </div>
        {account ? <div className="rounded-2xl border bg-white px-5 py-4 text-right"><p className="text-xs text-neutral-400">Current balance</p><p className="mt-1 text-2xl font-semibold tabular-nums">{money(account.current_balance, account.currency)}</p></div> : null}
      </div>
    </div>

    <AccountingNav />
    {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

    {account ? <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-2xl border bg-white p-5"><p className="text-sm text-neutral-500">Opening balance</p><p className="mt-2 text-2xl font-semibold tabular-nums">{money(account.opening_balance, account.currency)}</p></div>
      <div className="rounded-2xl border bg-white p-5"><div className="flex items-center justify-between"><p className="text-sm text-neutral-500">Total credit</p><ArrowDownLeft className="size-4 text-neutral-400" /></div><p className="mt-2 text-2xl font-semibold tabular-nums">{money(totals.credit, account.currency)}</p><p className="mt-1 text-xs text-neutral-400">Money added to this account</p></div>
      <div className="rounded-2xl border bg-white p-5"><div className="flex items-center justify-between"><p className="text-sm text-neutral-500">Total debit</p><ArrowUpRight className="size-4 text-neutral-400" /></div><p className="mt-2 text-2xl font-semibold tabular-nums">{money(totals.debit, account.currency)}</p><p className="mt-1 text-xs text-neutral-400">Money deducted from this account</p></div>
      <div className="rounded-2xl border bg-white p-5"><div className="flex items-center justify-between"><p className="text-sm text-neutral-500">Current balance</p><Landmark className="size-4 text-neutral-400" /></div><p className="mt-2 text-2xl font-semibold tabular-nums">{money(account.current_balance, account.currency)}</p></div>
    </section> : null}

    <section className="overflow-hidden rounded-2xl border bg-white">
      <div className="flex flex-col gap-2 border-b p-5 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold">Account ledger</h2><p className="mt-1 text-sm text-neutral-500">Credit increases this account balance; debit reduces it. Running balance shows the balance after each transaction.</p></div><span className="text-sm text-neutral-400">{transactions.length} transaction{transactions.length === 1 ? "" : "s"}</span></div>
      <div className="overflow-x-auto"><table className="min-w-[1100px] w-full text-sm">
        <thead><tr className="border-b text-left text-xs uppercase tracking-wide text-neutral-400"><th className="px-4 py-3">Date</th><th className="px-4 py-3">Description</th><th className="px-4 py-3">Source</th><th className="px-4 py-3">Reference</th><th className="px-4 py-3 text-right">Debit</th><th className="px-4 py-3 text-right">Credit</th><th className="px-4 py-3 text-right">Balance</th></tr></thead>
        <tbody>{rows.map((item) => <tr key={item.id} className="border-b last:border-0"><td className="px-4 py-3 whitespace-nowrap">{item.transaction_date}</td><td className="px-4 py-3"><p className="font-medium">{item.description || prettySource(item.source_type)}</p><p className="mt-1 font-mono text-[11px] text-neutral-400">{item.source_id}</p></td><td className="px-4 py-3"><span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-600">{prettySource(item.source_type)}</span></td><td className="px-4 py-3">{item.reference || "—"}</td><td className="px-4 py-3 text-right font-medium tabular-nums">{item.direction === "debit" ? money(item.amount, item.currency) : "—"}</td><td className="px-4 py-3 text-right font-medium tabular-nums">{item.direction === "credit" ? money(item.amount, item.currency) : "—"}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{money(item.running_balance, item.currency)}</td></tr>)}</tbody>
      </table>{!rows.length && !error ? <div className="py-14 text-center"><p className="font-medium">No account transactions yet</p><p className="mt-1 text-sm text-neutral-400">Opening balance is shown above. New receipts, payments and transfers will appear here automatically.</p></div> : null}</div>
    </section>
  </div></main>;
}
