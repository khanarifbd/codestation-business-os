"use client";

import Link from "next/link";
import { type ReactNode, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, ChevronRight, Columns3, List, RefreshCw, Search, SlidersHorizontal, Timer } from "lucide-react";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { RelationshipNotice, RelationshipPage } from "@/components/relationships/relationship-ui";
import { useMyWorkRegister, useMyWorkTask, type MyWorkRegisterState, type MyWorkTaskState } from "@/hooks/use-my-work";
import { workBrowseHref, workBrowseState, workTaskHref } from "@/lib/my-work-navigation";
import { WORK_PRIORITIES, WORK_STATUSES, formatWorkMinutes, workDueKind, workLabel, type WorkTask, type WorkActivity, type WorkBrowse, type PersonalTaskDetail } from "./my-work-model";
import "./my-work.css";

type RegisterProps = { vm: MyWorkRegisterState };
type TaskProps = { vm: MyWorkTaskState };

/** Route entry, not a second data source: key drafts and reads to the current identity. */
export function MyWorkRegisterWorkspace() {
  const { tenant, loading } = useDashboardSession();
  const pathname = usePathname(), params = useSearchParams();
  const legacyTask = params.get("task");
  const identity = `${tenant?.organization.id || "no-company"}:${tenant?.membership_id || "no-membership"}:${tenant?.role_id || "no-role"}:${tenant?.permissions.join("|") || ""}:${pathname}`;
  if (legacyTask) return <LegacyTaskRedirect target={workTaskHref(legacyTask, workBrowseHref(workBrowseState(params.toString())))} />;
  if (loading) return <RelationshipPage className="my-work-workspace"><WorkState loading title="Loading My Work…" text="Retrieving your current workspace." /></RelationshipPage>;
  return <MyWorkRegisterContent key={identity} />;
}

export function MyWorkTaskWorkspace() {
  const { tenant, loading } = useDashboardSession();
  const pathname = usePathname();
  const identity = `${tenant?.organization.id || "no-company"}:${tenant?.membership_id || "no-membership"}:${tenant?.role_id || "no-role"}:${tenant?.permissions.join("|") || ""}:${pathname}`;
  if (loading) return <RelationshipPage className="my-work-workspace"><WorkState loading title="Loading task…" text="Retrieving your current workspace." /></RelationshipPage>;
  return <MyWorkTaskContent key={identity} />;
}

function LegacyTaskRedirect({ target }: { target: string }) {
  const router = useRouter();
  useEffect(() => { router.replace(target); }, [router, target]);
  return <RelationshipPage className="my-work-workspace"><WorkState loading title="Opening task…" text="Taking you to the task’s read-only workspace." /></RelationshipPage>;
}

function MyWorkRegisterContent() {
  const vm = useMyWorkRegister();
  const { data } = vm;
  if (vm.loading && !data) return <RelationshipPage className="my-work-workspace"><WorkState loading title="Loading My Work…" text="Retrieving assigned tasks and projects." /></RelationshipPage>;
  if (!data) return <RelationshipPage className="my-work-workspace"><WorkState title="My Work unavailable" text={vm.error || "Your assigned work could not be loaded."} action={<button className="mw-primary" onClick={() => void vm.load()}>Retry loading</button>} /></RelationshipPage>;
  return <RelationshipPage className="my-work-workspace">
    <header className="mw-register-header"><div><p className="mw-eyebrow">Personal execution</p><h1>My Work</h1><p>Know what needs your attention. Keep your team up to date.</p></div><button className="mw-secondary mw-refresh" aria-label={vm.loading ? "Refreshing work" : "Refresh work"} disabled={vm.loading} onClick={() => void vm.load()}><RefreshCw aria-hidden="true" /><span>{vm.loading ? "Refreshing…" : "Refresh"}</span></button></header>
    {vm.error ? <RelationshipNotice tone="error">{vm.error}</RelationshipNotice> : null}
    {!data.employee ? <WorkState title="No active employee profile linked" text="Assigned work appears here when an active employee profile is linked to your workspace membership." /> : <>
      <WorkSummary vm={vm} />
      <div className={`mw-register-grid${vm.browse.view === "board" ? " mw-board-layout" : ""}`}><section className="mw-task-register" aria-labelledby="mw-task-heading">
        <div className="mw-register-title"><div><h2 id="mw-task-heading">My tasks</h2><p>{vm.tasks.length} visible · {data.tasks.length} loaded, up to 100</p></div><ViewSwitch vm={vm} /></div>
        <RegisterFilters vm={vm} />
        {vm.browse.view === "list" ? <div className="mw-task-list">{vm.tasks.map(task => <TaskRow key={task.id} task={task} today={data.today} onOpen={vm.openTask} />)}{!vm.tasks.length ? <TaskEmpty vm={vm} /> : null}</div> : <div className="mw-board" aria-label="Tasks grouped by status">{WORK_STATUSES.map(status => {
          const rows = vm.tasks.filter(task => task.status === status);
          return <section key={status} className="mw-board-column"><div className="mw-board-heading"><h3>{workLabel(status)}</h3><span>{rows.length}</span></div><div className="mw-board-cards">{rows.map(task => <BoardTask key={task.id} task={task} today={data.today} onOpen={vm.openTask} />)}{!rows.length ? <p className="mw-board-empty">No tasks</p> : null}</div></section>;
        })}</div>}
        <p className="mw-data-limit">Search, filters and sorting apply to the loaded tasks, not the full assigned-work population.</p>
      </section><MyProjects vm={vm} /></div>
    </>}
  </RelationshipPage>;
}

function WorkSummary({ vm }: RegisterProps) {
  const data = vm.data!;
  return <section className="mw-summary" aria-label="Assigned-work summary"><dl>
    <SummaryItem label="Assigned" value={data.summary.assigned_tasks} />
    <SummaryItem label="Overdue" value={data.summary.overdue_tasks} attention={data.summary.overdue_tasks > 0} />
    <SummaryItem label="Due today" value={data.summary.due_today} />
    <SummaryItem label="Due soon" value={data.summary.due_soon} />
    <SummaryItem label="Open projects" value={data.summary.active_projects} />
  </dl><p>All assigned work{data.today ? ` · ${data.today}` : ""}{data.timezone ? ` · ${data.timezone}` : ""}. Due soon includes today through the next 3 days.</p></section>;
}
function SummaryItem({ label, value, attention = false }: { label: string; value: number; attention?: boolean }) { return <div data-attention={attention}><dt>{label}</dt><dd>{value}</dd></div>; }
function ViewSwitch({ vm }: RegisterProps) { return <div className="mw-view-switch" role="group" aria-label="Task view"><button type="button" aria-pressed={vm.browse.view === "list"} onClick={() => vm.changeBrowse({ view: "list" })}><List aria-hidden="true" />List</button><button type="button" aria-pressed={vm.browse.view === "board"} onClick={() => vm.changeBrowse({ view: "board" })}><Columns3 aria-hidden="true" />Board</button></div>; }
function RegisterFilters({ vm }: RegisterProps) {
  const filtered = vm.browse.status !== "all" || vm.browse.priority !== "all" || vm.browse.sort !== "due";
  return <div className="mw-filters"><form className="mw-search" onSubmit={event => { event.preventDefault(); vm.changeBrowse({ search: vm.queryDraft }); }}><label><span className="sr-only">Search tasks or projects</span><Search aria-hidden="true" /><input type="search" value={vm.queryDraft} onChange={event => vm.setQueryDraft(event.target.value)} placeholder="Search tasks or projects" /></label><button type="submit" aria-label="Apply search"><ArrowRight aria-hidden="true" /></button></form><div className="mw-desktop-filters"><FilterFields vm={vm} /></div><details className="mw-mobile-filters"><summary><SlidersHorizontal aria-hidden="true" /><span>Filters & sort{filtered ? " · Active" : ""}</span></summary><FilterFields vm={vm} /></details>{vm.browse.search || filtered ? <button className="mw-clear-filters" onClick={vm.reset}>Reset filters</button> : null}</div>;
}
function FilterFields({ vm }: RegisterProps) { return <div className="mw-filter-fields"><label><span>Status</span><select value={vm.browse.status} onChange={event => vm.changeBrowse({ status: event.target.value })}><option value="all">All statuses</option>{WORK_STATUSES.map(status => <option key={status} value={status}>{workLabel(status)}</option>)}</select></label><label><span>Priority</span><select value={vm.browse.priority} onChange={event => vm.changeBrowse({ priority: event.target.value })}><option value="all">All priorities</option>{WORK_PRIORITIES.map(priority => <option key={priority} value={priority}>{priority[0].toUpperCase() + priority.slice(1)}</option>)}</select></label><label><span>Sort by</span><select value={vm.browse.sort} onChange={event => vm.changeBrowse({ sort: event.target.value as WorkBrowse["sort"] })}><option value="due">Due date</option><option value="priority">Priority</option><option value="recent">Recently updated</option></select></label></div>; }
function TaskRow({ task, today, onOpen }: { task: WorkTask; today?: string; onOpen: (id: string) => void }) { return <button id={`work-task-${task.id}`} className="mw-task-row" type="button" onClick={() => onOpen(task.id)}>
  <div className="mw-task-identity"><span className="mw-code">{task.task_code}</span><h3>{task.title}</h3><p>{task.project_number} · {task.project_name}{task.milestone_title ? ` · ${task.milestone_title}` : ""}</p><div className="mw-task-timing"><span data-due={workDueKind(task.due_date, today)}><CalendarDays aria-hidden="true" />Due {task.due_date ?? "—"}</span>{task.estimated_minutes ? <span><Timer aria-hidden="true" />Est. {formatWorkMinutes(task.estimated_minutes)}</span> : null}</div></div>
  <div className="mw-task-state"><StatusBadge status={task.status} /><PriorityBadge priority={task.priority} /></div><div className="mw-task-progress"><strong>{task.progress_percent}%</strong><Progress value={task.progress_percent} /></div><ChevronRight className="mw-row-arrow" aria-hidden="true" />
</button>; }
function BoardTask({ task, today, onOpen }: { task: WorkTask; today?: string; onOpen: (id: string) => void }) { return <button id={`work-task-${task.id}`} type="button" className="mw-board-card" onClick={() => onOpen(task.id)}><div><span className="mw-code">{task.task_code}</span><PriorityBadge priority={task.priority} /></div><h4>{task.title}</h4><p>{task.project_number} · {task.project_name}</p><div className="mw-board-card-footer"><span data-due={workDueKind(task.due_date, today)}>{task.due_date ?? "No due date"}</span><strong>{task.progress_percent}%</strong></div></button>; }
function TaskEmpty({ vm }: RegisterProps) { const hasRows = Boolean(vm.data?.tasks.length); return <WorkState compact title={hasRows ? "No tasks match these filters" : "No assigned tasks to show"} text={hasRows ? "Try another search, status or priority." : "Open tasks assigned to your active employee profile will appear here."} action={hasRows ? <button className="mw-secondary" onClick={vm.reset}>Reset filters</button> : undefined} />; }
function MyProjects({ vm }: RegisterProps) { const rows = vm.data!.projects; return <aside className="mw-projects"><div className="mw-section-heading"><p className="mw-eyebrow">Supporting context</p><h2>My projects</h2><p>{rows.length} loaded · up to 50 projects</p></div><div className="mw-project-list">{rows.map(project => <Link key={project.id} href={`/dashboard/projects/${encodeURIComponent(project.id)}`}><span className="mw-code">{project.project_number}</span><h3>{project.name}</h3><div className="mw-project-state"><StatusBadge status={project.status} /><span>{project.priority} priority</span></div><div className="mw-project-progress"><span>Due {project.due_date ?? "—"}</span><strong>{project.progress_percent}%</strong></div><Progress value={project.progress_percent} /></Link>)}{!rows.length ? <p className="mw-empty-note">No open projects assigned.</p> : null}</div></aside>; }

function MyWorkTaskContent() {
  const vm = useMyWorkTask();
  const detail = vm.detail;
  return <RelationshipPage className={`my-work-workspace mw-document-workspace${vm.editing ? " mw-update-workspace" : ""}`}>
    <div className="mw-document-breadcrumb"><button type="button" className="mw-back" onClick={vm.back} disabled={vm.saving}><ArrowLeft aria-hidden="true" />{vm.editing ? "Back to task" : "My Work"}</button><span>{detail?.task.task_code || "Task workspace"}</span></div>
    {vm.loading ? <WorkState loading title="Loading task…" text="Retrieving this task and your permitted activity history." /> : !detail ? <WorkState title="Task unavailable" text={vm.error || "This task is not available in your current workspace."} action={<button className="mw-primary" onClick={() => void vm.load()}>Retry loading</button>} /> : <>
      {vm.editing ? <UpdateHeader detail={detail} /> : <TaskHeader vm={vm} />}
      {vm.error ? <RelationshipNotice tone="error">{vm.error}</RelationshipNotice> : null}
      {vm.saving ? <RelationshipNotice>Saving this work entry. Keep this page open. If the connection is interrupted, verify task activity before retrying.</RelationshipNotice> : null}
      {vm.committed ? <WorkState title="Work update saved" text="This work entry has been recorded. Open the saved result below; do not submit the entry again." action={<button className="mw-primary" onClick={vm.openSaved}>Open saved result</button>} /> : vm.editing ? vm.locked ? <WorkState title="Execution updates are locked" text="This task or its project is completed or cancelled. Its details and activity remain available in the read-only task workspace." action={<button className="mw-secondary" onClick={vm.back}>View task details</button>} /> : <div className="mw-update-grid"><WorkUpdateForm vm={vm} /><TaskContext detail={detail} compact /></div> : <div className="mw-document-grid"><div><TaskContext detail={detail} /><section className="mw-document-panel"><SectionTitle eyebrow="Work brief" title="Task description" /><p className="mw-description">{detail.task.description || "No task description."}</p></section>{vm.locked ? <p className="mw-locked-note">This task or project is closed, so execution updates are locked.</p> : <p className="mw-locked-note">Planning fields such as priority, due date and assignment remain controlled by the project manager.</p>}</div><TaskActivity rows={detail.activity} /></div>}
    </>}
  </RelationshipPage>;
}
function TaskHeader({ vm }: TaskProps) { const detail = vm.detail!; return <header className="mw-document-header"><div><div className="mw-document-status"><span className="mw-code">{detail.task.task_code}</span><StatusBadge status={detail.task.status} /><PriorityBadge priority={detail.task.priority} /></div><h1>{detail.task.title}</h1><ProjectLink task={detail.task} /></div>{!vm.locked ? <button className="mw-primary" onClick={vm.openUpdate}>Update work <ArrowRight aria-hidden="true" /></button> : null}</header>; }
function UpdateHeader({ detail }: { detail: PersonalTaskDetail }) { return <header className="mw-update-header"><p className="mw-eyebrow">Personal execution / {detail.task.task_code}</p><h1>Update work</h1><p><strong>{detail.task.title}</strong><span>{detail.task.project_number} · {detail.task.project_name}</span></p></header>; }
function ProjectLink({ task }: { task: WorkTask }) { return <Link className="mw-project-link" href={`/dashboard/projects/${encodeURIComponent(task.project_id)}`}>{task.project_number} · {task.project_name}<ChevronRight aria-hidden="true" /></Link>; }
function TaskContext({ detail, compact = false }: { detail: PersonalTaskDetail; compact?: boolean }) { return <section className={`mw-document-panel mw-task-context${compact ? " mw-task-context-compact" : ""}`}><SectionTitle eyebrow="Read-only context" title="Task details" /><div className="mw-context-progress"><span>Current progress</span><strong>{detail.task.progress_percent}%</strong></div><Progress value={detail.task.progress_percent} /><dl className="mw-facts"><Fact label="Due date">{detail.task.due_date ?? "No due date"}</Fact><Fact label="Estimate">{formatWorkMinutes(detail.task.estimated_minutes)}</Fact><Fact label="Milestone">{detail.task.milestone_title ?? "No milestone"}</Fact><Fact label="Project status">{workLabel(detail.project_status)}</Fact></dl>{compact ? <><div className="mw-context-current"><StatusBadge status={detail.task.status} /><PriorityBadge priority={detail.task.priority} /></div><p className="mw-context-note">This update records progress, time and a work note. It does not change task planning or assignment.</p><ProjectLink task={detail.task} /></> : null}</section>; }
function WorkUpdateForm({ vm }: TaskProps) { return <form className="mw-update-form" onSubmit={event => { event.preventDefault(); void vm.save(); }}><div className="mw-form-intro"><h2>Record your progress</h2><p>Each save adds a work log entry for your project team.</p></div><fieldset disabled={vm.saving || vm.committed}>
  <div className="mw-form-pair"><label><span>Status</span><select value={vm.values.status} onChange={event => vm.change("status", event.target.value)}><option value="todo">To do</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="review">In review</option><option value="completed">Completed</option></select></label><label><span>Progress %</span><input type="number" min={0} max={100} value={vm.values.progress} onChange={event => vm.change("progress", event.target.value)} /></label></div>
  <label><span>Time spent this update <small>(minutes, optional)</small></span><input type="number" min={0} max={100000} value={vm.values.timeSpent} onChange={event => vm.change("timeSpent", event.target.value)} placeholder="e.g. 60" /></label>
  <label><span>Work note</span><textarea required minLength={2} maxLength={5000} value={vm.values.note} onChange={event => vm.change("note", event.target.value)} placeholder="What did you complete, change or get blocked on?" /></label>
  <p className="mw-form-note">Selecting Completed sets progress to 100%. Saving 100% completes the task; closed tasks cannot be updated from My Work.</p>
  <p className="mw-form-note">If a save is interrupted, check task activity before retrying; the entry may already have been recorded.</p>
  <div className="mw-form-actions"><button type="button" className="mw-secondary" onClick={vm.back}>Cancel</button><button type="submit" className="mw-primary" disabled={vm.saving}><CheckCircle2 aria-hidden="true" />{vm.saving ? "Saving…" : "Save progress"}</button></div>
</fieldset></form>; }
function TaskActivity({ rows }: { rows: WorkActivity[] }) { return <section className="mw-document-panel mw-activity"><SectionTitle eyebrow={`${rows.length} entries loaded`} title="Activity" /><p className="mw-activity-scope">Latest 50 progress entries for this task.</p>{rows.length ? <ol>{rows.map(item => <li key={item.id}><div className="mw-activity-dot" /><article><div className="mw-activity-heading"><h3>{item.employee_name}</h3><strong>{item.progress_percent}%</strong></div><p>{item.note}</p><div className="mw-activity-meta"><time>{new Date(item.created_at).toLocaleString()}</time>{item.time_spent_minutes ? <span>{formatWorkMinutes(item.time_spent_minutes)} logged</span> : null}</div></article></li>)}</ol> : <p className="mw-empty-note">No progress activity yet.</p>}</section>; }
function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) { return <div className="mw-section-heading"><p className="mw-eyebrow">{eyebrow}</p><h2>{title}</h2></div>; }
function Fact({ label, children }: { label: string; children: ReactNode }) { return <div><dt>{label}</dt><dd>{children}</dd></div>; }
function StatusBadge({ status }: { status: string }) { return <span className="mw-status" data-status={status}>{workLabel(status)}</span>; }
function PriorityBadge({ priority }: { priority: string }) { return <span className="mw-priority" data-priority={priority}>{priority}</span>; }
function Progress({ value }: { value: number }) { return <div className="mw-progress" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, Math.min(100, value))}><span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>; }
function WorkState({ title, text, loading = false, compact = false, action }: { title: string; text: string; loading?: boolean; compact?: boolean; action?: ReactNode }) { return <section className={`mw-state${compact ? " mw-state-compact" : ""}`} role={loading ? "status" : undefined} aria-busy={loading || undefined}><h2>{title}</h2><p>{text}</p>{action}</section>; }
