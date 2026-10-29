"use client";
import { useLayoutEffect, useRef } from "react";
import { SearchableSelect } from "@/components/searchable-select";
import type { HRTimeWorkspaceState } from "@/hooks/use-hr-time-workspace";
export function AttendanceCreateForm({ vm }: {
  vm: HRTimeWorkspaceState;
}) {
  const disabled = !vm.canCreate || !vm.action.canEdit();
  return <form className="ht-panel ht-editor" onSubmit={e => { e.preventDefault(); void vm.submitAttendance(); }}>
    <header className="ht-section-heading">
      <div>
        <p className="ht-kicker">Manual attendance · new record only</p>
        <h2>Record attendance</h2>
        <p className="ht-subtle">The same employee and work date cannot be recorded twice. Existing attendance corrections belong to the exception workflow.</p>
      </div>
    </header>
    <fieldset disabled={disabled} className="ht-editor-fields">
      <SearchableSelect label="Employee" name="employee_id" value={vm.draft.employee_id} onChange={value => vm.change("employee_id", value)} required clearable={false} disabled={disabled} options={(vm.meta.value?.employees || []).map(e => ({ value: e.id, label: `${e.name} · ${e.employee_code}` }))} searchPlaceholder="Search active employees…" />
      <div className="ht-two-fields">
        <label>Company work date<input name="attendance_date" type="date" required value={vm.draft.attendance_date} onChange={e => vm.change("attendance_date", e.target.value)} />
        </label>
        <label>Status<select name="status" value={vm.draft.status} onChange={e => vm.change("status", e.target.value)}>
          <option value="present">Present</option>
          <option value="late">Late</option>
          <option value="remote">Remote</option>
          <option value="absent">Absent</option>
        </select>
        </label>
      </div>
      <div className="ht-two-fields">
        <label>Worked hours<input name="hours" type="number" min="0" step="0.25" value={vm.draft.hours} onChange={e => vm.change("hours", e.target.value)} />
        </label>
        <label>Overtime hours<input name="overtime_hours" type="number" min="0" step="0.25" value={vm.draft.overtime_hours} onChange={e => vm.change("overtime_hours", e.target.value)} />
        </label>
      </div>
      <p className="ht-footnote">Hours are converted to rounded whole minutes using the existing recording rule; this form does not calculate payroll.</p>
      <label>Note<textarea name="notes" value={vm.draft.notes} onChange={e => vm.change("notes", e.target.value)} placeholder="Optional context" />
      </label>
    </fieldset>
    <p className="ht-footnote">If a response is interrupted, review current attendance before any separate new intent. A later list is not proof that this request failed. The duplicate-protection latch is kept only in this open document.</p>
    <footer className="ht-editor-footer">
      <button type="button" className="relationship-secondary" disabled={vm.action.busy} onClick={vm.action.back}>Cancel</button>
      <button className="relationship-primary" disabled={disabled}>{vm.action.busy ? "Recording…" : "Save attendance"}</button>
    </footer>
  </form>;
}
export function LeaveReviewForm({ vm }: {
  vm: HRTimeWorkspaceState;
}) {
  const opener = useRef<HTMLButtonElement>(null), wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (wasOpen.current && !vm.action.review && ["idle", "rejected"].includes(vm.action.phase)) {
      const node = opener.current;
      if (node?.isConnected && !node.disabled && !node.closest("[hidden], [inert]"))
        node.focus();
    }
    wasOpen.current = Boolean(vm.action.review);
  }, [vm.action.review, vm.action.phase]);
  const disabled = !vm.canReview || !vm.action.canEdit();
  return <form className="ht-panel ht-review-form" onSubmit={e => { e.preventDefault(); vm.reviewLeave(); }}>
    <header className="ht-section-heading">
      <div>
        <h2>Decide this pending request</h2>
        <p className="ht-subtle">Review the current record above. The server checks that its status is still the one you reviewed.</p>
      </div>
    </header>
    <fieldset disabled={disabled}>
      <legend>Decision</legend>
      <div className="ht-decision-options">
        <label>
          <input type="radio" name="decision" value="approved" checked={vm.decision === "approved"} onChange={() => vm.choose("approved")} />Approve request</label>
        <label>
          <input type="radio" name="decision" value="rejected" checked={vm.decision === "rejected"} onChange={() => vm.choose("rejected")} />Reject request</label>
      </div>
    </fieldset>
    <p className="ht-footnote">Only pending requests can be reviewed here. Approval and rejection preserve the existing leave behavior; no payroll calculation is added.</p>
    <footer className="ht-editor-footer">
      <button type="button" className="relationship-secondary" disabled={vm.action.busy} onClick={vm.action.back}>Cancel</button>
      <button ref={opener} className="relationship-primary" disabled={disabled || !vm.decision}>Review decision</button>
    </footer>
  </form>;
}
