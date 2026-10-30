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
