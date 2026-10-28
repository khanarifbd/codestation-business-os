import { expect, test } from '@playwright/test';

// Availability/render QC only, not proof of every module's CRUD/calculations.
// No route interception: all application responses come from the local backend.
const routes = [
 '/dashboard', '/dashboard/company', '/dashboard/company/defaults', '/dashboard/settings',
 '/dashboard/crm', '/dashboard/clients', '/dashboard/quotations', '/dashboard/orders', '/dashboard/projects',
 '/dashboard/employees', '/dashboard/hr/people', '/dashboard/hr/time', '/dashboard/hr/records',
 '/dashboard/hr/operations', '/dashboard/hr/talent', '/dashboard/hr/settings', '/dashboard/payroll',
 '/dashboard/expenses', '/dashboard/capital', '/dashboard/capital/insights', '/dashboard/inventory',
 '/dashboard/accounting', '/dashboard/accounting/accounts', '/dashboard/accounting/invoices',
 '/dashboard/accounting/money-in', '/dashboard/accounting/money-out', '/dashboard/accounting/payables',
 '/dashboard/accounting/receivables', '/dashboard/accounting/transfers', '/dashboard/accounting/assets',
 '/dashboard/accounting/loans', '/dashboard/accounting/tax', '/dashboard/accounting/reconciliation',
 '/dashboard/accounting/controls', '/dashboard/accounting/advanced', '/dashboard/accounting/reports',
 '/dashboard/accounting/reports/account-statement', '/dashboard/reports', '/dashboard/activity-logs',
 '/dashboard/notifications', '/dashboard/profile',
];
test('Owner module sweep: real API availability and rendering, no portal coverage', async ({page,context}, info) => {
 test.setTimeout(240000);
 page.setDefaultTimeout(15000);
 const baseURL=process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
 expect(['localhost','127.0.0.1','[::1]']).toContain(new URL(baseURL).hostname);
 await page.goto('/login');
 await page.getByLabel(/email or username/i).fill(process.env.E2E_QC_EMAIL ?? 'qc-owner@example.com');
 await page.getByLabel('Password',{exact:true}).fill(process.env.E2E_PASSWORD ?? 'E2E-Launch-Password-123!');
 await page.getByRole('button',{name:/sign in securely/i}).click();
 await expect(page).toHaveURL(/\/dashboard(?:$|\/|\?)/);
 const response=await page.request.post('/api/organizations',{data:{name:`QC owner sweep ${Date.now()}`,currency:'USD',country_code:'US',timezone:'UTC'}});
 expect(response.status(),await response.text()).toBe(201);
 const org=(await response.json()).organization;
 await context.addCookies([{name:'organization_id',value:org.id,url:baseURL,httpOnly:true,sameSite:'Lax'}]);
 let current='setup'; const errors=[]; const rows=[];
 page.on('response',r=>{if(new URL(r.url()).pathname.startsWith('/api/')&&r.status()>=400) errors.push({page:current,status:r.status(),url:new URL(r.url()).pathname});});
 page.on('pageerror',e=>errors.push({page:current,error:e.message}));
 for(const route of routes){
  current=route; const start=errors.length;
  const document=await page.goto(route);
  expect(document.status(),route).toBeLessThan(400);
  await page.waitForLoadState('networkidle');
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.locator('body')).not.toContainText(/Application error: a client-side exception|This page could not be found/);
  const headings=await page.locator('h1:visible,h2:visible').allTextContents();
  expect(headings.length,`${route} visible headings`).toBeGreaterThan(0);
  rows.push({route,actualUrl:new URL(page.url()).pathname,headings,errors:errors.slice(start)});
 }
 await info.attach('owner-module-sweep.json',{body:JSON.stringify({organization:org.id,rows,errors},null,2),contentType:'application/json'});
 await page.screenshot({path:info.outputPath('owner-module-sweep-final.png'),fullPage:true});
 expect(errors,'Unexpected real API errors or browser exceptions').toEqual([]);
 console.log(`PASS owner module rendering sweep: ${rows.length} routes, no mocked APIs; excludes client/employee portals`);
});
