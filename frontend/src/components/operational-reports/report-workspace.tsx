"use client";
import Link from "next/link";
import { RefreshCw, SlidersHorizontal } from "lucide-react";
import { SearchableSelect } from "@/components/searchable-select";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { AccountHeading, AccountState } from "@/components/accounting-accounts/account-ui";
import { useOperationalReports } from "@/hooks/use-operational-reports";
import { reportLabel, reportOptions } from "./report-model";
import { reportSections } from "./report-types";
import { ReportPerformance } from "./report-performance";
import { ReportClients, ReportPosition, ReportProjects } from "./report-analysis";
import "@/components/accounting-accounts/account-workspace.css";
import "./reports.css";
const titles = { performance: "Performance", position: "Current position", projects: "Projects", clients: "Clients" };

export function OperationalReportsWorkspace() {
  const { tenant } = useDashboardSession();
  const identity = `${tenant?.organization.id}:${tenant?.membership_id}:${tenant?.role_id}:${tenant?.permissions.join("|")}:${tenant?.organization.timezone}`;
  return <ReportsWorkspace key={identity} />;
}
export function ReportsWorkspace() {
  const vm = useOperationalReports();
  if (vm.sessionLoading) return <main className="or-page"><AccountState title="Checking report access" loading /></main>;
  if (!vm.canView) return <main className="or-page"><AccountState title="Reports are restricted">The reports.view permission is required. Finance permissions alone do not grant access to this workspace.</AccountState></main>;
  const meta = vm.meta.value;
  const currencyOptions = [...new Set([...(meta?.currencies || []), ...(vm.filters.currency ? [vm.filters.currency] : [])])].sort();
  const filters = <form onSubmit={event => { event.preventDefault(); vm.apply(); }} className="or-filter-form">
    <div className="or-filter-grid">
      <label>From<input type="date" name="date_from" required value={vm.filters.date_from} onChange={event => vm.change("date_from", event.target.value)} /></label>
      <label>To<input type="date" name="date_to" required value={vm.filters.date_to} onChange={event => vm.change("date_to", event.target.value)} /></label>
      <SearchableSelect label="Currency" name="currency" value={vm.filters.currency} onValueChange={value => vm.change("currency", value)} placeholder="All separately" options={[{ value: "", label: "All separately" }, ...currencyOptions.map(value => ({ value, label: value }))]} />
      <SearchableSelect label="Client" name="client_id" value={vm.filters.client_id} onValueChange={value => vm.change("client_id", value)} options={reportOptions(meta?.clients, vm.filters.client_id, "All clients")} />
      <SearchableSelect label="Project" name="project_id" value={vm.filters.project_id} onValueChange={value => vm.change("project_id", value)} options={reportOptions(meta?.projects, vm.filters.project_id, "All projects")} />
    </div>
    <div className="or-filter-footer"><p>{vm.dirty ? "Filter changes are not applied yet." : `Dates use ${vm.timezone}; explicit selections are retained.`}</p><div><button type="button" className="or-button" onClick={vm.reset}>Reset</button><button type="submit" className="or-button or-primary" disabled={vm.report.loading}>Apply filters</button></div></div>
    {vm.error ? <p role="alert" className="or-error">{vm.error}</p> : null}
  </form>;
  return <main className="or-page"><div className="or-container">
    <AccountHeading eyebrow="Business intelligence / Operational basis" title="Reports" description="Understand performance. Keep the period, population and currency in view." actions={<button className="or-button" type="button" disabled={vm.report.loading || Boolean(vm.scopeError)} onClick={vm.refresh}><RefreshCw size={16} aria-hidden="true" />Refresh results</button>} />
    <section className="or-applied" aria-label="Applied report scope"><div><span>Applied period</span><strong>{vm.browse.date_from || "Missing start"} — {vm.browse.date_to || "Missing end"}</strong></div><div><span>Currency</span><strong>{vm.browse.currency || "All, kept separate"}</strong></div><div><span>Client</span><strong>{reportLabel(meta?.clients, vm.browse.client_id, "All clients")}</strong></div><div><span>Project</span><strong>{reportLabel(meta?.projects, vm.browse.project_id, "All projects")}</strong></div></section>
    <details className="or-filters"><summary><span><SlidersHorizontal size={16} aria-hidden="true" />Refine report scope</span><span>{vm.dirty ? "Unapplied changes" : "Dates, currency, client, project"}</span></summary>{filters}</details>
    {vm.meta.error ? <div className="or-metadata-error" role="status"><p>Filter options could not be loaded. Current IDs and applied report results are not replaced with defaults.</p><button type="button" className="or-button" onClick={() => void vm.meta.refresh()}>Retry filter options</button></div> : null}
    <nav className="or-section-nav" aria-label="Report sections">{reportSections.map(section => <Link key={section} href={vm.sectionHref(section)} scroll={false} aria-current={vm.browse.section === section ? "page" : undefined}>{titles[section]}</Link>)}</nav>
    <div id="report-results" aria-live="polite" aria-busy={vm.report.loading}>
      {vm.scopeError ? <AccountState title="Check the report scope">{vm.scopeError} Open the filter panel to correct it; no report request has been made for this invalid scope.</AccountState> : vm.report.loading ? <AccountState title="Loading this report scope" loading>Previous amounts are hidden while this exact period and population are verified.</AccountState> : vm.report.error ? <AccountState title="Report results unavailable" action={<button className="or-button" type="button" onClick={vm.refresh}>Retry this scope</button>}>{vm.report.error} No earlier results are shown under these filters.</AccountState> : vm.report.value ? <>
        {vm.browse.section === "performance" ? <ReportPerformance report={vm.report.value} /> : vm.browse.section === "position" ? <ReportPosition report={vm.report.value} currency={vm.browse.currency} /> : vm.browse.section === "projects" ? <ReportProjects rows={vm.report.value.projects} /> : <ReportClients rows={vm.report.value.clients} projectFiltered={Boolean(vm.browse.project_id)} />}
      </> : <AccountState title="No verified report response">Refresh this scope to load the report. An unavailable response is not a zero result.</AccountState>}
    </div>
  </div></main>;
}
