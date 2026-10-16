// Web Push (RFC 8030/8291/8292, VAPID) – dùng chung cho Android qua UnifiedPush (bộ phân phối như ntfy,
// không cần Google Play Services/Firebase) và cho trình duyệt (PWA). Nội dung được mã hoá đầu-cuối.
// Khoá VAPID: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY trong .env; nếu chưa có sẽ tự sinh và lưu storage/.vapid.json (không commit).
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const { paths } = require('../../config');

let keys = null;
function vapid() {
  if (keys) return keys;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else {
    const file = path.join(paths.storage, '.vapid.json');
    try { keys = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {
      keys = webpush.generateVAPIDKeys();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
    }
  }
  return keys;
}

const subject = () => process.env.VAPID_SUBJECT || 'mailto:kiemlam@kontum.gov.vn';
const publicKey = () => vapid().publicKey;

/**
 * @param {{endpoint: string, keys: {p256dh: string, auth: string}}} sub
 * @returns {Promise<{ok: boolean, gone?: boolean, status?: number, reason?: string}>}
 */
async function send(sub, notification) {
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return { ok: false, gone: true, reason: 'Thiếu khoá mã hoá Web Push' };
  const payload = JSON.stringify({ id: notification.id, kind: notification.kind, title: notification.title, body: notification.body || '', data: notification.data || {}, priority: notification.priority, at: notification.created_at });
  try {
    const ttl = notification.expires_at ? Math.max(60, Math.floor((new Date(notification.expires_at) - Date.now()) / 1000)) : 24 * 3600;
    // web-push lo mã hoá (aes128gcm) + chữ ký VAPID; gửi bằng fetch để kiểm soát thời gian chờ
    const req = webpush.generateRequestDetails(sub, payload, {
      vapidDetails: { subject: subject(), publicKey: vapid().publicKey, privateKey: vapid().privateKey },
      TTL: Math.min(ttl, 7 * 24 * 3600), urgency: notification.priority === 'high' ? 'high' : 'normal', topic: String(notification.kind).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32),
    });
    const r = await fetch(req.endpoint, { method: req.method, headers: req.headers, body: req.body, signal: AbortSignal.timeout(15000) });
    if (r.ok) return { ok: true, status: r.status };
    const text = (await r.text().catch(() => '')).slice(0, 300);
    return { ok: false, gone: r.status === 404 || r.status === 410, status: r.status, reason: text || `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, reason: (e.message || String(e)).slice(0, 300) };
  }
}

module.exports = { send, publicKey };
