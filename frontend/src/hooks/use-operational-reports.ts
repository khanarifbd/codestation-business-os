"use client";
import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { useOperationalReportResource } from "@/hooks/use-operational-report-resource";
import { isReportsMeta, reportMatchesFilters } from "@/components/operational-reports/report-model";
import type { ReportFilters, ReportSection, ReportsOverview } from "@/components/operational-reports/report-types";
import { parseReportBrowse, reportDefaults, reportFilterError, reportHref, reportQuery } from "@/lib/operational-report-navigation";

export function useOperationalReports() {
  const { tenant, loading: sessionLoading } = useDashboardSession();
  const router = useRouter(), query = useSearchParams();
  const timezone = tenant?.organization.timezone || "UTC";
  const defaults = useMemo(() => reportDefaults(timezone), [timezone]);
  const serialized = query.toString();
  const browse = useMemo(() => parseReportBrowse(new URLSearchParams(serialized), defaults), [serialized, defaults]);
  const appliedQuery = reportQuery(browse);
  const canView = Boolean(tenant?.permissions.some(permission => permission === "*" || permission === "reports.view"));
  const scopeError = reportFilterError(browse);
  const [draft, setDraft] = useState<{ key: string; filters: ReportFilters }>(() => ({ key: appliedQuery, filters: browse }));
  const [localError, setLocalError] = useState<{ key: string; message: string } | null>(null);
  const filters = draft.key === appliedQuery ? draft.filters : browse;
  const error = localError?.key === appliedQuery ? localError.message : null;
  const { date_from, date_to, currency } = browse;
  const validate = useCallback((value: unknown): value is ReportsOverview => reportMatchesFilters(value, { date_from, date_to, currency }), [date_from, date_to, currency]);
  const meta = useOperationalReportResource("/api/reports/meta", canView && !sessionLoading, isReportsMeta);
  const report = useOperationalReportResource(`/api/reports/overview?${appliedQuery}`, canView && !sessionLoading && !scopeError, validate);
  const dirty = reportQuery(filters) !== appliedQuery;

  function change(key: keyof ReportFilters, value: string) {
    setDraft({ key: appliedQuery, filters: { ...filters, [key]: value, ...(key === "client_id" ? { project_id: "" } : {}) } });
    setLocalError(null);
  }
  function apply() {
    const message = reportFilterError(filters);
    if (message) { setLocalError({ key: appliedQuery, message }); return false; }
    try {
      router.push(reportHref({ ...filters, section: browse.section }), { scroll: false });
      setDraft({ key: reportQuery(filters), filters });
      setLocalError(null);
      if (!dirty) void report.refresh();
      return true;
    } catch { setLocalError({ key: appliedQuery, message: "The report navigation did not complete. Your filter choices are still here." }); return false; }
  }
  function reset() {
    const next = reportDefaults(timezone);
    try {
      router.push(reportHref({ ...next, section: browse.section }), { scroll: false });
      setDraft({ key: reportQuery(next), filters: next });
      setLocalError(null);
      if (reportQuery(next) === appliedQuery) void report.refresh();
    } catch { setLocalError({ key: appliedQuery, message: "Reset navigation did not complete. The current report scope is unchanged." }); }
  }
  function sectionHref(section: ReportSection) { return reportHref({ ...browse, section }); }
  function refresh() { void report.refresh(); if (meta.error) void meta.refresh(); }
  return { canView, sessionLoading, browse, filters, appliedQuery, scopeError, error, dirty, meta, report, change, apply, reset, sectionHref, refresh, timezone };
}
