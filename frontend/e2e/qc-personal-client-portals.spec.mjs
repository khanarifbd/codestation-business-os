// Integrated UI suite: business outcomes use live local APIs/PostgreSQL.
// The CI workflow seeds BROWSER_FIXTURE in its disposable PostgreSQL service.
import {readFileSync} from 'node:fs';
import {test,expect} from '@playwright/test';
import {captureJsonResponse} from './support/capture-json-response.mjs';
const fixture=()=>{const path=process.env.BROWSER_FIXTURE;if(!path)throw new Error('BROWSER_FIXTURE is required; run seed_qc_personal_client_browser.py against the isolated test database first');return JSON.parse(readFileSync(path,'utf8'));};
async function json(response){const value=await response.json();expect(response.ok(),JSON.stringify(value)).toBeTruthy();return value;}
async function login(page,email){const f=fixture();await json(await page.request.post('/api/auth/login',{data:{email,password:f.password}}));await json(await page.request.get('/api/organizations'));}

test('MW02 MW03 NT03 MW04 MW05 real personal search board notification click completion history',async({page},info)=>{
 const f=fixture();await login(page,f.employee_email);
 expect((await page.request.get('/api/hr/people')).status()).toBe(403);
 await page.goto('/dashboard/my-work');
 const search=page.getByPlaceholder('Search tasks or projects');await search.fill('nonexistent-synthetic-zzzz');await page.getByRole('button',{name:'Apply search',exact:true}).click();
 await expect(page.getByRole('heading',{name:'No tasks match these filters',exact:true})).toBeVisible();
 await search.fill('');await page.getByRole('button',{name:'Apply search',exact:true}).click();await page.getByRole('group',{name:'Task view'}).getByRole('button',{name:'Board',exact:true}).click();
 for(const [status,title] of [['To do','Assigned personal task'],['In progress','Board in_progress'],['Blocked','Board blocked'],['In review','Board review']]){
   const card=page.getByRole('button').filter({has:page.getByText(title,{exact:true})});await expect(card).toBeVisible();
   await expect(card.locator('..').locator('..').getByRole('heading',{name:status,exact:true})).toBeVisible();
 }
 await page.screenshot({path:info.outputPath('personal-board.png'),fullPage:true});
 await page.goto('/dashboard/notifications');
 await page.locator(`a[href="/dashboard/my-work?task=${f.task_id}"]`).click();
 await expect(page).toHaveURL(new RegExp(`/dashboard/my-work/tasks/${f.task_id}\\?`));
 await expect(page.getByRole('heading',{name:'Assigned personal task',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Update work',exact:true}).click();
 await page.getByLabel('Progress %',{exact:true}).fill('100');
 await page.getByLabel('Work note',{exact:true}).fill('Completed through the personal drawer for integrated QC.');
 await captureJsonResponse(page,{path:`/api/projects/${f.project_id}/tasks/${f.task_id}/progress`,action:()=>page.getByRole('button',{name:'Save progress',exact:true}).click()});
 await expect(page).toHaveURL(/\/dashboard\/my-work(?:\?|$)/);
 // Completed tasks leave the active register; reopen the saved document to verify history.
 await page.goto(`/dashboard/my-work/tasks/${f.task_id}`);
 await expect(page.getByText('Completed through the personal drawer for integrated QC.',{exact:true})).toBeVisible();
 await expect(page.getByText('This task or project is closed, so execution updates are locked.',{exact:true})).toBeVisible();
 const detail=await json(await page.request.get(`/api/workspace/tasks/${f.task_id}`));expect(detail.task).toMatchObject({status:'completed',progress_percent:100});expect(detail.task.completed_at).toBeTruthy();
 await page.reload();await expect(page.getByText('Completed through the personal drawer for integrated QC.',{exact:true})).toBeVisible();
 const workspace=await json(await page.request.get('/api/workspace/me'));expect(workspace.tasks.some(t=>t.id===f.task_id)).toBe(false);
 const notices=await json(await page.request.get('/api/workspace/notifications'));expect(notices.items.some(t=>t.href.includes(f.task_id))).toBe(false);
 await info.attach('personal-readback.json',{body:JSON.stringify({detail,workspace,notices}),contentType:'application/json'});
});

test('Client portal real linked visibility public milestone invoice suppression and quotation decision',async({page},info)=>{
 const f=fixture();await login(page,f.customer_email);await page.goto('/dashboard/client-portal');
 await expect(page.getByText('Visible customer',{exact:true})).toBeVisible();await expect(page.getByText('Hidden customer',{exact:true})).toHaveCount(0);
 const billing=await json(await page.request.get('/api/client-portal'));expect(billing.financials).toHaveLength(1);expect(billing.financials[0].invoice_count).toBe(1);expect(Number(billing.financials[0].balance_due)).toBe(100);
 await expect(page.getByText('USD 100.00',{exact:true})).toHaveCount(2);
 await page.screenshot({path:info.outputPath('client-dashboard-billing.png'),fullPage:true});
 await page.getByRole('link',{name:'All projects',exact:true}).click();
 await page.getByRole('link').filter({hasText:'Personal test project'}).first().click();
 await expect(page.getByText('Public update',{exact:true})).toBeVisible();await expect(page.getByText('Private update',{exact:true})).toHaveCount(0);
 await page.goto('/dashboard/client/invoices');await expect(page.getByText('INV-SENT',{exact:true})).toBeVisible();
 for(const text of ['INV-DRAFT','INV-CANCELLED','INV-OTHER'])await expect(page.getByText(text,{exact:true})).toHaveCount(0);
 await page.getByRole('link').filter({hasText:'INV-SENT'}).first().click();await expect(page.getByText('INV-SENT',{exact:true}).first()).toBeVisible();
 await page.goto(`/dashboard/client/orders/${f.order_id}`);await expect(page.getByText('O-EXP',{exact:true}).first()).toBeVisible();
 await page.goto(`/dashboard/client/quotations/${f.quotation_id}`);
 await page.getByRole('link',{name:'Review acceptance',exact:true}).click();
 await page.getByRole('button',{name:'Review final confirmation',exact:true}).click();
 const confirmation=page.getByRole('dialog');await expect(confirmation.getByRole('heading',{name:'Accept this quotation?',exact:true})).toBeVisible();
 await confirmation.getByRole('button',{name:'Confirm acceptance',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Decision workspace locked against repeat submission',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Return to quotation',exact:true}).click();
 await expect(page.getByRole('link',{name:'Review acceptance',exact:true})).toHaveCount(0);
 await page.reload();await expect(page.getByRole('link',{name:'Review acceptance',exact:true})).toHaveCount(0);
 await expect(page.getByRole('link',{name:'Review rejection',exact:true})).toHaveCount(0);
 const quotation=await json(await page.request.get(`/api/client-portal/quotations/${f.quotation_id}`));expect(quotation.status).toBe('accepted');
 await info.attach('client-decision.json',{body:JSON.stringify(quotation),contentType:'application/json'});await page.screenshot({path:info.outputPath('client-accepted-quotation.png'),fullPage:true});
});

test('HR08 HR26 HR27 personal remote and correction requests persist with completed review locked',async({page},info)=>{
 const f=fixture();await login(page,f.employee_email);await page.goto('/dashboard/hr/me');
 await expect(page.getByRole('heading',{name:'My HR & Pay',exact:true})).toBeVisible();
 await page.getByRole('navigation',{name:'My HR sections'}).getByRole('button',{name:'Reviews',exact:true}).click();
 await page.getByRole('button',{name:'View review',exact:true}).click();
 await expect(page.getByText('Locked browser review original',{exact:true})).toBeVisible();await expect(page.getByText('This review is completed and locked.',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Write self review',exact:true})).toHaveCount(0);
 await expect(page.getByRole('textbox')).toHaveCount(0);
 await page.goto('/dashboard/hr/me');
 const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10),yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
 await page.getByRole('button',{name:/^Request a remote workday/}).click();
 await expect(page.getByRole('heading',{name:'Request a remote workday',exact:true})).toBeVisible();
 const remote=page.locator('form');
 await remote.getByLabel('Requested work date').fill(tomorrow);await remote.getByLabel('Reason',{exact:true}).fill('Synthetic browser remote request');
 let saved=page.waitForResponse(r=>r.url().includes('/hr/self/attendance-requests')&&r.request().method()==='POST');await remote.getByRole('button',{name:'Submit remote request'}).click();expect((await saved).status()).toBe(201);
 await expect(page).toHaveURL(/\/dashboard\/hr\/me\?view=attendance(?:&|$)/);
 await expect(page.getByText('Synthetic browser remote request',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Request correction',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Correct missed attendance',exact:true})).toBeVisible();
 const correction=page.locator('form');
 await correction.getByLabel('Work date',{exact:true}).fill(yesterday);await correction.getByLabel('Actual check-in · device timezone',{exact:true}).fill(`${yesterday}T09:00`);await correction.getByLabel('Actual check-out · device timezone',{exact:true}).fill(`${yesterday}T17:00`);await correction.getByLabel('Reason',{exact:true}).fill('Synthetic browser correction request');
 saved=page.waitForResponse(r=>r.url().includes('/hr/self/attendance-requests')&&r.request().method()==='POST');await correction.getByRole('button',{name:'Submit correction'}).click();expect((await saved).status()).toBe(201);
 await expect(page).toHaveURL(/\/dashboard\/hr\/me\?view=attendance(?:&|$)/);
 expect((await page.request.get('/api/hr/attendance/requests')).status()).toBe(403);
 const ownerContext=await page.context().browser().newContext({baseURL:info.project.use.baseURL,extraHTTPHeaders:info.project.use.extraHTTPHeaders});const ownerPage=await ownerContext.newPage();await login(ownerPage,f.owner_email);
 const queue=await json(await ownerPage.request.get('/api/hr/attendance/requests'));await ownerContext.close();expect(JSON.stringify(queue)).toContain('Synthetic browser remote request');expect(JSON.stringify(queue)).toContain('Synthetic browser correction request');
 await page.reload();await expect(page.getByText('Synthetic browser remote request',{exact:true})).toBeVisible();await expect(page.getByText('Synthetic browser correction request',{exact:true})).toBeVisible();
 await info.attach('personal-hr-manager-queue.json',{body:JSON.stringify(queue),contentType:'application/json'});await page.screenshot({path:info.outputPath('personal-hr-requests.png'),fullPage:true});
});
