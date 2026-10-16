// Apple Push Notification service (APNs) – gửi trực tiếp qua HTTP/2 với khoá token (.p8), không qua Firebase.
// Cấu hình (.env, không commit khoá):
//   APNS_KEY_FILE=.secrets/AuthKey_XXXXXXXXXX.p8   APNS_KEY_ID=XXXXXXXXXX   APNS_TEAM_ID=YYYYYYYYYY
//   APNS_BUNDLE_ID=vn.gov.kontum.kontumMobilegis    APNS_ENV=production|sandbox (mặc định theo thiết bị đăng ký)
const fs = require('fs');
const path = require('path');
const http2 = require('http2');
const crypto = require('crypto');
const { ROOT } = require('../../config');

const HOSTS = { production: 'https://api.push.apple.com', sandbox: 'https://api.sandbox.push.apple.com' };
let key = null;
let jwtCache = { token: null, at: 0 };
const sessions = {};

function configured() {
  return Boolean(process.env.APNS_KEY_FILE && process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_BUNDLE_ID);
}

function signingKey() {
  if (!key) key = crypto.createPrivateKey(fs.readFileSync(path.resolve(ROOT, process.env.APNS_KEY_FILE)));
  return key;
}

// JWT ES256, dùng lại tối đa 50 phút (Apple yêu cầu làm mới trong 20–60 phút)
function providerToken() {
  if (jwtCache.token && Date.now() - jwtCache.at < 50 * 60e3) return jwtCache.token;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'ES256', kid: process.env.APNS_KEY_ID })}.${b64({ iss: process.env.APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) })}`;
  const sig = crypto.sign('sha256', Buffer.from(unsigned), { key: signingKey(), dsaEncoding: 'ieee-p1363' }).toString('base64url');
  jwtCache = { token: `${unsigned}.${sig}`, at: Date.now() };
  return jwtCache.token;
}

function session(env) {
  const s = sessions[env];
  if (s && !s.closed && !s.destroyed) return s;
  const n = http2.connect(process.env.APNS_HOST || HOSTS[env]); // APNS_HOST: proxy nội bộ hoặc máy chủ giả lập khi kiểm thử
  n.on('error', () => { delete sessions[env]; });
  n.on('goaway', () => { delete sessions[env]; });
  n.setTimeout(10 * 60e3, () => n.close());
  sessions[env] = n;
  return n;
}

/**
 * Gửi một thông báo tới thiết bị iOS.
 * @returns {Promise<{ok: boolean, gone?: boolean, status?: number, reason?: string}>}
 */
function send(deviceToken, notification, { env } = {}) {
  if (!configured()) return Promise.resolve({ ok: false, reason: 'APNs chưa được cấu hình (APNS_KEY_FILE, APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID)' });
  const e = env || process.env.APNS_ENV || 'production';
  const body = JSON.stringify({
    aps: { alert: { title: notification.title, body: notification.body || '' }, sound: 'default', 'thread-id': notification.kind, 'interruption-level': notification.priority === 'high' ? 'time-sensitive' : 'active' },
    data: { id: notification.id, kind: notification.kind, ...(notification.data || {}) },
  });
  return new Promise((resolve) => {
    let req;
    try {
      req = session(e).request({
        ':method': 'POST', ':path': `/3/device/${deviceToken}`,
        authorization: `bearer ${providerToken()}`, 'apns-topic': process.env.APNS_BUNDLE_ID, 'apns-push-type': 'alert',
        'apns-priority': notification.priority === 'high' ? '10' : '5', 'apns-id': notification.id, 'apns-collapse-id': String(notification.source_ref || notification.id).slice(0, 64),
        ...(notification.expires_at ? { 'apns-expiration': String(Math.floor(new Date(notification.expires_at).getTime() / 1000)) } : {}),
        'content-type': 'application/json',
      });
    } catch (err) { resolve({ ok: false, reason: err.message }); return; }
    let status = 0; let data = '';
    req.setTimeout(15000, () => { req.close(); resolve({ ok: false, reason: 'timeout' }); });
    req.on('response', (h) => { status = h[':status']; });
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      if (status === 200) return resolve({ ok: true, status });
      let reason = ''; try { reason = JSON.parse(data).reason; } catch { reason = data; }
      // thiết bị gỡ ứng dụng / token hết hiệu lực → ngừng gửi
      const gone = status === 410 || ['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic'].includes(reason);
      return resolve({ ok: false, gone, status, reason });
    });
    req.on('error', (err) => resolve({ ok: false, reason: err.message }));
    req.end(body);
  });
}

module.exports = { configured, send };
