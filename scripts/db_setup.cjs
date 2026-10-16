// Creates the database, a least-privilege application role and applies migrations.
// Uses the administrative account from .env (DB_USER/DB_PASSWORD). The application role
// credentials (DB_APP_USER/DB_APP_PASSWORD) are generated once and appended to .env.
// Usage: npm run db:setup
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT = path.join(__dirname, '..');
const ENV = path.join(ROOT, '.env');
const { DB_HOST = 'localhost', DB_PORT = '5432', DB_NAME = 'rung_kontum', DB_USER, DB_PASSWORD } = process.env;
const APP_USER = process.env.DB_APP_USER || 'app_kontum';
const ident = (s) => `"${String(s).replace(/"/g, '""')}"`;

(async () => {
  if (!DB_USER) throw new Error('Thiếu DB_USER/DB_PASSWORD (tài khoản quản trị) trong .env');
  const admin = new Client({ host: DB_HOST, port: Number(DB_PORT), user: DB_USER, password: DB_PASSWORD, database: 'postgres' });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME]);
  if (!exists.rowCount) { await admin.query(`CREATE DATABASE ${ident(DB_NAME)} ENCODING 'UTF8' TEMPLATE template0`); console.log('Đã tạo database', DB_NAME); }

  let appPass = process.env.DB_APP_PASSWORD;
  const role = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [APP_USER]);
  if (!role.rowCount || !appPass) {
    appPass = appPass || crypto.randomBytes(18).toString('base64url');
    const q = role.rowCount ? 'ALTER' : 'CREATE';
    await admin.query(`${q} ROLE ${ident(APP_USER)} LOGIN PASSWORD '${appPass.replace(/'/g, "''")}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
    const env = fs.readFileSync(ENV, 'utf8');
    const lines = env.split(/\r?\n/).filter((l) => !/^DB_APP_(USER|PASSWORD)=/.test(l));
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    lines.push(`DB_APP_USER=${APP_USER}`, `DB_APP_PASSWORD=${appPass}`, '');
    fs.writeFileSync(ENV, lines.join('\n'));
    console.log(`Đã ${role.rowCount ? 'đặt lại mật khẩu' : 'tạo'} role ${APP_USER}; thông tin lưu trong .env`);
  }
  await admin.end();

  const db = new Client({ host: DB_HOST, port: Number(DB_PORT), user: DB_USER, password: DB_PASSWORD, database: DB_NAME });
  await db.connect();
  await db.query('CREATE TABLE IF NOT EXISTS public._bootstrap (x int)'); await db.query('DROP TABLE public._bootstrap');
  const dir = path.join(ROOT, 'db', 'migrations');
  await db.query('CREATE SCHEMA IF NOT EXISTS ops; CREATE TABLE IF NOT EXISTS ops.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    const done = await db.query('SELECT 1 FROM ops.schema_migrations WHERE name = $1', [f]);
    if (done.rowCount) continue;
    await db.query('BEGIN');
    try { await db.query(fs.readFileSync(path.join(dir, f), 'utf8')); await db.query('INSERT INTO ops.schema_migrations(name) VALUES ($1)', [f]); await db.query('COMMIT'); console.log('Áp dụng migration', f); }
    catch (e) { await db.query('ROLLBACK'); throw e; }
  }
  // least privilege: read/write data, no DDL; audit is insert/select only
  const schemas = ['identity', 'spatial', 'imagery', 'fire', 'ops', 'maps', 'mobile'];
  await db.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC`);
  await db.query(`GRANT CONNECT ON DATABASE ${ident(DB_NAME)} TO ${ident(APP_USER)}`);
  for (const s of schemas) {
    await db.query(`GRANT USAGE ON SCHEMA ${s} TO ${ident(APP_USER)}`);
    await db.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${s} TO ${ident(APP_USER)}`);
    await db.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ident(APP_USER)}`);
  }
  await db.query(`REVOKE UPDATE, DELETE ON identity.audit_logs FROM ${ident(APP_USER)}`);
  await db.query(`REVOKE UPDATE, DELETE ON maps.map_audit_logs FROM ${ident(APP_USER)}`);
  for (const s of schemas) await db.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${s} TO ${ident(APP_USER)}`);
  await db.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${ident(APP_USER)}`);
  const v = await db.query('SELECT postgis_full_version() AS v');
  console.log('PostGIS:', v.rows[0].v.split(' ').slice(0, 2).join(' '));
  await db.end();
  console.log('Hoàn tất. Khôi phục từ bản sao lưu (.dump): chạy tiếp npm run post-restore. CSDL trống (dựng từ dữ liệu gốc): chạy npm run db:import.');
})().catch((e) => { console.error('Lỗi:', e.message); process.exit(1); });
