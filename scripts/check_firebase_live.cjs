// Kiểm tra Firebase thật bằng validate_only; không gửi thông báo tới người dùng.
// Không in API key, private key, OAuth token hoặc FCM token.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

async function main() {
  const filename = process.env.FCM_SERVICE_ACCOUNT_FILE;
  if (!filename) throw new Error('Chưa khai báo FCM_SERVICE_ACCOUNT_FILE.');
  const sa = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', filename), 'utf8'));
  const project = process.env.FCM_PROJECT_ID || sa.project_id;
  if (project !== sa.project_id) throw new Error('Project FCM không khớp service account.');
  const uri = 'https://oauth2.googleapis.com/token';
  const now = Math.floor(Date.now() / 1000);
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT', kid: sa.private_key_id })}.${b64({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: uri, iat: now, exp: now + 3600,
  })}`;
  const assertion = `${unsigned}.${crypto.sign('sha256', Buffer.from(unsigned), sa.private_key).toString('base64url')}`;
  const oauthResponse = await fetch(uri, {
    method: 'POST', signal: AbortSignal.timeout(20000),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const oauth = await oauthResponse.json();
  if (!oauthResponse.ok || !oauth.access_token) throw new Error(`OAuth HTTP ${oauthResponse.status}: ${oauth.error || 'không lấy được token'}`);
  console.log(`PASS: service account ${sa.client_email} ký JWT và lấy OAuth token được.`);
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(project)}/messages:send`, {
    method: 'POST', signal: AbortSignal.timeout(20000),
    headers: { authorization: `Bearer ${oauth.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ validate_only: true, message: {
      topic: 'kontum-configuration-check',
      notification: { title: 'Kiểm tra cấu hình MobileGIS', body: 'Chỉ xác thực, không giao thông báo.' },
      apns: { headers: { 'apns-push-type': 'alert', 'apns-priority': '10' }, payload: { aps: { sound: 'default' } } },
    } }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`FCM HTTP ${response.status}: ${result.error?.message || 'bị từ chối'}`);
  console.log(`PASS: FCM HTTP v1 xác thực payload và quyền gửi cho project ${project}.`);
  console.log('Chưa xác minh APNs hoặc khả năng nhận trên iPhone; cần thử token thiết bị thật/TestFlight.');
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
