// Chạy SAU khi khôi phục bản sao lưu CSDL lên máy chủ mới (VPS):
//  - xoá phiên đăng nhập di động, thiết bị, hàng đợi thông báo, sự kiện đồng bộ của môi trường cũ;
//  - khoá tài khoản demo (đăng nhập nhanh) trừ khi --keep-demo;
//  - đặt MẬT KHẨU MỚI ngẫu nhiên cho mọi tài khoản cán bộ/quản trị còn hoạt động (mật khẩu cũ không bàn giao),
//    ghi vào storage/initial-admin.txt (chỉ quản trị máy chủ đọc) và in ra màn hình một lần.
// Usage: node scripts/post_restore.cjs [--keep-demo] [--keep-passwords]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT = path.join(__dirname, '..');
const args = new Set(process.argv.slice(2));

(async () => {
  const { DB_HOST = 'localhost', DB_PORT = '5432', DB_NAME = 'rung_kontum', DB_USER, DB_PASSWORD } = process.env;
  if (!DB_USER) throw new Error('Thiếu DB_USER/DB_PASSWORD (tài khoản quản trị PostgreSQL) trong .env');
  const c = new Client({ host: DB_HOST, port: Number(DB_PORT), user: DB_USER, password: DB_PASSWORD, database: DB_NAME });
  await c.connect();
  const out = [];
  try {
    await c.query('BEGIN');
    for (const t of ['mobile.notification_deliveries', 'mobile.notification_receipts', 'mobile.notifications', 'mobile.mobile_sync_events', 'mobile.refresh_tokens', 'mobile.mobile_devices']) {
      // bảng chưa có (bản sao lưu cũ hơn migration) thì bỏ qua – không để lỗi làm hỏng cả giao dịch
      if (!(await c.query('SELECT to_regclass($1) AS t', [t])).rows[0].t) continue;
      const r = await c.query(`DELETE FROM ${t}`);
      out.push(`  xoá ${t}: ${r.rowCount}`);
    }
    if (!args.has('--keep-demo')) {
      const r = await c.query("UPDATE identity.users SET active = false, updated_at = now() WHERE username LIKE 'demo.%' AND active");
      out.push(`  khoá tài khoản demo: ${r.rowCount}`);
    }
    const creds = [];
    if (!args.has('--keep-passwords')) {
      const users = (await c.query("SELECT id, username, role FROM identity.users WHERE active AND role IN ('admin','leader','specialist') AND username NOT LIKE 'demo.%' ORDER BY role, username")).rows;
      for (const u of users) {
        const pass = crypto.randomBytes(12).toString('base64url');
        await c.query('UPDATE identity.users SET password_hash = $2, updated_at = now() WHERE id = $1', [u.id, bcrypt.hashSync(pass, 11)]);
        creds.push(`${u.username} (${u.role}): ${pass}`);
      }
    }
    await c.query('COMMIT');
    await c.query(`INSERT INTO identity.audit_logs (id, username, role, action, target, detail, created_at) VALUES ($1, 'system', NULL, 'system.post_restore', $2, $3, now())`,
      [crypto.randomUUID(), require('os').hostname(), JSON.stringify({ reset_passwords: creds.length })]).catch(() => {});
    if (creds.length) {
      const file = path.join(ROOT, 'storage', 'initial-admin.txt');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `Mật khẩu tạm sau khi khôi phục (${new Date().toISOString()}). Đổi ngay sau lần đăng nhập đầu, rồi xoá tệp này.\n${creds.join('\n')}\n`, { mode: 0o600 });
      out.push(`  đặt mật khẩu mới: ${creds.length} tài khoản → storage/initial-admin.txt`);
    }
    console.log(['Đã chuẩn hoá CSDL sau khôi phục:', ...out].join('\n'));
    if (creds.length) console.log(`\nTài khoản đăng nhập web quản trị (mật khẩu tạm – đổi ngay):\n  ${creds.join('\n  ')}`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { await c.end(); }
})().catch((e) => { console.error('Lỗi:', e.message); process.exit(1); });
