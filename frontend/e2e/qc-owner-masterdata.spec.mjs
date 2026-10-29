import { captureJsonResponse } from "./support/capture-json-response.mjs";
import { expect, test } from '@playwright/test';
const email = process.env.E2E_QC_MASTERDATA_EMAIL ?? 'qc-masterdata@example.com';
const password = process.env.E2E_PASSWORD ?? 'E2E-Launch-Password-123!';
const today = () => new Date().toISOString().slice(0, 10);
function threeMonthInclusiveEnd(start) {
  const d = new Date(`${start}T00:00:00Z`);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 3;
  const day = Math.min(d.getUTCDate(), new Date(Date.UTC(y, m + 1, 0)).getUTCDate());
  return new Date(Date.UTC(y, m, day - 1)).toISOString().slice(0, 10);
}
async function api(request, path, data, method = 'post') {
  const r = await request[method](path, data === undefined ? {} : {
    data
  });
  expect(r.ok(), `${method} ${path} ${r.status()} ${await r.text()}`).toBeTruthy();
  return r.status() === 204 ? null : r.json();
}
async function ui(page, path, method, action) {
  return captureJsonResponse(page, { path, method, action });
}

// Audit reads carry explicit pagination/filter queries; do not broaden the
// receipt helper's exact-URL contract or accidentally observe another read.
const auditPath = (query = {}) => `/api/tenant/activity-logs?${new URLSearchParams({ limit: '50', ...query })}`;

async function setup(page, context, prefix) {
  page.setDefaultTimeout(12000);
  await page.goto('/login');
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(page.url()).hostname);
  await page.getByLabel(/email or username/i).fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', {
    name: /sign in securely/i
  }).click();
  await expect(page).toHaveURL(/\/dashboard/, {
    timeout: 30000
  });
  const marker = `QC-${prefix}-${Date.now()}`;
  const org = await api(context.request, '/api/organizations', {
    name: marker,
    country_code: 'BD',
    timezone: 'UTC',
    currency: 'USD',
    business_type: 'Software & IT Services',
    team_size: '1-5',
    financial_year_start_month: 1
  });
  return {
    marker,
    organizationId: org.organization.id,
    cases: []
  };
}
function syntheticPdf(label) {
  const content = `BT /F1 12 Tf 40 100 Td (Synthetic owner document QC: ${label}) Tj ET\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 180] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
  ];
  let text = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(text));
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(text);
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  text += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text);
}


async function record(testInfo, evidence) {
  await testInfo.attach('masterdata-gap-evidence', {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json'
  });
}
test('owner CRM missing activities, follow-up, lost, custom stages and sources', async ({
  page,
  context
}, testInfo) => {
  test.setTimeout(240000);
  const e = await setup(page, context, 'CRM-GAPS');
  try {
    await page.goto('/dashboard/crm');
    await page.getByRole('button', {
      name: 'New lead',
      exact: true
    }).click();
    await page.getByRole('button', {
      name: 'Create lead',
      exact: true
    }).click();
    expect(await page.getByLabel('Contact person', {
      exact: true
    }).evaluate(el => el.validity.valueMissing)).toBe(true);
    await expect(page.getByLabel('Contact person', { exact: true })).toBeFocused();
    e.cases.push({
      id: 'CRM01',
      actual: 'Native contact required guard; no create'
    });
    await page.getByLabel('Contact person', {
      exact: true
    }).fill('Synthetic gap prospect');
    await page.getByLabel('Company name', {
      exact: true
    }).fill(e.marker);
    await page.getByLabel('Probability %', {
      exact: true
    }).fill('101');
    const invalid = page.waitForResponse(r => new URL(r.url()).pathname === '/api/crm/leads' && r.request().method() === 'POST');
    await page.getByRole('button', {
      name: 'Create lead',
      exact: true
    }).click();
    expect((await invalid).status()).toBe(422);
    await expect(page.getByText(/less than or equal to 100/)).toBeVisible();
    e.cases.push({
      id: 'CRM02',
      actual: '101 rejected HTTP422 with visible bound error'
    });
    await page.getByLabel('Probability %', {
      exact: true
    }).fill('35');
    await page.getByLabel('Email', {
      exact: true
    }).fill('synthetic@example.invalid');
    const badEmail = page.waitForResponse(r => new URL(r.url()).pathname === '/api/crm/leads' && r.request().method() === 'POST');
    await page.getByRole('button', {
      name: 'Create lead',
      exact: true
    }).click();
    expect((await badEmail).status()).toBe(422);
    await expect(page.getByText(/reserved|invalid email|not a valid email/i)).toBeVisible();
    await page.getByLabel('Email', {
      exact: true
    }).fill('');
    e.cases.push({
      id: 'CRM03',
      actual: 'Reserved .invalid email HTTP422 and visible readable error; cleared before save'
    });
    const initialMeta = await api(context.request, '/api/crm/meta', undefined, 'get');
    const referral = initialMeta.sources.find(x => x.is_active && x.name === 'Referral') ?? initialMeta.sources.find(x => x.is_active);
    await page.locator('select[name="source_id"]').selectOption(referral.id);
    expect(initialMeta.employees).toHaveLength(1);
    const ownerEmployee = initialMeta.employees[0];
    await page.getByRole('button', { name: 'Assigned to', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(ownerEmployee.employee_code) }).click();
    await page.getByLabel('Estimated value', { exact: true }).fill('125');
    await page.getByLabel('Next follow-up', {
      exact: true
    }).fill('2020-01-01T09:00');
    const lead = await ui(page, '/api/crm/leads', 'POST', () => page.getByRole('button', {
      name: 'Create lead',
      exact: true
    }).click());
    e.leadId = lead.id;
    const createdLead = (await api(context.request, `/api/crm/leads/${lead.id}`, undefined, 'get')).lead;
    expect(createdLead.source_id).toBe(referral.id);
    expect(createdLead.assigned_employee_id).toBe(ownerEmployee.id);
    expect(Number(createdLead.estimated_value)).toBe(125);
    expect(Number(createdLead.probability_percent)).toBe(35);
    e.cases.push({ id: 'CRM04', actual: 'UI company lead source/value125/probability35/self-assignment persisted; blank email' });
    expect((await api(context.request, '/api/crm/summary', undefined, 'get')).due_followups).toBe(1);
    e.cases.push({
      id: 'CRM12',
      actual: 'Past follow-up persisted and due count 1'
    });
    const sourceFilter = page.locator('select').filter({
      has: page.getByRole('option', {
        name: 'All sources',
        exact: true
      })
    });
    await sourceFilter.selectOption(referral.id);
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody')).toContainText(referral.name);
    const filteredLeads = await api(context.request, `/api/crm/leads?source_id=${referral.id}`, undefined, 'get');
    expect(filteredLeads.items.map(x => x.id)).toEqual([lead.id]);
    await page.getByRole('button', {
      name: 'Reset',
      exact: true
    }).click();
    await expect(sourceFilter).toHaveValue('');
    const leadSearch = page.getByPlaceholder('Search code, name, email, phone...');
    await leadSearch.fill(e.marker);
    await leadSearch.press('Enter');
    await page.getByRole('heading', { name: 'CRM & Leads', exact: true }).click();
    await expect(leadSearch).toHaveValue(e.marker);
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await page.reload();
    e.cases.push({ id: 'CRM10', actual: 'Explicit Enter and blur retain typed matching query and exact result; typing/no-match/reset covered existing CRM test' });

    e.cases.push({
      id: 'CRM11',
      actual: 'Source filter matches exact persisted lead/source and Reset clears; status filter covered separate crm spec'
    });
    await page.getByRole('row').filter({
      hasText: e.marker
    }).getByRole('button', {
      name: /^Open lead /
    }).click();
    await page.getByLabel('Subject', {
      exact: true
    }).fill('Gap note');
    await page.getByLabel('Details', {
      exact: true
    }).fill('Exact synthetic CRM note');
    await ui(page, `/api/crm/leads/${lead.id}/interactions`, 'POST', () => page.getByRole('button', {
      name: 'Add activity',
      exact: true
    }).click());
    await expect(page.getByText('Exact synthetic CRM note', {
      exact: true
    })).toBeVisible();
    let detail = await api(context.request, `/api/crm/leads/${lead.id}`, undefined, 'get');
    expect(detail.interactions.some(i => i.subject === 'Gap note' && i.body === 'Exact synthetic CRM note')).toBe(true);
    e.cases.push({
      id: 'CRM06',
      actual: 'Note UI create, exact body timeline and API readback'
    });
    await page.locator('select[name="interaction_type"]').selectOption('follow_up');
    await page.getByLabel('Subject', {
      exact: true
    }).fill('Future follow-up');
    await page.getByLabel('Schedule / follow-up time', {
      exact: true
    }).fill('2030-01-01T09:00');
    await ui(page, `/api/crm/leads/${lead.id}/interactions`, 'POST', () => page.getByRole('button', {
      name: 'Add activity',
      exact: true
    }).click());
    detail = await api(context.request, `/api/crm/leads/${lead.id}`, undefined, 'get');
    expect(detail.lead.next_follow_up_at).toContain('2030-01-01T09:00');
    expect(detail.interactions[0].subject).toBe('Future follow-up');
    expect(detail.interactions.some(i => i.subject === 'Future follow-up' && i.scheduled_at.startsWith('2030-01-01T09:00'))).toBe(true);
    const timestamps = detail.interactions.map(i => Date.parse(i.created_at));
    expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));
    let summary = await api(context.request, '/api/crm/summary', undefined, 'get');
    expect(summary.due_followups).toBe(0);
    e.cases.push({
      id: 'CRM13',
      actual: '2030 follow-up persists on lead and timeline; due count zero'
    });
    const meta = await api(context.request, '/api/crm/meta', undefined, 'get');
    await ui(page, `/api/crm/leads/${lead.id}/status`, 'PATCH', () => page.getByLabel('Lead status', { exact: true }).selectOption(meta.statuses.find(s => s.category === 'qualified').id));
    const qualifiedDetail = await api(context.request, `/api/crm/leads/${lead.id}`, undefined, 'get');
    expect(qualifiedDetail.interactions.some(i => JSON.stringify(i).includes('New') && JSON.stringify(i).includes('Qualified'))).toBe(true);
    e.cases.push({ id: 'CRM05', actual: 'New to Qualified UI transition exact before/after names in persisted timeline' });
    await ui(page, `/api/crm/leads/${lead.id}/status`, 'PATCH', () => page.getByLabel('Lead status', {
      exact: true
    }).selectOption(meta.statuses.find(s => s.category === 'lost').id));
    summary = await api(context.request, '/api/crm/summary', undefined, 'get');
    expect(summary.open_leads).toBe(0);
    detail = await api(context.request, `/api/crm/leads/${lead.id}`, undefined, 'get');
    expect(detail.lead.status_category).toBe('lost');
    expect(detail.interactions.some(i => JSON.stringify(i).includes('Lost'))).toBe(true);
    e.cases.push({
      id: 'CRM14',
      actual: 'Lost removes sole open lead; persisted status and audit timeline'
    });
    await page.goto('/dashboard/crm');
    await page.getByRole('button', {
      name: 'Pipeline Settings',
      exact: true
    }).click();
    const stages = page.locator('section').filter({
      has: page.getByRole('heading', {
        name: 'Lead statuses',
        exact: true
      })
    });
    await stages.getByLabel('Name', {
      exact: true
    }).fill('Synthetic stage');
    const stage = await ui(page, '/api/crm/settings/statuses', 'POST', () => stages.getByRole('button', {
      name: 'Add',
      exact: true
    }).click());
    let row = stages.locator('div.p-4').filter({
      hasText: 'Synthetic stage'
    });
    await row.getByRole('button', {
      name: 'Edit',
      exact: true
    }).click();
    const form = stages.locator('form').filter({
      has: page.getByRole('button', {
        name: 'Save',
        exact: true
      })
    });
    await form.getByLabel('Name', {
      exact: true
    }).fill('Revised synthetic stage');
    await ui(page, `/api/crm/settings/statuses/${stage.id}`, 'PATCH', () => form.getByRole('button', {
      name: 'Save',
      exact: true
    }).click());
    row = stages.locator('div.p-4').filter({
      hasText: 'Revised synthetic stage'
    });
    await ui(page, `/api/crm/settings/statuses/${stage.id}`, 'PATCH', () => row.getByRole('button', {
      name: 'Disable',
      exact: true
    }).click());
    await expect(row).toContainText('Disabled');
    const def = stages.locator('div.p-4').filter({
      hasText: 'Default'
    });
    await expect(def.getByRole('button', {
      name: 'Disable',
      exact: true
    })).toBeDisabled();
    await expect(def.getByRole('button', {
      name: 'Delete',
      exact: true
    })).toBeDisabled();
    e.cases.push({
      id: 'CRM15',
      actual: 'Custom create rename disable, default disable/delete UI protected'
    });
    const sources = page.locator('section').filter({
      has: page.getByRole('heading', {
        name: 'Lead sources',
        exact: true
      })
    });
    await sources.getByLabel('Source name', {
      exact: true
    }).fill('Synthetic gap source');
    const source = await ui(page, '/api/crm/settings/sources', 'POST', () => sources.getByRole('button', {
      name: 'Add',
      exact: true
    }).click());
    await ui(page, `/api/crm/settings/sources/${source.id}`, 'PATCH', () => sources.locator('div.p-4').filter({
      hasText: 'Synthetic gap source'
    }).getByRole('button', {
      name: 'Disable',
      exact: true
    }).click());
    await page.reload();
    await page.getByRole('button', {
      name: 'Pipeline Settings',
      exact: true
    }).click();
    await expect(sources.locator('div.p-4').filter({
      hasText: 'Synthetic gap source'
    })).toContainText('Disabled');
    const saved = await api(context.request, '/api/crm/meta', undefined, 'get');
    expect(saved.sources.find(s => s.id === source.id).is_active).toBe(false);
    expect(saved.statuses.find(s => s.id === stage.id)).toMatchObject({
      name: 'Revised synthetic stage',
      is_active: false
    });
    e.cases.push({
      id: 'CRM16',
      actual: 'Custom source UI create disable; reload and API persisted'
    });
  } finally {
    await record(testInfo, e);
  }
});
test('owner catalog, suppliers and warehouses missing guards and persistence', async ({
  page,
  context
}, testInfo) => {
  test.setTimeout(300000);
  const e = await setup(page, context, 'MASTER');
  try {
    await page.goto('/dashboard/inventory');
    await page.getByRole('button', {
      name: 'Products & services',
      exact: true
    }).click();
    await expect(page).toHaveURL(/\/dashboard\/inventory\?(?=.*tab=items)/);
    await page.getByRole('navigation', { name: 'Inventory sections' }).getByRole('button', { name: 'Categories', exact: true }).click();
    await page.getByRole('button', { name: 'Add category', exact: true }).click();
    await page.getByLabel('Category name', {
      exact: true
    }).fill('Synthetic category');
    await page.getByLabel('Description', {
      exact: true
    }).fill('Exact category description');
    const cat = await ui(page, '/api/inventory/categories', 'POST', () => page.getByRole('button', {
      name: 'Add',
      exact: true
    }).click());
    await expect(page.getByRole('row').filter({ hasText: 'Synthetic category' })).toContainText('Exact category description');
    expect(cat.description).toBe('Exact category description');
    e.cases.push({
      id: 'CAT05',
      actual: 'UI category create and exact API persisted description'
    });
    await page.goto('/dashboard/inventory');
    await page.getByRole('button', {
      name: 'Products & services',
      exact: true
    }).click();
    await expect(page).toHaveURL(/\/dashboard\/inventory\?(?=.*tab=items)/);
    await page.getByRole('button', { name: 'Add item', exact: true }).first().click();
    await page.getByLabel('Item type', {
      exact: true
    }).selectOption('service');
    await page.getByLabel('SKU / Code', {
      exact: true
    }).fill('GAP-SVC');
    await page.getByLabel('Name', {
      exact: true
    }).fill('Synthetic service');
    await page.getByLabel('Selling price', {
      exact: true
    }).fill('30');
    await page.getByLabel('Service duration', {
      exact: false
    }).selectOption('fixed');
    await page.getByLabel('Duration (months)', {
      exact: false
    }).fill('0');
    await page.getByRole('button', {
      name: 'Add item',
      exact: true
    }).last().click();
    expect(await page.getByLabel('Duration (months)', {
      exact: false
    }).evaluate(el => el.validity.rangeUnderflow)).toBe(true);
    e.cases.push({
      id: 'CAT02',
      actual: 'Fixed duration zero blocked by native min1'
    });
    await page.getByLabel('Duration (months)', {
      exact: false
    }).fill('3');
    const svc = await ui(page, '/api/inventory/products', 'POST', () => page.getByRole('button', {
      name: 'Add item',
      exact: true
    }).last().click());
    await expect(page.getByRole('row').filter({ hasText: 'GAP-SVC' })).toBeVisible();
    let products = await api(context.request, '/api/inventory/products?include_inactive=true', undefined, 'get');
    expect((await api(context.request, '/api/services/catalog', undefined, 'get')).find(p => p.product_id === svc.id).duration_months).toBe(3);
    e.cases.push({
      id: 'CAT03',
      actual: 'UI fixed service create; persisted price30, duration3'
    });
    let row = page.getByRole('row').filter({
      hasText: 'GAP-SVC'
    });
    await row.getByRole('button', {
      name: /^Edit /
    }).click();
    await page.getByLabel('Name', {
      exact: true
    }).fill('Synthetic service revised');
    await page.getByLabel('Duration (months)', {
      exact: false
    }).fill('6');
    await page.getByRole('button', {
      name: 'Category',
      exact: true
    }).click();
    await page.getByRole('button', {
      name: /^Synthetic category/
    }).click();
    await ui(page, `/api/inventory/products/${svc.id}`, 'PATCH', () => page.getByRole('button', {
      name: 'Update item',
      exact: true
    }).click());
    await expect(page.getByRole('row').filter({ hasText: 'Synthetic service revised' })).toBeVisible();
    products = await api(context.request, '/api/inventory/products?include_inactive=true', undefined, 'get');
    expect(products.find(p => p.id === svc.id)).toMatchObject({
      name: 'Synthetic service revised',
      category_id: cat.id
    });
    expect((await api(context.request, '/api/services/catalog', undefined, 'get')).find(p => p.product_id === svc.id).duration_months).toBe(6);
    e.cases.push({
      id: 'CAT04',
      actual: 'UI rename term6 and category, API persisted'
    });
    await page.getByRole('button', { name: 'Add item', exact: true }).first().click();
    await page.getByLabel('SKU / Code', {
      exact: true
    }).fill('GAP-SVC');
    await page.getByLabel('Name', {
      exact: true
    }).fill('Duplicate');
    let pending = page.waitForResponse(r => new URL(r.url()).pathname === '/api/inventory/products' && r.request().method() === 'POST');
    await page.getByRole('button', {
      name: 'Add item',
      exact: true
    }).last().click();
    expect((await pending).status()).toBe(409);
    await expect(page.getByText('SKU already exists', {
      exact: false
    })).toBeVisible();
    e.cases.push({
      id: 'CAT01',
      actual: 'Duplicate SKU HTTP409 and readable error; original preserved'
    });
    await page.getByLabel('SKU / Code', {
      exact: true
    }).fill('GAP-STOCK');
    await page.getByLabel('Name', {
      exact: true
    }).fill('Synthetic zero stock');
    await page.getByLabel('Selling price', {
      exact: true
    }).fill('-1');
    pending = page.waitForResponse(r => new URL(r.url()).pathname === '/api/inventory/products' && r.request().method() === 'POST');
    await page.getByRole('button', {
      name: 'Add item',
      exact: true
    }).last().click();
    expect((await pending).status()).toBe(422);
    await expect(page.getByText(/greater than or equal to 0/)).toBeVisible();
    e.cases.push({
      id: 'CAT08',
      actual: 'Negative price HTTP422 and readable minimum error'
    });
    await page.getByLabel('Selling price', {
      exact: true
    }).fill('12');
    const stock = await ui(page, '/api/inventory/products', 'POST', () => page.getByRole('button', {
      name: 'Add item',
      exact: true
    }).last().click());
    await expect(page.getByRole('row').filter({ hasText: 'GAP-STOCK' })).toBeVisible();
    products = await api(context.request, '/api/inventory/products?include_inactive=true', undefined, 'get');
    expect(Number(products.find(p => p.id === stock.id).on_hand)).toBe(0);
    e.cases.push({
      id: 'CAT09',
      actual: 'UI product create price12, persisted zero onhand and inventory value'
    });
    const search = page.getByPlaceholder('Search SKU, name or category…');
    await search.fill('GAP-SVC');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody')).toContainText('GAP-SVC');
    e.cases.push({
      id: 'CAT06',
      actual: 'SKU search isolates service'
    });
    await page.locator('select').filter({
      has: page.getByRole('option', {
        name: 'All items',
        exact: true
      })
    }).selectOption('stock_item');
    await expect(page.getByText('No matching items', {
      exact: true
    })).toBeVisible();
    e.cases.push({
      id: 'CAT07',
      actual: 'Service SKU + stock type mismatch yields empty'
    });
    await search.fill('');
    // Both controls update URL-backed browse state. Commit clearing search
    // before changing type, otherwise the second update can retain the old SKU.
    await page.waitForURL(url => url.pathname === '/dashboard/inventory' && !url.searchParams.has('search'));
    await page.locator('select').filter({
      has: page.getByRole('option', {
        name: 'All items',
        exact: true
      })
    }).selectOption('all');
    await page.waitForURL(url => url.pathname === '/dashboard/inventory' && !url.searchParams.has('search') && !url.searchParams.has('type'));
    row = page.getByRole('row').filter({
      hasText: 'GAP-STOCK'
    });
    await row.getByRole('button', {
      name: /^Edit /
    }).click();
    await page.getByLabel('Name', {
      exact: true
    }).fill('Synthetic zero stock revised');
    await page.getByLabel('Unit', {
      exact: true
    }).fill('piece');
    await ui(page, `/api/inventory/products/${stock.id}`, 'PATCH', () => page.getByRole('button', {
      name: 'Update item',
      exact: true
    }).click());
    await expect(page.getByRole('row').filter({ hasText: 'Synthetic zero stock revised' })).toBeVisible();
    await ui(page, `/api/inventory/products/${stock.id}`, 'PATCH', () => row.getByRole('button', {
      name: /^Disable /
    }).click());
    await expect(row.getByRole('button', {
      name: /^Enable /
    })).toBeVisible();
    await page.reload();
    await page.getByRole('button', {
      name: 'Products & services',
      exact: true
    }).click();
    await expect(page).toHaveURL(/\/dashboard\/inventory\?(?=.*tab=items)/);
    await row.getByRole('button', {
      name: /^Edit /
    }).click();
    await expect(page.getByLabel('Unit', {
      exact: true
    })).toHaveValue('piece');
    await expect(page.getByLabel('Name', {
      exact: true
    })).toHaveValue('Synthetic zero stock revised');
    await expect(page.getByLabel('Active item', {
      exact: true
    })).not.toBeChecked();
    e.cases.push({
      id: 'CAT10',
      actual: 'Name and unit edit survive full reload exact editor readback'
    }, {
      id: 'CAT11',
      actual: 'Unused product disable persists and Enable control appears'
    });
    await page.goto('/dashboard/inventory');
    await page.getByRole('button', {
      name: 'Suppliers',
      exact: true
    }).click();
    await page.getByRole('button', {
      name: 'Add supplier',
      exact: true
    }).click();
    await page.getByRole('button', {
      name: 'Add supplier',
      exact: true
    }).last().click();
    expect(await page.getByLabel('Supplier name', {
      exact: true
    }).evaluate(el => el.validity.valueMissing)).toBe(true);
    e.cases.push({
      id: 'SUP01',
      actual: 'Native supplier name required'
    });
    await page.getByLabel('Supplier name', {
      exact: true
    }).fill('Synthetic gap supplier');
    await page.getByLabel('Email', {
      exact: true
    }).fill('invalid');
    await page.getByRole('button', {
      name: 'Add supplier',
      exact: true
    }).last().click();
    expect(await page.getByLabel('Email', {
      exact: true
    }).evaluate(el => el.validity.typeMismatch)).toBe(true);
    e.cases.push({
      id: 'SUP02',
      actual: 'Malformed email native typeMismatch blocked'
    });
    await page.getByLabel('Email', {
      exact: true
    }).fill('');
    const supplier = await ui(page, '/api/inventory/suppliers', 'POST', () => page.getByRole('button', {
      name: 'Add supplier',
      exact: true
    }).last().click());
    expect(supplier.email).toBeNull();
    expect(supplier.currency).toBe('USD');
    expect(Number(supplier.purchase_count)).toBe(0);
    expect(Number(supplier.outstanding_total)).toBe(0);
    e.cases.push({
      id: 'SUP03',
      actual: 'Blank contact creation, persisted purchases0 outstanding0'
    });
    await page.getByPlaceholder('Search supplier, contact or email…').fill('not-existing');
    await expect(page.getByText('No matching suppliers', {
      exact: true
    })).toBeVisible();
    await page.getByPlaceholder('Search supplier, contact or email…').fill('Synthetic gap');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    e.cases.push({
      id: 'SUP04',
      actual: 'Positive and negative supplier search'
    });
    row = page.getByRole('row').filter({
      hasText: 'Synthetic gap supplier'
    });
    await row.getByRole('button', {
      name: /^Edit /
    }).click();
    await page.getByLabel('Supplier name', {
      exact: true
    }).fill('Synthetic gap supplier revised');
    await ui(page, `/api/inventory/suppliers/${supplier.id}`, 'PATCH', () => page.getByRole('button', {
      name: 'Update supplier',
      exact: true
    }).click());
    await expect(page.getByRole('row').filter({ hasText: 'Synthetic gap supplier revised' })).toBeVisible();
    await ui(page, `/api/inventory/suppliers/${supplier.id}`, 'PATCH', () => row.getByRole('button', {
      name: /^Disable /
    }).click());
    let suppliers = await api(context.request, '/api/inventory/suppliers?include_inactive=true', undefined, 'get');
    expect(suppliers.find(s => s.id === supplier.id)).toMatchObject({
      name: 'Synthetic gap supplier revised',
      is_active: false
    });
    e.cases.push({
      id: 'SUP05',
      actual: 'UI rename persisted'
    }, {
      id: 'SUP06',
      actual: 'UI disable persisted'
    });
    await page.getByRole('button', {
      name: 'Warehouses',
      exact: true
    }).click();
    await page.getByRole('button', {
      name: 'Add warehouse',
      exact: true
    }).click();
    await page.getByRole('button', {
      name: 'Add warehouse',
      exact: true
    }).last().click();
    expect(await page.getByLabel('Warehouse code', {
      exact: true
    }).evaluate(el => el.validity.valueMissing)).toBe(true);
    e.cases.push({
      id: 'WH01',
      actual: 'Native code required'
    });
    await page.getByLabel('Warehouse code', {
      exact: true
    }).fill('GAP-WH');
    await page.getByLabel('Warehouse name', {
      exact: true
    }).fill('Synthetic empty warehouse');
    await page.getByLabel('Use as default warehouse', { exact: true }).uncheck();
    const wh = await ui(page, '/api/inventory/warehouses', 'POST', () => page.getByRole('button', {
      name: 'Add warehouse',
      exact: true
    }).last().click());
    await expect(page.getByRole('row').filter({ hasText: 'Synthetic empty warehouse' })).toBeVisible();
    expect(wh.is_default).toBe(false);
    e.cases.push({
      id: 'WH03',
      actual: 'UI non-default empty warehouse created'
    });
    await page.getByRole('button', {
      name: 'Add warehouse',
      exact: true
    }).click();
    await page.getByLabel('Warehouse code', {
      exact: true
    }).fill('GAP-WH');
    await page.getByLabel('Warehouse name', {
      exact: true
    }).fill('Duplicate');
    pending = page.waitForResponse(r => new URL(r.url()).pathname === '/api/inventory/warehouses' && r.request().method() === 'POST');
    await page.getByRole('button', {
      name: 'Add warehouse',
      exact: true
    }).last().click();
    expect((await pending).status()).toBe(409);
    await expect(page.getByText('Warehouse code already exists', {
      exact: false
    })).toBeVisible();
    e.cases.push({
      id: 'WH02',
      actual: 'Duplicate code HTTP409 visible error'
    });
    await page.goto('/dashboard/inventory');
    await page.getByRole('button', {
      name: 'Warehouses',
      exact: true
    }).click();
    row = page.getByRole('row').filter({ hasText: 'Synthetic empty warehouse' });
    await row.getByRole('button', {
      name: /^Edit /
    }).click();
    await page.getByLabel('Warehouse name', {
      exact: true
    }).fill('Synthetic empty warehouse revised');
    await page.getByLabel('Active warehouse', {
      exact: true
    }).uncheck();
    await ui(page, `/api/inventory/warehouses/${wh.id}`, 'PATCH', () => page.getByRole('button', {
      name: 'Update warehouse',
      exact: true
    }).click());
    await expect(page).toHaveURL(/\/dashboard\/inventory\?(?=.*tab=warehouses)/);
    await page.reload();
    await page.getByRole('button', {
      name: 'Warehouses',
      exact: true
    }).click();
    await expect(row).toContainText('Synthetic empty warehouse revised');
    await expect(row).toContainText('Inactive');
    e.cases.push({
      id: 'WH04',
      actual: 'UI rename/deactivate persisted across reload'
    });
    expect(await api(context.request, '/api/inventory/stock', undefined, 'get')).toEqual([]);
    expect(await api(context.request, '/api/inventory/movements', undefined, 'get')).toEqual([]);
    expect(await api(context.request, '/api/accounting/journals', undefined, 'get')).toEqual([]);
    e.conservation = 'No stock balances, stock movements or journals created by master changes';
  } finally {
    await record(testInfo, e);
  }
});
test('owner company reversible defaults, branding, identifiers, addresses and audit filters pagination', async ({
  page,
  context
}, testInfo) => {
  test.setTimeout(240000);
  const e = await setup(page, context, 'SETTINGS');
  try {
    const original = await api(context.request, '/api/company-settings', undefined, 'get');
    await page.goto('/dashboard/company');
    await page.locator('textarea[name="internal_notes"]').fill('Synthetic internal gap note');
    await ui(page, '/api/company-settings/profile', 'PATCH', () => page.getByRole('button', {
      name: 'Save changes',
      exact: true
    }).click());
    await page.reload();
    await expect(page.locator('textarea[name="internal_notes"]')).toHaveValue('Synthetic internal gap note');
    await page.locator('textarea[name="internal_notes"]').fill(original.profile.internal_notes ?? '');
    await ui(page, '/api/company-settings/profile', 'PATCH', () => page.getByRole('button', {
      name: 'Save changes',
      exact: true
    }).click());
    await page.getByRole('button', {
      name: 'Localization',
      exact: true
    }).click();
    await page.locator('select[name="date_format"]').selectOption('DD/MM/YYYY');
    await ui(page, '/api/company-settings/localization', 'PATCH', () => page.getByRole('button', {
      name: 'Save changes',
      exact: true
    }).click());
    await page.reload();
    await page.getByRole('button', {
      name: 'Localization',
      exact: true
    }).click();
    await expect(page.locator('select[name="date_format"]')).toHaveValue('DD/MM/YYYY');
    await page.locator('select[name="date_format"]').selectOption(original.localization.date_format);
    await ui(page, '/api/company-settings/localization', 'PATCH', () => page.getByRole('button', {
      name: 'Save changes',
      exact: true
    }).click());
    e.cases.push({
      id: 'SET01',
      actual: 'UI note/date format edit reload verified; originals restored and API readback'
    });
    await page.getByRole('button', {
      name: 'Branding',
      exact: true
    }).click();
    await page.getByLabel('Company logo URL', {
      exact: true
    }).fill('not-a-url');
    await page.getByRole('button', {
      name: 'Save changes',
      exact: true
    }).click();
    expect(await page.getByLabel('Company logo URL', {
      exact: true
    }).evaluate(el => el.validity.typeMismatch)).toBe(true);
    await page.getByLabel('Company logo URL', {
      exact: true
    }).fill(original.branding.logo_url ?? '');
    await page.locator('textarea[name="document_footer"]').fill('Synthetic reversible footer');
    await ui(page, '/api/company-settings/branding', 'PATCH', () => page.getByRole('button', {
      name: 'Save changes',
      exact: true
    }).click());
    await page.reload();
    await page.getByRole('button', {
      name: 'Branding',
      exact: true
    }).click();
    await expect(page.locator('textarea[name="document_footer"]')).toHaveValue('Synthetic reversible footer');
    await page.locator('textarea[name="document_footer"]').fill(original.branding.document_footer ?? '');
    await ui(page, '/api/company-settings/branding', 'PATCH', () => page.getByRole('button', {
      name: 'Save changes',
      exact: true
    }).click());
    e.cases.push({
      id: 'SET03',
      actual: 'Invalid URL native block, footer UI save/reload/restoration'
    });
    await page.getByRole('button', {
      name: 'Legal & IDs',
      exact: true
    }).click();
    await page.getByRole('button', {
      name: 'Type',
      exact: true
    }).click();
    await page.getByRole('button', {
      name: /^Other/
    }).click();
    await page.getByLabel('Display label', {
      exact: true
    }).fill('Synthetic reference');
    await page.getByLabel('Value', {
      exact: true
    }).fill('SYNTHETIC-NOT-A-REAL-ID');
    const ident = await ui(page, '/api/company-settings/identifiers', 'POST', () => page.getByRole('button', {
      name: 'Add identifier',
      exact: true
    }).click());
    expect(ident.is_primary).toBe(false);
    expect(ident.country_code).toBe('BD');
    await page.reload();
    await page.getByRole('button', {
      name: 'Legal & IDs',
      exact: true
    }).click();
    await expect(page.getByText('Synthetic reference', {
      exact: true
    })).toBeVisible();
    let bundle = await api(context.request, '/api/company-settings', undefined, 'get');
    expect(bundle.identifiers.find(i => i.id === ident.id).value).toBe('SYNTHETIC-NOT-A-REAL-ID');
    await ui(page, `/api/company-settings/identifiers/${ident.id}`, 'DELETE', () => page.locator('div.p-4').filter({
      has: page.getByText('Synthetic reference', {
        exact: true
      })
    }).getByRole('button').click());
    expect((await api(context.request, '/api/company-settings', undefined, 'get')).identifiers.some(i => i.id === ident.id)).toBe(false);
    e.cases.push({
      id: 'SET07',
      actual: 'Other BD non-primary identifier UI create/reload/delete with exact persisted value'
    });
    await page.getByRole('button', {
      name: 'Addresses',
      exact: true
    }).click();
    await page.getByRole('tab', {
      name: 'Mailing',
      exact: true
    }).click();
    const mailing = page.getByRole('tabpanel', {
      name: 'Mailing address',
      exact: true
    });
    await mailing.getByLabel('Address line 1', {
      exact: true
    }).fill('Synthetic non-deliverable address');
    await mailing.getByLabel('Address line 2', {
      exact: true
    }).fill('Initial line two');
    await ui(page, '/api/company-settings/addresses/mailing', 'PUT', () => mailing.getByRole('button', {
      name: 'Save address',
      exact: true
    }).click());
    await expect(mailing.getByRole('button', { name: 'Save address', exact: true })).toBeEnabled();
    await mailing.getByLabel('Address line 2', {
      exact: true
    }).fill('Revised line two');
    await ui(page, '/api/company-settings/addresses/mailing', 'PUT', () => mailing.getByRole('button', {
      name: 'Save address',
      exact: true
    }).click());
    await page.reload();
    await page.getByRole('button', {
      name: 'Addresses',
      exact: true
    }).click();
    await page.getByRole('tab', {
      name: 'Mailing',
      exact: true
    }).click();
    await expect(mailing.getByLabel('Address line 2', {
      exact: true
    })).toHaveValue('Revised line two');
    bundle = await api(context.request, '/api/company-settings', undefined, 'get');
    expect(bundle.addresses.filter(a => a.address_type !== 'mailing')).toEqual(original.addresses.filter(a => a.address_type !== 'mailing'));
    expect(bundle.profile.internal_notes).toBe(original.profile.internal_notes);
    expect(bundle.localization.date_format).toBe(original.localization.date_format);
    expect(bundle.branding.document_footer).toBe(original.branding.document_footer);
    e.cases.push({
      id: 'SET09',
      actual: 'Mailing create/edit/full reload, other address types untouched'
    });
    // SET05 adds navigation persistence; existing download suite separately proves saved bytes.
    await page.getByRole('button', { name: 'Documents', exact: true }).click();
    await page.getByRole('button', { name: 'Document type', exact: true }).click();
    await page.getByRole('listbox').getByRole('button', { name: 'Other / Custom' }).click();
    await page.getByLabel('Title', { exact: true }).fill('Synthetic persisted company PDF');
    await page.locator('input[name="file"]').setInputFiles({ name: 'synthetic-persistence.pdf', mimeType: 'application/pdf', buffer: syntheticPdf('navigation persistence') });
    const companyDoc = await ui(page, '/api/company-settings/documents/upload', 'POST', () => page.getByRole('button', { name: 'Upload document', exact: true }).click());
    await expect(page.getByText('Document uploaded', { exact: true })).toBeVisible();
    await page.goto('/dashboard');
    await page.goto('/dashboard/company');
    await page.getByRole('button', { name: 'Documents', exact: true }).click();
    await expect(page.getByText('Synthetic persisted company PDF', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download', exact: true })).toHaveAttribute('href', `/api/company-settings/documents/${companyDoc.id}/file`);
    expect((await api(context.request, '/api/company-settings', undefined, 'get')).documents.find(d => d.id === companyDoc.id).title).toBe('Synthetic persisted company PDF');
    e.cases.push({ id: 'SET05', actual: 'Synthetic PDF UI upload; navigate away/back persists title/document metadata and authenticated download link' });
    // Explicit API-only audit-volume fixture: reversible internal note edits produce real audit records.
    for (let n = 0; n < 105; n++) await api(context.request, '/api/company-settings/profile', {
      internal_notes: `Synthetic audit pagination ${n}`
    }, 'patch');
    await api(context.request, '/api/company-settings/profile', {
      internal_notes: original.profile.internal_notes
    }, 'patch');
    await page.goto('/dashboard/activity-logs');
    await expect(page.locator('tbody tr')).toHaveCount(50);
    const first = await api(context.request, '/api/tenant/activity-logs?limit=50', undefined, 'get');
    expect(first.next_cursor).toBeTruthy();
    await expect(page.locator('tbody tr')).toHaveCount(first.items.length);
    const initialRows = await page.locator('tbody tr').allTextContents();
    const second = await ui(page, auditPath({ cursor: first.next_cursor }), 'GET', () => page.getByRole('button', {
      name: 'Load older activity',
      exact: true
    }).click());
    expect(second.items).toHaveLength(50);
    expect(new Set([...first.items, ...second.items].map(i => i.id)).size).toBe(first.items.length + second.items.length);
    await expect(page.locator('tbody tr')).toHaveCount(first.items.length + second.items.length);
    expect((await page.locator('tbody tr').allTextContents()).slice(0, 50)).toEqual(initialRows);
    e.cases.push({
      id: 'AUD02',
      actual: 'Real >50-row audit API fixture; UI appends second cursor page, retains initial rows, unique IDs'
    });
    const action = first.items[0].action,
      entity = first.items[0].entity_type;
    await page.getByPlaceholder('Action contains…').fill(action);
    await page.getByPlaceholder('Entity type', {
      exact: true
    }).fill(entity);
    await page.locator('select').selectOption('success');
    let filtered = await ui(page, auditPath({ action, entity_type: entity, outcome: 'success' }), 'GET', () => page.getByRole('button', {
      name: 'Apply',
      exact: true
    }).click());
    expect(filtered.items.length).toBeGreaterThan(0);
    expect(filtered.items.every(i => i.action.includes(action) && i.entity_type === entity && i.outcome === 'success')).toBe(true);
    await page.getByPlaceholder('Action contains…').fill('no-such-synthetic-action');
    filtered = await ui(page, auditPath({ action: 'no-such-synthetic-action', entity_type: entity, outcome: 'success' }), 'GET', () => page.getByRole('button', {
      name: 'Apply',
      exact: true
    }).click());
    expect(filtered.items).toEqual([]);
    await expect(page.getByText('No activity logs match the current filters.', {
      exact: true
    })).toBeVisible();
    await ui(page, auditPath(), 'GET', () => page.getByRole('button', {
      name: 'Reset',
      exact: true
    }).click());
    await expect(page.locator('tbody tr')).toHaveCount(50);
    await expect(page.getByPlaceholder('Action contains…')).toHaveValue('');
    e.cases.push({
      id: 'AUD01',
      actual: 'Action/entity/success conjunctive filter; negative query empty; Reset restores 50 real rows'
    });
    const auditToday = today(), auditTomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const dates = page.locator('input[type="date"]');
    await dates.nth(0).fill(auditTomorrow);
    await dates.nth(1).fill(auditTomorrow);
    let dateFiltered = await ui(page, auditPath({ date_from: auditTomorrow, date_to: auditTomorrow }), 'GET', () => page.getByRole('button', { name: 'Apply', exact: true }).click());
    expect(dateFiltered.items).toEqual([]);
    await expect(page.getByText('No activity logs match the current filters.', { exact: true })).toBeVisible();
    await dates.nth(0).fill(auditToday);
    await dates.nth(1).fill(auditToday);
    dateFiltered = await ui(page, auditPath({ date_from: auditToday, date_to: auditToday }), 'GET', () => page.getByRole('button', { name: 'Apply', exact: true }).click());
    expect(dateFiltered.items).toHaveLength(50);
    await expect(dates.nth(0)).toHaveValue(auditToday);
    await expect(dates.nth(1)).toHaveValue(auditToday);
    e.cases.push({ id: 'AUD03', actual: `Synthetic run date ${auditToday} returns50; next day ${auditTomorrow} empty; date selections retained on Apply` });

  } finally {
    await record(testInfo, e);
  }
});
test('owner client profile notes secure text read and CRM catalog interests', async ({
  page,
  context
}, testInfo) => {
  test.setTimeout(180000);
  const e = await setup(page, context, 'CLIENT');
  try {
    // API-only isolated fixture creation; all asserted edits and file workflows below are UI.
    const client = await api(context.request, '/api/crm/clients', {
      client_type: 'company',
      display_name: 'Synthetic gap client',
      currency: 'USD',
      country_code: 'BD'
    });
    const clientMeta = await api(context.request, '/api/crm/meta', undefined, 'get');
    const lead = await api(context.request, '/api/crm/leads', {
      contact_name: 'Synthetic interest lead', currency: 'USD',
      assigned_employee_id: clientMeta.employees[0].id,
      source_id: clientMeta.sources.find(s => s.is_active).id
    });
    const product = await api(context.request, '/api/inventory/products', {
      sku: 'GAP-INTEREST',
      name: 'Synthetic interest service',
      item_type: 'service',
      unit: 'service',
      currency: 'USD',
      selling_price: 100
    });
    await page.goto('/dashboard/clients');
    await page.getByRole('row').filter({
      hasText: client.display_name
    }).getByRole('button', {
      name: `Edit ${client.display_name}`,
      exact: true
    }).click();
    await page.getByLabel('City', {
      exact: true
    }).fill('Synthetic City');
    await page.getByLabel('Notes', {
      exact: true
    }).fill('Exact revised client master note');
    await ui(page, `/api/crm/clients/${client.id}`, 'PATCH', () => page.getByRole('button', {
      name: 'Save changes',
      exact: true
    }).click());
    await ui(page, `/api/crm/clients/${client.id}`, 'PATCH', () => page.getByRole('button', { name: 'Deactivate', exact: true }).click());
    await expect(page.getByRole('button', { name: 'Quotation', exact: true })).toBeDisabled();
    await ui(page, `/api/crm/clients/${client.id}`, 'PATCH', () => page.getByRole('button', { name: 'Activate', exact: true }).click());
    await expect(page.getByRole('button', { name: 'Quotation', exact: true })).toBeEnabled();
    e.cases.push({ id: 'CLI03', actual: 'Inactive client quotation control disabled, restored enabled after reactivation' });
    await page.goto(`/dashboard/clients/${client.id}`);
    await expect(page.getByText('Exact revised client master note', {
      exact: true
    })).toBeVisible();
    expect(await api(context.request, `/api/crm/clients/${client.id}/detail`, undefined, 'get')).toMatchObject({
      city: 'Synthetic City',
      notes: 'Exact revised client master note'
    });
    e.cases.push({
      id: 'CLI02',
      actual: 'UI city/master notes edit; exact detail page and API readback'
    });
    await page.getByRole('button', {
      name: 'Notes',
      exact: true
    }).click();
    await page.getByRole('button', {
      name: 'Add note',
      exact: true
    }).click();
    await page.getByLabel('Title', {
      exact: true
    }).fill('Synthetic reusable note');
    await page.getByPlaceholder('Client-wide information that may be useful across projects...').fill('Revision 1');
    const note = await ui(page, `/api/crm/clients/${client.id}/notes`, 'POST', () => page.getByRole('button', {
      name: 'Add note',
      exact: true
    }).last().click());
    await page.getByRole('button', {
      name: 'Edit note',
      exact: true
    }).click();
    await page.getByPlaceholder('Client-wide information that may be useful across projects...').fill('Exact Revision 2');
    await ui(page, `/api/crm/clients/${client.id}/notes/${note.id}`, 'PATCH', () => page.getByRole('button', {
      name: 'Save changes',
      exact: true
    }).click());
    await page.reload();
    await page.getByRole('button', {
      name: 'Notes',
      exact: true
    }).click();
    await expect(page.getByText('Exact Revision 2', {
      exact: true
    })).toBeVisible();
    expect((await api(context.request, `/api/crm/clients/${client.id}/notes`, undefined, 'get')).find(n => n.id === note.id).content).toBe('Exact Revision 2');
    e.cases.push({
      id: 'CLI04',
      actual: 'Reusable note UI create edit reload and exact body persisted'
    });
    await page.getByRole('button', {
      name: 'Documents',
      exact: true
    }).click();
    await page.getByRole('button', {
      name: 'Upload document',
      exact: true
    }).click();
    const bytes = Buffer.from('Synthetic client document.\nExact UTF-8 content: বাংলা QA.\nNo real client data.\n');
    await page.getByLabel('Title', {
      exact: true
    }).fill('Synthetic byte proof');
    await page.getByLabel('Document type', {
      exact: true
    }).fill('other');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'synthetic-client-gap.txt',
      mimeType: 'text/plain',
      buffer: bytes
    });
    const doc = await ui(page, `/api/crm/clients/${client.id}/documents/upload`, 'POST', () => page.getByRole('button', {
      name: 'Upload document',
      exact: true
    }).last().click());
    expect(doc.created_at).toBeTruthy();
    expect(doc.size_bytes).toBe(bytes.length);
    await page.reload();
    await page.getByRole('button', {
      name: 'Documents',
      exact: true
    }).click();
    const row = page.getByRole('row').filter({
      hasText: 'Synthetic byte proof'
    });
    await expect(row).toBeVisible();
    const popupPromise = context.waitForEvent('page');
    await row.getByRole('button', {
      name: 'View',
      exact: true
    }).click();
    const popup = await popupPromise;
    await popup.bringToFront();
    await popup.waitForLoadState('load');
    await expect(popup).toHaveURL(/\/preview$/);
    e.previewDiagnostics = await popup.evaluate(() => ({visibility: document.visibilityState, viewport: [innerWidth, innerHeight], html: document.documentElement.outerHTML, elements: [...document.querySelectorAll('html,body,pre')].map(el => ({tag: el.tagName, rect: el.getBoundingClientRect().toJSON(), display: getComputedStyle(el).display, visibility: getComputedStyle(el).visibility, contentVisibility: getComputedStyle(el).contentVisibility, font: getComputedStyle(el).fontSize}))}));
    const control = await context.newPage();
    await control.goto('data:text/plain,synthetic-render-control');
    e.previewControl = { visible: await control.locator('pre').isVisible(), text: await control.locator('pre').textContent() };
    await control.close();
    await popup.bringToFront();
    await expect(popup.locator('pre')).toBeVisible();
    expect(await popup.locator('pre').textContent()).toBe(bytes.toString());
    await testInfo.attach('client-text-preview', { body: await popup.screenshot(), contentType: 'image/png' });
    await popup.close();
    const downloadPromise = page.waitForEvent('download');
    await row.getByRole('link', {
      name: 'Download',
      exact: true
    }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('Synthetic-byte-proof.txt');
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    expect(Buffer.concat(chunks)).toEqual(bytes);
    e.cases.push({
      id: 'CLI05',
      actual: `UI text upload and reload; ${bytes.length} bytes persisted`,
      documentId: doc.id
    }, {
      id: 'CLI06',
      actual: 'Actual new preview tab exact UTF-8 DOM text and browser download exact bytes/filename; visibility has separate assertion and diagnostics'
    });
    await page.goto('/dashboard/crm');
    await page.getByRole('row').filter({
      hasText: 'Synthetic interest lead'
    }).getByRole('button', {
      name: /^Open lead /
    }).click();
    await page.getByRole('button', {
      name: 'Add requirements',
      exact: true
    }).click();
    await page.getByRole('button', {
      name: 'Requirement source',
      exact: true
    }).click();
    await page.getByRole('button', {
      name: /^GAP-INTEREST · Synthetic interest service/
    }).click();
    await page.getByLabel('Quantity', {
      exact: true
    }).fill('2');
    await page.getByLabel('Requirement / scope', {
      exact: true
    }).fill('Custom scope retained');
    await ui(page, `/api/crm/leads/${lead.id}/interests`, 'PUT', () => page.getByRole('button', {
      name: 'Save requirements',
      exact: true
    }).click());
    await expect(page.getByText('USD 200', {
      exact: true
    })).toBeVisible();
    const interests = await api(context.request, `/api/crm/leads/${lead.id}/interests`, undefined, 'get');
    expect(interests).toHaveLength(1);
    expect(interests[0].product_id).toBe(product.id);
    expect(Number(interests[0].quantity)).toBe(2);
    expect(Number(interests[0].estimated_unit_price)).toBe(100);
    expect(interests[0].description).toBe('Custom scope retained');
    expect(await api(context.request, '/api/inventory/stock', undefined, 'get')).toEqual([]);
    expect(await api(context.request, '/api/inventory/movements', undefined, 'get')).toEqual([]);
    expect(await api(context.request, '/api/accounting/journals', undefined, 'get')).toEqual([]);
    e.cases.push({
      id: 'CRM07',
      actual: 'UI catalog service qty2 price100 scope; USD200 estimate and API readback; no stock/movements'
    });
    const won = clientMeta.statuses.find(s => s.category === 'won');
    await ui(page, `/api/crm/leads/${lead.id}/status`, 'PATCH', () => page.getByLabel('Lead status', { exact: true }).selectOption(won.id));
    await page.getByRole('button', { name: 'Convert to Client', exact: true }).last().click();
    const converted = await ui(page, `/api/crm/leads/${lead.id}/convert`, 'POST', () => page.getByRole('button', { name: 'Create Client', exact: true }).click());
    const convertedDetail = await api(context.request, `/api/crm/clients/${converted.id}/detail`, undefined, 'get');
    expect(convertedDetail.assigned_employee_id).toBe(clientMeta.employees[0].id);
    expect(convertedDetail.source_lead_id).toBe(lead.id);
    expect(await api(context.request, `/api/crm/leads/${lead.id}/interests`, undefined, 'get')).toEqual(interests);
    e.cases.push({ id: 'CRM09', actual: 'UI conversion retains catalog requirements byte-for-byte in API readback' }, { id: 'CLI01', actual: 'Converted profile retains assigned owner employee and source lead' });
    await page.goto('/dashboard/crm');
    await page.locator('select').filter({ has: page.getByRole('option', { name: 'All statuses', exact: true }) }).selectOption(won.id);
    await page.locator('select').filter({ has: page.getByRole('option', { name: 'All sources', exact: true }) }).selectOption(lead.source_id);
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody')).toContainText('Synthetic interest lead');
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(page.locator('select').filter({ has: page.getByRole('option', { name: 'All statuses', exact: true }) })).toHaveValue('');
    await expect(page.locator('select').filter({ has: page.getByRole('option', { name: 'All sources', exact: true }) })).toHaveValue('');
    e.cases.push({ id: 'CRM11', actual: 'Combined Won/source UI intersection and Reset of both filters' });

  } finally {
    await record(testInfo, e);
  }
});
test('owner stock threshold boundary and fixed service entitlement dates', async ({
  page,
  context
}, testInfo) => {
  test.setTimeout(180000);
  const e = await setup(page, context, 'STOCK-TERM');
  try {
    // API fixture only: reproduces original A4/B3 at cost6 with threshold3.
    const p = await api(context.request, '/api/inventory/products', {
      sku: 'GAP-BOUNDARY',
      name: 'Synthetic threshold stock',
      item_type: 'stock_item',
      unit: 'piece',
      currency: 'USD',
      selling_price: 12,
      reorder_level: 3
    });
    const a = await api(context.request, '/api/inventory/warehouses', {
      code: 'GAP-A',
      name: 'Synthetic A'
    });
    const b = await api(context.request, '/api/inventory/warehouses', {
      code: 'GAP-B',
      name: 'Synthetic B'
    });
    for (const [wh, quantity] of [[a, 4], [b, 3]]) await api(context.request, '/api/inventory/purchases', {
      supplier_name: 'Synthetic fixture supplier',
      warehouse_id: wh.id,
      receipt_date: '2026-10-22',
      currency: 'USD',
      items: [{
        product_id: p.id,
        quantity,
        unit_cost: 6
      }]
    });
    const before = await api(context.request, '/api/inventory/stock', undefined, 'get');
    const journals = await api(context.request, '/api/accounting/journals', undefined, 'get');
    await page.goto('/dashboard/inventory');
    await page.getByRole('button', { name: 'Products & services', exact: true }).click();
    await page.getByRole('row').filter({ hasText: 'GAP-BOUNDARY' }).getByRole('button', { name: /^Edit / }).click();
    await page.getByLabel('Selling price', { exact: true }).fill('13');
    await ui(page, `/api/inventory/products/${p.id}`, 'PATCH', () => page.getByRole('button', { name: 'Update item', exact: true }).click());
    await expect(page.getByRole('row').filter({ hasText: 'GAP-BOUNDARY' })).toBeVisible();
    await page.getByRole('button', {
      name: 'Stock on hand',
      exact: true
    }).click();
    await expect(page.locator('tbody tr')).toHaveCount(2);
    await page.getByRole('button', {
      name: 'Low stock only',
      exact: true
    }).click();
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody')).toContainText('Synthetic B');
    await expect(page.locator('tbody')).not.toContainText('Synthetic A');
    await page.getByRole('button', {
      name: 'Showing low stock',
      exact: true
    }).click();
    await expect(page.locator('tbody tr')).toHaveCount(2);
    expect(await api(context.request, '/api/inventory/stock', undefined, 'get')).toEqual(before);
    expect(before.map(s => [Number(s.on_hand), Number(s.average_unit_cost), Number(s.inventory_value)]).sort()).toEqual([[3, 6, 18], [4, 6, 24]]);
    expect(await api(context.request, '/api/accounting/journals', undefined, 'get')).toEqual(journals);
    e.cases.push({
      id: 'ST01',
      actual: '7 units/value42 and cost6 conserved after UI selling-price master edit and stock filters',
      boundary: 'Fresh synthetic fixture, not historical database'
    }, {
      id: 'ST02',
      actual: 'UI threshold3 retains B3 and hides A4; toggle restores both; persisted stock/journals unchanged'
    });
    const client = await api(context.request, '/api/crm/clients', {
      client_type: 'company',
      display_name: 'Synthetic entitlement client',
      currency: 'USD',
      country_code: 'BD'
    });
    const svc = await api(context.request, '/api/inventory/products', {
      sku: 'GAP-TERM',
      name: 'Synthetic fixed service',
      item_type: 'service',
      unit: 'service',
      currency: 'USD',
      selling_price: 30
    });
    await api(context.request, `/api/services/catalog/${svc.id}/duration`, {
      duration_months: 3
    }, 'patch');
    await page.goto('/dashboard/orders/new');
    await page.getByRole('button', { name: 'Client', exact: true }).click();
    await page.getByRole('button', { name: /Synthetic entitlement client/ }).click();
    await page.getByRole('button', { name: 'Create order', exact: true }).click();
    await expect(page.getByText('Complete all order items.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Item source', exact: true }).click();
    await page.getByRole('button', { name: /^GAP-TERM · Synthetic fixed service/ }).click();
    await page.getByLabel('Order date', { exact: true }).fill('2026-10-22');
    await page.getByLabel('Quantity', { exact: true }).fill('2');
    await page.getByLabel('Discount %', { exact: true }).fill('10');
    const order = await ui(page, '/api/sales/orders', 'POST', () => page.getByRole('button', { name: 'Create order', exact: true }).click());
    expect(Number(order.total)).toBe(54);
    await expect(page).toHaveURL(new RegExp('/dashboard/orders/' + order.id));
    await ui(page, `/api/sales/orders/${order.id}/status`, 'PATCH', () => page.getByRole('button', { name: 'Start order', exact: true }).click());
    page.once('dialog', async dialog => { expect(dialog.message()).toContain('Complete this order?'); await dialog.accept(); });
    await ui(page, `/api/sales/orders/${order.id}/status`, 'PATCH', () => page.getByRole('button', { name: 'Complete order', exact: true }).click());
    expect((await api(context.request, `/api/sales/orders/${order.id}`, undefined, 'get')).status).toBe('completed');
    e.cases.push({ id: 'SVC01', actual: 'UI manual order blank line rejected; catalog fixed service 2x30 less10%=54 created, started and completed; persisted readback' });
    const originalJournals = await api(context.request, '/api/accounting/journals', undefined, 'get');
    await page.goto(`/dashboard/clients/${client.id}`);
    await page.getByRole('button', {
      name: 'Services',
      exact: true
    }).click();
    await expect(page.getByText('Synthetic fixed service', {
      exact: true
    })).toBeVisible();
    const periods = [];
    for (const [start, end, status] of [['2020-01-31', '2020-04-29', 'expired'], ['2030-01-31', '2030-04-29', 'upcoming'], [today(), threeMonthInclusiveEnd(today()), 'active']]) {
      await page.getByRole('button', {
        name: 'Change start date',
        exact: true
      }).click();
      await page.getByLabel('Start date', {
        exact: true
      }).fill(start);
      const terms = await api(context.request, `/api/services/clients/${client.id}`, undefined, 'get');
      const term = await ui(page, `/api/services/order-items/${terms[0].order_item_id}/period`, 'PATCH', () => page.getByRole('button', {
        name: 'Save',
        exact: true
      }).click());
      expect(term.start_date).toBe(start);
      expect(term.end_date).toBe(end);
      expect(term.service_status).toBe(status);
      await expect(page.getByText(status, {
        exact: true
      })).toBeVisible();
      periods.push({
        start,
        end,
        status
      });
    }
    await page.reload();
    await page.getByRole('button', {
      name: 'Services',
      exact: true
    }).click();
    await expect(page.getByText('active', {
      exact: true
    })).toBeVisible();
    const summary = await api(context.request, '/api/services/sales-summary', undefined, 'get');
    expect(summary.find(s => s.product_id === svc.id)).toMatchObject({
      active_terms: 1,
      upcoming_terms: 0,
      expired_terms: 0
    });
    expect(await api(context.request, '/api/accounting/journals', undefined, 'get')).toEqual(originalJournals);
    e.cases.push({
      id: 'SVC02',
      actual: 'UI past/future/current date edits, inclusive month-end expiry, expired/upcoming/active status, restored Active reload and analytics; journals unchanged',
      periods
    });
    await page.goto('/dashboard/activity-logs');
    await page.getByPlaceholder('Action contains…').fill('services.order_period.updated');
    await page.getByPlaceholder('Entity type', { exact: true }).fill('order_item');
    await page.locator('select').selectOption('success');
    const termAudit = await ui(page, auditPath({ action: 'services.order_period.updated', entity_type: 'order_item', outcome: 'success' }), 'GET', () => page.getByRole('button', { name: 'Apply', exact: true }).click());
    expect(termAudit.items).toHaveLength(3);
    expect(termAudit.items.every(i => i.action === 'services.order_period.updated' && i.entity_type === 'order_item' && i.outcome === 'success')).toBe(true);
    await expect(page.locator('tbody tr')).toHaveCount(3);
    e.cases.push({ id: 'AUD01', actual: 'Exact three service-term updates from three UI changes isolated by action/entity/outcome in real audit UI; negative/reset separately covered' });
    e.fixture = 'API-created client/catalog duration and stock fixture; manual service order and entitlement edits use actual UI';
  } finally {
    await record(testInfo, e);
  }
});
