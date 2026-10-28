"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import type { ProjectWorkspaceState } from "@/hooks/use-project-workspace";
import { allTabIds, defaultMemberTabs, formatBytes, isOverdueDate, pretty, tabs, type CredentialRow, type CredentialValues, type DocumentRow, type EmployeeOption, type MilestoneRow, type ProjectDetail, type ProjectMember, type Tab, type TaskEditValues, type TaskRow } from "./project-model";
import "./project-editors.css";

type DirtyEditorProps = { onDirtyChange: (dirty: boolean) => void };

/** Presentation and ephemeral field state only; routes, permissions and writes are controller-owned. */
export function ProjectEditor({ vm }: { vm: ProjectWorkspaceState }) {
  const { project, workspace, meta, saving, editorMode, selectedMilestone, selectedTask, selectedCredential, selectedDocument } = vm;
  if (!project || !workspace) return null;
  const common = { saving, onClose: vm.closeEditor, onDirtyChange: vm.setFormDirty };
  const canManageExecution = Boolean(project.access.can_manage_project || project.access.is_project_manager);
  const canManageTeam = Boolean(project.access.can_manage_project && meta.can_manage_projects);
  switch (editorMode) {
    case "milestone": return canManageExecution ? <MilestoneEditor {...common} onSave={vm.createMilestone} /> : null;
    case "milestone_edit": return canManageExecution && selectedMilestone ? <EditMilestoneEditor {...common} milestone={selectedMilestone} tasks={workspace.tasks} projectDueDate={project.due_date} onSave={vm.updateMilestone} /> : null;
    case "task": return canManageExecution ? <TaskEditor {...common} milestones={workspace.milestones} members={project.members} onSave={vm.createTask} /> : null;
    case "task_edit": return canManageExecution && selectedTask ? <EditTaskEditor {...common} task={selectedTask} milestones={workspace.milestones} members={project.members} onSave={vm.updateTask} /> : null;
    case "progress": return selectedTask ? <ProgressEditor {...common} task={selectedTask} onSave={vm.updateProgress} /> : null;
    case "document": return canManageExecution ? <DocumentEditor {...common} onSave={vm.uploadDocument} /> : null;
    case "document_edit": return canManageExecution && selectedDocument ? <EditDocumentEditor {...common} document={selectedDocument} onSave={vm.updateDocument} /> : null;
    case "credential": return workspace.can_manage_credentials ? <CredentialEditor {...common} credential={null} error={vm.credentialError} onSave={vm.createCredential} /> : null;
    case "credential_edit": return workspace.can_manage_credentials && selectedCredential ? <CredentialEditor {...common} credential={selectedCredential} error={vm.credentialError} onSave={vm.updateCredential} /> : null;
    case "team": return canManageTeam ? <TeamEditor {...common} project={project} employees={meta.employees} onSave={vm.saveTeam} /> : null;
    default: return null;
  }
}

export const ProjectEditors = ProjectEditor;

function MilestoneEditor({ saving, onClose, onSave, onDirtyChange }: { saving:boolean; onClose:()=>void; onSave:(v:{title:string;description:string;due_date:string})=>Promise<void> } & DirtyEditorProps) {
  const [title,setTitle]=useState("");
  const [description,setDescription]=useState("");
  const [due,setDue]=useState("");
  useEditorDirty([title, description, due], onDirtyChange);
  return <EditorFrame title={"Add milestone"} description="Define a delivery checkpoint for this project." saving={saving} disabled={!title.trim()} onClose={onClose} onSave={() => void onSave({title:title.trim(),description,due_date:due})} summary={
    <EditorContext eyebrow="Delivery checkpoint" title={title || "New milestone"} note="A milestone groups delivery work. Task progress remains in the execution history."><ContextRow label="Due date" value={due || "Not set"} /></EditorContext>
  }>
    <EditorSection number="01" title="Delivery details" description="Give the checkpoint a clear name and delivery date.">
<Field label="Title"><input value={title} onChange={(e)=>setTitle(e.target.value)} className="control" /></Field>
<Field label="Due date"><input type="date" value={due} onChange={(e)=>setDue(e.target.value)} className="control" /></Field>
<Field label="Description"><textarea value={description} onChange={(e)=>setDescription(e.target.value)} className="textarea" /></Field>
</EditorSection>
  </EditorFrame>;
}

function EditMilestoneEditor({ saving, milestone, tasks, projectDueDate, onClose, onSave, onDirtyChange }: { saving:boolean; milestone:MilestoneRow; tasks:TaskRow[]; projectDueDate:string|null; onClose:()=>void; onSave:(v:{title:string;description:string;due_date:string})=>Promise<void> } & DirtyEditorProps) {
  const [title,setTitle]=useState(milestone.title);
  const [description,setDescription]=useState(milestone.description || "");
  const [due,setDue]=useState(milestone.due_date || "");
  const activeTaskDates=tasks.filter((task)=>task.milestone_id===milestone.id && task.due_date && !["completed","cancelled"].includes(task.status)).map((task)=>task.due_date as string).sort();
  const latestTaskDue=activeTaskDates.at(-1) || null;
  const changed=due !== (milestone.due_date || "");
  const taskConflict=Boolean(due && latestTaskDue && latestTaskDue > due);
  const projectConflict=Boolean(due && projectDueDate && due > projectDueDate);
  useEditorDirty([title, description, due], onDirtyChange);
  return <EditorFrame title={"Edit milestone"} description="Update the milestone details without changing its execution history." saving={saving} disabled={!title.trim()} onClose={onClose} onSave={() => void onSave({title:title.trim(),description,due_date:due})} summary={
    <EditorContext eyebrow="Current milestone" title={milestone.title} note="Changing a delivery date does not rewrite work logs. Any schedule conflicts are shown beside the form."><ContextRow label="Status" value={pretty(milestone.status)} /><ContextRow label="Current due date" value={milestone.due_date || "Not set"} /><ContextRow label="Progress" value={`${milestone.progress_percent}%`} /><ContextRow label="Project due date" value={projectDueDate || "Not set"} /></EditorContext>
  }>
    {changed ? <div className="project-editor-notice">Schedule change: <span className="font-semibold">{milestone.due_date || "Not set"}</span> → <span className="font-semibold">{due || "Not set"}</span>. Saving will refresh project schedule and overdue indicators automatically.</div> : null}
{taskConflict ? <div className="project-editor-notice project-editor-notice-warning">Some active tasks under this milestone are due as late as <span className="font-semibold">{latestTaskDue}</span>. Consider rescheduling those tasks too so the plan stays consistent.</div> : null}
{projectConflict ? <div className="project-editor-notice project-editor-notice-warning">This milestone would extend beyond the project due date <span className="font-semibold">{projectDueDate}</span>. Review the overall project delivery date as well.</div> : null}<EditorSection number="01" title="Delivery details" description="Review the existing task and project schedule before changing the due date.">
<Field label="Milestone title"><input value={title} maxLength={220} onChange={(e)=>setTitle(e.target.value)} className="control" /></Field>
<Field label="Delivery / due date"><input type="date" value={due} onChange={(e)=>setDue(e.target.value)} className="control" /></Field>
<Field label="Description"><textarea value={description} onChange={(e)=>setDescription(e.target.value)} className="textarea" /></Field>
</EditorSection>
  </EditorFrame>;
}

function TaskEditor({ saving, milestones, members, onClose, onSave, onDirtyChange }: { saving:boolean; milestones:MilestoneRow[]; members:ProjectMember[]; onClose:()=>void; onSave:(v:TaskEditValues)=>Promise<void> } & DirtyEditorProps) {
  const [title,setTitle]=useState("");
  const [description,setDescription]=useState("");
  const [milestone,setMilestone]=useState("");
  const [priority,setPriority]=useState("normal");
  const [assignee,setAssignee]=useState("");
  const [start,setStart]=useState("");
  const [due,setDue]=useState("");
  const [hours,setHours]=useState("");
  useEditorDirty([title, description, milestone, priority, assignee, start, due, hours], onDirtyChange);
  return <EditorFrame title={"Add task"} description="Keep ownership, scheduling and scope together in one document." saving={saving} disabled={!title.trim()} onClose={onClose} onSave={() => void onSave({title:title.trim(),description,milestone_id:milestone,priority,assignee_employee_id:assignee,planned_start_date:start,due_date:due,estimated_hours:hours})} summary={
    <EditorContext eyebrow="Project task" title={title || "New task"} note="Estimates support planning. Time actually worked is recorded separately through Update Work."><ContextRow label="Priority" value={pretty(priority)} /><ContextRow label="Assigned to" value={members.find((member) => member.employee_id === assignee)?.full_name || "Unassigned"} /><ContextRow label="Due date" value={due || "Not set"} /><ContextRow label="Estimated hours" value={hours || "Not entered"} /></EditorContext>
  }>
    <EditorSection number="01" title="Task & ownership" description="Name the work and choose who will deliver it.">
<Field label="Task title"><input value={title} onChange={(e)=>setTitle(e.target.value)} className="control" /></Field>
<Field label="Milestone"><select value={milestone} onChange={(e)=>setMilestone(e.target.value)} className="control"><option value="">No milestone</option>{milestones.map((m)=><option key={m.id} value={m.id}>{m.title}</option>)}</select></Field>
<Field label="Assignee"><select value={assignee} onChange={(e)=>setAssignee(e.target.value)} className="control"><option value="">Unassigned</option>{members.map((m)=><option key={m.employee_id} value={m.employee_id}>{m.full_name}</option>)}</select></Field>
<Field label="Priority"><select value={priority} onChange={(e)=>setPriority(e.target.value)} className="control"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></Field>
</EditorSection>
<EditorSection number="02" title="Schedule & estimate" description="Set the planned dates and estimated effort in hours.">
<Field label="Planned start"><input type="date" value={start} onChange={(e)=>setStart(e.target.value)} className="control" /></Field>
<Field label="Due date"><input type="date" value={due} onChange={(e)=>setDue(e.target.value)} className="control" /></Field>
<Field label="Estimated hours"><input type="number" min="0" step="0.25" value={hours} onChange={(e)=>setHours(e.target.value)} className="control" /></Field>
</EditorSection>
<EditorSection number="03" title="Scope of work" description="Describe the expected outcome and useful delivery context.">
<label className="sm:col-span-2 text-sm font-medium">Description<textarea value={description} onChange={(e)=>setDescription(e.target.value)} className="textarea" /></label>
</EditorSection>
  </EditorFrame>;
}

function EditTaskEditor({ saving, task, milestones, members, onClose, onSave, onDirtyChange }: { saving:boolean; task:TaskRow; milestones:MilestoneRow[]; members:ProjectMember[]; onClose:()=>void; onSave:(v:TaskEditValues)=>Promise<void> } & DirtyEditorProps) {
  const [title,setTitle]=useState(task.title);
  const [description,setDescription]=useState(task.description || "");
  const [milestone,setMilestone]=useState(task.milestone_id || "");
  const [priority,setPriority]=useState(task.priority);
  const [assignee,setAssignee]=useState(task.assignee_employee_id || "");
  const [start,setStart]=useState(task.planned_start_date || "");
  const [due,setDue]=useState(task.due_date || "");
  const [hours,setHours]=useState(task.estimated_minutes === null ? "" : String(task.estimated_minutes / 60));
  const selectedMilestone=milestones.find((item)=>item.id===milestone) || null;
  const invalidRange=Boolean(start && due && due < start);
  const milestoneConflict=Boolean(due && selectedMilestone?.due_date && due > selectedMilestone.due_date);
  const dueChanged=due !== (task.due_date || "");
  const wasOverdue=isOverdueDate(task.due_date, task.status);
  useEditorDirty([title, description, milestone, priority, assignee, start, due, hours], onDirtyChange);
  return <EditorFrame title={`Edit task · ${task.task_code}`} description="Keep ownership, scheduling and scope together in one document." saving={saving} disabled={!title.trim() || invalidRange} onClose={onClose} onSave={() => void onSave({title:title.trim(),description,milestone_id:milestone,priority,assignee_employee_id:assignee,planned_start_date:start,due_date:due,estimated_hours:hours})} summary={
    <EditorContext eyebrow={task.task_code} title={task.title} note="This page edits task details and scheduling. Use Update Work to record progress, status and time."><ContextRow label="Status" value={pretty(task.status)} /><ContextRow label="Current progress" value={`${task.progress_percent}%`} /><ContextRow label="Assigned to" value={task.assignee_name || "Unassigned"} /><ContextRow label="Current due date" value={task.due_date || "Not set"} /></EditorContext>
  }>
    {dueChanged ? <div className="project-editor-notice">Due date: <span className="font-semibold">{task.due_date || "Not set"}</span> → <span className="font-semibold">{due || "Not set"}</span>. {wasOverdue ? "If the new date is current or future, the Overdue count will clear automatically after save." : "Project overdue indicators will refresh automatically after save."}</div> : null}
{invalidRange ? <div className="project-editor-notice project-editor-notice-error">Due date cannot be before the planned start date.</div> : null}
{milestoneConflict ? <div className="project-editor-notice project-editor-notice-warning">This task would be due after its milestone delivery date <span className="font-semibold">{selectedMilestone?.due_date}</span>. Consider extending the milestone too.</div> : null}<EditorSection number="01" title="Task & ownership" description="Name the work and choose who will deliver it.">
<Field label="Task title"><input value={title} maxLength={220} onChange={(e)=>setTitle(e.target.value)} className="control" /></Field>
<Field label="Milestone"><select value={milestone} onChange={(e)=>setMilestone(e.target.value)} className="control"><option value="">No milestone</option>{milestones.map((m)=><option key={m.id} value={m.id}>{m.title}</option>)}</select></Field>
<Field label="Assignee"><select value={assignee} onChange={(e)=>setAssignee(e.target.value)} className="control"><option value="">Unassigned</option>{members.map((m)=><option key={m.employee_id} value={m.employee_id}>{m.full_name}</option>)}</select></Field>
<Field label="Priority"><select value={priority} onChange={(e)=>setPriority(e.target.value)} className="control"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></Field>
</EditorSection>
<EditorSection number="02" title="Schedule & estimate" description="Set the planned dates and estimated effort in hours.">
<Field label="Planned start"><input type="date" value={start} onChange={(e)=>setStart(e.target.value)} className="control" /></Field>
<Field label={wasOverdue ? "Reschedule due date" : "Due date"}><input type="date" value={due} onChange={(e)=>setDue(e.target.value)} className="control" /></Field>
<Field label="Estimated hours"><input type="number" min="0" step="0.25" value={hours} onChange={(e)=>setHours(e.target.value)} className="control" /></Field>
</EditorSection>
<EditorSection number="03" title="Scope of work" description="Describe the expected outcome and useful delivery context.">
<label className="sm:col-span-2 text-sm font-medium">Description<textarea value={description} onChange={(e)=>setDescription(e.target.value)} className="textarea" /></label>
</EditorSection>
<div className="project-editor-note">Schedule details are separate from execution history. Use <span className="font-semibold text-neutral-700">Update Work</span> for progress/status/time entries; those work logs remain historical records.</div>
  </EditorFrame>;
}

function ProgressEditor({ saving, task, onClose, onSave, onDirtyChange }: { saving:boolean; task:TaskRow; onClose:()=>void; onSave:(v:{progress:number;note:string;status:string;time_hours:string})=>Promise<void> } & DirtyEditorProps) {
  const [progress,setProgress]=useState(task.progress_percent);
  const [note,setNote]=useState("");
  const [status,setStatus]=useState("");
  const [hours,setHours]=useState("");
  useEditorDirty([progress, note, status, hours], onDirtyChange);
  return <EditorFrame title={`Update work · ${task.task_code}`} description="Record progress and the work completed on this task." saving={saving} disabled={note.trim().length < 2} onClose={onClose} onSave={() => void onSave({progress,note:note.trim(),status,time_hours:hours})} summary={
    <EditorContext eyebrow={task.task_code} title={task.title} note="Saving creates a work update. Describe what changed, including blockers or the next step."><ContextRow label="Current progress" value={`${task.progress_percent}%`} /><ContextRow label="Current status" value={pretty(task.status)} /><ContextRow label="Assigned to" value={task.assignee_name || "Unassigned"} /></EditorContext>
  }>
    {task.status === "completed" && progress < 100 ? <div className="project-editor-notice">Saving progress below 100% reopens this task with the selected work status, or the automatic status. This does not reopen the project.</div> : null}
    <EditorSection number="01" title="Progress & status" description="Update completion and the current work state.">
<Field label={`Progress · ${progress}%`}><input type="range" min="0" max="100" step="5" value={progress} onChange={(e)=>setProgress(Number(e.target.value))} className="mt-3 w-full" /></Field>
<Field label="Work status"><select value={status} onChange={(e)=>setStatus(e.target.value)} className="control"><option value="">Keep / automatic</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="review">Ready for review</option></select></Field>
</EditorSection>
<EditorSection number="02" title="Work entry" description="Record time spent and a clear description of the work.">
<Field label="Time spent (hours)"><input type="number" min="0" step="0.25" value={hours} onChange={(e)=>setHours(e.target.value)} className="control" /></Field>
<Field label="What did you work on?"><textarea value={note} onChange={(e)=>setNote(e.target.value)} placeholder="Describe what changed, what is done, blockers, or what comes next..." className="textarea" /></Field>
</EditorSection>
  </EditorFrame>;
}

function DocumentEditor({ saving, onClose, onSave, onDirtyChange }: { saving:boolean; onClose:()=>void; onSave:(v:{title:string;document_type:string;notes:string;file:File|null})=>Promise<void> } & DirtyEditorProps) {
  const [title,setTitle]=useState("");
  const [type,setType]=useState("other");
  const [notes,setNotes]=useState("");
  const [file,setFile]=useState<File|null>(null);
  useEditorDirty([title, type, notes, file], onDirtyChange);
  return <EditorFrame title={"Upload project document"} description="Keep the file, its purpose and supporting notes together." saving={saving} disabled={!title.trim() || !file} onClose={onClose} onSave={() => void onSave({title:title.trim(),document_type:type,notes,file})} summary={
    <EditorContext eyebrow="Project document" title={title || "New document"} note="The selected file is uploaded only when you save. Leaving this page discards the unsaved selection."><ContextRow label="Document type" value={pretty(type)} /><ContextRow label="Selected file" value={file?.name || "No file selected"} />{file ? <ContextRow label="File size" value={formatBytes(file.size)} /> : null}</EditorContext>
  }>
    <EditorSection number="01" title="Document identity" description="Use a recognizable title and the existing document classification.">
<Field label="Title"><input value={title} onChange={(e)=>setTitle(e.target.value)} className="control" /></Field>
<Field label="Document type"><select value={type} onChange={(e)=>setType(e.target.value)} className="control"><option value="requirement">Requirement</option><option value="contract">Contract</option><option value="design">Design</option><option value="technical">Technical</option><option value="delivery">Delivery</option><option value="other">Other</option></select></Field>
</EditorSection>
<EditorSection number="02" title="File & notes" description="Select the file to upload and add useful context.">
<Field label="File"><input type="file" onChange={(e)=>setFile(e.target.files?.[0] || null)} className="control py-2" /></Field>
<Field label="Notes"><textarea value={notes} onChange={(e)=>setNotes(e.target.value)} className="textarea" /></Field>
</EditorSection>
  </EditorFrame>;
}

function CredentialEditor({ error, saving, credential, onClose, onSave, onDirtyChange }: { error:string|null; saving:boolean; credential:CredentialRow|null; onClose:()=>void; onSave:(v:CredentialValues)=>Promise<void> } & DirtyEditorProps) {
  const [name,setName]=useState(credential?.name || "");
  const [type,setType]=useState(credential?.credential_type || "login");
  const [env,setEnv]=useState(credential?.environment || "production");
  const [username,setUsername]=useState(credential?.username || "");
  const [secret,setSecret]=useState("");
  const [url,setUrl]=useState(credential?.url || "");
  const [notes,setNotes]=useState(credential?.notes || "");
  const [access,setAccess]=useState(credential?.access_level || "manager_only");
  useEditorDirty([name, type, env, username, secret, url, notes, access], onDirtyChange);
  return <EditorFrame title={credential ? "Edit credential" : "Add credential"} description="Keep the credential purpose and intended access clear." saving={saving} disabled={!name.trim() || (!credential && !secret)} onClose={onClose} onSave={() => void onSave({name:name.trim(),credential_type:type,environment:env,username,secret,url,notes,access_level:access})} summary={
    <EditorContext eyebrow="Credential details" title={name || "Project credential"} note={credential ? "The current secret is not loaded into this editor. Leave the new secret blank to keep it unchanged." : "A new credential requires a secret. Choose the access level deliberately before saving."}><ContextRow label="Type" value={pretty(type)} /><ContextRow label="Environment" value={pretty(env)} /><ContextRow label="Access" value={access === "manager_only" ? "Project manager only" : "Project team"} /></EditorContext>
  }>
    {error ? <div className="project-editor-notice project-editor-notice-error"><p className="font-semibold">Credential could not be saved</p><p className="mt-1 leading-5">{error}</p></div> : null}<EditorSection number="01" title="Identity & access" description="Choose the credential type, environment and who can access it.">
<Field label="Name"><input value={name} onChange={(e)=>setName(e.target.value)} className="control" /></Field>
<Field label="Type"><select value={type} onChange={(e)=>setType(e.target.value)} className="control"><option value="login">Login</option><option value="api_key">API Key</option><option value="database">Database</option><option value="ssh">SSH / Server</option><option value="hosting">Hosting</option><option value="domain">Domain</option><option value="other">Other</option></select></Field>
<Field label="Environment"><select value={env} onChange={(e)=>setEnv(e.target.value)} className="control"><option value="production">Production</option><option value="staging">Staging</option><option value="development">Development</option><option value="other">Other</option></select></Field>
<Field label="Access"><select value={access} onChange={(e)=>setAccess(e.target.value)} className="control"><option value="manager_only">Project manager only</option><option value="team">Project team</option></select></Field>
</EditorSection>
<EditorSection number="02" title="Connection details" description="Enter the username and secret without exposing them in a document summary.">
<Field label="Username / Email"><input value={username} onChange={(e)=>setUsername(e.target.value)} className="control" /></Field>
<Field label={credential ? "New Secret / Password / Key (optional)" : "Secret / Password / Key"}><input type="password" autoComplete="new-password" value={secret} onChange={(e)=>setSecret(e.target.value)} placeholder={credential ? "Leave blank to keep current secret" : ""} className="control" /></Field>
<label className="sm:col-span-2 text-sm font-medium">URL<input value={url} onChange={(e)=>setUrl(e.target.value)} className="control" /></label>
</EditorSection>
<EditorSection number="03" title="Supporting notes" description="Add context without repeating the secret in plain text.">
<label className="sm:col-span-2 text-sm font-medium">Notes<textarea value={notes} onChange={(e)=>setNotes(e.target.value)} className="textarea" /></label>
</EditorSection>
  </EditorFrame>;
}

function TeamEditor({ saving, project, employees, onClose, onSave, onDirtyChange }: { saving:boolean; project:ProjectDetail; employees:EmployeeOption[]; onClose:()=>void; onSave:(manager:string,members:string[],permissions:Record<string,Tab[]>)=>Promise<void> } & DirtyEditorProps) {
  const [manager,setManager]=useState(project.project_manager_employee_id || project.members.find((m)=>m.role_label==="Project Manager")?.employee_id || "");
  const [selected,setSelected]=useState(project.members.map((m)=>m.employee_id));
  const [permissions,setPermissions]=useState<Record<string,Tab[]>>(() => Object.fromEntries(project.members.map((member) => [member.employee_id, member.tab_permissions.length ? member.tab_permissions : [...defaultMemberTabs]])));
  function selectEmployee(employeeId: string, checked: boolean) {
    if (checked) {
      setSelected((current) => [...new Set([...current, employeeId])]);
      setPermissions((current) => current[employeeId] ? current : { ...current, [employeeId]: [...defaultMemberTabs] });
    } else if (employeeId !== manager) {
      setSelected((current) => current.filter((id) => id !== employeeId));
    }
  }
  function togglePermission(employeeId: string, permission: Tab, checked: boolean) {
    setPermissions((current) => {
      const existing = current[employeeId] ?? [...defaultMemberTabs];
      if (checked) return { ...current, [employeeId]: [...new Set([...existing, permission])] };
      if (existing.length <= 1) return current;
      return { ...current, [employeeId]: existing.filter((item) => item !== permission) };
    });
  }
  function save() {
    const memberPermissions: Record<string, Tab[]> = {};
    selected.forEach((employeeId) => {
      memberPermissions[employeeId] = employeeId === manager ? [...allTabIds] : permissions[employeeId] ?? [...defaultMemberTabs];
    });
    void onSave(manager, selected, memberPermissions);
  }
  useEditorDirty([manager, [...selected].sort().join("\u0000"), JSON.stringify([...selected].sort().map((id) => [id, [...(id === manager ? allTabIds : permissions[id] ?? defaultMemberTabs)].sort()]))], onDirtyChange);
  return <EditorFrame title={"Manage project team & access"} description="Set project ownership and each team member’s visible workspace sections." saving={saving} disabled={false} onClose={onClose} onSave={save} summary={
    <EditorContext eyebrow="Team access" title={project.name} note="The project manager always has full project access. Other selected members keep at least one tab permission."><ContextRow label="Project manager" value={employees.find((employee) => employee.id === manager)?.full_name || "Unassigned"} /><ContextRow label="Selected members" value={selected.length} /></EditorContext>
  }>
    <EditorSection number="01" title="Project manager" description="The manager has full project access.">
<Field label="Project manager"><select value={manager} onChange={(e)=>{const id=e.target.value;setManager(id);if(id){setSelected((current)=>[...new Set([...current,id])]);setPermissions((current)=>({...current,[id]:[...allTabIds]}));}}} className="control"><option value="">Unassigned</option>{employees.map((e)=><option key={e.id} value={e.id}>{e.full_name} · {e.employee_code}</option>)}</select></Field>
</EditorSection>
<div className="project-editor-team">
      <div className="project-editor-team-intro"><p className="text-sm font-semibold">Team members & tab access</p><p className="mt-1 text-xs text-neutral-500">Select a member, then choose which Project tabs they can open. The project manager always has full Project access.</p></div>
      <div className="project-editor-team-list">{employees.map((employee)=>{
        const isManager=manager===employee.id; const isSelected=selected.includes(employee.id)||isManager; const employeePermissions=isManager?allTabIds:(permissions[employee.id]??defaultMemberTabs);
        return <div key={employee.id} className="project-editor-member"><label className="project-editor-member-choice"><input type="checkbox" checked={isSelected} disabled={isManager} onChange={(event)=>selectEmployee(employee.id,event.target.checked)}/><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{employee.full_name}</span><span className="text-xs text-neutral-400">{employee.employee_code}</span></span>{isManager?<span className="rounded-full bg-neutral-950 px-2.5 py-1 text-[10px] font-semibold text-white">Full access</span>:null}</label>{isSelected?<div className="project-editor-permissions">{tabs.map((item)=><label key={item.id} className={`project-editor-permission ${isManager ? "project-editor-permission-locked" : ""}`}><input type="checkbox" checked={employeePermissions.includes(item.id)} disabled={isManager} onChange={(event)=>togglePermission(employee.id,item.id,event.target.checked)}/><span>{item.label}</span></label>)}</div>:null}</div>;
      })}</div>
    </div>
  </EditorFrame>;
}

function EditDocumentEditor({ document, saving, onClose, onSave, onDirtyChange }: { document: DocumentRow; saving: boolean; onClose: () => void; onSave: (values: { title: string; document_type: string; notes: string }) => Promise<void> } & DirtyEditorProps) {
  const [title, setTitle] = useState(document.title);
  const [documentType, setDocumentType] = useState(document.document_type);
  const [notes, setNotes] = useState(document.notes || "");
  useEditorDirty([title, documentType, notes], onDirtyChange);
  return <EditorFrame title="Edit project document" description="Update the document metadata without replacing the uploaded file." saving={saving} disabled={!title.trim() || !documentType.trim()} onClose={onClose} onSave={() => void onSave({ title, document_type: documentType, notes })} summary={
    <EditorContext eyebrow="Uploaded file" title={document.original_filename} note="The uploaded file stays unchanged. Only the document metadata is edited here."><ContextRow label="File size" value={formatBytes(document.size_bytes)} /><ContextRow label="Current type" value={pretty(document.document_type)} /></EditorContext>
  }>
    <EditorSection number="01" title="Document metadata" description="Keep the title, classification and notes useful for the project team.">
      <Field label="Title"><input value={title} maxLength={180} onChange={(event) => setTitle(event.target.value)} className="control" /></Field>
      <Field label="Document type"><input value={documentType} maxLength={64} onChange={(event) => setDocumentType(event.target.value)} className="control" placeholder="technical, delivery, certificate..." /></Field>
      <Field label="Notes"><textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="textarea" /></Field>
    </EditorSection>
  </EditorFrame>;
}

/** Compare ephemeral values only. No draft, file bytes or credential is written to storage. */
function useEditorDirty(values: readonly unknown[], onDirtyChange: (dirty: boolean) => void) {
  const [initial] = useState(() => [...values]);
  const dirty = values.length !== initial.length || values.some((value, index) => !Object.is(value, initial[index]));
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
}

function EditorFrame({ title, description, saving, disabled, onClose, onSave, summary, children }: { title: string; description: string; saving: boolean; disabled: boolean; onClose: () => void; onSave: () => void; summary: ReactNode; children: ReactNode }) {
  const titleId = useId();
  return <form className="project-editor" aria-labelledby={titleId} aria-busy={saving} noValidate onSubmit={(event) => { event.preventDefault(); if (!saving && !disabled) onSave(); }}>
    <header className="project-editor-heading"><p>Project workspace</p><h1 id={titleId}>{title}</h1><span>{description}</span></header>
    <fieldset className="project-editor-fieldset" disabled={saving}>
      <legend className="sr-only">{title} fields</legend>
      <div className="project-editor-layout"><div className="project-editor-main">{children}</div>{summary}</div>
      <footer className="project-editor-footer">
        <p role={saving ? "status" : undefined}>{saving ? "Saving… If you leave now, check the record before retrying because the result may be uncertain." : "Review the details before saving this project change."}</p>
        <div><button type="button" className="project-editor-secondary" disabled={saving} onClick={onClose}>Cancel</button><button type="submit" className="project-editor-primary" disabled={saving || disabled}>{saving ? "Saving..." : "Save"}</button></div>
      </footer>
    </fieldset>
  </form>;
}

function EditorSection({ number, title, description, children }: { number: string; title: string; description: string; children: ReactNode }) {
  const titleId = useId();
  return <section className="project-editor-section" aria-labelledby={titleId}><header><span aria-hidden="true">{number}</span><div><h2 id={titleId}>{title}</h2><p>{description}</p></div></header><div className="project-editor-fields">{children}</div></section>;
}

function EditorContext({ eyebrow, title, note, children }: { eyebrow: string; title: string; note: string; children: ReactNode }) {
  return <aside className="project-editor-context" aria-label={eyebrow}><header><p>{eyebrow}</p><h2>{title}</h2></header><dl>{children}</dl><p className="project-editor-context-note">{note}</p></aside>;
}

function ContextRow({ label, value }: { label: string; value: ReactNode }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="project-editor-field"><span>{label}</span>{children}</label>;
}
