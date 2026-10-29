export type WorkTask = { id:string; project_id:string; project_number:string; project_name:string; task_code:string; milestone_id:string|null; milestone_title:string|null; title:string; description:string|null; status:string; priority:string; progress_percent:number; planned_start_date:string|null; due_date:string|null; estimated_minutes:number|null; completed_at:string|null; updated_at:string };
export type WorkProject = { id:string; project_number:string; name:string; status:string; priority:string; progress_percent:number; due_date:string|null };
export type PersonalWorkspace = { today?:string; timezone?:string; employee:{id:string;employee_code:string}|null; summary:{assigned_tasks:number;overdue_tasks:number;due_today:number;active_projects:number;due_soon:number}; tasks:WorkTask[]; projects:WorkProject[] };
export type WorkActivity = {id:string;employee_name:string;note:string;progress_percent:number;time_spent_minutes:number|null;created_at:string};
export type PersonalTaskDetail = { task:WorkTask; project_status:string; activity:WorkActivity[] };
export type WorkUpdateValues = {progress:string;status:string;note:string;timeSpent:string};
export const WORK_STATUSES = ["todo","in_progress","blocked","review"] as const;
export const WORK_PRIORITIES = ["urgent","high","normal","low"] as const;
export type WorkBrowse = {search:string;status:string;priority:string;sort:"due"|"priority"|"recent";view:"list"|"board";focus:string};
const STATUS_LABELS:Record<string,string> = {todo:"To do",in_progress:"In progress",blocked:"Blocked",review:"In review",completed:"Completed",cancelled:"Cancelled"};
export function workLabel(value:string){ return STATUS_LABELS[value]??value.replaceAll("_"," "); }
export function formatWorkMinutes(value:number|null){if(!value)return "—";const h=Math.floor(value/60),m=value%60;return !h?`${m}m`:m?`${h}h ${m}m`:`${h}h`;}
export function workDueKind(due:string|null,today?:string){return !due||!today?"none":due<today?"overdue":due===today?"today":"upcoming";}
export function workIsLocked(detail:PersonalTaskDetail|null){return !detail||["completed","cancelled"].includes(detail.task.status)||["completed","cancelled"].includes(detail.project_status);}
export function workInitialValues(detail:PersonalTaskDetail|null):WorkUpdateValues {return {progress:String(detail?.task.progress_percent??0),status:detail?.task.status??"todo",note:"",timeSpent:""};}
export function filterWorkTasks(rows:WorkTask[],browse:WorkBrowse){const q=browse.search.trim().toLowerCase();const order:Record<string,number>={urgent:0,high:1,normal:2,low:3};return rows.filter(t=>(!q||`${t.task_code} ${t.title} ${t.project_number} ${t.project_name} ${t.milestone_title??""}`.toLowerCase().includes(q))&&(browse.status==="all"||t.status===browse.status)&&(browse.priority==="all"||t.priority===browse.priority)).sort((a,b)=>{if(browse.sort==="priority"){const p=(order[a.priority]??99)-(order[b.priority]??99);if(p)return p;}if(browse.sort==="recent")return b.updated_at.localeCompare(a.updated_at);return(a.due_date??"9999-12-31").localeCompare(b.due_date??"9999-12-31");});}
export function workUpdatePayload(values:WorkUpdateValues){
 const progress=Number(values.progress),note=values.note.trim();
 if(!values.progress.trim()||!Number.isInteger(progress)||progress<0||progress>100)throw new Error("Progress must be a whole number between 0 and 100.");
 if(note.length<2||note.length>5000)throw new Error("Add a work note between 2 and 5,000 characters.");
 const time=values.timeSpent.trim()?Number(values.timeSpent):null;
 if(time!==null&&(!Number.isInteger(time)||time<0||time>100000))throw new Error("Time spent must be whole minutes between 0 and 100,000.");
 if(![...WORK_STATUSES,"completed"].includes(values.status))throw new Error("Choose an available work status.");
 let status=values.status;if(progress===100)status="completed";else if(status==="completed"||(progress>0&&status==="todo"))status="in_progress";
 return {progress_percent:progress,status,note,time_spent_minutes:time};
}

function workRecord(value:unknown):value is Record<string,unknown>{return typeof value==="object"&&value!==null&&!Array.isArray(value);}
function textOrNull(value:unknown){return value===null||typeof value==="string";}
function finiteNumber(value:unknown){return typeof value==="number"&&Number.isFinite(value);}
export function isWorkTask(value:unknown):value is WorkTask {return workRecord(value)&&["id","project_id","project_number","project_name","task_code","title","status","priority","updated_at"].every(key=>typeof value[key]==="string")&&["milestone_id","milestone_title","description","planned_start_date","due_date","completed_at"].every(key=>textOrNull(value[key]))&&finiteNumber(value.progress_percent)&&(value.estimated_minutes===null||finiteNumber(value.estimated_minutes));}
export function isPersonalWorkspace(value:unknown):value is PersonalWorkspace {
 if(!workRecord(value)||!Array.isArray(value.tasks)||!value.tasks.every(isWorkTask)||!Array.isArray(value.projects)||!workRecord(value.summary))return false;
 const summary=value.summary;if(!["assigned_tasks","overdue_tasks","due_today","active_projects","due_soon"].every(key=>typeof summary[key]==="number"&&Number.isInteger(summary[key])&&Number(summary[key])>=0))return false;
 if(value.employee!==null&&(!workRecord(value.employee)||typeof value.employee.id!=="string"||typeof value.employee.employee_code!=="string"))return false;
 if(value.today!==undefined&&typeof value.today!=="string"||value.timezone!==undefined&&typeof value.timezone!=="string")return false;
 return value.projects.every(p=>workRecord(p)&&["id","project_number","name","status","priority"].every(key=>typeof p[key]==="string")&&finiteNumber(p.progress_percent)&&textOrNull(p.due_date));
}
export function isPersonalTaskDetail(value:unknown):value is PersonalTaskDetail {return workRecord(value)&&isWorkTask(value.task)&&typeof value.project_status==="string"&&Array.isArray(value.activity)&&value.activity.every(a=>workRecord(a)&&["id","employee_name","note","created_at"].every(key=>typeof a[key]==="string")&&finiteNumber(a.progress_percent)&&(a.time_spent_minutes===null||finiteNumber(a.time_spent_minutes)));}
