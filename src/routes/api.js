// Public read API (/api/public/...). Paginated where lists can grow; only published or public data.
const express = require('express');
const repo = require('../data/repo');
const store = require('../data/store');
const alerts = require('../services/alerts');
const content = require('../services/content');
const reports = require('../services/reports');
const fs = require('fs');
const path = require('path');
const { paths } = require('../config');

const r = express.Router();
const pub = express.Router();
r.use('/public', pub);

// dữ liệu nghiệp vụ (trạng thái xác minh, nguy cơ cháy…) đổi bất kỳ lúc nào: luôn kiểm tra lại với máy chủ (ETag → 304 khi không đổi)
pub.use((req, res, next) => { res.set('Cache-Control', 'no-cache'); next(); });

pub.get('/map/layers', (req, res) => {
  res.json({
    overlays: repo.overlays(),
    vector: [
      { id: 'province', title: 'Ranh giới Kon Tum (trước sáp nhập)', source: 'Government of Viet Nam / HDX qua geoBoundaries, năm 2020', url: '/api/public/boundaries/province' },
      { id: 'communes', title: 'Ranh giới xã/phường hiện hành (40 đơn vị)', source: 'vietnamese-provinces-database v5.2.0, cắt theo ranh Kon Tum cũ', url: '/api/public/boundaries/communes' },
      { id: 'hotspots', title: 'Điểm nóng FIRMS 7 ngày', source: repo.firmsMeta().source, url: '/api/public/fire/hotspots' },
      { id: 'candidates', title: 'Biến động rừng nghi vấn', source: 'Sentinel-2 chuỗi tháng 100 m', url: '/api/public/forest/candidates' },
      { id: 'weather', title: 'Thời tiết tại điểm đại diện xã', source: 'OpenWeather', url: '/api/public/weather' },
    ],
    custom: repo.customLayers(false).map((l) => ({ id: l.id, title: l.title, source: l.source, url: `/api/public/layers/custom/${l.id}`, style: l.style })),
  });
});

pub.get('/maps', async (req, res, next) => {
  try { res.json(await require('../services/maps').publishedLayers()); } catch (e) { next(e); }
});

pub.get('/boundaries/province', (req, res) => res.json(repo.province()));

pub.get('/boundaries/communes', (req, res) => {
  const fc = repo.communeFeatures();
  const by = Object.fromEntries(repo.communes(req.query.nam).map((c) => [c.code, c]));
  const hist = repo.firmsHistory();
  res.json({
    type: 'FeatureCollection',
    features: fc.features.map((f) => {
      const c = by[f.properties.code];
      const o = c.official || {};
      const fd = c.danger;
      const max7 = fd ? Math.max(...[fd.current, ...fd.forecast].filter(Boolean).map((d) => d.cls)) : null;
      return {
        type: 'Feature', geometry: f.geometry,
        properties: {
          code: c.code, name: c.name, fullName: c.fullName, areaKm2: c.areaKm2,
          forest_ha: o.established_forest_ha ?? null, natural_forest_ha: o.natural_forest_ha ?? null, plantation_ha: o.established_plantation_ha ?? null,
          cover: o.official_forest_cover_percent ?? null, special_ha: o.special_use_planning_ha ?? null, protection_ha: o.protection_planning_ha ?? null, production_ha: o.production_planning_ha ?? null,
          tree_share: c.landcover ? c.landcover.tree_cover_share : null, elev: c.landcover ? c.landcover.elevation_mean_m : null,
          loss_2024: c.loss ? c.loss.annual['2024'] : null, loss_5y: c.loss ? c.loss.last5 : null,
          risk_mean: c.risk ? c.risk.mean_probability : null, risk_high_ha: c.risk ? c.risk.high_risk_ha : null, risk_expected_ha: c.risk ? c.risk.expected_loss_ha : null,
          danger_cls: fd && fd.current ? fd.current.cls : null, danger_p: fd && fd.current ? fd.current.p : null, danger_fwi: fd && fd.current ? fd.current.fwi : null, danger_max7: max7,
          hotspots_hist: hist ? hist.byCommune[c.code] || 0 : null, hotspots_7d: hist ? hist.nrtByCommune[c.code] || 0 : null,
        },
      };
    }),
  });
});

pub.get('/forest/summary', (req, res) => res.json(repo.forestSummary()));
pub.get('/forest/communes', (req, res) => res.json(repo.communes().map((c) => ({ code: c.code, name: c.fullName, official: c.official, landcover: c.landcover, loss: c.loss, risk: c.risk }))));
pub.get('/forest/change', (req, res) => {
  const fc = repo.forestChange();
  if (!fc) return res.status(404).json({ error: 'Chưa có dữ liệu' });
  const { annual_loss_by_commune, ...history } = fc.history; // eslint-disable-line camelcase, no-unused-vars
  return res.json({ ...fc, history });
});
pub.get('/landcover/history', (req, res) => {
  const lc = repo.landcoverHistory();
  if (!lc) return res.status(404).json({ error: 'Chưa có dữ liệu' });
  return res.json(req.query.code ? { ...lc, by_commune: { [req.query.code]: lc.by_commune[req.query.code] } } : lc);
});
pub.get('/field-samples', (req, res) => res.json(repo.fieldSamples()));
pub.get('/forest/candidates', (req, res) => res.json(repo.changeCandidates()));

pub.get('/fire/hotspots', (req, res) => {
  const meta = repo.firmsMeta();
  res.json({
    type: 'FeatureCollection', meta,
    features: repo.hotspots().map((h) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [h.lon, h.lat] }, properties: repo.publicHotspot(h) })),
  });
});
// Lịch sử điểm nóng / điểm cháy (PostGIS): mọi điểm FIRMS từng tải + điểm nhập tay, kể cả đã rời bản đồ hiện hành.
// Lọc: from, to (YYYY-MM-DD, giờ VN), xa (mã xã), trang_thai, nguon (firms|tay), bbox; format=csv để tải về.
const HS_LABEL = { new: 'Mới phát hiện', assigned: 'Cần xác minh', verifying: 'Đang xác minh', confirmed: 'Xác nhận cháy', rejected: 'Không phải cháy rừng', handling: 'Đang xử lý', closed: 'Kết thúc' };
pub.get('/fire/hotspots/archive', async (req, res, next) => {
  const db = require('../db/pool');
  if (!db.enabled) return res.status(503).json({ error: 'Chưa kết nối cơ sở dữ liệu' });
  try {
    const where = []; const vals = [];
    const add = (sql, v) => { vals.push(v); where.push(sql.replace(/\?/g, `$${vals.length}`)); };
    const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
    if (day(req.query.from)) add("t >= (?::date - interval '7 hours')", day(req.query.from));
    if (day(req.query.to)) add("t < (?::date + interval '17 hours')", day(req.query.to));
    if (req.query.xa) add('commune_code = ?', String(req.query.xa));
    if (HS_LABEL[req.query.trang_thai]) add('status = ?', req.query.trang_thai);
    if (req.query.nguon === 'firms') where.push("sensor <> 'MANUAL'");
    if (req.query.nguon === 'tay') where.push("sensor = 'MANUAL'");
    if (req.query.bbox) {
      const b = String(req.query.bbox).split(',').map(Number);
      if (b.length === 4 && b.every(Number.isFinite)) { vals.push(...b); const n = vals.length; where.push(`geom && ST_MakeEnvelope($${n - 3}, $${n - 2}, $${n - 1}, $${n}, 4326)`); }
    }
    const csv = req.query.format === 'csv';
    const limit = Math.min(csv ? 20000 : 5000, Number(req.query.limit) || (csv ? 20000 : 2000));
    const r = await db.query(`WITH u AS (
        SELECT h.id, h.sensor, h.acq_utc AS t, h.confidence, h.frp, h.commune_code, h.in_forest, h.landcover, NULL::numeric AS area_ha, NULL::text AS source_kind, h.geom
          FROM fire.hotspots h
        UNION ALL
        SELECT 'man-' || m.code, 'MANUAL', m.observed_at, NULL, NULL, m.commune_code, NULL, NULL, m.area_ha, m.source_kind, m.geom
          FROM fire.manual_points m
      ), s AS (
        SELECT u.*, COALESCE(d.status, 'new') AS status, d.updated_at AS decided_at FROM u LEFT JOIN ops.decisions d ON d.kind = 'hotspot' AND d.ref_id = u.id
      )
      SELECT s.id, s.sensor, s.t AS utc, s.confidence, s.frp, s.commune_code, a.full_name AS commune, s.in_forest, s.landcover, s.area_ha, s.source_kind,
        s.status, s.decided_at, ST_X(s.geom) AS lon, ST_Y(s.geom) AS lat
      FROM s LEFT JOIN spatial.admin_units a ON a.code = s.commune_code AND a.clipped AND a.level = 'commune'
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.t DESC LIMIT ${limit}`, vals);
    const rows = r.rows.map((x) => ({ ...x, utc: new Date(x.utc).toISOString(), statusLabel: HS_LABEL[x.status] || x.status, frp: x.frp === null ? null : Number(x.frp), area_ha: x.area_ha === null ? null : Number(x.area_ha) }));
    if (csv) {
      const q = (v) => (v === null || v === undefined ? '' : /[",\n;]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
      const vn = (iso) => new Date(new Date(iso).getTime() + 7 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
      const head = ['Mã', 'Thời điểm (giờ VN)', 'Nguồn', 'Độ tin cậy', 'FRP (MW)', 'Diện tích ước tính (ha)', 'Vĩ độ', 'Kinh độ', 'Xã/phường', 'Lớp phủ', 'Trong rừng', 'Trạng thái'];
      const lines = rows.map((x) => [x.id, vn(x.utc), x.sensor === 'MANUAL' ? 'Nhập thủ công' : x.sensor, x.confidence, x.frp, x.area_ha, x.lat.toFixed(5), x.lon.toFixed(5), x.commune, x.landcover,
        x.in_forest === null ? '' : x.in_forest ? 'có' : 'không', x.statusLabel].map(q).join(','));
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="lich-su-diem-nong-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.send(`\ufeff${head.join(',')}\n${lines.join('\n')}\n`);
    }
    return res.json({ type: 'FeatureCollection', source: 'PostGIS fire.hotspots (NASA FIRMS NRT, tích luỹ) + fire.manual_points', total: rows.length, limit,
      features: rows.map(({ lon, lat, ...p }) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: p })) });
  } catch (e) { return next(e); }
});

pub.get('/fire/danger', (req, res) => {
  const fd = repo.fireDanger();
  if (!fd) return res.status(404).json({ error: 'Chưa có dữ liệu' });
  const { communes, ...rest } = fd;
  return res.json({ ...rest, communes: req.query.code ? communes.filter((c) => c.code === req.query.code) : communes.map(({ recent, ...c }) => c) }); // eslint-disable-line no-unused-vars
});

pub.get('/fire/history', (req, res) => res.json({ hotspots: repo.firmsHistory(), burned: (({ points, ...b }) => b)(repo.burnedHistory() || { points: [] }) })); // eslint-disable-line no-unused-vars
pub.get('/alerts', (req, res) => res.json(alerts.feed({ limit: Number(req.query.limit) || 20 })));

pub.get('/weather', (req, res) => {
  const list = repo.weatherSnapshot();
  res.json({ type: 'FeatureCollection', features: list.map((w) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [w.lon, w.lat] }, properties: { code: w.code, name: w.fullName, ...w.current } })) });
});
// mũi tên gió theo xã (dự báo hôm nay – Open-Meteo) hoặc theo ô lưới ERA5-Land ngày gần nhất (build_env_layers.py)
pub.get('/weather/wind', (req, res) => {
  const f = path.join(paths.web, req.query.nguon === 'era5' ? 'wind-era.geojson' : 'wind-today.geojson');
  if (!fs.existsSync(f)) return res.status(404).json({ error: 'Chưa có dữ liệu gió' });
  return res.type('application/json').send(fs.readFileSync(f));
});
pub.get('/weather/:code', (req, res) => res.json(repo.dailyForecast(req.params.code)));
pub.get('/climate', (req, res) => res.json(repo.climateMonthly()));
pub.get('/ndvi', (req, res) => res.json(repo.ndviSeries(req.query.code || null)));

pub.get('/reports', (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const all = reports.listPublic({ type: req.query.type, status: req.query.status });
  res.json({ total: all.length, page, items: all.slice((page - 1) * 50, page * 50) });
});

pub.get('/layers/custom/:id', (req, res) => {
  const l = store.get('layers', req.params.id);
  if (!l || l.status !== 'published') return res.status(404).json({ error: 'Không tìm thấy' });
  return res.json(l.geojson);
});

// ---------- công cụ không gian (OSM) ----------
const geotools = require('../services/geotools');
const { rateLimit } = require('../middleware/security');
const ll = (s) => String(s || '').split(',').map(Number);
// khoảng cách tới khu dân cư, đường và cơ sở ứng cứu gần nhất
pub.get('/tools/nearest', (req, res) => {
  try { return res.json(geotools.nearest(req.query.lon, req.query.lat)); } catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
});
// đường đi ngắn nhất: ?from=lon,lat&to=lon,lat
pub.get('/tools/route', rateLimit('route', 120, 60e3), (req, res) => {
  try {
    const from = ll(req.query.from); const to = ll(req.query.to);
    if (from.length !== 2 || to.length !== 2) return res.status(400).json({ error: 'Cần tham số from=lon,lat và to=lon,lat' });
    return res.json(geotools.route(from, to));
  } catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
});

// Tìm kiếm toàn hệ thống: không phân biệt dấu/hoa thường, nhiều từ (đủ mọi từ). Trả về trang chức năng, xã/phường,
// thôn/làng (OpenStreetMap), toạ độ "vĩ độ, kinh độ", mã phản ánh công khai, lớp bản đồ (kể cả bản đồ chuyên đề), tin tức, tài liệu.
const PAGES = [
  ['Bản đồ WebGIS', '/ban-do', 'ban do webgis lop gis'], ['Tài nguyên rừng', '/tai-nguyen-rung', 'tai nguyen rung hien trang lop phu lpr'],
  ['Biến động và dự báo mất rừng', '/bien-dong-rung', 'bien dong mat rung du bao sentinel ndvi'], ['Cảnh báo cháy rừng', '/canh-bao-chay', 'canh bao chay diem nong firms nguy co'],
  ['Thời tiết', '/thoi-tiet', 'thoi tiet du bao nhiet do mua gio'], ['Thống kê – báo cáo', '/thong-ke', 'thong ke bao cao excel'],
  ['Tài liệu – bản đồ PDF', '/tai-lieu', 'tai lieu van ban ban do pdf'], ['Gửi / tra cứu phản ánh', '/phan-anh', 'phan anh hien truong to giac bao chay'],
  ['So sánh ảnh vệ tinh', '/so-sanh-anh', 'so sanh anh ve tinh sentinel'], ['Tin tức', '/tin-tuc', 'tin tuc thong bao'],
  ['Hướng dẫn sử dụng', '/huong-dan/su-dung', 'huong dan su dung hoi dap'], ['Đăng ký tài khoản', '/dang-ky', 'dang ky tai khoan nguoi dan'],
  ['Giới thiệu – nguồn dữ liệu', '/gioi-thieu', 'gioi thieu nguon du lieu'],
];
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/\s+/g, ' ').trim();
pub.get('/search', async (req, res) => {
  const raw = String(req.query.q || '').trim().slice(0, 100);
  if (raw.length < 2) return res.json([]);
  const nq = norm(raw); const toks = nq.split(' ').filter(Boolean);
  const hit = (...texts) => { const t = norm(texts.join(' ')); return toks.every((k) => t.includes(k)); };
  const score = (title) => { const t = norm(title); return t === nq ? 0 : t.startsWith(nq) ? 1 : t.includes(nq) ? 2 : 3; };
  const out = [];
  const add = (type, list) => out.push(...list.sort((x, y) => score(x.title) - score(y.title)).map((x) => ({ type, ...x })));
  // toạ độ "14.35, 108.0" (vĩ độ, kinh độ – chấp nhận đảo thứ tự)
  const m = raw.match(/^\s*(-?\d{1,3}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/);
  if (m) {
    let [a, b] = [Number(m[1].replace(',', '.')), Number(m[2].replace(',', '.'))];
    if (a > 90) [a, b] = [b, a];
    if (a >= 6 && a <= 25 && b >= 100 && b <= 112) out.push({ type: 'Toạ độ', title: `${a.toFixed(5)}, ${b.toFixed(5)} (vĩ độ, kinh độ)`, url: `/ban-do#${b.toFixed(5)},${a.toFixed(5)},14`, center: [b, a], zoom: 14 });
  }
  // mã phản ánh công khai
  if (/^pa-\d{4}-\d+$/i.test(raw)) {
    const r0 = reports.byCode(raw);
    if (r0) out.push({ type: 'Phản ánh', title: `${r0.code} – tra cứu tiến độ xử lý`, url: `/phan-anh?ma=${r0.code}` });
  }
  add('Trang', PAGES.filter(([t, , k]) => hit(t, k)).map(([title, url]) => ({ title, url })));
  add('Xã/phường', repo.communes().filter((c) => hit(c.fullName, c.name)).map((c) => ({ title: c.fullName, url: `/ban-do?xa=${c.code}`, center: c.centroid, zoom: 11 })));
  try {
    const places = require('../services/geotools').places().filter((p0) => hit(p0.name)).slice(0, 8);
    add('Thôn/làng (OSM)', places.map((p0) => ({ title: `${p0.name} · ${p0.kindLabel}`, url: `/ban-do#${p0.c[0].toFixed(5)},${p0.c[1].toFixed(5)},13`, center: p0.c, zoom: 13 })));
  } catch { /* chưa có dữ liệu OSM */ }
  try {
    const items = (await require('../services/layerCatalog').full()).filter((i) => !i.hidden && i.kind !== 'choro');
    add('Lớp bản đồ', items.filter((i) => hit(i.title, i.full_title || '')).slice(0, 8).map((i) => ({ title: i.title, url: `/ban-do?lop=${encodeURIComponent(i.id)}` })));
  } catch { /* bỏ qua */ }
  add('Tin tức', content.list().filter((a0) => hit(a0.title, a0.summary || '', a0.categoryLabel || '')).slice(0, 6).map((a0) => ({ title: a0.title, url: `/tin-tuc/${a0.slug}` })));
  add('Tài liệu', repo.documents().filter((d) => hit(d.title, d.number || '', d.issuer || '')).slice(0, 6).map((d) => ({ title: d.title, url: `/tai-lieu?id=${d.id}` })));
  res.json(out.slice(0, 25));
});

module.exports = r;
