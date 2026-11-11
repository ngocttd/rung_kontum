// Phiên bản ứng dụng MobileGIS mới nhất: quản trị khai báo (Cài đặt › Phiên bản ứng dụng), ứng dụng kiểm tra khi mở
// (GET /api/mobile/app-version) và nhận thông báo đẩy "Có phiên bản mới" khi quản trị bấm gửi.
const fs = require('fs');
const path = require('path');
const { paths } = require('../config');
const store = require('../data/store');

const FILE = path.join(paths.storage, 'app-release.json');
const VER = /^\d+\.\d+\.\d+$/;
const cmp = (a, b) => { const x = String(a).split('.').map(Number); const y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };
const urlOk = (u) => !u || /^https:\/\/[^\s]+$/i.test(u);

function get() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return null; } }
function set(user, b) {
  const version = String(b.version || '').trim(); const min = String(b.min_version || '').trim();
  if (!VER.test(version)) throw Object.assign(new Error('Phiên bản dạng x.y.z (ví dụ 1.2.0)'), { status: 400 });
  if (min && (!VER.test(min) || cmp(min, version) > 0)) throw Object.assign(new Error('Phiên bản tối thiểu dạng x.y.z và không lớn hơn phiên bản mới'), { status: 400 });
  if (!urlOk(b.android_url) || !urlOk(b.ios_url)) throw Object.assign(new Error('Liên kết tải phải là https://'), { status: 400 });
  const rel = { version, min_version: min || null, notes: String(b.notes || '').slice(0, 1000), android_url: b.android_url || null, ios_url: b.ios_url || null,
    published_at: new Date().toISOString(), published_by: user.username, notified_at: null };
  const prev = get();
  if (prev && prev.version === version) rel.notified_at = prev.notified_at;
  fs.writeFileSync(FILE, JSON.stringify(rel, null, 1));
  store.audit(user, 'app.release', version, { min_version: rel.min_version });
  return rel;
}
// trạng thái so với phiên bản ứng dụng đang chạy
function check(current) {
  const rel = get();
  if (!rel) return { latest: null, update: false, force: false };
  return { latest: rel.version, min_version: rel.min_version, notes: rel.notes, android_url: rel.android_url, ios_url: rel.ios_url, published_at: rel.published_at,
    update: VER.test(String(current || '')) ? cmp(rel.version, current) > 0 : false, force: Boolean(rel.min_version && VER.test(String(current || '')) && cmp(current, rel.min_version) < 0) };
}
async function notify(user) {
  const rel = get();
  if (!rel) throw Object.assign(new Error('Chưa khai báo phiên bản'), { status: 400 });
  const n = await require('./notifier').create({ source_ref: `app:${rel.version}`, kind: 'system', title: `MobileGIS có phiên bản mới ${rel.version}`,
    body: rel.notes || 'Cập nhật ứng dụng để dùng các chức năng mới và bản sửa lỗi.', data: { type: 'app_update', version: rel.version, android_url: rel.android_url, ios_url: rel.ios_url }, is_public: true, priority: 'normal' });
  rel.notified_at = new Date().toISOString(); fs.writeFileSync(FILE, JSON.stringify(rel, null, 1));
  store.audit(user, 'app.release.notify', rel.version, { created: Boolean(n) });
  return { created: Boolean(n), release: rel };
}

module.exports = { get, set, check, notify, cmp };
