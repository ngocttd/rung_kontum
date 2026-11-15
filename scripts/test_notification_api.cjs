// Kiểm tra API thông báo khi chưa có PostgreSQL, chỉ dùng HTTP và dữ liệu tạm cục bộ.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'kontum-notification-api-'));
Object.assign(process.env, {
  DB_DISABLED: '1', STORAGE_DIR: storage,
  SESSION_SECRET: 'notification-api-test-only', FCM_SERVICE_ACCOUNT_FILE: '',
});
const express = require('express');
const store = require('../src/data/store');
let server, base, token;

async function call(endpoint, { authenticated = false, body } = {}) {
  const response = await fetch(`${base}/api/mobile${endpoint}`, {
    method: 'POST', signal: AbortSignal.timeout(5000),
    headers: {
      'content-type': 'application/json',
      ...(authenticated ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body || {}),
  });
  return { status: response.status, body: await response.json() };
}

before(async () => {
  await store.init();
  const app = express();
  app.use(express.json());
  app.use('/api/mobile', require('../src/routes/mobile'));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const registered = await call('/auth/register', { body: {
    name: 'Kiểm thử thông báo', email: 'notification-test@example.test', password: 'local-test-password',
  } });
  assert.equal(registered.status, 201);
  token = registered.body.access_token;
});

after(async () => {
  if (server) {
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await closed;
  }
  fs.rmSync(storage, { recursive: true, force: true });
});

test('khách không được tự gửi thông báo thử', async () => {
  const response = await call('/notifications/test');
  assert.equal(response.status, 401);
  assert.equal(response.body.code, 'UNAUTHENTICATED');
});

test('thiếu PostgreSQL phải báo lỗi, không trả thành công khi chưa tạo thông báo', async () => {
  const response = await call('/notifications/test', { authenticated: true });
  assert.equal(response.status, 503);
  assert.equal(response.body.code, 'DB_REQUIRED');
  assert.ok(response.body.error);
});
