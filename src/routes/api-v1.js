// API quản lý lớp dữ liệu (REST, JSON) cho hệ thống/ứng dụng khác tích hợp với WebGIS.
// Xác thực: Bearer token lấy từ POST /api/mobile/auth/login bằng tài khoản cán bộ (quyền data.manage để ghi).
// Đọc: mọi tài khoản cán bộ; lớp đã công bố đọc công khai qua /api/public/layers/custom/:id.
// Mô tả đầy đủ: GET /api/v1 (JSON) và Quản trị › Hướng dẫn › API quản lý lớp.
const express = require('express');
const multer = require('multer');
const store = require('../data/store');
const repo = require('../data/repo');
const auth = require('../services/mobile-auth');
const layers = require('../services/layers');
const { can, STAFF_ROLES, rateLimit } = require('../middleware/security');

const r = express.Router();
r.use(rateLimit('api-v1', 600, 60e3));
r.use(express.json({ limit: '25mb', type: ['application/json', 'application/geo+json'] }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function readToken(req) {
  const h = req.get('authorization') || '';
  if (!h.startsWith('Bearer ')) return null;
  const p = auth.verifyAccess(h.slice(7));
  if (!p || !(await auth.sidActive(p.sid))) return false;
  const u = store.get('users', p.sub);
  if (!u || !u.active) return false;
  return { id: u.id, username: u.username, role: u.role, scope: u.scope || null };
}
const need = (perm) => wrap(async (req, res, next) => {
  const u = await readToken(req);
  if (!u) return res.status(401).json({ error: 'Cần Bearer token hợp lệ (POST /api/mobile/auth/login).', code: u === false ? 'TOKEN_EXPIRED' : 'UNAUTHENTICATED' });
  if (!STAFF_ROLES.includes(u.role) || (perm && !can(u, perm))) return res.status(403).json({ error: 'Tài khoản không có quyền.', code: 'FORBIDDEN' });
  req.user = u; return next();
});
const found = (req, res) => { const l = store.get('layers', req.params.id); if (!l) res.status(404).json({ error: 'Không tìm thấy lớp', code: 'NOT_FOUND' }); return l; };

const ENDPOINTS = [
  ['GET', '/api/v1/catalog', 'Danh mục MỌI lớp đang hiển thị (raster, bản đồ chuyên đề, vector, tô màu theo xã) kèm đường dẫn dữ liệu: ảnh + toạ độ góc, ô ảnh XYZ, GeoJSON, chú giải. Công khai, không cần token (có token cán bộ: thêm lớp đang ẩn). Lọc ?type=raster|vector, ?group=, ?q='],
  ['GET', '/api/v1/catalog/:id', 'Thông tin và đường dẫn dữ liệu của một lớp'],
  ['GET', '/api/v1/catalog/:id/data', 'Chuyển thẳng tới dữ liệu lớp (ảnh WebP hoặc GeoJSON)'],
  ['PATCH', '/api/v1/catalog/:id', 'Cấu hình hiển thị lớp {title?, group?, sort?, hidden?, default_on?, on_forest?} (data.manage)'],
  ['DELETE', '/api/v1/catalog/:id', 'Xoá lớp: vector bổ sung/bản đồ chuyên đề xoá dữ liệu; lớp hệ thống gỡ khỏi danh mục (data.manage)'],
  ['GET', '/api/v1/layers', 'Danh sách lớp: lớp vector bổ sung (mọi trạng thái) + lớp hệ thống, bản đồ chuyên đề (chỉ đọc). Lọc ?status=staging|published|invalid, ?q='],
  ['GET', '/api/v1/layers/:id', 'Thông tin một lớp vector bổ sung'],
  ['GET', '/api/v1/layers/:id/geojson', 'Dữ liệu GeoJSON (WGS84) của lớp'],
  ['POST', '/api/v1/layers', 'Tạo lớp: JSON {title, source?, description?, color?, geojson} hoặc multipart (file=.geojson/.zip Shapefile/.xlsx/.csv, title, crs?) → vào vùng chờ (staging)'],
  ['PATCH', '/api/v1/layers/:id', 'Sửa thông tin {title?, source?, description?, color?}'],
  ['PUT', '/api/v1/layers/:id/geojson', 'Thay dữ liệu (GeoJSON) – lớp quay về vùng chờ, cần duyệt lại'],
  ['POST', '/api/v1/layers/:id/publish', 'Công bố lớp lên Bản đồ WebGIS/MobileGIS'],
  ['POST', '/api/v1/layers/:id/unpublish', 'Gỡ công bố (về vùng chờ)'],
  ['DELETE', '/api/v1/layers/:id', 'Xoá lớp'],
];
// ---------- danh mục lớp chia sẻ (công khai: chỉ lớp đang hiển thị; cán bộ có token: thêm lớp ẩn) ----------
const VEC_URL = { province: '/api/public/boundaries/province', communes: '/api/public/boundaries/communes', hotspots: '/api/public/fire/hotspots', candidates: '/api/public/forest/candidates',
  samples: '/api/public/field-samples', reports: '/api/public/reports', weather: '/api/public/weather', 'wind-du-bao': '/api/public/weather/wind?nguon=du-bao', 'wind-era5': '/api/public/weather/wind?nguon=era5' };
async function catalogShared(req, includeHidden) {
  const catalog = require('../services/layerCatalog');
  const mapsSvc = require('../services/maps');
  const mapLayers = await mapsSvc.publishedLayers().catch(() => []);
  const byMap = Object.fromEntries(mapLayers.map((m) => [`m-${m.id}`, m]));
  const ov = Object.fromEntries(repo.overlays().map((o) => [o.id, o]));
  const base = (require('../config').publicBaseUrl || `${req.protocol}://${req.get('host')}`);
  const items = (await catalog.full({ mapLayers })).filter((i) => !i.deleted && (includeHidden || !i.hidden));
  return items.map((it) => {
    if (it.kind === 'map') {
      const m = byMap[it.id]; const t = m.display && m.display.tiles;
      return { ...catalog.share(it, base, { overlay: { url: m.overlay_url, coordinates: m.overlay_bounds, resolution: null, tiles: t ? { url: `/ban-do-chuyen-de/tiles/${m.id}/{z}/{x}/{y}.png`, minzoom: t.minzoom, maxzoom: t.maxzoom, bounds: t.bounds } : null }, download: m.format === 'geotiff' ? null : null }), year: m.map_year, map_id: m.id, hidden: it.hidden };
    }
    if (it.kind === 'overlay') return { ...catalog.share(it, base, { overlay: ov[it.id] || {} }), hidden: it.hidden };
    if (it.kind === 'custom') return { ...catalog.share(it, base, { geojson: `/api/public/layers/custom/${it.layer_id}` }), hidden: it.hidden };
    return { ...catalog.share(it, base, { geojson: VEC_URL[it.id] || null }), hidden: it.hidden };
  });
}
r.get('/catalog', wrap(async (req, res) => {
  const u = await readToken(req);
  const list = await catalogShared(req, Boolean(u && STAFF_ROLES.includes(u.role)));
  const q = String(req.query.q || '').toLowerCase();
  const out = list.filter((x) => (!req.query.type || x.type === req.query.type) && (!req.query.group || x.group === req.query.group) && (!q || `${x.title} ${x.group_title}`.toLowerCase().includes(q)));
  res.set('Access-Control-Allow-Origin', '*');
  res.json({ count: out.length, license: 'Dữ liệu ghi nguồn từng lớp (Copernicus, NASA, OpenStreetMap ODbL, dữ liệu dự án…); trích dẫn nguồn khi sử dụng.', layers: out });
}));
r.get('/catalog/:id', wrap(async (req, res) => {
  const u = await readToken(req);
  const it = (await catalogShared(req, Boolean(u && STAFF_ROLES.includes(u.role)))).find((x) => x.id === req.params.id);
  res.set('Access-Control-Allow-Origin', '*');
  return it ? res.json(it) : res.status(404).json({ error: 'Không có lớp này (hoặc lớp đang ẩn)' });
}));
// dữ liệu của lớp: chuyển tới ảnh (raster) hoặc GeoJSON (vector)
r.get('/catalog/:id/data', wrap(async (req, res) => {
  const it = (await catalogShared(req, false)).find((x) => x.id === req.params.id);
  if (!it) return res.status(404).json({ error: 'Không có lớp này (hoặc lớp đang ẩn)' });
  const url = it.type === 'raster' ? it.image && it.image.url : it.geojson;
  return url ? res.redirect(302, url) : res.status(404).json({ error: 'Lớp không có dữ liệu tải được' });
}));
// quản lý danh mục qua API (quyền data.manage)
r.patch('/catalog/:id', need('data.manage'), (req, res) => {
  const b = req.body || {};
  const row = require('../services/layerCatalog').save(req.user, req.params.id, { title: b.title, grp: b.group, sort: b.sort, hidden: b.hidden, default_on: b.default_on, on_forest: b.on_forest });
  res.json({ ok: true, id: row.id });
});
r.delete('/catalog/:id', need('data.manage'), wrap(async (req, res) => {
  try { res.json({ ok: true, ...(await require('../services/layerCatalog').remove(req.user, req.params.id)) }); } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
}));

r.get('/', (req, res) => res.json({
  name: 'WebGIS rừng Kon Tum – API quản lý lớp', version: '1.0',
  auth: 'Authorization: Bearer <access_token> – lấy bằng POST /api/mobile/auth/login {username, password} (tài khoản cán bộ; ghi cần quyền data.manage: Quản trị hệ thống, Cán bộ chuyên môn). Token hết hạn → POST /api/mobile/auth/refresh.',
  formats: 'GeoJSON (EPSG:4326 hoặc khai báo crs), Shapefile nén .zip (.shp/.shx/.dbf/.prj), Excel .xlsx / CSV có cột lon/lat hoặc x/y + tham số crs (EPSG:4326 | EPSG:32648 | VN2000-KT | VN2000-UTM48)',
  endpoints: ENDPOINTS.map(([method, path, description]) => ({ method, path, description })),
}));

r.get('/layers', need(), (req, res) => {
  let custom = store.all('layers').map(layers.summary);
  if (req.query.status) custom = custom.filter((l) => l.status === req.query.status);
  const q = String(req.query.q || '').toLowerCase();
  if (q) custom = custom.filter((l) => `${l.title} ${l.source} ${l.description}`.toLowerCase().includes(q));
  const system = repo.overlays().map((o) => ({ id: o.id, title: o.title, kind: 'raster', source: o.source, resolution: o.resolution || null, url: o.url, coordinates: o.coordinates, readonly: true }));
  res.json({ custom: custom.map((l) => ({ ...l, kind: 'vector', geojson_url: `/api/v1/layers/${l.id}/geojson`, public_url: l.status === 'published' ? `/api/public/layers/custom/${l.id}` : null })), system });
});
r.get('/layers/:id', need(), (req, res) => { const l = found(req, res); if (l) res.json(layers.summary(l)); });
r.get('/layers/:id/geojson', need(), (req, res) => { const l = found(req, res); if (!l) return; if (!l.geojson) return res.status(409).json({ error: 'Lớp không có dữ liệu hợp lệ', code: 'INVALID' }); return res.json(l.geojson); });

function fromRequest(req) {
  if (req.file) {
    if (!layers.LAYER_EXT.test(req.file.originalname)) throw Object.assign(new Error('Định dạng tệp không hỗ trợ'), { status: 400 });
    return { ...layers.convertLayer(req.file.buffer, req.file.originalname, req.body.crs), originalName: req.file.originalname };
  }
  const gj = req.body && (req.body.geojson || (req.body.type ? req.body : null));
  if (!gj) throw Object.assign(new Error('Thiếu geojson (hoặc tệp file)'), { status: 400 });
  if (req.body.crs && req.body.crs !== 'EPSG:4326') return { ...layers.convertLayer(Buffer.from(JSON.stringify(gj)), 'in.geojson', req.body.crs), originalName: 'api.geojson' };
  return { gj, info: null, originalName: 'api.geojson' };
}
r.post('/layers', need('data.manage'), upload.single('file'), wrap(async (req, res) => {
  try {
    const { gj, info, originalName } = fromRequest(req);
    const { row, v } = layers.create(req.user, { title: req.body.title, source: req.body.source, description: req.body.description, color: req.body.color, gj, info, originalName });
    res.status(v.errors.length ? 422 : 201).json({ ...layers.summary(row), errors: v.errors });
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
}));
r.patch('/layers/:id', need('data.manage'), (req, res) => { if (!found(req, res)) return; res.json(layers.summary(layers.update(req.user, req.params.id, req.body || {}))); });
r.put('/layers/:id/geojson', need('data.manage'), upload.single('file'), (req, res) => {
  const l = found(req, res); if (!l) return;
  try {
    const { gj, info } = fromRequest(req);
    const v = layers.validateGeoJSON(gj);
    const row = store.update('layers', l.id, { geojson: v.errors.length ? null : v.fc, status: v.errors.length ? 'invalid' : 'staging',
      validation: { errors: v.errors, count: v.count, types: v.types, warnings: (info && info.warnings) || [], source_format: info ? info.format : '.geojson', source_crs: info ? info.source_crs : 'EPSG:4326' } });
    store.audit(req.user, 'layer.replace_data', l.title, row.validation);
    res.status(v.errors.length ? 422 : 200).json({ ...layers.summary(row), errors: v.errors });
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
r.post('/layers/:id/publish', need('data.manage'), (req, res) => { if (!found(req, res)) return; try { res.json(layers.summary(layers.setStatus(req.user, req.params.id, 'published'))); } catch (e) { res.status(e.status || 400).json({ error: e.message }); } });
r.post('/layers/:id/unpublish', need('data.manage'), (req, res) => { if (!found(req, res)) return; try { res.json(layers.summary(layers.setStatus(req.user, req.params.id, 'staging'))); } catch (e) { res.status(e.status || 400).json({ error: e.message }); } });
r.delete('/layers/:id', need('data.manage'), (req, res) => { if (!found(req, res)) return; layers.remove(req.user, req.params.id); res.status(204).end(); });

r.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.type === 'entity.too.large' || err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Dữ liệu quá lớn (tối đa 25 MB)' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON không hợp lệ' });
  return res.status(500).json({ error: 'Lỗi máy chủ' });
});
r.use((req, res) => res.status(404).json({ error: 'Không có endpoint này – xem GET /api/v1' }));

module.exports = { router: r, ENDPOINTS };
