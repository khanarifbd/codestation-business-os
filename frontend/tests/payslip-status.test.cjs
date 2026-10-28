// Render the actual payslip component with loaded synthetic data, without a browser/server.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function renderPayslip(status) {
  const file = path.join(__dirname, '../src/app/dashboard/payroll/runs/[runId]/payslip/[entryId]/page.tsx');
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const entry = { id: 'entry', employee_code: 'QA-1', employee_name: 'Synthetic Employee', currency: 'USD', base_salary: '1000', allowances: [], deductions: [], allowance_total: '0', deduction_total: '0', tax_amount: '0', gross_pay: '1000', net_pay: '1000' };
  const states = [{ id: 'run', run_number: 'PAY-QA', period_name: 'QA period', status, currency: 'USD', entries: [entry] }, { organization: { name: 'Synthetic QA Company' } }, null];
  let index = 0;
  const compiled = { exports: {} };
  vm.runInNewContext(source, { exports: compiled.exports, module: compiled, require(name) {
    if (name === 'react') return { ...React, useEffect() {}, useState() { return [states[index++], () => {}]; } };
    if (name === 'next/navigation') return { useParams: () => ({ runId: 'run', entryId: 'entry' }) };
    if (name === 'lucide-react') return { ArrowLeft: () => null, Loader2: () => null, Printer: () => null };
    return require(name);
  } });
  return renderToStaticMarkup(React.createElement(compiled.exports.default));
}

test('draft footer clearly warns that payroll is not approved', () => {
  const html = renderPayslip('draft');
  assert.match(html, /This is a draft payroll statement, not an approved payroll record/);
  assert.doesNotMatch(html, /This document reflects the approved payroll record/);
});
for (const status of ['approved', 'paid']) {
  test(`${status} footer reflects approved payroll`, () => {
    const html = renderPayslip(status);
    assert.match(html, /This document reflects the approved payroll record/);
    assert.doesNotMatch(html, /This is a draft payroll statement/);
  });
}
test('other statuses do not claim approval', () => {
  const html = renderPayslip('cancelled');
  assert.match(html, /This document reflects the cancelled payroll record/);
  assert.doesNotMatch(html, /This document reflects the approved payroll record/);
});
