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
r.get('/du-lieu', requirePerm('dashboard.view'), (req, res) => {
  const layers = [
    ...repo.overlays().map((o) => ({ id: o.id, title: o.title, kind: 'Raster (ảnh)', source: o.source, meaning: o.meaning, resolution: o.resolution, status: 'published', origin: 'pipeline' })),
    { id: 'province', title: 'Ranh giới Kon Tum trước 2025', kind: 'Vector (polygon)', source: 'geoBoundaries / HDX 2020', status: 'published', origin: 'pipeline' },
    { id: 'communes', title: 'Ranh giới 40 xã/phường hiện hành', kind: 'Vector (polygon)', source: 'vietnamese-provinces-database v5.2.0', status: 'published', origin: 'pipeline' },
    { id: 'hotspots', title: 'Điểm nóng FIRMS 7 ngày', kind: 'Vector (điểm)', source: 'NASA FIRMS', status: 'published', origin: 'pipeline' },
    { id: 'candidates', title: 'Biến động nghi vấn 2026', kind: 'Vector (polygon)', source: 'Sentinel-2 / Python', status: 'published', origin: 'pipeline' },
  ];
  res.render('admin/layers', { title: 'Quản lý dữ liệu không gian', section: 'layers', layers, custom: repo.customLayers(true), manifest: readJson(path.join(paths.boundaries, 'manifest.json')) });
});

function validateGeoJSON(gj) {
  const errors = [];
  if (!gj || !['FeatureCollection', 'Feature'].includes(gj.type)) return { errors: ['Không phải GeoJSON FeatureCollection/Feature'] };
  const feats = gj.type === 'Feature' ? [gj] : gj.features || [];
  if (!feats.length) errors.push('Không có đối tượng');
  if (gj.crs && !/4326|CRS84/i.test(JSON.stringify(gj.crs))) errors.push('Hệ tọa độ phải là EPSG:4326 (WGS84)');
  const types = new Set(); let outside = 0; let bad = 0;
  const visit = (c, depth) => { if (typeof c[0] === 'number') { const [x, y] = c; if (!(x >= 102 && x <= 110 && y >= 8 && y <= 24)) outside += 1; return; } c.forEach((cc) => visit(cc, depth + 1)); };
  feats.forEach((f) => {
    if (!f.geometry || !f.geometry.coordinates) { bad += 1; return; }
    types.add(f.geometry.type);
    try { visit(f.geometry.coordinates, 0); } catch { bad += 1; }
  });
  if (bad) errors.push(`${bad} đối tượng thiếu/hỏng hình học`);
  if (outside) errors.push(`${outside} tọa độ nằm ngoài phạm vi Việt Nam – kiểm tra hệ tọa độ (cần lon/lat WGS84)`);
  return { errors, count: feats.length, types: [...types], fc: gj.type === 'Feature' ? { type: 'FeatureCollection', features: [gj] } : gj };
}

r.post('/du-lieu/tai-len', requirePerm('data.manage'), memUpload(25, /json|geojson/i).single('file'), checkCsrf, (req, res) => {
  if (!req.file) { flash(req, 'error', 'Chọn tệp GeoJSON (.geojson/.json) tối đa 25 MB.'); return res.redirect('/quan-tri/du-lieu'); }
  let gj;
  try { gj = JSON.parse(req.file.buffer.toString('utf8')); } catch { flash(req, 'error', 'Tệp không phải JSON hợp lệ.'); return res.redirect('/quan-tri/du-lieu'); }
  const v = validateGeoJSON(gj);
  const row = store.insert('layers', {
    title: String(req.body.title || req.file.originalname).slice(0, 160), source: String(req.body.source || '').slice(0, 200), description: String(req.body.description || '').slice(0, 1000),
    style: { color: /^#[0-9a-f]{6}$/i.test(req.body.color || '') ? req.body.color : '#00bcd4' }, original_name: req.file.originalname,
    status: v.errors.length ? 'invalid' : 'staging', validation: { errors: v.errors, count: v.count, types: v.types }, geojson: v.errors.length ? null : v.fc, uploaded_by: me(req).username,
  });
  store.audit(me(req), 'layer.upload', row.title, row.validation);
  flash(req, v.errors.length ? 'error' : 'ok', v.errors.length ? `Kiểm tra không đạt: ${v.errors.join('; ')}` : `Đã tải lên ${v.count} đối tượng vào vùng chờ duyệt (staging).`);
  return res.redirect('/quan-tri/du-lieu');
});

r.post('/du-lieu/:id/trang-thai', requirePerm('data.manage'), (req, res) => {
  const l = store.get('layers', req.params.id);
  if (!l) return res.redirect('/quan-tri/du-lieu');
  if (req.body.action === 'delete') { store.remove('layers', l.id); store.audit(me(req), 'layer.delete', l.title); }
  else if (['published', 'staging'].includes(req.body.action) && l.status !== 'invalid') { store.update('layers', l.id, { status: req.body.action, reviewed_by: me(req).username }); store.audit(me(req), `layer.${req.body.action}`, l.title); }
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
  res.render('admin/imagery', { title: 'Quản lý ảnh vệ tinh', section: 'imagery', months, seasonal, overlays: repo.overlays(), sensor: req.query.cam_bien || 'Sentinel-2' });
});

// ---------- A04 forest resources ----------
r.get('/tai-nguyen', requirePerm('dashboard.view'), (req, res) => {
  res.render('admin/forest', { title: 'Quản lý hiện trạng rừng', section: 'forest', communes: repo.communes().filter((c) => c.official), summary: repo.forestSummary(), validation: readJson(path.join(paths.processed, 'official-statistics-validation.json')) });
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
  res.render('admin/analysis', { title: 'Phân tích rừng (Python)', section: 'analysis', jobs: jobs.list(), defs: jobs.JOBS, running: jobs.isRunning(), plan: jobs.plan(), periods: jobs.PERIODS, schedulerOn: jobs.schedulerOn(), firmsSt: require('../services/firms').status(), fcg: repo.forestChange(), fd: repo.fireDanger(), job: req.query.job ? store.get('jobs', req.query.job) : null });
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
    hotspots: repo.hotspots(), dangerAlerts: alerts.fireDangerAlerts(3), candidates: repo.changeCandidates().features.map((f) => f.properties).sort((a, b) => b.area_ha - a.area_ha),
    HS: repo.HOTSPOT_STATUS, CS: repo.CANDIDATE_STATUS, DS: alerts.DANGER_STATUS, users: store.all('users').filter((u) => u.active),
    filter: req.query,
  });
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
  res.render('admin/news', { title: 'Quản lý tin tức', section: 'news', list, categories: content.CATEGORIES, statuses: content.STATUS, filter: req.query });
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
  res.render('admin/reports', { title: 'Quản lý phản ánh hiện trường', section: 'reports', list, types: reports.TYPES, statuses: reports.STATUS, filter: req.query });
});
r.get('/phan-anh/:id', requirePerm('reports.view'), (req, res, next) => {
  const x = store.get('reports', req.params.id);
  if (!x) return next();
  store.audit(me(req), 'report.view', x.code);
  return res.render('admin/report-detail', { title: `Phản ánh ${x.code}`, section: 'reports', x: reports.decorate(x), statuses: reports.STATUS, users: store.all('users').filter((u) => u.active && u.role === 'specialist') });
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

// ---------- Bản đồ và lớp dữ liệu → Quản lý bản đồ (PDF/GeoTIFF) ----------
r.use('/ban-do', require('./maps-admin'));

// ---------- A12 documents ----------
r.get('/tai-lieu', requirePerm('dashboard.view'), (req, res) => res.render('admin/documents', { title: 'Quản lý tài liệu – bản đồ PDF', section: 'docs', docs: repo.documents(), categories: repo.DOC_CATEGORIES }));
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
r.get('/cai-dat', async (req, res) => res.render('admin/settings', {
  db: { ...(await require('../db/pool').ping()), store: store.status() },
  push: await require('../services/notifier').stats().catch(() => null), realtime: await require('../services/realtime').stats().catch(() => ({ connections: 0 })),
  title: 'Cài đặt hệ thống', section: 'settings', freshness: repo.dataFreshness(), weather: weatherSvc.status(), firms: firmsSvc.status(),
  env: { mapbox: Boolean(config.mapboxToken), openweather: Boolean(config.openWeatherKey), gee: fs.existsSync(path.join(config.ROOT, '.secrets', 'gee-key.json')), dataJobs: config.enableDataJobs, drafts: config.showDraftContent },
}));

module.exports = r;
