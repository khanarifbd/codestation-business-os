const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function configuration(baseURL, ci) {
  const env = { ...process.env, E2E_BASE_URL: baseURL };
  delete env.CI;
  if (ci !== undefined) env.CI = ci;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', "import config from './playwright.config.mjs'; console.log(JSON.stringify(config));"], { cwd: root, env, encoding: 'utf8' }));
}
test('fresh connections are scoped to explicit CI loopback HTTP fixtures from first request', () => {
  for (const url of ['http://localhost:3000', 'http://127.0.0.1:3199', 'http://[::1]:3000']) {
    const config = configuration(url, 'true');
    assert.deepEqual(config.use.extraHTTPHeaders, { Origin: new URL(url).origin, Connection: 'close' });
    assert.equal(config.retries, 0);
    assert.equal(config.workers, 1);
    assert.equal(config.timeout, 45_000);
    assert.equal(config.expect.timeout, 10_000);
    assert.equal(config.use.ignoreHTTPSErrors, undefined);
  }
});
test('non-CI, HTTPS and non-loopback targets retain original transport headers', () => {
  for (const [url, ci] of [
    ['http://localhost:3000', undefined], ['http://localhost:3000', 'false'],
    ['http://localhost:3000', '1'], ['https://localhost:3443', 'true'],
    ['https://os.example.test', 'true'], ['http://localhost.example.test:3000', 'true'],
    ['http://192.0.2.1:3000', 'true'],
  ]) assert.deepEqual(configuration(url, ci).use.extraHTTPHeaders, { Origin: new URL(url).origin });
});
test('configured headers prevent idle pooling across GET and POST without retries or body changes', async () => {
  const received = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      received.push({ method: request.method, body, origin: request.headers.origin, connection: request.headers.connection });
      response.end('ok');
    });
  });
  const agent = new http.Agent({ keepAlive: true });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const baseURL = `http://127.0.0.1:${server.address().port}`;
    const { extraHTTPHeaders: headers } = configuration(baseURL, 'true').use;
    const reused = [];
    for (const method of ['POST', 'GET', 'POST', 'GET']) {
      const body = method === 'POST' ? '{"amount":"90071992547409.91"}' : '';
      await new Promise((resolve, reject) => {
        const request = http.request(baseURL, { method, headers, agent }, response => {
          assert.equal(response.statusCode, 200);
          response.resume();
          response.once('end', () => { reused.push(request.reusedSocket); resolve(); });
        });
        request.once('error', reject);
        request.end(body);
      });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(Object.values(agent.freeSockets).flat().length, 0);
    }
    assert.deepEqual(reused, [false, false, false, false]);
    assert.equal(received.length, 4);
    assert.deepEqual(received.map(row => row.method), ['POST', 'GET', 'POST', 'GET']);
    assert.ok(received.every(row => row.connection === 'close' && row.origin === baseURL));
    assert.deepEqual(received.filter(row => row.method === 'POST').map(row => row.body), Array(2).fill('{"amount":"90071992547409.91"}'));
  } finally {
    agent.destroy();
    await new Promise(resolve => server.close(resolve));
  }
});
test('fresh-connection request still reports a real reset and does not replay a POST', async () => {
  let writes = 0;
  const server = http.createServer(request => { writes++; request.socket.destroy(); });
  const agent = new http.Agent({ keepAlive: true });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const baseURL = `http://127.0.0.1:${server.address().port}`;
    const headers = configuration(baseURL, 'true').use.extraHTTPHeaders;
    await assert.rejects(new Promise((resolve, reject) => {
      const request = http.request(baseURL, { method: 'POST', headers, agent }, resolve);
      request.once('error', reject);
      request.end('{"synthetic":true}');
    }), { code: 'ECONNRESET' });
    assert.equal(writes, 1);
  } finally {
    agent.destroy();
    await new Promise(resolve => server.close(resolve));
  }
});
test('all manually created contexts inherit fixture headers without altering cross-tenant cookies', () => {
  const fs = require('node:fs');
  const ts = require('typescript');
  const vm = require('node:vm');
  function verify(source) {
    const ast = ts.createSourceFile('fixture.mjs', source, ts.ScriptTarget.Latest, true);
    const contexts = [];
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'newContext') {
        const options = node.arguments[0];
        assert.ok(options && ts.isObjectLiteralExpression(options), 'Manual context must use explicit reviewed options');
        const header = options.properties.find(prop => ts.isPropertyAssignment(prop) && prop.name.getText(ast) === 'extraHTTPHeaders');
        assert.ok(header, 'Manual context must inherit configured fixture headers');
        assert.match(header.initializer.getText(ast), /^(testInfo|info)\.project\.use\.extraHTTPHeaders$/);
        contexts.push({ name: node.expression.expression.getText(ast), options: options.getText(ast) });
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    return contexts;
  }
  const e2e = path.join(root, 'e2e');
  const files = fs.readdirSync(e2e, { recursive: true }).filter(file => file.endsWith('.mjs'));
  const contexts = files.flatMap(file => verify(fs.readFileSync(path.join(e2e, file), 'utf8')));
  assert.equal(contexts.length, 3);
  const inventory = fs.readFileSync(path.join(e2e, 'qc-owner-inventory.spec.mjs'), 'utf8');
  assert.throws(() => verify(inventory.replace('extraHTTPHeaders: testInfo.project.use.extraHTTPHeaders,', '')), /must inherit/);
  assert.throws(() => verify(inventory.replace('extraHTTPHeaders: testInfo.project.use.extraHTTPHeaders,', 'extraHTTPHeaders: {},')), /match/);
  const headers = { Origin: 'http://localhost:3000', Connection: 'close' };
  const state = { cookies: [{ name: 'organization_id', value: 'current' }, { name: 'session', value: 'synthetic-session' }], origins: [{ origin: 'synthetic' }] };
  const options = vm.runInNewContext(`(${contexts.find(row => row.name === 'playwrightRequest').options})`, {
    appUrl: 'http://localhost:3000', state, originalOrganizationId: 'other-authorized-company', testInfo: { project: { use: { extraHTTPHeaders: headers } } },
  });
  const anonymous = contexts.filter(row => row.options.includes('javaScriptEnabled: false'));
  assert.equal(anonymous.length, 1);
  const anonymousOptions = vm.runInNewContext(`(${anonymous[0].options})`, { baseURL: 'http://localhost:3000', info: { project: { use: { extraHTTPHeaders: headers } } } });
  function verifyAnonymous(value) {
    assert.equal(value.javaScriptEnabled, false);
    assert.equal(value.baseURL, 'http://localhost:3000');
    assert.equal(value.extraHTTPHeaders, headers);
    assert.equal(Object.hasOwn(value, 'storageState'), false);
    assert.deepEqual(Object.keys(value).sort(), ['baseURL','extraHTTPHeaders','javaScriptEnabled']);
  }
  verifyAnonymous(anonymousOptions);
  assert.throws(() => verifyAnonymous({ ...anonymousOptions, storageState: {} }));
  assert.throws(() => verifyAnonymous({ ...anonymousOptions, javaScriptEnabled: true }));
  assert.equal(options.extraHTTPHeaders, headers);
  assert.equal(options.baseURL, 'http://localhost:3000');
  assert.equal(options.storageState.cookies[0].value, 'other-authorized-company');
  assert.equal(options.storageState.cookies[1], state.cookies[1]);
  assert.equal(options.storageState.origins, state.origins);
  assert.equal(state.cookies[0].value, 'current');
});
