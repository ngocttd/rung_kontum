const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const sharp = require('sharp');
const config = require('../config');
const { paths } = config;
const repo = require('../data/repo');
const store = require('../data/store');
const { readJson } = require('../data/files');
const alerts = require('../services/alerts');
const content = require('../services/content');
const reports = require('../services/reports');
const firepoints = require('../services/firepoints');
const jobs = require('../services/jobs');
const weatherSvc = require('../services/weather');
const firmsSvc = require('../services/firms');
const { ROLES, STAFF_ROLES, can, requireLogin, requirePerm, checkCsrf, rateLimit } = require('../middleware/security');

const r = express.Router();
const memUpload = (maxMb, filter) => multer({ storage: multer.memoryStorage(), limits: { fileSize: maxMb * 1024 * 1024, files: 1 }, fileFilter: (req, f, cb) => cb(null, filter.test(f.mimetype) || filter.test(f.originalname)) });
const flash = (req, type, text) => { req.session.flash = { type, text }; };
const me = (req) => req.session.user;
const back = (req, res, fallback) => res.redirect(req.get('referer') || fallback);

r.use((req, res, next) => { res.locals.ROLES = ROLES; res.locals.section = ''; next(); });

// ---------- authentication ----------
r.get('/dang-nhap', (req, res) => {
  if (me(req)) return res.redirect('/quan-tri');
  return res.render('admin/login', { title: 'Đăng nhập quản trị', next: req.query.next || '/quan-tri', error: null, noUsers: store.all('users').length === 0 });
});

r.post('/dang-nhap', rateLimit('login', 10, 15 * 60e3), async (req, res) => {
  await store.refresh('users').catch(() => {});
  const u = store.find('users', (x) => x.username === String(req.body.username || '').trim().toLowerCase());
  const ok = u && u.active && STAFF_ROLES.includes(u.role) && await bcrypt.compare(String(req.body.password || ''), u.password_hash);
  if (!ok) {
    store.audit(null, 'auth.failed', String(req.body.username || '').slice(0, 60));
    return res.status(401).render('admin/login', { title: 'Đăng nhập quản trị', next: req.body.next || '/quan-tri', error: 'Tên đăng nhập hoặc mật khẩu không đúng.', noUsers: false });
  }
  return req.session.regenerate(() => {
    req.session.user = { id: u.id, username: u.username, name: u.name, role: u.role, scope: u.scope || null };
    store.update('users', u.id, { last_login: store.now() });
    store.audit(req.session.user, 'auth.login', u.username);
    const nextUrl = String(req.body.next || '/quan-tri');
    res.redirect(nextUrl.startsWith('/') && !nextUrl.startsWith('//') ? nextUrl : '/quan-tri');
  });
});

r.post('/dang-xuat', (req, res) => { store.audit(me(req), 'auth.logout', me(req) && me(req).username); req.session.destroy(() => res.redirect('/')); });

r.use(requireLogin);

// ---------- A01 dashboard ----------
r.get('/', requirePerm('dashboard.view'), (req, res) => {
  const hs = repo.hotspots();
  const fd = repo.fireDanger();
  const peak = fd ? fd.communes.filter((c) => Math.max(...[c.current, ...c.forecast].map((d) => d.cls)) >= 3).length : 0;
  res.render('admin/dashboard', {
    title: 'Tổng quan hệ thống', section: 'dashboard', summary: repo.forestSummary(), hotspots: hs, peak, fd,
    reportCounts: reports.counts(), recentReports: store.all('reports').slice(-5).reverse().map(reports.decorate),
    feed: alerts.feed({ limit: 8 }), history: repo.firmsHistory(), freshness: repo.dataFreshness(), jobs: jobs.list().slice(0, 4),
    candidates: repo.changeCandidates().features.length, audit: store.all('audit').slice(-8).reverse(),
  });
});

// ---------- A02 spatial data ----------
r.get('/du-lieu', requirePerm('dashboard.view'), async (req, res, next) => {
  try {
    const catalog = require('../services/layerCatalog');
    res.render('admin/layers', { title: 'Quản lý dữ liệu không gian', section: 'layers', catalog: await catalog.full(), groups: catalog.groups(),
      custom: repo.customLayers(true), manifest: readJson(path.join(paths.boundaries, 'manifest.json')) });
  } catch (e) { next(e); }
});
// cấu hình hiển thị một lớp trong danh mục
r.post('/du-lieu/lop/:id', requirePerm('data.manage'), (req, res) => {
  require('../services/layerCatalog').save(me(req), req.params.id, req.body);
  flash(req, 'ok', 'Đã lưu cấu hình lớp – áp dụng ngay cho Bản đồ WebGIS, MobileGIS và trang Tài nguyên rừng.');
  return res.redirect('/quan-tri/du-lieu#danh-muc');
});
r.post('/du-lieu/lop/:id/an-hien', requirePerm('data.manage'), (req, res) => {
  require('../services/layerCatalog').setHidden(me(req), req.params.id, req.body.hidden === '1');
  flash(req, 'ok', req.body.hidden === '1' ? 'Đã ẩn lớp khỏi bản đồ công khai.' : 'Đã hiện lại lớp trên bản đồ.');
  return res.redirect('/quan-tri/du-lieu#danh-muc');
});
// ---------- danh mục nhóm lớp ----------
r.get('/du-lieu/danh-muc', requirePerm('dashboard.view'), async (req, res, next) => {
  try {
    const catalog = require('../services/layerCatalog');
    const items = await catalog.full();
    const count = {}; items.forEach((i) => { count[i.group] = (count[i.group] || 0) + 1; });
    const gs = catalog.groups();
    res.render('admin/layer-groups', { title: 'Danh mục nhóm lớp bản đồ', section: 'layers', groups: gs, count, sections: [...new Set(gs.map((g) => g.section))] });
  } catch (e) { next(e); }
});
r.post('/du-lieu/danh-muc', requirePerm('data.manage'), (req, res) => {
  try { require('../services/layerCatalog').saveGroup(me(req), null, req.body); flash(req, 'ok', 'Đã thêm nhóm. Gán lớp vào nhóm ở trang “Lớp dữ liệu bản đồ”.'); } catch (e) { flash(req, 'error', e.message); }
  return res.redirect('/quan-tri/du-lieu/danh-muc');
});
r.post('/du-lieu/danh-muc/:key', requirePerm('data.manage'), async (req, res) => {
  const cat = require('../services/layerCatalog');
  try {
    if (req.body.action === 'delete') { await cat.removeGroup(me(req), req.params.key); flash(req, 'ok', 'Đã xoá nhóm; các lớp trong nhóm trở về nhóm mặc định.'); }
    else if (req.body.action === 'reset') { cat.resetGroup(me(req), req.params.key); flash(req, 'ok', 'Đã khôi phục nhóm mặc định.'); }
    else { cat.saveGroup(me(req), req.params.key, req.body); flash(req, 'ok', 'Đã lưu nhóm.'); }
  } catch (e) { flash(req, 'error', e.message); }
  return res.redirect('/quan-tri/du-lieu/danh-muc');
});
r.post('/du-lieu/lop/:id/xoa', requirePerm('data.manage'), async (req, res) => {
  try {
    const cat = require('../services/layerCatalog');
    const it = (await cat.full()).find((i) => i.id === req.params.id);
    if (it && it.kind === 'map' && !can(me(req), 'maps.publish')) throw new Error('Xoá bản đồ chuyên đề cần quyền Quản trị hệ thống.');
    const out = await cat.remove(me(req), req.params.id);
    flash(req, 'ok', out.removed === 'data' ? 'Đã xoá lớp và dữ liệu.' : 'Đã gỡ lớp khỏi danh mục (dữ liệu hệ thống vẫn giữ, khôi phục được ở mục “Lớp đã gỡ”).');
  } catch (e) { flash(req, 'error', e.message); }
  return res.redirect('/quan-tri/du-lieu#danh-muc');
});
r.post('/du-lieu/lop/:id/khoi-phuc', requirePerm('data.manage'), (req, res) => {
  require('../services/layerCatalog').restore(me(req), req.params.id);
  flash(req, 'ok', 'Đã khôi phục lớp vào danh mục.');
  return res.redirect('/quan-tri/du-lieu#danh-muc');
});
r.post('/du-lieu/lop/:id/mac-dinh', requirePerm('data.manage'), (req, res) => {
  require('../services/layerCatalog').reset(me(req), req.params.id);
  flash(req, 'ok', 'Đã khôi phục cấu hình mặc định của lớp.');
  return res.redirect('/quan-tri/du-lieu#danh-muc');
});
// trang mô tả API quản lý lớp (cho đơn vị tích hợp)
r.get('/du-lieu/api', requirePerm('dashboard.view'), (req, res) => {
  res.render('admin/layers-api', { title: 'API quản lý lớp dữ liệu', section: 'layers', endpoints: require('./api-v1').ENDPOINTS,
    base: (require('../config').publicBaseUrl || `${req.protocol}://${req.get('host')}`), custom: repo.customLayers(true) });
});

const layersSvc = require('../services/layers');
const { convertLayer, LAYER_EXT } = layersSvc;

r.post('/du-lieu/tai-len', requirePerm('data.manage'), memUpload(25, /json|geojson|zip|sheet|excel|csv|octet-stream/i).single('file'), checkCsrf, (req, res) => {
  if (!req.file || !LAYER_EXT.test(req.file.originalname)) { flash(req, 'error', 'Chọn tệp GeoJSON, Shapefile nén .zip, Excel .xlsx hoặc .csv (tối đa 25 MB).'); return res.redirect('/quan-tri/du-lieu#them'); }
  let gj; let info = null;
  try { ({ gj, info } = convertLayer(req.file.buffer, req.file.originalname, req.body.crs)); } catch (e) { flash(req, 'error', e.message); return res.redirect('/quan-tri/du-lieu#them'); }
  const { v } = layersSvc.create(me(req), { title: req.body.title, source: req.body.source, description: req.body.description, color: req.body.color, gj, info, originalName: req.file.originalname });
  flash(req, v.errors.length ? 'error' : 'ok', v.errors.length ? `Kiểm tra không đạt: ${v.errors.join('; ')}` : `Đã nhập ${v.count} đối tượng (${info ? info.format.slice(1).toUpperCase() : 'GeoJSON'}, hệ toạ độ nguồn ${info ? info.source_crs : 'WGS84'}) vào vùng chờ duyệt.${(v.warnings || []).length ? ' Lưu ý: ' + v.warnings.slice(0, 3).join(' ') : ''}`);
  return res.redirect('/quan-tri/du-lieu');
});

r.post('/du-lieu/:id/sua', requirePerm('data.manage'), (req, res) => {
  if (layersSvc.update(me(req), req.params.id, req.body)) flash(req, 'ok', 'Đã cập nhật thông tin lớp.');
  return res.redirect('/quan-tri/du-lieu');
});
r.post('/du-lieu/:id/trang-thai', requirePerm('data.manage'), (req, res) => {
  try {
    if (req.body.action === 'delete') layersSvc.remove(me(req), req.params.id);
    else layersSvc.setStatus(me(req), req.params.id, req.body.action);
  } catch (e) { flash(req, 'error', e.message); }
  return res.redirect('/quan-tri/du-lieu');
});

// ---------- A03 imagery catalogue ----------
r.get('/anh-ve-tinh', requirePerm('dashboard.view'), (req, res) => {
  const dir = path.join(paths.collected, 'monitoring-series');
  const manifest = readJson(path.join(dir, 'manifest.json')) || [];
  const quality = Object.fromEntries(repo.ndviSeries(null).map((m) => [m.month, m.valid_fraction]));
  const months = manifest.filter((m) => m.file).map((m) => {
    const key = m.file.match(/(\d{4}-\d{2})/)[1];
    const scenes = readJson(path.join(dir, m.file.replace('.tif', '-scenes.json'))) || [];
    return { ...m, month: key, scenes: scenes.length, valid_fraction: quality[key] ?? null };
  }).sort((a, b) => b.month.localeCompare(a.month));
  const seasonal = ['2024-dry', '2024-wet', '2025-dry', '2025-wet'].map((k) => {
    const cat = readJson(path.join(paths.collected, 'earth-engine', `sentinel-${k}-catalog.json`));
    return { key: k, catalog: cat };
  });
  const imagery = require('../services/imagery');
  res.render('admin/imagery', { title: 'Quản lý ảnh vệ tinh', section: 'imagery', months, seasonal, overlays: repo.overlays(), sensor: req.query.cam_bien || 'Sentinel-2',
    classes: imagery.classifications(), classStatus: imagery.status() });
});
// tải GeoTIFF gốc (median tháng 100 m, 6 băng + số quan sát) cho cán bộ
r.get('/anh-ve-tinh/tai/:file', requirePerm('dashboard.view'), (req, res, next) => {
  const m = String(req.params.file).match(/^(\d{4}-\d{2})\.tif$/);
  const f = m && require('../services/imagery').monthTif(m[1]);
  if (!f) return next();
  store.audit(me(req), 'imagery.download', m[1]);
  return res.download(f, `sentinel2-kontum-${m[1]}-100m.tif`);
});
r.get('/anh-ve-tinh/phan-loai/:file', requirePerm('dashboard.view'), (req, res, next) => {
  const m = String(req.params.file).match(/^(\d{4}-\d{2})\.tif$/);
  const f = m && require('../services/imagery').classFile(m[1], 'tif');
  return f ? res.download(f, `phan-loai-kontum-${m[1]}-100m.tif`) : next();
});
r.post('/anh-ve-tinh/phan-loai', requirePerm('jobs.run'), (req, res) => {
  try { require('../services/imagery').classify(String(req.body.month || ''), me(req)); req.session.flash = { type: 'ok', text: `Đã đưa phân loại tháng ${req.body.month} vào hàng đợi (khoảng 1–2 phút).` }; } catch (e) { req.session.flash = { type: 'error', text: e.message }; }
  res.redirect('/quan-tri/anh-ve-tinh#phan-loai');
});
r.post('/anh-ve-tinh/phan-loai/:month/cong-bo', requirePerm('data.manage'), (req, res) => {
  try { require('../services/imagery').setPublished(req.params.month, req.body.on === '1', me(req)); req.session.flash = { type: 'ok', text: req.body.on === '1' ? 'Đã công bố lớp phân loại lên Bản đồ WebGIS.' : 'Đã gỡ lớp phân loại khỏi bản đồ.' }; } catch (e) { req.session.flash = { type: 'error', text: e.message }; }
  res.redirect('/quan-tri/anh-ve-tinh#phan-loai');
});

// ---------- A04 forest resources ----------
r.get('/tai-nguyen', requirePerm('dashboard.view'), (req, res) => {
  const pending = req.session.officialCheck || null;
  res.render('admin/forest', { title: 'Quản lý hiện trạng rừng', section: 'forest', communes: repo.communes(req.query.nam).filter((c) => c.official), summary: repo.forestSummary(req.query.nam),
    years: repo.statYears(), pending });
});
// ---------- Chuỗi lớp phủ hằng năm (Dynamic World) ----------
r.get('/tai-nguyen/lop-phu', requirePerm('dashboard.view'), (req, res) => {
  const lcSvc = require('../services/landcover');
  res.render('admin/landcover', { title: 'Chuỗi lớp phủ hằng năm', section: 'forest', series: lcSvc.series(), manifest: lcSvc.manifest(), status: lcSvc.status() });
});
r.post('/tai-nguyen/lop-phu/cap-nhat', requirePerm('jobs.run'), (req, res) => {
  require('../services/landcover').update();
  flash(req, 'ok', 'Đang tải năm mới từ Dynamic World và tính lại (vài phút) – tải lại trang để xem kết quả.');
  res.redirect('/quan-tri/tai-nguyen/lop-phu');
});
// Nạp số liệu hiện trạng rừng theo quyết định công bố mới: bước 1 kiểm tra (xem trước), bước 2 nạp
const OFFICIAL_DIR = path.join(paths.uploads, 'official');
function runOfficial(file, b, check) {
  const args = [path.join(paths.scripts, 'import_official_statistics.py'), file, '--as-of', String(b.as_of || ''), '--decision', String(b.decision || '').trim(), '--date', String(b.decision_date || '').trim()];
  if (b.sheet) args.push('--sheet', String(b.sheet)); if (b.url) args.push('--url', String(b.url));
  if (check) args.push('--check');
  const r = require('child_process').spawnSync(config.python, args, { encoding: 'utf8', timeout: 120000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, windowsHide: true });
  try { return JSON.parse(String(r.stdout || '').trim().split('\n').pop()); } catch { return { ok: false, error: (String(r.stderr || '').split('\n').filter(Boolean).pop() || 'Không chạy được bộ nạp') }; }
}
r.post('/tai-nguyen/so-lieu', requirePerm('data.manage'), memUpload(20, /sheet|excel|xlsx|octet-stream/i).single('file'), checkCsrf, (req, res) => {
  const b = req.body;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.as_of || '') || !String(b.decision || '').trim() || !/^\d{2}\/\d{2}\/\d{4}$/.test(b.decision_date || '')) { flash(req, 'error', 'Nhập ngày số liệu (yyyy-mm-dd), số quyết định và ngày quyết định (dd/mm/yyyy).'); return res.redirect('/quan-tri/tai-nguyen#cap-nhat'); }
  if (!req.file || !/\.xlsx$/i.test(req.file.originalname)) { flash(req, 'error', 'Chọn tệp Excel (.xlsx) phụ lục của quyết định.'); return res.redirect('/quan-tri/tai-nguyen#cap-nhat'); }
  fs.mkdirSync(OFFICIAL_DIR, { recursive: true });
  const file = path.join(OFFICIAL_DIR, `${crypto.createHash('sha256').update(req.file.buffer).digest('hex').slice(0, 16)}.xlsx`);
  fs.writeFileSync(file, req.file.buffer);
  const rep = runOfficial(file, b, true);
  if (!rep.ok) { flash(req, 'error', `Không nạp được: ${rep.error}`); return res.redirect('/quan-tri/tai-nguyen#cap-nhat'); }
  req.session.officialCheck = { file: path.basename(file), original: req.file.originalname, meta: { as_of: b.as_of, decision: b.decision, decision_date: b.decision_date, sheet: b.sheet || '', url: b.url || '' }, report: rep };
  return res.redirect('/quan-tri/tai-nguyen#cap-nhat');
});
r.post('/tai-nguyen/so-lieu/xac-nhan', requirePerm('data.manage'), (req, res) => {
  const p = req.session.officialCheck;
  if (!p) return res.redirect('/quan-tri/tai-nguyen');
  if (req.body.action === 'cancel') { delete req.session.officialCheck; return res.redirect('/quan-tri/tai-nguyen'); }
  const rep = runOfficial(path.join(OFFICIAL_DIR, path.basename(p.file)), p.meta, false);
  delete req.session.officialCheck;
  if (!rep.ok) { flash(req, 'error', `Không nạp được: ${rep.error}`); return res.redirect('/quan-tri/tai-nguyen#cap-nhat'); }
  store.audit(me(req), 'forest.statistics.import', String(rep.year), { decision: p.meta.decision, matched: rep.matched, file: p.original });
  flash(req, 'ok', `Đã nạp số liệu hiện trạng năm ${rep.year} (${p.meta.decision}): ${rep.matched}/${rep.expected} xã. Các trang Tài nguyên rừng, Thống kê, Bản đồ dùng số liệu mới; năm cũ vẫn chọn xem được.`);
  return res.redirect(`/quan-tri/tai-nguyen?nam=${rep.year}`);
});

// ---------- A05 analysis jobs ----------
// ---------- MobileGIS field work: tasks, verification/survey review, sync conflicts ----------
const field = require('../services/field');
const fieldErr = (req, res, e, to) => { if (e instanceof field.FieldError) { flash(req, 'error', e.message); return res.redirect(to); } throw e; };
r.get('/hien-truong', requirePerm('dashboard.view'), async (req, res, next) => {
  try {
    const db = require('../db/pool');
    const data = db.enabled ? await field.adminOverview() : { assignments: [], verifications: [], surveys: [], conflicts: [] };
    res.render('admin/field', {
      title: 'Nhiệm vụ & xác minh hiện trường', section: 'field', tab: req.query.tab || 'nhiem-vu', dbOn: db.enabled, ...data,
      specialists: store.all('users').filter((u) => u.role === 'specialist' && u.active), communes: repo.communes(),
      prefill: { kind: req.query.kind || '', ref: req.query.ref || '' }, AS: field.ASSIGNMENT_STATUS, filter: req.query,
    });
  } catch (e) { next(e); }
});
r.post('/hien-truong/giao', requirePerm('tasks.assign'), async (req, res, next) => {
  try {
    const a = await field.createAssignment(me(req), { ...req.body, due_at: req.body.due_at || null, assignee_id: req.body.assignee_id || null, scope_id: req.body.scope_id || null });
    flash(req, 'ok', `Đã giao nhiệm vụ ${a.code}${a.assignee ? ` cho ${a.assignee}` : ' (chờ cán bộ địa bàn nhận)'}.`);
    return res.redirect('/quan-tri/hien-truong');
  } catch (e) { try { return fieldErr(req, res, e, '/quan-tri/hien-truong'); } catch (x) { return next(x); } }
});
r.post('/hien-truong/:id/huy', requirePerm('tasks.assign'), async (req, res, next) => {
  try { await field.cancelAssignment(me(req), req.params.id); flash(req, 'ok', 'Đã huỷ nhiệm vụ.'); return res.redirect('/quan-tri/hien-truong'); }
  catch (e) { try { return fieldErr(req, res, e, '/quan-tri/hien-truong'); } catch (x) { return next(x); } }
});
r.post('/hien-truong/xac-minh/:id', requirePerm('field.review'), async (req, res, next) => {
  try { const v = await field.reviewVerification(me(req), req.params.id, req.body.decision, req.body.note); flash(req, 'ok', `Đã ${v.review_status === 'approved' ? 'duyệt' : 'trả lại'} kết quả ${v.code}.`); return res.redirect('/quan-tri/hien-truong?tab=xac-minh'); }
  catch (e) { try { return fieldErr(req, res, e, '/quan-tri/hien-truong?tab=xac-minh'); } catch (x) { return next(x); } }
});
r.post('/hien-truong/khao-sat/:id', requirePerm('field.review'), async (req, res, next) => {
  try { const s = await field.reviewSurvey(me(req), req.params.id, req.body.decision, req.body.note); flash(req, 'ok', `Đã cập nhật khảo sát ${s.code}.`); return res.redirect('/quan-tri/hien-truong?tab=khao-sat'); }
  catch (e) { try { return fieldErr(req, res, e, '/quan-tri/hien-truong?tab=khao-sat'); } catch (x) { return next(x); } }
});
r.get('/hien-truong/tep/:key', requirePerm('dashboard.view'), async (req, res) => {
  const f = await field.attachmentFor(req.params.key, { role: me(req).role });
  if (!f) return res.status(404).end();
  return res.sendFile(require('path').resolve(f));
});
r.get('/api/hien-truong/xac-minh/:id', requirePerm('dashboard.view'), async (req, res, next) => { try { res.json(await field.getVerification(req.params.id)); } catch (e) { next(e); } });

r.get('/huong-dan', requirePerm('dashboard.view'), (req, res) => res.render('admin/guide', { title: 'Hướng dẫn sử dụng', section: 'guide', guide: require('../content/guide').adminGuide }));
r.get('/phan-tich', requirePerm('dashboard.view'), (req, res) => {
  const runs = require('../services/changeRuns');
  res.render('admin/analysis', { title: 'Phân tích rừng (Python)', section: 'analysis', jobs: jobs.list(), defs: jobs.JOBS, running: jobs.isRunning(), plan: jobs.plan(), periods: jobs.PERIODS,
    runs: runs.list(), autoState: runs.auto.state(), autoDraft: runs.auto.draft(), autoPending: runs.auto.pending(), form: req.session.runForm || {}, monthsAvail: monthsAvailable(), schedulerOn: jobs.schedulerOn(), firmsSt: require('../services/firms').status(), fcg: repo.forestChange(), fd: repo.fireDanger(), job: req.query.job ? store.get('jobs', req.query.job) : null });
});
// ---------- phân tích biến động: chạy theo yêu cầu (thủ công) và kiểm soát công bố kết quả tự động ----------
function monthsAvailable() {
  try { return fs.readdirSync(path.join(config.paths.collected, 'monitoring-series')).map((f) => (f.match(/^sentinel-(\d{4})-(\d{2})-100m\.tif$/) || [])).filter((m) => m[1]).map((m) => `${m[1]}-${m[2]}`).sort(); } catch { return []; }
}
r.post('/phan-tich/bien-dong', requirePerm('jobs.run'), (req, res) => {
  const runs = require('../services/changeRuns');
  try {
    const run = runs.create(me(req), { ...req.body, canApprove: can(me(req), 'alerts.approve') });
    delete req.session.runForm;
    flash(req, 'ok', `Đã đưa kỳ phân tích ${run.code} (${run.title}) vào hàng chạy.`);
    return res.redirect(`/quan-tri/phan-tich/bien-dong/${run.id}`);
  } catch (e) {
    if (!(e instanceof runs.InputError)) throw e;
    req.session.runForm = req.body; flash(req, 'error', e.message); return res.redirect('/quan-tri/phan-tich#bien-dong');
  }
});
r.get('/phan-tich/bien-dong/:id', requirePerm('dashboard.view'), (req, res, next) => {
  const runs = require('../services/changeRuns');
  const run = runs.get(req.params.id);
  if (!run) return next();
  return res.render('admin/change-run', { title: `Kỳ phân tích ${run.code}`, section: 'analysis', run, needsMap: true });
});
r.get('/phan-tich/bien-dong/:id/vung.geojson', requirePerm('dashboard.view'), (req, res, next) => {
  const runs = require('../services/changeRuns');
  const run = runs.get(req.params.id);
  return run ? res.json(runs.candidates(run)) : next();
});
r.get('/phan-tich/tu-dong/vung.geojson', requirePerm('dashboard.view'), (req, res) => res.json(readJson(path.join(config.paths.data, 'web', 'change-candidates.geojson')) || { type: 'FeatureCollection', features: [] }));
r.post('/phan-tich/bien-dong/:id/cong-bo', requirePerm('alerts.approve'), (req, res) => {
  const runs = require('../services/changeRuns');
  try { runs.publish(req.params.id, me(req), req.body.on !== '0', String(req.body.note || '').slice(0, 500)); flash(req, 'ok', req.body.on !== '0' ? 'Đã công bố kỳ phân tích ra Bản đồ WebGIS, trang Biến động rừng và MobileGIS.' : 'Đã thu hồi công bố.'); }
  catch (e) { flash(req, 'error', e.message); }
  return res.redirect(`/quan-tri/phan-tich/bien-dong/${req.params.id}`);
});
r.post('/phan-tich/bien-dong/:id/xoa', requirePerm('jobs.run'), (req, res) => {
  const runs = require('../services/changeRuns');
  try { runs.remove(req.params.id, me(req)); flash(req, 'ok', 'Đã xoá kỳ phân tích.'); return res.redirect('/quan-tri/phan-tich#bien-dong'); }
  catch (e) { flash(req, 'error', e.message); return res.redirect(`/quan-tri/phan-tich/bien-dong/${req.params.id}`); }
});
r.post('/phan-tich/tu-dong/che-do', requirePerm('alerts.approve'), (req, res) => {
  require('../services/changeRuns').auto.setMode(req.body.mode, me(req));
  flash(req, 'ok', req.body.mode === 'auto' ? 'Kết quả phân tích tự động sẽ được công bố ngay sau mỗi lần chạy.' : 'Kết quả phân tích tự động sẽ chờ duyệt trước khi công bố.');
  return res.redirect('/quan-tri/phan-tich#bien-dong');
});
r.post('/phan-tich/tu-dong/cong-bo', requirePerm('alerts.approve'), (req, res) => {
  try { require('../services/changeRuns').auto.approve(me(req), String(req.body.note || '').slice(0, 500)); flash(req, 'ok', 'Đã công bố kết quả phân tích tự động mới nhất.'); }
  catch (e) { flash(req, 'error', e.message); }
  return res.redirect('/quan-tri/phan-tich#bien-dong');
});
r.post('/phan-tich/chay', requirePerm('jobs.run'), async (req, res) => {
  try { const j = await jobs.run(req.body.key, me(req)); store.audit(me(req), 'job.run', req.body.key); flash(req, 'ok', `Đã bắt đầu: ${j.title}`); return res.redirect(`/quan-tri/phan-tich?job=${j.id}`); }
  catch (e) { flash(req, 'error', e.message); return res.redirect('/quan-tri/phan-tich'); }
});
r.post('/phan-tich/lich', requirePerm('jobs.run'), (req, res) => {
  const next = Object.fromEntries(Object.keys(jobs.JOBS).map((k) => [k, { enabled: req.body[`en_${k}`] === 'on', every: req.body[`every_${k}`] }]));
  const saved = jobs.saveSchedule(next, me(req));
  store.audit(me(req), 'job.schedule', 'scheduler', saved);
  flash(req, 'ok', 'Đã lưu lịch chạy tự động');
  return res.redirect('/quan-tri/phan-tich');
});
r.post('/firms/cap-nhat', requirePerm('jobs.run'), async (req, res) => {
  const st = await firmsSvc.refresh({ force: true });
  store.audit(me(req), 'firms.refresh', st.ok ? `+${st.added}` : st.error);
  flash(req, st.ok ? 'ok' : 'error', st.ok ? `Đã cập nhật FIRMS (+${st.added} điểm mới).` : `Không cập nhật được: ${st.error}`);
  return res.redirect('/quan-tri/cai-dat');
});
r.get('/api/jobs/:id', requirePerm('dashboard.view'), (req, res) => res.json(store.get('jobs', req.params.id) || {}));

// ---------- A06 alerts: hotspots, fire danger, forest change ----------
r.get('/canh-bao', requirePerm('dashboard.view'), (req, res) => {
  res.render('admin/alerts', {
    title: 'Quản lý cảnh báo', section: 'alerts', tab: req.query.tab || 'diem-nong',
    hotspots: repo.hotspots({ staff: true }), dangerAlerts: alerts.fireDangerAlerts(3), candidates: repo.changeCandidates({ staff: true }).features.map((f) => f.properties).sort((a, b) => b.area_ha - a.area_ha),
    HS: repo.HOTSPOT_STATUS, CS: repo.CANDIDATE_STATUS, DS: alerts.DANGER_STATUS, users: store.all('users').filter((u) => u.active),
    filter: req.query, SOURCES: firepoints.SOURCES, form: req.session.fpForm || {},
  });
  delete req.session.fpForm;
});
// web → MobileGIS: assigning an officer on the web also creates the field task in their app (once per open object)
async function ensureFieldTask(req, kind, ref, username) {
  const u = username && store.find('users', (x) => x.username === username && x.role === 'specialist' && x.active);
  if (!u || !require('../db/pool').enabled) return null;
  try { return await require('../services/field').createAssignment(me(req), { kind, ref_id: ref, assignee_id: u.id }); }
  catch (e) { if (e.code === 'EXISTS' || e.code === 'OUT_OF_SCOPE' || e.code === 'NOT_FOUND') return { skipped: e.message }; throw e; }
}
const HS_FLOW = ['assigned', 'verifying', 'confirmed', 'rejected', 'handling', 'closed'];
r.post('/canh-bao/diem-nong', requirePerm('alerts.verify'), async (req, res, next) => {
  try {
    const { ref, status, note, assignee } = req.body;
    if (!HS_FLOW.includes(status)) return back(req, res, '/quan-tri/canh-bao');
    store.setDecision('hotspot', ref, { status, note: String(note || '').slice(0, 1000), assignee: assignee || null }, me(req));
    store.audit(me(req), 'hotspot.status', ref, { status, note });
    const task = status === 'assigned' && assignee ? await ensureFieldTask(req, 'hotspot', ref, assignee) : null;
    if (task && task.code) store.setDecision('hotspot', ref, { status, note: String(note || '').slice(0, 1000), assignee }, me(req)); // keep the officer's note after task creation
    flash(req, 'ok', task && task.code ? `Đã cập nhật và giao nhiệm vụ ${task.code} trên MobileGIS cho ${assignee}.` : `Đã cập nhật trạng thái điểm nóng.${task && task.skipped ? ` (${task.skipped})` : ''}`);
    return back(req, res, '/quan-tri/canh-bao');
  } catch (e) { return next(e); }
});
// nhập tay điểm cháy: đi chung danh sách/quy trình xác minh với FIRMS
r.post('/canh-bao/nhap-tay', requirePerm('alerts.manual'), async (req, res, next) => {
  try {
    const canVerify = can(me(req), 'alerts.verify');
    const out = firepoints.create(me(req), req.body, { canVerify });
    const task = out.status === 'assigned' && req.body.assignee ? await ensureFieldTask(req, 'hotspot', out.ref, req.body.assignee) : null;
    if (task && task.code) store.setDecision('hotspot', out.ref, { status: 'assigned', note: String(req.body.note || '').slice(0, 1000) || 'Nhập thủ công, giao xác minh', assignee: req.body.assignee }, me(req));
    flash(req, 'ok', `Đã nhập điểm cháy ${out.row.code} (${repo.HOTSPOT_STATUS[out.status]}).${out.status === 'confirmed' ? ' Thông báo cháy đã xác minh sẽ gửi tới người dân trong xã qua MobileGIS.' : ' Điểm đã vào danh sách xác minh cùng điểm nóng FIRMS.'}${task && task.code ? ` Đã giao nhiệm vụ ${task.code}.` : ''}`);
    return res.redirect('/quan-tri/canh-bao?tab=diem-nong');
  } catch (e) {
    if (e instanceof firepoints.InputError) { req.session.fpForm = req.body; flash(req, 'error', e.message); return res.redirect('/quan-tri/canh-bao?tab=nhap-tay'); }
    return next(e);
  }
});
r.post('/canh-bao/bien-dong', requirePerm('alerts.verify'), (req, res) => {
  const { ref, status, note } = req.body;
  if (!Object.keys(repo.CANDIDATE_STATUS).includes(status)) return back(req, res, '/quan-tri/canh-bao?tab=bien-dong');
  store.setDecision('candidate', ref, { status, note: String(note || '').slice(0, 1000) }, me(req));
  store.audit(me(req), 'candidate.status', ref, { status, note });
  flash(req, 'ok', 'Đã cập nhật kết quả xác minh biến động.');
  return back(req, res, '/quan-tri/canh-bao?tab=bien-dong');
});
r.post('/canh-bao/nguy-co', requirePerm('alerts.approve'), (req, res) => {
  const { ref, status, note } = req.body;
  if (!['approved', 'dismissed', 'auto'].includes(status)) return back(req, res, '/quan-tri/canh-bao?tab=nguy-co');
  store.setDecision('fire_danger', ref, { status, note: String(note || '').slice(0, 1000) }, me(req));
  store.audit(me(req), 'fire_danger.decision', ref, { status, note });
  flash(req, 'ok', status === 'approved' ? 'Đã phê duyệt công bố cảnh báo.' : 'Đã cập nhật quyết định.');
  return back(req, res, '/quan-tri/canh-bao?tab=nguy-co');
});

// ---------- A07 news ----------
r.get('/tin-tuc', requirePerm('dashboard.view'), (req, res) => {
  let list = content.list({ includeAll: true, category: req.query.muc, q: req.query.q });
  if (req.query.trang_thai) list = list.filter((a) => a.status === req.query.trang_thai);
  const comments = content.comments(null, { all: true }).reverse().map((c) => ({ ...c, article: store.get('articles', c.article_id) || {} }));
  res.render('admin/news', { title: 'Quản lý tin tức', section: 'news', list, categories: content.CATEGORIES, statuses: content.STATUS, filter: req.query, comments, commentStatus: content.COMMENT_STATUS });
});
r.get('/tin-tuc/moi', requirePerm('news.manage'), (req, res) => res.render('admin/news-form', { title: 'Thêm tin mới', section: 'news', a: null, categories: content.CATEGORIES, statuses: content.STATUS }));
r.get('/tin-tuc/:id', requirePerm('news.manage'), (req, res, next) => {
  const a = store.get('articles', req.params.id);
  if (!a) return next();
  return res.render('admin/news-form', { title: 'Sửa tin', section: 'news', a, categories: content.CATEGORIES, statuses: content.STATUS });
});
const imgUpload = memUpload(8, /^image\/(jpeg|png|webp)$/);
r.post('/tin-tuc/luu', requirePerm('news.manage'), imgUpload.single('image'), checkCsrf, async (req, res, next) => {
  try {
    const b = req.body;
    let status = content.STATUS[b.status] ? b.status : 'draft';
    if (status === 'published' && !can(me(req), 'news.publish')) status = 'review';
    const data = {
      title: String(b.title || '').trim().slice(0, 250), category: content.CATEGORIES[b.category] ? b.category : 'quan-ly-rung',
      summary: String(b.summary || '').trim().slice(0, 500), body: String(b.body || '').trim().slice(0, 20000),
      source_url: /^https?:\/\//.test(b.source_url || '') ? b.source_url : null, author: String(b.author || me(req).name || me(req).username).slice(0, 120), status,
    };
    if (!data.title || !data.body) { flash(req, 'error', 'Cần nhập tiêu đề và nội dung.'); return back(req, res, '/quan-tri/tin-tuc'); }
    if (req.file) {
      const dir = path.join(config.ROOT, 'public', 'uploads', 'news');
      fs.mkdirSync(dir, { recursive: true });
      const name = `${crypto.randomUUID()}.webp`;
      await sharp(req.file.buffer).rotate().resize({ width: 1600, height: 1000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toFile(path.join(dir, name));
      data.image = `/uploads/news/${name}`;
    } else if (b.image_path && /^\/(assets|uploads)\//.test(b.image_path)) data.image = b.image_path;
    let row;
    if (b.id) {
      const old = store.get('articles', b.id);
      if (!old) return next();
      if (status === 'published' && !old.published_at) data.published_at = store.now();
      row = store.update('articles', b.id, data);
    } else {
      const slug = `${data.title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70)}-${crypto.randomBytes(2).toString('hex')}`;
      row = store.insert('articles', { ...data, slug, views: 0, published_at: status === 'published' ? store.now() : null, image: data.image || '/assets/items/evergreen.webp', origin: 'cms' });
    }
    store.audit(me(req), b.id ? 'news.update' : 'news.create', row.title, { status });
    flash(req, 'ok', 'Đã lưu bài viết.');
    return res.redirect('/quan-tri/tin-tuc');
  } catch (e) { return next(e); }
});
r.post('/tin-tuc/binh-luan/:id', requirePerm('news.manage'), (req, res) => {
  if (!content.moderate(req.params.id, String(req.body.status || ''), me(req))) flash(req, 'error', 'Không tìm thấy bình luận.');
  return res.redirect('/quan-tri/tin-tuc?tab=binh-luan#binh-luan');
});
r.post('/tin-tuc/:id/trang-thai', requirePerm('news.manage'), (req, res) => {
  const a = store.get('articles', req.params.id);
  if (!a) return res.redirect('/quan-tri/tin-tuc');
  let { status } = req.body;
  if (status === 'deleted') { store.update('articles', a.id, { status: 'deleted' }); store.audit(me(req), 'news.delete', a.title); return res.redirect('/quan-tri/tin-tuc'); }
  if (!content.STATUS[status]) return res.redirect('/quan-tri/tin-tuc');
  if (status === 'published' && !can(me(req), 'news.publish')) status = 'review';
  store.update('articles', a.id, { status, published_at: status === 'published' ? a.published_at || store.now() : a.published_at, reviewed_by: me(req).username });
  store.audit(me(req), 'news.status', a.title, { status });
  return res.redirect('/quan-tri/tin-tuc');
});

// ---------- A08 field reports ----------
r.get('/phan-anh', requirePerm('reports.view'), (req, res) => {
  let list = store.all('reports').slice().reverse().map(reports.decorate);
  if (req.query.trang_thai) list = list.filter((x) => x.status === req.query.trang_thai);
  if (req.query.loai) list = list.filter((x) => x.type === req.query.loai);
  if (req.query.kiem_tra === 'chua') list = list.filter((x) => !x.reviewed_at);
  if (req.query.kiem_tra === 'roi') list = list.filter((x) => x.reviewed_at);
  const view = req.query.xem === 'ban-do' ? 'map' : 'list';
  const points = view === 'map' ? list.filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon)).map((x) => ({
    id: x.id, code: x.code, type: x.type, typeLabel: x.typeLabel, marker: x.marker, status: x.status, statusLabel: x.statusLabel, statusTone: x.statusTone,
    lat: x.lat, lon: x.lon, commune: x.commune_name, created_at: x.created_at, reviewed: Boolean(x.reviewed_at), description: String(x.description || '').slice(0, 160),
  })) : [];
  res.render('admin/reports', { title: 'Quản lý phản ánh hiện trường', section: 'reports', list, types: reports.TYPES, statuses: reports.STATUS, filter: req.query, view, points, needsMap: view === 'map', sameLoc: reports.sameLocation });
});
r.get('/phan-anh/:id', requirePerm('reports.view'), (req, res, next) => {
  const x = store.get('reports', req.params.id) || reports.byCode(req.params.id);
  if (!x) return next();
  store.audit(me(req), 'report.view', x.code);
  const fp = x.fire_point ? repo.hotspots().find((h) => h.manual && h.manual.code === x.fire_point) : null;
  return res.render('admin/report-detail', { title: `Phản ánh ${x.code}`, section: 'reports', x: reports.decorate(x), statuses: reports.STATUS, users: store.all('users').filter((u) => u.active && u.role === 'specialist'), fp, HS: repo.HOTSPOT_STATUS, same: reports.sameLocation(x) });
});
r.post('/phan-anh/:id', requirePerm('reports.manage'), async (req, res, next) => {
  const x = store.get('reports', req.params.id);
  if (!x) return next();
  const b = req.body;
  const patch = { public: b.public === 'on', public_photos: b.public_photos === 'on', assigned_to: b.assigned_to || null, response: String(b.response || '').slice(0, 2000) || null };
  if (reports.STATUS[b.status] && b.status !== x.status) {
    patch.status = b.status;
    patch.timeline = [...x.timeline, { at: store.now(), status: b.status, note: String(b.note || '').slice(0, 500) || null, public_note: b.note_public === 'on' ? String(b.note || '').slice(0, 500) : null, by: me(req).username }];
  } else if (b.note) {
    patch.timeline = [...x.timeline, { at: store.now(), status: x.status, note: String(b.note).slice(0, 500), public_note: b.note_public === 'on' ? String(b.note).slice(0, 500) : null, by: me(req).username }];
  }
  const prevAssignee = x.assigned_to; // store.update mutates x
  store.update('reports', x.id, patch);
  store.audit(me(req), 'report.update', x.code, { status: patch.status, public: patch.public });
  const task = patch.assigned_to && patch.assigned_to !== prevAssignee ? await ensureFieldTask(req, 'report', x.code, patch.assigned_to) : null;
  flash(req, 'ok', `Đã cập nhật hồ sơ phản ánh.${task && task.code ? ` Đã giao nhiệm vụ xác minh ${task.code} trên MobileGIS.` : ''}`);
  return res.redirect(`/quan-tri/phan-anh/${x.id}`);
});

// đánh dấu đã kiểm tra / bỏ đánh dấu (người kiểm duyệt: quản trị, lãnh đạo, cán bộ)
r.post('/phan-anh/:id/kiem-tra', requirePerm('reports.manage'), (req, res, next) => {
  const x = store.get('reports', req.params.id);
  if (!x) return next();
  const on = req.body.reviewed !== '0';
  const note = on ? 'Đã kiểm tra hồ sơ' : 'Bỏ đánh dấu đã kiểm tra';
  store.update('reports', x.id, { reviewed_at: on ? store.now() : null, reviewed_by: on ? me(req).username : null, timeline: [...x.timeline, { at: store.now(), status: x.status, note, by: me(req).username }] });
  store.audit(me(req), on ? 'report.reviewed' : 'report.unreviewed', x.code);
  flash(req, 'ok', on ? `Đã đánh dấu ${x.code} là đã kiểm tra.` : `Đã bỏ đánh dấu kiểm tra ${x.code}.`);
  return back(req, res, `/quan-tri/phan-anh/${x.id}`);
});
// phản ánh "Cháy rừng" → điểm cháy trong luồng cảnh báo (xác nhận ngay nếu cán bộ có quyền xác minh chọn)
r.post('/phan-anh/:id/diem-chay', requirePerm('alerts.manual'), (req, res, next) => {
  const x = store.get('reports', req.params.id);
  if (!x) return next();
  try {
    const confirm = req.body.confirm === '1' && can(me(req), 'alerts.verify');
    const out = firepoints.fromReport(me(req), x, { confirm, note: String(req.body.note || '').slice(0, 1000) || null });
    flash(req, 'ok', `Đã tạo điểm cháy ${out.row.code} từ phản ánh ${x.code}${confirm ? ' – đã xác nhận cháy, người dân trong xã sẽ nhận thông báo.' : ' – chờ xác minh trong Quản lý cảnh báo.'}`);
  } catch (e) {
    if (!(e instanceof firepoints.InputError)) return next(e);
    flash(req, 'error', e.message);
  }
  return res.redirect(`/quan-tri/phan-anh/${x.id}`);
});

// ---------- Bản đồ và lớp dữ liệu → Quản lý bản đồ (PDF/GeoTIFF) ----------
r.use('/ban-do', require('./maps-admin'));

// ---------- A12 documents ----------
r.get('/tai-lieu', requirePerm('dashboard.view'), (req, res) => res.render('admin/documents', { title: 'Quản lý tài liệu, văn bản', section: 'docs', docs: repo.documents(), categories: repo.DOC_CATEGORIES }));
r.post('/tai-lieu/tai-len', requirePerm('docs.manage'), memUpload(40, /pdf/i).single('file'), checkCsrf, (req, res) => {
  if (!req.file) { flash(req, 'error', 'Chọn tệp PDF hợp lệ (≤ 40 MB).'); return res.redirect('/quan-tri/tai-lieu'); }
  if (req.file.buffer.slice(0, 5).toString() !== '%PDF-') { flash(req, 'error', 'Tệp không phải PDF.'); return res.redirect('/quan-tri/tai-lieu'); }
  const dir = path.join(paths.uploads, 'docs'); fs.mkdirSync(dir, { recursive: true });
  const stored = `${crypto.randomUUID()}.pdf`;
  fs.writeFileSync(path.join(dir, stored), req.file.buffer);
  const row = store.insert('documents', {
    title: String(req.body.title || req.file.originalname).slice(0, 250), category: repo.DOC_CATEGORIES[req.body.category] ? req.body.category : 'khac',
    issuer: String(req.body.issuer || '').slice(0, 200), number: String(req.body.number || '').slice(0, 80), issued: /^\d{4}-\d{2}-\d{2}$/.test(req.body.issued || '') ? req.body.issued : null,
    description: String(req.body.description || '').slice(0, 1000), type: 'pdf', bytes: req.file.size, sha256: crypto.createHash('sha256').update(req.file.buffer).digest('hex'),
    original_name: req.file.originalname, stored_name: stored, status: 'published', uploaded_by: me(req).username,
  });
  store.audit(me(req), 'doc.upload', row.title);
  flash(req, 'ok', 'Đã tải lên tài liệu.');
  return res.redirect('/quan-tri/tai-lieu');
});
r.post('/tai-lieu/:id/sua', requirePerm('docs.manage'), (req, res) => {
  const d = store.get('documents', req.params.id);
  if (!d) return res.redirect('/quan-tri/tai-lieu');
  const b = req.body;
  store.update('documents', d.id, { title: String(b.title || d.title).slice(0, 250), category: repo.DOC_CATEGORIES[b.category] ? b.category : d.category, issuer: String(b.issuer || '').slice(0, 200),
    number: String(b.number || '').slice(0, 80), issued: /^\d{4}-\d{2}-\d{2}$/.test(b.issued || '') ? b.issued : null, description: String(b.description || '').slice(0, 1000) });
  store.audit(me(req), 'doc.edit', d.title);
  flash(req, 'ok', 'Đã cập nhật tài liệu.');
  return res.redirect('/quan-tri/tai-lieu');
});
r.post('/tai-lieu/:id/xoa', requirePerm('docs.manage'), (req, res) => {
  const d = store.get('documents', req.params.id);
  if (d) { store.update('documents', d.id, { status: 'deleted' }); store.audit(me(req), 'doc.delete', d.title); }
  res.redirect('/quan-tri/tai-lieu');
});

// ---------- A09 users ----------
r.get('/nguoi-dung', requirePerm('users.manage'), (req, res) => {
  const newPassword = req.session.newPassword || null; // shown once
  delete req.session.newPassword;
  res.render('admin/users', { title: 'Quản lý người dùng', section: 'users', users: store.all('users'), communes: repo.communes(), newPassword });
});
r.post('/nguoi-dung', requirePerm('users.manage'), async (req, res) => {
  const b = req.body;
  const username = String(b.username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username) || !ROLES[b.role]) { flash(req, 'error', 'Tên đăng nhập 3–40 ký tự (a-z, 0-9, . _ -) và vai trò hợp lệ.'); return res.redirect('/quan-tri/nguoi-dung'); }
  if (store.find('users', (u) => u.username === username)) { flash(req, 'error', 'Tên đăng nhập đã tồn tại.'); return res.redirect('/quan-tri/nguoi-dung'); }
  const pass = crypto.randomBytes(9).toString('base64url');
  store.insert('users', { username, name: String(b.name || '').slice(0, 120), email: String(b.email || '').slice(0, 120), role: b.role, scope: b.scope || null, active: true, password_hash: await bcrypt.hash(pass, 11) });
  store.audit(me(req), 'user.create', username, { role: b.role });
  req.session.newPassword = { username, pass };
  return res.redirect('/quan-tri/nguoi-dung');
});
r.post('/nguoi-dung/:id', requirePerm('users.manage'), async (req, res) => {
  const u = store.get('users', req.params.id);
  if (!u) return res.redirect('/quan-tri/nguoi-dung');
  const b = req.body;
  if (b.action === 'toggle') {
    if (u.id === me(req).id) { flash(req, 'error', 'Không thể tự khóa tài khoản của mình.'); return res.redirect('/quan-tri/nguoi-dung'); }
    store.update('users', u.id, { active: !u.active }); store.audit(me(req), u.active ? 'user.lock' : 'user.unlock', u.username);
  } else if (b.action === 'reset') {
    const pass = crypto.randomBytes(9).toString('base64url');
    store.update('users', u.id, { password_hash: await bcrypt.hash(pass, 11) }); store.audit(me(req), 'user.reset_password', u.username);
    req.session.newPassword = { username: u.username, pass };
  } else if (b.action === 'edit') {
    const email = String(b.email || '').trim().toLowerCase();
    if (email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) { flash(req, 'error', 'Email không hợp lệ.'); return res.redirect('/quan-tri/nguoi-dung'); }
    store.update('users', u.id, { name: String(b.name || '').slice(0, 120), email: email || null, phone: String(b.phone || '').replace(/[^\d+]/g, '').slice(0, 15) || null });
    store.audit(me(req), 'user.edit', u.username);
    flash(req, 'ok', `Đã cập nhật thông tin ${u.username}.`);
  } else if (b.action === 'role' && ROLES[b.role]) {
    if (u.id === me(req).id && b.role !== 'admin') { flash(req, 'error', 'Không thể tự hạ quyền quản trị của mình.'); return res.redirect('/quan-tri/nguoi-dung'); }
    store.update('users', u.id, { role: b.role, scope: b.scope || null }); store.audit(me(req), 'user.role', u.username, { role: b.role, scope: b.scope });
  }
  return res.redirect('/quan-tri/nguoi-dung');
});
r.post('/mat-khau', async (req, res) => {
  const u = store.get('users', me(req).id);
  const ok = u && await bcrypt.compare(String(req.body.current || ''), u.password_hash);
  const nw = String(req.body.password || '');
  if (!ok || nw.length < 10) { flash(req, 'error', 'Mật khẩu hiện tại không đúng hoặc mật khẩu mới dưới 10 ký tự.'); return back(req, res, '/quan-tri/cai-dat'); }
  store.update('users', u.id, { password_hash: await bcrypt.hash(nw, 11) });
  store.audit(me(req), 'user.change_password', u.username);
  flash(req, 'ok', 'Đã đổi mật khẩu.');
  return back(req, res, '/quan-tri/cai-dat');
});

// ---------- A10 audit log & settings ----------
r.get('/nhat-ky', requirePerm('audit.view'), (req, res) => {
  let rows = store.all('audit').slice().reverse();
  if (req.query.user) rows = rows.filter((x) => x.user === req.query.user);
  if (req.query.action) rows = rows.filter((x) => x.action.startsWith(req.query.action));
  res.render('admin/audit', { title: 'Nhật ký hệ thống', section: 'audit', rows, total: rows.length, filter: req.query, users: [...new Set(store.all('audit').map((x) => x.user))] });
});
r.post('/phien-ban-ung-dung', requirePerm('users.manage'), async (req, res) => {
  const rel = require('../services/appRelease');
  try {
    if (req.body.action === 'notify') { const out = await rel.notify(me(req)); flash(req, 'ok', out.created ? `Đã gửi thông báo phiên bản ${out.release.version} tới mọi thiết bị.` : 'Thông báo cho phiên bản này đã gửi trước đó.'); }
    else { const r2 = rel.set(me(req), req.body); flash(req, 'ok', `Đã lưu phiên bản ${r2.version}. Ứng dụng sẽ báo cập nhật khi mở; bấm “Gửi thông báo” để đẩy tới thiết bị.`); }
  } catch (e) { flash(req, 'error', e.message); }
  return res.redirect('/quan-tri/cai-dat#phien-ban');
});
r.get('/cai-dat', async (req, res) => res.render('admin/settings', {
  release: require('../services/appRelease').get(),
  db: { ...(await require('../db/pool').ping()), store: store.status() },
  push: await require('../services/notifier').stats().catch(() => null), realtime: await require('../services/realtime').stats().catch(() => ({ connections: 0 })),
  title: 'Cài đặt hệ thống', section: 'settings', freshness: repo.dataFreshness(), weather: weatherSvc.status(), firms: firmsSvc.status(),
  env: { mapbox: Boolean(config.mapboxToken), openweather: Boolean(config.openWeatherKey), gee: fs.existsSync(path.join(config.ROOT, '.secrets', 'gee-key.json')), dataJobs: config.enableDataJobs, drafts: config.showDraftContent },
}));

module.exports = r;
