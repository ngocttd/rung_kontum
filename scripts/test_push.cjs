// Kiểm thử thông báo: PostgreSQL (nguồn sự thật, hàng đợi) + Socket.IO (ứng dụng đang mở) + Firebase Cloud Messaging (nền/đã đóng).
// Chạy khi máy chủ đang chạy (mặc định http://localhost:3000):  node scripts/test_push.cjs [BASE_URL]
//  - Socket.IO: nhận thông báo tức thời, xác nhận (ack) → bản FCM đang chờ bị huỷ (không báo trùng);
//  - ứng dụng đóng: bản giao FCM được xử lý (máy chủ chưa cấu hình FCM → "failed" có lý do, không thử lại vô hạn);
//  - FCM HTTP v1: máy chủ Google OAuth + FCM giả lập kiểm tra JWT RS256, access token, nội dung message, UNREGISTERED → ngừng gửi.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { io } = require('socket.io-client');
const { Client } = require('pg');

const BASE = process.argv[2] || 'http://localhost:3000';
let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) failures += 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (method, url, { token, body } = {}) => {
  const r = await fetch(BASE + url, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* */ }
  return { status: r.status, j };
};
const waitFor = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(300); } return null; };
const fakeToken = () => `${crypto.randomBytes(11).toString('base64url')}:APA91b${crypto.randomBytes(110).toString('base64url')}`;

(async () => {
  const admin = new Client({ host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'rung_kontum' });
  await admin.connect();
  const cleanup = { reports: [], devices: [], sockets: [] };
  let mock;
  try {
    const boot = (await call('GET', '/api/mobile/bootstrap')).j;
    ok(boot.push && boot.push.provider === 'fcm' && typeof boot.push.configured === 'boolean' && boot.realtime && boot.realtime.namespace === '/mobile', `Bootstrap: push qua FCM (máy chủ ${boot.push && boot.push.configured ? 'đã' : 'chưa'} cấu hình) + Socket.IO`);

    const login = async (role) => (await call('POST', '/api/mobile/auth/demo', { body: { role } })).j;
    const dan = await login('citizen'); const cb = await login('specialist'); const ld = await login('leader');
    const devDan = crypto.randomUUID(); const devCb = crypto.randomUUID();
    cleanup.devices.push(devDan, devCb);

    // đăng ký thiết bị bằng FCM registration token (Android, iOS)
    const regDan = await call('POST', '/api/mobile/devices', { token: dan.access_token, body: { device_id: devDan, platform: 'android', app_version: 'test', push_provider: 'fcm', push_endpoint: fakeToken() } });
    ok(regDan.status === 200 && regDan.j.push_provider === 'fcm' && regDan.j.push_enabled, 'Đăng ký thiết bị Android bằng FCM token');
    const badTok = await call('POST', '/api/mobile/devices', { token: cb.access_token, body: { device_id: devCb, platform: 'iOS', push_provider: 'fcm', push_endpoint: 'xyz' } });
    ok(badTok.status === 400, 'Từ chối FCM token sai định dạng');
    const oldCh = await call('POST', '/api/mobile/devices', { token: cb.access_token, body: { device_id: devCb, platform: 'iOS', push_provider: 'webpush', push_endpoint: 'https://example.org/x' } });
    ok(oldCh.status === 400, 'Từ chối kênh push cũ (webpush/apns)');
    await call('POST', '/api/mobile/devices', { token: cb.access_token, body: { device_id: devCb, platform: 'iOS', push_provider: 'fcm', push_endpoint: fakeToken() } });

    // ---------- Socket.IO ----------
    const inbox = { dan: [], cb: [] };
    const connect = (tok, dev, name) => new Promise((resolve, reject) => {
      const s = io(`${BASE}/mobile`, { path: '/socket.io', transports: ['websocket'], auth: { token: tok, device_id: dev }, reconnection: false });
      s.on('notification', (n, ack) => { inbox[name].push(n); if (typeof ack === 'function') ack({ ok: true }); });
      s.on('connect', () => resolve(s)); s.on('connect_error', reject);
      cleanup.sockets.push(s);
    });
    const sDan = await connect(dan.access_token, devDan, 'dan');
    const sCb = await connect(cb.access_token, devCb, 'cb');
    ok(sDan.connected && sCb.connected, 'Kết nối Socket.IO /mobile bằng token truy cập');
    const bad = await new Promise((r) => { const s = io(`${BASE}/mobile`, { path: '/socket.io', transports: ['websocket'], auth: { token: 'sai' }, reconnection: false }); s.on('connect', () => { s.close(); r(false); }); s.on('connect_error', (e) => { s.close(); r(/TOKEN/.test(e.message)); }); });
    ok(bad, 'Token sai bị từ chối khi kết nối socket');

    // phản ánh của người dân
    const loc = boot.communes[0].center;
    const rep = await call('POST', '/api/mobile/reports', { token: dan.access_token, body: { client_uuid: crypto.randomUUID(), type: 'chay-rung', description: 'Khói trên đồi (kiểm thử thông báo)', lat: loc[1], lon: loc[0] } });
    cleanup.reports.push(rep.j.report.code);

    // cán bộ xác minh phản ánh → hồ sơ chuyển "Đang xác minh" → người dân nhận qua Socket.IO, push bị huỷ
    const ver = await call('POST', '/api/mobile/verifications', { token: cb.access_token, body: { client_uuid: crypto.randomUUID(), alert_kind: 'report', alert_id: rep.j.report.code, verdict: 'confirmed', description: 'Có dấu vết đốt (kiểm thử thông báo)', lat: loc[1], lon: loc[0], gps_accuracy: 5 } });
    const got1 = await waitFor(() => inbox.dan.find((n) => n.kind === 'report' && n.title.includes(rep.j.report.code)));
    ok(got1 && /Đang xác minh/.test(got1.title), `Socket.IO giao thông báo tức thời: “${got1 && got1.title}”`);
    await sleep(5500);
    const d1 = (await admin.query(`SELECT d.channel, d.status FROM mobile.notification_deliveries d JOIN mobile.notifications n ON n.id = d.notification_id WHERE n.id = $1 AND d.device_id = $2`, [got1 && got1.id, devDan])).rows;
    if (process.env.DEBUG_PUSH) console.log('  deliveries:', JSON.stringify(d1));
    ok(d1.some((x) => x.channel === 'socket' && x.status === 'sent') && d1.some((x) => x.channel === 'fcm' && x.status === 'skipped'), 'Đã giao qua socket → bản FCM đang chờ được huỷ (không báo trùng)');

    // người dân đóng ứng dụng → lãnh đạo duyệt → thông báo vào hàng đợi FCM và được bộ gửi xử lý
    sDan.close();
    await sleep(500);
    const since = new Date();
    await call('POST', `/api/mobile/verifications/${ver.j.verification.id}/review`, { token: ld.access_token, body: { decision: 'approved', note: 'Đồng ý (kiểm thử thông báo)' } });
    const fcmRow = await waitFor(async () => (await admin.query(`SELECT d.status, d.last_error FROM mobile.notification_deliveries d JOIN mobile.notifications n ON n.id = d.notification_id
      WHERE d.device_id = $1 AND d.channel = 'fcm' AND d.status <> 'pending' AND n.created_at >= $2 ORDER BY d.created_at DESC LIMIT 1`, [devDan, since])).rows[0], 25000);
    ok(fcmRow && (boot.push.configured ? ['sent', 'gone', 'failed'].includes(fcmRow.status) : fcmRow.status === 'failed' && /chưa được cấu hình/.test(fcmRow.last_error || '')),
      `Ứng dụng đóng: bản giao FCM được xử lý (${fcmRow ? `${fcmRow.status}${fcmRow.last_error ? ` – ${fcmRow.last_error}` : ''}` : 'không thấy'})`);

    // cán bộ xác minh nhận kết quả duyệt qua socket
    const got2 = await waitFor(() => inbox.cb.find((n) => n.kind === 'verification'));
    ok(got2 && /được duyệt/.test(got2.title), 'Cán bộ nhận thông báo kết quả duyệt qua Socket.IO');

    // danh sách thông báo + đã đọc
    const feed = await call('GET', '/api/mobile/notifications', { token: dan.access_token });
    const mine = feed.j.items.filter((n) => n.link && n.link.code === rep.j.report.code);
    ok(mine.length >= 2, `Lịch sử thông báo lưu ở PostgreSQL (${mine.length} thông báo của hồ sơ)`);
    await call('POST', '/api/mobile/notifications/read', { token: dan.access_token, body: { ids: mine.map((n) => n.id) } });
    const feed2 = await call('GET', '/api/mobile/notifications', { token: dan.access_token });
    ok(feed2.j.items.filter((n) => n.link && n.link.code === rep.j.report.code).every((n) => n.read), 'Đánh dấu đã đọc');
    const guest = await call('GET', '/api/mobile/notifications');
    ok(!guest.j.items.some((n) => n.link && n.link.code === rep.j.report.code), 'Khách không thấy thông báo riêng của người dân');

    // dữ liệu thay đổi → socket phát "changed" để ứng dụng làm mới
    const changed = await new Promise((resolve) => { sCb.once('changed', (c) => resolve(c)); setTimeout(() => resolve(null), 8000); call('POST', '/api/mobile/reports', { token: dan.access_token, body: { client_uuid: crypto.randomUUID(), type: 'khac', description: 'Thay đổi dữ liệu (kiểm thử thông báo)', lat: loc[1], lon: loc[0] } }).then((r) => cleanup.reports.push(r.j.report.code)); });
    ok(changed && changed.collection === 'reports', 'Socket.IO phát sự kiện “changed” khi dữ liệu thay đổi (đồng bộ web ↔ mobile)');

    // ---------- FCM HTTP v1: Google OAuth + FCM giả lập ----------
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fcm-'));
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    let mode = 200; const seen = { oauth: [], send: [] };
    mock = http.createServer((req, res) => {
      const ch = []; req.on('data', (c) => ch.push(c));
      req.on('end', () => {
        const body = Buffer.concat(ch).toString();
        if (req.url === '/token') {
          const jwt = new URLSearchParams(body).get('assertion') || '';
          const [h, p, sig] = jwt.split('.');
          const valid = crypto.verify('sha256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(sig || '', 'base64url'));
          seen.oauth.push({ valid, claims: JSON.parse(Buffer.from(p || '', 'base64url').toString() || '{}') });
          res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ access_token: 'ya29.test-token', expires_in: 3599, token_type: 'Bearer' }));
          return;
        }
        seen.send.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(body || '{}') });
        if (mode === 200) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ name: 'projects/kontum-test/messages/1' })); return; }
        const err = mode === 404 ? { code: 404, status: 'NOT_FOUND', message: 'Requested entity was not found.', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } : { code: 503, status: 'UNAVAILABLE', message: 'try later' };
        res.writeHead(mode, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: err }));
      });
    });
    await new Promise((r) => mock.listen(0, '127.0.0.1', r));
    const mb = `http://127.0.0.1:${mock.address().port}`;
    fs.writeFileSync(path.join(tmp, 'sa.json'), JSON.stringify({ type: 'service_account', project_id: 'kontum-test', private_key_id: 'kid1', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), client_email: 'fcm@kontum-test.iam.gserviceaccount.com', token_uri: `${mb}/token` }));
    Object.assign(process.env, { FCM_SERVICE_ACCOUNT_FILE: path.join(tmp, 'sa.json'), FCM_ENDPOINT: mb });
    delete process.env.FCM_PROJECT_ID; delete process.env.FCM_TOKEN_URI;
    const fcm = require('../src/services/push/fcm');
    const tok = fakeToken();
    const r1 = await fcm.send(tok, { id: crypto.randomUUID(), source_ref: 'fd:test', kind: 'fire_danger', title: 'Cảnh báo cháy rừng Cấp IV', body: 'Kiểm thử', priority: 'high', data: { screen: 'fire', commune: '23284' } });
    const m = seen.send[0] && seen.send[0].body.message;
    ok(r1.ok && seen.oauth[0] && seen.oauth[0].valid && seen.oauth[0].claims.scope === 'https://www.googleapis.com/auth/firebase.messaging' && seen.oauth[0].claims.iss === 'fcm@kontum-test.iam.gserviceaccount.com', 'FCM: JWT RS256 hợp lệ đổi lấy access token OAuth2 (phạm vi firebase.messaging)');
    ok(seen.send[0] && seen.send[0].path === '/v1/projects/kontum-test/messages:send' && seen.send[0].auth === 'Bearer ya29.test-token', 'FCM: gọi HTTP v1 messages:send của đúng dự án, kèm access token');
    ok(m && m.token === tok && m.notification.title === 'Cảnh báo cháy rừng Cấp IV' && m.android.priority === 'HIGH' && m.android.notification.channel_id === 'canh_bao' && m.apns.headers['apns-priority'] === '10'
      && Object.values(m.data).every((v) => typeof v === 'string') && JSON.parse(m.data.link).screen === 'fire', 'FCM: nội dung message (notification, kênh Android, APNs, data dạng chuỗi)');
    await fcm.send(tok, { id: crypto.randomUUID(), kind: 'report', title: 'x' });
    ok(seen.oauth.length === 1 && seen.send.length === 2, 'FCM: dùng lại access token đã lưu đệm');
    mode = 404;
    const r2 = await fcm.send(tok, { id: crypto.randomUUID(), kind: 'report', title: 'x' });
    ok(!r2.ok && r2.gone, 'FCM 404 UNREGISTERED → đánh dấu thiết bị ngừng nhận');
    mode = 503;
    const r3 = await fcm.send(tok, { id: crypto.randomUUID(), kind: 'report', title: 'x' });
    ok(!r3.ok && r3.retry && !r3.gone, 'FCM 503 → thử lại sau (backoff)');
    fs.rmSync(tmp, { recursive: true, force: true });

    // quy tắc người nhận (công khai theo xã đăng ký / vai trò + địa bàn)
    const { matches } = require('../src/services/notifier');
    const pub = { is_public: true, target_communes: ['A'] };
    ok(matches(pub, { communes: [] }) && matches(pub, { communes: ['A', 'B'] }) && !matches(pub, { communes: ['B'] }), 'Cảnh báo công khai chỉ tới thiết bị theo dõi xã đó (hoặc theo dõi toàn vùng)');
    const task = { target_roles: ['specialist'], target_communes: ['A'] };
    ok(matches(task, { role: 'specialist', scope: 'A' }) && matches(task, { role: 'specialist', scope: null }) && !matches(task, { role: 'specialist', scope: 'B' }) && !matches(task, { role: 'citizen' }), 'Nhiệm vụ chưa giao chỉ tới cán bộ phụ trách xã');
  } catch (e) { console.error(e); failures += 1; } finally {
    for (const s of cleanup.sockets) s.close();
    if (mock) mock.close();
    // dọn dữ liệu thử (tài khoản quản trị DB vì bảng xác minh bất biến)
    await admin.query("DELETE FROM mobile.notifications WHERE data->>'code' = ANY($1) OR source_ref LIKE ANY($2)", [cleanup.reports, cleanup.reports.map((c) => `pa:${c}:%`)]).catch(() => {});
    await admin.query("DELETE FROM mobile.notifications WHERE kind = 'verification' AND body LIKE '%kiểm thử thông báo%'").catch(() => {});
    await admin.query('DELETE FROM mobile.mobile_devices WHERE id = ANY($1)', [cleanup.devices]).catch(() => {});
    await admin.end();
    await require('./purge_mobile_test.cjs')().catch((e) => console.warn('Dọn dữ liệu thử lỗi:', e.message));
    console.log(failures ? `\n${failures} kiểm tra lỗi` : '\nTất cả kiểm tra thông báo (Socket.IO + PostgreSQL + Firebase Cloud Messaging) đạt');
    process.exit(failures ? 1 : 0);
  }
})();
