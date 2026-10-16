// Runtime records (users, field reports, articles, verification decisions, audit log, jobs, layers).
// Two backends behind one synchronous API:
//  - 'pg'   : PostgreSQL/PostGIS (default when DB is configured). Records are cached in memory and every
//             change is written through, in order, to the database; failed writes are retried.
//  - 'json' : JSON files under storage/ (fallback when the DB is disabled/unreachable, and for tests).
// Call `await store.init()` before serving requests.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { paths } = require('../config');
const db = require('../db/pool');

fs.mkdirSync(paths.storage, { recursive: true });
fs.mkdirSync(paths.uploads, { recursive: true });

const collections = {};
const mtimes = {};
let backend = 'json';
let pg = null;
const queue = [];
let flushing = false;
let lastError = null;
let retryTimer = null;
const rejected = []; // writes the database refused as invalid (shown in admin settings)

function file(name) { return path.join(paths.storage, `${name}.json`); }
function mtimeOf(name) { try { return fs.statSync(file(name)).mtimeMs; } catch { return 0; } }

function load(name) {
  if (backend === 'pg') {
    if (!collections[name]) collections[name] = [];
    return collections[name];
  }
  // JSON: reload when another process (e.g. scripts/create_user.cjs) changed the file.
  const m = mtimeOf(name);
  if (!collections[name] || m !== mtimes[name]) {
    try { collections[name] = JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { collections[name] = []; }
    mtimes[name] = m;
  }
  return collections[name];
}

function writeJsonFile(name) {
  const tmp = `${file(name)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(collections[name], null, 1));
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file(name)); break; } catch (e) {
      if (i >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { fs.copyFileSync(tmp, file(name)); fs.unlinkSync(tmp); break; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40); // brief retry while a sync client holds the file
    }
  }
  mtimes[name] = mtimeOf(name);
}

// ---------- PostgreSQL write-through queue ----------
async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    while (queue.length) {
      const op = queue[0];
      try {
        if (op.type === 'upsert') await pg.upsert(op.name, op.rec);
        else await pg.remove(op.name, op.id);
        queue.shift();
        lastError = null;
      } catch (e) {
        lastError = { at: new Date().toISOString(), message: e.message, op: `${op.type} ${op.name}` };
        // invalid data (SQLSTATE 22xxx/23xxx: duplicate key, constraint) never succeeds on retry: set it aside so the
        // queue keeps flowing, and reload the collection so the cache matches what the database really holds
        if (/^(2[23]|P0001)/.test(String(e.code || ''))) {
          queue.shift();
          rejected.push({ ...lastError, code: e.code, id: op.rec ? op.rec.id : op.id });
          if (rejected.length > 50) rejected.shift();
          console.warn('[store] bỏ qua bản ghi không hợp lệ:', op.type, op.name, e.message);
          await refresh(op.name).catch(() => {});
          continue;
        }
        console.warn('[store] ghi DB lỗi, sẽ thử lại:', e.message);
        clearTimeout(retryTimer);
        retryTimer = setTimeout(flush, 5000);
        retryTimer.unref();
        break;
      }
    }
  } finally {
    flushing = false;
    if (!queue.length) waiters.splice(0).forEach((w) => w());
  }
}
const waiters = [];
function enqueue(op) { queue.push(op); setImmediate(flush); }

function persist(name, row, removedId) {
  if (backend === 'pg') {
    if (removedId) enqueue({ type: 'remove', name, id: removedId });
    else enqueue({ type: 'upsert', name, rec: JSON.parse(JSON.stringify(row)) });
  } else writeJsonFile(name);
}

async function init({ allowFallback = true, watch = true } = {}) {
  if (!db.enabled) { backend = 'json'; return status(); }
  try {
    pg = require('../db/pgstore');
    for (const name of Object.keys(pg.MAP)) collections[name] = await pg.loadCollection(name);
    backend = 'pg';
    if (watch) watchChanges();
  } catch (e) {
    if (!allowFallback) throw e;
    console.warn('[store] Không kết nối được PostGIS, dùng JSON:', e.message);
    lastError = { at: new Date().toISOString(), message: e.message, op: 'init' };
    backend = 'json';
    Object.keys(collections).forEach((k) => delete collections[k]);
  }
  return status();
}

// Cross-process sync: PostgreSQL NOTIFY 'store_changed' (migration 005) → reload the affected collection,
// so writes from another server instance, the CLI or test scripts appear on the web and in MobileGIS at once.
const pendingRefresh = new Map();
function watchChanges() {
  if (backend !== 'pg' || watching) return;
  const byTable = Object.fromEntries(Object.entries(pg.MAP).map(([k, m]) => [m.table, k]));
  watching = db.listen('store_changed', (payload) => {
    const [table, pid] = String(payload).split(':');
    const name = byTable[table];
    if (!name || db.ownPids.has(Number(pid))) return;
    clearTimeout(pendingRefresh.get(name));
    const run = () => refresh(name).then(() => { if (queue.some((o) => o.name === name)) pendingRefresh.set(name, setTimeout(run, 2000)); }).catch(() => {});
    pendingRefresh.set(name, setTimeout(run, 300)); // debounce bursts of writes
  });
}
let watching = null;

// Re-read one collection from the DB (e.g. users created by the CLI while the server runs).
async function refresh(name) {
  if (backend !== 'pg' || queue.some((o) => o.name === name)) return;
  collections[name] = await pg.loadCollection(name);
}

function drain() { return queue.length ? new Promise((r) => { waiters.push(r); flush(); }) : Promise.resolve(); }
function status() { return { backend, pending: queue.length, lastError, rejected: rejected.slice(-10) }; }

// ---------- API ----------
const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

function all(name) { return load(name); }
function find(name, pred) { return load(name).find(pred) || null; }
function get(name, id) { return find(name, (r) => r.id === id); }
function filter(name, pred) { return load(name).filter(pred); }

function insert(name, record) {
  const row = { id: uuid(), created_at: now(), updated_at: now(), ...record };
  load(name).push(row);
  persist(name, row);
  return row;
}

function update(name, id, patch) {
  const row = get(name, id);
  if (!row) return null;
  Object.assign(row, patch, { updated_at: now() });
  persist(name, row);
  return row;
}

function remove(name, id) {
  const rows = load(name);
  const i = rows.findIndex((r) => r.id === id);
  if (i < 0) return false;
  rows.splice(i, 1);
  persist(name, null, id);
  return true;
}

// Key/value decisions keyed by an external id (e.g. a FIRMS hotspot or change candidate).
function getDecision(kind, refId) {
  return find('decisions', (d) => d.kind === kind && d.ref_id === refId);
}

function setDecision(kind, refId, patch, user) {
  const existing = getDecision(kind, refId);
  const entry = { at: now(), by: user ? user.username : null, ...patch };
  if (existing) {
    existing.history = [...(existing.history || []), entry];
    return update('decisions', existing.id, { ...patch, history: existing.history });
  }
  return insert('decisions', { kind, ref_id: refId, ...patch, history: [entry] });
}

function audit(user, action, target, detail) {
  insert('audit', { user: user ? user.username : 'anonymous', role: user ? user.role : null, action, target: target === undefined ? null : String(target), detail: detail || null });
}

// Sequential human-readable codes such as PA-2026-0007.
function nextCode(prefix) {
  const counters = load('counters');
  const year = new Date().getFullYear();
  const key = `${prefix}-${year}`;
  let c = counters.find((x) => x.key === key);
  if (!c) { c = { id: key, key, value: 0 }; counters.push(c); }
  c.value += 1;
  persist('counters', c);
  return `${prefix}-${year}-${String(c.value).padStart(4, '0')}`;
}

module.exports = { init, refresh, drain, status, all, find, get, filter, insert, update, remove, getDecision, setDecision, audit, nextCode, now };
