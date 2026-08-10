"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, BookOpen, Building2, HandCoins, Landmark, Receipt, WalletCards } from "lucide-react";

import { AccountingNav } from "@/components/accounting-nav";

type FinancialAccount = { id: string; name: string; account_type: string; currency: string; current_balance: string; is_active: boolean };
type FinanceSummary = { overdue_count: number; by_currency: Array<{ currency: string; outstanding: string }> };
type Loan = { id: string; currency: string; outstanding_principal: string };
type Payable = { id: string; currency: string; balance_due: string };
function money(value: string | number, currency?: string) { return `${currency ? `${currency} ` : ""}${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function grouped<T>(items: T[], currency: (item: T) => string, value: (item: T) => number) { const map = new Map<string, number>(); for (const item of items) map.set(currency(item), (map.get(currency(item)) ?? 0) + value(item)); return [...map.entries()]; }
const quickActions = [
  { title: "Money received", description: "Record income or other money that reached your account.", href: "/dashboard/accounting/money-in", icon: ArrowDownLeft },
  { title: "Money paid", description: "Record a business payment from bank, cash, wallet or card.", href: "/dashboard/accounting/money-out", icon: ArrowUpRight },
  { title: "Transfer money", description: "Move money between your own financial accounts.", href: "/dashboard/finance/transfers", icon: ArrowLeftRight },
  { title: "Manage a loan", description: "Record agreement, receive loan money and make repayments.", href: "/dashboard/accounting/loans", icon: HandCoins },
];

export default function AccountingPage() {
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]); const [summary, setSummary] = useState<FinanceSummary | null>(null); const [loans, setLoans] = useState<Loan[]>([]); const [payables, setPayables] = useState<Payable[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { setLoading(true); setError(null); try { const [a, s, l, p] = await Promise.all([fetch("/api/finance/accounts", { cache: "no-store" }), fetch("/api/finance/summary", { cache: "no-store" }), fetch("/api/accounting/loans", { cache: "no-store" }), fetch("/api/accounting/payables", { cache: "no-store" })]); const [ap, sp, lp, pp] = await Promise.all([a.json(), s.json(), l.json(), p.json()]); if (!a.ok) throw new Error(ap.detail ?? "Could not load accounts"); if (!s.ok) throw new Error(sp.detail ?? "Could not load receivables"); if (!l.ok) throw new Error(lp.detail ?? "Could not load loans"); if (!p.ok) throw new Error(pp.detail ?? "Could not load payables"); setAccounts(ap); setSummary(sp); setLoans(lp); setPayables(pp); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load finance overview"); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  const cashTotals = useMemo(() => grouped(accounts.filter((a) => a.is_active && a.account_type !== "credit_card"), (a) => a.currency, (a) => Number(a.current_balance)), [accounts]);
  const loanTotals = useMemo(() => grouped(loans, (l) => l.currency, (l) => Number(l.outstanding_principal)), [loans]);
  const payableTotals = useMemo(() => grouped(payables, (p) => p.currency, (p) => Number(p.balance_due)), [payables]);

  return <main className="p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-7xl space-y-6">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Finance & Accounts</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Your business money, in one place</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">Work with normal business actions. Business OS handles debit, credit, ledger entries and audit history automatically.</p></div><Link href="/dashboard/accounting/accounts" className="inline-flex items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white"><WalletCards className="size-4" />Manage accounts</Link></div>
    <AccountingNav />
    {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <SummaryCard icon={Landmark} label="Available money" values={cashTotals} help="Bank, cash, mobile wallet, gateway and petty cash" loading={loading} />
      <SummaryCard icon={Receipt} label="Customers owe you" values={(summary?.by_currency ?? []).map((item) => [item.currency, Number(item.outstanding)] as [string, number])} help={`${summary?.overdue_count ?? 0} overdue invoice(s)`} loading={loading} />
      <SummaryCard icon={Building2} label="You owe suppliers" values={payableTotals} help={`${payables.length} open vendor bill(s)`} loading={loading} />
      <SummaryCard icon={HandCoins} label="Loan principal due" values={loanTotals} help="Only disbursed principal is counted" loading={loading} />
    </section>

    <section><div className="mb-3"><h2 className="text-lg font-semibold">What do you want to do?</h2><p className="mt-1 text-sm text-neutral-500">Choose what happened in the real world. The accounting happens in the background.</p></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{quickActions.map(({ title, description, href, icon: Icon }) => <Link key={title} href={href} className="group rounded-2xl border bg-white p-5 transition hover:-translate-y-0.5 hover:shadow-sm"><div className="flex size-10 items-center justify-center rounded-xl bg-neutral-100"><Icon className="size-5" /></div><h3 className="mt-4 font-semibold">{title}</h3><p className="mt-1 text-sm leading-5 text-neutral-500">{description}</p><p className="mt-4 text-sm font-medium">Open <span className="transition group-hover:ml-1">→</span></p></Link>)}</div></section>

    <section className="grid gap-4 lg:grid-cols-3"><div className="rounded-2xl border bg-white p-5 lg:col-span-2"><div className="flex items-center justify-between"><div><h2 className="font-semibold">Where your money is</h2><p className="mt-1 text-sm text-neutral-500">Current balances of active financial accounts.</p></div><Link href="/dashboard/accounting/accounts" className="text-sm font-medium">View all</Link></div><div className="mt-4 divide-y">{accounts.filter((a) => a.is_active).slice(0, 8).map((account) => <div key={account.id} className="flex items-center justify-between gap-4 py-3"><div><p className="font-medium">{account.name}</p><p className="text-xs capitalize text-neutral-400">{account.account_type.replaceAll("_", " ")}{account.account_type === "credit_card" ? " · amount owed" : ""}</p></div><p className="font-medium tabular-nums">{money(account.current_balance, account.currency)}</p></div>)}{!loading && accounts.length === 0 ? <p className="py-8 text-center text-sm text-neutral-400">No financial account yet.</p> : null}</div></div><div className="rounded-2xl border bg-white p-5"><div className="flex items-center gap-2"><BookOpen className="size-5" /><h2 className="font-semibold">Advanced accounting</h2></div><p className="mt-2 text-sm leading-6 text-neutral-500">Chart of Accounts, trial balance and ledger tools stay available for accountants without confusing everyday users.</p><Link href="/dashboard/accounting/advanced" className="mt-5 inline-flex rounded-xl border px-4 py-2 text-sm font-medium">Open advanced accounting</Link></div></section>
  </div></main>;
}

function SummaryCard({ icon: Icon, label, values, help, loading }: { icon: typeof Landmark; label: string; values: Array<[string, number]>; help: string; loading: boolean }) { return <div className="rounded-2xl border bg-white p-5"><div className="flex items-center justify-between"><p className="text-sm text-neutral-500">{label}</p><Icon className="size-5 text-neutral-400" /></div><div className="mt-4 space-y-1">{loading ? <p className="text-2xl font-semibold">—</p> : values.length ? values.map(([currency, value]) => <p key={currency} className="text-2xl font-semibold tabular-nums">{money(value, currency)}</p>) : <p className="text-2xl font-semibold">0.00</p>}</div><p className="mt-2 text-xs text-neutral-400">{help}</p></div>; }
