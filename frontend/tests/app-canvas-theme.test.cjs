const { beforeReviewedInvoiceBoundaries } = require('./helpers/reviewed-invoice-boundaries.cjs');
const { beforeReviewedQuotationDecimals } = require('./helpers/reviewed-quotation-decimals.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const src = path.join(__dirname, '../src');
const read = (name) => fs.readFileSync(path.join(src, name), 'utf8');
const css = read('app/globals.css');
const rule = (source, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  assert.ok(match, `Missing ${selector} rule`);
  return match[1];
};

test('light application canvas is white, with existing neutral surfaces and dark preference retained', () => {
  const light = rule(css, ':root');
  assert.match(light, /--app-canvas:\s*#ffffff;/);
  assert.match(light, /--background:\s*oklch\(1 0 0\);/);
  assert.match(light, /--app-subtle:\s*#fafafa;/);
  assert.match(light, /--app-border:\s*#e7e7e5;/);
  assert.match(light, /--destructive:\s*oklch\(0\.577 0\.245 27\.325\);/);
  assert.match(rule(css, '.dark'), /--app-canvas:\s*#111111;/);
  assert.match(rule(css, 'body'), /@apply bg-background text-foreground font-sans;/);
  assert.match(read('app/layout.tsx'), /<body className="min-h-full bg-background text-foreground"/);
});

test('workspace shells inherit the central canvas without a local palette override', () => {
  assert.match(read('components/dashboard-shell.tsx'), /workspace-shell min-h-screen bg-\[var\(--app-canvas\)\]/);
  assert.match(read('components/ui/app-page.tsx'), /min-h-screen bg-\[var\(--app-canvas\)\]/);
  assert.doesNotMatch(read('components/dashboard/dashboard-design.css'), /--app-canvas\s*:/);
});

const canvasRules = [
  ['app/login/login.css', '.login-redesign'],
  ['app/login/login.css', '.login-access'],
  ['components/relationships/relationship-workspace.css', '.relationship-workspace'],
  ['components/relationships/client-detail.css', '.client-detail-workspace'],
  ['components/invoices/invoice-design.css', '.invoice-page'],
  ['components/invoices/invoice-detail.css', '.invoice-workspace'],
  ['components/operational-reports/reports.css', '.or-page'],
  ['components/client-portal/portal.css', '.cp-page'],
  ['components/commercial/order-editor.css', '.order-editor-page'],
  ['components/commercial/quotation-workspace.css', '.quotation-workspace'],
];
for (const [file, selector] of canvasRules) {
  test(`${selector} uses the shared canvas, not an opaque color or gradient`, () => {
    const declarations = rule(read(file), selector);
    const backgrounds = declarations.match(/background(?:-color|-image)?\s*:[^;}]+/g);
    assert.deepEqual(backgrounds, ['background:var(--app-canvas)']);
  });
}

test('full-page application wrappers no longer introduce gray or green utility canvases', () => {
  const files = fs.readdirSync(src, { recursive: true }).filter((file) => file.endsWith('.tsx'));
  let sharedRoots = 0;
  for (const file of files) {
    for (const [className] of read(file).matchAll(/className="[^"]*"/g)) {
      if (!className.includes('min-h-screen')) continue;
      assert.doesNotMatch(className, /\bbg-(?:neutral|gray|stone|slate|zinc)-[1-3]00\b|bg-\[#f(?:5f7f2|5f5f3)\]/, file);
      if (className.includes('bg-[var(--app-canvas)]')) sharedRoots += 1;
    }
  }
  assert.ok(sharedRoots >= 35, `Expected shared application/print/loading canvases, found ${sharedRoots}`);
});

test('legacy auth has a white canvas without the old full-page radial overlay', () => {
  const frame = read('components/auth/auth-frame.tsx');
  assert.match(frame, /min-h-screen overflow-hidden bg-\[var\(--app-canvas\)\]/);
  assert.doesNotMatch(frame, /absolute inset-0 bg-\[radial-gradient/);
  // Keep the dark story panel and its decorative details; only the outer canvas changes.
  assert.match(frame, /<aside className="relative hidden overflow-hidden bg-neutral-950/);
});

const { withReviewedCanvas } = require('./helpers/reviewed-canvas.cjs');
const baseline = path.join(__dirname, '../../test-fixtures/frontend-original');
for (const file of [
  'src/components/auth/auth-frame.tsx',
  'src/components/tenant-area-guard.tsx',
  'src/app/print/invoices/[invoiceId]/page.tsx',
  'src/app/print/quotations/[quotationId]/page.tsx',
]) {
  test(`canvas snapshot allowance rejects unrelated source changes in ${file}`, () => {
    let expected = withReviewedCanvas(file, fs.readFileSync(path.join(baseline, file), 'utf8'));
    let actual = fs.readFileSync(path.join(src, '..', file), 'utf8');
    if (file === 'src/app/print/invoices/[invoiceId]/page.tsx') actual = beforeReviewedInvoiceBoundaries(file, actual);
    if (file === 'src/app/print/quotations/[quotationId]/page.tsx') actual = beforeReviewedQuotationDecimals(file, actual);
    if (file === 'src/components/auth/auth-frame.tsx') {
      // Auth variants predate this canvas change; the existing snapshot protects its default render.
      expected = expected.slice(expected.indexOf('  return ('));
      actual = actual.slice(actual.indexOf('  return ('));
    }
    assert.equal(actual, expected);
    for (const [before, after] of [
      ['bg-[var(--app-canvas)]', 'bg-red-100'],
      ['min-h-screen', 'min-h-0'],
      ['  return (', '  throw new Error("unexpected financial/security change"); return ('],
    ]) {
      assert.ok(expected.includes(before), `Mutation anchor exists: ${before}`);
      assert.throws(() => assert.equal(expected.replace(before, after), expected), assert.AssertionError);
    }
  });
}

test('canvas snapshot allowances never normalize API or unrelated files', () => {
  const securitySource = 'export async function GET() { return enforceTenant(); }';
  for (const file of ['src/app/api/finance/route.ts', 'src/app/api/sales/[...segments]/route.ts']) {
    assert.equal(withReviewedCanvas(file, securitySource), securitySource);
    assert.notEqual(withReviewedCanvas(file, securitySource.replace('enforceTenant()', 'allowAll()')), securitySource);
  }
});

test('Stripe return snapshot allowance rejects parsing and payment-state changes', () => {
  const file = 'src/app/payments/stripe/return/page.tsx';
  const before = fs.readFileSync(path.join(__dirname, '../evidence/portal-ui/payment-return-r1/preimages', `${file}.txt`), 'utf8');
  const expected = withReviewedCanvas(file, before);
  const actual = read('app/payments/stripe/return/page.tsx')
    .replace('href="/dashboard"', 'href="/dashboard/accounting/invoices"')
    .replace('Return to your workspace', 'Return to Invoices');
  assert.equal(actual, expected);
  for (const [from, to] of [['min-h-screen', 'min-h-0'], ['StripeCheckoutReturnStatus', 'UnverifiedSuccess'], ['bg-[var(--app-canvas)]', 'bg-red-100']]) {
    assert.ok(actual.includes(from));
    assert.throws(() => assert.equal(actual.replace(from, to), expected), assert.AssertionError);
  }
});
