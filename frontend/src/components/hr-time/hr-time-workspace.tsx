"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { useHRAccess } from "@/components/hr-access-context";
import { RelationshipHeader, RelationshipNotice, RelationshipPage } from "@/components/relationships/relationship-ui";
import { hrTimeScope, useHRTimeWorkspace, type HRTimeWorkspaceState } from "@/hooks/use-hr-time-workspace";
import { HRTimeRegister } from "./hr-time-register";
import { HRTimeDocument } from "./hr-time-document";
import { AttendanceCreateForm, LeaveReviewForm } from "./hr-time-editors";
import { HRTimeConfirmation } from "./hr-time-confirmation";
import "./hr-time.css";
export function HRTimeWorkspace() {
  const { tenant, profile } = useDashboardSession(), { access } = useHRAccess(), pathname = usePathname(), query = useSearchParams();
  return <HRTimeContent key={JSON.stringify([hrTimeScope(tenant), profile?.email, access, pathname, query.toString()])} />;
}
export function HRTimeContent() {
  const vm = useHRTimeWorkspace(), register = vm.route.mode === "register", create = vm.route.mode === "attendance_new", review = vm.route.mode === "leave_review";
  if (vm.accessLoading)
    return <RelationshipPage className="hr-time">
      <p role="status">Checking HR access…</p>
    </RelationshipPage>;
  if (!vm.canView)
    return <RelationshipPage className="hr-time">
      <RelationshipNotice tone="error">{vm.accessError || "Your role cannot read Time & Leave. Management permission does not grant the readable employee and record context this workspace needs."}</RelationshipNotice>{vm.access?.can_self ? <Link href="/dashboard/hr/me" className="relationship-secondary">Open My HR</Link> : null}</RelationshipPage>;
  if (vm.route.mode === "unavailable")
    return <RelationshipPage className="hr-time">
      <RelationshipNotice tone="error">This Time & Leave route is unavailable.</RelationshipNotice>
      <Link href="/dashboard/hr/time" className="relationship-secondary">Open the register</Link>
    </RelationshipPage>;
  return <RelationshipPage className="hr-time">
    <RelationshipHeader eyebrow="People operations" title={register ? "Time & Leave" : create ? "New attendance record" : review ? "Review leave" : "Time & leave record"} description={register ? "Browse recorded time and leave, then open a record to work with it." : "A separate document with the current company’s record context."} actions={register ? <>{vm.access?.can_self ? <Link className="relationship-secondary" href="/dashboard/hr/me">My HR</Link> : null}{vm.canManage ? <a className="relationship-primary" href={vm.createHref}>Record attendance</a> : null}</> : <button className="relationship-secondary" disabled={vm.action.busy} onClick={vm.action.back}>Back to register</button>} />
    {register ? <TimeSummary vm={vm} /> : null}
    <TimeReadNotices vm={vm} />
    {vm.action.message ? <RelationshipNotice tone={vm.action.phase === "confirmed" ? "success" : vm.action.phase === "rejected" ? "error" : "info"}>{vm.action.message}</RelationshipNotice> : null}
    {vm.action.unresolved ? <section className="ht-outcome">
      <h2>{vm.action.phase === "acknowledged" ? "Acknowledged; result details unverified" : "Outcome requires review"}</h2>
      <p>This document will not submit the operation again. A current read may help your review, but neither a matching nor a missing record proves the outcome of this specific request. Reloading or closing loses the local protection.</p>
      <button className="relationship-secondary" disabled={vm.action.busy} onClick={() => void vm.refresh()}>Read current information</button>
    </section> : null}
    {vm.action.phase === "confirmed" && vm.savedHref ? <section className="ht-outcome">
      <h2>Server acknowledgment received</h2>
      <button className="relationship-primary" onClick={() => vm.action.open(vm.savedHref!)}>Open saved record</button>
      <button className="relationship-secondary" onClick={vm.action.back}>Return to register</button>
    </section> : null}
    <div hidden={Boolean(vm.action.review)} inert={Boolean(vm.action.review)} className="ht-content">
      {register ? <HRTimeRegister vm={vm} /> : create ? vm.canManage ? <AttendanceCreateForm vm={vm} /> : <RelationshipNotice tone="error">Recording attendance requires HR management access.</RelationshipNotice> : <>
        <HRTimeDocument vm={vm} />{review ? !vm.canManage ? <RelationshipNotice tone="error">Reviewing leave requires HR management access.</RelationshipNotice> : vm.row && vm.row.status !== "pending" ? <RelationshipNotice>This request is no longer pending. Its current status is read-only here.</RelationshipNotice> : <LeaveReviewForm vm={vm} /> : null}</>}
    </div>
    {vm.action.review ? <HRTimeConfirmation action={vm.action} /> : null}
  </RelationshipPage>;
}
function TimeReadNotices({ vm }: {
  vm: HRTimeWorkspaceState;
}) {
  return <>{([["Summary", vm.summary], ["Employee context", vm.meta], ["Record data", vm.page]] as const).map(([label, read]) => read.error ? <RelationshipNotice key={label} tone="error">{label}: {read.error}{read.value ? " Previously read details remain visible but cannot authorize a change." : null}<button className="ht-text-button" disabled={vm.action.busy || read.loading} onClick={() => void read.refresh()}>Retry {label.toLowerCase()}</button>
  </RelationshipNotice> : null)}{vm.route.mode === "leave_review" && vm.row && !vm.page.isReady(vm.page.receipt) && !vm.page.loading && !vm.page.error ? <RelationshipNotice>Reload the current leave request, then review it again before another decision.<button className="ht-text-button" disabled={vm.action.busy} onClick={() => void vm.page.refresh()}>Reload current request</button>
  </RelationshipNotice> : null}</>;
}
function TimeSummary({ vm }: {
  vm: HRTimeWorkspaceState;
}) {
  const summary = vm.summary.value;
  if (!summary)
    return <p className="ht-footnote">{vm.summary.loading ? "Reading the company-wide summary…" : "Company-wide summary unavailable."}</p>;
  return <details className="ht-summary">
    <summary>
      <span>
        <strong>{summary.attention.pending_leave} pending leave</strong> · {summary.metrics.present_today} working today</span>
      <span>{summary.today}</span>
    </summary>
    <dl>
      <div>
        <dt>Working today</dt>
        <dd>{summary.metrics.present_today}</dd>
      </div>
      <div>
        <dt>Recorded absent</dt>
        <dd>{summary.metrics.absent_today}</dd>
      </div>
      <div>
        <dt>On approved leave</dt>
        <dd>{summary.metrics.on_leave_today}</dd>
      </div>
      <div>
        <dt>Pending leave</dt>
        <dd>{summary.attention.pending_leave}</dd>
      </div>
    </dl>
    <p>Company-wide counts, independent of register filters and pagination. Working includes present, late and remote. Company timezone: {summary.timezone}.</p>
  </details>;
}
