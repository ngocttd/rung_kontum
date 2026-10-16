// Kiểm thử phân hệ nhập bản đồ (TC01–TC07 của báo cáo chuyên đề) trên PostGIS thật.
// Tạo tệp mẫu tạm, chạy qua HTTP với tài khoản tạm, rồi dọn sạch dữ liệu thử.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const bcrypt = require('bcryptjs');
process.env.WEATHER_REFRESH_MINUTES = '0';
const app = require('../server');
const store = require('../src/data/store');
const maps = require('../src/services/maps');
const db = require('../src/db/pool');
const config = require('../src/config');

let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) failures += 1; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-maps-'));

function client(base) {
  let cookie = '';
  return async (url, opts = {}) => {
    const res = await fetch(base + url, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), cookie } });
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    const text = /json|html|text/.test(res.headers.get('content-type') || '') ? await res.text() : '';
    return { status: res.status, text, location: res.headers.get('location') };
  };
}
const csrfOf = (html) => (html.match(/name="_csrf" value="([a-f0-9]+)"/) || [])[1];
async function waitJobs(id) {
  for (let i = 0; i < 120; i++) {
    await maps.pump();
    const q = (await db.query("SELECT count(*)::int n FROM maps.map_processing_jobs WHERE dataset_id = $1 AND status IN ('queued','running')", [id])).rows[0].n;
    if (!q) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

(async () => {
  // sample files
  execFileSync(config.python, ['-c', `
import os, importlib.util, sys
from pathlib import Path
_r = Path(importlib.util.find_spec('rasterio').origin).parent
os.environ['PROJ_LIB'] = str(_r / 'proj_data'); os.environ['PROJ_DATA'] = str(_r / 'proj_data'); os.environ['GDAL_DATA'] = str(_r / 'gdal_data')
import numpy as np, rasterio
from rasterio.transform import from_origin
sys.path.insert(0, r'${path.join(config.ROOT, '.tools', 'pdf')}')
a = (np.random.rand(3, 200, 300) * 255).astype('uint8')
with rasterio.open(r'${path.join(tmp, 'ok.tif')}', 'w', driver='GTiff', width=300, height=200, count=3, dtype='uint8', crs='EPSG:32648', transform=from_origin(800000, 1620000, 30, 30)) as d: d.write(a)
with rasterio.open(r'${path.join(tmp, 'nocrs.tif')}', 'w', driver='GTiff', width=300, height=200, count=3, dtype='uint8') as d: d.write(a)
import fitz
doc = fitz.open()
for i in range(3):
  p = doc.new_page(); p.insert_text((72, 72), f'Trang {i+1}')
doc.save(r'${path.join(tmp, 'three.pdf')}')
`], { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  fs.writeFileSync(path.join(tmp, 'fake.tif'), 'not a tiff');

  await app.ready;
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const created = [];
  try {
    const mk = (username, role) => store.insert('users', { username, name: username, role, active: true, password_hash: bcrypt.hashSync('Test-password-1', 8) });
    const uSpec = mk('t_map_canbo', 'specialist'); const uAdm = mk('t_map_qtv', 'admin');
    await store.drain();
    const login = async (u) => {
      const c = client(base); const l = await c('/quan-tri/dang-nhap');
      await c('/quan-tri/dang-nhap', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrfOf(l.text), username: u, password: 'Test-password-1', next: '/quan-tri' }) });
      return c;
    };
    const spec = await login('t_map_canbo'); const adm = await login('t_map_qtv');
    const up = async (c, file, expect, title) => {
      const page = await c('/quan-tri/ban-do/moi'); const fd = new FormData();
      fd.set('_csrf', csrfOf(page.text)); fd.set('expect', expect); fd.set('title', title); fd.set('category', 'khac');
      fd.set('file', new Blob([fs.readFileSync(path.join(tmp, file))]), file);
      const r = await c('/quan-tri/ban-do/moi', { method: 'POST', body: fd, headers: { 'x-requested-with': 'fetch' } });
      let j = {}; try { j = JSON.parse(r.text); } catch { /* */ }
      if (j.id) created.push(j.id);
      return { ...r, j };
    };

    ok((await spec('/quan-tri/ban-do')).status === 200, 'Danh sách bản đồ (PL.1)');
    // TC01
    let r = await up(spec, 'ok.tif', 'geotiff', 'TEST GeoTIFF hợp lệ');
    ok(r.j.ok, 'TC01 tải GeoTIFF hợp lệ');
    await waitJobs(r.j.id);
    let d = await maps.get(r.j.id);
    ok(d.georeferenced && d.tech.epsg === 32648 && d.tech.bands === 3 && d.tech.width === 300 && d.tech.bounds4326, 'TC01 đọc CRS, kích thước, số băng, bbox');
    ok(d.status === 'ready' && d.overlay_url && d.files.some((f) => f.file_role === 'cog'), 'TC01 tạo lớp hiển thị và COG, trạng thái chờ gửi duyệt');
    const geoId = r.j.id;
    // TC02
    r = await up(spec, 'nocrs.tif', 'geotiff', 'TEST GeoTIFF không CRS');
    await waitJobs(r.j.id); d = await maps.get(r.j.id);
    ok(!d.georeferenced && d.status === 'needs_georef', 'TC02 GeoTIFF thiếu CRS phải bổ sung tham chiếu (cần nắn chỉnh)');
    const noCrsId = r.j.id;
    // TC03
    r = await up(spec, 'three.pdf', 'pdf', 'TEST PDF nhiều trang');
    await waitJobs(r.j.id); d = await maps.get(r.j.id);
    ok(d.tech.pages === 3 && d.files.filter((f) => f.file_role === 'page_preview').length === 3, 'TC03 PDF 3 trang: đọc số trang và tạo 3 ảnh xem trước');
    // TC04
    ok(!d.georeferenced && !(await maps.publishedLayers()).some((l) => l.id === d.id), 'TC04 PDF chưa định vị không chồng lên bản đồ');
    const pdfId = d.id;
    // TC05
    r = await up(spec, 'fake.tif', 'geotiff', 'TEST sai định dạng');
    ok(r.status === 400 && /Định dạng/.test(r.j.error || ''), 'TC05 tệp sai định dạng bị từ chối có thông báo');
    // TC06
    let page = await spec(`/quan-tri/ban-do/${geoId}`); let tok = csrfOf(page.text);
    await spec(`/quan-tri/ban-do/${geoId}/gui-duyet`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: tok }) });
    r = await spec(`/quan-tri/ban-do/${geoId}/xuat-ban`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: tok }) });
    ok(r.status === 403 && (await maps.get(geoId)).status === 'pending_review', 'TC06 cán bộ không có quyền xuất bản (kiểm tra ở máy chủ)');
    r = await spec(`/quan-tri/ban-do/${geoId}/xoa`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: tok }) });
    ok(r.status === 403, 'TC06 cán bộ không có quyền xoá');
    page = await adm(`/quan-tri/ban-do/${geoId}`); const atok = csrfOf(page.text);
    await adm(`/quan-tri/ban-do/${geoId}/xuat-ban`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: atok, note: 'kiểm thử' }) });
    d = await maps.get(geoId);
    ok(d.status === 'published' && d.versions.length === 1 && (await maps.publishedLayers()).some((l) => l.id === geoId), 'Quản trị duyệt và xuất bản; lớp xuất hiện trên WebGIS');
    // TC07
    const fd = new FormData(); fd.set('_csrf', atok); fd.set('file', new Blob([fs.readFileSync(path.join(tmp, 'ok.tif'))]), 'ok_v2.tif');
    await adm(`/quan-tri/ban-do/${geoId}/phien-ban`, { method: 'POST', body: fd });
    await waitJobs(geoId); d = await maps.get(geoId);
    ok(d.current_version === 2 && d.files.filter((f) => f.file_role === 'original').length === 2 && d.versions.length === 1 && d.status === 'published', 'TC07 phiên bản mới không mất tệp gốc và lịch sử công bố');
    // georeference the CRS-less TIFF with 4 GCPs
    page = await spec(`/quan-tri/ban-do/${noCrsId}`); tok = csrfOf(page.text);
    const gcps = [[0.05, 0.05, 107.6, 14.8], [0.95, 0.05, 107.9, 14.8], [0.95, 0.95, 107.9, 14.6], [0.05, 0.95, 107.6, 14.6]].map(([fx, fy, lon, lat]) => ({ fx, fy, px: fx * 300, py: fy * 200, lon, lat }));
    await spec(`/quan-tri/ban-do/${noCrsId}/nan-chinh`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: tok, method: 'affine', page: '1', gcps: JSON.stringify(gcps) }) });
    await waitJobs(noCrsId); d = await maps.get(noCrsId);
    ok(d.georeferenced && d.ref.georef_method === 'gcp_affine' && Number.isFinite(Number(d.ref.residual_error)) && d.overlay_url, `Nắn chỉnh bằng 4 điểm khống chế: RMSE ${d.ref.residual_error} m, tạo raster định vị`);
    ok((await maps.get(pdfId)).logs.some((l) => l.action === 'upload'), 'Nhật ký bộ dữ liệu ghi nhận thao tác');
    // anonymous access control
    const anon = client(base);
    const pdfFile = (await maps.get(pdfId)).files.find((f) => f.file_role === 'original');
    ok((await anon(`/ban-do-chuyen-de/tep/${pdfFile.id}`)).status === 404, 'Tệp chưa xuất bản không truy cập công khai được');
    // cleanup
    for (const u of [uSpec, uAdm]) store.remove('users', u.id);
  } catch (e) { console.error(e); failures += 1; } finally {
    for (const id of created) await db.query("UPDATE maps.map_datasets SET status = 'revoked' WHERE id = $1", [id]).then(() => maps.remove(id, { username: 'test' })).catch(() => {});
    await store.drain();
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(failures ? `\n${failures} kiểm tra lỗi` : '\nTất cả kiểm tra phân hệ bản đồ đạt');
    process.exit(failures ? 1 : 0);
  }
})();
