// Render the actual selected-entry payslip content with loaded synthetic data, without a browser/server.
// Approved adaptation: the default export is now a tenant-keyed wrapper; all four footer assertions below are unchanged.
const assert = require('node:assert/strict');
const test = require('node:test');
const { renderToStaticMarkup } = require('react-dom/server');
const { harness } = require('./payroll-test-helper.cjs');

function renderPayslip(status) {
  const file = 'src/components/payroll/manager-payslip.tsx';
  const h = harness('PayrollPayslipContent', file);
  const entry = { id: 'entry', employee_code: 'QA-1', employee_name: 'Synthetic Employee', currency: 'USD', base_salary: '1000', allowances: [], deductions: [], allowance_total: '0', deduction_total: '0', tax_amount: '0', gross_pay: '1000', net_pay: '1000' };
  h.params({ runId: 'run', entryId: 'entry' });
  h.seed([{ id: 'run', run_number: 'PAY-QA', period_name: 'QA period', status, currency: 'USD', entries: [entry] }, { organization: { name: 'Synthetic QA Company' } }, null]);
  try {
    const html = renderToStaticMarkup(h.render());
    assert.equal(h.requests.length, 0, 'historical footer render never invokes a real request');
    return html;
  } finally { h.cleanup(); }
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
