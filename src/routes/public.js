const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const ExcelJS = require('exceljs');
const repo = require('../data/repo');
const store = require('../data/store');
const alerts = require('../services/alerts');
const content = require('../services/content');
const reports = require('../services/reports');
const weatherSvc = require('../services/weather');
const { rateLimit, checkCsrf } = require('../middleware/security');
const maps = require('../services/maps');

const r = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimetype)),
});

function avg(list, f) { const v = list.map(f).filter((x) => Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }

function weatherSummary() {
  const w = repo.weatherSnapshot().filter((x) => x.current);
  return {
    temp: avg(w, (x) => x.current.temp), humidity: avg(w, (x) => x.current.humidity), wind_ms: avg(w, (x) => x.current.wind_ms),
    dt: w[0] ? w.map((x) => x.current.dt).sort().pop() : null, live: w.some((x) => x.current.live), points: w.length,
    description: w[0] ? w[0].current.description : null, icon: w[0] ? w[0].current.icon : null,
  };
}

function dangerSummary() {
  const fd = repo.fireDanger();
  if (!fd) return null;
  const count = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }; const peak = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const c of fd.communes) {
    if (c.current) count[c.current.cls] += 1;
    peak[Math.max(...[c.current, ...c.forecast].filter(Boolean).map((d) => d.cls))] += 1;
  }
  const days = fd.communes[0].forecast.map((d) => d.date);
  const daily = days.map((date, i) => {
    const cls = fd.communes.map((c) => (c.forecast[i] ? c.forecast[i].cls : null)).filter(Boolean);
    return { date, max: Math.max(...cls), atLeast3: cls.filter((x) => x >= 3).length, mean_p: avg(fd.communes, (c) => (c.forecast[i] ? c.forecast[i].p : NaN)) };
  });
  return { count, peak, daily, today: fd.today_local, generated: fd.generated_at_utc, inputs: fd.inputs_collected_at_utc, validation: fd.validation, method: fd.method };
}

r.get('/', (req, res) => {
  const hs = repo.hotspots();
  const fcg = repo.forestChange();
  res.render('public/home', {
    title: 'Trang chủ', nav: 'home',
    summary: repo.forestSummary(), hotspots: hs, firms: repo.firmsMeta(), weather: weatherSummary(), danger: dangerSummary(),
    reportCounts: reports.counts(), alertFeed: alerts.feed({ limit: 4 }), articles: content.list().slice(0, 4), documents: repo.documents().filter((d) => d.type === 'pdf').slice(0, 3),
    change: fcg ? { loss2024: fcg.history.aoi_annual_loss_ha['2024'], candidates: repo.changeCandidates().features.length, auc: fcg.forecast.validation.auc } : null,
    overlays: repo.overlays(),
  });
});

r.get('/ban-do', async (req, res) => {
  const mapLayers = await maps.publishedLayers().catch(() => []);
  res.render('public/map', {
    title: 'Bản đồ WebGIS', nav: 'map', overlays: repo.overlays(), custom: repo.customLayers(false), mapLayers,
    weather: weatherSummary(), danger: dangerSummary(), summary: repo.forestSummary(), firms: repo.firmsMeta(),
    hotspotCount: repo.hotspots().length, fcg: repo.forestChange(),
  });
});

r.get('/tai-nguyen-rung', (req, res) => {
  const communes = repo.communes().sort((a, b) => (b.official ? b.official.established_forest_ha : 0) - (a.official ? a.official.established_forest_ha : 0));
  res.render('public/forest', {
    title: 'Tài nguyên rừng', nav: 'forest', summary: repo.forestSummary(), communes, landcover: repo.landcover(), photos: repo.photos(),
    overlays: repo.overlays(), fcg: repo.forestChange(), lc: repo.landcoverHistory(), tab: req.query.tab || 'tong-quan',
  });
});

r.get('/bien-dong/lop/:id.webp', (req, res) => {
  const runs = require('../services/changeRuns');
  const run = runs.get(req.params.id);
  const f = run && runs.overlayFile(run.id);
  if (!f || !(run.published || (req.session && req.session.user))) return res.status(404).end();
  res.set('Cache-Control', run.published ? 'public, max-age=300' : 'no-store');
  return res.sendFile(f);
});

r.get('/bien-dong-rung', (req, res) => {
  const fcg = repo.forestChange();
  const cands = repo.changeCandidates();
  const communes = repo.communes().filter((c) => c.risk).sort((a, b) => b.risk.expected_loss_ha - a.risk.expected_loss_ha);
  res.render('public/change', {
    title: 'Biến động và dự báo mất rừng', nav: 'forest', fcg, candidates: cands.features.map((f) => f.properties).sort((a, b) => b.area_ha - a.area_ha),
    communes, overlays: repo.overlays(), readiness: repo.readiness(), selected: req.query.diem || null, lc: repo.landcoverHistory(),
  });
});

r.get('/canh-bao-chay', (req, res) => {
  const hs = repo.hotspots().map(repo.publicHotspot);
  res.render('public/fire', {
    title: 'Cảnh báo cháy rừng', nav: 'fire', hotspots: hs, firms: repo.firmsMeta(), danger: dangerSummary(), fireDanger: repo.fireDanger(),
    dangerAlerts: alerts.fireDangerAlerts(3), weather: weatherSummary(), history: repo.firmsHistory(), burned: repo.burnedHistory(),
    communes: repo.communes(), overlays: repo.overlays(), selectedCommune: req.query.xa || null, selectedHotspot: req.query.diem || null, tab: req.query.tab || 'tong-quan',
  });
});

r.get('/tin-tuc', (req, res) => {
  let list = content.list({ category: req.query.muc, q: req.query.q });
  if (Number(req.query.tg) > 0) { const since = Date.now() - Number(req.query.tg) * 864e5; list = list.filter((a) => new Date(a.published_at || a.created_at).getTime() >= since); }
  const all = content.list();
  const counts = Object.fromEntries(Object.keys(content.CATEGORIES).map((k) => [k, all.filter((a) => a.category === k).length]));
  res.render('public/news', {
    title: 'Tin tức', nav: 'news', list, all, counts, categories: content.CATEGORIES, current: req.query.muc || '', q: req.query.q || '',
    notices: alerts.feed({ limit: 5 }), weather: weatherSummary(), documents: repo.documents().slice(0, 4), freshness: repo.dataFreshness(),
  });
});

r.get('/tin-tuc/:slug', (req, res, next) => {
  const a = content.bySlug(req.params.slug);
  if (!a) return next();
  const row = store.get('articles', a.id);
  store.update('articles', a.id, { views: (row.views || 0) + 1 });
  return res.render('public/article', { title: a.title, nav: 'news', a, related: content.list({ category: a.category }).filter((x) => x.id !== a.id).slice(0, 4), photos: repo.photos(),
    comments: content.comments(a.id), sent: req.query.da_gui === '1' });
});
r.post('/tin-tuc/:slug/binh-luan', rateLimit('comment', 6, 3600e3), (req, res) => {
  const a = content.bySlug(req.params.slug);
  if (!a || a.status !== 'published') return res.redirect('/tin-tuc');
  if (req.body.website) return res.redirect(`/tin-tuc/${a.slug}`); // honeypot
  try {
    const c = content.addComment(a, { name: req.body.name, body: req.body.body, user: req.session.citizen || null });
    store.audit(req.session.citizen ? { username: req.session.citizen.username, role: 'citizen' } : null, 'comment.create', c.id, { article: a.slug });
    return res.redirect(`/tin-tuc/${a.slug}?da_gui=1#binh-luan`);
  } catch (e) { req.session.flash = { type: 'error', text: e.message }; return res.redirect(`/tin-tuc/${a.slug}#binh-luan`); }
});

// ---------- tài khoản người dân trên web (dùng chung tài khoản MobileGIS) ----------
const mobileAuth = require('../services/mobile-auth');
const safeNext = (n, d) => { const s = String(n || ''); return s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/quan-tri') ? s : d; };
r.get('/dang-ky', (req, res) => {
  if (req.session.citizen) return res.redirect('/tai-khoan');
  return res.render('public/register', { title: 'Đăng ký tài khoản', nav: '', form: {}, error: null, next: safeNext(req.query.next, '/tai-khoan') });
});
r.post('/dang-ky', rateLimit('register', 5, 3600e3), async (req, res, next) => {
  try {
    const b = req.body; const nextUrl = safeNext(b.next, '/tai-khoan');
    const fail = (error) => res.status(400).render('public/register', { title: 'Đăng ký tài khoản', nav: '', form: { name: b.name, phone: b.phone, email: b.email }, error, next: nextUrl });
    if (b.website) return res.redirect('/'); // honeypot
    if (String(b.password || '') !== String(b.password2 || '')) return fail('Mật khẩu nhập lại không khớp.');
    if (!b.agree) return fail('Vui lòng đồng ý với điều khoản sử dụng.');
    const out = await mobileAuth.createCitizen({ name: b.name, phone: b.phone, email: b.email, password: b.password }, 'web');
    if (out.error) return fail(out.error);
    return req.session.regenerate(() => {
      req.session.citizen = { id: out.user.id, username: out.user.username, name: out.user.name };
      req.session.flash = { type: 'ok', text: 'Đăng ký thành công. Bạn có thể dùng tài khoản này trên ứng dụng MobileGIS.' };
      res.redirect(nextUrl);
    });
  } catch (e) { return next(e); }
});
r.get('/dang-nhap', (req, res) => {
  if (req.session.citizen) return res.redirect('/tai-khoan');
  return res.render('public/signin', { title: 'Đăng nhập', nav: '', error: null, username: '', next: safeNext(req.query.next, '/tai-khoan') });
});
r.post('/dang-nhap', rateLimit('citizen-login', 10, 15 * 60e3), async (req, res, next) => {
  try {
    const nextUrl = safeNext(req.body.next, '/tai-khoan');
    const v = await mobileAuth.verifyCredentials({ username: req.body.username, password: req.body.password }, 'web');
    if (v.error) return res.status(v.status || 401).render('public/signin', { title: 'Đăng nhập', nav: '', error: v.error, username: String(req.body.username || '').slice(0, 80), next: nextUrl });
    const u = v.user;
    if (u.role !== 'citizen') { // tài khoản cán bộ: chuyển sang đăng nhập quản trị
      return res.render('public/signin', { title: 'Đăng nhập', nav: '', error: 'Đây là tài khoản cán bộ – vui lòng đăng nhập tại trang Quản trị.', username: u.username, next: nextUrl, staff: true });
    }
    return req.session.regenerate(() => {
      req.session.citizen = { id: u.id, username: u.username, name: u.name };
      store.update('users', u.id, { last_login: store.now() });
      store.audit({ username: u.username, role: 'citizen' }, 'web.auth.login', u.username);
      res.redirect(nextUrl);
    });
  } catch (e) { return next(e); }
});
r.post('/dang-xuat', (req, res) => { delete req.session.citizen; res.redirect('/'); });
r.get('/tai-khoan', (req, res) => {
  if (!req.session.citizen) return res.redirect('/dang-nhap?next=/tai-khoan');
  const u = store.get('users', req.session.citizen.id);
  if (!u || !u.active) { delete req.session.citizen; return res.redirect('/dang-nhap'); }
  const mine = store.filter('reports', (x) => x.created_by === u.id).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(reports.publicView);
  const myComments = store.filter('comments', (c) => c.user_id === u.id).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20)
    .map((c) => ({ ...c, article: (store.get('articles', c.article_id) || {}), statusLabel: content.COMMENT_STATUS[c.status] }));
  return res.render('public/account', { title: 'Tài khoản của tôi', nav: '', u, mine, myComments });
});
r.post('/tai-khoan', rateLimit('citizen-account', 20, 3600e3), async (req, res, next) => {
  try {
    if (!req.session.citizen) return res.redirect('/dang-nhap');
    const u = store.get('users', req.session.citizen.id); const b = req.body;
    if (b.action === 'password') {
      const out = await mobileAuth.changePassword({ sub: u.id }, { current: b.current, password: b.password });
      req.session.flash = out && out.error ? { type: 'error', text: out.error } : { type: 'ok', text: 'Đã đổi mật khẩu.' };
    } else {
      const name = String(b.name || '').trim().slice(0, 120);
      if (name.length >= 2) { store.update('users', u.id, { name }); req.session.citizen.name = name; req.session.flash = { type: 'ok', text: 'Đã cập nhật thông tin.' }; }
    }
    return res.redirect('/tai-khoan');
  } catch (e) { return next(e); }
});

r.get('/phan-anh', (req, res) => {
  const list = reports.listPublic({ type: req.query.loai, status: req.query.trang_thai });
  const lookup = req.query.ma ? reports.byCode(req.query.ma) : null;
  res.render('public/reports', {
    title: 'Phản ánh hiện trường', nav: 'reports', list, types: reports.TYPES, statuses: reports.STATUS, counts: reports.counts(),
    lookup: lookup ? reports.publicView(lookup) : null, lookupCode: req.query.ma || '', submitted: req.query.da_gui || null, filter: req.query,
  });
});

r.post('/phan-anh', rateLimit('report', 5, 3600e3), upload.array('photos', 5), checkCsrf, async (req, res, next) => {
  try {
    if (req.body.website) return res.redirect('/phan-anh'); // honeypot
    const desc = String(req.body.description || '').trim();
    if (desc.length < 10) { req.session.flash = { type: 'error', text: 'Vui lòng mô tả hiện trạng (ít nhất 10 ký tự).' }; return res.redirect('/phan-anh#gui'); }
    const row = await reports.create(req.body, req.files, req.session.citizen || null);
    store.audit(req.session.citizen ? { username: req.session.citizen.username, role: 'citizen' } : null, 'report.create', row.code);
    return res.redirect(`/phan-anh?da_gui=${row.code}&ma=${row.code}`);
  } catch (e) { return next(e); }
});

// ---------- So sánh ảnh vệ tinh, ảnh tháng, lớp phân loại ----------
const imagery = require('../services/imagery');
r.get('/so-sanh-anh', (req, res) => {
  res.render('public/compare', { title: 'So sánh ảnh vệ tinh', nav: 'map', months: imagery.months(), modes: imagery.MODES, overlays: repo.overlays() });
});
r.get('/anh-ve-tinh/thang/:file', async (req, res, next) => {
  const m = String(req.params.file).match(/^(\d{4}-\d{2})-(true|false|ndvi)\.webp$/);
  if (!m) return next();
  try { const f = await imagery.monthImage(m[1], m[2]); res.set('Cache-Control', 'public, max-age=86400'); return res.sendFile(f); } catch (e) { return e.status === 404 ? next() : next(e); }
});
r.get('/anh-ve-tinh/phan-loai/:file', (req, res, next) => {
  const m = String(req.params.file).match(/^(\d{4}-\d{2})\.webp$/);
  if (!m) return next();
  const c = imagery.classifications().find((x) => x.month === m[1]);
  if (!c || (!c.published && !req.session.user)) return next();
  const f = imagery.classFile(m[1], 'webp');
  return f ? res.sendFile(f) : next();
});

r.get('/phan-anh/anh/:file', (req, res, next) => {
  const file = path.basename(req.params.file);
  const rep = store.find('reports', (x) => x.photos.includes(file));
  const staff = Boolean(req.session.user);
  if (!rep || (!staff && !(rep.public && rep.public_photos))) return next();
  return res.sendFile(path.join(reports.PHOTO_DIR, file));
});

// Published thematic maps (map module) appear as documents; georeferenced ones also on the WebGIS.
async function mapDocuments() {
  const rows = await maps.publishedDocuments().catch(() => []);
  return rows.map((m) => ({
    id: `map-${m.id}`, title: m.title, category: 'ban-do-chuyen-de', categoryLabel: 'Bản đồ chuyên đề', issuer: m.source_org || null, number: m.map_scale ? `Tỷ lệ ${m.map_scale}` : null,
    issued: m.map_year ? String(m.map_year) : null, description: m.description, type: m.format === 'pdf' ? 'pdf' : m.format === 'package' ? 'mpk' : 'tif', bytes: m.size_bytes, sha256: m.sha256,
    pages: m.tech && m.tech.pages, thumbnail: m.preview_url, url: `/ban-do-chuyen-de/tep/${m.file_id}`, origin: 'map', georeferenced: m.georeferenced, mapId: m.id,
    preview: m.preview_url, original_name: m.original_filename,
  }));
}

r.get('/tai-lieu', async (req, res) => {
  const mapDocs = await mapDocuments();
  const allDocs = () => [...repo.documents(), ...mapDocs];
  let docs = allDocs();
  const counts = Object.fromEntries(Object.keys(repo.DOC_CATEGORIES).map((k) => [k, docs.filter((d) => d.category === k).length]));
  if (!req.query.loai) docs = docs.sort((a, b) => (a.origin === 'map') - (b.origin === 'map'));
  if (req.query.loai) docs = docs.filter((d) => d.category === req.query.loai);
  if (req.query.q) { const q = req.query.q.toLowerCase(); docs = docs.filter((d) => `${d.title} ${d.issuer || ''} ${d.number || ''}`.toLowerCase().includes(q)); }
  if (req.query.co_quan) docs = docs.filter((d) => d.issuer === req.query.co_quan);
  const all = allDocs();
  const selected = all.find((d) => d.id === req.query.id) || docs[0] || null;
  res.render('public/documents', {
    title: 'Tài liệu – Bản đồ PDF', nav: 'docs', docs, all, counts, categories: repo.DOC_CATEGORIES, selected, filter: req.query,
    issuers: [...new Set(all.map((d) => d.issuer).filter(Boolean))],
  });
});

r.get('/ban-do-chuyen-de/tep/:id', async (req, res, next) => {
  try {
    if (!/^[0-9a-f-]{36}$/.test(req.params.id) || !maps.enabled()) return next();
    const f = await maps.fileForRequest(req.params.id, req.session.user);
    if (!f || !fs.existsSync(f.abs)) return next();
    if (req.query.tai) await maps.audit(f.dataset_id, req.session.user || { username: `public:${req.ip}` }, 'download', { file: f.original_filename, role: f.file_role });
    const inline = !req.query.tai && /^(image\/|application\/pdf)/.test(f.mime_type || '');
    res.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.original_filename || 'ban-do')}`);
    if (f.file_role !== 'original') res.set('Cache-Control', 'public, max-age=86400');
    return res.type(f.mime_type || 'application/octet-stream').sendFile(f.abs);
  } catch (e) { return next(e); }
});

r.get('/ban-do-chuyen-de/tiles/:id/:z/:x/:y.png', async (req, res, next) => {
  try {
    const { id, z, x, y } = req.params;
    if (!/^[0-9a-f-]{36}$/.test(id) || ![z, x, y].every((n) => /^\d{1,6}$/.test(n)) || !maps.enabled()) return next();
    const f = await maps.tilePath(id, z, x, y, req.session.user);
    if (!f) return res.status(404).end();
    res.set('Cache-Control', req.session.user ? 'private, max-age=300' : 'public, max-age=86400');
    return fs.existsSync(f) ? res.type('image/png').sendFile(f) : res.status(204).end();
  } catch (e) { return next(e); }
});

r.get('/tai-lieu/tep/:id', (req, res, next) => {
  const f = repo.documentFile(req.params.id);
  if (!f || !fs.existsSync(f.file)) return next();
  const name = f.doc.file || f.doc.original_name || `${f.doc.id}.pdf`;
  res.set('Content-Disposition', `${req.query.tai ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`);
  return res.sendFile(f.file);
});

r.get('/gioi-thieu', (req, res) => res.render('public/about', {
  title: 'Giới thiệu', nav: 'about', summary: repo.forestSummary(), landcover: repo.landcover(), photos: repo.photos(), communes: repo.communes(),
}));

r.get('/thoi-tiet', (req, res) => {
  const list = repo.weatherSnapshot();
  const code = req.query.xa || (list.find((x) => /Kon Tum|Đăk Cấm/.test(x.fullName)) || list[0]).code;
  res.render('public/weather', {
    title: 'Thời tiết – Khí hậu', nav: 'weather', list, code, selected: list.find((x) => x.code === code), forecast: repo.dailyForecast(code),
    fd: (repo.fireDanger() || { communes: [] }).communes.find((c) => c.code === code), summary: weatherSummary(), climate: repo.climateMonthly(), weatherStatus: weatherSvc.status(),
  });
});

r.get('/thong-ke', (req, res) => {
  const communes = repo.communes();
  res.render('public/statistics', {
    title: 'Thống kê – Báo cáo', nav: 'stats', summary: repo.forestSummary(), communes, fcg: repo.forestChange(), history: repo.firmsHistory(),
    burned: repo.burnedHistory(), danger: dangerSummary(), landcover: repo.landcover(), topic: req.query.chu_de || 'tai-nguyen',
    dangerMonthly: repo.fireDanger() ? repo.fireDanger().monthly_class_counts : null,
  });
});

function statRows() {
  return repo.communes().map((c) => {
    const o = c.official || {};
    return {
      'Mã xã': c.code, 'Tên xã/phường': c.fullName, 'Diện tích tự nhiên (ha)': o.natural_area_ha, 'Rừng đã thành rừng (ha)': o.established_forest_ha,
      'Rừng tự nhiên (ha)': o.natural_forest_ha, 'Rừng trồng đã thành rừng (ha)': o.established_plantation_ha, 'Rừng trồng chưa thành rừng (ha)': o.immature_plantation_ha,
      'QH đặc dụng (ha)': o.special_use_planning_ha, 'QH phòng hộ (ha)': o.protection_planning_ha, 'QH sản xuất (ha)': o.production_planning_ha,
      'Tỷ lệ che phủ công bố (%)': o.official_forest_cover_percent, 'Mất tán cây Hansen 2020–2024 (ha)': c.loss ? Math.round(c.loss.last5 * 10) / 10 : null,
      'Dự báo mất rừng kỳ vọng 2025–2026 (ha)': c.risk ? c.risk.expected_loss_ha : null, 'Cấp nguy cơ cháy hiện tại': c.danger && c.danger.current ? c.danger.current.cls : null,
    };
  });
}
const STAT_NOTE = 'Nguồn: QĐ 1047/QĐ-UBND ngày 31/3/2026 (số liệu 31/12/2025, toàn xã hiện hành); Hansen GFC v1.12; mô hình dự báo và cấp nguy cơ cháy do hệ thống tính tự động, chưa phải cảnh báo chính thức.';

r.get('/thong-ke/xuat.csv', (req, res) => {
  const rows = statRows();
  const head = Object.keys(rows[0]);
  const csv = [`# ${STAT_NOTE}`, head.join(','), ...rows.map((x) => head.map((h) => (x[h] === null || x[h] === undefined ? '' : `"${String(x[h]).replace(/"/g, '""')}"`)).join(','))].join('\r\n');
  res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="thong-ke-rung-kon-tum.csv"').send(`﻿${csv}`);
});

r.get('/thong-ke/xuat.xlsx', async (req, res, next) => {
  try {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Thống kê theo xã');
    const rows = statRows();
    ws.columns = Object.keys(rows[0]).map((k) => ({ header: k, key: k, width: Math.max(12, k.length + 2) }));
    rows.forEach((x) => ws.addRow(x));
    ws.getRow(1).font = { bold: true };
    ws.addRow([]); ws.addRow([STAT_NOTE]);
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').set('Content-Disposition', 'attachment; filename="thong-ke-rung-kon-tum.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { next(e); }
});

r.get('/huong-dan/mobile', (req, res) => res.render('public/user-guide', { title: 'Hướng dẫn sử dụng ứng dụng MobileGIS', nav: 'guide', guide: require('../content/guide').mobileGuide, other: { href: '/huong-dan/su-dung', label: 'Hướng dẫn cổng web' } }));
r.get('/huong-dan/su-dung', (req, res) => res.render('public/user-guide', { title: 'Tài liệu hướng dẫn sử dụng', nav: 'guide', guide: require('../content/guide').publicGuide }));
r.get('/huong-dan', (req, res) => res.render('public/guide', { title: 'Hướng dẫn – Hỏi đáp', nav: 'guide', danger: dangerSummary(), fcg: repo.forestChange() }));

module.exports = r;
