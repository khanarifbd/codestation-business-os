"use client";
import Link from "next/link";
import type { HRTimeWorkspaceState } from "@/hooks/use-hr-time-workspace";
import type { TimeBrowse } from "@/lib/hr-time-navigation";
import type { TimeRow } from "./hr-time-model";
import { minuteLabel, timeLabel } from "./hr-time-model";
export function TimeStatus({ value }: {
  value: string;
}) { return <span className="ht-status" data-status={value}>{timeLabel(value)}</span>; }
export function HRTimeRegister({ vm }: {
  vm: HRTimeWorkspaceState;
}) {
  return <section className="ht-panel ht-register">
    <header className="ht-register-top">
      <div className="ht-tabs" aria-label="Time register">
        <button type="button" aria-pressed={vm.browse.view === "attendance"} onClick={() => vm.browseTo({ view: "attendance", status: "" })}>Attendance</button>
        <button type="button" aria-pressed={vm.browse.view === "leave"} onClick={() => vm.browseTo({ view: "leave", status: "" })}>Leave requests</button>
      </div>
      <span className="ht-subtle">{vm.page.value ? `${vm.rows.length} shown · ${vm.page.value.items.length} loaded` : "Current page"}</span>
    </header>
    <details className="ht-filters">
      <summary>Filter & search <span>{[vm.browse.status, vm.browse.employee, vm.browse.from, vm.browse.to, vm.browse.search].filter(Boolean).length || "All records"}</span>
      </summary>
      <HRTimeFilters vm={vm} />
    </details>
    <p className="ht-register-scope">Server page: up to {vm.browse.size} records. Search applies only to this loaded page. Date filters use company date-only values{vm.browse.view === "leave" ? " and match leave overlapping the range" : ""}; no total or fixed snapshot is claimed.</p>
    {vm.page.loading ? <p className="ht-inline-status" role="status">Reading {vm.browse.view === "leave" ? "leave requests" : "attendance"}…</p> : null}
    {!vm.page.value && !vm.page.loading ? <p className="ht-empty">The register is unavailable. Retry the read; this is not an empty result.</p> : vm.page.value && !vm.rows.length ? <p className="ht-empty">{vm.page.value.items.length ? "No rows on this page match the search. Clear search or continue to another page." : "No records matched the server filters on this page."}</p> : <div className="ht-records" data-kind={vm.browse.view}>
      {vm.rows.map(row => <HRTimeRow key={row.id} row={row} vm={vm} />)}
    </div>}
    <RegisterPagination vm={vm} />
  </section>;
}
export function HRTimeFilters({ vm }: {
  vm: HRTimeWorkspaceState;
}) {
  const statusOptions = vm.browse.view === "attendance" ? ["present", "late", "remote", "absent"] : ["pending", "approved", "rejected", "cancelled"];
  function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const patch: Partial<TimeBrowse> = {};
    for (const key of ["employee", "status", "from", "to", "search"] as const) {
      patch[key] = String(form.get(key) || "");
    }
    patch.size = Number(form.get("size"));
    vm.browseTo(patch);
  }
  return <form className="ht-filter-fields" onSubmit={applyFilters}>
    <label>Employee<select name="employee" defaultValue={vm.browse.employee}>
      <option value="">All employees</option>{vm.browse.employee && !vm.meta.value?.employees.some(e => e.id === vm.browse.employee) ? <option value={vm.browse.employee}>Selected employee · {vm.browse.employee}</option> : null}{vm.meta.value?.employees.map(e => <option key={e.id} value={e.id}>{e.name} · {e.employee_code}</option>)}</select>
    </label>
    <label>Status<select name="status" defaultValue={vm.browse.status}>
      <option value="">All statuses</option>{vm.browse.status && !statusOptions.includes(vm.browse.status) ? <option value={vm.browse.status}>{timeLabel(vm.browse.status)}</option> : null}{statusOptions.map(status => <option key={status} value={status}>{timeLabel(status)}</option>)}</select>
    </label>
    <label>From date<input type="date" name="from" defaultValue={vm.browse.from} />
    </label>
    <label>Through date<input type="date" name="to" defaultValue={vm.browse.to} />
    </label>
    <label>Page size<select name="size" defaultValue={vm.browse.size}>
      <option value="20">20 records</option>
      <option value="50">50 records</option>
      <option value="100">100 records</option>
    </select>
    </label>
    <label>Search this page<input name="search" defaultValue={vm.browse.search} maxLength={300} placeholder="Person, date or status" />
    </label>
    <div className="ht-actions">
      <button className="relationship-primary">Apply filters</button>
      <button type="button" className="relationship-secondary" onClick={() => vm.browseTo({ status: "", employee: "", from: "", to: "", search: "", size: 50 })}>Reset filters</button>
    </div>
  </form>;
}
function HRTimeRow({ row, vm }: {
  row: TimeRow;
  vm: HRTimeWorkspaceState;
}) {
  return <article id={`hr-time-row-${row.id}`} tabIndex={-1} className="ht-record">
    <div className="ht-record-identity">
      <Link href={vm.documentHref(row.id)}>
        <strong>{row.employee_name || "Employee"}</strong>
      </Link>
      <TimeStatus value={row.status} />{!row.employee_name ? <small>{row.employee_id}</small> : null}</div>
    {"attendance_date" in row ? <>
      <dl className="ht-record-facts">
        <div>
          <dt>Work date</dt>
          <dd>{row.attendance_date}</dd>
        </div>
        <div>
          <dt>Mode</dt>
          <dd>{timeLabel(row.attendance_mode || "Legacy / manual")}</dd>
        </div>
        <div>
          <dt>Worked</dt>
          <dd>{minuteLabel(row.work_minutes)}</dd>
        </div>
        <div>
          <dt>Overtime</dt>
          <dd>{minuteLabel(row.overtime_minutes)}</dd>
        </div>
      </dl>
      <p className="ht-record-note">
        <span>Note</span>{row.notes || "—"}</p>
    </> : <>
      <dl className="ht-record-facts">
        <div>
          <dt>Leave type</dt>
          <dd>{row.leave_type_name || "Leave"}</dd>
        </div>
        <div>
          <dt>Date range</dt>
          <dd>{row.start_date} → {row.end_date}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{row.days} days</dd>
        </div>
      </dl>
      <p className="ht-record-note">
        <span>Reason</span>{row.reason || "—"}</p>
    </>}
    <div className="ht-record-actions">
      <Link className="ht-inline-link" href={vm.documentHref(row.id)}>View record</Link>{vm.browse.view === "leave" && row.status === "pending" && vm.canManage ? <a className="relationship-secondary" href={vm.documentHref(row.id, true)}>Review request</a> : null}</div>
  </article>;
}
function RegisterPagination({ vm }: {
  vm: HRTimeWorkspaceState;
}) {
  return <footer className="ht-pagination">
    <div>
      <button type="button" className="relationship-secondary" disabled={!vm.browse.cursor || vm.previous === undefined || vm.page.loading} onClick={vm.previousPage}>Previous</button>
      <button type="button" className="relationship-secondary" disabled={!vm.page.value?.next_cursor || !vm.page.isReady(vm.page.receipt)} onClick={vm.nextPage}>Next page</button>
    </div>{vm.browse.cursor && vm.previous === undefined ? <p>Previous-page history is unavailable after a reload or shared link. Next remains available when provided by the server. <button className="ht-text-button" onClick={() => vm.browseTo({})}>Return to first page</button>
    </p> : <p>{vm.page.value?.next_cursor ? "More records are available." : vm.page.value ? "End of this filtered result." : "Pagination awaits a verified read."}</p>}</footer>;
}
