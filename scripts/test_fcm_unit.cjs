// Không cần DB, mạng ngoài hay tài khoản Firebase. Chỉ gửi đến HTTP server cục bộ.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
process.env.SESSION_SECRET = 'unit-test-only';
const fcm = require('../src/services/push/fcm');

test('APNs alert luôn có push-type và priority đúng; collapse ID tối đa 64 byte', () => {
  for (const priority of ['normal', 'high']) {
    const m = fcm.message('token', { id: 'n1', priority, kind: 'assignment', title: 'Nhiệm vụ', data: { screen: 'task', id: 'task1', lat: 14.5 } });
    assert.equal(m.apns.headers['apns-push-type'], 'alert');
    assert.equal(m.apns.headers['apns-priority'], '10');
    assert.equal(m.apns.payload.aps.sound, 'default');
    assert.equal(m.apns.payload.aps['interruption-level'], undefined);
    assert.ok(Object.values(m.data).every((v) => typeof v === 'string'));
    assert.equal(m.data.id, 'n1');
    assert.equal(JSON.parse(m.data.link).id, 'task1');
  }
  const m = fcm.message('token', { id: 'n1', source_ref: 'cảnh báo '.repeat(20) });
  assert.ok(Buffer.byteLength(m.apns.headers['apns-collapse-id']) <= 64);
});

test('HTTP v1: ký JWT OAuth, cache bearer, phân biệt token hết hạn và dự án lỗi', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kontum-fcm-test-'));
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  let oauthCount = 0;
  let responseMode = 'ok';
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    res.setHeader('content-type', 'application/json');
    if (req.url === '/token') {
      oauthCount++;
      const jwt = new URLSearchParams(body).get('assertion');
      const [h, p, sig] = jwt.split('.');
      assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(sig, 'base64url')));
      const claims = JSON.parse(Buffer.from(p, 'base64url'));
      assert.equal(claims.scope, 'https://www.googleapis.com/auth/firebase.messaging');
      res.end(JSON.stringify({ access_token: 'local-test-token', expires_in: 3600 }));
      return;
    }
    assert.equal(req.url, '/v1/projects/unit-test/messages:send');
    assert.equal(req.headers.authorization, 'Bearer local-test-token');
    assert.equal(JSON.parse(body).message.token, 'device-token');
    if (responseMode === 'ok') return res.end('{"name":"projects/unit-test/messages/1"}');
    res.statusCode = responseMode === 'retry' ? 503 : 404;
    res.end(JSON.stringify({ error: { status: res.statusCode === 503 ? 'UNAVAILABLE' : 'NOT_FOUND', details: responseMode === 'gone' ? [{ errorCode: 'UNREGISTERED' }] : [] } }));
  });
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    const accountPath = path.join(tmp, 'account.json');
    fs.writeFileSync(accountPath, JSON.stringify({ project_id: 'unit-test', client_email: 'test@unit-test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: `${endpoint}/token` }));
    Object.assign(process.env, { FCM_SERVICE_ACCOUNT_FILE: accountPath, FCM_ENDPOINT: endpoint });
    delete process.env.FCM_PROJECT_ID;
    delete process.env.FCM_TOKEN_URI;
    const n = { id: 'n1', kind: 'assignment', title: 'Test' };
    assert.equal((await fcm.send('device-token', n)).ok, true);
    assert.equal((await fcm.send('device-token', n)).ok, true);
    assert.equal(oauthCount, 1);
    responseMode = 'project-missing';
    assert.equal((await fcm.send('device-token', n)).gone, undefined);
    responseMode = 'gone';
    assert.equal((await fcm.send('device-token', n)).gone, true);
    responseMode = 'retry';
    assert.equal((await fcm.send('device-token', n)).retry, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
