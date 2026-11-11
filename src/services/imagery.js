// Ảnh vệ tinh: danh mục tháng Sentinel-2, dựng ảnh hiển thị theo yêu cầu (so sánh, tải xuống) và phân loại ảnh có
// giám sát (scripts/classify_landcover.py – Random Forest học từ mẫu thực địa dự án).
//  - monthImage(): ảnh màu tự nhiên / giả màu / NDVI của một tháng, dựng một lần rồi lưu đệm (storage/imagery-cache)
//  - classify(): hàng đợi tuần tự; kết quả ở storage/classify/class-YYYY-MM.{webp,tif,json}; staff công bố lên bản đồ
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const sharp = require('sharp');
const { paths, python } = require('../config');
const store = require('../data/store');

const SERIES = path.join(paths.collected, 'monitoring-series');
const CACHE = path.join(paths.storage, 'imagery-cache');
const CLASS_DIR = path.join(paths.storage, 'classify');
const STATE = path.join(CLASS_DIR, 'published.json');
const MODES = { true: 'Màu tự nhiên', false: 'Giả màu hồng ngoại', ndvi: 'NDVI' };
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const InputError = (m) => Object.assign(new Error(m), { status: 400, expose: true });

function months() {
  if (!fs.existsSync(SERIES)) return [];
  return fs.readdirSync(SERIES).map((f) => (f.match(/^sentinel-(\d{4}-\d{2})-100m\.tif$/) || [])[1]).filter(Boolean).sort();
}
function monthTif(month) { if (!YM.test(month)) return null; const f = path.join(SERIES, `sentinel-${month}-100m.tif`); return fs.existsSync(f) ? f : null; }

function run(script, args, timeoutMs = 300000) {
  return new Promise((resolve) => {
    const child = spawn(python, [path.join(paths.scripts, script), ...args], { cwd: paths.scripts, env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, windowsHide: true });
    let out = ''; let errOut = '';
    const t = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { errOut += d; });
    child.on('close', (code) => {
      clearTimeout(t);
      const last = out.trim().split('\n').pop();
      let j = null; try { j = JSON.parse(last); } catch { j = null; }
      resolve({ code, json: j, log: (out + errOut).split('\n').filter((l) => l && !/Warning|warnings\.warn/.test(l)).slice(-12) });
    });
  });
}

const pending = new Map();
async function monthImage(month, mode) {
  if (!monthTif(month)) throw Object.assign(new Error('Không có ảnh tháng này'), { status: 404 });
  if (!MODES[mode]) throw InputError('Kiểu ảnh không hợp lệ');
  fs.mkdirSync(CACHE, { recursive: true });
  const webp = path.join(CACHE, `${month}-${mode}.webp`);
  const tif = monthTif(month);
  if (fs.existsSync(webp) && fs.statSync(webp).mtimeMs >= fs.statSync(tif).mtimeMs) return webp;
  const key = `${month}-${mode}`;
  if (!pending.has(key)) {
    pending.set(key, (async () => {
      const png = path.join(CACHE, `${key}.png`);
      const r = await run('render_month.py', [month, mode, png], 120000);
      if (!r.json || !r.json.ok) throw new Error((r.json && r.json.error) || 'Không dựng được ảnh');
      await sharp(png, { limitInputPixels: false }).webp({ quality: 82, alphaQuality: 90 }).toFile(webp);
      fs.unlinkSync(png);
      return webp;
    })().finally(() => pending.delete(key)));
  }
  return pending.get(key);
}

// ---------- phân loại ----------
function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
function published() { return readJson(STATE) || {}; }
function classifications() {
  if (!fs.existsSync(CLASS_DIR)) return [];
  const pub = published();
  return fs.readdirSync(CLASS_DIR).map((f) => (f.match(/^class-(\d{4}-\d{2})\.json$/) || [])[1]).filter(Boolean).sort().reverse()
    .map((m) => ({ ...readJson(path.join(CLASS_DIR, `class-${m}.json`)), published: Boolean(pub[m]), published_by: pub[m] ? pub[m].by : null, published_at: pub[m] ? pub[m].at : null }));
}
const queue = [];
let busy = null;
async function next() {
  if (busy || !queue.length) return;
  busy = queue.shift();
  const { month, user } = busy;
  try {
    fs.mkdirSync(CLASS_DIR, { recursive: true });
    const r = await run('classify_landcover.py', [month, CLASS_DIR], 600000);
    if (!r.json || !r.json.ok) throw new Error((r.json && r.json.error) || r.log.join(' | ') || 'Phân loại lỗi');
    const png = path.join(CLASS_DIR, `class-${month}.png`);
    await sharp(png, { limitInputPixels: false }).webp({ lossless: true }).toFile(path.join(CLASS_DIR, `class-${month}.webp`));
    fs.unlinkSync(png);
    store.audit(user, 'imagery.classify', month, { accuracy: r.json.accuracy, kappa: r.json.kappa });
  } catch (e) {
    fs.writeFileSync(path.join(CLASS_DIR, `class-${month}.error`), e.message);
    store.audit(user, 'imagery.classify.failed', month, { error: e.message });
  } finally { busy = null; setImmediate(next); }
}
function classify(month, user) {
  if (!monthTif(month)) throw InputError(`Chưa có ảnh Sentinel-2 tháng ${month}`);
  if ((busy && busy.month === month) || queue.some((q) => q.month === month)) return { queued: true };
  try { fs.unlinkSync(path.join(CLASS_DIR, `class-${month}.error`)); } catch { /* chưa có */ }
  queue.push({ month, user }); setImmediate(next);
  return { queued: true };
}
function status() {
  const errors = fs.existsSync(CLASS_DIR) ? fs.readdirSync(CLASS_DIR).filter((f) => f.endsWith('.error')).map((f) => ({ month: f.slice(6, 13), error: fs.readFileSync(path.join(CLASS_DIR, f), 'utf8') })) : [];
  return { running: busy ? busy.month : null, queued: queue.map((q) => q.month), errors };
}
function setPublished(month, on, user) {
  const pub = published();
  if (!fs.existsSync(path.join(CLASS_DIR, `class-${month}.json`))) throw InputError('Chưa có kết quả phân loại tháng này');
  if (on) pub[month] = { by: user.username, at: new Date().toISOString() }; else delete pub[month];
  fs.writeFileSync(STATE, JSON.stringify(pub, null, 1));
  store.audit(user, on ? 'imagery.classify.publish' : 'imagery.classify.unpublish', month);
}
function classFile(month, ext) { if (!YM.test(month) || !['webp', 'tif'].includes(ext)) return null; const f = path.join(CLASS_DIR, `class-${month}.${ext}`); return fs.existsSync(f) ? f : null; }
// lớp phủ cho bản đồ (chỉ kết quả đã công bố)
function classOverlays() {
  return classifications().filter((c) => c.published).map((c) => ({
    id: `class-${c.month}`, url: `/anh-ve-tinh/phan-loai/${c.month}.webp`, group: 'class', title: `Phân loại lớp phủ ${c.month.slice(5)}/${c.month.slice(0, 4)} (tự động)`,
    source: 'Sentinel-2 tháng 100 m – Random Forest học từ 389 mẫu thực địa Mau_KON_TUM_2025',
    meaning: `Độ chính xác đánh giá chéo ${Math.round(c.accuracy * 100)}% (kappa ${c.kappa}). Sản phẩm phân loại tự động, chỉ tham khảo; số liệu rừng chính thức theo QĐ 1047/QĐ-UBND.`,
    legend: c.classes, resolution: '100 m', coordinates: c.coordinates,
  }));
}

module.exports = { MODES, months, monthTif, monthImage, classify, classifications, status, setPublished, classFile, classOverlays };
