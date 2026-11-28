// Tìm và tải ảnh Sentinel-2 theo yêu cầu: vùng (toàn vùng / xã / vùng khoanh), khoảng ngày, độ phủ mây tối đa,
// độ phân giải 10/20/30/60 m, sản phẩm (màu tự nhiên, giả màu, 6 kênh phản xạ, NDVI), hệ toạ độ → GeoTIFF.
// Chạy scripts/sentinel_export.py (Google Earth Engine) tuần tự trong hàng đợi; kết quả ở data/exports/sentinel/<id>/.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { paths, python } = require('../config');

const DIR = path.join(paths.data, 'exports', 'sentinel');
fs.mkdirSync(DIR, { recursive: true });
const SCRIPT = path.join(paths.scripts, 'sentinel_export.py');
const RES = [10, 20, 30, 60];
const PRODUCTS = { rgb: 'Màu tự nhiên (3 kênh, 8-bit)', false: 'Giả màu hồng ngoại B8-B4-B3 (8-bit)', bands: '6 kênh phản xạ B2, B3, B4, B8, B11, B12 (16-bit)', ndvi: 'Chỉ số NDVI (float32)' };
const KEEP_DAYS = 14;
class InputError extends Error {}
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const stateFile = (id) => path.join(DIR, id, 'state.json');
const save = (s) => fs.writeFileSync(stateFile(s.id), JSON.stringify(s, null, 1));
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

function config(b, aoi) {
  if (!isDate(b.from) || !isDate(b.to)) throw new InputError('Chọn khoảng ngày chụp.');
  if (b.to < b.from) throw new InputError('Ngày kết thúc phải sau ngày bắt đầu.');
  if ((new Date(b.to) - new Date(b.from)) / 864e5 > 366) throw new InputError('Khoảng ngày tối đa 12 tháng.');
  if (b.from < '2017-03-28') throw new InputError('Sentinel-2 SR có dữ liệu từ 28/3/2017.');
  const res = Number(b.resolution);
  if (!RES.includes(res)) throw new InputError('Độ phân giải phải là 10, 20, 30 hoặc 60 m.');
  const cloud = Math.min(100, Math.max(1, Number(b.cloud) || 60));
  const product = PRODUCTS[b.product] ? b.product : 'rgb';
  const scene = b.mode === 'scene';
  if (scene && !isDate(b.date)) throw new InputError('Chọn ngày chụp.');
  return { from: b.from, to: b.to, cloud, resolution: res, aoi, product, mode: scene ? 'scene' : 'median', date: scene ? b.date : undefined, crs: b.crs || 'EPSG:32648' };
}

function py(args, timeout, onLine) {
  return new Promise((resolve) => {
    const c = spawn(python, [SCRIPT, ...args], { cwd: paths.scripts, env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, windowsHide: true });
    let out = ''; let err = '';
    const t = setTimeout(() => c.kill(), timeout);
    c.stdout.on('data', (d) => { out += d; if (onLine) String(d).split(/\r?\n/).filter(Boolean).forEach(onLine); });
    c.stderr.on('data', (d) => { err += d; });
    c.on('close', () => { clearTimeout(t); let j = null; try { j = JSON.parse(out.trim().split('\n').pop()); } catch { j = { ok: false, error: err.split('\n').filter((l) => l && !/Warn|PROJ|import crypt/.test(l)).pop() || 'Không chạy được công cụ tải ảnh' }; } resolve(j); });
    c.on('error', (e) => resolve({ ok: false, error: e.message }));
  });
}

async function search(cfg) {
  const tmp = path.join(os.tmpdir(), `kt-s2-${crypto.randomUUID()}.json`);
  fs.writeFileSync(tmp, JSON.stringify(cfg));
  try { const r = await py(['search', tmp], 120000); if (!r.ok) throw new InputError(r.error); return r; } finally { fs.rmSync(tmp, { force: true }); }
}

const queue = []; let running = null;
function create(user, cfg, label) {
  const id = crypto.randomUUID();
  fs.mkdirSync(path.join(DIR, id), { recursive: true });
  const s = { id, status: 'queued', cfg, label, created_by: user.username, created_at: new Date().toISOString(), log: [] };
  save(s); queue.push(id); setImmediate(next);
  return s;
}
function next() {
  if (running || !queue.length) return;
  const id = queue.shift(); const s = readJson(stateFile(id));
  if (!s) { next(); return; }
  running = id; s.status = 'running'; s.started_at = new Date().toISOString(); save(s);
  const cfgFile = path.join(DIR, id, 'config.json'); fs.writeFileSync(cfgFile, JSON.stringify(s.cfg));
  py(['export', cfgFile, path.join(DIR, id)], 40 * 60e3, (l) => { if (!l.startsWith('{')) { s.progress = l; save(s); } }).then((r) => {
    const cur = readJson(stateFile(id)) || s;
    cur.status = r.ok ? 'succeeded' : 'failed'; cur.result = r.ok ? r : null; cur.error = r.ok ? null : r.error; cur.finished_at = new Date().toISOString(); delete cur.progress;
    save(cur); running = null; next();
  });
}
function list() {
  const out = [];
  for (const d of fs.readdirSync(DIR)) {
    const s = readJson(stateFile(d));
    if (!s) continue;
    // dọn tệp cũ để không đầy đĩa
    if (['succeeded', 'failed'].includes(s.status) && Date.now() - new Date(s.finished_at || s.created_at) > KEEP_DAYS * 864e5) { fs.rmSync(path.join(DIR, d), { recursive: true, force: true }); continue; }
    out.push(s);
  }
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
}
function get(id) { return /^[0-9a-f-]{36}$/.test(id) ? readJson(stateFile(id)) : null; }
function file(id, kind) {
  const s = get(id);
  if (!s || s.status !== 'succeeded') return null;
  const f = path.join(DIR, id, kind === 'preview' ? 'preview.png' : s.result.file);
  return fs.existsSync(f) ? { path: f, name: kind === 'preview' ? 'preview.png' : s.result.file } : null;
}
function remove(id) { const s = get(id); if (!s || s.status === 'running') return false; fs.rmSync(path.join(DIR, id), { recursive: true, force: true }); return true; }
function start() { for (const s of list()) if (['queued', 'running'].includes(s.status)) { s.status = 'failed'; s.error = 'Bị gián đoạn do khởi động lại máy chủ – tạo lại yêu cầu.'; s.finished_at = new Date().toISOString(); save(s); } }

module.exports = { RES, PRODUCTS, KEEP_DAYS, InputError, config, search, create, list, get, file, remove, start };
