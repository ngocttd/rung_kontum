// Kiểm thử các chức năng bổ sung theo thuyết minh (đợt rà soát phản biện), chạy trên PostGIS thật, tự dọn dữ liệu thử:
//  API quản lý lớp (/api/v1), nhập lớp Shapefile/Excel, đăng ký – đăng nhập người dân trên web, bình luận tin bài,
//  số phản ánh cùng vị trí, phiên bản ứng dụng, khoảng cách dân cư, chỉ đường, ảnh tháng, phân loại ảnh, lớp thời tiết.
// Usage: node scripts/test_features.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcryptjs');
process.env.WEATHER_REFRESH_MINUTES = '0';
const app = require('../server');
const store = require('../src/data/store');

let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) failures += 1; };
const ROOT = path.join(__dirname, '..');

function client(base) {
  let cookie = '';
  return async (url, opts = {}) => {
    const res = await fetch(base + url, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), cookie } });
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    const text = /json|html|text/.test(res.headers.get('content-type') || '') ? await res.text() : '';
    return { status: res.status, text, location: res.headers.get('location'), type: res.headers.get('content-type') };
  };
}
const csrfOf = (html) => (html.match(/name="_csrf" value="([^"]+)"/) || [])[1];
const form = (o) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o) });

(async () => {
  await app.ready;
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (method, url, { token, body, fd } = {}) => {
    const headers = {}; if (token) headers.authorization = `Bearer ${token}`; if (body) headers['content-type'] = 'application/json';
    const res = await fetch(base + url, { method, headers, body: fd || (body ? JSON.stringify(body) : undefined) });
    let j = null; try { j = await res.json(); } catch { /* 204 */ }
    return { status: res.status, j };
  };
  const users = []; const layerIds = []; const reportIds = []; let article = null; let articleWasPublished = null;
  const relFile = path.join(ROOT, 'storage', 'app-release.json'); const relBackup = fs.existsSync(relFile) ? fs.readFileSync(relFile) : null;
  try {
    const mk = (username, role, extra = {}) => { const old = store.find('users', (x) => x.username === username); if (old) store.remove('users', old.id); const u = store.insert('users', { username, name: username, role, active: true, password_hash: bcrypt.hashSync('Test-password-1', 8), ...extra }); users.push(u.id); return u; };
    mk('t_f_cb', 'specialist'); mk('t_f_ld', 'leader'); mk('t_f_qtv', 'admin'); mk('t_f_dan', 'citizen');
    await store.drain();
    const tok = async (u) => (await api('POST', '/api/mobile/auth/login', { body: { username: u, password: 'Test-password-1' } })).j.access_token;
    const cb = await tok('t_f_cb'); const ld = await tok('t_f_ld'); const dan = await tok('t_f_dan');

    // ---------- 1. API quản lý lớp ----------
    const idx = await api('GET', '/api/v1');
    ok(idx.status === 200 && idx.j.endpoints.length >= 9, 'API v1: mô tả endpoint công khai');
    ok((await api('GET', '/api/v1/layers')).status === 401, 'API v1: thiếu token → 401');
    const gj = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [107.95, 14.6] }, properties: { ten: 'Chòi canh lửa A (thử)' } }, { type: 'Feature', geometry: { type: 'Point', coordinates: [107.9, 14.5] }, properties: { ten: 'Chòi canh lửa B (thử)' } }] };
    const c1 = await api('POST', '/api/v1/layers', { token: cb, body: { title: 'KIỂM THỬ chòi canh', source: 'test', color: '#ff0000', geojson: gj } });
    if (c1.j && c1.j.id) layerIds.push(c1.j.id);
    ok(c1.status === 201 && c1.j.status === 'staging' && c1.j.validation.count === 2, 'API v1: tạo lớp GeoJSON → vùng chờ duyệt');
    ok((await api('POST', '/api/v1/layers', { token: dan, body: { title: 'x', geojson: gj } })).status === 403, 'API v1: người dân không được ghi');
    ok((await api('POST', '/api/v1/layers', { token: ld, body: { title: 'x', geojson: gj } })).status === 403, 'API v1: lãnh đạo (không có data.manage) không được ghi');
    ok((await fetch(`${base}/api/public/layers/custom/${c1.j.id}`)).status === 404, 'API v1: lớp chưa công bố không truy cập công khai');
    const pub = await api('POST', `/api/v1/layers/${c1.j.id}/publish`, { token: cb });
    ok(pub.status === 200 && pub.j.status === 'published' && (await fetch(`${base}/api/public/layers/custom/${c1.j.id}`)).status === 200, 'API v1: công bố → có trên API công khai');
    const pat = await api('PATCH', `/api/v1/layers/${c1.j.id}`, { token: cb, body: { title: 'KIỂM THỬ chòi canh (sửa)' } });
    ok(pat.status === 200 && pat.j.title.endsWith('(sửa)'), 'API v1: sửa thông tin lớp');
    const put = await api('PUT', `/api/v1/layers/${c1.j.id}/geojson`, { token: cb, body: { geojson: { ...gj, features: gj.features.slice(0, 1) } } });
    ok(put.status === 200 && put.j.status === 'staging' && put.j.validation.count === 1, 'API v1: thay dữ liệu → quay về vùng chờ');
    const list = await api('GET', '/api/v1/layers?status=staging', { token: ld });
    ok(list.status === 200 && list.j.custom.some((l) => l.id === c1.j.id) && list.j.system.length > 10, 'API v1: liệt kê lớp (lãnh đạo được đọc)');
    const bad = await api('POST', '/api/v1/layers', { token: cb, body: { title: 'KIỂM THỬ sai toạ độ', geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [765779, 1555442] }, properties: {} }] } } });
    if (bad.j && bad.j.id) layerIds.push(bad.j.id);
    ok(bad.status === 422 && bad.j.errors.length, 'API v1: toạ độ mét khai là WGS84 → báo lỗi kiểm tra');

    // ---------- 2. nhập Shapefile / Excel ----------
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-feat-'));
    const shpDir = path.join(ROOT, 'data', 'Data_thuc_te', 'Mau thuc dia_2025');
    if (fs.existsSync(shpDir)) {
      const zip = path.join(tmp, 'mau.zip');
      require('child_process').execFileSync(require('../src/config').python, ['-c', `import zipfile,glob,os,sys\nos.chdir(sys.argv[1])\nz=zipfile.ZipFile(sys.argv[2],'w')\n[z.write(f) for f in glob.glob('Mau_KON_TUM_2025.*')]\nz.close()`, shpDir, zip]);
      const fd = new FormData(); fd.set('title', 'KIỂM THỬ mẫu thực địa (Shapefile)'); fd.set('file', new Blob([fs.readFileSync(zip)]), 'mau.zip');
      const s = await api('POST', '/api/v1/layers', { token: cb, fd });
      if (s.j && s.j.id) layerIds.push(s.j.id);
      ok(s.status === 201 && s.j.validation.count === 389 && s.j.validation.source_crs === 'EPSG:32648', 'Nhập Shapefile .zip (UTM 48N, có .prj) → 389 điểm WGS84');
    } else ok(true, 'Bỏ qua Shapefile (thiếu dữ liệu thực tế)');
    const ExcelJS = require('exceljs'); const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Diem');
    ws.addRow(['Tên', 'Kinh độ', 'Vĩ độ']); ws.addRow(['Điểm 1', 107.95, 14.6]); ws.addRow(['Điểm 2', 108.0, 14.35]);
    const xlsx = path.join(tmp, 'diem.xlsx'); await wb.xlsx.writeFile(xlsx);
    const fx = new FormData(); fx.set('title', 'KIỂM THỬ Excel'); fx.set('file', new Blob([fs.readFileSync(xlsx)]), 'diem.xlsx');
    const x = await api('POST', '/api/v1/layers', { token: cb, fd: fx });
    if (x.j && x.j.id) layerIds.push(x.j.id);
    ok(x.status === 201 && x.j.validation.count === 2 && x.j.validation.source_format === '.xlsx', 'Nhập Excel cột Kinh độ/Vĩ độ → 2 điểm');
    fs.rmSync(tmp, { recursive: true, force: true });
    for (const id of layerIds.splice(0)) { const d = await api('DELETE', `/api/v1/layers/${id}`, { token: cb }); if (d.status !== 204) failures += 1; }
    ok(!store.all('layers').some((l) => /^KIỂM THỬ/.test(l.title)), 'API v1: xoá lớp thử');

    // ---------- 3. đăng ký / đăng nhập người dân trên web ----------
    const web = client(base);
    let r = await web('/dang-ky');
    const phone = `09${String(Date.now()).slice(-8)}`;
    r = await web('/dang-ky', form({ _csrf: csrfOf(r.text), name: 'Người dân kiểm thử', phone, password: 'Matkhau-123', password2: 'Matkhau-123', agree: '1', next: '/tai-khoan' }));
    const reg = store.find('users', (u) => u.username === phone); if (reg) users.push(reg.id);
    ok(r.status === 302 && r.location === '/tai-khoan' && reg && reg.role === 'citizen', 'Đăng ký tài khoản người dân trên web');
    r = await web('/tai-khoan');
    ok(r.status === 200 && r.text.includes('Người dân kiểm thử') && r.text.includes(phone), 'Trang Tài khoản của tôi');
    ok((await web('/quan-tri')).status === 302, 'Tài khoản người dân không vào được Quản trị');
    const web2 = client(base); r = await web2('/dang-ky');
    r = await web2('/dang-ky', form({ _csrf: csrfOf(r.text), name: 'Trùng', phone, password: 'Matkhau-123', password2: 'Matkhau-123', agree: '1' }));
    ok(r.status === 400 && r.text.includes('đã được đăng ký'), 'Chặn đăng ký trùng số điện thoại');
    r = await web2('/dang-nhap'); r = await web2('/dang-nhap', form({ _csrf: csrfOf(r.text), username: phone, password: 'Matkhau-123', next: '/tai-khoan' }));
    ok(r.status === 302 && r.location === '/tai-khoan', 'Đăng nhập web bằng số điện thoại');
    const mobileLogin = await api('POST', '/api/mobile/auth/login', { body: { username: phone, password: 'Matkhau-123' } });
    ok(mobileLogin.status === 200 && mobileLogin.j.access_token, 'Cùng tài khoản đăng nhập được MobileGIS');
    r = await web2('/dang-nhap'); // đã đăng nhập → chuyển tài khoản
    ok(r.status === 302, 'Đã đăng nhập thì /dang-nhap chuyển về tài khoản');

    // ---------- 4. bình luận tin bài ----------
    article = store.find('articles', (a) => a.status === 'published') || store.find('articles', (a) => a.status !== 'deleted');
    articleWasPublished = article.status;
    if (article.status !== 'published') store.update('articles', article.id, { status: 'published', published_at: article.published_at || store.now() });
    r = await web2(`/tin-tuc/${article.slug}`);
    r = await web2(`/tin-tuc/${article.slug}/binh-luan`, form({ _csrf: csrfOf(r.text), body: 'Bình luận kiểm thử tự động – xin cảm ơn bài viết.' }));
    ok(r.status === 302 && /da_gui=1/.test(r.location), 'Gửi bình luận (tài khoản người dân)');
    const cm = store.find('comments', (c) => c.article_id === article.id && c.body.startsWith('Bình luận kiểm thử'));
    ok(cm && cm.status === 'pending' && cm.user_id === reg.id, 'Bình luận chờ duyệt, gắn tài khoản');
    ok(!(await web(`/tin-tuc/${article.slug}`)).text.includes('Bình luận kiểm thử tự động'), 'Bình luận chưa duyệt không hiển thị');
    const adm = client(base); r = await adm('/quan-tri/dang-nhap'); await adm('/quan-tri/dang-nhap', form({ _csrf: csrfOf(r.text), username: 't_f_qtv', password: 'Test-password-1', next: '/quan-tri' }));
    r = await adm('/quan-tri/tin-tuc?tab=binh-luan');
    ok(r.status === 200 && r.text.includes('Bình luận kiểm thử tự động'), 'Quản trị thấy bình luận chờ duyệt');
    r = await adm(`/quan-tri/tin-tuc/binh-luan/${cm.id}`, form({ _csrf: csrfOf(r.text), status: 'approved' }));
    ok((await web(`/tin-tuc/${article.slug}`)).text.includes('Bình luận kiểm thử tự động'), 'Duyệt → bình luận hiển thị công khai');
    const anonC = client(base); r = await anonC(`/tin-tuc/${article.slug}`);
    r = await anonC(`/tin-tuc/${article.slug}/binh-luan`, form({ _csrf: csrfOf(r.text), name: 'A', body: 'ngắn' }));
    ok(r.status === 302 && !store.find('comments', (c) => c.body === 'ngắn'), 'Từ chối bình luận thiếu tên/quá ngắn');

    // ---------- 5. quản trị: các trang mới, sửa người dùng ----------
    for (const p of ['/quan-tri/anh-ve-tinh', '/quan-tri/du-lieu', '/quan-tri/tai-lieu', '/quan-tri/cai-dat', '/quan-tri/nguoi-dung', '/quan-tri/phan-anh']) ok((await adm(p)).status === 200, `Quản trị: ${p}`);
    r = await adm('/quan-tri/nguoi-dung');
    const t = store.find('users', (u) => u.username === 't_f_dan');
    await adm(`/quan-tri/nguoi-dung/${t.id}`, form({ _csrf: csrfOf(r.text), action: 'edit', name: 'Dân sửa tên', email: 'dan@example.org', phone: '0911222333' }));
    const t2 = store.get('users', t.id);
    ok(t2.name === 'Dân sửa tên' && t2.email === 'dan@example.org' && t2.phone === '0911222333', 'Quản trị sửa thông tin người dùng');

    // ---------- 6. phản ánh cùng vị trí ----------
    const reports = require('../src/services/reports');
    const a1 = await reports.create({ type: 'chay-rung', description: 'KIỂM THỬ cùng vị trí 1', lat: 14.6, lon: 107.95, phone: '0900000001' }, []);
    const a2 = await reports.create({ type: 'chay-rung', description: 'KIỂM THỬ cùng vị trí 2', lat: 14.601, lon: 107.951, phone: '0900000002' }, []);
    const a3 = await reports.create({ type: 'chay-rung', description: 'KIỂM THỬ xa', lat: 14.7, lon: 107.95, phone: '0900000003' }, []);
    reportIds.push(a1.id, a2.id, a3.id);
    ok(reports.sameLocation(a1).count === 1 && reports.sameLocation(a3).count === 0 && reports.publicView(a2).same_location_count === 1, 'Đếm phản ánh cùng vị trí (≤ 500 m, ±14 ngày)');
    r = await adm(`/quan-tri/phan-anh/${a1.id}`);
    ok(r.text.includes('2 người') && r.text.includes(a2.code), 'Chi tiết phản ánh hiện số người cùng báo');

    // ---------- 7. phiên bản ứng dụng ----------
    r = await adm('/quan-tri/cai-dat');
    await adm('/quan-tri/phien-ban-ung-dung', form({ _csrf: csrfOf(r.text), action: 'save', version: '1.2.0', min_version: '1.1.0', notes: 'Kiểm thử', android_url: 'https://example.org/app.apk' }));
    let v = await api('GET', '/api/mobile/app-version?current=1.0.0');
    ok(v.j.latest === '1.2.0' && v.j.update && v.j.force, 'Phiên bản: 1.0.0 < tối thiểu 1.1.0 → bắt buộc cập nhật');
    v = await api('GET', '/api/mobile/app-version?current=1.1.5');
    ok(v.j.update && !v.j.force, 'Phiên bản: 1.1.5 → có bản mới, không bắt buộc');
    v = await api('GET', '/api/mobile/app-version?current=1.2.0');
    ok(!v.j.update, 'Phiên bản: đã mới nhất');

    // ---------- 8. công cụ không gian, ảnh, thời tiết ----------
    const near = await api('GET', '/api/public/tools/nearest?lon=107.95&lat=14.6');
    ok(near.status === 200 && near.j.settlements.length === 5 && near.j.road && near.j.facilities.length, 'Khoảng cách tới khu dân cư, đường, cơ sở ứng cứu');
    const rt = await api('GET', '/api/public/tools/route?from=108.0003,14.3479&to=107.84,14.6612');
    ok(rt.status === 200 && rt.j.summary.distance_m > 30000 && rt.j.summary.distance_m < 60000 && rt.j.features[0].geometry.coordinates.length > 50, `Chỉ đường Kon Tum → Đăk Tô: ${rt.j.summary && Math.round(rt.j.summary.distance_m / 100) / 10} km, ${rt.j.summary && rt.j.summary.duration_min} phút`);
    ok((await api('GET', '/api/public/tools/route?from=1,2')).status === 400, 'Chỉ đường: tham số sai → 400');
    const wind = await api('GET', '/api/public/weather/wind'); const windE = await api('GET', '/api/public/weather/wind?nguon=era5');
    ok(wind.status === 200 && wind.j.features.length >= 10 && windE.status === 200 && windE.j.features.length > 50, 'Mũi tên gió (Open-Meteo theo xã, ERA5-Land lưới)');
    const layersApi = await api('GET', '/api/public/map/layers');
    const ids = layersApi.j.overlays.map((o) => o.id);
    ok(['wx-fc-temp', 'wx-fc-rain', 'wx-fc-wind', 'ndmi-latest', 'lst-latest'].every((i) => ids.includes(i)), 'Lớp nhiệt độ, mưa, gió, NDMI, LST có trên bản đồ');
    const months = require('../src/services/imagery').months();
    const img = await fetch(`${base}/anh-ve-tinh/thang/${months[months.length - 1]}-false.webp`);
    ok(img.status === 200 && /webp/.test(img.headers.get('content-type')), 'Ảnh tháng Sentinel-2 dựng theo yêu cầu (so sánh/tải)');
    ok((await web('/so-sanh-anh')).status === 200, 'Trang So sánh ảnh vệ tinh');
    const dl = await adm(`/quan-tri/anh-ve-tinh/tai/${months[0]}.tif`);
    ok(dl.status === 200, 'Tải GeoTIFF tháng (cán bộ)');
    ok((await web(`/quan-tri/anh-ve-tinh/tai/${months[0]}.tif`)).status === 302, 'Tải GeoTIFF: khách bị chuyển đăng nhập');
    const imagery = require('../src/services/imagery');
    const cls = imagery.classifications()[0];
    if (cls) {
      const was = cls.published;
      if (was) imagery.setPublished(cls.month, false, { username: 'kiem.thu' });
      ok((await fetch(`${base}/anh-ve-tinh/phan-loai/${cls.month}.webp`)).status === 404, 'Phân loại chưa công bố: khách không xem được');
      imagery.setPublished(cls.month, true, { username: 'kiem.thu' });
      ok((await api('GET', '/api/public/map/layers')).j.overlays.some((o) => o.id === `class-${cls.month}`), `Công bố phân loại ${cls.month} (độ chính xác ${Math.round(cls.accuracy * 100)}%) → lớp trên bản đồ`);
      if (!was) imagery.setPublished(cls.month, false, { username: 'kiem.thu' });
    } else ok(true, 'Bỏ qua phân loại (chưa có kết quả)');
  } catch (e) { console.error(e); failures += 1; } finally {
    for (const id of reportIds) store.remove('reports', id);
    for (const c of store.filter('comments', (x) => /kiểm thử/i.test(x.body) || users.includes(x.user_id))) store.remove('comments', c.id);
    if (article && articleWasPublished && articleWasPublished !== 'published') store.update('articles', article.id, { status: articleWasPublished });
    for (const id of layerIds) store.remove('layers', id);
    for (const id of users) { await require('../src/db/pool').query('DELETE FROM mobile.refresh_tokens WHERE user_id = $1', [id]).catch(() => {}); store.remove('users', id); }
    if (relBackup) fs.writeFileSync(relFile, relBackup); else fs.rmSync(relFile, { force: true });
    await store.drain();
    server.close();
    console.log(failures ? `\n${failures} kiểm tra KHÔNG đạt` : '\nTất cả kiểm tra chức năng bổ sung đạt');
    process.exit(failures ? 1 : 0);
  }
})();
