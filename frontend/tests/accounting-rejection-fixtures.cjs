const validation = { detail: [{ loc: ['body', 'amount'], msg: 'Value must be positive', type: 'greater_than' }] };
const malformed = [
  ['actual accounting proxy unreadable upstream', { proxyUnreadable: 'accounting' }],
  ['actual finance proxy unreadable upstream', { proxyUnreadable: 'finance' }],
  ['null', null], ['empty object', {}], ['empty detail', { detail: '' }],
  ['blank detail', { detail: '  ' }], ['null sentinel', { detail: 'null' }],
  ['undefined sentinel', { detail: 'undefined' }], ['object sentinel', { detail: '[object Object]' }],
  ['empty errors', { detail: [] }], ['string errors', { detail: ['Invalid amount'] }],
  ['missing type', { detail: [{ loc: ['body'], msg: 'Invalid amount' }] }],
  ['missing location', { detail: [{ type: 'value_error', msg: 'Invalid amount' }] }],
  ['invalid location', { detail: [{ loc: ['body', -1], type: 'value_error', msg: 'Invalid amount' }] }],
  ['mixed errors', { detail: [...validation.detail, null] }],
  ['sentinel message', { detail: [{ loc: ['body'], type: 'value_error', msg: 'undefined' }] }],
];
async function proxyUnreadable(status, family) {
  const { sourceLoader } = require('./reconciliation-harness.cjs');
  const { load } = sourceLoader({
    'next/server': { NextResponse: { json: (body, options) => ({ok:false,status:options.status,json:async()=>body}) } },
    '@/lib/auth-session': { setAuthCookies() { throw Error('Unexpected auth rotation'); } },
    '@/lib/authenticated-backend': { authenticatedBackendFetch: async () => ({upstream:{status,json:async()=>{throw Error('Synthetic unreadable upstream');}},rotatedTokens:null}) },
  });
  const route = load(`src/app/api/${family}/[[...path]]/route.ts`);
  return route.POST({cookies:{get:()=>({value:'synthetic-company'})},headers:new Headers(),text:async()=>'{}'}, {params:Promise.resolve({path:['synthetic']})});
}
const rejected = (status, body) => body?.proxyUnreadable ? proxyUnreadable(status, body.proxyUnreadable) : ({ ok: false, status, json: async () => structuredClone(body) });
module.exports = { validation, malformed, rejected, proxyUnreadable };
