"use client";
import type { HRTimeWorkspaceState } from "@/hooks/use-hr-time-workspace";
import { minuteLabel, timeInstant, timeLabel } from "./hr-time-model";
import { TimeStatus } from "./hr-time-register";
export function HRTimeDocument({ vm }: {
  vm: HRTimeWorkspaceState;
}) {
  const row = vm.row;
  if (!row)
    return <p className="ht-empty">{vm.page.loading ? "Reading this record…" : vm.page.error ? "Record unavailable until a successful read." : "This record was not found in the current company’s readable result."}</p>;
  return <section className="ht-panel ht-document">
    <header className="ht-section-heading">
      <div>
        <p className="ht-kicker">{"attendance_date" in row ? "Attendance record" : "Leave request"}</p>
        <h2>{row.employee_name || "Employee"}</h2>
      </div>
      <TimeStatus value={row.status} />
    </header>
    {"attendance_date" in row ? <>
      <dl className="ht-document-facts">
        <div>
          <dt>Company work date</dt>
          <dd>{row.attendance_date}</dd>
        </div>
        <div>
          <dt>Mode</dt>
          <dd>{timeLabel(row.attendance_mode || "Legacy / manual")}</dd>
        </div>
        <div>
          <dt>Worked</dt>
          <dd>{minuteLabel(row.work_minutes)} <small>({row.work_minutes} minutes)</small>
          </dd>
        </div>
        <div>
          <dt>Overtime</dt>
          <dd>{minuteLabel(row.overtime_minutes)} <small>({row.overtime_minutes} minutes)</small>
          </dd>
        </div>
        <div>
          <dt>Check-in</dt>
          <dd>{timeInstant(row.check_in_at, vm.access?.timezone || "UTC")}</dd>
        </div>
        <div>
          <dt>Check-out</dt>
          <dd>{timeInstant(row.check_out_at, vm.access?.timezone || "UTC")}</dd>
        </div>
      </dl>
      <p className="ht-footnote">Recorded timestamps shown in company timezone: {vm.access?.timezone || "Unavailable"}. This is a read-only record, not a generic attendance correction form.</p>
      <Note title="Note" value={row.notes} />
    </> : <>
      <dl className="ht-document-facts">
        <div>
          <dt>Leave type</dt>
          <dd>{row.leave_type_name || "Leave"}</dd>
        </div>
        <div>
          <dt>Requested duration</dt>
          <dd>{row.days} days</dd>
        </div>
        <div>
          <dt>Start date</dt>
          <dd>{row.start_date}</dd>
        </div>
        <div>
          <dt>End date</dt>
          <dd>{row.end_date}</dd>
        </div>
      </dl>
      <Note title="Reason" value={row.reason} />
      <Note title="Existing review note" value={row.review_notes} />{vm.route.mode === "leave_view" && vm.canManage && row.status === "pending" && vm.page.isReady(vm.page.receipt) ? <a className="relationship-primary" href={vm.documentHref(row.id, true)}>Review this request</a> : null}</>}
    <details className="ht-identifiers">
      <summary>Record identifiers</summary>
      <dl>
        <div>
          <dt>Record</dt>
          <dd>{row.id}</dd>
        </div>
        <div>
          <dt>Employee</dt>
          <dd>{row.employee_id}</dd>
        </div>{"leave_type_id" in row ? <div>
          <dt>Leave type</dt>
          <dd>{row.leave_type_id}</dd>
        </div> : null}</dl>
    </details>
  </section>;
}
function Note({ title, value }: {
  title: string;
  value: string | null;
}) {
  return <section className="ht-note">
    <h3>{title}</h3>
    <p>{value || "Not recorded"}</p>
  </section>;
}
