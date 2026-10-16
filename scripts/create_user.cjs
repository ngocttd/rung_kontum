// Usage: npm run create-user -- <username> <admin|leader|specialist> ["Họ tên"]
// Prints a random temporary password once; it is stored only as a bcrypt hash.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const store = require('../src/data/store');
const { ROLES } = require('../src/middleware/security');

(async () => {
await store.init({ allowFallback: false }).catch((e) => { console.error('Không kết nối được database:', e.message); process.exit(1); });
const [username, role = 'admin', ...name] = process.argv.slice(2);
if (!username || !/^[a-z0-9._-]{3,40}$/.test(username) || !ROLES[role]) {
  console.error('Cách dùng: npm run create-user -- <tên_đăng_nhập> <admin|leader|specialist> ["Họ tên"]');
  process.exit(1);
}
if (store.find('users', (u) => u.username === username)) { console.error(`Tài khoản ${username} đã tồn tại.`); process.exit(1); }
const pass = crypto.randomBytes(9).toString('base64url');
store.insert('users', { username, name: name.join(' '), role, active: true, scope: null, password_hash: bcrypt.hashSync(pass, 11) });
store.audit(null, 'user.create_cli', username, { role });
await store.drain();
console.log(`Đã tạo ${username} (${ROLES[role]}) trong ${store.status().backend === 'pg' ? 'PostGIS' : 'storage/'}. Mật khẩu tạm: ${pass}`);
process.exit(0);
})();
