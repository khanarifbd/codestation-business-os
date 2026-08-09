"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, BookOpen, HandCoins, Landmark, Receipt, WalletCards } from "lucide-react";

import { AccountingNav } from "@/components/accounting-nav";

type FinancialAccount = { id: string; name: string; account_type: string; currency: string; current_balance: string; is_active: boolean };
type FinanceSummary = { invoice_count: number; overdue_count: number; payment_count: number; account_count: number; by_currency: Array<{ currency: string; invoiced: string; paid: string; outstanding: string }> };
type Loan = { id: string; currency: string; approved_amount: string; disbursed_amount: string; outstanding_principal: string; status: string };

function money(value: string | number, currency?: string) {
  const number = Number(value || 0);
  return `${currency ? `${currency} ` : ""}${number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const quickActions = [
  { title: "Money received", description: "Record customer payments and other incoming money.", href: "/dashboard/finance", icon: ArrowDownLeft },
  { title: "Pay an expense", description: "Record business costs paid from bank, cash or wallet.", href: "/dashboard/expenses", icon: ArrowUpRight },
  { title: "Transfer money", description: "Move money between your own financial accounts.", href: "/dashboard/finance/transfers", icon: ArrowLeftRight },
  { title: "Manage a loan", description: "Approve, receive and repay business loans safely.", href: "/dashboard/accounting/loans", icon: HandCoins },
];

export default function AccountingPage() {
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [accountsResponse, summaryResponse, loansResponse] = await Promise.all([
        fetch("/api/finance/accounts", { cache: "no-store" }),
        fetch("/api/finance/summary", { cache: "no-store" }),
        fetch("/api/accounting/loans", { cache: "no-store" }),
      ]);
      const [accountsPayload, summaryPayload, loansPayload] = await Promise.all([accountsResponse.json(), summaryResponse.json(), loansResponse.json()]);
      if (!accountsResponse.ok) throw new Error(accountsPayload.detail ?? "Could not load accounts");
      if (!summaryResponse.ok) throw new Error(summaryPayload.detail ?? "Could not load finance summary");
      if (!loansResponse.ok) throw new Error(loansPayload.detail ?? "Could not load loans");
      setAccounts(accountsPayload); setSummary(summaryPayload); setLoans(loansPayload);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load finance overview"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const accountTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const account of accounts.filter((item) => item.is_active)) totals.set(account.currency, (totals.get(account.currency) ?? 0) + Number(account.current_balance));
    return [...totals.entries()].map(([currency, value]) => ({ currency, value }));
  }, [accounts]);

  const loanTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const loan of loans) totals.set(loan.currency, (totals.get(loan.currency) ?? 0) + Number(loan.outstanding_principal));
    return [...totals.entries()].map(([currency, value]) => ({ currency, value }));
  }, [loans]);

  return <main className="p-4 sm:p-6 lg:p-8">
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Finance & Accounts</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Your business money, in one place</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">Use normal business actions here. CodeStation Business OS handles debit, credit and journals automatically in the background.</p>
        </div>
        <Link href="/dashboard/accounting/accounts" className="inline-flex items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white"><WalletCards className="size-4" />Manage accounts</Link>
      </div>

      <AccountingNav />
      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border bg-white p-5"><div className="flex items-center justify-between"><p className="text-sm text-neutral-500">Available money</p><Landmark className="size-5 text-neutral-400" /></div><div className="mt-4 space-y-1">{loading ? <p className="text-2xl font-semibold">—</p> : accountTotals.length ? accountTotals.map((item) => <p key={item.currency} className="text-2xl font-semibold tabular-nums">{money(item.value, item.currency)}</p>) : <p className="text-2xl font-semibold">0.00</p>}</div><p className="mt-2 text-xs text-neutral-400">Across active bank, cash and wallet accounts</p></div>
        <div className="rounded-2xl border bg-white p-5"><div className="flex items-center justify-between"><p className="text-sm text-neutral-500">Customers owe you</p><Receipt className="size-5 text-neutral-400" /></div><div className="mt-4 space-y-1">{summary?.by_currency.length ? summary.by_currency.map((item) => <p key={item.currency} className="text-2xl font-semibold tabular-nums">{money(item.outstanding, item.currency)}</p>) : <p className="text-2xl font-semibold">0.00</p>}</div><p className="mt-2 text-xs text-neutral-400">{summary?.overdue_count ?? 0} overdue invoice(s)</p></div>
        <div className="rounded-2xl border bg-white p-5"><div className="flex items-center justify-between"><p className="text-sm text-neutral-500">Loan outstanding</p><HandCoins className="size-5 text-neutral-400" /></div><div className="mt-4 space-y-1">{loanTotals.length ? loanTotals.map((item) => <p key={item.currency} className="text-2xl font-semibold tabular-nums">{money(item.value, item.currency)}</p>) : <p className="text-2xl font-semibold">0.00</p>}</div><p className="mt-2 text-xs text-neutral-400">Only money actually disbursed is counted</p></div>
        <div className="rounded-2xl border bg-white p-5"><div className="flex items-center justify-between"><p className="text-sm text-neutral-500">Financial accounts</p><WalletCards className="size-5 text-neutral-400" /></div><p className="mt-4 text-2xl font-semibold">{accounts.filter((item) => item.is_active).length}</p><p className="mt-2 text-xs text-neutral-400">Bank, cash, wallet, card and gateway accounts</p></div>
      </section>

      <section>
        <div className="mb-3"><h2 className="text-lg font-semibold">What do you want to do?</h2><p className="mt-1 text-sm text-neutral-500">Choose a business action. Accounting entries are created automatically.</p></div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{quickActions.map(({ title, description, href, icon: Icon }) => <Link key={title} href={href} className="group rounded-2xl border bg-white p-5 transition hover:-translate-y-0.5 hover:shadow-sm"><div className="flex size-10 items-center justify-center rounded-xl bg-neutral-100"><Icon className="size-5" /></div><h3 className="mt-4 font-semibold">{title}</h3><p className="mt-1 text-sm leading-5 text-neutral-500">{description}</p><p className="mt-4 text-sm font-medium">Open <span className="transition group-hover:ml-1">→</span></p></Link>)}</div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border bg-white p-5 lg:col-span-2"><div className="flex items-center justify-between"><div><h2 className="font-semibold">Account balances</h2><p className="mt-1 text-sm text-neutral-500">Where your business money is currently held.</p></div><Link href="/dashboard/accounting/accounts" className="text-sm font-medium">View all</Link></div><div className="mt-4 divide-y">{accounts.filter((item) => item.is_active).slice(0, 8).map((account) => <div key={account.id} className="flex items-center justify-between gap-4 py-3"><div><p className="font-medium">{account.name}</p><p className="text-xs capitalize text-neutral-400">{account.account_type.replaceAll("_", " ")}</p></div><p className="font-medium tabular-nums">{money(account.current_balance, account.currency)}</p></div>)}{!loading && accounts.length === 0 ? <p className="py-8 text-center text-sm text-neutral-400">No financial account yet.</p> : null}</div></div>
        <div className="rounded-2xl border bg-white p-5"><div className="flex items-center gap-2"><BookOpen className="size-5" /><h2 className="font-semibold">Advanced accounting</h2></div><p className="mt-2 text-sm leading-6 text-neutral-500">Chart of Accounts, journals, general ledger and trial balance are kept away from everyday workflows. Accountants and advanced users can still access everything.</p><Link href="/dashboard/accounting/advanced" className="mt-5 inline-flex rounded-xl border px-4 py-2 text-sm font-medium">Open advanced accounting</Link></div>
      </section>
    </div>
  </main>;
}
