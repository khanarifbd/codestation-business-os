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

async function observedCapitalRead(page,path,action){
 const waiting=page.waitForResponse(response=>new URL(response.url()).pathname===path&&response.request().method()==='GET').then(response=>({response}),error=>({error}));
 await action();const result=await waiting;if(result.error)throw result.error;
 expect(result.response.status()).toBe(200);return result.response.json();
}
async function captureCapitalViewport(page,info,label,heading){
 const original=page.viewportSize();
 try{for(const [size,width,height]of [['desktop',1440,1000],['mobile',390,844]]){
  await page.setViewportSize({width,height});await expect(page.getByRole('heading',{name:heading,exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Refresh',exact:true})).toBeEnabled();
  await page.evaluate(()=>window.scrollTo(0,0));expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath(`neutral-theme-capital-${label}-${size}.png`),fullPage:false});
  if(size==='mobile'&&['owner','company','project','investments'].includes(label)){
   const tabName={owner:'Owner Equity',company:'Company Funding',project:'Project Funding',investments:'Our Investments'}[label];
   const selected=page.getByRole('button',{name:tabName,exact:true});
   await selected.evaluate(node=>node.scrollIntoView({block:'center',inline:'center',behavior:'instant'}));
   await page.screenshot({path:info.outputPath(`neutral-theme-capital-${label}-mobile-selected-tab.png`),fullPage:false});
   const geometry=await selected.evaluate(node=>{
    const rect=node.getBoundingClientRect(),strip=node.parentElement,clip=strip.getBoundingClientRect(),style=getComputedStyle(strip);
    const bounds={left:Math.max(0,clip.left+parseFloat(style.borderLeftWidth)),right:Math.min(window.innerWidth,clip.right-parseFloat(style.borderRightWidth)),top:80,bottom:window.innerHeight-80};
    const target={left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom};
    return {target,bounds,scrollLeft:strip.scrollLeft,clientWidth:strip.clientWidth,visible:target.left>=bounds.left&&target.right<=bounds.right&&target.top>=bounds.top&&target.bottom<=bounds.bottom};
   });
   expect(geometry.visible,`${tabName} full target bounds: ${JSON.stringify(geometry)}`).toBe(true);
   await expect(selected).toBeInViewport({ratio:1});
   await expect(selected).toHaveClass(/bg-neutral-950/);
   await expect(page.getByRole('heading',{name:heading,exact:true})).toBeVisible();
  }
 }}finally{if(original)await page.setViewportSize(original);}
}
async function reviewCapitalReadOnly(page,info,route){
 if(route==='/dashboard/capital'){
  const overview=await observedCapitalRead(page,'/api/capital/dashboard',()=>page.getByRole('button',{name:'Refresh',exact:true}).click());
  expect(Array.isArray(overview.rows)).toBe(true);await captureCapitalViewport(page,info,'overview','Capital position by currency');
  for(const [tab,path,label,heading]of [
   ['Owner Equity','owner-equity','owner','Owner contribution / drawing'],
   ['Company Funding','company-investors','company','New company investor'],
   ['Project Funding','project-investors','project','New project funding agreement'],
   ['Our Investments','investments','investments','New company investment'],
  ]){
   const rows=await observedCapitalRead(page,`/api/capital/${path}`,()=>page.getByRole('button',{name:tab,exact:true}).click());
   expect(rows).toEqual([]);await captureCapitalViewport(page,info,label,heading);
  }
 }else if(route==='/dashboard/capital/insights'){
  const data=await observedCapitalRead(page,'/api/capital/insights',()=>page.getByRole('button',{name:'Refresh',exact:true}).click());
  expect(data.capital_pnl).toEqual([]);expect(data.project_settlements).toEqual([]);
  await captureCapitalViewport(page,info,'insights','Capital P&L Impact');
 }
}
test('Owner module sweep: real API availability and rendering, no portal coverage', async ({page,context}, info) => {
 test.setTimeout(240000);
 page.setDefaultTimeout(15000);
 const baseURL=process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
 expect(['localhost','127.0.0.1','[::1]']).toContain(new URL(baseURL).hostname);
 await page.goto('/login');
 await page.getByLabel(/email or username/i).fill(process.env.E2E_QC_EMAIL ?? 'qc-owner@example.com');
 const password=process.env.E2E_PASSWORD;if(!password?.trim())throw new Error('E2E_PASSWORD must be configured for the disposable CI fixture');
 await page.getByLabel('Password',{exact:true}).fill(password);
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
  // networkidle is not a React-ready signal; preserve the heading assertion with a bounded wait.
  await expect(page.locator('h1:visible,h2:visible').first(),`${route} ready heading`).toBeVisible();
  const headings=await page.locator('h1:visible,h2:visible').allTextContents();
  expect(headings.length,`${route} visible headings`).toBeGreaterThan(0);
  await reviewCapitalReadOnly(page,info,route);
  rows.push({route,actualUrl:new URL(page.url()).pathname,headings,errors:errors.slice(start)});
 }
 await info.attach('owner-module-sweep.json',{body:JSON.stringify({organization:org.id,rows,errors},null,2),contentType:'application/json'});
 await page.screenshot({path:info.outputPath('owner-module-sweep-final.png'),fullPage:true});
 expect(errors,'Unexpected real API errors or browser exceptions').toEqual([]);
 console.log(`PASS owner module rendering sweep: ${rows.length} routes, no mocked APIs; excludes client/employee portals`);
});
