"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CircleDollarSign,
  FileText,
  FolderKanban,
  Landmark,
  ReceiptText,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";

type TenantContext = {
  organization: {
    id: string;
    name: string;
    country_code: string;
    timezone: string;
    currency: string;
  };
  role: string;
};

type FinancialRow = {
  currency: string;
  invoiced_revenue: string;
  collected_revenue: string;
  receivables: string;
  expenses: string;
  platform_fees: string;
  transfer_fees: string;
  net_profit: string;
};

type TrendRow = {
  period: string;
  currency: string;
  invoiced_revenue: string;
  collected_revenue: string;
  expenses: string;
  transfer_fees: string;
  net_profit: string;
};

type AccountRow = {
  account_id: string;
  account_name: string;
  account_type: string;
  currency: string;
  balance: string;
};

type ProjectProfitRow = {
  project_id: string;
  project_number: string;
  project_name: string;
  client_name: string;
  currency: string;
  contract_value: string;
  invoiced_revenue: string;
  collected_revenue: string;
  direct_expenses: string;
  estimated_profit: string;
  margin_percent: string | null;
};

type ClientProfitRow = {
  client_id: string;
  client_name: string;
  currency: string;
  invoiced_revenue: string;
  collected_revenue: string;
  direct_expenses: string;
  estimated_profit: string;
  margin_percent: string | null;
};

type Overview = {
  date_from: string;
  date_to: string;
  financials: FinancialRow[];
  trend: TrendRow[];
  accounts: AccountRow[];
  operations: {
    active_clients: number;
    open_orders: number;
    active_projects: number;
    overdue_tasks: number;
    due_followups: number;
    open_invoices: number;
  };
  projects: ProjectProfitRow[];
  clients: ClientProfitRow[];
};

type CurrencyValue = {
  currency: string;
  amount: string | number;
};

type PipelineCurrencyValue = CurrencyValue & {
  weighted_amount: string | number;
};

type OrderPulse = {
  open_orders: number;
  values: CurrencyValue[];
};

type ProjectPulse = {
  active_projects: number;
  values: CurrencyValue[];
};

type CrmPulse = {
  open_leads: number;
  values: PipelineCurrencyValue[];
};

type FinancePulse = {
  open_invoices: number;
  overdue_invoices: number;
  outstanding: CurrencyValue[];
  overdue: CurrencyValue[];
};

type PeoplePulse = {
  active_employees: number;
  present_today: number;
  late_today: number;
  on_leave_today: number;
  pending_leave: number;
};

type Preset = "month" | "last_month" | "quarter" | "year";

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function presetRange(preset: Preset) {
  const now = new Date();
  if (preset === "last_month") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: iso(start), to: iso(end), label: "Last month" };
  }
  if (preset === "quarter") {
    const quarterStart = Math.floor(now.getMonth() / 3) * 3;
    return { from: iso(new Date(now.getFullYear(), quarterStart, 1)), to: iso(now), label: "This quarter" };
  }
  if (preset === "year") {
    return { from: iso(new Date(now.getFullYear(), 0, 1)), to: iso(now), label: "This year" };
  }
  return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now), label: "This month" };
}

function money(value: string | number, currency: string) {
  return `${currency} ${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function percent(value: string | null) {
  if (value == null) return "—";
  return `${Number(value).toFixed(1)}%`;
}

function periodLabel(value: string) {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric" }).format(new Date(year, month - 1, 1));
}

async function optionalPulse<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export default function DashboardPage() {
  const router = useRouter();
  const [tenant, setTenant] = useState<TenantContext | null>(null);
  const [data, setData] = useState<Overview | null>(null);
  const [orderPulse, setOrderPulse] = useState<OrderPulse | null>(null);
  const [projectPulse, setProjectPulse] = useState<ProjectPulse | null>(null);
  const [crmPulse, setCrmPulse] = useState<CrmPulse | null>(null);
  const [financePulse, setFinancePulse] = useState<FinancePulse | null>(null);
  const [peoplePulse, setPeoplePulse] = useState<PeoplePulse | null>(null);
  const [preset, setPreset] = useState<Preset>("month");
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const range = presetRange("month");
      try {
        let tenantResponse = await fetch("/api/tenant", { cache: "no-store" });
        if (tenantResponse.status === 401) {
          router.replace("/login");
          return;
        }

        if (tenantResponse.status === 404 || tenantResponse.status === 409) {
          const organizationsResponse = await fetch("/api/organizations", { cache: "no-store" });
          if (organizationsResponse.status === 401) {
            router.replace("/login");
            return;
          }
          const organizationsPayload = await organizationsResponse.json().catch(() => []);
          if (!organizationsResponse.ok) throw new Error("Unable to load company workspaces");
          if (!Array.isArray(organizationsPayload) || organizationsPayload.length === 0) {
            router.replace("/onboarding");
            return;
          }
          tenantResponse = await fetch("/api/tenant", { cache: "no-store" });
          if (tenantResponse.status === 401) {
            router.replace("/login");
            return;
          }
        }

        if (!tenantResponse.ok) throw new Error("Unable to load company workspace");
        setTenant((await tenantResponse.json()) as TenantContext);

        const params = new URLSearchParams({ date_from: range.from, date_to: range.to });
        const [reportResponse, nextOrderPulse, nextProjectPulse, nextCrmPulse, nextFinancePulse, nextPeoplePulse] = await Promise.all([
          fetch(`/api/reports/overview?${params}`, { cache: "no-store" }),
          optionalPulse<OrderPulse>("/api/dashboard-pulse/orders"),
          optionalPulse<ProjectPulse>("/api/dashboard-pulse/projects"),
          optionalPulse<CrmPulse>("/api/dashboard-pulse/crm"),
          optionalPulse<FinancePulse>("/api/dashboard-pulse/finance"),
          optionalPulse<PeoplePulse>("/api/dashboard-pulse/people"),
        ]);

        setOrderPulse(nextOrderPulse);
        setProjectPulse(nextProjectPulse);
        setCrmPulse(nextCrmPulse);
        setFinancePulse(nextFinancePulse);
        setPeoplePulse(nextPeoplePulse);

        if (reportResponse.status === 401) {
          router.replace("/login");
          return;
        }
        if (reportResponse.ok) setData((await reportResponse.json()) as Overview);
        else if (reportResponse.status !== 403) throw new Error("Unable to load dashboard metrics");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Unable to load dashboard");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  async function changePreset(next: Preset) {
    if (next === preset) return;
    const range = presetRange(next);
    setPreset(next);
    setReportLoading(true);
    setError(null);
    const params = new URLSearchParams({ date_from: range.from, date_to: range.to });
    try {
      const response = await fetch(`/api/reports/overview?${params}`, { cache: "no-store" });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok) throw new Error("Unable to load dashboard metrics");
      setData((await response.json()) as Overview);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load dashboard metrics");
    } finally {
      setReportLoading(false);
    }
  }

  const company = tenant?.organization;
  const rangeLabel = presetRange(preset).label;

  const financialRows = useMemo(() => {
    if (!data || !company) return [];
    return [...data.financials].sort((a, b) => {
      if (a.currency === company.currency) return -1;
      if (b.currency === company.currency) return 1;
      return a.currency.localeCompare(b.currency);
    });
  }, [data, company]);

  const trendGroups = useMemo(() => {
    if (!data || !company) return [] as Array<{ currency: string; rows: TrendRow[] }>;
    const grouped = new Map<string, TrendRow[]>();
    for (const row of data.trend) {
      const rows = grouped.get(row.currency) ?? [];
      rows.push(row);
      grouped.set(row.currency, rows);
    }
    return [...grouped.entries()]
      .map(([currency, rows]) => ({
        currency,
        rows: rows.sort((a, b) => a.period.localeCompare(b.period)).slice(-6),
      }))
      .sort((a, b) => {
        if (a.currency === company.currency) return -1;
        if (b.currency === company.currency) return 1;
        return a.currency.localeCompare(b.currency);
      });
  }, [data, company]);

  const weightedPipeline = useMemo<CurrencyValue[]>(() => (
    crmPulse?.values.map((row) => ({ currency: row.currency, amount: row.weighted_amount })) ?? []
  ), [crmPulse]);

  if (loading) {
    return (
      <main className="min-h-screen overflow-x-hidden bg-neutral-100 p-4 sm:p-8 lg:p-10">
        <div className="mx-auto max-w-[1500px] space-y-5">
          <div className="h-20 animate-pulse rounded-2xl bg-white" />
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-28 animate-pulse rounded-2xl bg-white sm:h-32" />)}
          </div>
          <div className="h-80 animate-pulse rounded-2xl bg-white" />
        </div>
      </main>
    );
  }

  if (!tenant || !company) {
    return <main className="p-4 text-sm text-red-700 sm:p-8">{error ?? "Workspace unavailable"}</main>;
  }

  if (!data) {
    return (
      <main className="min-h-screen overflow-x-hidden bg-neutral-100 p-4 sm:p-8 lg:p-10">
        <div className="mx-auto max-w-[1500px]">
          <h1 className="text-2xl font-semibold sm:text-3xl">{company.name}</h1>
          <div className="mt-5 rounded-2xl border bg-white p-5 sm:mt-6 sm:p-6">
            <p className="font-semibold">Employee workspace</p>
            <p className="mt-2 text-sm leading-6 text-neutral-500">Business financial reports are restricted by role permissions. Your project and task workspace remains available from Projects.</p>
            <Link href="/dashboard/projects" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold">Open projects <ArrowRight className="size-4" /></Link>
          </div>
        </div>
      </main>
    );
  }

  const hasPulse = Boolean(orderPulse || projectPulse || crmPulse || financePulse || peoplePulse);

  return (
    <main className="min-h-screen overflow-x-hidden bg-neutral-100 p-3 sm:p-8 lg:p-10">
      <div className="mx-auto max-w-[1500px]">
        <header className="rounded-2xl border bg-white p-4 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-400 sm:text-xs sm:tracking-[0.16em]">Business command center</p>
              <h1 className="mt-2 break-words text-2xl font-semibold tracking-tight sm:text-3xl">{company.name}</h1>
              <p className="mt-2 text-xs leading-5 text-neutral-500 sm:text-sm">{rangeLabel} · {data.date_from} — {data.date_to} · Reporting currency {company.currency}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
              <select value={preset} disabled={reportLoading} onChange={(event) => void changePreset(event.target.value as Preset)} className="h-11 min-w-0 w-full rounded-xl border bg-white px-3 text-sm font-medium outline-none transition focus:border-neutral-500 disabled:opacity-60 sm:w-auto">
                <option value="month">This month</option>
                <option value="last_month">Last month</option>
                <option value="quarter">This quarter</option>
                <option value="year">This year</option>
              </select>
              <Link href="/dashboard/reports" className="inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-xl bg-neutral-950 px-3 text-sm font-semibold text-white sm:px-4">
                <BarChart3 className="size-4 shrink-0" /><span className="truncate">Open reports</span>
              </Link>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:mt-5 lg:grid-cols-4">
            <WorkspaceLink href="/dashboard/orders/new" label="Create order" />
            <WorkspaceLink href="/dashboard/accounting/money-in" label="Receive money" />
            <WorkspaceLink href="/dashboard/accounting/money-out" label="Pay money" />
            <WorkspaceLink href="/dashboard/accounting/transfers" label="Transfer funds" />
          </div>
        </header>

        {reportLoading ? <div className="mt-3 h-0.5 overflow-hidden rounded-full bg-neutral-200"><div className="h-full w-1/3 animate-pulse bg-neutral-800" /></div> : null}
        {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

        <section className="mt-4 grid grid-cols-2 gap-3 sm:mt-5 sm:gap-4 xl:grid-cols-6">
          <MetricCard label="Active clients" value={data.operations.active_clients} note="Current client base" href="/dashboard/clients" icon={Users} />
          <MetricCard label="Open orders" value={data.operations.open_orders} note="Delivery not closed" href="/dashboard/orders" icon={ReceiptText} />
          <MetricCard label="Active projects" value={data.operations.active_projects} note="Planned, active or on hold" href="/dashboard/projects" icon={FolderKanban} />
          <MetricCard label="Open invoices" value={data.operations.open_invoices} note="Not paid or cancelled" href="/dashboard/accounting/invoices" icon={FileText} />
          <MetricCard label="Overdue tasks" value={data.operations.overdue_tasks} note="Past due and still open" href="/dashboard/projects" icon={AlertTriangle} attention />
          <MetricCard label="Due follow-ups" value={data.operations.due_followups} note="CRM follow-up required" href="/dashboard/crm" icon={TrendingUp} attention />
        </section>

        {hasPulse ? (
          <section className="mt-4 rounded-2xl border bg-white p-4 shadow-sm sm:mt-5 sm:p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
              <div>
                <p className="text-sm text-neutral-500">Right now</p>
                <h2 className="mt-1 text-lg font-semibold sm:text-xl">Current business pulse</h2>
                <p className="mt-1 text-xs leading-5 text-neutral-400">Order, project, pipeline and collection values stay in their original currencies. No cross-currency totals are combined.</p>
              </div>
            </div>

            <div className={`mt-4 grid gap-4 sm:mt-5 ${peoplePulse ? "xl:grid-cols-3" : "xl:grid-cols-2"}`}>
              {(orderPulse || projectPulse || crmPulse) ? (
                <PulseCard title="Sales & delivery" note="Commercial work currently in motion" href="/dashboard/orders" icon={ReceiptText}>
                  {orderPulse ? <PulseValueRow label="Open order value" count={orderPulse.open_orders} values={orderPulse.values} reportingCurrency={company.currency} /> : null}
                  {projectPulse ? <PulseValueRow label="Active project value" count={projectPulse.active_projects} values={projectPulse.values} reportingCurrency={company.currency} /> : null}
                  {crmPulse ? <PulseValueRow label="Open CRM pipeline" count={crmPulse.open_leads} values={crmPulse.values} reportingCurrency={company.currency} secondaryLabel="Probability weighted" secondaryValues={weightedPipeline} /> : null}
                </PulseCard>
              ) : null}

              {peoplePulse ? (
                <PulseCard title="People today" note="Today's workforce snapshot" href="/dashboard/hr" icon={Users}>
                  <div className="grid grid-cols-2 gap-2">
                    <PeopleStat label="Active employees" value={peoplePulse.active_employees} />
                    <PeopleStat label="Present today" value={peoplePulse.present_today} />
                    <PeopleStat label="On leave" value={peoplePulse.on_leave_today} />
                    <PeopleStat label="Pending leave" value={peoplePulse.pending_leave} attention={peoplePulse.pending_leave > 0} />
                  </div>
                  <div className="mt-3 flex items-center justify-between rounded-xl border bg-neutral-50 px-3 py-2.5 text-sm">
                    <span className="text-neutral-500">Late today</span>
                    <span className="font-semibold tabular-nums">{peoplePulse.late_today}</span>
                  </div>
                  <p className="mt-3 text-[11px] leading-4 text-neutral-400">Business OS does not infer absence from missing attendance records, so weekly-off or not-yet-recorded employees are not misclassified.</p>
                </PulseCard>
              ) : null}

              {financePulse ? (
                <PulseCard title="Collections" note="Current unpaid invoice position" href="/dashboard/accounting/receivables" icon={FileText}>
                  <PulseValueRow label="Outstanding" count={financePulse.open_invoices} values={financePulse.outstanding} reportingCurrency={company.currency} countLabel="open invoices" />
                  <PulseValueRow label="Overdue" count={financePulse.overdue_invoices} values={financePulse.overdue} reportingCurrency={company.currency} countLabel="overdue invoices" attention={financePulse.overdue_invoices > 0} />
                </PulseCard>
              ) : null}
            </div>
          </section>
        ) : null}

        <section className="mt-4 rounded-2xl border bg-white p-4 shadow-sm sm:mt-5 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm text-neutral-500">{rangeLabel}</p>
              <h2 className="mt-1 text-lg font-semibold sm:text-xl">Financial performance by currency</h2>
              <p className="mt-1 text-xs leading-5 text-neutral-400">Currencies are intentionally kept separate. No cross-currency totals are combined.</p>
            </div>
            <Link href="/dashboard/accounting/reports" className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-neutral-600 hover:text-neutral-950">Accounting reports <ArrowRight className="size-4" /></Link>
          </div>

          {financialRows.length ? (
            <div className="mt-4 grid gap-3 sm:mt-5 sm:gap-4 xl:grid-cols-2">
              {financialRows.map((row) => (
                <article key={row.currency} className="rounded-2xl border bg-neutral-50/60 p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold">{row.currency}</h3>
                        {row.currency === company.currency ? <span className="rounded-full border bg-white px-2 py-0.5 text-[11px] font-semibold text-neutral-500">Reporting currency</span> : null}
                      </div>
                      <p className="mt-1 text-xs text-neutral-400">Period performance</p>
                    </div>
                    <CircleDollarSign className="size-5 shrink-0 text-neutral-300" />
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-5">
                    <MoneyTile label="Invoiced" value={money(row.invoiced_revenue, row.currency)} />
                    <MoneyTile label="Collected" value={money(row.collected_revenue, row.currency)} />
                    <MoneyTile label="Receivable" value={money(row.receivables, row.currency)} />
                    <MoneyTile label="Expenses" value={money(row.expenses, row.currency)} />
                    <MoneyTile label="Net profit" value={money(row.net_profit, row.currency)} strong />
                  </div>
                  {(Number(row.platform_fees) !== 0 || Number(row.transfer_fees) !== 0) ? (
                    <div className="mt-3 flex flex-col gap-1 border-t pt-3 text-xs text-neutral-500 sm:flex-row sm:flex-wrap sm:gap-x-5">
                      <span>Platform fees: <strong className="font-semibold text-neutral-700">{money(row.platform_fees, row.currency)}</strong></span>
                      <span>Transfer fees: <strong className="font-semibold text-neutral-700">{money(row.transfer_fees, row.currency)}</strong></span>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          ) : <EmptyState title="No financial activity" note={`No posted financial activity for ${rangeLabel.toLowerCase()}.`} />}
        </section>

        <div className="mt-4 grid gap-4 sm:mt-5 sm:gap-5 xl:grid-cols-[0.72fr_1.28fr]">
          <section className="rounded-2xl border bg-white p-4 shadow-sm sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-neutral-500">Needs attention</p>
                <h2 className="mt-1 text-lg font-semibold sm:text-xl">Action queue</h2>
              </div>
              <AlertTriangle className="size-5 shrink-0 text-neutral-300" />
            </div>
            <div className="mt-4 space-y-2.5 sm:mt-5 sm:space-y-3">
              <AlertRow label="Overdue tasks" value={data.operations.overdue_tasks} href="/dashboard/projects" />
              <AlertRow label="Due CRM follow-ups" value={data.operations.due_followups} href="/dashboard/crm" />
              <AlertRow label="Open invoices" value={data.operations.open_invoices} href="/dashboard/accounting/invoices" />
            </div>
            {financialRows.some((row) => Number(row.receivables) > 0) ? (
              <div className="mt-5 border-t pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Period receivables</p>
                <div className="mt-3 space-y-2">
                  {financialRows.filter((row) => Number(row.receivables) > 0).map((row) => (
                    <Link key={row.currency} href="/dashboard/accounting/receivables" className="flex items-center justify-between gap-3 rounded-xl bg-neutral-50 px-3 py-2.5 text-sm hover:bg-neutral-100">
                      <span>{row.currency}</span><span className="break-all text-right font-semibold">{money(row.receivables, row.currency)}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          <section className="min-w-0 rounded-2xl border bg-white p-4 shadow-sm sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-neutral-500">Up to last 6 reporting periods</p>
                <h2 className="mt-1 text-lg font-semibold sm:text-xl">Performance trend</h2>
              </div>
              <TrendingUp className="size-5 shrink-0 text-neutral-300" />
            </div>
            {trendGroups.length ? (
              <div className="mt-4 grid min-w-0 gap-3 sm:mt-5 sm:gap-4 lg:grid-cols-2">
                {trendGroups.map((group) => (
                  <div key={group.currency} className="min-w-0 overflow-hidden rounded-xl border">
                    <div className="flex items-center justify-between gap-3 bg-neutral-50 px-4 py-3">
                      <span className="font-semibold">{group.currency}</span>
                      {group.currency === company.currency ? <span className="text-right text-[11px] font-medium text-neutral-400">Reporting currency</span> : null}
                    </div>
                    <div className="overflow-x-auto overscroll-x-contain">
                      <table className="w-full min-w-[460px] text-left text-xs sm:min-w-[500px]">
                        <thead className="border-y bg-white text-neutral-400"><tr><th className="px-4 py-2 font-medium">Period</th><th className="px-3 py-2 text-right font-medium">Invoiced</th><th className="px-3 py-2 text-right font-medium">Collected</th><th className="px-4 py-2 text-right font-medium">Net</th></tr></thead>
                        <tbody className="divide-y">
                          {group.rows.map((row) => <tr key={`${row.period}-${row.currency}`}><td className="px-4 py-2.5 font-medium">{periodLabel(row.period)}</td><td className="px-3 py-2.5 text-right tabular-nums">{money(row.invoiced_revenue, row.currency)}</td><td className="px-3 py-2.5 text-right tabular-nums">{money(row.collected_revenue, row.currency)}</td><td className="px-4 py-2.5 text-right font-semibold tabular-nums">{money(row.net_profit, row.currency)}</td></tr>)}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            ) : <EmptyState title="No trend yet" note="Trend data appears after invoices, payments or expenses are posted." />}
          </section>
        </div>

        <div className="mt-4 grid gap-4 sm:mt-5 sm:gap-5 xl:grid-cols-2">
          <section className="rounded-2xl border bg-white p-4 shadow-sm sm:p-6">
            <SectionHeading title="Financial accounts" note={`${data.accounts.length} active account${data.accounts.length === 1 ? "" : "s"}`} href="/dashboard/accounting/accounts" icon={Landmark} />
            {data.accounts.length ? (
              <div className="mt-4 divide-y">
                {data.accounts.slice(0, 8).map((row) => (
                  <Link key={row.account_id} href={`/dashboard/accounting/accounts/${row.account_id}`} className="flex flex-col items-start gap-2 py-3 text-sm hover:bg-neutral-50 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-2">
                    <div className="min-w-0"><p className="break-words font-medium sm:truncate">{row.account_name}</p><p className="mt-0.5 text-xs capitalize text-neutral-400">{row.account_type.replaceAll("_", " ")} · {row.currency}</p></div>
                    <p className="max-w-full break-all font-semibold tabular-nums sm:shrink-0 sm:text-right">{money(row.balance, row.currency)}</p>
                  </Link>
                ))}
              </div>
            ) : <EmptyState title="No financial accounts" note="Add bank, cash, wallet or gateway accounts to track real balances." />}
          </section>

          <section className="rounded-2xl border bg-white p-4 shadow-sm sm:p-6">
            <SectionHeading title="Recent project economics" note={`${rangeLabel} profitability`} href="/dashboard/reports" icon={FolderKanban} />
            {data.projects.length ? (
              <div className="mt-4 divide-y">
                {data.projects.slice(0, 6).map((row) => (
                  <Link key={row.project_id} href={`/dashboard/projects/${row.project_id}`} className="block py-3 hover:bg-neutral-50 sm:px-2">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <div className="min-w-0"><p className="break-words text-sm font-medium sm:truncate">{row.project_number} · {row.project_name}</p><p className="mt-0.5 break-words text-xs text-neutral-400 sm:truncate">{row.client_name}</p></div>
                      <div className="sm:shrink-0 sm:text-right"><p className="break-all text-sm font-semibold">{money(row.estimated_profit, row.currency)}</p><p className="mt-0.5 text-xs text-neutral-400">{percent(row.margin_percent)} margin</p></div>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-neutral-400 sm:flex sm:flex-wrap sm:gap-x-4"><span>Contract {money(row.contract_value, row.currency)}</span><span>Invoiced {money(row.invoiced_revenue, row.currency)}</span><span>Collected {money(row.collected_revenue, row.currency)}</span><span>Direct cost {money(row.direct_expenses, row.currency)}</span></div>
                  </Link>
                ))}
              </div>
            ) : <EmptyState title="No project economics yet" note="Project profitability appears as projects, invoices and direct expenses are recorded." />}
          </section>
        </div>

        <section className="mt-4 rounded-2xl border bg-white p-4 shadow-sm sm:mt-5 sm:p-6">
          <SectionHeading title="Client economics" note={`${rangeLabel} client performance`} href="/dashboard/clients" icon={Users} />
          {data.clients.length ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.clients.slice(0, 9).map((row) => (
                <Link key={`${row.client_id}-${row.currency}`} href={`/dashboard/clients/${row.client_id}`} className="rounded-xl border p-4 transition hover:border-neutral-300 hover:bg-neutral-50">
                  <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-words font-semibold sm:truncate">{row.client_name}</p><p className="mt-1 text-xs text-neutral-400">{row.currency} · {percent(row.margin_percent)} margin</p></div><ArrowRight className="size-4 shrink-0 text-neutral-300" /></div>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs"><ClientMetric label="Invoiced" value={money(row.invoiced_revenue, row.currency)} /><ClientMetric label="Collected" value={money(row.collected_revenue, row.currency)} /><ClientMetric label="Direct cost" value={money(row.direct_expenses, row.currency)} /><ClientMetric label="Est. profit" value={money(row.estimated_profit, row.currency)} strong /></div>
                </Link>
              ))}
            </div>
          ) : <EmptyState title="No client economics yet" note="Client profitability appears after commercial and financial activity is recorded." />}
        </section>
      </div>
    </main>
  );
}

function MetricCard({ label, value, note, href, icon: Icon, attention = false }: { label: string; value: number; note: string; href: string; icon: LucideIcon; attention?: boolean }) {
  return <Link href={href} className="group min-w-0 rounded-2xl border bg-white p-3.5 shadow-sm transition hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-md sm:p-4"><div className="flex items-start justify-between gap-2"><p className="min-w-0 text-xs leading-4 text-neutral-500 sm:text-sm">{label}</p><Icon className={`size-4 shrink-0 ${attention && value > 0 ? "text-amber-500" : "text-neutral-300"}`} /></div><p className="mt-3 text-2xl font-semibold tracking-tight sm:mt-4 sm:text-3xl">{value}</p><div className="mt-2 flex items-end justify-between gap-2"><p className="min-w-0 text-[11px] leading-4 text-neutral-400 sm:text-xs">{note}</p><ArrowRight className="size-3.5 shrink-0 text-neutral-300 transition group-hover:translate-x-0.5" /></div></Link>;
}

function PulseCard({ title, note, href, icon: Icon, children }: { title: string; note: string; href: string; icon: LucideIcon; children: React.ReactNode }) {
  return <article className="min-w-0 rounded-2xl border bg-neutral-50/60 p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="font-semibold">{title}</h3><p className="mt-1 text-xs leading-5 text-neutral-400">{note}</p></div><div className="flex items-center gap-2"><Icon className="size-5 shrink-0 text-neutral-300" /><Link href={href} className="text-xs font-semibold text-neutral-500 hover:text-neutral-950">View →</Link></div></div><div className="mt-4 divide-y rounded-xl border bg-white">{children}</div></article>;
}

function PulseValueRow({ label, count, values, reportingCurrency, countLabel = "active", secondaryLabel, secondaryValues, attention = false }: { label: string; count: number; values: CurrencyValue[]; reportingCurrency: string; countLabel?: string; secondaryLabel?: string; secondaryValues?: CurrencyValue[]; attention?: boolean }) {
  return <div className="p-3.5 sm:p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium text-neutral-700">{label}</p><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${attention ? "bg-amber-50 text-amber-700" : "bg-neutral-100 text-neutral-500"}`}>{count} {countLabel}</span></div><CurrencyChips values={values} reportingCurrency={reportingCurrency} /><div>{secondaryLabel && secondaryValues ? <div className="mt-2 flex flex-wrap items-center gap-2"><span className="text-[11px] text-neutral-400">{secondaryLabel}</span><CurrencyChips values={secondaryValues} reportingCurrency={reportingCurrency} compact /></div> : null}</div></div>;
}

function CurrencyChips({ values, reportingCurrency, compact = false }: { values: CurrencyValue[]; reportingCurrency: string; compact?: boolean }) {
  const sorted = [...values].filter((row) => Number(row.amount) !== 0).sort((a, b) => {
    if (a.currency === reportingCurrency) return -1;
    if (b.currency === reportingCurrency) return 1;
    return a.currency.localeCompare(b.currency);
  });
  if (!sorted.length) return compact ? <span className="text-[11px] text-neutral-400">No value</span> : <p className="mt-2 text-xs text-neutral-400">No recorded value</p>;
  return <div className={`${compact ? "contents" : "mt-2 flex flex-wrap gap-1.5"}`}>{sorted.map((row) => <span key={`${row.currency}-${row.amount}`} className={`whitespace-nowrap rounded-lg border bg-white font-semibold tabular-nums text-neutral-700 ${compact ? "px-2 py-1 text-[10px]" : "px-2.5 py-1.5 text-xs"}`}>{money(row.amount, row.currency)}</span>)}</div>;
}

function PeopleStat({ label, value, attention = false }: { label: string; value: number; attention?: boolean }) {
  return <div className={`rounded-xl border p-3 ${attention ? "border-amber-200 bg-amber-50" : "bg-white"}`}><p className="text-[11px] leading-4 text-neutral-400">{label}</p><p className={`mt-2 text-xl font-semibold tabular-nums ${attention ? "text-amber-800" : "text-neutral-950"}`}>{value}</p></div>;
}

function MoneyTile({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className={`min-w-0 rounded-xl px-3 py-3 ${strong ? "col-span-2 border bg-white sm:col-span-1" : "bg-white/80"}`}><p className="text-[11px] text-neutral-400">{label}</p><p className={`mt-1 break-all text-sm tabular-nums ${strong ? "font-semibold" : "font-medium"}`}>{value}</p></div>;
}

function ClientMetric({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className="min-w-0"><p className="text-neutral-400">{label}</p><p className={`mt-1 break-all tabular-nums ${strong ? "font-semibold text-neutral-950" : "font-medium text-neutral-700"}`}>{value}</p></div>;
}

function AlertRow({ label, value, href }: { label: string; value: number; href: string }) {
  return <Link href={href} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-3 transition hover:bg-neutral-50 sm:px-4"><div className="flex min-w-0 items-center gap-2.5 sm:gap-3"><AlertTriangle className={`size-4 shrink-0 ${value ? "text-amber-500" : "text-neutral-300"}`} /><span className="min-w-0 text-sm font-medium">{label}</span></div><div className="flex shrink-0 items-center gap-2"><span className="text-sm font-semibold">{value}</span><ArrowRight className="size-3.5 text-neutral-300" /></div></Link>;
}

function WorkspaceLink({ href, label }: { href: string; label: string }) {
  return <Link href={href} className="group flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-xl border bg-neutral-50 px-3 py-2.5 text-sm font-medium transition hover:bg-neutral-100"><span className="min-w-0 leading-4">{label}</span><ArrowRight className="size-3.5 shrink-0 text-neutral-300 transition group-hover:translate-x-0.5" /></Link>;
}

function SectionHeading({ title, note, href, icon: Icon }: { title: string; note: string; href: string; icon: LucideIcon }) {
  return <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3"><div className="min-w-0"><h2 className="font-semibold">{title}</h2><p className="mt-1 text-xs text-neutral-400">{note}</p></div><div className="flex items-center justify-between gap-3 sm:justify-end"><Icon className="size-5 shrink-0 text-neutral-300" /><Link href={href} className="text-xs font-semibold text-neutral-500 hover:text-neutral-950">View all →</Link></div></div>;
}

function EmptyState({ title, note }: { title: string; note: string }) {
  return <div className="mt-5 rounded-xl border border-dashed bg-neutral-50 px-4 py-7 text-center sm:py-8"><CircleDollarSign className="mx-auto size-6 text-neutral-300" /><p className="mt-3 text-sm font-medium">{title}</p><p className="mt-1 text-xs leading-5 text-neutral-400">{note}</p></div>;
}
