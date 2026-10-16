// Kiểm thử thông báo không Firebase: PostgreSQL + Socket.IO + push theo nền tảng (Web Push/UnifiedPush, APNs).
// Chạy khi máy chủ đang chạy (mặc định http://localhost:3000):  node scripts/test_push.cjs [BASE_URL]
//  - Web Push: dịch vụ push giả lập nhận bản tin, GIẢI MÃ bằng khoá riêng của thuê bao (RFC 8291) để chứng minh mã hoá đúng;
//  - Socket.IO: nhận thông báo tức thời, xác nhận (ack) → bản push đang chờ bị huỷ (không báo trùng);
//  - APNs: máy chủ HTTP/2 giả lập kiểm tra chữ ký JWT ES256, apns-topic, mã 410 → thiết bị bị ngừng gửi.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const http = require('http');
const http2 = require('http2');
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

// ---------- giải mã Web Push aes128gcm (RFC 8188 / 8291) ----------
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
function decryptWebPush(body, uaPrivate, uaPublic, authSecret) {
  const salt = body.subarray(0, 16); const idlen = body[20]; const asPublic = body.subarray(21, 21 + idlen); const ct = body.subarray(21 + idlen);
  const ecdh = crypto.createECDH('prime256v1'); ecdh.setPrivateKey(uaPrivate);
  const secret = ecdh.computeSecret(asPublic);
  const ikm = hmac(hmac(authSecret, secret), Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  let end = plain.length - 1; while (end > 0 && plain[end] === 0) end -= 1; // bỏ đệm, ký tự phân cách 0x02
  return JSON.parse(plain.subarray(0, end).toString());
}

(async () => {
  const admin = new Client({ host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'rung_kontum' });
  await admin.connect();
  const cleanup = { reports: [], devices: [], sockets: [] };
  let mock; let h2;
  try {
    // ---------- dịch vụ Web Push giả lập ----------
    const received = [];
    mock = http.createServer((req, res) => { const ch = []; req.on('data', (c) => ch.push(c)); req.on('end', () => { received.push({ headers: req.headers, body: Buffer.concat(ch), path: req.url }); res.writeHead(201); res.end(); }); });
    await new Promise((r) => mock.listen(0, '127.0.0.1', r));
    const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
    const uaPub = ecdh.getPublicKey(); const uaPriv = ecdh.getPrivateKey(); const authSecret = crypto.randomBytes(16);

    const boot = (await call('GET', '/api/mobile/bootstrap')).j;
    ok(boot.push && boot.push.webpush_vapid_public_key && boot.realtime && boot.realtime.namespace === '/mobile', 'Bootstrap công bố khoá VAPID và Socket.IO (không Firebase)');

    const login = async (role) => (await call('POST', '/api/mobile/auth/demo', { body: { role } })).j;
    const dan = await login('citizen'); const cb = await login('specialist'); const ld = await login('leader');
    const devDan = crypto.randomUUID(); const devCb = crypto.randomUUID();
    cleanup.devices.push(devDan, devCb);

    // đăng ký thiết bị: người dân dùng Web Push (UnifiedPush), cán bộ dùng APNs (chưa cấu hình khoá → thất bại có lý do)
    const regDan = await call('POST', '/api/mobile/devices', { token: dan.access_token, body: { device_id: devDan, platform: 'android', app_version: 'test', push_provider: 'webpush', push_endpoint: `http://127.0.0.1:${mock.address().port}/up/${devDan}`, push_keys: { p256dh: uaPub.toString('base64url'), auth: authSecret.toString('base64url') } } });
    ok(regDan.status === 200 && regDan.j.push_provider === 'webpush', 'Đăng ký thiết bị Android với endpoint UnifiedPush/Web Push');
    const badApns = await call('POST', '/api/mobile/devices', { token: cb.access_token, body: { device_id: devCb, platform: 'iOS', push_provider: 'apns', push_endpoint: 'xyz' } });
    ok(badApns.status === 400, 'Từ chối APNs token sai định dạng');
    await call('POST', '/api/mobile/devices', { token: cb.access_token, body: { device_id: devCb, platform: 'iOS', push_provider: 'apns', push_endpoint: crypto.randomBytes(32).toString('hex'), push_env: 'sandbox' } });

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
    if (process.env.DEBUG_PUSH) console.log('  deliveries:', JSON.stringify(d1), 'webpush received:', received.length);
    ok(d1.some((x) => x.channel === 'socket' && x.status === 'sent') && d1.some((x) => x.channel === 'webpush' && x.status === 'skipped') && received.length === 0, 'Đã giao qua socket → bản Web Push đang chờ được huỷ (không báo trùng)');

    // người dân đóng ứng dụng → lãnh đạo duyệt → thông báo đi bằng Web Push, giải mã được
    sDan.close();
    await sleep(500);
    await call('POST', `/api/mobile/verifications/${ver.j.verification.id}/review`, { token: ld.access_token, body: { decision: 'approved', note: 'Đồng ý (kiểm thử thông báo)' } });
    const push = await waitFor(() => received.find((x) => x.path === `/up/${devDan}`), 25000);
    ok(push && push.headers['content-encoding'] === 'aes128gcm' && /vapid t=/.test(push.headers.authorization || ''), 'Ứng dụng ở nền: gửi Web Push mã hoá aes128gcm + chữ ký VAPID');
    let payload = null; try { payload = decryptWebPush(push.body, uaPriv, uaPub, authSecret); } catch (e) { console.error(e.message); }
    ok(payload && payload.kind === 'report' && payload.title.includes(rep.j.report.code), `Thiết bị giải mã được nội dung: “${payload && payload.title}”`);

    // cán bộ xác minh nhận kết quả duyệt qua socket
    const got2 = await waitFor(() => inbox.cb.find((n) => n.kind === 'verification'));
    ok(got2 && /được duyệt/.test(got2.title), 'Cán bộ nhận thông báo kết quả duyệt qua Socket.IO');

    // thiết bị iOS của cán bộ: APNs chưa cấu hình khoá → bản ghi giao thất bại có lý do, không thử lại vô hạn
    await sleep(1500);
    const iosRows = (await admin.query("SELECT status, last_error FROM mobile.notification_deliveries WHERE device_id = $1 AND channel = 'apns'", [devCb])).rows;
    ok(iosRows.every((r) => r.status === 'skipped' || (r.status === 'failed' && /chưa được cấu hình/.test(r.last_error || ''))) , 'APNs chưa cấu hình: đánh dấu thất bại có lý do (hoặc đã giao qua socket)');

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

    // ---------- APNs: máy chủ HTTP/2 giả lập ----------
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apns-'));
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    fs.writeFileSync(path.join(tmp, 'AuthKey_TEST.p8'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
    let mode = 200; const seen = [];
    h2 = http2.createServer();
    h2.on('stream', (stream, headers) => {
      let body = ''; stream.on('data', (c) => { body += c; });
      stream.on('end', () => {
        const [h, p, sig] = String(headers.authorization || '').replace('bearer ', '').split('.');
        const valid = crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig || '', 'base64url'));
        seen.push({ path: headers[':path'], topic: headers['apns-topic'], valid, body: JSON.parse(body || '{}') });
        stream.respond({ ':status': mode, 'content-type': 'application/json' });
        stream.end(mode === 200 ? '' : JSON.stringify({ reason: 'Unregistered' }));
      });
    });
    await new Promise((r) => h2.listen(0, '127.0.0.1', r));
    Object.assign(process.env, { APNS_KEY_FILE: path.join(tmp, 'AuthKey_TEST.p8'), APNS_KEY_ID: 'TESTKEY123', APNS_TEAM_ID: 'TEAM123456', APNS_BUNDLE_ID: 'vn.gov.kontum.kontumMobilegis', APNS_HOST: `http://127.0.0.1:${h2.address().port}` });
    const apns = require('../src/services/push/apns');
    const token = crypto.randomBytes(32).toString('hex');
    const r1 = await apns.send(token, { id: crypto.randomUUID(), kind: 'fire_danger', title: 'Cảnh báo cháy rừng Cấp IV', body: 'Kiểm thử', priority: 'high', data: { screen: 'fire' } });
    ok(r1.ok && seen[0].valid && seen[0].path === `/3/device/${token}` && seen[0].topic === 'vn.gov.kontum.kontumMobilegis' && seen[0].body.aps.alert.title === 'Cảnh báo cháy rừng Cấp IV', 'APNs: HTTP/2, JWT ES256 hợp lệ, đúng topic và nội dung');
    mode = 410;
    const r2 = await apns.send(token, { id: crypto.randomUUID(), kind: 'report', title: 'x' });
    ok(!r2.ok && r2.gone, 'APNs 410 Unregistered → đánh dấu thiết bị ngừng nhận');
    fs.rmSync(tmp, { recursive: true, force: true });

    // quy tắc người nhận (công khai theo xã đăng ký / vai trò + địa bàn)
    const { matches } = require('../src/services/notifier');
    const pub = { is_public: true, target_communes: ['A'] };
    ok(matches(pub, { communes: [] }) && matches(pub, { communes: ['A', 'B'] }) && !matches(pub, { communes: ['B'] }), 'Cảnh báo công khai chỉ tới thiết bị theo dõi xã đó (hoặc theo dõi toàn vùng)');
    const task = { target_roles: ['specialist'], target_communes: ['A'] };
    ok(matches(task, { role: 'specialist', scope: 'A' }) && matches(task, { role: 'specialist', scope: null }) && !matches(task, { role: 'specialist', scope: 'B' }) && !matches(task, { role: 'citizen' }), 'Nhiệm vụ chưa giao chỉ tới cán bộ phụ trách xã');
  } catch (e) { console.error(e); failures += 1; } finally {
    for (const s of cleanup.sockets) s.close();
    if (mock) mock.close(); if (h2) h2.close();
    // dọn dữ liệu thử (tài khoản quản trị DB vì bảng xác minh bất biến)
    await admin.query("DELETE FROM mobile.notifications WHERE data->>'code' = ANY($1) OR source_ref LIKE ANY($2)", [cleanup.reports, cleanup.reports.map((c) => `pa:${c}:%`)]).catch(() => {});
    await admin.query("DELETE FROM mobile.notifications WHERE kind = 'verification' AND body LIKE '%kiểm thử thông báo%'").catch(() => {});
    await admin.query('DELETE FROM mobile.mobile_devices WHERE id = ANY($1)', [cleanup.devices]).catch(() => {});
    await admin.end();
    await require('./purge_mobile_test.cjs')().catch((e) => console.warn('Dọn dữ liệu thử lỗi:', e.message));
    console.log(failures ? `\n${failures} kiểm tra lỗi` : '\nTất cả kiểm tra thông báo (Socket.IO + PostgreSQL + push nền tảng) đạt');
    process.exit(failures ? 1 : 0);
  }
})();
