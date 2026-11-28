// Quản trị → công cụ dữ liệu: khoanh vùng trên bản đồ, xuất dữ liệu theo định dạng/hệ toạ độ, chuyển toạ độ.
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const store = require('../data/store');
const repo = require('../data/repo');
const config = require('../config');
const zones = require('../services/zones');
const geoio = require('../services/geoio');
const layersSvc = require('../services/layers');
const scopeLib = require('../lib/scope');
const { requirePerm, checkCsrf, can } = require('../middleware/security');

const r = express.Router();
const flash = (req, type, text) => { req.session.flash = { type, text }; };
const me = (req) => req.session.user;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
// chọn hệ toạ độ từ form (ktt = other → ktt_khac)
const crsOf = (q) => geoio.crsFrom({ ...q, ktt: q.ktt === 'other' ? q.ktt_khac : q.ktt, crs: q.he ? undefined : q.crs });
const editor = (req, res, next) => (can(me(req), 'data.manage') || can(me(req), 'tasks.assign') ? next() : res.status(403).render('admin/forbidden', { title: 'Không đủ quyền', perm: 'data.manage / tasks.assign' }));

// ---------- khoanh vùng ----------
r.get('/khoanh-vung', requirePerm('dashboard.view'), (req, res) => {
  const ov = Object.fromEntries(repo.overlays().map((o) => [o.id, o]));
  const pick = [['s2-latest', 'Sentinel-2 tháng mới nhất'], ['ndvi-latest', 'NDVI mới nhất'], ['change-latest', 'Biến động NDVI'], ['hansen-loss', 'Mất tán cây Hansen'], ['forest-loss-risk', 'Nguy cơ mất rừng']];
  const year = Object.keys(ov).filter((k) => /^dw-\d{4}$/.test(k)).sort().slice(-2, -1)[0];
  if (year) pick.push([year, `Lớp phủ ${year.slice(3)}`]);
  res.render('admin/zones', { title: 'Khoanh vùng trên bản đồ', section: 'zones', zones: zones.list({ communes: scopeLib.communesOf(me(req)) }), KINDS: zones.KINDS, STATUS: zones.STATUS,
    overlays: pick.filter(([id]) => ov[id]).map(([id, short]) => ({ ...ov[id], short })), specialists: store.all('users').filter((u) => u.role === 'specialist' && u.active),
    communeName: Object.fromEntries(repo.communes().map((c) => [c.code, c.fullName])) });
});
r.get('/khoanh-vung/data.geojson', requirePerm('dashboard.view'), (req, res) => res.set('Cache-Control', 'no-store').json(zones.collection(zones.list({ communes: scopeLib.communesOf(me(req)) }))));
r.post('/khoanh-vung', editor, checkCsrf, (req, res) => {
  try {
    const c = req.body && req.body.geometry ? zones.centroid(req.body.geometry) : null; const cm = c ? repo.communeAt(c[0], c[1]) : null;
    if (cm && !scopeLib.inScope(me(req).scope, cm.code)) return res.status(403).json({ error: `Vùng khoanh thuộc ${cm.fullName} – ngoài địa bàn bạn được phân quyền.` });
    const z = zones.create(me(req), req.body || {}); return res.json({ ok: true, id: z.id, code: z.code, area_ha: z.area_ha });
  }
  catch (e) { return res.status(e instanceof zones.InputError ? 422 : 500).json({ error: e.message }); }
});
r.post('/khoanh-vung/nhap', editor, upload.single('file'), checkCsrf, (req, res) => {
  try {
    if (!req.file) throw new Error('Chưa chọn tệp.');
    if (!/\.(kml|kmz|zip|geojson|json)$/i.test(req.file.originalname)) throw new Error('Chỉ nhận KML/KMZ, Shapefile .zip hoặc GeoJSON.');
    const { gj, info } = layersSvc.convertLayer(req.file.buffer, req.file.originalname, req.body.he ? crsOf(req.body) : 'auto');
    const feats = gj.features.filter((f) => f.geometry && /Polygon$/.test(f.geometry.type));
    if (!feats.length) throw new Error('Tệp không có đối tượng vùng (đa giác).');
    if (feats.length > 300) throw new Error(`Tệp có ${feats.length} vùng – tối đa 300 vùng mỗi lần nhập (nhiều hơn nên nhập thành lớp dữ liệu ở “Dữ liệu không gian”).`);
    let n = 0; const errs = [];
    feats.forEach((f, i) => {
      const p = f.properties || {};
      try { zones.create(me(req), { geometry: f.geometry, title: p.name || p.title || p.ten || p.Name || `${path.parse(req.file.originalname).name} #${i + 1}`, kind: req.body.kind, note: p.description || p.ghi_chu || '', source_image: `Nhập từ ${req.file.originalname}` }); n += 1; }
      catch (e) { errs.push(`#${i + 1}: ${e.message}`); }
    });
    flash(req, n ? 'ok' : 'error', `Đã nhập ${n}/${feats.length} vùng từ ${req.file.originalname} (hệ toạ độ nguồn: ${info.source_crs || 'WGS84'}).${errs.length ? ` Lỗi: ${errs.slice(0, 3).join('; ')}` : ''}`);
  } catch (e) { flash(req, 'error', e.message); }
  res.redirect('/quan-tri/khoanh-vung');
});
r.post('/khoanh-vung/:id/giao', requirePerm('tasks.assign'), checkCsrf, async (req, res) => {
  try { const a = await zones.assign(me(req), req.params.id, req.body); flash(req, 'ok', `Đã giao nhiệm vụ ${a.code} – cán bộ nhận trên MobileGIS.`); }
  catch (e) { flash(req, 'error', e.message); }
  res.redirect('/quan-tri/khoanh-vung');
});
r.post('/khoanh-vung/:id/xoa', editor, checkCsrf, (req, res) => { zones.remove(me(req), req.params.id); flash(req, 'ok', 'Đã xoá vùng khoanh.'); res.redirect('/quan-tri/khoanh-vung'); });
r.post('/khoanh-vung/:id', editor, checkCsrf, (req, res) => {
  try { zones.update(me(req), req.params.id, req.body); flash(req, 'ok', 'Đã cập nhật vùng khoanh.'); } catch (e) { flash(req, 'error', e.message); }
  res.redirect('/quan-tri/khoanh-vung');
});

// ---------- xuất dữ liệu vector theo định dạng + hệ toạ độ (?dinh_dang=shp|kml|geojson|xlsx|csv&he=wgs84|vn2000|utm48&ktt=&mui=) ----------
const pointFc = (rows, props) => ({ type: 'FeatureCollection', features: rows.filter((x) => Number.isFinite(Number(x.lon)) && Number.isFinite(Number(x.lat))).map((x) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [Number(x.lon), Number(x.lat)] }, properties: props(x) })) });
const SOURCES = {
  'khoanh-vung': (req) => { const zs = req.params.id ? zones.list().filter((z) => z.id === req.params.id) : zones.list(); return zs.length ? [zones.collection(zs), req.params.id ? zs[0].code : 'vung_khoanh'] : null; },
  'vung-phan-tich': (req) => { const runs = require('../services/changeRuns'); const run = runs.get(req.params.id); return run ? [runs.candidates(run), run.code] : null; },
  'bien-dong': () => [repo.changeCandidates({ staff: true }), 'bien_dong_nghi_van'],
  'diem-nong': () => [pointFc(repo.hotspots({ staff: true }), (h) => ({ id: h.id, thoi_gian: h.datetime || h.acq_datetime || h.time, ve_tinh: h.sensorLabel, do_tin_cay: h.confidence, frp: h.frp, xa: h.commune, trang_thai: h.statusLabel || h.status, nguon: h.manual ? 'Nhập thủ công' : 'NASA FIRMS' })), 'diem_nong'],
  'phan-anh': () => { const reports = require('../services/reports'); return [pointFc(store.all('reports'), (x) => ({ ma: x.code, loai: reports.TYPES[x.type] || x.type, trang_thai: (reports.STATUS[x.status] || [])[0] || x.status, mo_ta: x.description, xa: x.commune_name, thoi_gian: x.created_at, nguon: x.reporter && x.reporter.role && x.reporter.role !== 'citizen' ? 'Cán bộ' : 'Người dân' })), 'phan_anh']; },
  lop: (req) => {
    const l = store.get('layers', req.params.id);
    if (l) return layersSvc.featureCollection(l).then((fc) => [fc, l.title]);
    const known = { communes: ['web', 'communes.geojson', 'ranh_gioi_xa'], province: ['web', 'province.geojson', 'ranh_gioi_tinh'], samples: ['web', 'field-samples.geojson', 'mau_thuc_dia'] }[req.params.id];
    if (known) { const fc = readJson(path.join(config.paths.data, known[0], known[1])); return fc ? [fc, known[2]] : null; }
    return null;
  },
};
r.get('/xuat/:loai/:id?', requirePerm('dashboard.view'), async (req, res, next) => {
  const src = SOURCES[req.params.loai];
  if (!src) return next();
  try {
    const got = await src(req);
    if (!got) return next();
    const q = { ...req.query, ktt: req.query.ktt === 'other' ? req.query.ktt_khac : req.query.ktt };
    store.audit(me(req), 'data.export', `${req.params.loai}${req.params.id ? `/${req.params.id}` : ''}`, { format: q.dinh_dang || 'geojson', crs: geoio.crsFrom(q) });
    return await geoio.send({ query: q }, res, got[0], got[1]);
  } catch (e) { flash(req, 'error', `Không xuất được: ${e.message}`); return res.redirect(req.get('referer') || '/quan-tri'); }
});

// ---------- tìm và tải ảnh Sentinel-2 theo độ phân giải / độ phủ mây / xã ----------
const s2 = require('../services/s2export');
function s2Aoi(v) {
  const [t, id] = String(v || '').split(':');
  if (t === 'commune') { const c = repo.communes().find((x) => String(x.code) === id); if (!c) throw new s2.InputError('Không tìm thấy xã/phường.'); return [{ type: 'commune', code: c.code }, c.fullName]; }
  if (t === 'zone') { const z = store.get('zones', id); if (!z) throw new s2.InputError('Không tìm thấy vùng khoanh.'); return [{ type: 'geometry', geometry: z.geometry, name: `Vùng khoanh ${z.code}` }, `${z.code} – ${z.title}`]; }
  return [{ type: 'province' }, 'Toàn vùng Kon Tum (cũ)'];
}
const s2Cfg = (b) => { const [aoi, label] = s2Aoi(b.aoi); return [s2.config({ ...b, crs: crsOf({ he: b.he || 'utm48', ktt: b.ktt, ktt_khac: b.ktt_khac, mui: b.mui }) }, aoi), label]; };
r.get('/anh-ve-tinh/tai-sentinel', requirePerm('dashboard.view'), (req, res) => res.render('admin/s2-export', { title: 'Tìm và tải ảnh Sentinel-2', section: 'imagery', jobs: s2.list(), RES: s2.RES, PRODUCTS: s2.PRODUCTS, KEEP_DAYS: s2.KEEP_DAYS,
  communes: repo.communes().slice().sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi')), zones: zones.list().slice(0, 100) }));
r.post('/anh-ve-tinh/tai-sentinel/tim', requirePerm('dashboard.view'), async (req, res) => {
  try { const [cfg] = s2Cfg({ ...req.body, mode: 'median' }); res.json(await s2.search(cfg)); }
  catch (e) { res.status(e instanceof s2.InputError ? 422 : 500).json({ error: e.message }); }
});
r.post('/anh-ve-tinh/tai-sentinel', requirePerm('dashboard.view'), (req, res) => {
  try {
    const [cfg, label] = s2Cfg(req.body);
    if (s2.list().filter((j) => ['queued', 'running'].includes(j.status)).length >= 5) throw new s2.InputError('Đang có 5 yêu cầu chờ tải – đợi xong rồi tạo tiếp.');
    s2.create(me(req), cfg, label); store.audit(me(req), 'imagery.s2_export', label, { resolution: cfg.resolution, product: cfg.product, cloud: cfg.cloud, from: cfg.from, to: cfg.to, mode: cfg.mode });
    flash(req, 'ok', `Đã nhận yêu cầu tải ảnh ${cfg.resolution} m – ${label}. Trang tự cập nhật khi xong.`);
  } catch (e) { flash(req, 'error', e.message); }
  res.redirect('/quan-tri/anh-ve-tinh/tai-sentinel');
});
r.get('/anh-ve-tinh/tai-sentinel/:id/:kind(tep|xem)', requirePerm('dashboard.view'), (req, res, next) => {
  const f = s2.file(req.params.id, req.params.kind === 'xem' ? 'preview' : 'tif');
  if (!f) return next();
  if (req.params.kind === 'tep') { store.audit(me(req), 'imagery.s2_download', f.name); return res.download(f.path, f.name); }
  return res.set('Cache-Control', 'private, max-age=3600').sendFile(f.path);
});
r.post('/anh-ve-tinh/tai-sentinel/:id/xoa', requirePerm('dashboard.view'), checkCsrf, (req, res) => { s2.remove(req.params.id); res.redirect('/quan-tri/anh-ve-tinh/tai-sentinel'); });

// ---------- xuất báo cáo (mặc định hoặc theo mẫu Excel đơn vị tải lên) ----------
const reporting = require('../services/reporting');
r.get('/bao-cao', requirePerm('dashboard.view'), (req, res) => {
  const rep = require('../services/reports');
  res.render('admin/reporting', { title: 'Xuất báo cáo', section: 'reporting', DS: reporting.DATASETS, templates: reporting.templates(), tab: req.query.tab || 'xuat',
    communes: require('../lib/scope').filter(me(req), repo.communes().slice().sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi')), (c) => c.code), years: repo.statYears().map((y) => y.year).reverse(),
    RTYPES: rep.TYPES, RSTATUS: rep.STATUS, scopeLabel: require('../lib/scope').label(me(req), Object.fromEntries(repo.communes().map((c) => [c.code, c.fullName]))) });
});
r.get('/bao-cao/:key/xuat', requirePerm('dashboard.view'), async (req, res, next) => {
  try {
    if (!reporting.DATASETS[req.params.key]) return next();
    const rep = await reporting.build(req.params.key, reporting.filterFrom(req.query, me(req)));
    store.audit(me(req), 'report.export', req.params.key, { rows: rep.rows.length, template: req.query.mau || null, format: req.query.dang || 'xlsx' });
    if (req.query.dang === 'in') return res.render('admin/report-print', { title: rep.ds.title, rep, cols: rep.ds.fields.filter((f) => !['evidence', 'description', 'notes'].includes(f.key) || rep.rows.length <= 400) });
    const name = `${geoio.safeName(rep.ds.short)}_${new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)}`;
    let buf;
    if (req.query.mau) {
      const t = store.get('report_templates', req.query.mau);
      if (!t || t.report_key !== req.params.key) throw new reporting.InputError('Mẫu báo cáo không hợp lệ.');
      buf = await reporting.fillTemplate(t, rep);
    } else buf = await reporting.toXlsx(rep);
    return res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').set('Content-Disposition', `attachment; filename="${name}${req.query.mau ? '_theo_mau' : ''}.xlsx"`).set('Cache-Control', 'no-store').send(buf);
  } catch (e) { if (!(e instanceof reporting.InputError)) console.error('[report]', e); flash(req, 'error', `Không xuất được báo cáo: ${e.message}`); return res.redirect('/quan-tri/bao-cao'); }
});
r.post('/bao-cao/mau', requirePerm('data.manage'), upload.single('file'), checkCsrf, async (req, res) => {
  try {
    if (!req.file || !/\.xlsx$/i.test(req.file.originalname)) throw new reporting.InputError('Chọn tệp mẫu Excel (.xlsx).');
    const t = await reporting.saveTemplate(me(req), { key: req.body.key, title: req.body.title, buffer: req.file.buffer, originalName: req.file.originalname });
    flash(req, 'ok', `Đã nhận dạng mẫu: sheet “${t.mapping.sheet}”, dòng tiêu đề ${t.mapping.header_row}, khớp ${t.mapping.matched} cột. Kiểm tra lại bảng gán cột bên dưới rồi lưu.`);
    return res.redirect(`/quan-tri/bao-cao/mau/${t.id}`);
  } catch (e) { flash(req, 'error', e.message); return res.redirect('/quan-tri/bao-cao?tab=mau'); }
});
r.get('/bao-cao/mau/:id', requirePerm('dashboard.view'), (req, res, next) => {
  const t = store.get('report_templates', req.params.id);
  return t ? res.render('admin/report-template', { title: `Mẫu báo cáo: ${t.title}`, section: 'reporting', t, ds: reporting.DATASETS[t.report_key] }) : next();
});
r.get('/bao-cao/mau/:id/tep', requirePerm('dashboard.view'), (req, res, next) => { const t = store.get('report_templates', req.params.id); return t && fs.existsSync(reporting.templateFile(t)) ? res.download(reporting.templateFile(t), t.original_name || 'mau.xlsx') : next(); });
r.post('/bao-cao/mau/:id/xoa', requirePerm('data.manage'), checkCsrf, (req, res) => { reporting.removeTemplate(me(req), req.params.id); flash(req, 'ok', 'Đã xoá mẫu báo cáo.'); res.redirect('/quan-tri/bao-cao?tab=mau'); });
r.post('/bao-cao/mau/:id', requirePerm('data.manage'), checkCsrf, (req, res) => {
  try { reporting.updateMapping(me(req), req.params.id, req.body); flash(req, 'ok', 'Đã lưu cấu hình mẫu.'); } catch (e) { flash(req, 'error', e.message); }
  res.redirect(`/quan-tri/bao-cao/mau/${req.params.id}`);
});

// ---------- quản lý từng đối tượng của lớp vector (lô rừng…): sửa thuộc tính/ranh, thêm, xoá, nhật ký biến động ----------
const lyr = (req, res) => { const l = store.get('layers', req.params.id); if (!l || l.status === 'invalid') { res.status(404).render('admin/forbidden', { title: 'Không tìm thấy lớp', perm: 'lớp dữ liệu' }); return null; } return l; };
const jerr = (res, e) => res.status(e.status || 500).json({ error: e.message });
r.get('/du-lieu/vector/:id/doi-tuong', requirePerm('dashboard.view'), async (req, res, next) => {
  try {
    const l = lyr(req, res); if (!l) return undefined;
    // đối chiếu với số liệu công bố năm tương ứng (khi người dùng bấm "Đối chiếu")
    let rec = null; let recErr = null;
    if (req.query.doi_chieu) { try { rec = await layersSvc.reconcile(l, { field: req.query.truong || null, forest: req.query.co_rung, areaField: req.query.dt || null, year: req.query.nam || null }); } catch (e) { recErr = e.message; } }
    const sameSeries = l.series ? store.all('layers').filter((x) => x.series === l.series && x.id !== l.id).sort((a, b) => (b.data_year || 0) - (a.data_year || 0)) : [];
    return res.render('admin/layer-features', { title: `Đối tượng lớp: ${l.title}`, section: 'layers', l, log: await layersSvc.featureLog(l, 100), canEdit: can(me(req), 'data.manage'), dbOn: require('../db/pool').enabled,
      rec, recErr, q: req.query, years: repo.statYears().map((y) => y.year).reverse(), sameSeries });
  } catch (e) { return next(e); }
});
r.get('/du-lieu/vector/:id/doi-tuong/tim', requirePerm('dashboard.view'), async (req, res) => {
  try { const l = lyr(req, res); if (!l) return undefined; const f = req.query.fid !== undefined ? await layersSvc.getFeature(l, req.query.fid) : await layersSvc.featureAt(l, Number(req.query.lon), Number(req.query.lat)); return res.json({ feature: f }); } catch (e) { return jerr(res, e); }
});
r.get('/du-lieu/vector/:id/doi-tuong/du-lieu.geojson', requirePerm('dashboard.view'), async (req, res) => {
  try { const l = lyr(req, res); if (!l) return undefined; return res.set('Cache-Control', 'no-store').json(await layersSvc.featureCollection(l, { bbox: req.query.bbox ? String(req.query.bbox).split(',').map(Number) : null, limit: 5000 })); } catch (e) { return jerr(res, e); }
});
r.post('/du-lieu/vector/:id/doi-tuong', requirePerm('data.manage'), checkCsrf, async (req, res) => {
  try {
    const b = req.body || {}; const reason = String(b.reason || '').trim().slice(0, 500);
    if (!reason) return res.status(422).json({ error: 'Ghi lý do biến động (ví dụ: khai thác rừng trồng theo hồ sơ, trồng mới năm 2026, đổi chủ rừng…).' });
    if (b.action === 'delete') { await layersSvc.featureDelete(me(req), req.params.id, b.fid, reason); return res.json({ ok: true }); }
    if (b.action === 'restore') { await layersSvc.featureRestore(me(req), req.params.id, b.log_id); return res.json({ ok: true }); }
    const f = b.fid === undefined || b.fid === null || b.fid === '' ? await layersSvc.featureAdd(me(req), req.params.id, { geometry: b.geometry, props: b.props, reason }) : await layersSvc.featureUpdate(me(req), req.params.id, b.fid, { props: b.props, geometry: b.geometry || null, reason });
    return res.json({ ok: true, feature: f });
  } catch (e) { return jerr(res, e); }
});
r.post('/du-lieu/vector/:id/ky-du-lieu', requirePerm('data.manage'), checkCsrf, (req, res) => {
  layersSvc.update(me(req), req.params.id, { data_year: req.body.data_year, series: req.body.series });
  flash(req, 'ok', 'Đã lưu năm dữ liệu / bộ dữ liệu của lớp.'); res.redirect(`/quan-tri/du-lieu/vector/${req.params.id}/doi-tuong`);
});
// so sánh kỳ mới (lớp :id) với kỳ cũ (?voi=) → danh sách khác biệt; chuyển lô lệch thành vùng cần xác minh
const CMP_T = { added: 'Lô mới (kỳ cũ không có)', removed: 'Lô không còn (kỳ mới không có)', attr: 'Đổi thuộc tính', area: 'Đổi diện tích / ranh', both: 'Đổi thuộc tính và diện tích' };
const arr = (v) => [].concat(v || []).flatMap((x) => String(x).split(',')).map((x) => x.trim()).filter(Boolean);
async function runCompare(req, l) {
  const o = store.get('layers', req.query.voi || req.body.voi);
  if (!o || o.id === l.id) throw new Error('Chọn lớp kỳ trước để so sánh.');
  return [o, await layersSvc.compare(o, l, { keys: arr(req.query.khoa || req.body.khoa), fields: arr(req.query.truong || req.body.truong), tolPct: Number(req.query.nguong || req.body.nguong) || 5 })];
}
r.get('/du-lieu/vector/:id/so-sanh', requirePerm('dashboard.view'), async (req, res, next) => {
  try {
    const l = lyr(req, res); if (!l) return undefined;
    const others = store.all('layers').filter((x) => x.id !== l.id && x.status !== 'invalid').sort((a, b) => (Number(b.series === l.series && Boolean(l.series)) - Number(a.series === l.series && Boolean(l.series))) || ((b.data_year || 0) - (a.data_year || 0)));
    let cmp = null; let other = null; let err = null;
    if (req.query.voi) { try { [other, cmp] = await runCompare(req, l); } catch (e) { err = e.message; } }
    if (cmp && req.query.xuat) {
      const ExcelJS = require('exceljs'); const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Khac biet');
      ws.addRow([`So sánh: ${other.title} (kỳ trước) ↔ ${l.title} (kỳ mới)`]); ws.addRow(['Loại khác biệt', 'Lô', 'Diện tích kỳ trước (ha)', 'Diện tích kỳ mới (ha)', 'Chi tiết', 'Kinh độ', 'Vĩ độ']).font = { bold: true };
      cmp.rows.forEach((x) => ws.addRow([CMP_T[x.type], x.label, x.ha_a, x.ha_b, x.detail, x.lon, x.lat])); [30, 30, 20, 20, 70, 12, 12].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
      return res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').set('Content-Disposition', `attachment; filename="So_sanh_ky_${geoio.safeName(l.title)}.xlsx"`).send(Buffer.from(await wb.xlsx.writeBuffer()));
    }
    return res.render('admin/layer-compare', { title: `So sánh kỳ dữ liệu: ${l.title}`, section: 'layers', l, others, other, cmp, err, q: req.query, T: CMP_T, canEdit: can(me(req), 'data.manage') || can(me(req), 'tasks.assign'),
      fieldsOf: (x) => ((x.validation || {}).fields || []).map((f) => f.name) });
  } catch (e) { return next(e); }
});
// các lô lệch được chọn → vùng khoanh "cần kiểm tra hiện trạng" (giao kiểm tra hiện trường, báo chủ rừng ở trang Khoanh vùng)
r.post('/du-lieu/vector/:id/so-sanh/xac-minh', editor, checkCsrf, async (req, res) => {
  const l = store.get('layers', req.params.id); const o = store.get('layers', req.body.voi);
  const back = `/quan-tri/du-lieu/vector/${req.params.id}/so-sanh?voi=${encodeURIComponent(req.body.voi || '')}&khoa=${encodeURIComponent(req.body.khoa || '')}&truong=${encodeURIComponent(req.body.truong || '')}`;
  try {
    if (!l || !o) throw new Error('Không tìm thấy lớp.');
    const picks = [].concat(req.body.pick || []).slice(0, 100); let n = 0;
    for (const pk of picks) {
      const [side, fid, type, ...rest] = String(pk).split('|'); const label = rest.join('|');
      const f = await layersSvc.getFeature(side === 'a' ? o : l, fid);
      if (!f || !/Polygon$/.test(f.geometry.type)) continue;
      zones.create(me(req), { geometry: f.geometry, title: `Lệch kiểm kê – ${CMP_T[type] || type}: ${label}`.slice(0, 200), kind: 'check', note: `So sánh “${o.title}” (kỳ trước) ↔ “${l.title}” (kỳ mới). Cần xác minh hiện trường để kết luận số liệu kỳ nào đúng.`, source_image: `Đối chiếu kiểm kê ${o.data_year || ''} ↔ ${l.data_year || ''}` }); n += 1;
    }
    flash(req, n ? 'ok' : 'error', n ? `Đã tạo ${n} vùng cần xác minh – mở “Khoanh vùng trên bản đồ” để giao kiểm tra hiện trường hoặc báo chủ rừng.` : 'Chưa chọn lô nào (hoặc lô không phải dạng vùng).');
  } catch (e) { flash(req, 'error', e.message); }
  res.redirect(back);
});
r.get('/du-lieu/vector/:id/nhat-ky.xlsx', requirePerm('dashboard.view'), async (req, res, next) => {
  try {
    const l = lyr(req, res); if (!l) return undefined;
    const ExcelJS = require('exceljs'); const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Nhat ky bien dong');
    const A = { add: 'Thêm mới', update: 'Sửa thuộc tính', geometry: 'Sửa ranh', delete: 'Xoá' };
    ws.addRow(['Thời điểm', 'Mã đối tượng (fid)', 'Thao tác', 'Người thực hiện', 'Lý do', 'Trước', 'Sau']).font = { bold: true };
    (await layersSvc.featureLog(l, 5000)).forEach((x) => ws.addRow([new Date(x.created_at), x.fid, A[x.action], x.username, x.reason || '', x.before ? JSON.stringify(x.before) : '', x.after ? JSON.stringify(x.after) : '']));
    [20, 14, 16, 16, 40, 60, 60].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    return res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').set('Content-Disposition', `attachment; filename="Nhat_ky_bien_dong_${geoio.safeName(l.title)}.xlsx"`).send(Buffer.from(await wb.xlsx.writeBuffer()));
  } catch (e) { return next(e); }
});

// ---------- chủ rừng và thông báo gửi chủ rừng ----------
const owners = require('../services/owners');
const baseUrl = (req) => (config.publicBaseUrl || `${req.protocol}://${req.get('host')}`);
const communeNames = () => Object.fromEntries(repo.communes().map((c) => [String(c.code), c.fullName]));
r.get('/chu-rung', requirePerm('dashboard.view'), (req, res) => {
  res.render('admin/owners', { title: 'Chủ rừng và thông báo', section: 'owners', tab: req.query.tab || 'thong-bao', owners: owners.list(), notices: owners.notices({ communes: scopeLib.communesOf(me(req)) }), K: owners.KINDS, ST: owners.STATUS, OBJ: owners.OBJ,
    communes: repo.communes().slice().sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi')), names: communeNames(), users: Object.fromEntries(store.all('users').map((u) => [u.id, u.username])),
    layers: store.all('layers').filter((l) => l.status !== 'invalid' && ((l.validation || {}).fields || []).length), base: baseUrl(req), edit: req.query.sua ? store.get('forest_owners', req.query.sua) : null });
});
r.post('/chu-rung/luu', requirePerm('data.manage'), checkCsrf, (req, res) => {
  try { const o = owners.save(me(req), req.body.id || null, req.body); flash(req, 'ok', `Đã lưu chủ rừng “${o.name}”.`); } catch (e) { flash(req, 'error', e.message); }
  res.redirect('/quan-tri/chu-rung?tab=danh-ba');
});
r.post('/chu-rung/lop', requirePerm('data.manage'), checkCsrf, (req, res) => {
  try { owners.setOwnerField(me(req), req.body.layer, req.body.field); flash(req, 'ok', req.body.field ? 'Đã đặt lớp bản đồ chủ rừng – hệ thống sẽ tra chủ rừng theo vị trí từ lớp này.' : 'Đã bỏ dùng lớp này để tra chủ rừng.'); } catch (e) { flash(req, 'error', e.message); }
  res.redirect('/quan-tri/chu-rung?tab=lop');
});
r.post('/chu-rung/:id/xoa', requirePerm('data.manage'), checkCsrf, (req, res) => { owners.remove(me(req), req.params.id); flash(req, 'ok', 'Đã xoá chủ rừng khỏi danh bạ.'); res.redirect('/quan-tri/chu-rung?tab=danh-ba'); });
// form báo chủ rừng cho một đối tượng (điểm nóng, vùng nghi vấn, vùng khoanh)
r.get('/chu-rung/bao', requirePerm('dashboard.view'), async (req, res, next) => {
  try {
    const t = owners.target(req.query.kind, req.query.ref);
    if (!t) return next();
    res.render('admin/owner-notify', { title: 'Báo chủ rừng', section: 'owners', kind: req.query.kind, ref: req.query.ref, t, found: await owners.findFor(t), all: owners.list().filter((o) => o.active !== false), K: owners.KINDS, OBJ: owners.OBJ, ST: owners.STATUS,
      message: owners.defaultMessage(t), sent: owners.forRef(req.query.kind, req.query.ref), base: baseUrl(req), names: communeNames() });
  } catch (e) { next(e); }
});
const canNotify = (req, res, next) => (can(me(req), 'alerts.verify') || can(me(req), 'tasks.assign') ? next() : res.status(403).render('admin/forbidden', { title: 'Không đủ quyền', perm: 'báo chủ rừng' }));
r.post('/chu-rung/bao', canNotify, checkCsrf, async (req, res) => {
  const back = `/quan-tri/chu-rung/bao?kind=${encodeURIComponent(req.body.kind)}&ref=${encodeURIComponent(req.body.ref)}`;
  try {
    const tg = owners.target(req.body.kind, req.body.ref);
    if (tg && !scopeLib.inScope(me(req).scope, tg.commune)) throw new owners.InputError('Đối tượng nằm ngoài địa bàn bạn được phân quyền.');
    const ns = await owners.notify(me(req), req.body, baseUrl(req)); flash(req, 'ok', `Đã tạo ${ns.length} thông báo (${ns.map((n) => n.code).join(', ')}). Sao chép nội dung kèm liên kết bên dưới để gửi cho chủ rừng qua điện thoại/Zalo/email.`); }
  catch (e) { flash(req, 'error', e.message); }
  res.redirect(back);
});
r.post('/chu-rung/thong-bao/:id', canNotify, checkCsrf, (req, res) => {
  try { owners.staffUpdate(me(req), req.params.id, req.body); flash(req, 'ok', 'Đã cập nhật thông báo.'); } catch (e) { flash(req, 'error', e.message); }
  res.redirect(req.get('referer') || '/quan-tri/chu-rung');
});

// ---------- chuyển toạ độ điểm (VN-2000 ↔ WGS84) ----------
r.get('/cong-cu/toa-do', requirePerm('dashboard.view'), (req, res) => {
  try {
    const x = Number(String(req.query.x).replace(',', '.')); const y = Number(String(req.query.y).replace(',', '.'));
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Toạ độ không hợp lệ.');
    const vn = geoio.crsFrom({ he: 'vn2000', ktt: req.query.ktt === 'other' ? req.query.ktt_khac : req.query.ktt, mui: req.query.mui });
    const toVn = req.query.chieu !== 've-wgs84';
    res.json(geoio.convertPoints([[x, y]], toVn ? 'EPSG:4326' : vn, toVn ? vn : 'EPSG:4326'));
  } catch (e) { res.status(422).json({ ok: false, error: e.message }); }
});

module.exports = r;
