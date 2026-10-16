// MobileGIS authentication (Đặc tả MobileGIS M02, mục 9): short-lived signed access token (15 min) +
// rotating refresh token (30 days) stored only as a SHA-256 hash in mobile.refresh_tokens.
// Logout revokes the refresh token and the access token's session id (TC12).
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../config');
const store = require('../data/store');
const db = require('../db/pool');
const { PERMISSIONS } = require('../middleware/security');

const ACCESS_TTL = 15 * 60; // s
const REFRESH_TTL_DAYS = 30;
const SECRET = crypto.createHmac('sha256', config.sessionSecret).update('mobile-access-token-v1').digest();
const b64 = (b) => Buffer.from(b).toString('base64url');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Demo quick login (đăng nhập nhanh theo vai trò): on in development, off in production unless MOBILE_DEMO_LOGIN=true.
const demoEnabled = () => (process.env.MOBILE_DEMO_LOGIN ? process.env.MOBILE_DEMO_LOGIN === 'true' : config.env !== 'production');
const DEMO_USERS = {
  citizen: { username: 'demo.nguoidan', name: 'Người dân (demo)', role: 'citizen', scope: null },
  specialist: { username: 'demo.canbo', name: 'Cán bộ kiểm lâm (demo)', role: 'specialist', scope: null },
  specialist_commune: { username: 'demo.canbo.xa', name: 'Cán bộ địa bàn xã (demo)', role: 'specialist', scope: '__first_commune__' },
  leader: { username: 'demo.lanhdao', name: 'Lãnh đạo (demo)', role: 'leader', scope: null },
  admin: { username: 'demo.quantri', name: 'Quản trị (demo)', role: 'admin', scope: null },
};

// ---------- refresh-token store (PostGIS; in-memory fallback when the DB is not configured) ----------
const mem = new Map();
async function saveRefresh(row) {
  if (!db.enabled) { mem.set(row.token_hash, row); return; }
  await db.query('INSERT INTO mobile.refresh_tokens (id, user_id, token_hash, device_id, expires_at) VALUES ($1,$2,$3,$4,$5)',
    [row.id, row.user_id, row.token_hash, row.device_id || null, row.expires_at]);
}
async function findRefresh(hash) {
  if (!db.enabled) return mem.get(hash) || null;
  return (await db.query('SELECT * FROM mobile.refresh_tokens WHERE token_hash = $1', [hash])).rows[0] || null;
}
async function revoke(where, val) {
  if (!db.enabled) { for (const r of mem.values()) if (r[where] === val) r.revoked_at = new Date(); return; }
  await db.query(`UPDATE mobile.refresh_tokens SET revoked_at = now() WHERE ${where === 'user_id' ? 'user_id' : 'id'} = $1 AND revoked_at IS NULL`, [val]);
}
// revoked session ids are checked on every request (cached briefly)
const sidCache = new Map();
async function sidActive(sid) {
  const c = sidCache.get(sid);
  if (c && c.at > Date.now() - 30e3) return c.ok;
  let ok;
  if (!db.enabled) ok = [...mem.values()].some((r) => r.id === sid && !r.revoked_at);
  else ok = Boolean((await db.query('SELECT 1 FROM mobile.refresh_tokens WHERE id = $1 AND revoked_at IS NULL', [sid])).rowCount);
  sidCache.set(sid, { at: Date.now(), ok });
  return ok;
}

function permissionsOf(role) { return Object.keys(PERMISSIONS).filter((p) => PERMISSIONS[p].includes(role)); }
function publicUser(u) { return { id: u.id, username: u.username, name: u.name, email: u.email || null, phone: u.phone || null, role: u.role, scope: u.scope || null, permissions: permissionsOf(u.role) }; }

function signAccess(u, sid) {
  const body = b64(JSON.stringify({ sub: u.id, role: u.role, scope: u.scope || null, sid, exp: Math.floor(Date.now() / 1000) + ACCESS_TTL }));
  return `${body}.${b64(crypto.createHmac('sha256', SECRET).update(body).digest())}`;
}
function verifyAccess(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const want = crypto.createHmac('sha256', SECRET).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() / 1000 ? p : null;
  } catch { return null; }
}

async function issue(u, deviceId) {
  const refresh = crypto.randomBytes(32).toString('base64url');
  const row = { id: crypto.randomUUID(), user_id: u.id, token_hash: sha(refresh), device_id: deviceId || null, expires_at: new Date(Date.now() + REFRESH_TTL_DAYS * 864e5) };
  await saveRefresh(row);
  store.update('users', u.id, { last_login: store.now() });
  return { access_token: signAccess(u, row.id), token_type: 'Bearer', expires_in: ACCESS_TTL, refresh_token: refresh, refresh_expires_at: row.expires_at.toISOString(), user: publicUser(u) };
}

// per-account lockout in addition to the per-IP limiter (TC02)
const fails = new Map();
const LOCK_MAX = 5; const LOCK_MS = 15 * 60e3;
function lockedFor(username) {
  const f = fails.get(username);
  if (!f || f.n < LOCK_MAX) return 0;
  const left = f.first + LOCK_MS - Date.now();
  if (left <= 0) { fails.delete(username); return 0; }
  return Math.ceil(left / 60e3);
}
function failed(username) {
  const f = fails.get(username);
  if (!f || f.first < Date.now() - LOCK_MS) fails.set(username, { n: 1, first: Date.now() }); else f.n += 1;
}

const norm = (s) => String(s || '').trim().toLowerCase();
async function login({ username, password, device_id: deviceId }) {
  await store.refresh('users').catch(() => {});
  const name = norm(username);
  const mins = lockedFor(name);
  if (mins) return { error: `Tài khoản tạm khoá do đăng nhập sai nhiều lần. Thử lại sau ${mins} phút.`, status: 429, code: 'LOCKED' };
  const u = store.find('users', (x) => x.username === name || (x.phone && x.phone === name) || (x.email && norm(x.email) === name));
  const ok = u && u.active && await bcrypt.compare(String(password || ''), u.password_hash);
  if (!ok) {
    failed(name);
    store.audit(null, 'mobile.auth.failed', name.slice(0, 60));
    const left = LOCK_MAX - (fails.get(name) || { n: 0 }).n;
    return { error: left > 0 ? `Tên đăng nhập hoặc mật khẩu không đúng (còn ${left} lần thử).` : 'Tài khoản tạm khoá 15 phút do đăng nhập sai nhiều lần.', status: left > 0 ? 401 : 429, code: left > 0 ? 'INVALID_CREDENTIALS' : 'LOCKED' };
  }
  fails.delete(name);
  store.audit({ username: u.username, role: u.role }, 'mobile.auth.login', u.username);
  return issue(u, deviceId);
}

async function register({ name, phone, email, password }) {
  const p = String(phone || '').replace(/[^\d+]/g, '');
  const e = norm(email);
  if (!String(name || '').trim()) return { error: 'Vui lòng nhập họ tên.', status: 400, code: 'VALIDATION' };
  if (!/^(\+?84|0)\d{9,10}$/.test(p) && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e)) return { error: 'Cần số điện thoại hoặc email hợp lệ.', status: 400, code: 'VALIDATION' };
  if (String(password || '').length < 8) return { error: 'Mật khẩu tối thiểu 8 ký tự.', status: 400, code: 'VALIDATION' };
  const username = p || e;
  await store.refresh('users').catch(() => {});
  if (store.find('users', (x) => x.username === username || (p && x.phone === p) || (e && norm(x.email) === e))) return { error: 'Số điện thoại/email đã được đăng ký.', status: 409, code: 'EXISTS' };
  const u = store.insert('users', { username, name: String(name).trim().slice(0, 120), phone: p || null, email: e || null, role: 'citizen', scope: null, active: true, password_hash: await bcrypt.hash(String(password), 11) });
  await store.drain();
  store.audit({ username, role: 'citizen' }, 'mobile.auth.register', username);
  return issue(u);
}

async function refresh({ refresh_token: token }) {
  const row = await findRefresh(sha(String(token || '')));
  if (!row) return { error: 'Phiên đăng nhập không hợp lệ.', status: 401, code: 'INVALID_REFRESH' };
  if (row.revoked_at) {
    // a rotated (already used) token is presented again → possible theft: end every session of the user
    await revoke('user_id', row.user_id);
    return { error: 'Phiên đăng nhập đã bị thu hồi.', status: 401, code: 'REVOKED' };
  }
  if (new Date(row.expires_at) < new Date()) return { error: 'Phiên đăng nhập đã hết hạn.', status: 401, code: 'EXPIRED' };
  const u = store.get('users', row.user_id);
  if (!u || !u.active) return { error: 'Tài khoản đã bị khoá.', status: 401, code: 'INACTIVE' };
  await revoke('id', row.id); sidCache.delete(row.id);
  return issue(u, row.device_id);
}

async function logout(auth, { refresh_token: token, all, device_id: deviceId } = {}) {
  if (all) await revoke('user_id', auth.sub);
  else await revoke('id', auth.sid);
  // thiết bị đã đăng xuất không nhận thông báo riêng của người dùng nữa (vẫn nhận cảnh báo công khai)
  if (db.enabled) {
    await db.query(`UPDATE mobile.mobile_devices SET user_id = NULL WHERE user_id = $1 AND (id = $2::uuid OR id IN (SELECT device_id FROM mobile.refresh_tokens WHERE id = $3 OR ($4 AND user_id = $1)))`,
      [auth.sub, /^[0-9a-f-]{36}$/i.test(String(deviceId || '')) ? deviceId : null, auth.sid, Boolean(all)]).catch(() => {});
  }
  if (token) { const row = await findRefresh(sha(String(token))); if (row && row.user_id === auth.sub) await revoke('id', row.id); }
  sidCache.clear();
  store.audit({ username: (store.get('users', auth.sub) || {}).username, role: auth.role }, 'mobile.auth.logout', all ? 'all' : auth.sid);
}

async function changePassword(auth, { current, password }) {
  const u = store.get('users', auth.sub);
  if (!u || !await bcrypt.compare(String(current || ''), u.password_hash)) return { error: 'Mật khẩu hiện tại không đúng.', status: 400, code: 'VALIDATION' };
  if (String(password || '').length < (u.role === 'citizen' ? 8 : 10)) return { error: 'Mật khẩu mới quá ngắn.', status: 400, code: 'VALIDATION' };
  store.update('users', u.id, { password_hash: await bcrypt.hash(String(password), 11) });
  await revoke('user_id', u.id); sidCache.clear(); // sign out every device
  store.audit({ username: u.username, role: u.role }, 'mobile.auth.change_password', u.username);
  return issue(u);
}

// Demo accounts are ordinary users with a random unusable password; quick login only when enabled.
async function ensureDemoUsers() {
  const repo = require('../data/repo');
  const first = repo.communes()[0];
  for (const d of Object.values(DEMO_USERS)) {
    if (store.find('users', (u) => u.username === d.username)) continue;
    store.insert('users', { ...d, scope: d.scope === '__first_commune__' ? (first ? first.code : null) : d.scope, demo: true, active: true, password_hash: await bcrypt.hash(crypto.randomBytes(18).toString('hex'), 10) });
  }
  await store.drain();
}
async function demoLogin({ role, device_id: deviceId }) {
  if (!demoEnabled()) return { error: 'Đăng nhập nhanh đã tắt trên máy chủ này.', status: 403, code: 'DEMO_DISABLED' };
  const d = DEMO_USERS[role];
  if (!d) return { error: 'Vai trò không hợp lệ.', status: 400, code: 'VALIDATION' };
  await ensureDemoUsers();
  const u = store.find('users', (x) => x.username === d.username && x.active);
  if (!u) return { error: 'Tài khoản demo đã bị khoá.', status: 403, code: 'INACTIVE' };
  store.audit({ username: u.username, role: u.role }, 'mobile.auth.demo_login', role);
  return issue(u, deviceId);
}
const demoRoles = () => Object.entries(DEMO_USERS).map(([key, d]) => ({ key, role: d.role, name: d.name, username: d.username }));

module.exports = { verifyAccess, sidActive, login, register, refresh, logout, changePassword, demoLogin, demoEnabled, demoRoles, ensureDemoUsers, publicUser, permissionsOf, ACCESS_TTL };
