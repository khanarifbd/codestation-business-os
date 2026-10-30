// Five legacy entry URLs without an existing real-browser navigation receipt.
// Three other aliases already executed in the owner41 sweep remain separately
// documented; these are redirects, not five additional unique app designs.
export const pendingAliasPatterns = [
  '/dashboard/hr/setup', '/dashboard/client-access', '/dashboard/my-hr',
  '/dashboard/finance/invoices/[invoiceId]', '/dashboard/finance/invoices/[invoiceId]/print',
];
export function resolveAliases(registry) {
  const invoicePattern = '/dashboard/accounting/invoices/[invoiceId]';
  const invoice = registry.route_overrides?.[invoicePattern];
  if (!/^\/dashboard\/accounting\/invoices\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(invoice || '')) throw new Error('Exact seeded invoice detail target required for aliases');
  const id = invoice.split('/').at(-1), invoiceContract = registry.route_contracts?.[invoicePattern];
  if (!invoiceContract?.heading) throw new Error('Verified invoice readiness contract required');
  const targets = ['/dashboard/hr/settings', '/dashboard/clients', '/dashboard/hr/me', invoice, `/print/invoices/${id}`];
  const contracts = [registry.route_contracts?.[targets[0]], registry.route_contracts?.[targets[1]], {
    heading: 'My HR & Pay', heading_level: 1, expected_mode: 'ready', ready_text: [],
    expected_get_paths: ['/api/hr/self', '/api/hr/self/home', '/api/hr/self/attendance-plan', '/api/hr/self-meta', '/api/hr/self/leave-balance', '/api/hr/self/policy-acknowledgements', '/api/hr/self/attendance/monthly'],
    source: 'frontend/src/components/self-service/self-service-register.tsx',
  }, invoiceContract, {
    heading: invoiceContract.heading, heading_level: 1, expected_mode: 'ready', ready_text: ['Invoice items'],
    expected_get_paths: [`/api/finance/invoices/${id}`, `/api/finance/invoices/${id}/payment-instructions`],
    source: 'frontend/src/app/print/invoices/[invoiceId]/page.tsx',
  }];
  return pendingAliasPatterns.map((pattern, index) => {
    if (!contracts[index]?.heading) throw new Error('Exact alias destination readiness required');
    return { id: `alias-${String(index + 1).padStart(3, '0')}`, pattern, url: pattern.replace('[invoiceId]', id), status: 'ready', kind: 'alias', expected_url: targets[index], contract: contracts[index], desktop_only: index === 4 };
  });
}
export function aliasGroups(manifest, registry, batch, routesPerBatch = 40, routesPerCase = 4) {
  const lastBatch = Math.ceil(manifest.routes.length / routesPerBatch) - 1;
  if (batch !== lastBatch) return [];
  const aliases = resolveAliases(registry), finalCount = manifest.routes.length - lastBatch * routesPerBatch;
  if (finalCount + aliases.length > routesPerBatch) throw new Error('Alias navigation exceeds existing batch resource reservation');
  const groups = [];
  for (let i = 0; i < aliases.length; i += routesPerCase) groups.push(aliases.slice(i, i + routesPerCase));
  return groups;
}
