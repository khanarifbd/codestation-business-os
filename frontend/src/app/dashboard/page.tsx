"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  CircleDollarSign,
  FileText,
  FolderKanban,
  Landmark,
  ReceiptText,
  Users,
  type LucideIcon,
} from "lucide-react";

import { formatDashboardMoney } from "@/lib/dashboard-reporting";
import { dashboardDateShortcut, validateDashboardDateRange, type DashboardDatePreset, type DashboardDateRange } from "@/lib/dashboard-date-range";
import { DashboardDateFilter } from "@/components/dashboard/dashboard-date-filter";

import { useDashboardSession } from "@/components/dashboard-session-context";
import { useAdministrationReadOwner } from "@/hooks/use-administration-read-owner";
import { FinancialPerformanceCard } from "@/components/dashboard/financial-insights";
import { DashboardTrendExplorer } from "@/components/dashboard/dashboard-trend-explorer";
import "@/components/dashboard/dashboard-composition.css";
import "@/components/dashboard/dashboard-design-a.css";
import { OperationalReportingNote } from "@/components/dashboard/operational-reporting-note";
import { AppPage, PageHeader, SectionHeader, Surface } from "@/components/ui/app-page";

type FinancialRow = {
  currency: string;
  invoiced_revenue: string;
  direct_income: string;
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
  direct_income: string;
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
  direct_income: string;
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
  direct_income: string;
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

type DashboardDetails = {
  accounts: AccountRow[];
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

type DashboardPulseOverview = {
  orders: OrderPulse | null;
  projects: ProjectPulse | null;
  crm: CrmPulse | null;
  finance: FinancePulse | null;
  people: PeoplePulse | null;
};

type Preset = DashboardDatePreset;

function presetRange(preset: Exclude<Preset, "custom">, timezone?: string) {
  return dashboardDateShortcut(preset, timezone);
}

function money(value: string | number, currency: string) {
  return formatDashboardMoney(value, currency);
}

function percent(value: string | null) {
  if (value == null) return "—";
  return `${Number(value).toFixed(1)}%`;
}

export default function DashboardPage() {
  const router = useRouter();
  const { tenant } = useDashboardSession();
  const owns = useAdministrationReadOwner().current;
  const activeOrganizationId = tenant?.organization.id;
  const [reportResult, setReportResult] = useState<{ organizationId: string; value: Overview } | null>(null);
  const data = reportResult && reportResult.organizationId === activeOrganizationId ? reportResult.value : null;
  const [detailsResult, setDetails] = useState<{ organizationId: string; from: string; to: string; value: DashboardDetails } | null>(null);
  const details = detailsResult && detailsResult.organizationId === activeOrganizationId &&
    detailsResult.from === data?.date_from && detailsResult.to === data?.date_to ? detailsResult.value : null;
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState(false);
  const [pulseOrganizationId, setPulseOrganizationId] = useState<string | null>(null);
  const [rawOrderPulse, setOrderPulse] = useState<OrderPulse | null>(null);
  const [rawProjectPulse, setProjectPulse] = useState<ProjectPulse | null>(null);
  const [rawCrmPulse, setCrmPulse] = useState<CrmPulse | null>(null);
  const [rawFinancePulse, setFinancePulse] = useState<FinancePulse | null>(null);
  const [rawPeoplePulse, setPeoplePulse] = useState<PeoplePulse | null>(null);
  const pulseMatchesTenant = pulseOrganizationId === activeOrganizationId;
  const orderPulse = pulseMatchesTenant ? rawOrderPulse : null;
  const projectPulse = pulseMatchesTenant ? rawProjectPulse : null;
  const crmPulse = pulseMatchesTenant ? rawCrmPulse : null;
  const financePulse = pulseMatchesTenant ? rawFinancePulse : null;
  const peoplePulse = pulseMatchesTenant ? rawPeoplePulse : null;
  const [preset, setPreset] = useState<Preset>("month");
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportRetry, setReportRetry] = useState(0);
  const [detailsRetry, setDetailsRetry] = useState(0);
  const reportEpoch = useRef(0);
  const rangeRequest = useRef<number | null>(null);

  useEffect(() => {
    if (!tenant || !owns()) return;
    let active = true;
    reportEpoch.current += 1;
    rangeRequest.current = null;
    void (async () => {
      const range = presetRange("month", tenant.organization.timezone);
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ date_from: range.from, date_to: range.to });
        const response = await fetch(`/api/reports/dashboard?${params}`, { cache: "no-store" });
        if (!active || !owns()) return;
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (response.ok) {
          const payload = (await response.json()) as Overview;
          if (active && owns()) {
            if (payload.date_from !== range.from || payload.date_to !== range.to) throw new Error("Dashboard response did not match the requested dates. Please retry.");
            setReportResult({ organizationId: tenant.organization.id, value: payload });
            setPreset("month");
          }
        } else if (response.status === 403) {
          setReportResult(null);
          setPreset("month");
        } else throw new Error("Unable to load dashboard metrics");
      } catch (reason) {
        if (active && owns()) {
          setReportResult(null);
          setError(reason instanceof Error ? reason.message : "Unable to load dashboard");
        }
      } finally {
        if (active && owns()) { setLoading(false); setReportLoading(false); }
      }
    })();
    return () => { active = false; reportEpoch.current += 1; rangeRequest.current = null; };
  }, [router, tenant, reportRetry, owns]);

  useEffect(() => {
    if (!tenant || !owns()) return;
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/dashboard-pulse/overview", { cache: "no-store" });
        if (!active || !owns() || !response.ok) return;
        const pulse = (await response.json()) as DashboardPulseOverview;
        if (!active || !owns()) return;
        setOrderPulse(pulse.orders);
        setProjectPulse(pulse.projects);
        setCrmPulse(pulse.crm);
        setFinancePulse(pulse.finance);
        setPeoplePulse(pulse.people);
        setPulseOrganizationId(tenant.organization.id);
      } catch {
        // Pulse cards are supplementary; the primary dashboard report remains usable.
      }
    })();
    return () => { active = false; };
  }, [tenant, owns]);

  const periodStart = data?.date_from;
  const periodEnd = data?.date_to;

  useEffect(() => {
    if (!activeOrganizationId || !periodStart || !periodEnd || !owns()) return;
    const controller = new AbortController();
    setDetails(null);
    setDetailsLoading(true);
    setDetailsError(false);
    void (async () => {
      try {
        const params = new URLSearchParams({ date_from: periodStart, date_to: periodEnd });
        const response = await fetch(`/api/reports/dashboard-details?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.status === 401) {
          if (!controller.signal.aborted && owns()) router.replace("/login");
          return;
        }
        if (response.status === 403) {
          if (!controller.signal.aborted && owns()) {
            reportEpoch.current += 1;
            setReportResult(null);
            setError(null);
            setReportLoading(false);
          }
          return;
        }
        if (!response.ok) throw new Error("Dashboard details unavailable");
        const payload = (await response.json()) as DashboardDetails;
        if (!controller.signal.aborted && owns()) {
          setDetails({ organizationId: activeOrganizationId, from: periodStart, to: periodEnd, value: payload });
        }
      } catch {
        if (!controller.signal.aborted && owns()) setDetailsError(true);
      } finally {
        if (!controller.signal.aborted && owns()) setDetailsLoading(false);
      }
    })();
    return () => controller.abort();
  }, [activeOrganizationId, periodStart, periodEnd, router, detailsRetry, owns]);

  async function changeDateRange(range: DashboardDateRange, next: Preset = "custom") {
    if (!tenant || !owns() || rangeRequest.current !== null) return;
    const issue = validateDashboardDateRange(range, tenant.organization.timezone);
    if (issue) { setError(issue); return; }
    if (data?.date_from === range.from && data.date_to === range.to) { setPreset(next); setError(null); return; }
    const organizationId = tenant.organization.id;
    const requestEpoch = ++reportEpoch.current;
    rangeRequest.current = requestEpoch;
    const currentRequest = () => owns() && reportEpoch.current === requestEpoch;
    setReportLoading(true);
    setError(null);
    const params = new URLSearchParams({ date_from: range.from, date_to: range.to });
    try {
      const response = await fetch(`/api/reports/dashboard?${params}`, { cache: "no-store" });
      if (!currentRequest()) return;
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (response.status === 403) {
        setReportResult(null);
        setError(null);
        return;
      }
      if (!response.ok) throw new Error("Unable to load dashboard metrics");
      const payload = (await response.json()) as Overview;
      if (!currentRequest()) return;
      if (payload.date_from !== range.from || payload.date_to !== range.to) throw new Error("Dashboard response did not match the requested dates. Please retry.");
      setReportResult({ organizationId, value: payload });
      setPreset(next);
    } catch (reason) {
      if (currentRequest()) setError(reason instanceof Error ? reason.message : "Unable to load dashboard metrics");
    } finally {
      if (currentRequest()) { rangeRequest.current = null; setReportLoading(false); }
    }
  }

  async function changePreset(next: Exclude<Preset, "custom">) {
    if (!tenant) return;
    await changeDateRange(presetRange(next, tenant.organization.timezone), next);
  }

  const company = tenant?.organization;
  const rangeLabel = preset === "custom" ? "Custom range" : presetRange(preset, company?.timezone).label;

  const financialRows = useMemo(() => {
    if (!data || !company) return [];
    return [...data.financials].sort((a, b) => {
      if (a.currency === company.currency) return -1;
      if (b.currency === company.currency) return 1;
      return a.currency.localeCompare(b.currency);
    });
  }, [data, company]);

  const weightedPipeline = useMemo<CurrencyValue[]>(() => (
    crmPulse?.values.map((row) => ({ currency: row.currency, amount: row.weighted_amount })) ?? []
  ), [crmPulse]);

  if (loading || (reportResult !== null && reportResult.organizationId !== activeOrganizationId)) {
    return (
      <AppPage width="wide" className="dashboard-overview dashboard-composed">
        <div className="space-y-5" role="status" aria-label="Loading dashboard">
          <div className="h-28 animate-pulse rounded-2xl bg-white" />
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-28 animate-pulse rounded-2xl bg-white" />)}
          </div>
          <div className="h-80 animate-pulse rounded-2xl bg-white" />
        </div>
      </AppPage>
    );
  }

  if (!tenant || !company) {
    return <AppPage width="wide" className="dashboard-overview dashboard-composed"><p className="text-sm text-red-700">{error ?? "Workspace unavailable"}</p></AppPage>;
  }

  if (!data && error) {
    return (
      <AppPage width="wide" className="dashboard-overview dashboard-composed">
        <PageHeader eyebrow={company.name} title="Dashboard unavailable" description="Dashboard reports could not be loaded. Retry to reconnect to the reporting service." />
        <Surface className="mt-6 p-5 sm:p-6">
          <p role="alert" className="text-sm text-red-700">{error}</p>
          <button type="button" onClick={() => setReportRetry((value) => value + 1)} className="mt-4 inline-flex min-h-10 items-center rounded-lg bg-neutral-950 px-4 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2">Retry dashboard</button>
        </Surface>
      </AppPage>
    );
  }

  if (!data) {
    return (
      <AppPage width="wide" className="dashboard-overview dashboard-composed">
        <div className="space-y-6">
          <PageHeader eyebrow="Business OS" title={company.name} description="Your role has access to operational workspaces, but financial reporting is restricted." />
          <Surface className="p-5 sm:p-6">
            <SectionHeader title="Employee workspace" description="Open Projects to continue with your assigned delivery and task work." />
            <Link prefetch={false} href="/dashboard/projects" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-neutral-800 hover:text-neutral-950">Open projects <ArrowRight className="size-4" /></Link>
          </Surface>
        </div>
      </AppPage>
    );
  }

  const hasPulse = Boolean(orderPulse || projectPulse || crmPulse || financePulse || peoplePulse);

  return (
    <AppPage width="wide" className="dashboard-overview dashboard-composed">
      <div className="dashboard-composition">
        <PageHeader
          className="dashboard-heading"
          eyebrow={company.name}
          title="Business overview"
          description="A clear view of what needs attention and how the business is performing."
          meta={
            <>
              <span className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-neutral-600">{rangeLabel} · {data.date_from} — {data.date_to}</span>
              <span className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-neutral-600">Reporting currency · {company.currency}</span>
              <span className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-neutral-600">Company timezone · {company.timezone || "UTC"}</span>
            </>
          }
          actions={
            <>
              <Link prefetch={false} href="/dashboard/reports" className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-neutral-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2">
                <BarChart3 className="size-4" /> Open reports
              </Link>
            </>
          }
        />

        {reportLoading ? <div role="status" aria-label="Updating dashboard reports" className="h-0.5 overflow-hidden rounded-full bg-neutral-200"><div className="h-full w-1/3 animate-pulse bg-neutral-800" /></div> : null}
        {error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

        <section aria-label="Key business metrics" className="dashboard-operations-rail">
          <MetricCard label="Active clients" value={data.operations.active_clients} note="Current client base" href="/dashboard/clients" icon={Users} />
          <MetricCard label="Open orders" value={data.operations.open_orders} note="Delivery not closed" href="/dashboard/orders" icon={ReceiptText} />
          <MetricCard label="Active projects" value={data.operations.active_projects} note="Planned, active or on hold" href="/dashboard/projects" icon={FolderKanban} />
          <MetricCard label="Open invoices" value={data.operations.open_invoices} note="Not paid or cancelled" href="/dashboard/accounting/invoices" icon={FileText} />
        </section>

        <div className="dashboard-decision-grid">
          <Surface className="dashboard-trend-focus">
            <DashboardTrendExplorer organizationId={activeOrganizationId ?? ""} dateFrom={data.date_from} dateTo={data.date_to} timezone={company.timezone ?? "UTC"} reportingCurrency={company.currency} enabled={!reportLoading} filters={<DashboardDateFilter key={`${activeOrganizationId}:${data.date_from}:${data.date_to}`} from={data.date_from} to={data.date_to} timezone={company.timezone ?? "UTC"} preset={preset} busy={reportLoading} onRange={(range) => void changeDateRange(range)} onPreset={(next) => void changePreset(next)} />} />
          </Surface>
          <aside className="dashboard-attention-column" aria-label="Priority work and quick entry">
            <Surface className="dashboard-priority-work">
              <SectionHeader title="Needs attention" description="Follow up, resolve and collect." />
              <div className="dashboard-priority-list">
                <AlertRow label="Overdue tasks" value={data.operations.overdue_tasks} href="/dashboard/projects" />
                <AlertRow label="Due CRM follow-ups" value={data.operations.due_followups} href="/dashboard/crm" />
                {financePulse ? <div className="dashboard-overdue-collection">
                  <AlertRow label="Overdue invoices" value={financePulse.overdue_invoices} href="/dashboard/accounting/receivables" />
                  <div className="dashboard-current-overdue"><span>Current overdue balances</span><CurrencyChips values={financePulse.overdue} reportingCurrency={company.currency} compact /></div>
                </div> : null}
              </div>
            </Surface>
        <Surface className="dashboard-context-actions">
          <SectionHeader title="Quick entry" description="Create and record transactions." />
          <div className="dashboard-action-list">
            <WorkspaceLink href="/dashboard/orders/new" label="Create order" icon={ReceiptText} />
            <WorkspaceLink href="/dashboard/accounting/money-in" label="Receive money" icon={ArrowDownLeft} />
            <WorkspaceLink href="/dashboard/accounting/money-out" label="Pay money" icon={ArrowUpRight} />
            <WorkspaceLink href="/dashboard/accounting/transfers" label="Transfer funds" icon={ArrowLeftRight} />
          </div>
        </Surface>

          </aside>
        </div>

        <Surface className="dashboard-financials p-5 sm:p-6">
          <SectionHeader
            title="Period financials"
            description={`${rangeLabel} · Each currency has its own ledger. No cross-currency total is combined.`}
            action={<Link prefetch={false} href="/dashboard/accounting/reports" className="inline-flex items-center gap-1.5 text-sm font-semibold text-neutral-600 hover:text-neutral-950">Accounting reports <ArrowRight className="size-4" /></Link>}
          />
          {financialRows.length ? (
            <div className="dashboard-ledger-rows">
              {financialRows.map((row) => (
                <FinancialPerformanceCard key={row.currency} row={row} reportingCurrency={company.currency} formatMoney={money} />
              ))}
            </div>
          ) : <EmptyState title="No financial activity" note={`No posted financial activity for ${rangeLabel.toLowerCase()}.`} />}
            {financialRows.some((row) => Number(row.receivables) > 0) ? (
              <div className="dashboard-receivable-links">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Period receivables</p>
                <div className="dashboard-receivable-link-list">
                  {financialRows.filter((row) => Number(row.receivables) > 0).map((row) => (
                    <Link prefetch={false} key={row.currency} href="/dashboard/accounting/receivables" className="flex items-center justify-between gap-3 rounded-xl bg-neutral-50 px-3 py-2.5 text-sm hover:bg-neutral-100">
                      <span>{row.currency}</span><span className="break-all text-right font-semibold">{money(row.receivables, row.currency)}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
          <details className="dashboard-calculation-note"><summary><span>Operational margin is not accrual net profit.</span> How these figures are calculated</summary><OperationalReportingNote /></details>
        </Surface>


        {hasPulse ? (
          <Surface className="dashboard-secondary-pulse p-5 sm:p-6">
            <SectionHeader
              title="Current business pulse"
              description="Order, project, pipeline and collection values stay in their original currencies. No cross-currency totals are combined."
            />
            <div className={`mt-5 grid gap-4 ${peoplePulse ? "xl:grid-cols-3" : "xl:grid-cols-2"}`}>
              {(orderPulse || projectPulse || crmPulse) ? (
                <PulseCard title="Sales & delivery" note="Commercial work currently in motion" href="/dashboard/orders" icon={ReceiptText}>
                  {orderPulse ? <PulseValueRow label="Open order value" count={orderPulse.open_orders} values={orderPulse.values} reportingCurrency={company.currency} /> : null}
                  {projectPulse ? <PulseValueRow label="Active project value" count={projectPulse.active_projects} values={projectPulse.values} reportingCurrency={company.currency} /> : null}
                  {crmPulse ? <PulseValueRow label="Open CRM pipeline" count={crmPulse.open_leads} values={crmPulse.values} reportingCurrency={company.currency} secondaryLabel="Probability weighted" secondaryValues={weightedPipeline} /> : null}
                </PulseCard>
              ) : null}

              {peoplePulse ? (
                <PulseCard title="People today" note="Today's workforce snapshot" href="/dashboard/hr" icon={Users}>
                  <div className="grid grid-cols-2 gap-2 p-3.5 sm:p-4">
                    <PeopleStat label="Active employees" value={peoplePulse.active_employees} />
                    <PeopleStat label="Present today" value={peoplePulse.present_today} />
                    <PeopleStat label="On leave" value={peoplePulse.on_leave_today} />
                    <PeopleStat label="Pending leave" value={peoplePulse.pending_leave} attention={peoplePulse.pending_leave > 0} />
                  </div>
                  <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
                    <span className="text-neutral-500">Late today</span>
                    <span className="font-semibold tabular-nums">{peoplePulse.late_today}</span>
                  </div>
                </PulseCard>
              ) : null}

              {financePulse ? (
                <PulseCard title="Collections" note="Current unpaid invoice position" href="/dashboard/accounting/receivables" icon={FileText}>
                  <PulseValueRow label="Outstanding" count={financePulse.open_invoices} values={financePulse.outstanding} reportingCurrency={company.currency} countLabel="open invoices" />
                  <PulseValueRow label="Overdue" count={financePulse.overdue_invoices} values={financePulse.overdue} reportingCurrency={company.currency} countLabel="overdue invoices" attention={financePulse.overdue_invoices > 0} />
                </PulseCard>
              ) : null}
            </div>
          </Surface>
        ) : null}



        <div className="dashboard-economics-grid grid gap-5 xl:grid-cols-2">
          <Surface className="p-5 sm:p-6">
            <SectionHeading title="Financial accounts" note={details ? `${details.accounts.length} active account${details.accounts.length === 1 ? "" : "s"}` : "Account balances"} href="/dashboard/accounting/accounts" icon={Landmark} />
            {detailsError ? <DetailUnavailable onRetry={() => setDetailsRetry((value) => value + 1)} /> : detailsLoading || !details ? <DetailPlaceholder /> : details.accounts.length ? (
              <div className="mt-4 divide-y">
                {details.accounts.slice(0, 8).map((row) => (
                  <Link prefetch={false} key={row.account_id} href={`/dashboard/accounting/accounts/${row.account_id}`} className="group -mx-2 flex flex-col items-start gap-2 rounded-lg px-2 py-3.5 text-sm transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                    <div className="flex min-w-0 items-center gap-3"><span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600"><Landmark className="size-4" /></span><div className="min-w-0"><p className="break-words font-semibold text-neutral-800 sm:truncate">{row.account_name}</p><p className="mt-1 text-xs capitalize text-neutral-500">{row.account_type.replaceAll("_", " ")} · {row.currency}</p></div></div>
                    <p className="max-w-full break-all font-semibold tabular-nums sm:shrink-0 sm:text-right">{money(row.balance, row.currency)}</p>
                  </Link>
                ))}
              </div>
            ) : <EmptyState title="No financial accounts" note="Add bank, cash, wallet or gateway accounts to track real balances." />}
          </Surface>

          <Surface className="p-5 sm:p-6">
            <SectionHeading title="Recent project economics" note={`${rangeLabel} profitability`} href="/dashboard/reports" icon={FolderKanban} />
            {detailsError ? <DetailUnavailable onRetry={() => setDetailsRetry((value) => value + 1)} /> : detailsLoading || !details ? <DetailPlaceholder /> : details.projects.length ? (
              <div className="mt-4 divide-y">
                {details.projects.slice(0, 6).map((row) => (
                  <Link prefetch={false} key={row.project_id} href={`/dashboard/projects/${row.project_id}`} className="group -mx-2 block rounded-lg px-2 py-3.5 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <div className="min-w-0"><p className="break-words text-sm font-semibold text-neutral-800 sm:truncate">{row.project_number} · {row.project_name}</p><p className="mt-1 break-words text-xs text-neutral-500 sm:truncate">{row.client_name}</p></div>
                      <div className="sm:shrink-0 sm:text-right"><p className="break-all text-sm font-semibold">{money(row.estimated_profit, row.currency)}</p><p className="mt-0.5 text-xs text-neutral-400">{percent(row.margin_percent)} margin</p></div>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-neutral-400 sm:flex sm:flex-wrap sm:gap-x-4"><span>Contract {money(row.contract_value, row.currency)}</span><span>Invoiced {money(row.invoiced_revenue, row.currency)}</span><span>Collected {money(row.collected_revenue, row.currency)}</span><span>Direct cost {money(row.direct_expenses, row.currency)}</span></div>
                  </Link>
                ))}
              </div>
            ) : <EmptyState title="No project economics yet" note="Project profitability appears as projects, invoices and direct expenses are recorded." />}
          </Surface>
        </div>

        <Surface className="dashboard-client-economics p-5 sm:p-6">
          <SectionHeading title="Client economics" note={`${rangeLabel} client performance`} href="/dashboard/clients" icon={Users} />
          {detailsError ? <DetailUnavailable onRetry={() => setDetailsRetry((value) => value + 1)} /> : detailsLoading || !details ? <DetailPlaceholder /> : details.clients.length ? (
            <div className="dashboard-client-ledger">
              {details.clients.slice(0, 9).map((row) => (
                <Link prefetch={false} key={`${row.client_id}-${row.currency}`} href={`/dashboard/clients/${row.client_id}`} className="dashboard-client-row group rounded-xl border border-neutral-200 bg-white p-4 transition-[border-color,box-shadow] hover:border-neutral-300 hover:shadow-[0_4px_14px_rgba(15,23,42,0.045)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 sm:p-5">
                  <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-words text-sm font-semibold text-neutral-900 sm:truncate">{row.client_name}</p><p className="mt-1.5 text-xs text-neutral-500">{row.currency} · {percent(row.margin_percent)} margin</p></div><ArrowRight aria-hidden="true" className="size-4 shrink-0 text-neutral-400 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none" /></div>
                  <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-4 border-t border-neutral-100 pt-4 text-xs"><ClientMetric label="Invoiced" value={money(row.invoiced_revenue, row.currency)} /><ClientMetric label="Collected" value={money(row.collected_revenue, row.currency)} /><ClientMetric label="Linked cost" value={money(row.direct_expenses, row.currency)} /><ClientMetric label="Est. profit" value={money(row.estimated_profit, row.currency)} strong /></div>
                </Link>
              ))}
            </div>
          ) : <EmptyState title="No client economics yet" note="Client profitability appears after commercial and financial activity is recorded." />}
        </Surface>
      </div>
    </AppPage>
  );
}

function MetricCard({ label, value, note, href, icon: Icon, attention = false }: { label: string; value: number; note: string; href: string; icon: LucideIcon; attention?: boolean }) {
  const needsAttention = attention && value > 0;
  return (
    <Link
      prefetch={false}
      href={href}
      className="dashboard-operation-link group"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 pt-1 text-xs font-medium leading-5 text-neutral-500 sm:text-[13px]">{label}</p>
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${needsAttention ? "bg-amber-50 text-amber-700" : "bg-neutral-100 text-neutral-600"}`}>
          <Icon className="size-[18px]" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-3 text-[28px] font-semibold leading-none tracking-[-0.035em] tabular-nums text-neutral-950 sm:text-[32px]">{value.toLocaleString()}</p>
      <div className="mt-4 flex items-end justify-between gap-2 border-t border-neutral-100 pt-3">
        <p className="min-w-0 text-[11px] leading-4 text-neutral-500 sm:text-xs">{note}</p>
        <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-neutral-400 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none" />
      </div>
    </Link>
  );
}

function PulseCard({ title, note, href, icon: Icon, children }: { title: string; note: string; href: string; icon: LucideIcon; children: React.ReactNode }) {
  return <article className="dashboard-pulse-card min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50/60"><div className="flex items-start justify-between gap-3 p-4 sm:p-5"><div className="min-w-0"><h3 className="font-semibold">{title}</h3><p className="mt-1 text-xs leading-5 text-neutral-400">{note}</p></div><div className="flex items-center gap-2"><Icon className="size-5 shrink-0 text-neutral-300" /><Link prefetch={false} href={href} className="text-xs font-semibold text-neutral-500 hover:text-neutral-950">View →</Link></div></div><div className="border-t bg-white">{children}</div></article>;
}

function PulseValueRow({ label, count, values, reportingCurrency, countLabel = "active", secondaryLabel, secondaryValues, attention = false }: { label: string; count: number; values: CurrencyValue[]; reportingCurrency: string; countLabel?: string; secondaryLabel?: string; secondaryValues?: CurrencyValue[]; attention?: boolean }) {
  return <div className="border-b p-3.5 last:border-b-0 sm:p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium text-neutral-700">{label}</p><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${attention ? "bg-amber-50 text-amber-700" : "bg-neutral-100 text-neutral-500"}`}>{count} {countLabel}</span></div><CurrencyChips values={values} reportingCurrency={reportingCurrency} /><div>{secondaryLabel && secondaryValues ? <div className="mt-2 flex flex-wrap items-center gap-2"><span className="text-[11px] text-neutral-400">{secondaryLabel}</span><CurrencyChips values={secondaryValues} reportingCurrency={reportingCurrency} compact /></div> : null}</div></div>;
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

function ClientMetric({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className="min-w-0"><p className="text-[11px] font-medium text-neutral-500">{label}</p><p className={`mt-1.5 break-all text-xs tabular-nums ${strong ? "font-semibold text-neutral-950" : "font-medium text-neutral-700"}`}>{value}</p></div>;
}

function AlertRow({ label, value, href }: { label: string; value: number; href: string }) {
  return <Link prefetch={false} href={href} className="dashboard-priority-row flex items-center justify-between gap-3 rounded-xl border border-neutral-200 px-3 py-3 transition hover:bg-neutral-50 sm:px-4"><div className="flex min-w-0 items-center gap-2.5 sm:gap-3"><AlertTriangle className={`size-4 shrink-0 ${value ? "text-amber-500" : "text-neutral-300"}`} /><span className="min-w-0 text-sm font-medium">{label}</span></div><div className="flex shrink-0 items-center gap-2"><span className="text-sm font-semibold">{value}</span><ArrowRight className="size-3.5 text-neutral-300" /></div></Link>;
}

function WorkspaceLink({ href, label, icon: Icon }: { href: string; label: string; icon: LucideIcon }) {
  // Editable documents need a native history boundary for beforeunload.
  const nativeDocument = href === "/dashboard/orders/new";
  const ActionLink = nativeDocument ? "a" : Link;
  return (
    <ActionLink
      {...(nativeDocument ? {} : { prefetch: false })}
      href={href}
      className="group flex min-h-14 min-w-0 items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50/60 px-3 py-2.5 text-sm font-medium text-neutral-700 transition-[border-color,background-color,box-shadow] hover:border-neutral-300 hover:bg-white hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2 sm:px-4"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white text-neutral-600 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
        <Icon className="size-[18px]" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 leading-5">{label}</span>
      <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-neutral-400 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none" />
    </ActionLink>
  );
}

function SectionHeading({ title, note, href, icon: Icon }: { title: string; note: string; href: string; icon: LucideIcon }) {
  return <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3"><div className="min-w-0"><h2 className="font-semibold">{title}</h2><p className="mt-1 text-xs text-neutral-400">{note}</p></div><div className="flex items-center justify-between gap-3 sm:justify-end"><Icon className="size-5 shrink-0 text-neutral-300" /><Link prefetch={false} href={href} className="text-xs font-semibold text-neutral-500 hover:text-neutral-950">View all →</Link></div></div>;
}

function EmptyState({ title, note }: { title: string; note: string }) {
  return <div className="mt-5 rounded-xl border border-dashed border-neutral-200 bg-neutral-50 px-4 py-7 text-center sm:py-8"><CircleDollarSign className="mx-auto size-6 text-neutral-300" /><p className="mt-3 text-sm font-medium">{title}</p><p className="mt-1 text-xs leading-5 text-neutral-400">{note}</p></div>;
}

function DetailPlaceholder() {
  return (
    <div role="status" aria-label="Loading dashboard details" className="mt-5 space-y-2">
      {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-neutral-100" />)}
    </div>
  );
}

function DetailUnavailable({ onRetry }: { onRetry: () => void }) {
  return <div role="alert" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><p>Dashboard details are temporarily unavailable. Other business metrics remain accessible.</p><button type="button" onClick={onRetry} className="mt-3 min-h-10 rounded-lg border border-current px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2">Retry dashboard details</button></div>;
}
