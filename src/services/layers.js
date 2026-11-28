// Lớp vector bổ sung (spatial.map_layers): chuyển đổi định dạng, kiểm tra hình học và vòng đời
// tải lên → vùng chờ (staging) → công bố. Dùng chung cho trang quản trị và API quản lý lớp (/api/v1/layers).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { paths, python } = require('../config');
const store = require('../data/store');

const GEOM_TYPES = ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'];
function validateGeoJSON(gj) {
  const errors = [];
  if (!gj || !['FeatureCollection', 'Feature'].includes(gj.type)) return { errors: ['Không phải GeoJSON FeatureCollection/Feature'] };
  const feats = gj.type === 'Feature' ? [gj] : gj.features || [];
  if (!feats.length) errors.push('Không có đối tượng');
  if (gj.crs && !/4326|CRS84/i.test(JSON.stringify(gj.crs))) errors.push('Hệ tọa độ phải là EPSG:4326 (WGS84)');
  const types = new Set(); let outside = 0; let bad = 0;
  const visit = (c, depth) => { if (typeof c[0] === 'number') { const [x, y] = c; if (!(x >= 102 && x <= 110 && y >= 8 && y <= 24)) outside += 1; return; } c.forEach((cc) => visit(cc, depth + 1)); };
  feats.forEach((f) => {
    if (!f.geometry || !Array.isArray(f.geometry.coordinates) || !GEOM_TYPES.includes(f.geometry.type)) { bad += 1; return; }
    types.add(f.geometry.type);
    try { visit(f.geometry.coordinates, 0); } catch { bad += 1; }
  });
  if (bad) errors.push(`${bad} đối tượng thiếu/hỏng hình học`);
  if (outside) errors.push(`${outside} tọa độ nằm ngoài phạm vi Việt Nam – kiểm tra hệ tọa độ (cần lon/lat WGS84)`);
  return { errors, count: feats.length, types: [...types], fc: gj.type === 'Feature' ? { type: 'FeatureCollection', features: [gj] } : gj };
}

// Nhập lớp từ GeoJSON, Shapefile (.zip), MapInfo (.zip chứa .TAB hoặc .MIF/.MID), KML/KMZ, Excel (.xlsx) hoặc CSV có cột toạ độ – chuyển về GeoJSON WGS84 bằng scripts/convert_layer.py
const LAYER_EXT = /\.(geojson|json|zip|xlsx|csv|kml|kmz)$/i; // .zip: Shapefile hoặc MapInfo (.TAB / .MIF)
function convertLayer(buf, name, crs, textMode) {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'kt-layer-'));
  try {
    const inp = path.join(tmp, `in${path.extname(name).toLowerCase()}`); const out = path.join(tmp, 'out.geojson');
    fs.writeFileSync(inp, buf);
    const r = require('child_process').spawnSync(python, [path.join(paths.scripts, 'convert_layer.py'), inp, out, crs || 'auto', ['auto', 'tcvn3', 'none'].includes(textMode) ? textMode : 'auto'], { encoding: 'utf8', timeout: 600000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, windowsHide: true });
    let info = null; try { info = JSON.parse(String(r.stdout || '').trim().split('\n').pop()); } catch { info = null; }
    if (!info) throw new Error(`Không đọc được tệp (${String(r.stderr || '').split('\n').filter(Boolean).pop() || 'lỗi chuyển đổi'})`);
    if (!info.ok) throw new Error(info.error);
    return { gj: JSON.parse(fs.readFileSync(out, 'utf8')), info };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// Lớp có nhiều đối tượng (bản đồ kiểm kê, hiện trạng rừng theo lô…): đối tượng chỉ nằm trong PostGIS (hình học + mọi thuộc tính),
// hiển thị bằng ô vector (MVT) sinh từ CSDL, không nạp cả lớp vào bộ nhớ máy chủ hay trình duyệt.
const BIG = 2000;
const db = require('../db/pool');
// thống kê trường thuộc tính: kiểu, số giá trị khác nhau, các giá trị phổ biến (để tô màu theo trường, tra cứu)
function fieldStats(feats) {
  const st = {};
  for (const f of feats) {
    for (const [k, v] of Object.entries(f.properties || {})) {
      const x = st[k] || (st[k] = { name: k, numeric: true, filled: 0, values: new Map(), over: false });
      if (v === null || v === undefined || v === '') continue;
      x.filled += 1;
      if (typeof v !== 'number') x.numeric = false;
      if (!x.over) { const key = String(v).slice(0, 80); x.values.set(key, (x.values.get(key) || 0) + 1); if (x.values.size > 300) { x.over = true; x.values.clear(); } }
    }
  }
  return Object.values(st).slice(0, 80).map((x) => ({ name: x.name, type: x.numeric && x.filled ? 'number' : 'text', filled: x.filled, distinct: x.over ? null : x.values.size,
    top: x.over ? [] : [...x.values.entries()].sort((p, q) => q[1] - p[1]).slice(0, 20).map(([value, count]) => ({ value, count })) }));
}
const PALETTE = ['#1b7837', '#e08214', '#2166ac', '#c51b7d', '#7fbc41', '#b2182b', '#35978f', '#8073ac', '#fdb863', '#4d4d4d', '#d6604d', '#66c2a5', '#a6761d', '#e7298a', '#1f78b4', '#b2df8a', '#fb9a99', '#cab2d6', '#ffd92f', '#8dd3c7'];
function bboxOf(feats) {
  let w = 180; let s = 90; let e = -180; let n = -90;
  const visit = (c) => { if (typeof c[0] === 'number') { if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0]; if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1]; } else c.forEach(visit); };
  feats.forEach((f) => f.geometry && f.geometry.coordinates && visit(f.geometry.coordinates));
  return w <= e ? [w, s, e, n].map((x) => Number(x.toFixed(6))) : null;
}
async function writeFeatures(id, feats) {
  await db.query('DELETE FROM spatial.layer_features WHERE layer_id = $1', [id]);
  for (let i = 0; i < feats.length; i += 500) {
    const chunk = feats.slice(i, i + 500);
    await db.query(`INSERT INTO spatial.layer_features (layer_id, fid, geom, props)
      SELECT $1, (f->>'i')::int, ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(f->>'g'), 4326)), (f->'p') FROM jsonb_array_elements($2::jsonb) f`,
    [id, JSON.stringify(chunk.map((f, k) => ({ i: i + k, g: JSON.stringify(f.geometry), p: f.properties || {} })))]);
  }
}
// đọc đối tượng của lớp (lớp lớn: từ PostGIS; lớp nhỏ: từ bộ nhớ)
async function featureCollection(l, { bbox, limit } = {}) {
  if (!l.big) return l.geojson || { type: 'FeatureCollection', features: [] };
  const v = [l.id]; let where = '';
  if (bbox && bbox.length === 4 && bbox.every(Number.isFinite)) { v.push(...bbox); where = ' AND geom && ST_MakeEnvelope($2,$3,$4,$5,4326)'; }
  const r = await db.query(`SELECT ST_AsGeoJSON(geom, 7)::json AS g, props FROM spatial.layer_features WHERE layer_id = $1${where} ORDER BY fid${limit ? ` LIMIT ${Number(limit)}` : ''}`, v);
  return { type: 'FeatureCollection', features: r.rows.map((x) => ({ type: 'Feature', geometry: x.g, properties: x.props })) };
}
// ô vector (Mapbox Vector Tile) cho lớp lớn
async function tile(l, z, x, y) {
  const r = await db.query(`WITH b AS (SELECT ST_TileEnvelope($2, $3, $4) AS e)
    SELECT ST_AsMVT(q, 'f', 4096, 'g') AS mvt FROM (
      SELECT ST_AsMVTGeom(ST_Transform(t.geom, 3857), b.e, 4096, 64, true) AS g, t.fid, t.props
      FROM spatial.layer_features t, b WHERE t.layer_id = $1 AND t.geom && ST_Transform(b.e, 4326)) q WHERE q.g IS NOT NULL`, [l.id, z, x, y]);
  return r.rows[0] ? r.rows[0].mvt : null;
}

async function create(user, { title, source, description, color, gj, info, originalName, data_year: dataYear, series }) {
  const v = validateGeoJSON(gj);
  if (info && info.warnings && info.warnings.length) v.warnings = info.warnings;
  const feats = v.errors.length ? [] : v.fc.features;
  const big = db.enabled && feats.length > BIG;
  const row = store.insert('layers', {
    title: String(title || originalName || 'Lớp không tên').slice(0, 160), source: String(source || '').slice(0, 200), description: String(description || '').slice(0, 1000),
    style: { color: /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#00bcd4' }, original_name: originalName || null,
    status: v.errors.length ? 'invalid' : 'staging',
    validation: { errors: v.errors, count: v.count, types: v.types, warnings: v.warnings || [], source_format: info ? info.format : '.geojson', source_crs: info ? info.source_crs : 'EPSG:4326', source_crs_label: info ? (info.source_crs_label || info.source_crs) : 'WGS84',
      fields: fieldStats(feats), bbox: bboxOf(feats) },
    big: big || undefined, feature_count: feats.length,
    data_year: /^(19|20)\d{2}$/.test(String(dataYear || '')) ? Number(dataYear) : null, series: String(series || '').trim().slice(0, 120) || null,
    geojson: v.errors.length || big ? null : v.fc, uploaded_by: user.username,
  });
  if (big) { await store.drain(); await writeFeatures(row.id, feats); }
  store.audit(user, 'layer.upload', row.title, { count: v.count, types: v.types, errors: v.errors, source_format: row.validation.source_format, source_crs: row.validation.source_crs, fields: row.validation.fields.length, big: Boolean(big) });
  return { row, v };
}
// tô màu theo một trường thuộc tính (vd loại đất loại rừng, chủ rừng): gán màu cho các giá trị phổ biến nhất
function setColorField(user, id, field) {
  const l = store.get('layers', id); if (!l) return null;
  const fs = ((l.validation || {}).fields || []).find((f) => f.name === field);
  const style = { ...(l.style || {}) };
  if (!field || !fs || !fs.top.length) { delete style.field; delete style.values; }
  else { style.field = field; style.values = fs.top.slice(0, PALETTE.length).map((t, i) => ({ value: t.value, color: PALETTE[i], count: t.count })); }
  const row = store.update('layers', id, { style });
  store.audit(user, 'layer.style', row.title, { field: style.field || null });
  return row;
}
function update(user, id, b) {
  const l = store.get('layers', id); if (!l) return null;
  const patch = {};
  if (b.title !== undefined) patch.title = String(b.title || l.title).slice(0, 160);
  if (b.source !== undefined) patch.source = String(b.source || '').slice(0, 200);
  if (b.description !== undefined) patch.description = String(b.description || '').slice(0, 1000);
  if (b.color !== undefined && /^#[0-9a-f]{6}$/i.test(b.color)) patch.style = { ...(l.style || {}), color: b.color };
  // năm dữ liệu và bộ dữ liệu (kỳ kiểm kê / theo dõi diễn biến rừng): để biết lớp lô rừng ứng với số liệu công bố năm nào
  if (b.data_year !== undefined) patch.data_year = /^(19|20)\d{2}$/.test(String(b.data_year)) ? Number(b.data_year) : null;
  if (b.series !== undefined) patch.series = String(b.series || '').trim().slice(0, 120) || null;
  const row = store.update('layers', id, patch);
  store.audit(user, 'layer.edit', row.title);
  return row;
}
function setStatus(user, id, status) {
  const l = store.get('layers', id); if (!l) return null;
  if (!['published', 'staging'].includes(status) || l.status === 'invalid') throw Object.assign(new Error('Trạng thái không hợp lệ hoặc lớp chưa qua kiểm tra'), { status: 400 });
  const row = store.update('layers', id, { status, reviewed_by: user.username });
  store.audit(user, `layer.${status}`, l.title);
  return row;
}
function remove(user, id) { const l = store.get('layers', id); if (!l) return false; store.remove('layers', id); store.audit(user, 'layer.delete', l.title); return true; }
const summary = (l) => ({ id: l.id, title: l.title, source: l.source, description: l.description, status: l.status, style: l.style, validation: l.validation, data_year: l.data_year || null, series: l.series || null, big: Boolean(l.big), feature_count: l.feature_count || (l.validation || {}).count, uploaded_by: l.uploaded_by, reviewed_by: l.reviewed_by || null, created_at: l.created_at, updated_at: l.updated_at });

// ---------- quản lý TỪNG ĐỐI TƯỢNG của lớp (lô rừng…): sửa thuộc tính, sửa ranh, thêm mới, xoá – có nhật ký biến động ----------
// Lớp được chỉnh từng đối tượng chuyển sang lưu hoàn toàn trong PostGIS (như lớp lớn) để mã đối tượng (fid) ổn định.
async function ensureDbLayer(l) {
  if (!db.enabled) throw Object.assign(new Error('Chức năng cần cơ sở dữ liệu PostGIS.'), { status: 400 });
  if (!l.big) { await store.drain(); store.update('layers', l.id, { big: true, geojson: null, feature_count: (l.validation || {}).count || 0 }); await store.drain(); }
  return store.get('layers', l.id);
}
const cleanProps = (p) => Object.fromEntries(Object.entries(p || {}).filter(([k]) => /^[^\s].{0,60}$/.test(k)).slice(0, 120).map(([k, v]) => [k, v === '' || v === undefined ? null : (typeof v === 'string' && /^-?\d+([.,]\d+)?$/.test(v.trim()) && v.trim().length < 16 ? Number(v.trim().replace(',', '.')) : (typeof v === 'string' ? v.slice(0, 2000) : v))]));
async function recount(l) { const r = await db.query('SELECT count(*)::int n FROM spatial.layer_features WHERE layer_id = $1', [l.id]); store.update('layers', l.id, { feature_count: r.rows[0].n, validation: { ...(l.validation || {}), count: r.rows[0].n } }); }
async function getFeature(l, fid) {
  const r = await db.query('SELECT fid, ST_AsGeoJSON(geom, 7)::json g, props, round((ST_Area(geom::geography) / 10000)::numeric, 2) area_ha FROM spatial.layer_features WHERE layer_id = $1 AND fid = $2', [l.id, Number(fid)]);
  return r.rows[0] ? { fid: r.rows[0].fid, geometry: r.rows[0].g, properties: r.rows[0].props, area_ha: Number(r.rows[0].area_ha) } : null;
}
async function featureAt(l, lon, lat) {
  const r = await db.query(`SELECT fid FROM spatial.layer_features WHERE layer_id = $1 AND ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, 15) ORDER BY ST_Area(geom) LIMIT 1`, [l.id, lon, lat]);
  return r.rows[0] ? getFeature(l, r.rows[0].fid) : null;
}
async function featureUpdate(user, id, fid, { props, geometry, reason }) {
  const l = await ensureDbLayer(store.get('layers', id)); const cur = await getFeature(l, fid);
  if (!cur) throw Object.assign(new Error('Không tìm thấy đối tượng.'), { status: 404 });
  const after = props ? cleanProps(props) : cur.properties;
  if (geometry) {
    if (!GEOM_TYPES.includes(geometry.type)) throw Object.assign(new Error('Hình học không hợp lệ.'), { status: 422 });
    await db.query(`WITH old AS (SELECT geom FROM spatial.layer_features WHERE layer_id = $1 AND fid = $2)
      INSERT INTO spatial.layer_feature_log (layer_id, fid, action, before, after, geom_before, reason, username) SELECT $1, $2, 'geometry', $3, $4, old.geom, $5, $6 FROM old`, [l.id, cur.fid, JSON.stringify(cur.properties), JSON.stringify(after), reason || null, user.username]);
    await db.query('UPDATE spatial.layer_features SET geom = ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)), props = $4 WHERE layer_id = $1 AND fid = $2', [l.id, cur.fid, JSON.stringify(geometry), JSON.stringify(after)]);
  } else {
    await db.query("INSERT INTO spatial.layer_feature_log (layer_id, fid, action, before, after, reason, username) VALUES ($1, $2, 'update', $3, $4, $5, $6)", [l.id, cur.fid, JSON.stringify(cur.properties), JSON.stringify(after), reason || null, user.username]);
    await db.query('UPDATE spatial.layer_features SET props = $3 WHERE layer_id = $1 AND fid = $2', [l.id, cur.fid, JSON.stringify(after)]);
  }
  store.update('layers', l.id, { edited_at: store.now() }); store.audit(user, 'layer.feature.update', l.title, { fid: cur.fid, reason });
  return getFeature(l, cur.fid);
}
async function featureAdd(user, id, { geometry, props, reason }) {
  const l = await ensureDbLayer(store.get('layers', id));
  if (!geometry || !GEOM_TYPES.includes(geometry.type)) throw Object.assign(new Error('Cần vẽ hình học của đối tượng mới.'), { status: 422 });
  const p = cleanProps(props);
  const r = await db.query(`INSERT INTO spatial.layer_features (layer_id, fid, geom, props) SELECT $1, COALESCE(max(fid), -1) + 1, ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)), $3 FROM spatial.layer_features WHERE layer_id = $1 RETURNING fid`, [l.id, JSON.stringify(geometry), JSON.stringify(p)]);
  await db.query("INSERT INTO spatial.layer_feature_log (layer_id, fid, action, after, reason, username) VALUES ($1, $2, 'add', $3, $4, $5)", [l.id, r.rows[0].fid, JSON.stringify(p), reason || null, user.username]);
  await recount(l); store.audit(user, 'layer.feature.add', l.title, { fid: r.rows[0].fid, reason });
  return getFeature(l, r.rows[0].fid);
}
async function featureDelete(user, id, fid, reason) {
  const l = await ensureDbLayer(store.get('layers', id)); const cur = await getFeature(l, fid);
  if (!cur) throw Object.assign(new Error('Không tìm thấy đối tượng.'), { status: 404 });
  await db.query(`INSERT INTO spatial.layer_feature_log (layer_id, fid, action, before, geom_before, reason, username) SELECT $1, $2, 'delete', props, geom, $3, $4 FROM spatial.layer_features WHERE layer_id = $1 AND fid = $2`, [l.id, cur.fid, reason || null, user.username]);
  await db.query('DELETE FROM spatial.layer_features WHERE layer_id = $1 AND fid = $2', [l.id, cur.fid]);
  await recount(l); store.audit(user, 'layer.feature.delete', l.title, { fid: cur.fid, reason });
}
// khôi phục đối tượng đã xoá từ nhật ký
async function featureRestore(user, id, logId) {
  const l = store.get('layers', id);
  const r = await db.query("SELECT * FROM spatial.layer_feature_log WHERE id = $1 AND layer_id = $2 AND action = 'delete' AND geom_before IS NOT NULL", [Number(logId), l.id]);
  if (!r.rows[0]) throw Object.assign(new Error('Không có bản ghi xoá để khôi phục.'), { status: 404 });
  const x = r.rows[0];
  await db.query('INSERT INTO spatial.layer_features (layer_id, fid, geom, props) VALUES ($1, $2, $3, $4) ON CONFLICT (layer_id, fid) DO NOTHING', [l.id, x.fid, x.geom_before, JSON.stringify(x.before || {})]);
  await db.query("INSERT INTO spatial.layer_feature_log (layer_id, fid, action, after, reason, username) VALUES ($1, $2, 'add', $3, $4, $5)", [l.id, x.fid, JSON.stringify(x.before || {}), `Khôi phục đối tượng đã xoá (nhật ký #${x.id})`, user.username]);
  await recount(l); store.audit(user, 'layer.feature.restore', l.title, { fid: x.fid });
}
async function featureLog(l, limit = 100) {
  if (!db.enabled) return [];
  const r = await db.query('SELECT id, fid, action, before, after, reason, username, created_at, (geom_before IS NOT NULL) has_geom FROM spatial.layer_feature_log WHERE layer_id = $1 ORDER BY created_at DESC LIMIT $2', [l.id, limit]);
  return r.rows;
}

// Đối chiếu lớp lô rừng với SỐ LIỆU CÔNG BỐ hằng năm (theo xã): cộng diện tích các lô theo xã (xã chứa điểm trong của lô),
// tách theo một trường phân loại (vd loại đất loại rừng); người dùng chọn các giá trị được tính là "có rừng" để so với
// diện tích có rừng công bố của năm tương ứng. Chênh lệch giúp biết bản đồ lô và số liệu công bố đã khớp chưa.
async function reconcile(l, { field, forest, areaField, year } = {}) {
  if (!db.enabled) throw Object.assign(new Error('Chức năng cần cơ sở dữ liệu PostGIS.'), { status: 400 });
  const repo = require('../data/repo');
  const r = await db.query(`SELECT ST_X(ST_PointOnSurface(geom)) lon, ST_Y(ST_PointOnSurface(geom)) lat, ST_Area(geom::geography) / 10000 ha, props FROM spatial.layer_features WHERE layer_id = $1 AND GeometryType(geom) IN ('POLYGON', 'MULTIPOLYGON')`, [l.id]);
  const forestSet = new Set([].concat(forest || []).map(String));
  const by = {}; const classes = {}; let outside = 0;
  for (const x of r.rows) {
    const c = repo.communeAt(Number(x.lon), Number(x.lat));
    if (!c) { outside += 1; continue; }
    const a = areaField && Number.isFinite(Number(x.props[areaField])) ? Number(x.props[areaField]) : Number(x.ha);
    const cls = field ? String(x.props[field] ?? '(trống)') : null;
    const o = by[c.code] || (by[c.code] = { code: c.code, name: c.fullName, plots: 0, area: 0, forest: 0 });
    o.plots += 1; o.area += a;
    if (cls !== null) { classes[cls] = (classes[cls] || 0) + a; if (forestSet.has(cls)) o.forest += a; }
  }
  const yr = year || l.data_year; const official = Object.fromEntries(repo.communes(yr).filter((c) => c.official).map((c) => [String(c.code), c.official]));
  const rows = Object.values(by).map((o) => { const of = official[String(o.code)]; const offForest = of ? (of.established_forest_ha || 0) + (of.immature_plantation_ha || 0) : null; const mapForest = forestSet.size ? o.forest : null;
    return { ...o, area: Math.round(o.area * 100) / 100, forest: mapForest === null ? null : Math.round(mapForest * 100) / 100, official_forest: offForest === null ? null : Math.round(offForest * 100) / 100, official_natural_area: of ? of.natural_area_ha : null,
      diff: mapForest === null || offForest === null ? null : Math.round((mapForest - offForest) * 100) / 100, diff_pct: mapForest === null || !offForest ? null : Math.round((mapForest - offForest) / offForest * 1000) / 10 }; })
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  return { year: repo.statYear(yr), rows, outside, total_plots: r.rowCount, classes: Object.entries(classes).map(([value, ha]) => ({ value, ha: Math.round(ha * 100) / 100 })).sort((a, b) => b.ha - a.ha).slice(0, 60),
    totals: { area: Math.round(rows.reduce((a, x) => a + x.area, 0) * 100) / 100, forest: forestSet.size ? Math.round(rows.reduce((a, x) => a + (x.forest || 0), 0) * 100) / 100 : null, official_forest: Math.round(rows.reduce((a, x) => a + (x.official_forest || 0), 0) * 100) / 100 } };
}

// ---------- SO SÁNH HAI KỲ dữ liệu lô rừng (kỳ cũ A ↔ kỳ mới B) khi nhập kết quả kiểm kê / theo dõi diễn biến rừng mới ----------
// Ghép lô theo KHOÁ (vd tiểu khu + khoảnh + lô) nếu chọn; không có khoá thì ghép theo vị trí (điểm trong của lô mới nằm trong lô cũ).
// Phân loại khác biệt: lô mới, lô không còn, đổi thuộc tính (các trường chọn), đổi diện tích vượt ngưỡng.
async function compare(a, b, { keys = [], fields = [], tolPct = 5, tolHa = 0.5 } = {}) {
  if (!db.enabled) throw Object.assign(new Error('Chức năng cần cơ sở dữ liệu PostGIS.'), { status: 400 });
  const load = (l) => db.query(`SELECT fid, props, ST_Area(geom::geography) / 10000 ha, ST_X(ST_PointOnSurface(geom)) lon, ST_Y(ST_PointOnSurface(geom)) lat FROM spatial.layer_features WHERE layer_id = $1`, [l.id]).then((r) => r.rows.map((x) => ({ ...x, ha: Number(x.ha) })));
  const [A, B] = await Promise.all([load(a), load(b)]);
  const norm = (v) => String(v ?? '').trim().toLowerCase();
  const keyOf = (x) => keys.map((k) => norm(x.props[k])).join('|');
  let pairs = []; let added = []; let removed = [];
  if (keys.length) {
    const ma = new Map(); A.forEach((x) => { const k = keyOf(x); if (!ma.has(k)) ma.set(k, x); });
    const used = new Set();
    for (const y of B) { const x = ma.get(keyOf(y)); if (x && !used.has(x.fid)) { used.add(x.fid); pairs.push([x, y]); } else added.push(y); }
    removed = A.filter((x) => !used.has(x.fid));
  } else {
    const r = await db.query(`SELECT b.fid bf, m.fid af FROM spatial.layer_features b LEFT JOIN LATERAL (SELECT a.fid FROM spatial.layer_features a WHERE a.layer_id = $1 AND ST_Intersects(a.geom, ST_PointOnSurface(b.geom)) LIMIT 1) m ON true WHERE b.layer_id = $2`, [a.id, b.id]);
    const fa = new Map(A.map((x) => [x.fid, x])); const fb = new Map(B.map((x) => [x.fid, x])); const used = new Set();
    for (const x of r.rows) { const y = fb.get(x.bf); const o = x.af === null ? null : fa.get(x.af); if (o && !used.has(o.fid)) { used.add(o.fid); pairs.push([o, y]); } else added.push(y); }
    removed = A.filter((x) => !used.has(x.fid));
  }
  const label = (x) => (keys.length ? keys.map((k) => `${k} ${x.props[k] ?? ''}`).join(' · ') : `fid ${x.fid}`);
  const rows = [];
  for (const y of added) rows.push({ type: 'added', label: label(y), b_fid: y.fid, a_fid: null, ha_a: null, ha_b: y.ha, detail: fields.map((f) => `${f}: ${y.props[f] ?? ''}`).join('; '), lon: y.lon, lat: y.lat });
  for (const x of removed) rows.push({ type: 'removed', label: label(x), a_fid: x.fid, b_fid: null, ha_a: x.ha, ha_b: null, detail: fields.map((f) => `${f}: ${x.props[f] ?? ''}`).join('; '), lon: x.lon, lat: x.lat });
  let same = 0;
  for (const [x, y] of pairs) {
    const ch = fields.filter((f) => norm(x.props[f]) !== norm(y.props[f])).map((f) => `${f}: ${x.props[f] ?? '∅'} → ${y.props[f] ?? '∅'}`);
    const d = y.ha - x.ha; const areaCh = Math.abs(d) > tolHa && Math.abs(d) > (x.ha * tolPct) / 100;
    if (!ch.length && !areaCh) { same += 1; continue; }
    rows.push({ type: ch.length && areaCh ? 'both' : ch.length ? 'attr' : 'area', label: label(y), a_fid: x.fid, b_fid: y.fid, ha_a: x.ha, ha_b: y.ha, detail: [...ch, areaCh ? `diện tích ${d > 0 ? '+' : ''}${d.toFixed(2)} ha` : ''].filter(Boolean).join('; '), lon: y.lon, lat: y.lat });
  }
  const cnt = (t) => rows.filter((r) => r.type === t).length; const area = (t, k) => Math.round(rows.filter((r) => r.type === t).reduce((s2, r) => s2 + (r[k] || 0), 0) * 100) / 100;
  rows.sort((p, q) => Math.abs((q.ha_b || 0) - (q.ha_a || 0)) - Math.abs((p.ha_b || 0) - (p.ha_a || 0)));
  return { a_count: A.length, b_count: B.length, a_area: Math.round(A.reduce((t, x) => t + x.ha, 0) * 100) / 100, b_area: Math.round(B.reduce((t, x) => t + x.ha, 0) * 100) / 100, same,
    summary: { added: [cnt('added'), area('added', 'ha_b')], removed: [cnt('removed'), area('removed', 'ha_a')], attr: [cnt('attr') + cnt('both'), null], area: [cnt('area') + cnt('both'), null] }, total: rows.length, rows: rows.map((r) => ({ ...r, ha_a: r.ha_a === null ? null : Math.round(r.ha_a * 100) / 100, ha_b: r.ha_b === null ? null : Math.round(r.ha_b * 100) / 100 })) };
}

module.exports = { validateGeoJSON, convertLayer, LAYER_EXT, BIG, create, update, setStatus, setColorField, remove, summary, featureCollection, tile, fieldStats, getFeature, featureAt, featureUpdate, featureAdd, featureDelete, featureRestore, featureLog, reconcile, compare };
