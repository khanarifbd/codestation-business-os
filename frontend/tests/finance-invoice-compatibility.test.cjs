const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../src');
const detailPath = 'app/dashboard/finance/invoices/[invoiceId]/page.tsx';
const printPath = 'app/dashboard/finance/invoices/[invoiceId]/print/page.tsx';
function loadPage(relativePath) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const routeModule = { exports: {} };
  vm.runInNewContext(compiled, { module: routeModule, exports: routeModule.exports, require(name) {
    assert.equal(name, 'next/navigation', 'alias must not load a data or mutation dependency');
    return {
      redirect(destination) { throw Object.assign(new Error('redirect'), { destination }); },
      notFound() { throw Object.assign(new Error('notFound'), { notFound: true }); },
    };
  } });
  return routeModule.exports.default;
}
async function destination(page, invoiceId, searchParams = {}) {
  try { await page({ params: Promise.resolve({ invoiceId }), searchParams: Promise.resolve(searchParams) }); }
  catch (error) { if (error.destination) return error.destination; throw error; }
  assert.fail('route must redirect, not render another controller');
}
test('legacy client invoice links resolve to the canonical tenant-scoped detail route', async () => {
  const id = 'd1042b77-53af-4ced-8d8e-ed28770da31b';
  assert.equal(await destination(loadPage(detailPath), id), `/dashboard/accounting/invoices/${id}`);
  const clients = fs.readFileSync(path.join(root, 'app/dashboard/clients/[clientId]/page.tsx'), 'utf8');
  assert.ok(clients.includes('/dashboard/finance/invoices/${encodeURIComponent(item.invoice_id)}'));
  assert.ok(clients.includes('/dashboard/finance/invoices/${encodeURIComponent(item.id)}'));
  const canonical = fs.readFileSync(path.join(root, 'app/dashboard/accounting/invoices/[invoiceId]/page.tsx'), 'utf8');
  assert.match(canonical, /<InvoiceWorkspace invoiceId=\{invoiceId\}/);
});
test('IDs stay encoded in one local path; unsupported query values cannot redirect or trigger actions', async () => {
  for (const id of ['invoice / বাংলা', '//evil.example', '../outside', 'a?return_to=https://evil.example#x', '%2f%2fevil.example']) {
    const actual = await destination(loadPage(detailPath), id, { return_to: 'https://evil.example', next: '//evil.example', action: 'send', invoice_id: 'other' });
    assert.equal(actual, `/dashboard/accounting/invoices/${encodeURIComponent(id)}`);
    const parsed = new URL(actual, 'https://business.example');
    assert.equal(parsed.origin, 'https://business.example');
    assert.equal(parsed.search, '');
    assert.equal(parsed.hash, '');
    assert.equal(parsed.pathname.split('/').length, 5);
    assert.equal(decodeURIComponent(parsed.pathname.split('/').at(-1)), id);
  }
});
test('empty and dot-segment IDs do not normalize into a different destination', async () => {
  for (const id of ['', '.', '..']) await assert.rejects(() => destination(loadPage(detailPath), id), error => error.notFound === true);
});
test('existing legacy print child keeps its independent print destination', async () => {
  for (const id of ['d1042b77-53af-4ced-8d8e-ed28770da31b', 'invoice / বাংলা']) {
    assert.equal(await destination(loadPage(printPath), id), `/print/invoices/${encodeURIComponent(id)}`);
  }
});
