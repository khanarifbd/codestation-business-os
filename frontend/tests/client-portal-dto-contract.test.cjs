/* Frozen-backend wire compatibility, not FastAPI authorization/SQL/HTTP integration. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { sourceLoader } = require('./reconciliation-harness.cjs');
const wire = require('./client-portal-dto-wire-fixtures.cjs');
const model = sourceLoader().load('src/components/client-portal/portal-model.ts');
const kindFor = name => ({ Project: 'projects', Order: 'orders', Quotation: 'quotations', Invoice: 'invoices' })[name.replace(/^ClientPortal/, '').replace(/Detail$/, '')];

test('wire corpus comes from the 17 actual current Pydantic classes, not JS fixture echoes', () => {
  assert.equal(wire.provenance.class_count, 17);
  assert.equal(wire.provenance.pydantic, '2.13.4');
  assert.equal(wire.provenance.no_network_guard, true);
  assert.equal(wire.provenance.sources.length, 2);
  assert.equal(wire.cases.length, 119);
  for (const source of wire.provenance.sources) assert.match(source.sha256, /^[a-f0-9]{64}$/);
});

for (const row of wire.cases) {
  test(`real Pydantic JSON: ${row.name}`, () => {
    const accepted = row.model === 'ClientPortalContext'
      ? model.isPortalContext(row.body)
      : row.model.endsWith('Detail')
        ? model.isPortalDocument(kindFor(row.model), row.body)
        : model.isPortalList(kindFor(row.model), [row.body]);
    assert.equal(accepted, row.expected, row.explanation || row.name);
  });
}

test('every response field is required even when nullable; no missing field is silently defaulted', () => {
  for (const [name, fields] of Object.entries(wire.schema)) {
    if (name === 'ClientPortalQuotationDecision') continue;
    for (const [field, metadata] of Object.entries(fields)) assert.equal(metadata.required, true, `${name}.${field}`);
  }
  assert.equal(wire.schema.ClientPortalInvoiceDetail.payment_url.nullable, true);
  assert.equal(wire.schema.ClientPortalOrder.confirmed_at.nullable, false);
  assert.equal(wire.schema.ClientPortalOrderItem.service_duration_months.nullable, true);
  const invoice = structuredClone(wire.cases.find(row => row.name === 'ClientPortalInvoiceDetail-all-nullable-null').body);
  assert.equal(invoice.payment_url, null);
  delete invoice.payment_url;
  assert.equal(model.isPortalDocument('invoices', invoice), false);
});

test('decision reason is the actual sole optional default; no read-only status mutation capability inferred', () => {
  assert.deepEqual(wire.decision_defaults, { status: 'accepted', reason: null });
  assert.equal(wire.schema.ClientPortalQuotationDecision.reason.required, false);
  assert.equal(wire.schema.ClientPortalQuotationDecision.reason.default, null);
  assert.equal(wire.schema.ClientPortalQuotationDecision.status.required, true);
});

test('active fast Orders projection uses the identical DTO fields, including signed revised values', () => {
  assert.deepEqual([...wire.fast_order_projection_fields].sort(), Object.keys(wire.schema.ClientPortalOrder).sort());
  const body = wire.cases.find(row => row.name === 'fast-order-shaped-signed-approved-reduction').body;
  assert.equal(body.approved_change_value, '-250.00');
  assert.equal(body.revised_contract_value, '750.00');
  assert.equal(model.isPortalList('orders', [body]), true);
  assert.equal(model.portalMoney(body.approved_change_value, body.currency), 'USD -250.00');
  assert.match(wire.provenance.fast_orders_check, /no SQL or handler invocation/);
});

test('Pydantic serializes real Decimal values as exact strings, including exponent and large cents', () => {
  const rows = wire.cases.filter(row => row.name.startsWith('exact-decimal-'));
  assert.equal(rows.length, 5);
  for (const { body } of rows) {
    assert.equal(typeof body.balance_due, 'string');
    assert.equal(typeof body.items[0].quantity, 'string');
    assert.equal(model.portalAmount(body.balance_due), true);
  }
  const large = rows.find(row => row.body.balance_due === '9999999999999999.99');
  assert.equal(model.portalMoney(large.body.balance_due, 'USD'), 'USD 9,999,999,999,999,999.99');
  assert.equal(model.portalDecimalText(rows.find(row => row.body.balance_due === '0.12345678').body.items[0].quantity), '0.12345678');
});

test('backend rejects null required values, absent nullable field, invalid calendar and nonfinite Decimal', () => {
  assert.deepEqual(wire.pydantic_rejections.map(row => row.name).sort(), [
    'confirmed_at-null-is-not-supported',
    'date-rollover-is-invalid',
    'decision-status-literal-is-not-readonly-status',
    'non-finite-decimal-is-invalid',
    'nullable-payment-url-is-required-not-defaulted',
    'required-decimal-null-is-not-supported',
  ]);
  for (const row of wire.pydantic_rejections) assert.ok(row.errors.length > 0);
});

test('readiness population guards are intentionally stricter than plain Pydantic status strings', () => {
  const excluded = wire.cases.filter(row => !row.expected);
  assert.equal(excluded.length, 4);
  assert.ok(excluded.every(row => /endpoint-excludes-(draft|cancelled)$/.test(row.name)));
  assert.ok(excluded.every(row => /both portal list and detail SQL exclude/.test(row.explanation)));
});
