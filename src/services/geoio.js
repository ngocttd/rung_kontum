// Nhập/xuất dữ liệu không gian dùng chung: chọn hệ toạ độ (WGS84, UTM, VN-2000 theo kinh tuyến trục và múi chiếu)
// và định dạng (GeoJSON, KML, Shapefile .zip, CSV, Excel). Chuyển đổi bằng scripts/geo_export.py (PROJ, 7 tham số VN-2000).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { paths, python } = require('../config');

// kinh tuyến trục múi 3° thường dùng trong vùng (Thông tư 25/2014/TT-BTNMT)
// Kon Tum (107°20′–108°33′ Đ) vắt qua kinh tuyến 108°: ở múi 6° thuộc CẢ HAI múi – số 48 (kinh tuyến trục 105°, phần phía tây 108°)
// và số 49 (kinh tuyến trục 111°, phần phía đông 108°); ở múi 3° dùng 107°30′ (kinh tuyến trục của tỉnh) hoặc 108°00′.
// Phần tử thứ ba = múi chiếu mặc định khi chọn kinh tuyến trục đó.
const MERIDIANS = [
  ['107.5', '107°30′ – múi 3°, Kon Tum (cũ)', 3], ['108', '108°00′ – múi 3°, Quảng Ngãi', 3], ['105', '105°00′ – múi 6° số 48 (phía tây 108°Đ)', 6], ['111', '111°00′ – múi 6° số 49 (phía đông 108°Đ)', 6],
  ['108.5', '108°30′ – múi 3°, Gia Lai, Đắk Lắk', 3], ['107.75', '107°45′ – múi 3°, Quảng Nam, Đà Nẵng', 3],
];
const FORMATS = { geojson: ['GeoJSON', 'geojson', 'application/geo+json'], kml: ['KML (Google Earth)', 'kml', 'application/vnd.google-earth.kml+xml'], shp: ['Shapefile (.zip)', 'zip', 'application/zip'], xlsx: ['Excel (.xlsx)', 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], csv: ['CSV', 'csv', 'text/csv; charset=utf-8'] };

// đọc lựa chọn hệ toạ độ từ form/query: he = wgs84 | utm48 | vn2000 (+ ktt, mui) hoặc crs = chuỗi khai báo đầy đủ
function crsFrom(q = {}) {
  if (q.crs && q.crs !== 'auto') return String(q.crs).slice(0, 200);
  const he = String(q.he || q.crs_sys || '').toLowerCase();
  if (he === 'vn2000') {
    const ktt = Number(String(q.ktt || q.crs_ktt || '107.5').replace(',', '.'));
    const mui = String(q.mui || q.crs_zone || '3') === '6' ? 6 : 3;
    if (!(ktt >= 102 && ktt <= 114)) throw new Error('Kinh tuyến trục phải trong khoảng 102°–114°.');
    return `VN2000:${ktt}:${mui}`;
  }
  if (he === 'utm48') return 'EPSG:32648';
  if (he === 'utm49') return 'EPSG:32649';
  return q.crs === 'auto' ? 'auto' : 'EPSG:4326';
}
const safeName = (s) => String(s || 'du_lieu').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50) || 'du_lieu';

function run(args, timeout = 180000) {
  return new Promise((resolve) => {
    const c = spawn(python, args, { cwd: paths.scripts, env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, windowsHide: true });
    let out = ''; let err = '';
    const t = setTimeout(() => c.kill(), timeout);
    c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { err += d; });
    c.on('close', () => { clearTimeout(t); let j = null; try { j = JSON.parse(out.trim().split('\n').pop()); } catch { j = { ok: false, error: err.split('\n').filter((l) => l && !/Warn|PROJ/.test(l)).pop() || 'lỗi chuyển đổi' }; } resolve(j); });
    c.on('error', (e) => resolve({ ok: false, error: e.message }));
  });
}

// fc: FeatureCollection WGS84 → { buffer, filename, mime, info }
async function exportVector(fc, { format = 'geojson', crs = 'EPSG:4326', name = 'du_lieu' } = {}) {
  const f = FORMATS[format];
  if (!f) throw new Error('Định dạng xuất không hỗ trợ (geojson, kml, shp, xlsx, csv).');
  const base = safeName(name);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-exp-'));
  try {
    const inp = path.join(tmp, 'in.geojson'); const out = path.join(tmp, `out.${f[1]}`);
    fs.writeFileSync(inp, JSON.stringify(fc));
    const info = await run([path.join(paths.scripts, 'geo_export.py'), inp, out, format, crs, base]);
    if (!info.ok) throw new Error(info.error);
    const tag = /^VN2000:/i.test(crs) ? `_VN2000_${crs.split(':')[1].replace('.', '-')}_mui${crs.split(':')[2] || 3}` : crs === 'EPSG:32648' ? '_UTM48N' : crs === 'EPSG:32649' ? '_UTM49N' : '';
    return { buffer: fs.readFileSync(out), filename: `${base}${format === 'kml' ? '' : tag}.${f[1]}`, mime: f[2], info };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
// gửi tệp xuất về trình duyệt theo ?dinh_dang=&he=&ktt=&mui=
async function send(req, res, fc, name) {
  const r = await exportVector(fc, { format: String(req.query.dinh_dang || req.query.format || 'geojson').toLowerCase(), crs: crsFrom(req.query), name });
  res.set('Content-Type', r.mime).set('Content-Disposition', `attachment; filename="${r.filename}"`).set('Cache-Control', 'no-store').send(r.buffer);
}

// lớp ảnh bản đồ (WebP/PNG, biết 4 góc WGS84) → GeoTIFF có toạ độ theo hệ chọn
async function exportRaster(imageBuffer, coordinates, { crs = 'EPSG:3857', name = 'lop_anh' } = {}) {
  const sharp = require('sharp');
  const xs = coordinates.map((c) => c[0]); const ys = coordinates.map((c) => c[1]);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-ras-'));
  try {
    const png = path.join(tmp, 'in.png'); const out = path.join(tmp, 'out.tif');
    await sharp(imageBuffer, { limitInputPixels: false }).png({ compressionLevel: 1 }).toFile(png);
    const info = await run([path.join(paths.scripts, 'overlay_to_tif.py'), png, String(Math.min(...xs)), String(Math.min(...ys)), String(Math.max(...xs)), String(Math.max(...ys)), out, crs]);
    if (!info.ok) throw new Error(info.error);
    const tag = /^VN2000:/i.test(crs) ? `_VN2000_${crs.split(':')[1].replace('.', '-')}_mui${crs.split(':')[2] || 3}` : crs === 'EPSG:32648' ? '_UTM48N' : crs === 'EPSG:4326' ? '_WGS84' : '';
    return { buffer: fs.readFileSync(out), filename: `${safeName(name)}${tag}.tif`, mime: 'image/tiff', info };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// chuyển một danh sách điểm giữa hai hệ toạ độ (công cụ chuyển toạ độ trên bản đồ / quản trị)
function convertPoints(points, from, to) {
  const code = `import sys,json,os,importlib.util
from pathlib import Path
_r=Path(importlib.util.find_spec('rasterio').origin).parent
os.environ['PROJ_LIB']=str(_r/'proj_data');os.environ['PROJ_DATA']=str(_r/'proj_data')
import warnings;warnings.filterwarnings('ignore')
from rasterio.crs import CRS
from rasterio.warp import transform
sys.path.insert(0,r'${paths.scripts}')
from _crs import resolve
d=json.loads(sys.stdin.read())
a,la=resolve(d['from']);b,lb=resolve(d['to'])
xs,ys=transform(CRS.from_user_input(a),CRS.from_user_input(b),[p[0] for p in d['points']],[p[1] for p in d['points']])
dec=7 if b=='EPSG:4326' else 3
print(json.dumps(dict(ok=True,from_label=la,to_label=lb,points=[[round(x,dec),round(y,dec)] for x,y in zip(xs,ys)]),ensure_ascii=False))`;
  const r = spawnSync(python, ['-c', code], { input: JSON.stringify({ points, from, to }), encoding: 'utf8', timeout: 30000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, windowsHide: true });
  try { return JSON.parse(String(r.stdout).trim().split('\n').pop()); } catch { throw new Error(String(r.stderr || '').split('\n').filter((l) => l && !/Warn|PROJ/.test(l)).pop() || 'Không chuyển được toạ độ'); }
}

module.exports = { MERIDIANS, FORMATS, crsFrom, exportVector, exportRaster, send, convertPoints, safeName };
