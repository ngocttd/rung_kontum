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

    // ---------- phản ánh: quản trị/lãnh đạo cập nhật, đánh dấu đã kiểm tra, bản đồ phản ánh ----------
    const aTok = csrfOf((await admin('/quan-tri/phan-anh')).text);
    r = await post(admin, `/quan-tri/phan-anh/${rep.id}`, { status: 'processing', note: 'Quản trị cập nhật' }, aTok);
    ok(r.status === 302 && store.get('reports', rep.id).status === 'processing', 'Quản trị cập nhật trạng thái phản ánh');
    r = await post(leader, `/quan-tri/phan-anh/${rep.id}/kiem-tra`, {}, lTok);
    ok(r.status === 302 && store.get('reports', rep.id).reviewed_by === 'lanhdao', 'Lãnh đạo đánh dấu phản ánh đã kiểm tra');
    r = await admin('/quan-tri/phan-anh?kiem_tra=roi');
    ok(r.status === 200 && r.text.includes(code) && r.text.includes('Đã kiểm tra'), 'Lọc phản ánh đã kiểm tra');
    r = await admin('/quan-tri/phan-anh?xem=ban-do');
    ok(r.status === 200 && r.text.includes('id="map"') && r.text.includes(code) && !/href="\/ban-do\?lop=/.test(r.text), 'Tab Bản đồ phản ánh hiển thị điểm phản ánh (không dẫn sang trang bản đồ chung)');

    // ---------- điểm cháy nhập tay: chung luồng với FIRMS ----------
    const sTok2 = csrfOf((await spec('/quan-tri/canh-bao?tab=nhap-tay')).text);
    ok(Boolean(sTok2), 'Tab Nhập thủ công điểm cháy mở được');
    const nowVN = new Date(Date.now() + 7 * 3600e3 - 3600e3).toISOString().slice(0, 16);
    r = await post(spec, '/quan-tri/canh-bao/nhap-tay', { lat: '14.70', lon: '107.95', observed_at: nowVN, source_kind: 'chong-chay', area_ha: '1,5', description: 'Tổ chống cháy xã báo cháy thảm cỏ dưới tán rừng, SĐT 0911111111', status: 'confirmed' }, sTok2);
    let mp = store.all('fire_points').slice(-1)[0];
    ok(r.status === 302 && mp && mp.area_ha === 1.5, 'Cán bộ nhập tay điểm cháy');
    const pubHs = JSON.parse((await anon('/api/public/fire/hotspots')).text).features.find((f) => f.properties.id === `man-${mp.code}`);
    ok(pubHs && pubHs.properties.sensor === 'MANUAL' && pubHs.properties.status === 'confirmed', 'Điểm nhập tay hiện chung danh sách điểm nóng, trạng thái Xác nhận cháy');
    ok(pubHs && !JSON.stringify(pubHs.properties).includes('0911111111') && !pubHs.properties.manual.created_by, 'API công khai không lộ mô tả/người nhập điểm cháy');
    ok((await spec('/quan-tri/canh-bao?nguon=tay')).text.includes(mp.code), 'Lọc nguồn Nhập thủ công trong quản lý cảnh báo');
    r = await post(leader, '/quan-tri/canh-bao/nhap-tay', { lat: '14.5', lon: '108.0', observed_at: nowVN, source_kind: 'nguoi-dan', description: 'Người dân gọi báo có khói', status: 'confirmed' }, lTok);
    mp = store.all('fire_points').slice(-1)[0];
    ok(r.status === 302 && store.getDecision('hotspot', `man-${mp.code}`).status === 'new', 'Lãnh đạo nhập tin báo: chỉ ở trạng thái Mới phát hiện');
    const before = store.all('fire_points').length;
    r = await post(spec, '/quan-tri/canh-bao/nhap-tay', { lat: '21.0', lon: '105.8', observed_at: nowVN, source_kind: 'khac', description: 'ngoài vùng' }, sTok2);
    ok(r.status === 302 && /nhap-tay/.test(r.location) && store.all('fire_points').length === before, 'Từ chối toạ độ ngoài Kon Tum');
    r = await post(spec, `/quan-tri/canh-bao/diem-nong`, { ref: `man-${mp.code}`, status: 'rejected', note: 'đốt rác' }, sTok);
    ok(store.getDecision('hotspot', `man-${mp.code}`).status === 'rejected', 'Xác minh điểm nhập tay bằng cùng quy trình điểm nóng');

    // phản ánh "Cháy rừng" → điểm cháy
    const fireRep = store.insert('reports', { code: store.nextCode('PA'), type: 'chay-rung', description: 'Khói lớn trên sườn đồi', lat: 14.66, lon: 107.88, status: 'received', photos: [], public: false, public_photos: false, reporter: {}, timeline: [{ at: store.now(), status: 'received', by: 'system' }] });
    r = await post(spec, `/quan-tri/phan-anh/${fireRep.id}/diem-chay`, { confirm: '1', note: 'Đã gọi xác nhận' }, sTok);
    const linked = store.get('reports', fireRep.id).fire_point;
    ok(r.status === 302 && linked && store.getDecision('hotspot', `man-${linked}`).status === 'confirmed', 'Tạo điểm cháy từ phản ánh và xác nhận cháy');
    r = await post(spec, `/quan-tri/phan-anh/${fireRep.id}/diem-chay`, { confirm: '1' }, sTok);
    ok(store.all('fire_points').filter((x) => x.report_code === fireRep.code).length === 1, 'Không tạo trùng điểm cháy cho một phản ánh');
    // MobileGIS: cán bộ báo cháy bằng GPS = xác nhận cháy; người dân báo cháy = chỉ hồ sơ chờ xử lý
    const field = require('../src/services/field');
    const cbU = store.find('users', (u) => u.username === 'canbo');
    const ctr = { lat: 14.62, lon: 107.98 };
    const sRep = (await field.createReport({ sub: cbU.id, role: 'specialist' }, { type: 'chay-rung', description: 'Cán bộ phát hiện cháy tại hiện trường (kiểm thử)', ...ctr, location_source: 'gps', gps_accuracy: 6 })).report;
    ok(sRep.fire_point && store.getDecision('hotspot', `man-${sRep.fire_point}`).status === 'confirmed', 'MobileGIS: cán bộ báo cháy bằng GPS → điểm cháy Xác nhận cháy');
    const cRep = (await field.createReport(null, { type: 'chay-rung', description: 'Người dân thấy khói (kiểm thử)', ...ctr, location_source: 'gps' })).report;
    ok(!cRep.fire_point, 'MobileGIS: người dân báo cháy không tự thành sự kiện đã xác minh');
    const mRep = (await field.createReport({ sub: cbU.id, role: 'specialist' }, { type: 'chay-rung', description: 'Cán bộ chọn vị trí trên bản đồ (kiểm thử)', ...ctr, location_source: 'map' })).report;
    ok(!mRep.fire_point, 'MobileGIS: vị trí chọn trên bản đồ (không GPS) không tự xác nhận cháy');
    // ---------- quy tắc hiển thị theo thời gian (bản đồ hiện hành ↔ lịch sử) ----------
    const repoR = require('../src/data/repo');
    const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();
    const onPub = (id) => repoR.hotspots().some((h) => h.id === id);
    const onStaff = (id) => repoR.hotspots({ staff: true }).some((h) => h.id === id);
    const mkOld = (n) => store.insert('fire_points', { code: store.nextCode('CH'), observed_at: daysAgo(n), source_kind: 'kiem-lam', description: 'điểm cũ (kiểm thử)', lat: 14.6, lon: 107.9, commune_code: null, commune_name: null, created_by: 'canbo' });
    const decide = (ref, status, atDaysAgo) => { store.setDecision('hotspot', ref, { status }, { username: 'canbo', role: 'specialist' }); const d = store.getDecision('hotspot', ref); d.history[d.history.length - 1].at = daysAgo(atDaysAgo); };
    const o1 = `man-${mkOld(10).code}`;
    ok(!onPub(o1), 'Chưa xác minh quá 7 ngày → ẩn khỏi bản đồ');
    decide(o1, 'confirmed', 9);
    ok(onPub(o1) && repoR.hotspots().find((h) => h.id === o1).pinned, 'Xác nhận cháy → vẫn hiện dù đã quá 7 ngày (đang theo dõi)');
    decide(o1, 'handling', 1);
    ok(onPub(o1), 'Đang xử lý → vẫn hiện');
    decide(o1, 'closed', 2);
    ok(onPub(o1), 'Kết thúc 2 ngày trước → còn hiện (≤ 7 ngày sau khi đóng)');
    decide(o1, 'closed', 8);
    ok(!onPub(o1), 'Kết thúc 8 ngày trước → chỉ còn trong lịch sử');
    const o2 = `man-${mkOld(1).code}`;
    decide(o2, 'rejected', 0);
    ok(!onPub(o2) && onStaff(o2), '“Không phải cháy rừng” → ẩn ngay trên bản đồ công khai, cán bộ vẫn thấy trong danh sách xác minh');
    decide(o2, 'rejected', 8);
    ok(!onStaff(o2), '“Không phải cháy rừng” quá 7 ngày → cán bộ cũng chỉ xem trong lịch sử');
    // điểm FIRMS đã rời tệp 7 ngày nhưng hồ sơ còn mở → dựng lại từ ảnh chụp lưu trong quyết định
    const fref = 'J1_VIIRS-2026-09-01-0600-14.5000-107.9000';
    store.setDecision('hotspot', fref, { status: 'handling', note: 'kiểm thử' }, { username: 'canbo', role: 'specialist' });
    store.update('decisions', store.getDecision('hotspot', fref).id, { snapshot: { lon: 107.9, lat: 14.5, sensor: 'J1_VIIRS', satellite: 'N20', utc: '2026-09-01T06:00:00Z', confidence: 'nominal', frp: 4.2, brightness: 330, daynight: 'D', version: '2.0NRT', context: null } });
    const pinned = repoR.hotspots().find((h) => h.id === fref);
    ok(pinned && pinned.pinned && pinned.sensorLabel === 'VIIRS NOAA-20' && pinned.status === 'handling', 'Điểm FIRMS cũ đang xử lý vẫn hiện trên bản đồ (từ ảnh chụp thuộc tính)');
    ok(JSON.parse((await anon('/api/public/fire/hotspots')).text).features.some((f) => f.properties.id === fref), 'API bản đồ công khai trả điểm đang theo dõi');
    for (const p of ['/canh-bao-chay', '/ban-do', '/tai-nguyen-rung', '/bien-dong-rung']) { const res = await anon(p); ok(res.status === 200, `GET ${p} sau khi có điểm nhập tay → ${res.status}`); }
  } catch (e) {
    console.error(e); failures += 1;
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(failures ? `\n${failures} kiểm tra lỗi` : '\nTất cả kiểm tra đạt');
    process.exit(failures ? 1 : 0);
  }
})();
