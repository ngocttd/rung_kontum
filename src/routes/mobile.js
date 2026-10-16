// MobileGIS REST API v1 (/api/mobile/...) – Đặc tả MobileGIS mục 8.
// Bearer token auth (no cookies, no CSRF); every permission is checked on the server; errors are
// { error, code } with a consistent HTTP status; lists are paginated (?page=&limit=).
const express = require('express');
const path = require('path');
const repo = require('../data/repo');
const store = require('../data/store');
const config = require('../config');
const alerts = require('../services/alerts');
const content = require('../services/content');
const reports = require('../services/reports');
const auth = require('../services/mobile-auth');
const field = require('../services/field');
const { can, rateLimit, ROLES } = require('../middleware/security');

const API_VERSION = '1.0';
const MIN_APP_VERSION = '1.0.0';
const r = express.Router();

r.use((req, res, next) => {
  res.set('X-API-Version', API_VERSION);
  res.set('Cache-Control', 'no-store');
  next();
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => {
  if (e instanceof field.FieldError) return res.status(e.status).json({ error: e.message, code: e.code, ...(e.extra || {}) });
  return next(e);
});
const reply = (res, out) => (out && out.error ? res.status(out.status || 400).json({ error: out.error, code: out.code }) : res.json(out));

// ---------- authentication ----------
async function readToken(req) {
  const h = req.get('authorization') || '';
  if (!h.startsWith('Bearer ')) return null;
  const p = auth.verifyAccess(h.slice(7));
  if (!p || !(await auth.sidActive(p.sid))) return false;
  const u = store.get('users', p.sub);
  if (!u || !u.active) return false;
  return { ...p, role: u.role, scope: u.scope || null }; // role/scope changes apply immediately
}
const optionalAuth = wrap(async (req, res, next) => {
  const a = await readToken(req);
  if (a === false) return res.status(401).json({ error: 'Phiên đăng nhập hết hạn.', code: 'TOKEN_EXPIRED' });
  req.auth = a; return next();
});
const requireAuth = (perm) => wrap(async (req, res, next) => {
  const a = await readToken(req);
  if (!a) return res.status(401).json({ error: 'Cần đăng nhập.', code: a === false ? 'TOKEN_EXPIRED' : 'UNAUTHENTICATED' });
  if (perm && !can({ role: a.role }, perm)) return res.status(403).json({ error: 'Tài khoản không có quyền thực hiện thao tác này.', code: 'FORBIDDEN' });
  req.auth = a; return next();
});
const page = (req, list) => {
  const p = Math.max(1, Number(req.query.page) || 1); const l = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  return { total: list.length, page: p, limit: l, pages: Math.max(1, Math.ceil(list.length / l)), items: list.slice((p - 1) * l, p * l) };
};

r.post('/auth/login', rateLimit('m-login', 20, 15 * 60e3), wrap(async (req, res) => reply(res, await auth.login(req.body || {}))));
r.post('/auth/register', rateLimit('m-register', 5, 3600e3), wrap(async (req, res) => {
  const out = await auth.register(req.body || {});
  return out.error ? reply(res, out) : res.status(201).json(out);
}));
r.post('/auth/refresh', rateLimit('m-refresh', 120, 15 * 60e3), wrap(async (req, res) => reply(res, await auth.refresh(req.body || {}))));
r.post('/auth/demo', rateLimit('m-demo', 60, 15 * 60e3), wrap(async (req, res) => reply(res, await auth.demoLogin(req.body || {}))));
r.post('/auth/logout', requireAuth(), wrap(async (req, res) => { await auth.logout(req.auth, req.body || {}); res.json({ ok: true }); }));
r.post('/auth/password', requireAuth(), wrap(async (req, res) => reply(res, await auth.changePassword(req.auth, req.body || {}))));
r.post('/auth/forgot', rateLimit('m-forgot', 5, 3600e3), (req, res) => {
  // no self-service reset without an SMS/email gateway: ask the user to contact the unit (audited)
  store.audit(null, 'mobile.auth.forgot', String((req.body || {}).username || '').slice(0, 60));
  res.json({ ok: true, message: 'Yêu cầu đã được ghi nhận. Vui lòng liên hệ Hạt Kiểm lâm/Sở NN&MT để được cấp lại mật khẩu (cán bộ) hoặc gọi đường dây nóng (người dân).' });
});
r.get('/me', requireAuth(), (req, res) => res.json(auth.publicUser(store.get('users', req.auth.sub))));

// ---------- bootstrap: config, permissions, catalogs ----------
r.get('/bootstrap', optionalAuth, (req, res) => {
  const communes = repo.communes().map((c) => ({ code: c.code, name: c.fullName, short: c.name, center: c.centroid }));
  const u = req.auth ? store.get('users', req.auth.sub) : null;
  res.json({
    api_version: API_VERSION, min_app_version: MIN_APP_VERSION, server_time: new Date().toISOString(),
    user: u ? auth.publicUser(u) : null,
    permissions: req.auth ? auth.permissionsOf(req.auth.role) : [],
    roles: ROLES,
    features: { demo_login: auth.demoEnabled(), register: true, offline: true, push: true },
    // thông báo: Socket.IO khi ứng dụng mở + push theo nền tảng (APNs / Web Push qua UnifiedPush) – không Firebase
    realtime: { path: '/socket.io', namespace: '/mobile' },
    push: { webpush_vapid_public_key: require('../services/push/webpush').publicKey(), apns: require('../services/push/apns').configured() },
    demo_roles: auth.demoEnabled() ? auth.demoRoles() : [],
    map: {
      mapbox_token: config.mapboxToken || null, // public pk token, URL-restricted in the Mapbox account
      bounds: [107.33, 13.91, 108.56, 15.43], center: [107.95, 14.65], zoom: 8,
      basemaps: [
        { id: 'satellite', title: 'Vệ tinh', url: config.mapboxToken ? `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/256/{z}/{x}/{y}@2x?access_token=${config.mapboxToken}` : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: config.mapboxToken ? '© Mapbox © OpenStreetMap © Maxar' : '© Esri' },
        { id: 'streets', title: 'Đường phố', url: config.mapboxToken ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}@2x?access_token=${config.mapboxToken}` : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap' },
        { id: 'terrain', title: 'Địa hình', url: config.mapboxToken ? `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/tiles/256/{z}/{x}/{y}@2x?access_token=${config.mapboxToken}` : 'https://tile.opentopomap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap' },
        { id: 'light', title: 'Nền nhạt', url: config.mapboxToken ? `https://api.mapbox.com/styles/v1/mapbox/light-v11/tiles/256/{z}/{x}/{y}@2x?access_token=${config.mapboxToken}` : 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', attribution: '© CARTO © OpenStreetMap' },
      ],
    },
    catalogs: {
      report_types: Object.entries(reports.TYPES).map(([k, v]) => ({ key: k, label: v.label, marker: v.marker })),
      report_status: Object.entries(reports.STATUS).map(([k, v]) => ({ key: k, label: v.label, tone: v.tone })),
      hotspot_status: repo.HOTSPOT_STATUS, candidate_status: repo.CANDIDATE_STATUS, danger_levels: alerts.LEVEL_LABEL, danger_status: alerts.DANGER_STATUS,
      forest_types: field.FOREST_TYPES, verdicts: field.VERDICTS, change_causes: field.CHANGE_CAUSES, assignment_status: field.ASSIGNMENT_STATUS,
      news_categories: content.CATEGORIES,
    },
    communes,
    freshness: repo.dataFreshness(),
    contact: { hotline: '0260 3862 365', unit: 'Chi cục Kiểm lâm tỉnh – khu vực Kon Tum', note: 'Khi phát hiện cháy rừng, gọi ngay 114 hoặc kiểm lâm địa bàn.' },
  });
});

// ---------- map layers (M04) ----------
const intersects = (a, b) => !b || (a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]);
r.get('/layers', optionalAuth, wrap(async (req, res) => {
  const bbox = req.query.bbox ? String(req.query.bbox).split(',').map(Number) : null;
  const box = bbox && bbox.length === 4 && bbox.every(Number.isFinite) ? bbox : null;
  const zoom = Number(req.query.zoom) || null;
  const AOI = [107.33, 13.91, 108.56, 15.43];
  const groups = { landcover: 'Lớp phủ 1991–2023', forest: 'Tài nguyên rừng', change: 'Biến động – dự báo mất rừng', imagery: 'Ảnh vệ tinh', terrain: 'Địa hình – chỉ số' };
  const groupOf = (id) => (id.startsWith('lc-') ? 'landcover' : id.startsWith('s2-') ? 'imagery' : /hansen|risk/.test(id) ? 'change' : /dem|ndvi/.test(id) ? 'terrain' : 'forest');
  const raster = repo.overlays().filter((o) => intersects(AOI, box)).map((o) => ({
    id: o.id, title: o.title, kind: 'raster', group: groupOf(o.id), group_label: groups[groupOf(o.id)], source: o.source, meaning: o.meaning, resolution: o.resolution || o.scale,
    legend: o.legend || [], image: { url: o.url, coordinates: o.coordinates }, tiles: o.tiles || null,
  }));
  const maps = await require('../services/maps').publishedLayers().catch(() => []);
  for (const m of maps) {
    const b = m.overlay_bounds; const bb = b ? [b[0][0], b[2][1], b[1][0], b[0][1]] : AOI;
    if (!intersects(bb, box)) continue;
    const t = m.display && m.display.tiles;
    raster.push({ id: `m-${m.id}`, title: m.title, kind: 'raster', group: 'maps', group_label: 'Bản đồ chuyên đề', source: `${m.source_org || ''}${m.map_year ? ` · ${m.map_year}` : ''}`, meaning: m.description,
      image: { url: m.overlay_url, coordinates: b }, tiles: t ? { url: `/ban-do-chuyen-de/tiles/${m.id}/{z}/{x}/{y}.png`, minzoom: t.minzoom, maxzoom: t.maxzoom, bounds: t.bounds } : null });
  }
  const vector = [
    { id: 'province', title: 'Ranh giới Kon Tum (cũ)', group: 'admin', url: '/api/public/boundaries/province', default: true },
    { id: 'communes', title: 'Ranh giới xã/phường (40 đơn vị)', group: 'admin', url: '/api/public/boundaries/communes', default: true, choropleth: ['cover', 'forest_ha', 'risk_mean', 'danger_cls', 'danger_max7'] },
    { id: 'hotspots', title: 'Điểm nóng cháy FIRMS 7 ngày (chưa xác minh trừ khi ghi rõ)', group: 'fire', url: '/api/mobile/fire/hotspots', default: true },
    { id: 'candidates', title: 'Biến động rừng nghi vấn', group: 'change', url: '/api/public/forest/candidates' },
    { id: 'samples', title: 'Mẫu thực địa 2025', group: 'landcover', url: '/api/public/field-samples' },
    { id: 'reports', title: 'Phản ánh công khai', group: 'field', url: '/api/public/reports?limit=500' },
    { id: 'weather', title: 'Thời tiết các xã', group: 'env', url: '/api/public/weather' },
    ...repo.customLayers(false).map((l) => ({ id: `c-${l.id}`, title: l.title, group: 'maps', url: `/api/public/layers/custom/${l.id}`, style: l.style })),
  ];
  if (req.auth && ['specialist', 'leader'].includes(req.auth.role)) vector.push({ id: 'tasks', title: 'Nhiệm vụ hiện trường', group: 'field', url: '/api/mobile/assignments', internal: true });
  res.json({ zoom, bbox: box, groups: { ...groups, admin: 'Hành chính', fire: 'Cảnh báo cháy rừng', field: 'Hiện trường', env: 'Môi trường', maps: 'Bản đồ chuyên đề' }, raster, vector });
}));

// ---------- public data (M03, M06–M10, M12, M13) ----------
r.get('/home', optionalAuth, (req, res) => {
  const fs = repo.forestSummary();
  const hs = repo.hotspots();
  const fd = repo.fireDanger();
  res.json({
    forest: fs, hotspots_7d: hs.length, hotspots_unverified: hs.filter((h) => ['new', 'assigned', 'verifying'].includes(h.status)).length,
    danger_today: fd ? { date: fd.today, max_level: Math.max(0, ...fd.communes.map((c) => (c.current ? c.current.cls : 0))), source: 'Chỉ số P Nesterov – tự động, chưa phải cảnh báo chính thức' } : null,
    alerts: alerts.feed({ limit: 6 }), news: content.list({}).slice(0, 5).map(newsCard), freshness: repo.dataFreshness(),
  });
});
r.get('/forest/summary', (req, res) => res.json({ summary: repo.forestSummary(), communes: repo.communes().map((c) => ({ code: c.code, name: c.fullName, official: c.official, loss: c.loss ? { last5: c.loss.last5, annual: c.loss.annual } : null, risk: c.risk })), landcover: repo.landcoverHistory() ? (({ by_commune, ...x }) => x)(repo.landcoverHistory()) : null })); // eslint-disable-line camelcase
r.get('/forest/change', (req, res) => {
  const fc = repo.forestChange();
  if (!fc) return res.status(404).json({ error: 'Chưa có dữ liệu', code: 'NOT_FOUND' });
  const { annual_loss_by_commune, ...history } = fc.history; // eslint-disable-line camelcase, no-unused-vars
  return res.json({ ...fc, history, candidates: page(req, repo.changeCandidates().features.map((f) => ({ ...f.properties, geometry: f.geometry }))) });
});
r.get('/fire/hotspots', (req, res) => {
  res.json({
    type: 'FeatureCollection', meta: repo.firmsMeta(),
    features: repo.hotspots().map((h) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [h.lon, h.lat] },
      properties: { ...h, decision: undefined, verified: ['confirmed', 'rejected'].includes(h.status), verification_label: ['confirmed', 'rejected', 'closed', 'handling'].includes(h.status) ? h.statusLabel : 'Chưa xác minh' },
    })),
  });
});
r.get('/fire/alerts', (req, res) => {
  let list = alerts.feed({ limit: 500 });
  if (req.query.type) list = list.filter((a) => a.type === req.query.type);
  if (req.query.level) list = list.filter((a) => (a.level || 0) >= Number(req.query.level));
  if (req.query.commune) list = list.filter((a) => a.communeCode === req.query.commune);
  res.json(page(req, list.map((a) => ({ ...a, verification_label: a.type === 'hotspot' && !a.official && !['rejected', 'closed', 'handling'].includes(a.status) ? 'Chưa xác minh' : a.statusLabel }))));
});
r.get('/fire/danger', (req, res) => {
  const fd = repo.fireDanger();
  if (!fd) return res.status(404).json({ error: 'Chưa có dữ liệu', code: 'NOT_FOUND' });
  const { communes, ...rest } = fd;
  res.json({ ...rest, communes: req.query.code ? communes.filter((c) => c.code === req.query.code) : communes.map(({ recent, ...c }) => c) }); // eslint-disable-line no-unused-vars
});
r.get('/fire/history', (req, res) => res.json({ hotspots: repo.firmsHistory(), burned: (({ points, ...b }) => b)(repo.burnedHistory() || { points: [] }) })); // eslint-disable-line no-unused-vars
r.get('/imagery/products', (req, res) => {
  const ov = repo.overlays().filter((o) => /^s2-|^ndvi-/.test(o.id)).map((o) => ({ id: o.id, title: o.title, source: o.source, meaning: o.meaning, image: { url: o.url, coordinates: o.coordinates }, tiles: o.tiles || null, legend: o.legend || [] }));
  res.json({ products: ov, monthly: repo.ndviSeries(req.query.code || null), satellite: 'Sentinel-2 SR Harmonized (Copernicus) – tổ hợp median tháng, 100 m; xử lý bằng Python trên máy chủ' });
});
r.get('/weather', (req, res) => res.json(repo.weatherSnapshot()));
r.get('/weather/:code', (req, res) => res.json({ forecast: repo.dailyForecast(req.params.code), danger: (repo.fireDanger() || { communes: [] }).communes.filter((c) => c.code === req.params.code).map(({ recent, ...c }) => c)[0] || null })); // eslint-disable-line no-unused-vars
r.get('/climate', (req, res) => res.json(repo.climateMonthly()));

function newsCard(a) { return { id: a.id, slug: a.slug, title: a.title, category: a.category, category_label: (content.CATEGORIES[a.category] || {}).label || a.category, summary: a.summary, image: a.image, published_at: a.published_at || a.created_at, status: a.status, views: a.views || 0 }; }
r.get('/news', (req, res) => res.json(page(req, content.list({ category: req.query.category, q: req.query.q }).map(newsCard))));
r.get('/news/:slug', (req, res) => {
  const a = content.bySlug(req.params.slug);
  if (!a || !content.visible(a)) return res.status(404).json({ error: 'Không tìm thấy tin', code: 'NOT_FOUND' });
  const related = content.list({ category: a.category }).filter((x) => x.id !== a.id).slice(0, 4).map(newsCard);
  return res.json({ ...newsCard(a), body: a.body, source_url: a.source_url, author: a.author, web_url: `/tin-tuc/${a.slug}`, related });
});
r.get('/documents', wrap(async (req, res) => {
  const maps = await require('../services/maps').publishedDocuments().catch(() => []);
  const list = [
    ...repo.documents().map((d) => ({ id: d.id, title: d.title, category: d.category, category_label: d.categoryLabel, issuer: d.issuer, number: d.number, issued: d.issued, type: d.type || 'pdf', bytes: d.bytes, sha256: d.sha256, url: d.url, version: d.version || 1 })),
    ...maps.map((m) => ({ id: `map-${m.id}`, title: m.title, category: 'ban-do-chuyen-de', category_label: 'Bản đồ chuyên đề', issuer: m.source_org, issued: m.map_year ? String(m.map_year) : null, type: m.format, bytes: m.size_bytes, sha256: m.sha256, url: `/ban-do-chuyen-de/tep/${m.file_id}`, preview: m.preview_url, version: m.current_version, georeferenced: m.georeferenced })),
  ];
  const q = String(req.query.q || '').toLowerCase();
  res.json(page(req, list.filter((d) => (!req.query.category || d.category === req.query.category) && (!q || d.title.toLowerCase().includes(q)))));
}));

// ---------- reports (M11) ----------
r.post('/uploads/presign', optionalAuth, rateLimit('m-upload', 60, 3600e3), wrap(async (req, res) => res.json(field.presign(req.auth, req.body || {}))));
r.put('/uploads/:token', express.raw({ type: () => true, limit: '62mb' }), wrap(async (req, res) => res.status(201).json(await field.receiveUpload(req.params.token, req.body, req.query))));
r.get('/files/:key', optionalAuth, wrap(async (req, res) => {
  const f = await field.attachmentFor(req.params.key, req.auth);
  if (!f) return res.status(404).json({ error: 'Không tìm thấy tệp hoặc không có quyền xem.', code: 'NOT_FOUND' });
  res.set('Cache-Control', 'private, max-age=3600');
  return res.sendFile(path.resolve(f));
}));
r.post('/reports', optionalAuth, rateLimit('m-report', 10, 3600e3), wrap(async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.status(400).json({ error: 'Từ chối', code: 'SPAM' }); // honeypot
  const out = await field.createReport(req.auth, b, /^[0-9a-f-]{36}$/i.test(String(b.client_uuid || '')) ? b.client_uuid : null);
  return res.status(out.duplicate ? 200 : 201).json({ duplicate: out.duplicate, report: field.ownView(out.report) });
}));
r.get('/reports/mine', requireAuth('reports.own'), (req, res) => res.json(page(req, field.myReports(req.auth))));
r.get('/reports/public', (req, res) => res.json(page(req, reports.listPublic({ type: req.query.type, status: req.query.status }))));
r.get('/reports/:code', optionalAuth, (req, res) => {
  const rep = reports.byCode(req.params.code);
  if (!rep) return res.status(404).json({ error: 'Không tìm thấy mã hồ sơ.', code: 'NOT_FOUND' });
  const own = req.auth && (rep.created_by === req.auth.sub || ['specialist', 'leader', 'admin'].includes(req.auth.role));
  return res.json(own ? field.ownView(rep) : reports.publicView(rep));
});

// ---------- field work (M15, M16) ----------
r.get('/assignments', requireAuth(), wrap(async (req, res) => {
  const list = await field.listAssignments(req.auth, req.query);
  if (req.query.format === 'geojson') return res.json({ type: 'FeatureCollection', features: list.filter((a) => a.lon !== null).map((a) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [a.lon, a.lat] }, properties: { id: a.id, code: a.code, title: a.title, status: a.status, statusLabel: a.statusLabel, kind: a.kind } })) });
  return res.json(page(req, list));
}));
r.post('/assignments', requireAuth('tasks.assign'), wrap(async (req, res) => res.status(201).json(await field.createAssignment({ id: req.auth.sub, username: store.get('users', req.auth.sub).username, role: req.auth.role }, req.body || {}))));
r.get('/assignments/:id', requireAuth(), wrap(async (req, res) => res.json(await field.openAssignment(req.auth, req.params.id))));
r.post('/assignments/:id/:action(accept|start)', requireAuth('field.survey'), wrap(async (req, res) => res.json(await field.changeAssignment(req.auth, req.params.id, req.params.action, (req.body || {}).base_version))));
r.get('/surveys', requireAuth(), wrap(async (req, res) => res.json(page(req, await field.listSurveys(req.auth, req.query)))));
r.post('/surveys', requireAuth('field.survey'), wrap(async (req, res) => {
  const b = req.body || {};
  const out = await field.createSurvey(req.auth, b, /^[0-9a-f-]{36}$/i.test(String(b.client_uuid || '')) ? b.client_uuid : null);
  return res.status(out.duplicate ? 200 : 201).json(out);
}));
r.get('/surveys/:id', requireAuth(), wrap(async (req, res) => {
  const s = await field.getSurvey(req.params.id);
  if (!s || (req.auth.role === 'specialist' && s.surveyor_id !== req.auth.sub && !can({ role: req.auth.role }, 'field.review'))) return res.status(404).json({ error: 'Không tìm thấy khảo sát.', code: 'NOT_FOUND' });
  return res.json(s);
}));
r.patch('/surveys/:id', requireAuth('field.survey'), wrap(async (req, res) => res.json(await field.updateSurvey(req.auth, req.params.id, req.body || {}, (req.body || {}).base_version))));
r.post('/surveys/:id/review', requireAuth('field.review'), wrap(async (req, res) => res.json(await field.reviewSurvey({ id: req.auth.sub, username: store.get('users', req.auth.sub).username, role: req.auth.role }, req.params.id, (req.body || {}).decision, (req.body || {}).note))));
r.get('/verifications', requireAuth(), wrap(async (req, res) => res.json(page(req, await field.listVerifications(req.auth, req.query)))));
r.post('/verifications', requireAuth('field.verify'), wrap(async (req, res) => {
  const b = req.body || {};
  const out = await field.createVerification(req.auth, b, /^[0-9a-f-]{36}$/i.test(String(b.client_uuid || '')) ? b.client_uuid : null);
  return res.status(out.duplicate ? 200 : 201).json(out);
}));
r.get('/verifications/:id', requireAuth(), wrap(async (req, res) => res.json(await field.getVerification(req.params.id))));
r.post('/verifications/:id/review', requireAuth('field.review'), wrap(async (req, res) => res.json(await field.reviewVerification({ id: req.auth.sub, username: store.get('users', req.auth.sub).username, role: req.auth.role }, req.params.id, (req.body || {}).decision, (req.body || {}).note))));

// ---------- offline sync (M17) ----------
r.post('/sync/batch', requireAuth('mobile.sync'), wrap(async (req, res) => res.json({ results: await field.syncBatch(req.auth, (req.body || {}).device_id, (req.body || {}).items) })));
r.get('/sync/changes', requireAuth(), wrap(async (req, res) => res.json(await field.changes(req.auth, req.query.since))));
r.get('/sync/conflicts', requireAuth(), wrap(async (req, res) => res.json(await field.conflicts(req.auth))));
r.post('/sync/conflicts/:id/resolve', requireAuth(), wrap(async (req, res) => res.json(await field.resolveConflict(req.auth, req.params.id, (req.body || {}).action))));

// ---------- devices, notifications (M14) ----------
r.post('/devices', optionalAuth, wrap(async (req, res) => res.json(await field.registerDevice(req.auth, req.body || {}))));
r.get('/notifications', optionalAuth, wrap(async (req, res) => {
  const communes = req.query.communes ? String(req.query.communes).split(',') : null;
  const db = require('../db/pool');
  // PostgreSQL là nguồn thông báo; không có DB thì dựng tạm từ dữ liệu hiện có
  res.json(page(req, db.enabled ? await require('../services/notifier').feed(req.auth, communes) : await field.notifications(req.auth, communes)));
}));
r.post('/notifications/test', requireAuth(), rateLimit('m-notify-test', 10, 3600e3), wrap(async (req, res) => {
  // người dùng tự gửi thông báo thử tới các thiết bị của mình (kiểm tra Socket.IO + push nền tảng)
  const n = await require('../services/notifier').create({ source_ref: `test:${require('crypto').randomUUID()}`, kind: 'system', title: 'Thông báo thử', body: 'Nếu bạn thấy thông báo này, kênh nhận thông báo của thiết bị đang hoạt động.', data: { screen: 'notifications' }, target_user: req.auth.sub, expires_at: new Date(Date.now() + 3600e3).toISOString() });
  res.json({ ok: Boolean(n), id: n && n.id });
}));
r.post('/notifications/read', requireAuth(), wrap(async (req, res) => { await field.markRead(req.auth, (req.body || {}).ids); res.json({ ok: true }); }));

r.use((req, res) => res.status(404).json({ error: 'Không có endpoint này.', code: 'NOT_FOUND' }));
// eslint-disable-next-line no-unused-vars
r.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Dữ liệu gửi lên quá lớn.', code: 'TOO_LARGE' });
  console.error('[mobile]', err);
  return res.status(500).json({ error: 'Lỗi máy chủ, vui lòng thử lại.', code: 'SERVER_ERROR' });
});

module.exports = r;
