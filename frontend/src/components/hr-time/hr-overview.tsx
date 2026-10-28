"use client";
import Link from "next/link";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { useHRAccess } from "@/components/hr-access-context";
import { RelationshipHeader, RelationshipNotice, RelationshipPage } from "@/components/relationships/relationship-ui";
import { useHROverview } from "@/hooks/use-hr-overview";
import { hrTimeScope } from "@/hooks/use-hr-time-workspace";
import "./hr-time.css";
export function HROverviewWorkspace() {
  const { tenant } = useDashboardSession(), { access } = useHRAccess();
  return <HROverviewContent key={JSON.stringify([hrTimeScope(tenant), access])} />;
}
export function HROverviewContent() {
  const vm = useHROverview(), summary = vm.summary.value, access = vm.access;
  if (vm.accessLoading || vm.redirecting)
    return <RelationshipPage className="hr-time">
      <p role="status">Opening People & HR…</p>
    </RelationshipPage>;
  if (!access?.can_view)
    return <RelationshipPage className="hr-time">
      <RelationshipNotice tone="error">{vm.accessError || "Your current role cannot view the HR overview."}</RelationshipNotice>
    </RelationshipPage>;
  return <RelationshipPage className="hr-time hr-overview">
    <RelationshipHeader eyebrow="People operations" title="People & HR" description="Review today’s attention queue, then move into the work." actions={<div className="ht-date">
      <strong>{summary?.today || "Company date unavailable"}</strong>
      <span>Company timezone · {summary?.timezone || access.timezone}</span>
    </div>} />
    {vm.summary.error ? <RelationshipNotice tone="error">{vm.summary.error} {summary ? "Previously read figures are retained; they are not current." : null}<button className="ht-text-button" disabled={vm.summary.loading} onClick={() => void vm.summary.refresh()}>Retry summary</button>
    </RelationshipNotice> : null}
    {!summary ? <p className="ht-empty" role="status">{vm.summary.loading ? "Reading the company summary…" : "Summary unavailable. No zero totals have been assumed."}</p> : <>
      <div className="ht-overview-grid">
        <section className="ht-panel ht-attention">
          <header className="ht-section-heading">
            <div>
              <p className="ht-kicker">Start here</p>
              <h2>Needs attention</h2>
            </div>
            <span className="ht-subtle">Company-wide</span>
          </header>
          <Link href="/dashboard/hr/time?view=leave&status=pending" className="ht-attention-row">
            <span>
              <strong>Leave requests</strong>
              <small>Waiting for a decision</small>
            </span>
            <b>{summary.attention.pending_leave}</b>
            <span aria-hidden="true">→</span>
          </Link>
          <Link href="/dashboard/hr/records" className="ht-attention-row">
            <span>
              <strong>Documents expiring</strong>
              <small>Within the next 30 days</small>
            </span>
            <b>{summary.attention.documents_expiring_30d}</b>
            <span aria-hidden="true">→</span>
          </Link>
          <Link href="/dashboard/hr/talent" className="ht-attention-row">
            <span>
              <strong>Candidates in progress</strong>
              <small>{summary.recruitment.open_jobs} open jobs</small>
            </span>
            <b>{summary.attention.active_candidates}</b>
            <span aria-hidden="true">→</span>
          </Link>
          {access.can_invite_employees ? <Link href="/dashboard/hr/people?view=invitations" className="ht-attention-row">
            <span>
              <strong>Pending invitations</strong>
              <small>Employee invitations not yet accepted</small>
            </span>
            <b>{summary.attention.pending_invitations}</b>
            <span aria-hidden="true">→</span>
          </Link> : null}
        </section>
        <section className="ht-panel ht-today">
          <header className="ht-section-heading">
            <div>
              <p className="ht-kicker">{summary.today}</p>
              <h2>Today at a glance</h2>
            </div>
          </header>
          <dl className="ht-day-metrics">
            <div>
              <dt>Working today<small>Present, late or remote</small>
              </dt>
              <dd>{summary.metrics.present_today}</dd>
            </div>
            <div>
              <dt>On approved leave<small>Leave covering today</small>
              </dt>
              <dd>{summary.metrics.on_leave_today}</dd>
            </div>
            <div>
              <dt>Recorded absent<small>Attendance marked absent</small>
              </dt>
              <dd>{summary.metrics.absent_today}</dd>
            </div>
            <div>
              <dt>Active people<small>Current employees</small>
              </dt>
              <dd>{summary.metrics.active_employees}</dd>
            </div>
          </dl>
          <p className="ht-footnote">Full-population counts, not this register’s loaded rows. These independent measures do not form a reconciled attendance total.</p>
          <Link href="/dashboard/hr/time" className="ht-inline-link">Open time & leave →</Link>
        </section>
      </div>
      <section className="ht-panel ht-setup">
        <header className="ht-section-heading">
          <div>
            <h2>Setup & next actions</h2>
            <p className="ht-subtle">Existing company configuration, kept separate from the daily queue.</p>
          </div>
          <span>{summary.setup.departments} departments</span>
        </header>
        <div className="ht-setup-grid">
          <Setup href="/dashboard/hr/people" label="People" count={summary.setup.employees} note="Work profiles and employee invitations" />
          <Setup href="/dashboard/hr/settings" label="Leave types" count={summary.setup.leave_types} note="Existing company leave configuration" />
          <Setup href="/dashboard/hr/settings" label="Work schedules" count={summary.setup.shifts} note="Hours, grace time and weekly days off" />
          <Setup href="/dashboard/hr/settings" label="Company holidays" count={summary.setup.holidays} note="Optional company calendar dates" />
        </div>
        <div className="ht-actions">{access.can_invite_employees ? <Link href="/dashboard/hr/people/new" className="relationship-secondary">Invite a person</Link> : null}<Link href="/dashboard/hr/records" className="relationship-secondary">Documents & policies</Link>
          <Link href="/dashboard/hr/talent" className="relationship-secondary">Hiring & reviews</Link>
          <Link href="/dashboard/payroll" className="relationship-secondary">Continue to payroll</Link>{access.can_self ? <Link href="/dashboard/hr/me" className="relationship-secondary">Open My HR</Link> : null}</div>
      </section>
    </>}
  </RelationshipPage>;
}
function Setup({ href, label, count, note }: {
  href: string;
  label: string;
  count: number;
  note: string;
}) {
  return <Link href={href}>
    <span>
      <strong>{label}</strong>
      <small>{note}</small>
    </span>
    <b>{count}</b>
    <em>{count > 0 ? "Configured" : "Not set up"}</em>
  </Link>;
}
