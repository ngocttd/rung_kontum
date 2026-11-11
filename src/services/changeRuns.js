// Phân tích biến động rừng theo thời gian tuỳ chọn: mỗi lần chạy là một "kỳ phân tích" (store 'change_runs').
// Chạy scripts/analyze_change_custom.py (cùng thuật toán với luồng tự động), lưu kết quả ở data/web/change-runs/<id>/.
// Kết quả chỉ hiện ra bản đồ công khai / trang Biến động / MobileGIS sau khi người có quyền (alerts.approve) công bố.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const sharp = require('sharp');
const { paths, python, ROOT } = require('../config');
const store = require('../data/store');

const DIR = path.join(paths.data, 'web', 'change-runs');
fs.mkdirSync(DIR, { recursive: true });
const SCRIPT = path.join(paths.scripts, 'analyze_change_custom.py');
class InputError extends Error {}

const ym = (v) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || '')) ? String(v) : null);
const mIdx = (s) => { const [y, m] = s.split('-').map(Number); return y * 12 + m - 1; };
const fmtYm = (s) => `${s.slice(5)}/${s.slice(0, 4)}`;

function validate(b) {
  const from = ym(b.from); const to = ym(b.to);
  if (!from || !to) throw new InputError('Chọn tháng bắt đầu và kết thúc của kỳ phân tích.');
  if (mIdx(to) < mIdx(from)) throw new InputError('Tháng kết thúc phải sau tháng bắt đầu.');
  if (mIdx(to) - mIdx(from) > 11) throw new InputError('Kỳ phân tích tối đa 12 tháng.');
  if (mIdx(from) < mIdx('2024-01')) throw new InputError('Chuỗi ảnh Sentinel-2 bắt đầu từ 01/2024.');
  // kỳ đối chứng và ngưỡng do hệ thống tự xác định (người dùng không cần chuyên môn):
  // đối chứng = cùng các tháng của 1–2 năm trước có ảnh; ngưỡng tự thích nghi theo dữ liệu của kỳ (analyze_change_custom.py)
  const y0 = Number(from.slice(0, 4));
  if (y0 < 2025) throw new InputError('Kỳ năm 2024 chưa có năm trước để so sánh cùng kỳ (chuỗi ảnh bắt đầu 01/2024) – chọn kỳ từ 2025.');
  const baseline = { mode: 'years', years: [y0 - 2, y0 - 1].filter((y) => y >= 2024) };
  const thresholds = 'auto';
  const title = `${fmtYm(from)}${from !== to ? `–${fmtYm(to)}` : ''} so với cùng kỳ ${baseline.years.join(', ')}`;
  return { period: { from, to }, baseline, thresholds, title, note: String(b.note || '').slice(0, 500) };
}

// chạy tuần tự (Python nặng): hàng đợi trong tiến trình
const queue = []; let running = null;
function create(user, body) {
  const p = validate(body);
  const code = store.nextCode('PT');
  const run = store.insert('change_runs', { code, title: p.title, status: 'queued', params: p, summary: null, published: false, created_by: user.username, log: [],
    publish_on_finish: Boolean(body.publish_now && body.canApprove) ? user.username : null });
  store.audit(user, 'change_run.create', code, p);
  queue.push(run.id); setImmediate(next);
  return run;
}

function next() {
  if (running || !queue.length) return;
  const id = queue.shift(); const run = store.get('change_runs', id);
  if (!run) { next(); return; }
  running = id;
  const dir = path.join(DIR, id); fs.mkdirSync(dir, { recursive: true });
  const cfg = path.join(dir, 'config.json');
  fs.writeFileSync(cfg, JSON.stringify({ ...run.params, id_prefix: `CR-${run.code.replace(/^PT-/, '').replace('-', '')}` }));
  store.update('change_runs', id, { status: 'running', started_at: store.now() });
  const log = [];
  const child = spawn(python, [SCRIPT, cfg, dir], { cwd: paths.scripts, env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, windowsHide: true });
  const onData = (b) => { log.push(...b.toString('utf8').split(/\r?\n/).filter(Boolean)); if (log.length > 200) log.splice(0, log.length - 200); };
  child.stdout.on('data', onData); child.stderr.on('data', onData);
  const timer = setTimeout(() => { log.push('! quá 20 phút – dừng'); child.kill(); }, 20 * 60e3);
  child.on('close', async (code) => {
    clearTimeout(timer);
    let summary = null;
    try { summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8')); } catch { /* lỗi */ }
    if (code === 0 && summary) {
      try { await sharp(path.join(dir, 'overlay.png'), { limitInputPixels: false }).webp({ quality: 85, alphaQuality: 90 }).toFile(path.join(dir, 'overlay.webp')); fs.unlinkSync(path.join(dir, 'overlay.png')); } catch (e) { log.push(`! ảnh lớp: ${e.message}`); }
    }
    const ok = code === 0 && summary;
    store.update('change_runs', id, { status: ok ? 'succeeded' : 'failed', summary, finished_at: store.now(), log: log.filter((l) => !/Warning|warn|_ureduce/.test(l)).slice(-60) });
    if (ok && run.publish_on_finish) { try { publish(id, { username: run.publish_on_finish }, true, 'Công bố ngay khi chạy xong (chọn khi tạo)'); } catch (e) { console.warn('[change-runs]', e.message); } }
    running = null; next();
  });
  child.on('error', (e) => { log.push(e.message); });
}

function list() { return store.all('change_runs').slice().sort((a, b) => b.created_at.localeCompare(a.created_at)); }
function get(id) { return store.get('change_runs', id); }
function candidates(run) {
  try { return JSON.parse(fs.readFileSync(path.join(DIR, run.id, 'candidates.geojson'), 'utf8')); } catch { return { type: 'FeatureCollection', features: [] }; }
}
function overlayFile(id) { const f = path.join(DIR, id, 'overlay.webp'); return fs.existsSync(f) ? f : null; }

function publish(id, user, on, note) {
  const r = get(id);
  if (!r) throw new InputError('Không tìm thấy kỳ phân tích.');
  if (on && r.status !== 'succeeded') throw new InputError('Chỉ công bố kỳ phân tích đã chạy thành công.');
  store.update('change_runs', id, on ? { published: true, published_by: user.username, published_at: store.now(), publish_note: note || null } : { published: false, unpublished_by: user.username, unpublished_at: store.now(), publish_note: note || null });
  store.audit(user, on ? 'change_run.publish' : 'change_run.unpublish', r.code, { note });
}
function remove(id, user) {
  const r = get(id);
  if (!r) return;
  if (r.published) throw new InputError('Thu hồi công bố trước khi xoá.');
  if (r.status === 'running') throw new InputError('Đang chạy – chờ xong rồi xoá.');
  store.remove('change_runs', id);
  fs.rmSync(path.join(DIR, id), { recursive: true, force: true });
  store.audit(user, 'change_run.delete', r.code);
}

// các kỳ đã công bố (dùng cho bản đồ công khai, trang Biến động, MobileGIS)
function published() { return list().filter((r) => r.published && r.status === 'succeeded' && r.summary); }

// tiến trình khởi động lại giữa chừng: kỳ đang chạy/đợi coi như lỗi để chạy lại
function start() {
  for (const r of store.all('change_runs')) if (['queued', 'running'].includes(r.status)) store.update('change_runs', r.id, { status: 'failed', log: [...(r.log || []), '! bị gián đoạn do khởi động lại máy chủ – chạy lại'] });
  auto.ensure();
}

// ---------- kết quả phân tích TỰ ĐỘNG (tác vụ theo lịch forest-change) ----------
// Script ghi bản mới vào data/web/change-candidates.geojson + overlay 'change-latest' (bản nháp).
// Bản công khai là bản sao đã duyệt: change-candidates.public.geojson + change-latest.public.webp.
// Chế độ 'auto': tự công bố ngay sau mỗi lần chạy; 'review': chờ người có quyền bấm công bố.
const WEB = path.join(paths.data, 'web');
const OV = path.join(ROOT, 'public', 'generated', 'overlays');
const STATE = path.join(paths.storage, 'change-auto.json');
const readJ = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const auto = {
  state() { return { mode: 'review', ...(readJ(STATE) || {}) }; },
  save(s) { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(s, null, 1)); },
  draft() {
    const fc = readJ(path.join(WEB, 'forest-change.json'));
    const ov = (readJ(path.join(WEB, 'overlays.json')) || []).find((o) => o.id === 'change-latest') || null;
    return { generated_at: fc && fc.generated_at_utc, windows: fc && fc.candidates ? fc.candidates.windows : [], latest_month: fc && fc.candidates ? fc.candidates.latest_month : null, overlay: ov };
  },
  pending() { const s = this.state(); const d = this.draft(); return Boolean(d.generated_at && d.generated_at !== s.approved_generated_at); },
  setMode(mode, user) { const s = this.state(); s.mode = mode === 'auto' ? 'auto' : 'review'; s.mode_by = user.username; s.mode_at = store.now(); this.save(s); store.audit(user, 'change_auto.mode', s.mode); },
  approve(user, note) {
    const d = this.draft();
    if (!d.generated_at) throw new InputError('Chưa có kết quả phân tích tự động.');
    fs.copyFileSync(path.join(WEB, 'change-candidates.geojson'), path.join(WEB, 'change-candidates.public.geojson'));
    const src = path.join(OV, 'change-latest.webp');
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(OV, 'change-latest.public.webp'));
    const s = this.state();
    Object.assign(s, { approved_generated_at: d.generated_at, approved_by: user.username, approved_at: store.now(), approved_note: note || null, windows: d.windows, latest_month: d.latest_month,
      overlay: d.overlay && fs.existsSync(src) ? { ...d.overlay, url: '/generated/overlays/change-latest.public.webp' } : null });
    this.save(s);
    store.audit(user, 'change_auto.publish', d.generated_at, { windows: (d.windows || []).length, note });
  },
  // sau mỗi lần tác vụ tự động chạy xong
  onGenerated() {
    const s = this.state();
    if (s.mode === 'auto') this.approve({ username: 'scheduler', role: 'system' }, 'Tự công bố theo chế độ tự động');
    else store.audit({ username: 'scheduler', role: 'system' }, 'change_auto.pending', this.draft().generated_at);
  },
  // lần đầu (bản cài đặt cũ chưa có bản công khai): coi kết quả hiện có là đã công bố để không làm mất dữ liệu đang hiển thị
  ensure() { if (!readJ(STATE) && fs.existsSync(path.join(WEB, 'change-candidates.geojson'))) this.approve({ username: 'system', role: 'system' }, 'Khởi tạo từ kết quả đang công bố'); },
  publicCandidates() { return readJ(path.join(WEB, 'change-candidates.public.geojson')) || { type: 'FeatureCollection', features: [] }; },
};

module.exports = { InputError, validate, create, list, get, candidates, overlayFile, publish, remove, published, start, auto, DIR };
