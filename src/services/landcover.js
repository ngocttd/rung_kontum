// Chuỗi lớp phủ hằng năm từ Google Dynamic World (chuẩn hoá toàn cầu) – không dùng bản đồ ảnh/GeoTIFF/PDF của dự án cho thống kê.
// collect_dynamic_world.py tải năm mới/năm hiện tại (tạm tính); landcover_series.py tính diện tích, ma trận, mất/tăng cây gỗ mọi cặp năm.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { paths, python } = require('../config');

const SERIES = path.join(paths.web, 'landcover-series.json');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
function series() { return readJson(SERIES); }
function manifest() { return readJson(path.join(paths.collected, 'dynamic-world', 'manifest.json')) || {}; }
function run(script, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(python, [path.join(paths.scripts, script), ...args], { cwd: paths.scripts, env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, windowsHide: true });
    let out = ''; let err = '';
    const t = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
    child.on('close', () => { clearTimeout(t); let j = null; try { j = JSON.parse(out.trim().split('\n').pop()); } catch { j = { ok: false, error: err.split('\n').filter((l) => l && !/Warn|warn\(/.test(l)).pop() || 'lỗi chạy script' }; } resolve(j); });
  });
}
let busy = null; let last = null;
function update() {
  if (busy) return busy;
  busy = (async () => {
    const c = await run('collect_dynamic_world.py', [], 1800000);
    const b = await run('landcover_series.py', ['build'], 600000);
    await new Promise((ok) => { const c = spawn(process.execPath, [path.join(paths.scripts, 'to_webp.cjs')], { cwd: paths.scripts, windowsHide: true }); c.on('close', ok); c.on('error', ok); });
    last = { at: new Date().toISOString(), collect: c, build: b };
    return last;
  })().finally(() => { busy = null; });
  return busy;
}
function status() { return { running: Boolean(busy), last }; }
module.exports = { series, manifest, update, status };
