// Exercise the real HTTP middleware before sessions and template locals exist.
// Use disposable storage so these requests never touch production records.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempParent = fs.realpathSync(os.tmpdir());
const temp = fs.mkdtempSync(path.join(tempParent, 'kt-http-errors-'));
Object.assign(process.env, {
  STORAGE_DIR: path.join(temp, 'storage'), SESSION_DIR: path.join(temp, 'sessions'),
  SESSION_SECRET: require('node:crypto').randomBytes(32).toString('hex'),
  DB_DISABLED: '1', NODE_ENV: 'development', COOKIE_SECURE: 'false',
  ENABLE_DATA_JOBS: 'false', WEATHER_REFRESH_MINUTES: '0',
});
const app = require('../server');
const store = require('../src/data/store');
const originalError = console.error;
let loggedErrors = 0;
let server;
let checks = 0;

function safe(body) {
  assert.doesNotMatch(body, /(?:^|[^\w])[A-Za-z]:[\\/]|node:internal|requireStack|Traceback|^\s*at\s+\S/m);
  assert.ok(!body.includes(path.resolve(__dirname, '..')));
}

(async () => {
  await app.ready;
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  console.error = () => { loggedErrors += 1; };
  for (const [url, status, payload] of [
    ['/', 400, '{'],
    ['/api/public/map/layers', 400, '{'],
    ['/api/mobile/config', 400, '{'],
    ['/quan-tri/api/jobs/missing', 400, '{'],
    ['/', 413, JSON.stringify({ value: 'x'.repeat(205 * 1024) })],
    ['/api/public/map/layers', 413, JSON.stringify({ value: 'x'.repeat(205 * 1024) })],
  ]) {
    const response = await fetch(base + url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: payload,
      signal: AbortSignal.timeout(10000),
    });
    const body = await response.text();
    assert.equal(response.status, status, url);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    safe(body);
    if (url === '/') assert.match(response.headers.get('content-type'), /text\/html/);
    else {
      assert.match(response.headers.get('content-type'), /application\/json/);
      assert.ok(JSON.parse(body).error);
    }
    checks += 1;
    console.log(`PASS safe ${status}: ${url}`);
  }

  // A broken error template must still produce a fixed response in development.
  const render = app.render;
  app.render = function failedRender(view, options, callback) {
    if (view === 'public/error') return callback(new Error(String.raw`Template failed at C:\private\views\public\error.ejs`));
    return render.call(this, view, options, callback);
  };
  try {
    const response = await fetch(base + '/missing-http-error-test', { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 500);
    safe(await response.text());
    checks += 1;
    console.log('PASS safe 500 when error template fails');
  } finally { app.render = render; }
  assert.equal(loggedErrors, checks, 'HTTP exceptions must remain logged on the server');
  console.log(`${checks} HTTP error checks passed.`);
})().catch(error => { originalError(error); process.exitCode = 1; }).finally(async () => {
  console.error = originalError;
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await store.drain();
  const resolved = fs.realpathSync(temp);
  if (path.dirname(resolved) !== tempParent || !path.basename(resolved).startsWith('kt-http-errors-')) throw new Error('Unexpected test cleanup path');
  fs.rmSync(resolved, { recursive: true, force: true });
  process.exit(process.exitCode || 0);
});
