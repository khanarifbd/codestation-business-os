import { captureJsonResponse } from "./support/capture-json-response.mjs";
import { expect, test } from '@playwright/test';

test('orders final revision: exact per-line cents, decimal wire and subtle price focus', async ({ page, context }, info) => {
  // Two cold real routes plus disposable setup; no retries or response fabrication.
  test.setTimeout(90_000);
  const baseURL = info.project.use.baseURL;
  expect(['localhost','127.0.0.1','[::1]']).toContain(new URL(baseURL).hostname);
  const password = process.env.E2E_PASSWORD;
  expect(password, 'E2E_PASSWORD must be configured for the disposable CI fixture').toBeTruthy();
  const login = await page.request.post('/api/auth/login', { data: { email:'neutral-theme@example.com', password } });
  expect(login.status()).toBe(200);
  const setup = await page.request.post('/api/organizations', { data:{name:`Orders decimal ${Date.now()}`,country_code:'GB',currency:'GBP',timezone:'Europe/London'} });
  expect(setup.status()).toBe(201);
  const {organization}=await setup.json();
  await context.addCookies([{name:'organization_id',value:organization.id,url:baseURL,httpOnly:true,sameSite:'Lax'}]);
  const clientResponse=await page.request.post('/api/crm/clients',{data:{display_name:'Orders decimal fixture',currency:'GBP'}});
  expect(clientResponse.status()).toBe(201);
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('/dashboard/orders/new');
  await page.getByRole('button',{name:'Client',exact:true}).click();
  await page.getByRole('listbox').getByRole('button',{name:/Orders decimal fixture/}).click();
  for(let index=0;index<2;index++){
    if(index)await page.getByRole('button',{name:'Add line',exact:true}).click();
    await page.getByLabel('Item / service name',{exact:true}).nth(index).fill(`Half cent ${index+1}`);
    await page.getByLabel('Description',{exact:true}).nth(index).fill('Disposable arithmetic test');
    await page.getByLabel('Quantity',{exact:true}).nth(index).fill('0.5');
    await page.locator('.order-editor-line-pricing > .order-editor-field').filter({hasText:/^Unit price/}).locator('input').nth(index).fill('0.01');
    await page.getByLabel('Tax %',{exact:true}).nth(index).fill('0');
    await page.getByLabel('Discount %',{exact:true}).nth(index).fill('0');
  }
  await expect(page.getByText('GBP 0.02',{exact:true})).toBeVisible();
  const price=page.locator('.order-editor-line-pricing > .order-editor-field').filter({hasText:/^Unit price/}).locator('input').first();
  await price.focus();
  await expect(price).toHaveCSS('outline-style','none');
  await expect(price).toHaveCSS('box-shadow','none');
  await expect(price.locator('..')).toHaveCSS('border-top-color','rgb(115, 115, 115)');
  await page.screenshot({path:info.outputPath('neutral-theme-orders-price-focus-desktop.png')});
  await page.setViewportSize({width:390,height:844});
  await price.scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('neutral-theme-orders-price-focus-mobile.png')});
  const sent=page.waitForResponse(r=>r.url().endsWith('/api/sales/orders')&&r.request().method()==='POST');
  const [created, response] = await Promise.all([
    captureJsonResponse(page, { path: '/api/sales/orders', action: () => page.getByRole('button',{name:'Create order',exact:true}).click() }),
    sent,
  ]);
  expect(response.status()).toBe(201);
  const wire=response.request().postDataJSON();
  expect(wire.items.map(i=>[i.quantity,i.unit_price])).toEqual([['0.5','0.01'],['0.5','0.01']]);
  await expect(page).toHaveURL(new RegExp(`/dashboard/orders/${created.id}(?:\\?.*)?$`));
  const read=await page.request.get(`/api/sales/orders/${created.id}`);
  expect(read.status()).toBe(200);
  const order=await read.json();
  expect(order.total).toBe('0.02');
  expect(order.items.map(i=>i.line_total)).toEqual(['0.01','0.01']);
});
