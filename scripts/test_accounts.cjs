// Quản lý tài khoản: khoá phải thu hồi phiên đang mở trên mọi kênh, nhật ký ghi đúng khoá/mở khoá,
// mật khẩu tạm hiện đúng một lần sau chuyển hướng. Chỉ dùng kho JSON tạm, không chạm database thật.
// Usage: npm run test:accounts
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-accounts-'));
Object.assign(process.env, {
  STORAGE_DIR: path.join(temp, 'storage'), SESSION_DIR: path.join(temp, 'sessions'),
  SESSION_SECRET: 'accounts-test-only', DB_DISABLED: '1', NODE_ENV: 'development', COOKIE_SECURE: 'false',
  ENABLE_DATA_JOBS: 'false', WEATHER_REFRESH_MINUTES: '0', MOBILE_DEMO_LOGIN: 'false', FCM_SERVICE_ACCOUNT_FILE: '',
});
// Làm chậm việc ghi phiên: chuyển hướng trước khi ghi xong sẽ luôn lộ ra, không phụ thuộc tốc độ ổ đĩa.
const storeModule = require.resolve('session-file-store');
const fileStore = require(storeModule);
require.cache[storeModule].exports = (session) => {
  const Store = fileStore(session);
  const { set } = Store.prototype;
  Store.prototype.set = function delayedSet(...args) { setTimeout(() => set.apply(this, args), 150); };
  return Store;
};

const bcrypt = require('bcryptjs');
const { io: connectSocket } = require('socket.io-client');
const store = require('../src/data/store');
const app = require('../server');
const realtime = require('../src/services/realtime');
const reports = require('../src/services/reports');

const PASSWORD = 'Test-password-1';
let server, io, base, admin, serial = 0;
const sockets = [];

// Trả kết quả ngay khi có header (như trình duyệt đi theo 302); gọi text() khi cần nội dung.
function client() {
  let cookie = '';
  const ip = `10.0.${Math.floor(serial / 250)}.${(serial++ % 250) + 1}`; // mỗi trình duyệt một IP → không chạm giới hạn đăng nhập
  const get = async (url, options = {}) => {
    const res = await fetch(base + url, { redirect: 'manual', signal: AbortSignal.timeout(15000), ...options, headers: { ...options.headers, cookie, 'x-forwarded-for': ip } });
    const set = res.headers.getSetCookie();
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    return res;
  };
  get.post = (url, body) => get(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  return get;
}
const csrfOf = async (c, url) => (await (await c(url)).text()).match(/name="_csrf" value="([a-f0-9]+)"/)[1];
const makeUser = (username, role) => store.insert('users', { username, name: username, role, scope: null, active: true, password_hash: bcrypt.hashSync(PASSWORD, 4) });

async function signIn(path_, username, password = PASSWORD) {
  const c = client();
  const _csrf = await csrfOf(c, path_);
  const res = await c.post(path_, { _csrf, username, password });
  await res.text();
  c.csrf = res.status === 302 ? await csrfOf(c, res.headers.get('location')) : _csrf;
  c.status = res.status;
  return c;
}
const staffSignIn = (username, password) => signIn('/quan-tri/dang-nhap', username, password);

async function toggle(user) {
  const res = await admin.post(`/quan-tri/nguoi-dung/${user.id}`, { _csrf: admin.csrf, action: 'toggle' });
  await res.text();
  assert.equal(res.status, 302);
}

async function api(url, { token, body } = {}) {
  const res = await fetch(base + url, {
    method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(15000),
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}
const mobileLogin = async (username) => (await api('/api/mobile/auth/login', { body: { username, password: PASSWORD } })).body;

function openSocket(token) {
  const socket = connectSocket(`${base}/mobile`, { path: '/socket.io', transports: ['websocket'], auth: token ? { token } : {}, reconnection: false });
  sockets.push(socket);
  return new Promise((resolve, reject) => { socket.once('connect', () => resolve(socket)); socket.once('connect_error', reject); });
}

before(async () => {
  await app.ready;
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  io = realtime.attach(server);
  base = `http://127.0.0.1:${server.address().port}`;
  makeUser('quantri', 'admin');
  admin = await staffSignIn('quantri');
  assert.equal(admin.status, 302);
});

after(async () => {
  sockets.forEach((s) => s.close());
  if (io) io.close();
  if (server) { server.close(); server.closeAllConnections(); }
  fs.rmSync(temp, { recursive: true, force: true });
});

test('khoá tài khoản: phiên quản trị đang mở mất quyền ở request tiếp theo', async () => {
  const user = makeUser('canbo.web', 'specialist');
  const c = await staffSignIn('canbo.web');
  assert.equal((await c('/quan-tri/du-lieu')).status, 200);

  await toggle(user);
  const page = await c('/quan-tri/du-lieu');
  assert.equal(page.status, 302);
  assert.match(page.headers.get('location'), /^\/quan-tri\/dang-nhap/);
  const before_ = store.all('documents').length;
  const write = await c.post('/quan-tri/mat-khau', { _csrf: c.csrf, current: PASSWORD, password: 'mat-khau-moi-123' });
  assert.match(write.headers.get('location'), /^\/quan-tri\/dang-nhap/);
  assert.ok(bcrypt.compareSync(PASSWORD, store.get('users', user.id).password_hash), 'phiên đã khoá không được ghi dữ liệu');
  assert.equal(store.all('documents').length, before_);
  assert.equal((await staffSignIn('canbo.web')).status, 401);
  assert.equal((await admin('/quan-tri/nguoi-dung')).status, 200, 'phiên người khác không bị ảnh hưởng');
});

test('mở khoá không làm phiên cũ sống lại; đăng nhập mới dùng được', async () => {
  const user = makeUser('canbo.molai', 'specialist');
  const idle = await staffSignIn('canbo.molai'); // không gửi request nào trong lúc bị khoá
  await toggle(user);
  await toggle(user);
  assert.equal((await idle('/quan-tri/du-lieu')).status, 302);
  const fresh = await staffSignIn('canbo.molai');
  assert.equal((await fresh('/quan-tri/du-lieu')).status, 200);
});

test('tài khoản bị khoá ngoài trang quản trị (CLI/database) cũng mất quyền ngay', async () => {
  const user = makeUser('canbo.ngoai', 'specialist');
  const c = await staffSignIn('canbo.ngoai');
  store.update('users', user.id, { active: false });
  assert.equal((await c('/quan-tri/du-lieu')).status, 302);
});

test('đổi vai trò áp dụng cho phiên đang mở', async () => {
  const user = makeUser('canbo.vaitro', 'admin');
  const c = await staffSignIn('canbo.vaitro');
  assert.equal((await c('/quan-tri/nguoi-dung')).status, 200);
  store.update('users', user.id, { role: 'leader' });
  assert.equal((await c('/quan-tri/nguoi-dung')).status, 403);
  store.update('users', user.id, { role: 'citizen' });
  assert.equal((await c('/quan-tri/du-lieu')).status, 302);
});

test('khoá tài khoản: phiên cán bộ không còn xem được dữ liệu nội bộ ở trang công khai', async () => {
  const user = makeUser('canbo.anh', 'specialist');
  const c = await staffSignIn('canbo.anh');
  fs.mkdirSync(reports.PHOTO_DIR, { recursive: true });
  fs.writeFileSync(path.join(reports.PHOTO_DIR, 'noi-bo.jpg'), 'anh');
  store.insert('reports', { code: 'PA-TEST-1', type: 'khac', status: 'received', photos: ['noi-bo.jpg'], public: false, public_photos: false });
  assert.equal((await c('/phan-anh/anh/noi-bo.jpg')).status, 200);
  await toggle(user);
  assert.equal((await c('/phan-anh/anh/noi-bo.jpg')).status, 404);
});

test('khoá tài khoản: phiên người dân trên web bị thu hồi, kể cả sau khi mở khoá', async () => {
  const user = makeUser('dan.web', 'citizen');
  const c = await signIn('/dang-nhap', 'dan.web');
  assert.equal((await c('/tai-khoan')).status, 200);
  await toggle(user);
  const res = await c('/tai-khoan');
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /^\/dang-nhap/);
  await toggle(user);
  assert.equal((await c('/tai-khoan')).status, 302);
  const fresh = await signIn('/dang-nhap', 'dan.web');
  assert.equal((await fresh('/tai-khoan')).status, 200);
});

test('khoá tài khoản: token MobileGIS và API v1 bị thu hồi, kể cả sau khi mở khoá', async () => {
  const user = makeUser('canbo.mobile', 'specialist');
  const old = await mobileLogin('canbo.mobile');
  assert.equal((await api('/api/mobile/me', { token: old.access_token })).status, 200);
  const staffCatalog = () => api('/api/v1/layers', { token: old.access_token });
  assert.equal((await staffCatalog()).status, 200);

  await toggle(user);
  assert.equal((await api('/api/mobile/me', { token: old.access_token })).status, 401);
  assert.equal((await staffCatalog()).status, 401);
  const refreshLocked = await api('/api/mobile/auth/refresh', { body: { refresh_token: old.refresh_token } });
  assert.deepEqual([refreshLocked.status, refreshLocked.body.code], [401, 'INACTIVE']);

  await toggle(user);
  assert.equal((await api('/api/mobile/me', { token: old.access_token })).status, 401);
  assert.equal((await staffCatalog()).status, 401);
  const fresh = await mobileLogin('canbo.mobile');
  const replay = await api('/api/mobile/auth/refresh', { body: { refresh_token: old.refresh_token } });
  assert.deepEqual([replay.status, replay.body.code], [401, 'EXPIRED']);
  assert.equal((await api('/api/mobile/me', { token: fresh.access_token })).status, 200, 'token cũ gửi lại không được đăng xuất phiên mới');
});

test('refresh token đã xoay vòng bị dùng lại vẫn thu hồi mọi phiên', async () => {
  makeUser('canbo.xoay', 'specialist');
  const first = await mobileLogin('canbo.xoay');
  const next = (await api('/api/mobile/auth/refresh', { body: { refresh_token: first.refresh_token } })).body;
  const replay = await api('/api/mobile/auth/refresh', { body: { refresh_token: first.refresh_token } });
  assert.equal(replay.body.code, 'REVOKED');
  assert.notEqual((await api('/api/mobile/auth/refresh', { body: { refresh_token: next.refresh_token } })).status, 200);
});

test('khoá tài khoản: Socket.IO đang mở bị ngắt và không kết nối lại được', async () => {
  const user = makeUser('canbo.socket', 'specialist');
  makeUser('canbo.khac', 'specialist');
  const token = (await mobileLogin('canbo.socket')).access_token;
  const [mine, other, guest] = [await openSocket(token), await openSocket((await mobileLogin('canbo.khac')).access_token), await openSocket()];
  const dropped = new Promise((resolve, reject) => {
    mine.once('disconnect', resolve);
    setTimeout(() => reject(new Error('socket của tài khoản bị khoá vẫn mở')), 5000).unref();
  });
  await toggle(user);
  assert.equal(await dropped, 'io server disconnect');
  assert.ok(other.connected && guest.connected);
  await assert.rejects(openSocket(token));
});

test('nhật ký ghi đúng user.lock và user.unlock', async () => {
  const user = makeUser('canbo.nhatky', 'specialist');
  const actions = () => store.filter('audit', (a) => a.target === user.username && /^user\.(un)?lock$/.test(a.action)).map((a) => a.action);
  await toggle(user);
  assert.equal(store.get('users', user.id).active, false);
  assert.deepEqual(actions(), ['user.lock']);
  await toggle(user);
  assert.equal(store.get('users', user.id).active, true);
  assert.deepEqual(actions(), ['user.lock', 'user.unlock']);
});

async function expectPasswordOnce(res, username) {
  assert.equal(res.status, 302);
  // đi theo chuyển hướng ngay khi nhận header, chưa đọc hết phản hồi
  const page = await admin(res.headers.get('location'));
  const html = await page.text();
  await res.text();
  const shown = html.match(/Mật khẩu tạm của <b>([^<]+)<\/b>: <code[^>]*>([^<]+)<\/code>/);
  assert.ok(shown, 'trang sau chuyển hướng phải hiện mật khẩu tạm');
  assert.equal(shown[1], username);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.ok(!(await (await admin('/quan-tri/nguoi-dung')).text()).includes(shown[2]), 'chỉ hiện một lần');
  return shown[2];
}

test('tạo tài khoản và cấp lại mật khẩu: mật khẩu tạm hiện đúng một lần và đăng nhập được', async () => {
  const created = await admin.post('/quan-tri/nguoi-dung', { _csrf: admin.csrf, username: 'canbo.moi', name: 'Cán bộ mới', role: 'specialist' });
  const first = await expectPasswordOnce(created, 'canbo.moi');
  assert.equal((await staffSignIn('canbo.moi', first)).status, 302);
  const user = store.find('users', (u) => u.username === 'canbo.moi');
  const reset = await admin.post(`/quan-tri/nguoi-dung/${user.id}`, { _csrf: admin.csrf, action: 'reset' });
  const second = await expectPasswordOnce(reset, 'canbo.moi');
  assert.notEqual(second, first);
  assert.equal((await staffSignIn('canbo.moi', second)).status, 302);
});
