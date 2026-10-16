// End-to-end smoke test against an isolated temporary storage directory.
// Runs every public page/API, logs in with temporary staff accounts, exercises the
// report → verification → publication workflows and checks role restrictions.
const os = require('os');
const fs = require('fs');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-smoke-'));
process.env.STORAGE_DIR = tmp;
process.env.WEATHER_REFRESH_MINUTES = '0';
process.env.ENABLE_DATA_JOBS = 'false';
if (!process.env.SMOKE_DB) process.env.DB_DISABLED = '1'; // SMOKE_DB=1 to test against PostGIS

const bcrypt = require('bcryptjs');
const store = require('../src/data/store');
const app = require('../server');

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures += 1; };

function client(base) {
  let cookie = '';
  return async (url, opts = {}) => {
    const res = await fetch(base + url, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), cookie } });
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    const text = res.headers.get('content-type') && /json|html|text/.test(res.headers.get('content-type')) ? await res.text() : '';
    return { status: res.status, text, location: res.headers.get('location') };
  };
}
const csrfOf = (html) => (html.match(/name="_csrf" value="([a-f0-9]+)"/) || [])[1];

(async () => {
  await app.ready;
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    // ---------- public ----------
    const anon = client(base);
    const pages = ['/', '/ban-do', '/tai-nguyen-rung', '/tai-nguyen-rung?tab=muc-dich', '/bien-dong-rung', '/canh-bao-chay', '/canh-bao-chay?tab=lich-su',
      '/tin-tuc', '/phan-anh', '/tai-lieu', '/gioi-thieu', '/thoi-tiet', '/thong-ke', '/thong-ke?chu_de=chay', '/huong-dan'];
    for (const p of pages) { const r = await anon(p); ok(r.status === 200 && !/Lỗi hệ thống/.test(r.text), `GET ${p} → ${r.status}`); }
    for (const p of ['/api/public/map/layers', '/api/public/boundaries/communes', '/api/public/fire/danger', '/api/public/fire/hotspots', '/api/public/forest/change', '/api/public/forest/candidates', '/api/public/alerts', '/api/public/search?q=ngoc']) {
      const r = await anon(p); let j = null; try { j = JSON.parse(r.text); } catch { /* not json */ }
      ok(r.status === 200 && j !== null, `API ${p}`);
    }
    const fd = JSON.parse((await anon('/api/public/fire/danger')).text);
    ok(fd.communes.length === 40 && fd.communes.every((c) => c.forecast.length === 7), 'Dự báo nguy cơ cháy: 40 xã × 7 ngày');
    ok(fd.communes.every((c) => [1, 2, 3, 4, 5].includes(c.current.cls)), 'Cấp nguy cơ hợp lệ 1–5');
    const ch = JSON.parse((await anon('/api/public/forest/change')).text);
    ok(ch.forecast.validation.auc > 0.7, `Mô hình mất rừng AUC=${ch.forecast.validation.auc}`);
    ok((await anon('/.env')).status === 404 && (await anon('/data/web/fire-danger.json')).status === 404, 'Không lộ .env và thư mục data/');
    ok((await anon('/quan-tri')).status === 302, 'Quản trị yêu cầu đăng nhập');
    ok((await anon('/thong-ke/xuat.xlsx')).status === 200, 'Xuất Excel');

    // ---------- citizen report ----------
    let r = await anon('/phan-anh');
    const fdata = new FormData();
    fdata.set('_csrf', csrfOf(r.text)); fdata.set('type', 'chay-rung'); fdata.set('description', 'Kiểm thử tự động: khói gần bìa rừng');
    fdata.set('lat', '14.6'); fdata.set('lon', '107.9'); fdata.set('name', 'Người kiểm thử'); fdata.set('phone', '0900000000');
    r = await anon('/phan-anh', { method: 'POST', body: fdata });
    ok(r.status === 302 && /da_gui=PA-/.test(r.location || ''), 'Gửi phản ánh tạo mã hồ sơ');
    const code = decodeURIComponent((r.location.match(/da_gui=([^&]+)/) || [])[1]);
    r = await anon(`/phan-anh?ma=${code}`);
    ok(r.text.includes(code) && !r.text.includes('0900000000'), 'Tra cứu không lộ số điện thoại');
    const badForm = new FormData(); badForm.set('description', 'thiếu token csrf nhưng đủ dài'); badForm.set('lat', '14.6'); badForm.set('lon', '107.9');
    ok((await anon('/phan-anh', { method: 'POST', body: badForm })).status === 403, 'Từ chối phản ánh thiếu CSRF');

    // ---------- staff accounts ----------
    const mk = (username, role) => store.insert('users', { username, name: username, role, active: true, password_hash: bcrypt.hashSync('Test-password-1', 8) });
    mk('qtv', 'admin'); mk('canbo', 'specialist'); mk('lanhdao', 'leader');
    const login = async (u) => {
      const c = client(base); const l = await c('/quan-tri/dang-nhap');
      const res = await c('/quan-tri/dang-nhap', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrfOf(l.text), username: u, password: 'Test-password-1', next: '/quan-tri' }) });
      ok(res.status === 302 && res.location === '/quan-tri', `Đăng nhập ${u}`);
      return c;
    };
    const admin = await login('qtv');
    for (const p of ['/quan-tri', '/quan-tri/du-lieu', '/quan-tri/anh-ve-tinh', '/quan-tri/tai-nguyen', '/quan-tri/phan-tich', '/quan-tri/canh-bao', '/quan-tri/canh-bao?tab=nguy-co', '/quan-tri/canh-bao?tab=bien-dong',
      '/quan-tri/tin-tuc', '/quan-tri/tin-tuc/moi', '/quan-tri/phan-anh', '/quan-tri/tai-lieu', '/quan-tri/nguoi-dung', '/quan-tri/nhat-ky', '/quan-tri/cai-dat']) {
      const res = await admin(p); ok(res.status === 200 && !/Lỗi hệ thống/.test(res.text), `Admin GET ${p} → ${res.status}`);
    }
    const page = await admin('/quan-tri/canh-bao');
    const token = csrfOf(page.text);
    const post = (c, url, body, t = token) => c(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: t, ...body }) });
    const hs = JSON.parse((await anon('/api/public/fire/hotspots')).text).features;
    if (hs.length) {
      r = await post(admin, '/quan-tri/canh-bao/diem-nong', { ref: hs[0].properties.id, status: 'confirmed' });
      ok(r.status === 403, 'Quản trị hệ thống không được xác minh điểm nóng (đúng phân quyền)');
    }
    const spec = await login('canbo');
    const sTok = csrfOf((await spec('/quan-tri/canh-bao')).text);
    if (hs.length) {
      r = await post(spec, '/quan-tri/canh-bao/diem-nong', { ref: hs[0].properties.id, status: 'verifying', note: 'giao kiểm tra' }, sTok);
      ok(r.status === 302, 'Cán bộ chuyên môn cập nhật trạng thái điểm nóng');
      const after = JSON.parse((await anon('/api/public/fire/hotspots')).text).features.find((f) => f.properties.id === hs[0].properties.id);
      ok(after.properties.status === 'verifying', 'Trạng thái điểm nóng hiển thị ở API công khai');
    }
    const cand = JSON.parse((await anon('/api/public/forest/candidates')).text).features[0];
    r = await post(spec, '/quan-tri/canh-bao/bien-dong', { ref: cand.properties.id, status: 'seasonal', note: 'rụng lá' }, sTok);
    ok(r.status === 302, 'Xác minh biến động nghi vấn');
    const rep = store.find('reports', (x) => x.code === code);
    r = await post(spec, `/quan-tri/phan-anh/${rep.id}`, { status: 'verifying', note: 'Đã giao kiểm lâm địa bàn', note_public: 'on', public: 'on' }, sTok);
    ok(r.status === 302, 'Cập nhật xử lý phản ánh');
    r = await anon('/phan-anh');
    ok(r.text.includes(code), 'Phản ánh công khai sau khi cán bộ cho phép');
    const art = store.all('articles')[0];
    r = await post(spec, `/quan-tri/tin-tuc/${art.id}/trang-thai`, { status: 'published' }, sTok);
    ok(store.get('articles', art.id).status === 'published', 'Xuất bản tin');
    const leader = await login('lanhdao');
    const lTok = csrfOf((await leader('/quan-tri')).text);
    ok((await leader('/quan-tri/nguoi-dung')).status === 403, 'Lãnh đạo không vào quản lý người dùng');
    r = await post(leader, '/quan-tri/canh-bao/nguy-co', { ref: 'FD-test', status: 'approved' }, lTok);
    ok(r.status === 302, 'Lãnh đạo được phê duyệt công bố cảnh báo');
    ok(store.all('audit').some((a) => a.action === 'hotspot.status') && store.all('audit').some((a) => a.action === 'auth.login'), 'Nhật ký ghi nhận thao tác');
  } catch (e) {
    console.error(e); failures += 1;
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(failures ? `\n${failures} kiểm tra lỗi` : '\nTất cả kiểm tra đạt');
    process.exit(failures ? 1 : 0);
  }
})();
