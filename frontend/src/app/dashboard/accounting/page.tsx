"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Building2,
  HandCoins,
  Landmark,
  Receipt,
  ShieldCheck,
  WalletCards,
  type LucideIcon,
} from "lucide-react";

import { AccountingNav } from "@/components/accounting-nav";
import { AppPage, PageHeader, SectionHeader, Surface } from "@/components/ui/app-page";

type FinancialAccount = {
  id: string;
  name: string;
  account_type: string;
  currency: string;
  current_balance: string;
  is_active: boolean;
};

type FinanceSummary = {
  overdue_count: number;
  by_currency: Array<{ currency: string; outstanding: string }>;
};

type Loan = {
  id: string;
  currency: string;
  outstanding_principal: string;
};

type Payable = {
  id: string;
  currency: string;
  balance_due: string;
};

type QuickAction = {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  eyebrow: string;
};

function money(value: string | number, currency?: string) {
  return `${currency ? `${currency} ` : ""}${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function grouped<T>(items: T[], currency: (item: T) => string, value: (item: T) => number) {
  const map = new Map<string, number>();
  for (const item of items) {
    const code = currency(item);
    map.set(code, (map.get(code) ?? 0) + value(item));
  }
  return [...map.entries()].sort(([left], [right]) => left.localeCompare(right));
}

const quickActions: QuickAction[] = [
  {
    title: "Receive money",
    description: "Record business income or other money received into an account.",
    href: "/dashboard/accounting/money-in",
    icon: ArrowDownLeft,
    eyebrow: "Money in",
  },
  {
    title: "Pay money",
    description: "Record a payment from bank, cash, wallet, gateway or company card.",
    href: "/dashboard/accounting/money-out",
    icon: ArrowUpRight,
    eyebrow: "Money out",
  },
  {
    title: "Transfer funds",
    description: "Move money between your own financial accounts without creating income or expense.",
    href: "/dashboard/accounting/transfers",
    icon: ArrowLeftRight,
    eyebrow: "Internal transfer",
  },
  {
    title: "Manage loans",
    description: "Track loan agreements, disbursement, principal outstanding and repayments.",
    href: "/dashboard/accounting/loans",
    icon: HandCoins,
    eyebrow: "Liabilities",
  },
];

export default function AccountingPage() {
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [payables, setPayables] = useState<Payable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [accountsResponse, summaryResponse, loansResponse, payablesResponse] = await Promise.all([
        fetch("/api/finance/accounts", { cache: "no-store" }),
        fetch("/api/finance/summary", { cache: "no-store" }),
        fetch("/api/accounting/loans", { cache: "no-store" }),
        fetch("/api/accounting/payables", { cache: "no-store" }),
      ]);

      const [accountsPayload, summaryPayload, loansPayload, payablesPayload] = await Promise.all([
        accountsResponse.json(),
        summaryResponse.json(),
        loansResponse.json(),
        payablesResponse.json(),
      ]);

      if (!accountsResponse.ok) throw new Error(accountsPayload.detail ?? "Could not load accounts");
      if (!summaryResponse.ok) throw new Error(summaryPayload.detail ?? "Could not load receivables");
      if (!loansResponse.ok) throw new Error(loansPayload.detail ?? "Could not load loans");
      if (!payablesResponse.ok) throw new Error(payablesPayload.detail ?? "Could not load payables");

      setAccounts(accountsPayload);
      setSummary(summaryPayload);
      setLoans(loansPayload);
      setPayables(payablesPayload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load finance overview");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeAccounts = useMemo(() => accounts.filter((account) => account.is_active), [accounts]);
  const cashTotals = useMemo(
    () => grouped(activeAccounts.filter((account) => account.account_type !== "credit_card"), (account) => account.currency, (account) => Number(account.current_balance)),
    [activeAccounts],
  );
  const loanTotals = useMemo(
    () => grouped(loans, (loan) => loan.currency, (loan) => Number(loan.outstanding_principal)),
    [loans],
  );
  const payableTotals = useMemo(
    () => grouped(payables, (payable) => payable.currency, (payable) => Number(payable.balance_due)),
    [payables],
  );

  return (
    <AppPage width="wide">
      <PageHeader
        eyebrow="Finance workspace"
        title="Finance & Accounting"
        description="Run everyday money operations in business language while Business OS keeps the journal, ledger and audit trail consistent in the background."
        meta={
          <>
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-white px-2.5 py-1">
              <ShieldCheck className="size-3.5" /> Auditable transactions
            </span>
            <span className="rounded-full border bg-white px-2.5 py-1">Currencies stay separate unless explicitly converted</span>
          </>
        }
        actions={
          <Link
            href="/dashboard/accounting/accounts"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-800"
          >
            <WalletCards className="size-4" /> Manage accounts
          </Link>
        }
      />

      <div className="mt-6">
        <AccountingNav />
      </div>

      {error ? (
        <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      ) : null}

      <section className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          icon={Landmark}
          label="Available money"
          values={cashTotals}
          help="Bank, cash, wallet, gateway and petty cash"
          loading={loading}
        />
        <SummaryCard
          icon={Receipt}
          label="Customers owe you"
          values={(summary?.by_currency ?? []).map((item) => [item.currency, Number(item.outstanding)] as [string, number])}
          help={`${summary?.overdue_count ?? 0} overdue invoice${summary?.overdue_count === 1 ? "" : "s"}`}
          loading={loading}
        />
        <SummaryCard
          icon={Building2}
          label="You owe suppliers"
          values={payableTotals}
          help={`${payables.length} open vendor bill${payables.length === 1 ? "" : "s"}`}
          loading={loading}
        />
        <SummaryCard
          icon={HandCoins}
          label="Loan principal due"
          values={loanTotals}
          help="Principal only; revenue is never inflated by borrowing"
          loading={loading}
        />
      </section>

      <section className="mt-8">
        <SectionHeader
          title="What happened in the business?"
          description="Choose the real-world action. Business OS applies the accounting treatment behind the workflow."
        />
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {quickActions.map(({ title, description, href, icon: Icon, eyebrow }) => (
            <Link
              key={title}
              href={href}
              className="group rounded-2xl border border-neutral-200/90 bg-white p-5 transition hover:border-neutral-300 hover:shadow-[0_8px_24px_rgba(0,0,0,0.05)]"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex size-10 items-center justify-center rounded-xl bg-neutral-100 text-neutral-700">
                  <Icon className="size-5" />
                </div>
                <ArrowRight className="mt-1 size-4 text-neutral-300 transition group-hover:translate-x-0.5 group-hover:text-neutral-500" />
              </div>
              <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-400">{eyebrow}</p>
              <h3 className="mt-1.5 text-[15px] font-semibold">{title}</h3>
              <p className="mt-1.5 text-sm leading-5 text-neutral-500">{description}</p>
            </Link>
          ))}
        </div>
      </section>

      <div className="mt-8 grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(280px,.7fr)]">
        <Surface className="overflow-hidden">
          <div className="border-b border-neutral-100 p-5 sm:px-6">
            <SectionHeader
              title="Where your money is"
              description="Current balances from active financial accounts. Each account keeps its own currency."
              action={
                <Link href="/dashboard/accounting/accounts" className="inline-flex items-center gap-1.5 text-sm font-semibold text-neutral-600 hover:text-neutral-950">
                  View all <ArrowRight className="size-3.5" />
                </Link>
              }
            />
          </div>
          <div className="divide-y divide-neutral-100 px-5 sm:px-6">
            {activeAccounts.slice(0, 8).map((account) => (
              <Link
                key={account.id}
                href={`/dashboard/accounting/accounts/${account.id}`}
                className="flex items-center justify-between gap-5 py-4 transition hover:bg-neutral-50/70"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-neutral-800">{account.name}</p>
                  <p className="mt-1 text-xs capitalize text-neutral-400">
                    {account.account_type.replaceAll("_", " ")}
                    {account.account_type === "credit_card" ? " · amount owed" : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-semibold tabular-nums text-neutral-900">{money(account.current_balance, account.currency)}</p>
                  <p className="mt-1 text-[11px] text-neutral-400">{account.currency}</p>
                </div>
              </Link>
            ))}
            {!loading && activeAccounts.length === 0 ? (
              <div className="py-12 text-center">
                <WalletCards className="mx-auto size-7 text-neutral-300" />
                <p className="mt-3 text-sm font-semibold">No financial account yet</p>
                <p className="mt-1 text-sm text-neutral-400">Add a bank, cash, wallet or gateway account to start tracking money.</p>
              </div>
            ) : null}
          </div>
        </Surface>

        <Surface className="p-5 sm:p-6">
          <div className="flex size-10 items-center justify-center rounded-xl bg-neutral-950 text-white">
            <BookOpen className="size-5" />
          </div>
          <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-400">For accountants</p>
          <h2 className="mt-1.5 text-lg font-semibold tracking-tight">Accounting controls</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-500">
            Use Chart of Accounts, journal, ledger and trial balance when you need the accounting layer directly. Everyday users can stay in operational workflows.
          </p>
          <Link
            href="/dashboard/accounting/advanced"
            className="mt-6 inline-flex h-10 items-center gap-2 rounded-xl border border-neutral-200 px-4 text-sm font-semibold text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50"
          >
            Open accounting tools <ArrowRight className="size-4" />
          </Link>
        </Surface>
      </div>
    </AppPage>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  values,
  help,
  loading,
}: {
  icon: LucideIcon;
  label: string;
  values: Array<[string, number]>;
  help: string;
  loading: boolean;
}) {
  return (
    <article className="rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-medium text-neutral-500">{label}</p>
        <span className="flex size-9 items-center justify-center rounded-xl bg-neutral-100 text-neutral-500">
          <Icon className="size-4" />
        </span>
      </div>
      <div className="mt-5 space-y-1.5">
        {loading ? (
          <div className="h-8 w-28 animate-pulse rounded-lg bg-neutral-100" />
        ) : values.length ? (
          values.map(([currency, value]) => (
            <p key={currency} className="text-2xl font-semibold tracking-[-0.02em] tabular-nums">
              {money(value, currency)}
            </p>
          ))
        ) : (
          <p className="text-2xl font-semibold tracking-[-0.02em]">0.00</p>
        )}
      </div>
      <p className="mt-3 text-xs leading-5 text-neutral-400">{help}</p>
    </article>
  );
}
