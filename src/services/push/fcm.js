// Firebase Cloud Messaging – HTTP v1 API (Android + iOS; iOS đi qua APNs do Firebase chuyển tiếp).
// Cấu hình (.env), khoá đặt trong .secrets/ – KHÔNG commit:
//   FCM_SERVICE_ACCOUNT_FILE=.secrets/firebase-service-account.json   (Firebase console → Project settings → Service accounts → Generate new private key)
//   FCM_PROJECT_ID=<project-id>   (tuỳ chọn, mặc định lấy project_id trong tệp khoá)
// Máy chủ tự ký JWT RS256 → đổi lấy access token OAuth2 (phạm vi firebase.messaging, lưu đệm ~55 phút) → POST messages:send.
// FCM_ENDPOINT / FCM_TOKEN_URI: ghi đè địa chỉ (proxy nội bộ hoặc máy chủ giả lập khi kiểm thử).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ROOT } = require('../../config');

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
let account = null; let accountFile = null;
let cached = null; // { token, exp }

function serviceAccount() {
  const f = process.env.FCM_SERVICE_ACCOUNT_FILE;
  if (!f) return null;
  if (account && accountFile === f) return account;
  try {
    const j = JSON.parse(fs.readFileSync(path.resolve(ROOT, f), 'utf8'));
    if (!j.client_email || !j.private_key) return null;
    account = j; accountFile = f; cached = null;
    return account;
  } catch { return null; }
}
const projectId = () => process.env.FCM_PROJECT_ID || (serviceAccount() || {}).project_id || null;
function configured() { return Boolean(serviceAccount() && projectId()); }
function status() {
  if (!process.env.FCM_SERVICE_ACCOUNT_FILE) return { configured: false, reason: 'Chưa khai báo FCM_SERVICE_ACCOUNT_FILE' };
  if (!serviceAccount()) return { configured: false, reason: 'Không đọc được tệp khoá service account (thiếu client_email/private_key)' };
  return { configured: Boolean(projectId()), project_id: projectId(), client_email: serviceAccount().client_email };
}

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
async function accessToken() {
  if (cached && cached.exp - 120 > Date.now() / 1000) return cached.token;
  const sa = serviceAccount();
  const uri = process.env.FCM_TOKEN_URI || sa.token_uri || 'https://oauth2.googleapis.com/token';
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT', ...(sa.private_key_id ? { kid: sa.private_key_id } : {}) })}.${b64({ iss: sa.client_email, scope: SCOPE, aud: uri, iat: now, exp: now + 3600 })}`;
  const sig = crypto.sign('sha256', Buffer.from(unsigned), sa.private_key).toString('base64url');
  const r = await fetch(uri, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Không lấy được access token Google OAuth (${r.status}): ${j.error_description || j.error || 'không rõ'}`);
  cached = { token: j.access_token, exp: now + Number(j.expires_in || 3600) };
  return cached.token;
}

// FCM yêu cầu mọi giá trị trong data là chuỗi
function dataOf(n) {
  const d = { id: String(n.id), kind: String(n.kind || ''), priority: String(n.priority || 'normal'), link: JSON.stringify(n.data || {}) };
  for (const [k, v] of Object.entries(n.data || {})) if (v !== null && v !== undefined && !(k in d)) d[k] = typeof v === 'string' ? v : JSON.stringify(v);
  return d;
}

function message(token, n) {
  const high = n.priority === 'high';
  const ttl = n.expires_at ? Math.max(0, Math.floor((new Date(n.expires_at).getTime() - Date.now()) / 1000)) : 7 * 86400;
  const collapse = String(n.source_ref || n.id).slice(0, 64);
  return {
    token,
    notification: { title: String(n.title || 'MobileGIS Kon Tum').slice(0, 200), body: String(n.body || '').slice(0, 1000) },
    data: dataOf(n),
    android: {
      priority: high ? 'HIGH' : 'NORMAL', ttl: `${ttl}s`, collapse_key: collapse,
      notification: { channel_id: high ? 'canh_bao' : 'chung', tag: collapse, ...(high ? { notification_priority: 'PRIORITY_HIGH' } : {}) },
    },
    apns: {
      headers: { 'apns-priority': high ? '10' : '5', 'apns-collapse-id': collapse, ...(n.expires_at ? { 'apns-expiration': String(Math.floor(new Date(n.expires_at).getTime() / 1000)) } : {}) },
      payload: { aps: { sound: 'default', 'thread-id': String(n.kind || 'kontum'), ...(high ? { 'interruption-level': 'time-sensitive' } : {}) } },
    },
  };
}

// → { ok } | { ok:false, gone:true } (token hết hạn/gỡ app) | { ok:false, retry:true } | { ok:false, reason }
async function send(token, n) {
  if (!configured()) return { ok: false, reason: 'FCM chưa được cấu hình (FCM_SERVICE_ACCOUNT_FILE)' };
  let bearer;
  try { bearer = await accessToken(); } catch (e) { return { ok: false, retry: true, reason: e.message }; }
  const url = `${process.env.FCM_ENDPOINT || 'https://fcm.googleapis.com'}/v1/projects/${encodeURIComponent(projectId())}/messages:send`;
  let r;
  try {
    r = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: JSON.stringify({ message: message(token, n) }), signal: AbortSignal.timeout(15000) });
  } catch (e) { return { ok: false, retry: true, reason: `Lỗi mạng tới FCM: ${e.message}` }; }
  if (r.ok) return { ok: true };
  const j = await r.json().catch(() => ({}));
  const err = j.error || {};
  const code = ((err.details || []).find((d) => d.errorCode) || {}).errorCode || err.status || '';
  const reason = `FCM ${r.status} ${code}: ${err.message || ''}`.trim();
  if (r.status === 401) cached = null; // token OAuth hết hạn/bị thu hồi → lấy lại ở lần sau
  if (r.status === 404 || code === 'UNREGISTERED' || (r.status === 400 && /registration token/i.test(err.message || ''))) return { ok: false, gone: true, reason };
  if (r.status === 429 || r.status >= 500 || r.status === 401) return { ok: false, retry: true, reason };
  return { ok: false, reason };
}

module.exports = { configured, status, send, message, projectId };
