// Python worker jobs (whitelisted). Each run is recorded with parameters, status, log tail and duration,
// so analyses can be re-run and audited from the admin (A05). A scheduler runs them automatically so
// monitoring and warnings stay current without manual runs; schedules are edited in /quan-tri/phan-tich.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { paths, python, enableDataJobs, ROOT } = require('../config');
const store = require('../data/store');

// optional: a failed download (no network, GEE quota) is logged and the job goes on with the data already on disk
const JOBS = {
  'update-forecast': {
    title: 'Cập nhật khí tượng Open-Meteo và chỉ số nguy cơ cháy (P Nesterov, FWI)',
    steps: [{ script: 'collect_openmeteo.py', optional: true }, { script: 'tag_hotspots.py' }, { script: 'build_fire_danger.py' }],
    db: ['hotspots', 'danger'], every: 3, note: 'Dự báo thời tiết theo giờ thay đổi nhiều lần mỗi ngày',
  },
  'update-era5': {
    title: 'Cập nhật tái phân tích ERA5-Land (GEE) và tính lại chuỗi nguy cơ cháy',
    steps: [{ script: 'collect_hourly_weather.py', optional: true, timeout: 90 }, { script: 'prepare_forecast_inputs.py' }, { script: 'build_fire_danger.py' }],
    db: ['danger'], every: 24, note: 'ERA5-Land có độ trễ khoảng 5 ngày, cập nhật 1 lần/ngày là đủ',
  },
  'forest-change': {
    title: 'Ảnh Sentinel-2 tháng mới, biến động nghi vấn và dự báo nguy cơ mất rừng',
    steps: [{ script: 'collect_monitoring_series.py', optional: true, timeout: 120 }, { script: 'build_forest_change.py', timeout: 120 }, { script: 'build_latest_overlay.py' }, { script: 'to_webp.cjs' }],
    db: ['change'], every: 168, note: 'Ảnh tổng hợp theo tháng; chạy hằng tuần để nhận tháng mới ngay khi đủ ảnh',
  },
  'web-data': {
    title: 'Dựng lại lớp ảnh bản đồ, ranh giới và danh mục tài liệu',
    steps: [{ script: 'build_web_data.py' }, { script: 'build_latest_overlay.py' }, { script: 'to_webp.cjs' }, { script: 'build_tiles.py', timeout: 60 }],
    db: ['boundaries', 'statistics'], every: 0, note: 'Chạy khi dữ liệu nền thay đổi',
  },
};
const PERIODS = [1, 3, 6, 12, 24, 72, 168, 720];
const RETRY_MIN = 30; const MAX_RETRIES = 3;
const SCHED_FILE = path.join(ROOT, 'storage', 'scheduler.json');

let current = null;
let child = null;

function runStep(step, log) {
  return new Promise((resolve) => {
    const isNode = step.script.endsWith('.cjs');
    child = spawn(isNode ? process.execPath : python, [step.script], {
      cwd: paths.scripts, env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, windowsHide: true,
    });
    const onData = (b) => { log.push(...b.toString('utf8').split(/\r?\n/).filter(Boolean)); if (log.length > 400) log.splice(0, log.length - 400); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => { log.push(`! quá thời gian ${step.timeout || 60} phút – dừng`); child.kill(); }, (step.timeout || 60) * 60e3);
    child.on('close', (code) => { clearTimeout(timer); child = null; resolve(code); });
    child.on('error', (e) => { clearTimeout(timer); log.push(e.message); resolve(-1); });
  });
}

async function run(key, user, { trigger = 'manual' } = {}) {
  const def = JOBS[key];
  if (!def) throw new Error('Job không hợp lệ');
  if (current) throw new Error('Đang có job khác chạy');
  const job = store.insert('jobs', { key, title: def.title, status: 'running', started_at: store.now(), by: user ? user.username : 'scheduler', trigger, log: [] });
  current = job.id;
  (async () => {
    const log = [];
    let ok = true; const warnings = [];
    const t0 = Date.now();
    for (const step of def.steps) {
      log.push(`$ ${step.script}`);
      const code = await runStep(step, log);
      store.update('jobs', job.id, { log: log.slice(-200) });
      if (code !== 0) {
        log.push(`! exit ${code}`);
        if (step.optional) { warnings.push(step.script); log.push('  (bước thu thập lỗi – tiếp tục với dữ liệu đã có)'); continue; }
        ok = false; break;
      }
    }
    if (ok && def.db && require('../db/pool').enabled) {
      log.push(`$ đồng bộ PostGIS: ${def.db.join(', ')}`);
      try { log.push(JSON.stringify(await require('../db/sync').run(def.db))); } catch (e) { ok = false; log.push(`! DB: ${e.message}`); }
    }
    store.update('jobs', job.id, { status: ok ? 'succeeded' : 'failed', finished_at: store.now(), duration_s: Math.round((Date.now() - t0) / 1000), warnings, log: log.slice(-200) });
    current = null;
  })();
  return job;
}

function list() { return store.all('jobs').slice().sort((a, b) => b.created_at.localeCompare(a.created_at)); }

// ---------- scheduler ----------
function readSchedule() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(SCHED_FILE, 'utf8')); } catch { /* defaults */ }
  return Object.fromEntries(Object.entries(JOBS).map(([k, d]) => {
    const s = saved[k] || {};
    const every = PERIODS.includes(Number(s.every)) ? Number(s.every) : d.every;
    return [k, { enabled: s.enabled !== undefined ? Boolean(s.enabled) && every > 0 : d.every > 0, every: every || 0, updated_by: s.updated_by, updated_at: s.updated_at }];
  }));
}

function saveSchedule(next, user) {
  const cur = readSchedule();
  for (const k of Object.keys(JOBS)) {
    if (!next[k]) continue;
    const every = PERIODS.includes(Number(next[k].every)) ? Number(next[k].every) : cur[k].every;
    cur[k] = { enabled: Boolean(next[k].enabled) && every > 0, every, updated_by: user.username, updated_at: new Date().toISOString() };
  }
  fs.mkdirSync(path.dirname(SCHED_FILE), { recursive: true });
  fs.writeFileSync(SCHED_FILE, JSON.stringify(cur, null, 1));
  return cur;
}

// next due time: a full period after the last start; after a failure retry in 30 min (at most 3 times in a row)
function plan() {
  const sched = readSchedule(); const all = list();
  return Object.fromEntries(Object.keys(JOBS).map((k) => {
    const runs = all.filter((j) => j.key === k);
    const last = runs[0]; const lastOk = runs.find((j) => j.status === 'succeeded');
    let fails = 0; for (const j of runs) { if (j.status === 'failed') fails += 1; else break; }
    const s = sched[k]; let next = null;
    if (s.enabled) {
      if (!last) next = bootAt + 2 * 60e3;
      else if (last.status === 'running') next = null;
      else if (last.status === 'failed' && fails <= MAX_RETRIES) next = new Date(last.finished_at || last.started_at).getTime() + RETRY_MIN * 60e3;
      else next = new Date(last.started_at).getTime() + s.every * 3600e3;
    }
    return [k, { ...s, last, lastOk, fails, next: next ? new Date(next).toISOString() : null }];
  }));
}

let ticking = null; const bootAt = Date.now();
function tick() {
  if (current) return;
  const p = plan(); const now = Date.now();
  // forecast first: warnings depend on it
  const due = Object.keys(JOBS).filter((k) => p[k].enabled && p[k].next && new Date(p[k].next).getTime() <= now);
  if (due.length) run(due[0], null, { trigger: 'schedule' }).catch(() => {});
}

// On by default; ENABLE_DATA_JOBS=false turns all automatic runs off (e.g. a read-only mirror).
function startScheduler() {
  // a run cut off by a restart is closed as failed so it can be retried
  for (const j of store.all('jobs').filter((x) => x.status === 'running')) store.update('jobs', j.id, { status: 'failed', finished_at: store.now(), log: [...(j.log || []), '! bị gián đoạn do khởi động lại máy chủ'] });
  if (!enableDataJobs) return;
  ticking = setInterval(tick, 60e3); ticking.unref();
}

module.exports = {
  JOBS, PERIODS, run, list, plan, readSchedule, saveSchedule, startScheduler,
  schedulerOn: () => Boolean(ticking), isRunning: () => Boolean(current), scriptsDir: path.resolve(paths.scripts),
};
