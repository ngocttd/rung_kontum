// Yêu cầu lỗi không được làm tắt máy chủ: tham số sai kiểu ở trang công khai, mã bản đồ sai định dạng,
// và lỗi database trong route async. Chỉ dùng kho JSON tạm.
// Usage: npm run test:errors
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-route-errors-'));
Object.assign(process.env, {
  STORAGE_DIR: path.join(temp, 'storage'), SESSION_DIR: path.join(temp, 'sessions'),
  SESSION_SECRET: 'route-errors-test-only', DB_DISABLED: '1', NODE_ENV: 'development', COOKIE_SECURE: 'false',
  ENABLE_DATA_JOBS: 'false', WEATHER_REFRESH_MINUTES: '0', FCM_SERVICE_ACCOUNT_FILE: '',
});
const bcrypt = require('bcryptjs');
const store = require('../src/data/store');
const maps = require('../src/services/maps');
// phân hệ bản đồ cần PostGIS: giả lập database đang bật nhưng truy vấn lỗi
const queried = [];
maps.enabled = () => true;
maps.get = async (id) => { queried.push(id); throw new Error('database lỗi (giả lập)'); };
maps.publishedLayers = async () => [];
maps.publishedDocuments = async () => [];
const app = require('../server');

let server, base, cookie = '';
const originalError = console.error;
async function call(url, options = {}) {
  const res = await fetch(base + url, { redirect: 'manual', signal: AbortSignal.timeout(10000), ...options, headers: { ...options.headers, cookie } });
  const set = res.headers.getSetCookie();
  if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
  return { status: res.status, text: await res.text() };
}

before(async () => {
  await app.ready;
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  store.insert('users', { username: 'canbo.loi', name: 'x', role: 'specialist', active: true, password_hash: bcrypt.hashSync('Test-password-1', 4) });
  console.error = () => {};
});
after(() => {
  console.error = originalError;
  if (server) { server.close(); server.closeAllConnections(); }
  fs.rmSync(temp, { recursive: true, force: true });
});

test('trang tài liệu công khai nhận tham số tìm kiếm sai kiểu', async () => {
  for (const query of ['q=a&q=b', 'q[x]=1', 'q[]=a', 'loai=a&loai=b', 'co_quan[x]=1', 'id=a&id=b']) {
    assert.equal((await call(`/tai-lieu?${query}`)).status, 200, query);
  }
  assert.equal((await call('/tai-lieu?q=lam')).status, 200);
});

test('route bản đồ: mã sai định dạng → 404, lỗi database → 500, máy chủ vẫn chạy', async () => {
  const csrf = (await call('/quan-tri/dang-nhap')).text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
  const login = await call('/quan-tri/dang-nhap', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrf, username: 'canbo.loi', password: 'Test-password-1' }) });
  assert.equal(login.status, 302);
  for (const url of ['/quan-tri/ban-do/sai-ma', '/quan-tri/ban-do/sai-ma/trang-thai', `/quan-tri/ban-do/${'-'.repeat(36)}/trang-thai`]) {
    assert.equal((await call(url)).status, 404, url);
  }
  assert.deepEqual(queried, [], 'mã sai không được xuống database');
  const id = '00000000-0000-0000-0000-000000000000';
  for (const url of [`/quan-tri/ban-do/${id}/trang-thai`, `/quan-tri/ban-do/${id}`]) {
    const res = await call(url);
    assert.equal(res.status, 500, url);
    assert.doesNotMatch(res.text, /giả lập|at .*\.js/, 'không lộ chi tiết lỗi');
  }
  assert.equal((await call('/quan-tri')).status, 200);
});
