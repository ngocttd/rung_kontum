// PostgreSQL/PostGIS connection pool using the least-privilege application role.
const { Pool, types } = require('pg');
require('../config');

// Keep the app's string-based conventions: ISO timestamps, YYYY-MM-DD dates, numbers as numbers.
types.setTypeParser(1184, (v) => new Date(v).toISOString()); // timestamptz
types.setTypeParser(1114, (v) => new Date(`${v}Z`).toISOString()); // timestamp
types.setTypeParser(1082, (v) => v); // date
types.setTypeParser(20, (v) => Number(v)); // int8
types.setTypeParser(1700, (v) => Number(v)); // numeric

const enabled = Boolean(process.env.DB_NAME && (process.env.DB_APP_USER || process.env.DB_USER)) && process.env.DB_DISABLED !== '1';
let pool = null;
const ownPids = new Set();

function getPool() {
  if (!enabled) return null;
  if (!pool) {
    pool = new Pool({
      host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 5432), database: process.env.DB_NAME,
      user: process.env.DB_APP_USER || process.env.DB_USER, password: process.env.DB_APP_USER ? process.env.DB_APP_PASSWORD : process.env.DB_PASSWORD,
      max: Number(process.env.DB_POOL_MAX || 10), idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000, application_name: 'webgis-kontum',
    });
    pool.on('error', (e) => console.warn('[db] pool error:', e.message));
    // remember our own backend pids so change notifications caused by this process can be ignored
    pool.on('connect', (c) => { if (c.processID) ownPids.add(c.processID); });
  }
  return pool;
}

async function query(text, params) { const p = getPool(); if (!p) throw new Error('Database chưa được cấu hình'); return p.query(text, params); }

// Dedicated LISTEN connection (not pooled). Reconnects after errors.
function listen(channel, onMessage) {
  if (!enabled) return null;
  const { Client } = require('pg');
  let stopped = false;
  const connect = () => {
    const c = new Client({
      host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 5432), database: process.env.DB_NAME,
      user: process.env.DB_APP_USER || process.env.DB_USER, password: process.env.DB_APP_USER ? process.env.DB_APP_PASSWORD : process.env.DB_PASSWORD, application_name: 'webgis-kontum-listen',
    });
    const retry = () => { if (!stopped) setTimeout(connect, 5000).unref(); };
    c.on('error', () => { c.end().catch(() => {}); retry(); });
    c.on('notification', (n) => onMessage(n.payload));
    // unref: a listening socket must not keep CLI scripts that use the store alive
    c.connect().then(() => { if (c.connection && c.connection.stream && c.connection.stream.unref) c.connection.stream.unref(); return c.query(`LISTEN ${channel}`); }).catch(() => { c.end().catch(() => {}); retry(); });
    return c;
  };
  connect();
  return { stop: () => { stopped = true; } };
}

async function ping() {
  if (!enabled) return { ok: false, reason: 'disabled' };
  try {
    const r = await query("SELECT current_database() db, current_user usr, postgis_lib_version() postgis, pg_size_pretty(pg_database_size(current_database())) size");
    return { ok: true, ...r.rows[0] };
  } catch (e) { return { ok: false, reason: e.message }; }
}

module.exports = { enabled, getPool, query, ping, listen, ownPids };
