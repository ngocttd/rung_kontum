// HTTP regression checks on a temporary loopback server with disposable JSON storage.
// Run with: node scripts/test_api_public.cjs
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempParent = fs.realpathSync(os.tmpdir());
const temp = fs.mkdtempSync(path.join(tempParent, 'kt-api-public-'));
Object.assign(process.env, {
  STORAGE_DIR: path.join(temp, 'storage'),
  SESSION_DIR: path.join(temp, 'sessions'),
  SESSION_SECRET: randomBytes(32).toString('hex'),
  DB_DISABLED: '1',
  ENABLE_DATA_JOBS: 'false',
  WEATHER_REFRESH_MINUTES: '0',
  MOBILE_DEMO_LOGIN: 'false',
  PUBLIC_BASE_URL: '/',
  SHOW_DRAFT_CONTENT: 'false',
  NODE_ENV: 'development',
  COOKIE_SECURE: 'false',
});

const checks = { pass: 0, fail: 0 };
let app;
let store;
let server;
let base;

const array = (value) => assert.ok(Array.isArray(value), 'expected an array');
const number = (value) => assert.ok(Number.isFinite(value), 'expected a finite number');
const properties = (...keys) => (value) => {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'expected a JSON object');
  for (const key of keys) assert.ok(Object.hasOwn(value, key), `missing property ${key}`);
};
const collection = (value) => {
  properties('type', 'features')(value);
  assert.equal(value.type, 'FeatureCollection');
  array(value.features);
};
const pagination = (value) => {
  properties('total', 'page', 'items')(value);
  number(value.total);
  number(value.page);
  array(value.items);
};
const error = (code) => (value) => {
  properties('error')(value);
  assert.equal(typeof value.error, 'string');
  if (code) assert.equal(value.code, code);
};

async function request(method, url, expected, check, { token, body, raw, contentType, image = false } = {}) {
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (contentType) headers['content-type'] = contentType;
  const label = `${method} ${url.replace(/\/uploads\/[\w-]{25,}/, '/uploads/:token')}`;
  try {
    const response = await fetch(base + url, {
      method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
      redirect: 'manual', signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, expected, `HTTP ${response.status}, expected ${expected}`);
    let value;
    if (image) {
      assert.match(response.headers.get('content-type') || '', /^image\/webp\b/);
      value = Buffer.from(await response.arrayBuffer());
    } else if (expected !== 204 && expected !== 302) {
      assert.match(response.headers.get('content-type') || '', /^application\/json\b/);
      value = await response.json();
    } else {
      await response.arrayBuffer();
    }
    if (check) check(value, response);
    checks.pass += 1;
    console.log(`PASS ${expected} ${label}`);
    return value;
  } catch (err) {
    checks.fail += 1;
    console.error(`FAIL ${label} (${err.message})`);
    return undefined;
  }
}

async function reads(prefix, cases) {
  for (const [url, check, status = 200] of cases) await request('GET', prefix + url, status, check);
}

async function run() {
  app = require('../server');
  store = require('../src/data/store');
  assert.equal(require('../src/db/pool').enabled, false);
  await app.ready;
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;

  const bcrypt = require('bcryptjs');
  const password = randomBytes(18).toString('base64url');
  const password_hash = await bcrypt.hash(password, 8);
  for (const role of ['specialist', 'leader', 'citizen']) {
    store.insert('users', { username: `api-test-${role}`, name: `API test ${role}`, role, active: true, password_hash });
  }
  store.insert('articles', {
    slug: 'api-test-article', title: 'API test article', category: 'khoa-hoc', body: 'Synthetic news article.',
    status: 'published', published_at: '2026-01-01T00:00:00.000Z',
  });

  await reads('/api/public', [
    ['/map/layers', (value, response) => {
      properties('overlays', 'vector', 'custom')(value);
      assert.ok(value.overlays.length > 0);
      assert.ok(value.vector.some((item) => item.id === 'communes'));
      assert.equal(response.headers.get('cache-control'), 'no-cache');
    }],
    ['/maps', array],
    ['/boundaries/province', collection],
    ['/boundaries/communes', (value) => { collection(value); assert.equal(value.features.length, 40); }],
    ['/forest/summary', properties('communes', 'established_forest_ha', 'year', 'years')],
    ['/forest/communes', (value) => { array(value); assert.equal(value.length, 40); }],
    ['/forest/change', properties('history')],
    ['/landcover/history', properties('by_commune')],
    ['/field-samples', collection],
    ['/forest/candidates', collection],
    ['/fire/hotspots', (value) => { collection(value); properties('meta')(value); }],
    ['/fire/hotspots/archive', error(), 503],
    ['/fire/danger', properties('today_local', 'communes')],
    ['/fire/history', properties('hotspots', 'burned')],
    ['/alerts?limit=3', (value) => { array(value); assert.ok(value.length <= 3); }],
    ['/weather', collection],
    ['/weather/wind', collection],
    ['/weather/wind?nguon=era5', collection],
    ['/climate', array],
    ['/ndvi', array],
    ['/reports?page=2', (value) => { pagination(value); assert.equal(value.page, 2); }],
    ['/layers/custom/missing-api-test', error(), 404],
    ['/tools/nearest?lon=107.95&lat=14.6', properties('point', 'settlements', 'road', 'facilities')],
    ['/tools/nearest', error(), 400],
    ['/tools/route?from=108.0003,14.3479&to=107.84,14.6612', (value) => {
      collection(value);
      assert.ok(value.summary.distance_m > 30000 && value.summary.distance_m < 60000);
    }],
    ['/tools/route?from=107.95,14.6', error(), 400],
    ['/search?q=ngoc', (value) => { array(value); assert.ok(value.length > 0); }],
    ['/search?q=a', (value) => assert.deepEqual(value, [])],
    ['/search?q=14.35%2C%20108.00', (value) => {
      array(value);
      assert.deepEqual(value.find((item) => item.type === 'Toạ độ')?.center, [108, 14.35]);
    }],
  ]);

  const boot = await request('GET', '/api/mobile/bootstrap', 200, (value, response) => {
    properties('api_version', 'communes', 'features', 'catalogs', 'map')(value);
    assert.equal(value.user, null);
    assert.equal(value.features.demo_login, false);
    assert.equal(response.headers.get('x-api-version'), value.api_version);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
  const commune = encodeURIComponent(boot?.communes[0]?.code || 'missing-api-test');
  await request('GET', `/api/public/weather/${commune}`, 200, properties('code', 'days', 'hours'));
  await reads('/api/mobile', [
    ['/app-version?current=1.0.0', properties('latest', 'update', 'force')],
    ['/layers?bbox=107.3,13.9,108.6,15.5&zoom=9', (value) => {
      properties('bbox', 'zoom', 'raster', 'vector')(value);
      assert.equal(value.zoom, 9);
      assert.ok(value.raster.length > 0);
      assert.ok(!value.vector.some((item) => item.internal));
    }],
    ['/home', (value) => {
      properties('forest', 'hotspots_7d', 'danger_today', 'alerts', 'news', 'freshness')(value);
      assert.match(value.danger_today.date || '', /^\d{4}-\d{2}-\d{2}$/);
    }],
    ['/forest/summary', properties('summary', 'communes', 'landcover')],
    ['/forest/change', (value) => pagination(value.candidates)],
    ['/fire/hotspots', collection],
    ['/fire/alerts?limit=2', (value) => { pagination(value); assert.equal(value.limit, 2); }],
    ['/fire/danger', properties('today_local', 'communes')],
    ['/fire/history', properties('hotspots', 'burned')],
    ['/imagery/products', properties('products', 'monthly', 'satellite')],
    ['/weather', array],
    [`/weather/${commune}`, properties('forecast', 'danger')],
    ['/climate', array],
    ['/news', (value) => { pagination(value); assert.equal(value.items[0]?.slug, 'api-test-article'); }],
    ['/news/api-test-article', properties('slug', 'body', 'related', 'web_url')],
    ['/news/missing-api-test', error('NOT_FOUND'), 404],
    ['/documents', pagination],
    ['/files/missing-api-test.webp', error('NOT_FOUND'), 404],
    ['/reports/public', pagination],
    ['/reports/PA-0000-0000', error('NOT_FOUND'), 404],
    ['/notifications', pagination],
    ['/missing-api-test', error('NOT_FOUND'), 404],
  ]);

  const protectedMobile = [
    ['POST', '/auth/logout'], ['POST', '/auth/password'], ['GET', '/me'], ['GET', '/reports/mine'],
    ['GET', '/assignments'], ['POST', '/assignments'], ['GET', '/assignments/test'],
    ['POST', '/assignments/test/accept'], ['POST', '/assignments/test/start'],
    ['GET', '/surveys'], ['POST', '/surveys'], ['GET', '/surveys/test'], ['PATCH', '/surveys/test'], ['POST', '/surveys/test/review'],
    ['GET', '/verifications'], ['POST', '/verifications'], ['GET', '/verifications/test'], ['POST', '/verifications/test/review'],
    ['POST', '/sync/batch'], ['GET', '/sync/changes'], ['GET', '/sync/conflicts'], ['POST', '/sync/conflicts/test/resolve'],
    ['POST', '/notifications/test'], ['POST', '/notifications/read'],
  ];
  for (const [method, url] of protectedMobile) await request(method, `/api/mobile${url}`, 401, error('UNAUTHENTICATED'));
  await request('POST', '/api/mobile/auth/demo', 403, error('DEMO_DISABLED'), { body: { role: 'citizen' } });
  await request('POST', '/api/mobile/auth/forgot', 200, properties('ok', 'message'), { body: {} });
  await request('POST', '/api/mobile/auth/register', 400, error('VALIDATION'), { body: {} });
  await request('POST', '/api/mobile/auth/refresh', 401, error('INVALID_REFRESH'), { body: {} });
  await request('POST', '/api/mobile/uploads/presign', 400, error('VALIDATION'), { body: {} });
  await request('PUT', '/api/mobile/uploads/missing-api-test', 410, error('UPLOAD_EXPIRED'), { raw: Buffer.from('test'), contentType: 'image/png' });
  await request('POST', '/api/mobile/reports', 400, error('VALIDATION'), { body: {} });

  const tokens = {};
  for (const role of ['specialist', 'leader', 'citizen']) {
    const login = await request('POST', '/api/mobile/auth/login', 200, (value) => {
      properties('access_token', 'refresh_token', 'user')(value);
      assert.equal(value.user.role, role);
    }, { body: { username: `api-test-${role}`, password } });
    tokens[role] = login?.access_token;
  }
  await request('GET', '/api/mobile/me', 200, (value) => assert.equal(value.role, 'citizen'), { token: tokens.citizen });
  const reportBody = { client_uuid: randomUUID(), type: 'khac', description: 'Synthetic API report.', lat: 14.6, lon: 107.95 };
  const report = await request('POST', '/api/mobile/reports', 201, properties('report', 'duplicate'), { token: tokens.citizen, body: reportBody });
  await request('POST', '/api/mobile/reports', 200, (value) => assert.equal(value.duplicate, true), { token: tokens.citizen, body: reportBody });
  await request('GET', `/api/mobile/reports/${report?.report.code || 'missing-api-test'}`, 200, properties('code', 'status'));
  await request('GET', '/api/mobile/reports/mine', 200, (value) => {
    pagination(value);
    assert.ok(value.items.some((item) => item.code === report?.report.code));
  }, { token: tokens.citizen });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const presign = await request('POST', '/api/mobile/uploads/presign', 200, properties('upload_url', 'method', 'headers'), {
    token: tokens.citizen, body: { mime: 'image/png', bytes: png.length, owner_kind: 'report' },
  });
  const uploaded = await request('PUT', presign?.upload_url || '/api/mobile/uploads/missing-api-test', 201, properties('object_key', 'mime'), {
    raw: png, contentType: 'image/png',
  });
  if (uploaded) {
    const file = `/api/mobile/files/${uploaded.object_key}`;
    await request('POST', '/api/mobile/reports', 201, (value) => assert.equal(value.report.photos.length, 1), {
      token: tokens.citizen, body: { ...reportBody, client_uuid: randomUUID(), attachments: [uploaded.object_key] },
    });
    await request('GET', file, 200, (value) => assert.equal(value.toString('ascii', 8, 12), 'WEBP'), { token: tokens.citizen, image: true });
    await request('GET', file, 404, error('NOT_FOUND'));
  }
  const deviceId = randomUUID();
  await request('POST', '/api/mobile/devices', 200, (value) => assert.equal(value.id, deviceId), {
    body: { device_id: deviceId, platform: 'android', app_version: '1.0.0' },
  });

  await reads('/api/v1', [
    ['', (value) => { properties('name', 'version', 'endpoints')(value); assert.equal(value.endpoints.length, 14); }],
    ['/catalog?type=vector', (value, response) => {
      properties('count', 'layers', 'license')(value);
      assert.equal(value.count, value.layers.length);
      assert.ok(value.layers.length > 0 && value.layers.every((item) => item.type === 'vector'));
      assert.equal(response.headers.get('access-control-allow-origin'), '*');
    }],
    ['/catalog/province', (value) => { assert.equal(value.id, 'province'); assert.match(value.geojson, /\/api\/public\/boundaries\/province$/); }],
    ['/catalog/province/data', (value, response) => assert.match(response.headers.get('location') || '', /\/api\/public\/boundaries\/province$/), 302],
    ['/catalog/missing-api-test', error(), 404],
    ['/catalog/missing-api-test/data', error(), 404],
    ['/missing-api-test', error(), 404],
  ]);

  const noTokenV1 = [
    ['PATCH', '/catalog/province'], ['DELETE', '/catalog/province'],
    ['GET', '/layers'], ['GET', '/layers/test'], ['GET', '/layers/test/geojson'], ['POST', '/layers'],
    ['PATCH', '/layers/test'], ['PUT', '/layers/test/geojson'], ['POST', '/layers/test/publish'],
    ['POST', '/layers/test/unpublish'], ['DELETE', '/layers/test'],
  ];
  for (const [method, url] of noTokenV1) await request(method, `/api/v1${url}`, 401, error('UNAUTHENTICATED'));
  await request('GET', '/api/v1/layers', 403, error('FORBIDDEN'), { token: tokens.citizen });
  await request('PATCH', '/api/v1/catalog/province', 403, error('FORBIDDEN'), { token: tokens.leader, body: { hidden: true } });

  const geojson = { type: 'FeatureCollection', features: [{
    type: 'Feature', geometry: { type: 'Point', coordinates: [107.95, 14.6] }, properties: { name: 'API test point' },
  }] };
  const layer = await request('POST', '/api/v1/layers', 201, (value) => assert.equal(value.status, 'staging'), {
    token: tokens.specialist, body: { title: 'Synthetic test layer', geojson },
  });
  const id = layer?.id || 'missing-api-test';
  const layerUrl = `/api/v1/layers/${id}`;
  const publicLayer = `/api/public/layers/custom/${id}`;
  await request('GET', '/api/v1/layers?status=staging', 200, (value) => assert.ok(value.custom.some((item) => item.id === id)), { token: tokens.leader });
  await request('GET', layerUrl, 200, (value) => assert.equal(value.id, id), { token: tokens.leader });
  await request('GET', `${layerUrl}/geojson`, 200, (value) => assert.deepEqual(value, geojson), { token: tokens.leader });
  await request('GET', publicLayer, 404, error());
  await request('PATCH', layerUrl, 200, (value) => assert.equal(value.title, 'Renamed synthetic layer'), { token: tokens.specialist, body: { title: 'Renamed synthetic layer' } });
  await request('POST', `${layerUrl}/publish`, 200, (value) => assert.equal(value.status, 'published'), { token: tokens.specialist });
  await request('GET', publicLayer, 200, (value) => assert.deepEqual(value, geojson));
  await request('POST', `${layerUrl}/unpublish`, 200, (value) => assert.equal(value.status, 'staging'), { token: tokens.specialist });
  await request('GET', publicLayer, 404, error());
  await request('PUT', `${layerUrl}/geojson`, 200, (value) => assert.equal(value.validation.count, 1), { token: tokens.specialist, body: { geojson } });
  await request('DELETE', layerUrl, 204, undefined, { token: tokens.specialist });
  await request('GET', layerUrl, 404, error('NOT_FOUND'), { token: tokens.leader });
  await request('PATCH', '/api/v1/catalog/province', 200, properties('ok', 'id'), { token: tokens.specialist, body: { hidden: true } });
  await request('GET', '/api/v1/catalog/province', 404, error());
  await request('GET', '/api/v1/catalog/province', 200, (value) => assert.equal(value.hidden, true), { token: tokens.leader });
  await request('DELETE', '/api/v1/catalog/province', 200, (value) => assert.equal(value.removed, 'catalog'), { token: tokens.specialist });
  await request('GET', '/api/v1/catalog/province', 404, error(), { token: tokens.leader });
}

run().catch((err) => {
  checks.fail += 1;
  console.error(`API test setup failed (${err.message})`);
}).finally(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  if (store) await store.drain();
  const resolved = fs.realpathSync(temp);
  assert.equal(path.dirname(resolved), tempParent);
  assert.ok(path.basename(resolved).startsWith('kt-api-public-'));
  fs.rmSync(resolved, { recursive: true, force: true });
  console.log(`${checks.pass} passed, ${checks.fail} failed (local HTTP, disposable JSON storage).`);
  process.exit(checks.fail ? 1 : 0);
});
