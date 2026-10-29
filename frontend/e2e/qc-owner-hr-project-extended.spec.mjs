import { captureJsonResponse } from './support/capture-json-response.mjs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
// Owner-admin routes only. No self-service, invitations, real mail or payment rails.
const email=process.env.E2E_QC_HR_PROJECT_EMAIL ?? 'qc-hr-project@example.com';
const password=process.env.E2E_PASSWORD ?? 'E2E-Launch-Password-123!';
const today=new Date().toISOString().slice(0,10);
const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
async function json(r){const text=await r.text();expect(r.ok(),`${r.status()} ${text}`).toBeTruthy();return JSON.parse(text);}
async function get(p,path){return json(await p.request.get('/api'+path));}
async function post(p,path,data){return json(await p.request.post('/api'+path,{data}));}
async function setup(p,label){
 p.setDefaultTimeout(15000);
 expect(['127.0.0.1','localhost']).toContain(new URL(process.env.E2E_BASE_URL??'http://localhost:3000').hostname);
 await post(p,'/auth/login',{email,password});
 const workspace=await post(p,'/organizations',{name:`QC ${label} ${randomUUID().slice(0,8)}`,currency:'USD',country_code:'US',timezone:'UTC'});
 expect(workspace.is_owner).toBe(true);
 return (await get(p,'/hr/people')).people[0];
}
async function submit(p,name,path,method='POST'){
 return captureJsonResponse(p,{path:'/api'+path,method,action:()=>p.getByRole('button',{name,exact:true}).last().click()});
}
async function choose(p,label,option){await p.getByRole('button',{name:label,exact:true}).click();await p.getByRole('listbox').getByRole('button',{name:option}).click();}

test('PRJ01-11 PRJ13-14 owner execution, rollups, notes, locks and document metadata',async({page:p},info)=>{
 test.setTimeout(210000); const employee=await setup(p,'project extended');
 const client=await post(p,'/crm/clients',{display_name:'Synthetic project client',currency:'USD'});
 const order=await post(p,'/sales/orders',{client_id:client.id,subject:'Synthetic project',order_date:today,currency:'USD',items:[{item_name:'QC service',description:'Synthetic QC service',item_type:'service',quantity:'1',unit_price:'10'}]});
 p.on('dialog',dialog=>dialog.accept());
 await p.goto(`/dashboard/orders/${order.id}`);
 await submit(p,'Start order',`/sales/orders/${order.id}/status`,'PATCH');await submit(p,'Complete order',`/sales/orders/${order.id}/status`,'PATCH');
 const completedOrder=await get(p,`/sales/orders/${order.id}`);
 await submit(p,'Reopen order',`/sales/orders/${order.id}/status`,'PATCH');expect((await get(p,`/sales/orders/${order.id}`)).status).toBe('in_progress');
 await p.getByRole('link',{name:'Project workspace',exact:true}).click();
 await p.getByRole('button',{name:'Create project',exact:true}).click();
 await p.getByLabel('Project name',{exact:true}).fill('Synthetic owner execution');await p.getByRole('combobox',{name:'Priority',exact:true}).selectOption('high');
 await choose(p,'Project manager',employee.full_name);
 await p.getByLabel('Due date',{exact:true}).fill('2026-12-31');
 const project=await submit(p,'Create project',`/projects/from-order/${order.id}`);
 expect(project.due_date).toBe('2026-12-31');expect(project.priority).toBe('high');console.log('PASS PRJ01-02 native owner project creation/handoff and due date');
 const root=`/projects/${project.id}`;
 await p.goto('/dashboard'+root);
 await p.getByRole('button',{name:'Review & Tips',exact:true}).click();
 await expect(p.getByText('Review & Tips unlock after project completion',{exact:true})).toBeVisible();await expect(p.getByRole('button',{name:'Add review',exact:true})).toHaveCount(0);
 await p.getByRole('button',{name:'Milestones',exact:true}).click();
 await p.getByRole('button',{name:'Add milestone',exact:true}).click();
 await p.getByLabel('Title',{exact:true}).fill('QC milestone');
 await p.getByLabel('Due date',{exact:true}).fill('2026-12-20');
 const milestone=await submit(p,'Save',root+'/milestones');
 expect(milestone.due_date).toBe('2026-12-20');
 await p.getByRole('button',{name:'Edit schedule',exact:true}).click();
 await p.getByLabel('Milestone title',{exact:true}).fill('QC milestone revised');
 await submit(p,'Save',root+`/milestones/${milestone.id}`,'PATCH');
 await p.getByRole('button',{name:'Tasks',exact:true}).click();
 await p.getByRole('button',{name:'Add task',exact:true}).click();
 await p.getByLabel('Task title',{exact:true}).fill('QC owner task');
 await p.getByRole('combobox',{name:'Milestone',exact:true}).selectOption(milestone.id);
 await p.getByRole('combobox',{name:'Assignee',exact:true}).selectOption(employee.id);
 await p.getByRole('combobox',{name:'Priority',exact:true}).selectOption('urgent');
 await p.getByLabel('Due date',{exact:true}).fill(yesterday);
 await p.getByLabel('Estimated hours',{exact:true}).fill('2.5');
 const task=await submit(p,'Save',root+'/tasks');
 expect(task.estimated_minutes).toBe(150);expect(task.due_date).toBe(yesterday);expect(task.priority).toBe('urgent');expect(task.status).toBe('todo');expect((await get(p,root+'/workspace')).summary.overdue_task_count).toBe(1);expect(task.assignee_employee_id).toBe(employee.id);
 for(const [progress,status,note,hours] of [[25,'blocked','QC blocked checkpoint','0.25'],[50,'review','QC review checkpoint',''],[100,'','QC completed checkpoint','']]){
  await p.getByRole('button',{name:'Update work',exact:true}).click();
  await p.getByRole('slider').focus();await p.getByRole('slider').press('Home');for(let step=0;step<progress/5;step++)await p.getByRole('slider').press('ArrowRight');
  await p.getByRole('combobox',{name:'Work status',exact:true}).selectOption(status);
  await p.getByLabel('Time spent (hours)',{exact:true}).fill(hours);
  await p.getByLabel('What did you work on?',{exact:true}).fill(note);
  await submit(p,'Save',root+`/tasks/${task.id}/progress`);
  const state=await get(p,root+'/workspace');
  expect(state.summary.progress_percent).toBe(progress);expect(state.milestones[0].progress_percent).toBe(progress);
  expect(state.tasks[0].status).toBe(progress===100?'completed':status);
 }
 const workspace=await get(p,root+'/workspace');
 expect(workspace.milestones[0].status).toBe('completed');expect(workspace.milestones[0].title).toBe('QC milestone revised');expect(workspace.milestones[0].due_date).toBe('2026-12-20');
 expect(workspace.recent_work).toHaveLength(3);expect(workspace.recent_work.map(x=>x.note).sort()).toEqual(['QC blocked checkpoint','QC completed checkpoint','QC review checkpoint']);
 const audit=(await get(p,'/tenant/activity-logs?action=projects.task.progress_updated&entity_type=project_task')).items.filter(x=>x.entity_id===task.id);expect(audit).toHaveLength(3);
 const audits=await Promise.all(audit.map(x=>get(p,`/tenant/activity-logs/${x.id}`)));expect(audits.map(x=>x.after_data.progress_percent).sort((a,b)=>a-b)).toEqual([25,50,100]);for(const row of audits){expect(row.outcome).toBe('success');expect(row.metadata_json.work_log_id).toBeTruthy();}
expect(workspace.recent_work.find(x=>x.progress_percent===25).time_spent_minutes).toBe(15);console.log('PASS PRJ03-07 owner milestone/task creation, 25/50/100 work updates, 15-minute log, rollups and milestone rename/date readback');
 await p.getByRole('button',{name:'Notes',exact:true}).click();await p.getByRole('button',{name:'Add note',exact:true}).click();
 await p.getByLabel('Title',{exact:true}).fill('QC handoff note');await p.getByLabel('Content',{exact:true}).fill('Synthetic project-only note');
 await submit(p,'Add note',root+'/notes');
 expect((await get(p,root+'/notes'))[0].content).toBe('Synthetic project-only note');
 await p.getByRole('button',{name:'Team',exact:true}).click();await expect(p.locator('body')).toContainText(employee.employee_code);
 const detail=await get(p,root);expect(detail.members).toHaveLength(1);expect(detail.project_manager_employee_id).toBe(employee.id);expect(detail.access.allowed_tabs).toContain('review_tips');console.log('PASS PRJ08-09 owner project-only note persistence and manager/team read');
 await p.getByRole('button',{name:'Documents',exact:true}).click();await p.getByRole('button',{name:'Upload document',exact:true}).click();
 const bytes=Buffer.from('Synthetic project document. No confidential data.\n');
 await p.getByLabel('Title',{exact:true}).fill('QC document');await p.getByLabel('File',{exact:true}).setInputFiles({name:'qc-project.txt',mimeType:'text/plain',buffer:bytes});
 const doc=await submit(p,'Save',root+'/documents/upload');
 await p.getByRole('button',{name:'Edit',exact:true}).click();await p.getByLabel('Title',{exact:true}).fill('QC revised document');await p.getByLabel('Notes',{exact:true}).fill('QC metadata edit');
 await submit(p,'Save',root+`/documents/${doc.id}`,'PATCH');
 const read=await get(p,root+'/workspace');expect(read.documents[0]).toMatchObject({title:'QC revised document',notes:'QC metadata edit'});
 const file=await p.request.get('/api'+root+`/documents/${doc.id}/file`);expect(file.ok()).toBe(true);expect(await file.body()).toEqual(bytes);console.log('PASS PRJ14 owner document upload, UI metadata edit and unchanged exact file bytes');
 await submit(p,'Put on hold',root+'/status','PATCH');expect((await get(p,root)).status).toBe('on_hold');
 await submit(p,'Resume',root+'/status','PATCH');expect((await get(p,root)).status).toBe('active');
 await submit(p,'Complete project',root+'/status','PATCH');expect((await get(p,root)).status).toBe('completed');
 await p.reload();await p.getByRole('button',{name:'Review & Tips',exact:true}).click();await expect(p.getByRole('button',{name:'Add review',exact:true})).toBeVisible();await expect(p.getByText('Record tip or additional income',{exact:true})).toBeVisible();
 const before=(await get(p,root+'/workspace')).documents;
 const denied=await p.request.patch('/api'+root+`/documents/${doc.id}`,{data:{title:'Should not persist'}});expect(denied.status()).toBe(409);
 expect((await get(p,root+'/workspace')).documents).toEqual(before);
 const deniedUpload=await p.request.post('/api'+root+'/documents/upload',{multipart:{title:'Should not upload',document_type:'other',file:{name:'denied.txt',mimeType:'text/plain',buffer:bytes}}});
 expect(deniedUpload.status()).toBe(409);expect((await get(p,root+'/workspace')).documents).toEqual(before);
 expect((await get(p,root)).due_date).toBe('2026-12-31');console.log('PASS PRJ10-11/13 gated review+tips, hold/resume/complete, locked document edit+upload nonmutation, project due-date reload persistence');
 await p.goto(`/dashboard/orders/${order.id}`);
 const restoredOrder=await get(p,`/sales/orders/${order.id}`);
 if(restoredOrder.status!=='completed')await submit(p,'Complete order',`/sales/orders/${order.id}/status`,'PATCH');
 const finalOrder=await get(p,`/sales/orders/${order.id}`);expect(finalOrder.status).toBe('completed');expect(finalOrder.total).toBe(completedOrder.total);expect(finalOrder.items).toEqual(completedOrder.items);
 console.log('PASS PRJ12 bounded fresh restore: completed order reopened for project and restored Completed; total and items unchanged');
 await info.attach('owner-project-readback.json',{body:JSON.stringify({project:await get(p,root),workspace:await get(p,root+'/workspace')},null,2),contentType:'application/json'});
 await p.screenshot({path:info.outputPath('completed-owner-project.png'),fullPage:true});
});

test('HR11 HR12 HR13 HR19 owner talent lifecycle and completed review admin edit',async({page:p},info)=>{
 test.setTimeout(150000);const employee=await setup(p,'HR talent');await p.goto('/dashboard/hr/talent');
 await p.getByRole('button',{name:'New job',exact:true}).click();await p.getByLabel('Job title',{exact:true}).fill('Synthetic QA engineer');await p.getByLabel('Location',{exact:true}).fill('Synthetic office');
 const job=await submit(p,'Create job','/hr/jobs');
 await p.getByRole('button',{name:'Add candidate',exact:true}).click();await choose(p,'Job opening','Synthetic QA engineer');await p.getByLabel('Full name',{exact:true}).fill('Synthetic Candidate');await p.getByLabel('Email',{exact:true}).fill('qc-candidate@example.invalid');
 const candidate=await submit(p,'Add candidate','/hr/candidates');
 const changed=p.waitForResponse(r=>new URL(r.url()).pathname===`/api/hr/candidates/${candidate.id}`&&r.request().method()==='PATCH');await p.locator('select').filter({has:p.locator('option[value="rejected"]')}).selectOption('rejected');await json(await changed);
 await submit(p,'Close',`/hr/jobs/${job.id}/status`,'PATCH');
 expect((await get(p,'/hr/jobs')).find(x=>x.id===job.id).status).toBe('closed');expect((await get(p,'/hr/candidates')).find(x=>x.id===candidate.id).stage).toBe('rejected');await expect(p.locator('article').filter({hasText:'Open jobs'})).toContainText('0');await expect(p.locator('article').filter({hasText:'Candidates active'})).toContainText('0');
 await p.getByRole('button',{name:'Performance',exact:true}).click();await p.getByRole('button',{name:'Start review',exact:true}).click();await choose(p,'Employee',employee.employee_code);
 await p.getByLabel('Period starts',{exact:true}).fill('2026-10-01');await p.getByLabel('Period ends',{exact:true}).fill('2026-10-31');const review=await submit(p,'Start review','/hr/performance');
 await p.getByRole('button',{name:'Review',exact:true}).click();await p.getByLabel('Rating (0–5)',{exact:true}).fill('6');await p.getByLabel('Manager review',{exact:true}).fill('Synthetic owner review');
 await p.getByRole('button',{name:'Save review',exact:true}).click();expect(await p.getByLabel('Rating (0–5)',{exact:true}).evaluate(el=>el.validity.rangeOverflow)).toBe(true);expect((await get(p,'/hr/performance')).find(x=>x.id===review.id).status).not.toBe('completed');
 await p.getByLabel('Rating (0–5)',{exact:true}).fill('4');await p.locator('input[name="complete"]').check();await submit(p,'Save review',`/hr/performance/${review.id}`,'PATCH');
 await p.getByRole('button',{name:'View / update',exact:true}).click();await p.getByLabel('Rating (0–5)',{exact:true}).fill('4.5');await submit(p,'Save review',`/hr/performance/${review.id}`,'PATCH');
 const saved=(await get(p,'/hr/performance')).find(x=>x.id===review.id);expect(Number(saved.rating)).toBe(4.5);expect(saved.status).toBe('completed');expect(saved.manager_review).toBe('Synthetic owner review');
 await p.getByRole('button',{name:'View / update',exact:true}).click();await p.getByLabel('Rating (0–5)',{exact:true}).fill('4');await submit(p,'Save review',`/hr/performance/${review.id}`,'PATCH');
 const restored=(await get(p,'/hr/performance')).find(x=>x.id===review.id);expect(Number(restored.rating)).toBe(4);expect(restored.status).toBe('completed');expect(restored.manager_review).toBe('Synthetic owner review');
 await p.getByRole('button',{name:'Company updates',exact:true}).click();await p.getByRole('button',{name:'Post update',exact:true}).click();await p.getByLabel('Title',{exact:true}).fill('Synthetic QC policy');await p.getByLabel('Message',{exact:true}).fill('Synthetic owner publication; acknowledgement intentionally excluded.');await p.locator('input[name="is_policy"]').check();
 const policy=await submit(p,'Publish now','/hr/announcements');const published=(await get(p,'/hr/announcements')).find(x=>x.id===policy.id);expect(published.is_policy).toBe(true);expect(published.published_at).toBeTruthy();await p.reload();await p.getByRole('button',{name:'Company updates',exact:true}).click();await expect(p.getByText('Synthetic QC policy',{exact:true})).toBeVisible();
 await info.attach('owner-talent-readback.json',{body:JSON.stringify({jobs:await get(p,'/hr/jobs'),candidates:await get(p,'/hr/candidates'),reviews:await get(p,'/hr/performance'),announcements:await get(p,'/hr/announcements')},null,2),contentType:'application/json'});
 await p.screenshot({path:info.outputPath('owner-policy-published.png'),fullPage:true});
});

test('HR07 owner attendance office and explicit weekly modes persist without geolocation access',async({page:p},info)=>{
 test.setTimeout(90000);const employee=await setup(p,'attendance setup');await p.goto('/dashboard/hr/settings/attendance/offices/new');
 await p.getByLabel('Office name',{exact:true}).fill('Synthetic office');await p.getByLabel('Latitude',{exact:true}).fill('91');await p.getByLabel('Longitude',{exact:true}).fill('90.39');
 await p.getByRole('button',{name:'Review changes',exact:true}).click();expect(await p.getByLabel('Latitude',{exact:true}).evaluate(el=>el.validity.rangeOverflow)).toBe(true);expect(await get(p,'/hr/attendance/offices')).toEqual([]);
 await p.getByLabel('Latitude',{exact:true}).fill('23.75');await p.getByRole('button',{name:'Review changes',exact:true}).click();const office=await submit(p,'Confirm and save once','/hr/attendance/offices');
 await p.goto('/dashboard/hr/settings/attendance/policies/new');
 await p.getByRole('combobox',{name:'Employee',exact:true}).selectOption(employee.id);
 const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];const modes=['office','office','remote','field','office','off','off'];
 for(let i=0;i<days.length;i++)await p.getByRole('combobox',{name:days[i],exact:true}).selectOption(modes[i]);
 // Invalid office-day policy must not advance to the write confirmation.
 await p.getByRole('button',{name:'Review changes',exact:true}).click();
 await expect(p.getByRole('button',{name:'Confirm and save once',exact:true})).toHaveCount(0);expect(await get(p,'/hr/attendance/policies')).toEqual([]);
 await p.getByRole('combobox',{name:'Assigned active office',exact:true}).selectOption(office.id);await p.getByRole('button',{name:'Review changes',exact:true}).click();await submit(p,'Confirm and save once',`/hr/attendance/policies/${employee.id}`,'PUT');
 await p.goto(`/dashboard/hr/settings/attendance/policies/${employee.id}/edit`);
 await expect(p.getByRole('combobox',{name:'Assigned active office',exact:true})).toHaveValue(office.id);for(let i=0;i<days.length;i++)await expect(p.getByRole('combobox',{name:days[i],exact:true})).toHaveValue(modes[i]);
 const policies=await get(p,'/hr/attendance/policies');expect(policies[0].weekly_modes).toEqual(modes);
 await info.attach('owner-attendance-policy.json',{body:JSON.stringify(policies,null,2),contentType:'application/json'});
});

test('HR02 owner duplicate-date guard and HR25 pending leave rejection persistence',async({page:p},info)=>{
 test.setTimeout(120000);const employee=await setup(p,'attendance duplicates');await p.goto('/dashboard/hr/time');
 async function attendance(day,hours,overtime,expected=201){
  await p.goto('/dashboard/hr/time/attendance/new');await choose(p,'Employee',employee.employee_code);await p.getByLabel('Company work date',{exact:true}).fill(day);await p.getByLabel('Worked hours',{exact:true}).fill(hours);await p.getByLabel('Overtime hours',{exact:true}).fill(overtime);
  const pending=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/hr/attendance'&&r.request().method()==='POST');await p.getByRole('button',{name:'Save attendance',exact:true}).click();expect((await pending).status()).toBe(expected);
 }
 await attendance(yesterday,'8','2');await attendance(today,'7.5','0.5');
 const before=await get(p,'/hr/attendance');expect(before).toHaveLength(2);expect(before.find(x=>x.attendance_date===today)).toMatchObject({work_minutes:450,overtime_minutes:30});expect(before.find(x=>x.attendance_date===yesterday)).toMatchObject({work_minutes:480,overtime_minutes:120});
 await attendance(today,'1','0',409);expect(await get(p,'/hr/attendance')).toEqual(before);await p.reload();
 const type=await post(p,'/hr/leave-types',{name:'Synthetic annual leave',code:'QC-REJECT',annual_allowance_days:'12',is_paid:true,requires_approval:true});
 const leave=await post(p,'/hr/leave-requests',{employee_id:employee.id,leave_type_id:type.id,start_date:'2026-12-01',end_date:'2026-12-15',reason:'Synthetic owner rejection'});expect(leave.status).toBe('pending');
 const pendingSummary=await get(p,'/hr/workspace-summary');expect(pendingSummary.attention.pending_leave).toBe(1);
 await p.goto(`/dashboard/hr/time/leave/${leave.id}/review`);await p.getByRole('radio',{name:'Reject request',exact:true}).check();await p.getByRole('button',{name:'Review decision',exact:true}).click();await submit(p,'Confirm decision',`/hr/leave-requests/${leave.id}`,'PATCH');
 expect((await get(p,'/hr/leave-requests')).find(x=>x.id===leave.id).status).toBe('rejected');expect((await get(p,'/hr/workspace-summary')).attention.pending_leave).toBe(0);expect(await get(p,'/hr/attendance')).toEqual(before);
 await info.attach('owner-rejection-readback.json',{body:JSON.stringify({leaves:await get(p,'/hr/leave-requests'),summary:await get(p,'/hr/workspace-summary')},null,2),contentType:'application/json'});
 // Personal entitlement/balance UI deliberately excluded. No verdict on overdraft/day-count policy.
});

test('HR01 HR09 owner structure search and document expiry aggregation',async({page:p},info)=>{
 test.setTimeout(120000);const employee=await setup(p,'structure expiry');await p.goto('/dashboard/hr/people');await p.getByRole('button',{name:'Structure',exact:true}).click();
 for(const [heading,label,name,path] of [['Departments','Department name','QC Engineering','departments'],['Designations','Designation name','QC Engineer','designations']]){
  await p.getByRole('heading',{name:heading,exact:true}).locator('..').locator('..').getByRole('button',{name:'Add',exact:true}).click();await p.getByLabel(label,{exact:true}).fill(name);await submit(p,path==='departments'?'Add department':'Add designation',`/hr/people/${path}`);
  await p.goto('/dashboard/hr/people?view=structure');
 }
 await p.goto('/dashboard/hr/people');await p.getByRole('row').filter({hasText:employee.employee_code}).getByRole('link',{name:`Edit ${employee.full_name}`,exact:true}).click();await choose(p,'Department','QC Engineering');await choose(p,'Designation','QC Engineer');await submit(p,'Save profile',`/hr/people/${employee.id}`,'PATCH');
 await p.goto('/dashboard/hr/people');await p.getByLabel('Search name, code, team or role',{exact:true}).fill('QC Engineering');await p.getByRole('button',{name:'Apply people search',exact:true}).click();await expect(p.getByRole('row').filter({hasText:employee.employee_code})).toBeVisible();await p.getByLabel('Search name, code, team or role',{exact:true}).fill('nonexistent-qc-structure');await p.getByRole('button',{name:'Apply people search',exact:true}).click();await expect(p.getByRole('row').filter({hasText:employee.employee_code})).toHaveCount(0);
 const person=(await get(p,'/hr/people')).people.find(x=>x.id===employee.id);expect(person.department_name).toBe('QC Engineering');expect(person.designation_name).toBe('QC Engineer');
 await p.goto('/dashboard/hr/records');await p.getByRole('button',{name:'Upload document',exact:true}).click();await choose(p,'Employee',employee.employee_code);await p.getByLabel('Document title',{exact:true}).fill('Synthetic expiring document');await p.getByRole('combobox',{name:/^Document type/}).selectOption('other');await p.getByLabel('Reference number',{exact:true}).fill('SYNTHETIC-EXPIRY');
 const expiry=new Date(Date.now()+10*86400000).toISOString().slice(0,10);await p.getByLabel('Expires on',{exact:true}).fill(expiry);await p.getByLabel('File',{exact:true}).setInputFiles({name:'synthetic-expiry.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic expiry document; no personal data.')});
 const doc=await submit(p,'Upload securely','/hr-documents/upload');await p.reload();await expect(p.getByText(`Expires ${expiry}`,{exact:true})).toBeVisible();expect((await get(p,'/hr/workspace-summary')).attention.documents_expiring_30d).toBe(1);
 const stored=(await get(p,'/hr/documents')).find(x=>x.id===doc.id);expect(stored.employee_id).toBe(employee.id);expect(stored.reference_number).toBe('SYNTHETIC-EXPIRY');expect(stored.expires_on).toBe(expiry);
 await info.attach('owner-structure-expiry.json',{body:JSON.stringify({person,document:stored,summary:await get(p,'/hr/workspace-summary')},null,2),contentType:'application/json'});
});

test('HR14 HR15 HR20 HR21 HR24 owner payroll guard UI, draft reload and withholding date preview',async({page:p},info)=>{
 test.setTimeout(150000);const employee=await setup(p,'payroll guards');
 await post(p,'/payroll/salary-profiles',{employee_id:employee.id,currency:'USD',base_salary:'1000',effective_from:'2026-10-01'});
 const sept=await post(p,'/payroll/periods',{name:'QC September',period_start:'2026-09-01',period_end:'2026-09-30',pay_date:'2026-09-30'});
 const oct=await post(p,'/payroll/periods',{name:'QC October',period_start:'2026-10-01',period_end:'2026-10-31',pay_date:'2026-10-31'});
 p.on('dialog',dialog=>dialog.accept());
 await p.goto('/dashboard/payroll/runs/new');await choose(p,'Open payroll period','QC September');await choose(p,'Currency','USD');
 const unavailable=await submit(p,'Request server preview','/payroll/runs/preview');expect(unavailable.ready).toBe(false);
 await expect(p.getByText('Setup needs attention. No partial payroll amounts are available.',{exact:true})).toBeVisible();await expect(p.getByRole('button',{name:'Confirm reviewed draft',exact:true})).toBeDisabled();
 // Separate server negative control: UI preview blocks confirmation before a create request.
 const invalid=await p.request.post('/api/payroll/runs',{data:{period_id:sept.id,currency:'USD'}});expect(invalid.status()).toBe(409);expect(await get(p,'/payroll/runs')).toEqual([]);
 await choose(p,'Open payroll period','QC October');const preview=await submit(p,'Request server preview','/payroll/runs/preview');expect(preview.ready).toBe(true);const run=await submit(p,'Confirm reviewed draft','/payroll/runs');
 await p.goto(`/dashboard/payroll/runs/${run.id}`);await p.reload();await expect(p.getByRole('link',{name:'Adjust',exact:true})).toBeVisible();expect((await get(p,`/payroll/runs/${run.id}`)).status).toBe('draft');await expect(p.locator('body')).toContainText('USD 1,000.00');
 await p.goto('/dashboard/payroll/runs/new');await choose(p,'Open payroll period','QC October');await choose(p,'Currency','USD');const duplicate=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/payroll/runs/preview'&&r.request().method()==='POST');await p.getByRole('button',{name:'Request server preview',exact:true}).click();expect((await duplicate).status()).toBe(409);await expect(p.getByText('A USD payroll run already exists for this period',{exact:true})).toBeVisible();await expect(p.getByRole('button',{name:'Confirm reviewed draft',exact:true})).toBeDisabled();
 // Recheck the creation endpoint independently of the UI preview rejection.
 const duplicateCreate=await p.request.post('/api/payroll/runs',{data:{period_id:oct.id,currency:'USD'}});expect(duplicateCreate.status()).toBe(409);expect(await get(p,'/payroll/runs')).toHaveLength(1);
 await p.goto(`/dashboard/payroll/runs/${run.id}`);await p.getByRole('link',{name:'Adjust',exact:true}).click();await p.getByLabel(/^Adjustment reason/).fill('Synthetic owner withholding guard');await p.getByLabel(/^Tax \/ withholding/).fill('1000.01');
 // Current editor delegates net arithmetic to the server; rejection must preserve the draft.
 const negative=p.waitForResponse(r=>new URL(r.url()).pathname===`/api/payroll/runs/${run.id}/entries/${run.entries[0].id}`&&r.request().method()==='PATCH');await p.getByRole('button',{name:'Save draft adjustment',exact:true}).click();expect((await negative).status()).toBe(400);await expect(p.getByText('Net pay cannot be negative',{exact:true})).toBeVisible();expect(await get(p,`/payroll/runs/${run.id}`)).toEqual(run);
 await p.getByLabel(/^Tax \/ withholding/).fill('125.35');await submit(p,'Save draft adjustment',`/payroll/runs/${run.id}/entries/${run.entries[0].id}`,'PATCH');
 await p.goto('/dashboard/payroll/periods/new');await p.getByLabel('Period name',{exact:true}).fill('QC overlap');await p.getByLabel('Start date',{exact:true}).fill('2026-10-01');await p.getByLabel('End date',{exact:true}).fill('2026-10-15');await p.getByLabel(/^Pay date/).fill('2026-10-15');
 const overlap=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/payroll/periods'&&r.request().method()==='POST');await p.getByRole('button',{name:'Create period',exact:true}).click();expect((await overlap).status()).toBe(409);expect(await get(p,'/payroll/periods')).toHaveLength(2);await expect(p.locator('body')).not.toContainText('[object Object]');
 await post(p,`/payroll/runs/${run.id}/approve`,{});await p.goto('/dashboard/payroll/withholdings/new');
 for(const [date,amount] of [['2026-10-20','USD 0.00'],['2026-10-31','USD 125.35']]){
  const loaded=p.waitForResponse(r=>r.url().includes(`/api/payroll/withholdings/meta?payment_date=${date}`));await p.getByLabel(/^Payment date/).fill(date);await json(await loaded);await expect(p.getByText(`Liability available as of ${date}`,{exact:true}).locator('..')).toContainText(amount);
 }
 expect(await get(p,'/payroll/withholdings/payments')).toEqual([]);await info.attach('owner-payroll-cutoff.json',{body:JSON.stringify({early:await get(p,'/payroll/withholdings/meta?payment_date=2026-10-20'),end:await get(p,'/payroll/withholdings/meta?payment_date=2026-10-31')},null,2),contentType:'application/json'});
});

test('HR29 independent owner approval UI from direct synthetic pending fixture, no self-service',async({page:p},info)=>{
 test.setTimeout(90000);await setup(p,'manager review');const tenant=await get(p,'/tenant');
 // This process inherits the guarded local PostgreSQL connection and executes
 // inside run-browser.sh's shared with-postgres lock. No PG server is started.
 const stdout=execFileSync('../backend/.venv/bin/python',['scripts/verify_qc_hr_project_extended.py','--seed-pending-review',tenant.organization.id],{cwd:'../backend',env:process.env,encoding:'utf8'});
 const fixture=JSON.parse(stdout.trim());const payrollBefore=await get(p,'/payroll/runs');await p.goto(`/dashboard/hr/settings/attendance/requests/${fixture.id}/review`);await expect(p.getByText('Synthetic direct fixture for independent owner review',{exact:true})).toBeVisible();
 await p.getByRole('combobox',{name:'Decision',exact:true}).selectOption('approved');
 await p.getByLabel('Review notes (optional)',{exact:true}).fill('Synthetic owner approved correction');
 await p.getByRole('button',{name:'Review changes',exact:true}).click();
 const approved=await submit(p,'Confirm and save once',`/hr/attendance/requests/${fixture.id}/review`);expect(approved.status).toBe('approved');await p.reload();await expect(p.getByText('This request has already been reviewed. No action is available.',{exact:true})).toBeVisible();await expect(p.getByRole('button',{name:'Confirm and save once',exact:true})).toHaveCount(0);
 const request=(await get(p,'/hr/attendance/requests')).find(x=>x.id===fixture.id);expect(request.status).toBe('approved');expect(request.review_notes).toBe('Synthetic owner approved correction');
 const attendance=(await get(p,'/hr/attendance')).find(x=>x.employee_id===fixture.employee_id&&x.attendance_date===fixture.work_date);expect(attendance.work_minutes).toBe(480);const database=JSON.parse(execFileSync('../backend/.venv/bin/python',['scripts/verify_qc_hr_project_extended.py','--verify-persisted-review',fixture.id],{cwd:'../backend',env:process.env,encoding:'utf8'}).trim());expect(database.owner_reviewed).toBe(true);expect(database.verification_method).toBe('hr_correction');expect(await get(p,'/payroll/runs')).toEqual(payrollBefore);
 await info.attach('owner-independent-review.json',{body:JSON.stringify({request,attendance,database},null,2),contentType:'application/json'});
});

test('HR05 owner synthetic invitation validation pending expiry and revocation with mail disabled',async({page:p},info)=>{
 test.setTimeout(90000);
 const safety=JSON.parse(execFileSync('../backend/.venv/bin/python',['scripts/verify_qc_hr_project_extended.py','--verify-mail-disabled'],{cwd:'../backend',env:process.env,encoding:'utf8'}).trim());expect(safety).toMatchObject({environment:'test',loopback_database:true,smtp_host_empty:true,email_delivery_disabled:true});if((process.env.PYTHONPATH??'').includes('no-network'))expect(safety.outbound_socket_guard).toBe(true);
 await setup(p,'disabled invitation');const people=await get(p,'/hr/people');const role=people.invite_roles.find(x=>x.name==='User')??people.invite_roles[0];expect(role).toBeTruthy();
 await p.goto('/dashboard/hr/people');await p.getByRole('button',{name:'Invite person',exact:true}).click();await p.getByLabel('Full name',{exact:true}).fill('Synthetic no-mail invitation');await p.getByLabel('Email',{exact:true}).fill('not-an-email');await choose(p,'Employee role',role.name);
 await p.getByRole('button',{name:'Send invitation',exact:true}).click();expect(await p.getByLabel('Email',{exact:true}).evaluate(el=>el.validity.typeMismatch)).toBe(true);expect((await get(p,'/hr/people')).invitations).toEqual([]);
 await p.getByLabel('Email',{exact:true}).fill('qc-local-no-mail@example.com');const invite=await submit(p,'Send invitation','/hr/people/invitations/send');expect(invite.email_sent).toBe(false);
 await expect(p.locator('body')).toContainText('Invitation created, but email could not be sent.');await p.getByRole('button',{name:'Open Invitations',exact:true}).click();await expect(p.getByText('qc-local-no-mail@example.com',{exact:true})).toBeVisible();await expect(p.getByText('Pending',{exact:true})).toBeVisible();await expect(p.getByText(/^Expires /)).toBeVisible();
 const stored=(await get(p,'/hr/people')).invitations.find(x=>x.id===invite.id);expect(stored.email).toBe('qc-local-no-mail@example.com');expect(Date.parse(stored.expires_at)).toBeGreaterThan(Date.now());
 const resent=await submit(p,'Resend email for qc-local-no-mail@example.com',`/hr/people/invitations/${invite.id}/resend`);expect(resent.email_sent).toBe(false);
 p.once('dialog',dialog=>dialog.accept());await submit(p,'Revoke for qc-local-no-mail@example.com',`/hr/people/invitations/${invite.id}/revoke`);expect((await get(p,'/hr/people')).invitations).toEqual([]);await expect(p.getByText('No active pending invitations',{exact:true})).toBeVisible();
 // Never retain invitation tokens in the attached evidence or navigate acceptance.
 await info.attach('owner-invitation-mail-disabled.json',{body:JSON.stringify({safety,email_sent:invite.email_sent,resend_email_sent:resent.email_sent,pending_email:stored.email,expires_at:stored.expires_at,revoked:true},null,2),contentType:'application/json'});
});
