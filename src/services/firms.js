// Server-side NASA FIRMS refresh (Area API) with a strict transaction budget.
// Limit: 5000 transactions / 10 minutes per MAP_KEY. This job uses ~10–15 per run (FIRMS weights requests by day range):
//  - 1 mapkey_status check (skipped run if the key is already busy, e.g. shared with other apps)
//  - 4 small bbox requests (one per sensor), day_range 2, merged into a rolling 7-day cache
// Runs every FIRMS_REFRESH_MINUTES (default 30, minimum 10); page views never call FIRMS.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../config');
const { paths } = config;
const { geometryContains, bbox } = require('../lib/geo');
const db = require('../db/pool');

const KEY = process.env.FIRMS_MAP_KEY || '';
const MINUTES = Math.max(10, Number(process.env.FIRMS_REFRESH_MINUTES || 30));
const BUDGET_SHARE = 0.5; // skip the run if more than half of the 10-minute budget is already used
const SOURCES = { J1_VIIRS: 'VIIRS_NOAA20_NRT', J2_VIIRS: 'VIIRS_NOAA21_NRT', SUOMI_VIIRS: 'VIIRS_SNPP_NRT', MODIS: 'MODIS_NRT' };
const DIR = path.join(paths.collected, 'firms');
const STATUS = path.join(paths.storage, 'firms-status.json');

let running = false;
let backoffUntil = 0;
let failures = 0;

const aoi = JSON.parse(fs.readFileSync(path.join(paths.boundaries, 'kon-tum-historical-province.geojson'), 'utf8')).features[0].geometry;
const [W, S, E, N] = bbox(aoi).map((v, i) => Math.round((v + (i < 2 ? -0.02 : 0.02)) * 1000) / 1000);

function readStatus() { try { return JSON.parse(fs.readFileSync(STATUS, 'utf8')); } catch { return {}; } }
function writeJson(file, obj) { const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(obj, null, 1)); fs.renameSync(tmp, file); }

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 1 || !lines[0].includes('latitude')) throw new Error(`Phản hồi FIRMS không hợp lệ: ${lines[0].slice(0, 120)}`);
  const head = lines.shift().split(',');
  return lines.filter(Boolean).map((l) => Object.fromEntries(l.split(',').map((v, i) => [head[i], v])));
}

async function get(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (res.status === 429) { const e = new Error('FIRMS 429 – vượt hạn mức'); e.rate = true; throw e; }
  if (!res.ok) throw new Error(`FIRMS HTTP ${res.status}`);
  return res.text();
}

async function keyStatus() {
  const t = await get(`https://firms.modaps.eosdis.nasa.gov/mapserver/mapkey_status/?MAP_KEY=${KEY}`);
  return JSON.parse(t);
}

function idOf(sensor, p) { return `${sensor}-${p.acq_date}-${String(p.acq_time).padStart(4, '0')}-${Number(p.latitude).toFixed(4)}-${Number(p.longitude).toFixed(4)}`; }

async function refresh({ force = false } = {}) {
  if (!KEY || running) return readStatus();
  if (!force && Date.now() < backoffUntil) return readStatus();
  running = true;
  const st = { ...readStatus(), last_attempt: new Date().toISOString() };
  try {
    const ks = await keyStatus();
    st.key = { limit: ks.transaction_limit, used: ks.current_transactions, interval: ks.transaction_interval, checked_at: new Date().toISOString() };
    if (ks.current_transactions > ks.transaction_limit * BUDGET_SHARE) throw Object.assign(new Error(`Key đang dùng ${ks.current_transactions}/${ks.transaction_limit}; bỏ qua lượt này`), { rate: true });
    const cutoff = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    let added = 0;
    for (const [sensor, source] of Object.entries(SOURCES)) {
      const rows = parseCsv(await get(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${KEY}/${source}/${W},${S},${E},${N}/2`));
      const file = path.join(DIR, `${sensor}-kon-tum-7d.geojson`);
      let fc; try { fc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { fc = { type: 'FeatureCollection', features: [] }; }
      const byId = new Map(fc.features.filter((f) => f.properties.acq_date >= cutoff).map((f) => [idOf(sensor, f.properties), f]));
      for (const r of rows) {
        const lon = Number(r.longitude); const lat = Number(r.latitude);
        if (!geometryContains(aoi, lon, lat)) continue;
        const id = idOf(sensor, r);
        if (!byId.has(id)) added += 1;
        const conf = { l: 'low', n: 'nominal', h: 'high' }[r.confidence] || r.confidence; // VIIRS letters; MODIS stays 0–100
        byId.set(id, { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { ...r, confidence: conf, verification_status: 'unverified', source_sensor: sensor, source_api: source } });
      }
      writeJson(file, { type: 'FeatureCollection', features: [...byId.values()].sort((a, b) => `${b.properties.acq_date}${b.properties.acq_time}`.localeCompare(`${a.properties.acq_date}${a.properties.acq_time}`)) });
      await new Promise((r) => setTimeout(r, 1500)); // spread requests
    }
    Object.assign(st, { collected_at: new Date().toISOString(), added, ok: true, error: null, bbox: [W, S, E, N], transactions_per_run: '10–15' });
    if (added) require('./realtime').broadcast('alerts'); // điểm nóng mới → bản đồ web/app làm mới ngay
    failures = 0; backoffUntil = 0;
    const toDb = () => { if (db.enabled) require('../db/sync').run(['hotspots']).catch((e) => console.warn('[firms] lưu DB lỗi:', e.message)); };
    if (added) spawn(config.python, ['tag_hotspots.py'], { cwd: paths.scripts, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }).on('close', toDb).on('error', toDb);
    else toDb();
  } catch (e) {
    failures += 1;
    // exponential backoff: 10, 20, 40 … max 240 minutes; rate-limit errors wait at least one full window
    const wait = Math.min(240, 10 * 2 ** (failures - 1)) * 60e3;
    backoffUntil = Date.now() + (e.rate ? Math.max(wait, 11 * 60e3) : wait);
    Object.assign(st, { ok: false, error: e.message, retry_after: new Date(backoffUntil).toISOString() });
    console.warn('[firms]', e.message);
  } finally {
    writeJson(STATUS, st);
    running = false;
  }
  return st;
}

function start() {
  if (!KEY) return;
  const st = readStatus();
  const age = st.collected_at ? Date.now() - new Date(st.collected_at).getTime() : Infinity;
  setTimeout(refresh, age > MINUTES * 60e3 ? 5000 : MINUTES * 60e3 - age).unref(); // no burst on frequent restarts
  setInterval(refresh, MINUTES * 60e3).unref();
}

function status() { return { enabled: Boolean(KEY), interval_minutes: MINUTES, ...readStatus(), backoff_until: backoffUntil ? new Date(backoffUntil).toISOString() : null }; }

module.exports = { start, refresh, status };
