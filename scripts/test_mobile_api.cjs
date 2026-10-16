// Kiểm thử API MobileGIS theo kịch bản TC01–TC12 (Đặc tả MobileGIS mục 10), phía máy chủ, trên PostGIS thật.
// Tạo người dùng/bản ghi thử rồi dọn sạch. Usage: node scripts/test_mobile_api.cjs
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
process.env.WEATHER_REFRESH_MINUTES = '0';
process.env.MOBILE_DEMO_LOGIN = 'true';
const app = require('../server');
const store = require('../src/data/store');
const db = require('../src/db/pool');
const repo = require('../src/data/repo');

let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) failures += 1; };
const uuid = () => crypto.randomUUID();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

(async () => {
  await app.ready;
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, { token, body, raw, type } = {}) => {
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body) headers['content-type'] = 'application/json';
    if (raw) headers['content-type'] = type;
    const res = await fetch(base + url, { method, headers, body: raw || (body ? JSON.stringify(body) : undefined) });
    let j = null; try { j = await res.json(); } catch { /* */ }
    return { status: res.status, j };
  };
  const users = []; const reportIds = []; const asgIds = []; const survIds = []; const verIds = [];
  try {
    const communes = repo.communes();
    const [c1, c2] = [communes[0], communes[1]];
    const mk = (username, role, scope) => { const old = store.find('users', (x) => x.username === username); if (old) store.remove('users', old.id); const u = store.insert('users', { username, name: username, role, scope: scope || null, active: true, password_hash: bcrypt.hashSync('Test-password-1', 8) }); users.push(u.id); return u; };
    mk('t_m_dan', 'citizen'); mk('t_m_cb', 'specialist', c1.code); mk('t_m_cb2', 'specialist', c2.code); mk('t_m_ld', 'leader');
    await store.drain();
    const login = async (u, p = 'Test-password-1') => (await call('POST', '/api/mobile/auth/login', { body: { username: u, password: p } })).j;

    // TC01 guest: published layers only, no internal task layer
    const L = await call('GET', '/api/mobile/layers?bbox=107.3,13.9,108.6,15.5&zoom=9');
    ok(L.status === 200 && L.j.raster.length > 5 && !L.j.vector.some((v) => v.internal), 'TC01 Khách xem lớp công bố; không có lớp nội bộ');
    const boot = await call('GET', '/api/mobile/bootstrap');
    ok(boot.j.features.demo_login && boot.j.demo_roles.length >= 5 && boot.j.communes.length === 40, 'Bootstrap: danh mục, 40 xã, đăng nhập nhanh theo vai trò');

    // TC02 brute force
    let last;
    for (let i = 0; i < 6; i++) last = await call('POST', '/api/mobile/auth/login', { body: { username: 't_m_dan', password: 'sai-mat-khau' } });
    ok(last.status === 429 && last.j.code === 'LOCKED', 'TC02 Đăng nhập sai nhiều lần bị khoá tạm thời, có thông báo');

    // demo quick login for every role
    const roles = ['citizen', 'specialist', 'specialist_commune', 'leader', 'admin'];
    const demo = {};
    for (const role of roles) demo[role] = (await call('POST', '/api/mobile/auth/demo', { body: { role } })).j;
    ok(roles.every((r) => demo[r] && demo[r].access_token), 'Đăng nhập nhanh demo cho cả 5 vai trò');

    const cb = await login('t_m_cb'); const cb2 = await login('t_m_cb2'); const ld = await login('t_m_ld');
    const dan = demo.citizen;

    // TC03 report with photo + GPS
    const pre = await call('POST', '/api/mobile/uploads/presign', { token: dan.access_token, body: { mime: 'image/png', bytes: PNG.length, owner_kind: 'report' } });
    const up = await call('PUT', `${pre.j.upload_url.replace('/api/mobile', '/api/mobile')}?lat=14.6&lon=108.0&accuracy=6`, { raw: PNG, type: 'image/png' });
    const ctr = c1.centroid || [108.0, 14.6];
    const cu = uuid();
    const rep = await call('POST', '/api/mobile/reports', { token: dan.access_token, body: { client_uuid: cu, type: 'chay-rung', description: 'Khói lớn trên sườn đồi phía sau thôn (kiểm thử tự động)', lat: ctr[1], lon: ctr[0], gps_accuracy: 8, location_source: 'gps', attachments: [up.j.object_key] } });
    if (rep.j && rep.j.report) reportIds.push(rep.j.report.id);
    ok(rep.status === 201 && /^PA-/.test(rep.j.report.code) && rep.j.report.status === 'received' && rep.j.report.photos.length === 1, 'TC03 Gửi phản ánh có ảnh/GPS: sinh mã, lưu bằng chứng, trạng thái tiếp nhận');
    const reused = await call('POST', '/api/mobile/reports', { token: demo.specialist.access_token, body: { type: 'khac', description: 'Thử dùng lại tệp của người khác', lat: ctr[1], lon: ctr[0], attachments: [up.j.object_key] } });
    ok(reused.status === 409 || reused.status === 403, 'Không dùng lại tệp đính kèm của hồ sơ khác');
    const pub = await call('GET', `/api/mobile/reports/${rep.j.report.code}`);
    ok(pub.status === 200 && !pub.j.reporter && pub.j.lat === Math.round(ctr[1] * 100) / 100, 'Tra cứu công khai không lộ người gửi, toạ độ làm tròn');

    // TC04 offline report → sync twice, no duplicate
    const cu2 = uuid();
    const item = { client_uuid: cu2, entity: 'report', operation: 'create', payload: { type: 'pha-rung', description: 'Phát hiện cây bị chặt (gửi ngoại tuyến – kiểm thử)', lat: ctr[1], lon: ctr[0], gps_accuracy: 12 } };
    const s1 = await call('POST', '/api/mobile/sync/batch', { token: dan.access_token, body: { items: [item] } });
    const s2 = await call('POST', '/api/mobile/sync/batch', { token: dan.access_token, body: { items: [item] } });
    const n = store.filter('reports', (r) => r.client_uuid === cu2).length;
    store.filter('reports', (r) => r.client_uuid === cu2).forEach((r) => reportIds.push(r.id));
    ok(s1.j.results[0].result === 'applied' && s2.j.results[0].result === 'duplicate' && n === 1, 'TC04 Phản ánh ngoại tuyến đồng bộ 2 lần không trùng hồ sơ, có lịch sử sync');
    const mine = await call('GET', '/api/mobile/reports/mine', { token: dan.access_token });
    ok(mine.j.total >= 2, 'Người dân xem danh sách phản ánh của mình');

    // TC05 assignment in commune c1; officer of c2 is refused
    const asg = await call('POST', '/api/mobile/assignments', { token: ld.access_token, body: { kind: 'report', ref_id: rep.j.report.code, instructions: 'Kiểm tra hiện trường (kiểm thử)' } });
    if (asg.j && asg.j.id) asgIds.push(asg.j.id);
    ok(asg.status === 201 && asg.j.scope_id === c1.code, 'Lãnh đạo giao nhiệm vụ theo địa bàn');
    const deny = await call('GET', `/api/mobile/assignments/${asg.j.id}`, { token: cb2.access_token });
    ok(deny.status === 403 && deny.j.code === 'OUT_OF_SCOPE', 'TC05 Cán bộ ngoài địa bàn mở nhiệm vụ bị từ chối');
    const open = await call('GET', `/api/mobile/assignments/${asg.j.id}`, { token: cb.access_token });
    const acc = await call('POST', `/api/mobile/assignments/${asg.j.id}/accept`, { token: cb.access_token, body: { base_version: open.j.version } });
    ok(open.status === 200 && acc.j.status === 'accepted', 'Cán bộ địa bàn mở và nhận nhiệm vụ');

    // TC09 offline conflict on assignment (stale base_version) → conflict, not overwritten
    const conf = await call('POST', '/api/mobile/sync/batch', { token: cb.access_token, body: { items: [{ client_uuid: uuid(), entity: 'assignment', operation: 'start', base_version: 1, payload: { id: asg.j.id } }] } });
    const after = await call('GET', `/api/mobile/assignments/${asg.j.id}`, { token: cb.access_token });
    const cl = await call('GET', '/api/mobile/sync/conflicts', { token: cb.access_token });
    ok(conf.j.results[0].result === 'conflict' && after.j.status === 'accepted' && cl.j.length === 1, 'TC09 Xung đột ngoại tuyến: không ghi đè âm thầm, có danh sách xử lý');
    const res9 = await call('POST', `/api/mobile/sync/conflicts/${cl.j[0].id}/resolve`, { token: cb.access_token, body: { action: 'apply_mine' } });
    ok(res9.status === 200 && (await call('GET', `/api/mobile/assignments/${asg.j.id}`, { token: cb.access_token })).j.status === 'in_progress', 'Người dùng chọn áp dụng thay đổi của mình sau khi xem xung đột');

    // TC06 dipterocarp dry season
    const pt = [ctr[0] + 0.001, ctr[1] + 0.001];
    const sv = await call('POST', '/api/mobile/surveys', { token: cb.access_token, body: { client_uuid: uuid(), geometry: { type: 'Point', coordinates: pt }, forest_type: 'rung-khop', season: 'dry', leaf_state: 'leafless', change_cause: 'khai-thac', canopy_cover: 15, gps_accuracy: 5, notes: 'NDVI thấp (kiểm thử)' } });
    if (sv.j && sv.j.survey) survIds.push(sv.j.survey.id);
    ok(sv.status === 201 && sv.j.survey.is_dipterocarp && sv.j.warnings.length > 0 && /chưa đủ căn cứ/.test(sv.j.survey.notes), 'TC06 Rừng khộp mùa khô: không tự kết luận mất rừng chỉ do NDVI thấp');
    const outScope = await call('POST', '/api/mobile/surveys', { token: cb2.access_token, body: { geometry: { type: 'Point', coordinates: pt }, season: 'wet' } });
    ok(outScope.status === 403, 'Khảo sát ngoài địa bàn bị từ chối');

    // TC07 unverified hotspot label
    const hs = await call('GET', '/api/mobile/fire/hotspots');
    const unv = hs.j.features.filter((f) => ['new', 'assigned', 'verifying'].includes(f.properties.status));
    ok(unv.every((f) => f.properties.verification_label === 'Chưa xác minh'), `TC07 Điểm nóng chưa xác minh có nhãn “Chưa xác minh” (${unv.length} điểm)`);

    // TC08 verification + review by another person
    const ver = await call('POST', '/api/mobile/verifications', { token: cb.access_token, body: { client_uuid: uuid(), alert_kind: 'report', alert_id: rep.j.report.code, verdict: 'confirmed', severity: 'Trung bình', description: 'Có dấu vết đốt thực bì (kiểm thử)', lat: ctr[1], lon: ctr[0], gps_accuracy: 4, recommendation: 'Tăng cường tuần tra' } });
    if (ver.j && ver.j.verification) verIds.push(ver.j.verification.id);
    const selfRev = await call('POST', `/api/mobile/verifications/${ver.j.verification.id}/review`, { token: cb.access_token, body: { decision: 'approved' } });
    const rev = await call('POST', `/api/mobile/verifications/${ver.j.verification.id}/review`, { token: ld.access_token, body: { decision: 'approved', note: 'Đồng ý (kiểm thử)' } });
    const repAfter = store.find('reports', (r) => r.code === rep.j.report.code);
    let immutable = false;
    try { await db.query("UPDATE mobile.incident_verifications SET verdict = 'not_confirmed' WHERE id = $1", [ver.j.verification.id]); } catch { immutable = true; }
    ok(ver.status === 201 && selfRev.status === 403 && rev.j.review_status === 'approved' && rev.j.reviews.length === 1 && repAfter.status === 'processing' && immutable,
      'TC08 Xác minh và duyệt: lưu bằng chứng, người duyệt, lịch sử bất biến; không tự duyệt');

    // TC10 restricted document → not public
    const internal = (await db.query("SELECT f.id FROM maps.map_files f JOIN maps.map_datasets d ON d.id = f.dataset_id WHERE d.access = 'internal' OR d.status <> 'published' LIMIT 1")).rows[0];
    if (internal) ok((await fetch(`${base}/ban-do-chuyen-de/tep/${internal.id}`)).status === 404, 'TC10 Tải tài liệu hạn chế quyền bị máy chủ từ chối');
    const file = await call('GET', `/api/mobile/files/${up.j.object_key}`);
    ok(file.status === 404, 'Ảnh phản ánh chưa công khai không xem được khi chưa đăng nhập');

    // TC11 is a client-side scenario (draft kept locally); server side: an interrupted upload leaves no report
    const pre2 = await call('POST', '/api/mobile/uploads/presign', { token: dan.access_token, body: { mime: 'image/png', bytes: PNG.length, owner_kind: 'report' } });
    ok(pre2.status === 200 && !store.find('reports', (r) => r.photos && r.photos.includes(pre2.j.upload_url)), 'TC11 (máy chủ) tải dở dang không tạo hồ sơ; nháp giữ trên máy');

    // TC12 logout revokes tokens
    const lo = await call('POST', '/api/mobile/auth/logout', { token: cb2.access_token, body: { refresh_token: cb2.refresh_token } });
    const afterLo = await call('GET', '/api/mobile/me', { token: cb2.access_token });
    const ref = await call('POST', '/api/mobile/auth/refresh', { body: { refresh_token: cb2.refresh_token } });
    ok(lo.status === 200 && afterLo.status === 401 && ref.status === 401, 'TC12 Đăng xuất: token truy cập và refresh token bị thu hồi');
    const r1 = await call('POST', '/api/mobile/auth/refresh', { body: { refresh_token: ld.refresh_token } });
    const replay = await call('POST', '/api/mobile/auth/refresh', { body: { refresh_token: ld.refresh_token } });
    ok(r1.status === 200 && replay.status === 401 && (await call('GET', '/api/mobile/me', { token: r1.j.access_token })).status === 401, 'Refresh token xoay vòng; dùng lại token cũ thu hồi mọi phiên');

    // ---- web ↔ mobile sync on the same data ----
    const web = (() => { let cookie = ''; return async (url, opts = {}) => {
      const res = await fetch(base + url, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), cookie } });
      const set = res.headers.getSetCookie ? res.headers.getSetCookie() : []; if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
      return { status: res.status, text: /html|json/.test(res.headers.get('content-type') || '') ? await res.text() : '' }; }; })();
    const csrfOf = (h) => (h.match(/name="_csrf" value="([a-f0-9]+)"/) || [])[1];
    let pg0 = await web('/quan-tri/dang-nhap');
    await web('/quan-tri/dang-nhap', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrfOf(pg0.text), username: 't_m_cb', password: 'Test-password-1', next: '/quan-tri' }) });
    const rep2 = store.find('reports', (r) => r.client_uuid === cu2);
    const det = await web(`/quan-tri/phan-anh/${rep2.id}`);
    ok(det.status === 200 && det.text.includes('Ứng dụng MobileGIS'), 'Web: phản ánh gửi từ MobileGIS hiện ở trang quản trị (nguồn, GPS)');
    await web(`/quan-tri/phan-anh/${rep2.id}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrfOf(det.text), status: 'verifying', assigned_to: 't_m_cb', note: 'Giao xác minh (kiểm thử)', note_public: 'on' }) });
    const list2 = await call('GET', '/api/mobile/assignments', { token: cb.access_token });
    const webTask = list2.j.items.find((a) => a.kind === 'report' && a.ref_id === rep2.code);
    if (webTask) asgIds.push(webTask.id);
    ok(webTask && webTask.assignee === 't_m_cb', 'Web → Mobile: phân công trên web tạo nhiệm vụ trong ứng dụng của cán bộ');
    const mine2 = await call('GET', `/api/mobile/reports/${rep2.code}`, { token: dan.access_token });
    ok(mine2.j.status === 'verifying' && mine2.j.timeline.some((t) => t.note === 'Giao xác minh (kiểm thử)'), 'Web → Mobile: người dân thấy trạng thái và ghi chú công khai cập nhật từ web');
    const fieldPage = await web('/quan-tri/hien-truong?tab=xac-minh');
    ok(fieldPage.text.includes(ver.j.verification.code), 'Mobile → Web: kết quả xác minh từ ứng dụng hiện ở trang Nhiệm vụ hiện trường');

    // citizen cannot use staff endpoints; web admin refuses citizens
    ok((await call('POST', '/api/mobile/verifications', { token: dan.access_token, body: {} })).status === 403, 'Người dân không gửi được kết quả xác minh');
    const reg = await call('POST', '/api/mobile/auth/register', { body: { name: 'Thử đăng ký', phone: '0912345678', password: 'Matkhau-123' } });
    if (reg.j && reg.j.user) users.push(reg.j.user.id);
    ok(reg.status === 201 && reg.j.user.role === 'citizen', 'Đăng ký tài khoản người dân');
    const notif = await call('GET', '/api/mobile/notifications', { token: dan.access_token });
    ok(notif.status === 200 && notif.j.items.every((x) => x.kind !== 'hotspot'), 'Thông báo không phát từ điểm nóng chưa xác minh');
  } catch (e) { console.error(e); failures += 1; } finally {
    // cleanup: in-memory cache first, then the database (admin DB account: verifications are immutable for the app role)
    await store.drain();
    await require('./purge_mobile_test.cjs')().catch((e) => console.warn('Dọn dữ liệu thử lỗi:', e.message));
    for (const id of reportIds) store.remove('reports', id);
    for (const id of users) store.remove('users', id);
    await store.drain();
    server.close();
    console.log(failures ? `\n${failures} kiểm tra lỗi` : '\nTất cả kiểm tra API MobileGIS đạt');
    process.exit(failures ? 1 : 0);
  }
})();
