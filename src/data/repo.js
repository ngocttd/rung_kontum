// Read-side access to the prepared datasets in data/. Every value carries its source and date
// through the `meta` objects so pages can show provenance next to the numbers.
const path = require('path');
const fs = require('fs');
const { paths, ROOT } = require('../config');
const { readJson, readCsv, mtime } = require('./files');
const store = require('./store');
const { indexFeatures, centroid } = require('../lib/geo');

const P = (...p) => path.join(paths.data, ...p);

// ---------- boundaries ----------
function communeFeatures() { return readJson(P('web', 'communes.geojson')); }
function province() { return readJson(P('web', 'province.geojson')); }

let lookupCache = null;
function communeAt(lon, lat) {
  const fc = communeFeatures();
  if (!lookupCache || lookupCache.fc !== fc) lookupCache = { fc, fn: indexFeatures(fc, 'code') };
  const f = lookupCache.fn(lon, lat);
  return f ? f.properties : null;
}

// ---------- official forest statistics (QĐ 1047/QĐ-UBND, số liệu 31/12/2025) ----------
function officialStats() { return readJson(P('processed', 'forest-statistics-2025-kon-tum-communes.json')) || []; }
function landcover() { return readJson(P('web', 'commune-landcover-terrain.json')); }
function forestChange() { return readJson(P('web', 'forest-change.json')); }
// Dữ liệu thực tế dự án: lớp phủ 1991/2014/2023 và mẫu thực địa 2025 (data/Data_thuc_te)
function landcoverHistory() { return readJson(P('web', 'landcover-history.json')); }
function fieldSamples() { return readJson(P('web', 'field-samples.geojson')) || { type: 'FeatureCollection', features: [] }; }
function fireDanger() { return readJson(P('web', 'fire-danger.json')); }

function communes() {
  const fc = communeFeatures();
  const stats = Object.fromEntries(officialStats().map((s) => [s.commune_code, s]));
  const lc = landcover();
  const fcg = forestChange();
  const fd = fireDanger();
  const danger = fd ? Object.fromEntries(fd.communes.map((c) => [c.code, c])) : {};
  return fc.features.map((f) => {
    const p = f.properties;
    const s = stats[p.code] || null;
    const loss = fcg ? fcg.history.annual_loss_by_commune[p.code] : null;
    const lossTotal = loss ? Object.values(loss).reduce((a, b) => a + b, 0) : null;
    return {
      code: p.code, name: p.name, fullName: p.fullName, areaKm2: p.areaKm2, overlap: p.overlapFraction,
      centroid: centroid(f.geometry),
      official: s,
      landcover: lc ? lc.communes[p.code] : null,
      loss: loss ? { annual: loss, total: lossTotal, last5: ['2020', '2021', '2022', '2023', '2024'].reduce((a, y) => a + loss[y], 0), treecover2000: fcg.history.treecover2000_ha[p.code] } : null,
      risk: fcg ? fcg.forecast.risk_by_commune[p.code] : null,
      danger: danger[p.code] || null,
    };
  });
}

function communeByCode(code) { return communes().find((c) => c.code === code) || null; }

function sum(arr, f) { return arr.reduce((a, x) => a + (Number(f(x)) || 0), 0); }

function forestSummary() {
  const s = officialStats();
  const natural = sum(s, (x) => x.natural_area_ha);
  const forest = sum(s, (x) => x.established_forest_ha);
  return {
    communes: s.length,
    natural_area_ha: natural,
    established_forest_ha: forest,
    natural_forest_ha: sum(s, (x) => x.natural_forest_ha),
    plantation_ha: sum(s, (x) => x.established_plantation_ha),
    immature_plantation_ha: sum(s, (x) => x.immature_plantation_ha),
    special_use_ha: sum(s, (x) => x.special_use_planning_ha),
    protection_ha: sum(s, (x) => x.protection_planning_ha),
    production_ha: sum(s, (x) => x.production_planning_ha),
    planning_ha: sum(s, (x) => x.forest_planning_area_ha),
    cover_percent_computed: natural ? (forest / natural) * 100 : null,
    as_of: s[0] ? s[0].as_of : null,
    decision: s[0] ? s[0].decision : null,
    source_url: s[0] ? s[0].source_url : null,
    scope: 'Tổng 40 xã/phường hiện hành có phần lớn diện tích thuộc vùng Kon Tum cũ (toàn xã, chưa cắt theo ranh tỉnh cũ)',
  };
}

// ---------- hotspots (NASA FIRMS snapshot, 7 ngày) ----------
const SENSORS = { MODIS: 'MODIS (Terra/Aqua)', SUOMI_VIIRS: 'VIIRS S-NPP', J1_VIIRS: 'VIIRS NOAA-20', J2_VIIRS: 'VIIRS NOAA-21' };
// sensor 'MANUAL' = điểm cháy nhập thủ công (không có tệp FIRMS)
const HOTSPOT_STATUS = {
  new: 'Mới phát hiện', assigned: 'Cần xác minh', verifying: 'Đang xác minh', confirmed: 'Xác nhận cháy',
  rejected: 'Không phải cháy rừng', handling: 'Đang xử lý', closed: 'Kết thúc',
};

// Quy tắc hiển thị trên bản đồ hiện hành (chung cho FIRMS và điểm nhập tay); dữ liệu KHÔNG bị xoá:
//  - Mới phát hiện (chưa xác minh): 7 ngày kể từ lúc phát hiện;
//  - Cần xác minh / Đang xác minh / Xác nhận cháy / Đang xử lý: hiện cho đến khi đóng hồ sơ, dù đã quá 7 ngày;
//  - Kết thúc: hiện thêm 7 ngày kể từ lúc đóng;
//  - Không phải cháy rừng: ẩn ngay trên bản đồ công khai (cán bộ vẫn thấy 7 ngày trong danh sách xác minh).
// Quá hạn → chỉ còn trong lịch sử: PostGIS fire.hotspots (mọi điểm FIRMS từng tải), fire.manual_points, ops.decisions;
// tra cứu ở /canh-bao-chay?tab=lich-su (API /api/public/fire/hotspots/archive).
const RETENTION = { new_days: 7, closed_days: 7, rejected_staff_days: 7 };
const OPEN_STATUSES = new Set(['assigned', 'verifying', 'confirmed', 'handling']);
const DAY = 864e5;
const decidedAt = (d) => (d && d.history && d.history.length ? d.history[d.history.length - 1].at : d && d.updated_at) || null;
function onMap(status, utc, d, staff) {
  const age = (t) => Date.now() - new Date(t).getTime();
  if (OPEN_STATUSES.has(status)) return true;
  if (status === 'closed') return age(decidedAt(d) || utc) <= RETENTION.closed_days * DAY;
  if (status === 'rejected') return staff && age(decidedAt(d) || utc) <= RETENTION.rejected_staff_days * DAY;
  return age(utc) <= RETENTION.new_days * DAY; // new
}
const SNAP_KEYS = ['lon', 'lat', 'sensor', 'satellite', 'utc', 'confidence', 'frp', 'brightness', 'daynight', 'version', 'context'];

// opts.staff: danh sách cho cán bộ (gồm điểm "Không phải cháy rừng" mới kết luận)
function hotspots({ staff = false } = {}) {
  const dir = P('collected', 'firms');
  const ctx = readJson(P('web', 'hotspot-context.json')) || {};
  const out = [];
  const seen = new Set();
  for (const key of Object.keys(SENSORS)) {
    const fc = readJson(path.join(dir, `${key}-kon-tum-7d.geojson`));
    if (!fc) continue;
    for (const f of fc.features) {
      const p = f.properties;
      const [lon, lat] = f.geometry.coordinates;
      const hh = p.acq_time.padStart(4, '0');
      const utc = `${p.acq_date}T${hh.slice(0, 2)}:${hh.slice(2)}:00Z`;
      const id = `${key}-${p.acq_date}-${hh}-${Number(lat).toFixed(4)}-${Number(lon).toFixed(4)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const c = communeAt(lon, lat);
      const d = store.getDecision('hotspot', id);
      const h = {
        id, lon, lat, sensor: key, sensorLabel: SENSORS[key], satellite: p.satellite, utc,
        confidence: p.confidence, frp: p.frp ? Number(p.frp) : null, brightness: Number(p.bright_ti4 || p.brightness),
        daynight: p.daynight, version: p.version, commune: c ? c.fullName : null, communeCode: c ? c.code : null,
        context: ctx[id] || null,
        status: d ? d.status : 'new', statusLabel: HOTSPOT_STATUS[d ? d.status : 'new'], decision: d,
      };
      // đã có quyết định → lưu ảnh chụp thuộc tính để còn hiện tiếp khi điểm rời cửa sổ 7 ngày của tệp FIRMS
      if (d && !d.snapshot) store.update('decisions', d.id, { snapshot: Object.fromEntries(SNAP_KEYS.map((k) => [k, h[k] ?? null])) });
      if (onMap(h.status, utc, d, staff)) out.push(h);
    }
  }
  // điểm FIRMS đã quá 7 ngày nhưng hồ sơ còn mở (hoặc mới đóng): dựng lại từ ảnh chụp đã lưu
  for (const d of store.filter('decisions', (x) => x.kind === 'hotspot' && x.snapshot && !String(x.ref_id).startsWith('man-') && !seen.has(x.ref_id))) {
    const sn = d.snapshot;
    if (!sn || !Number.isFinite(sn.lon) || !onMap(d.status, sn.utc, d, staff)) continue;
    const c = communeAt(sn.lon, sn.lat);
    seen.add(d.ref_id);
    out.push({
      ...sn, id: d.ref_id, sensorLabel: SENSORS[sn.sensor] || sn.sensor, commune: c ? c.fullName : null, communeCode: c ? c.code : null,
      status: d.status, statusLabel: HOTSPOT_STATUS[d.status], decision: d, pinned: true,
    });
  }
  // điểm cháy nhập thủ công (src/services/firepoints.js): cùng danh sách, quy trình xác minh và quy tắc hiển thị với FIRMS
  for (const m of store.all('fire_points')) {
    const utc = new Date(m.observed_at).toISOString();
    const id = `man-${m.code}`;
    const d = store.getDecision('hotspot', id);
    const status = d ? d.status : 'new';
    if (!onMap(status, utc, d, staff)) continue;
    out.push({
      id, lon: m.lon, lat: m.lat, sensor: 'MANUAL', sensorLabel: `Nhập thủ công – ${MANUAL_SOURCES[m.source_kind] || 'nguồn khác'}`, satellite: null, utc,
      confidence: 'nhập tay', frp: null, brightness: null, daynight: null, version: null,
      commune: m.commune_name || null, communeCode: m.commune_code || null, context: null,
      manual: { code: m.code, source_kind: m.source_kind, area_ha: m.area_ha === null || m.area_ha === undefined ? null : Number(m.area_ha), report_code: m.report_code || null, created_by: m.created_by, description: m.description },
      status, statusLabel: HOTSPOT_STATUS[status], decision: d, pinned: Date.now() - new Date(utc).getTime() > RETENTION.new_days * DAY,
    });
  }
  return out.sort((a, b) => b.utc.localeCompare(a.utc));
}

// Quyết định có từ trước (chưa có ảnh chụp) mà điểm đã rời tệp 7 ngày: lấy lại thuộc tính từ PostGIS fire.hotspots (chạy lúc khởi động)
async function backfillHotspotSnapshots() {
  const db = require('../db/pool');
  if (!db.enabled) return 0;
  const need = store.filter('decisions', (x) => x.kind === 'hotspot' && !x.snapshot && !String(x.ref_id).startsWith('man-'));
  if (!need.length) return 0;
  const r = await db.query(`SELECT id, sensor, satellite, acq_utc, confidence, frp, brightness, daynight, version, in_forest, landcover, ST_X(geom) lon, ST_Y(geom) lat
    FROM fire.hotspots WHERE id = ANY($1)`, [need.map((x) => x.ref_id)]);
  const byId = new Map(r.rows.map((x) => [x.id, x]));
  let n = 0;
  for (const d of need) {
    const h = byId.get(d.ref_id);
    if (!h) continue;
    store.update('decisions', d.id, { snapshot: {
      lon: h.lon, lat: h.lat, sensor: h.sensor, satellite: h.satellite, utc: new Date(h.acq_utc).toISOString(), confidence: h.confidence,
      frp: h.frp === null ? null : Number(h.frp), brightness: h.brightness === null ? null : Number(h.brightness), daynight: h.daynight, version: h.version,
      context: h.landcover || h.in_forest !== null ? { landcover: h.landcover, in_forest: h.in_forest } : null,
    } });
    n += 1;
  }
  return n;
}

// bản công khai: bỏ quyết định nội bộ, mô tả và người nhập của điểm nhập tay
function publicHotspot(h) {
  const { decision, ...rest } = h; // eslint-disable-line no-unused-vars
  if (rest.manual) rest.manual = { code: rest.manual.code, source_kind: rest.manual.source_kind, area_ha: rest.manual.area_ha };
  return rest;
}
const MANUAL_SOURCES = { 'kiem-lam': 'kiểm lâm/cán bộ', 'chong-chay': 'tổ chống cháy/xã', 'nguoi-dan': 'người dân báo tin', 'phan-anh': 'phản ánh hiện trường', khac: 'nguồn khác' };

function firmsMeta() {
  const cs = readJson(P('collected', 'collection-status.json'));
  const live = readJson(path.join(paths.storage, 'firms-status.json'));
  return { collected_at: live && live.collected_at ? live.collected_at : cs ? cs.collected_at : null, window_days: 7, source: 'NASA FIRMS (LANCE NRT): MODIS, VIIRS S-NPP/NOAA-20/NOAA-21' };
}

function firmsHistory() {
  const h = readJson(P('collected', 'history', 'firms-gee-modis-2024-now.json'));
  if (!h) return null;
  const monthly = {}; const byCommune = {};
  for (const pt of h.points) {
    const m = pt.date.slice(0, 7);
    monthly[m] = (monthly[m] || 0) + 1;
    const c = communeAt(pt.lon, pt.lat);
    if (c) byCommune[c.code] = (byCommune[c.code] || 0) + 1;
  }
  const last = h.points.reduce((a, p) => (p.date > a ? p.date : a), '');
  // NRT snapshot (VIIRS/MODIS, last 7 days) is a different product: kept as its own series, never summed into MODIS history.
  const nrtMonthly = {}; const nrtByCommune = {};
  for (const hs of hotspots()) {
    if (hs.sensor === 'MANUAL' || hs.pinned) continue; // điểm nhập tay / điểm cũ đang theo dõi không thuộc ảnh chụp FIRMS NRT 7 ngày
    const m = new Date(new Date(hs.utc).getTime() + 7 * 3600e3).toISOString().slice(0, 7);
    nrtMonthly[m] = (nrtMonthly[m] || 0) + 1;
    if (hs.communeCode) nrtByCommune[hs.communeCode] = (nrtByCommune[hs.communeCode] || 0) + 1;
  }
  const months = [...new Set([...Object.keys(monthly), ...Object.keys(nrtMonthly)])].sort();
  const thisMonth = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7);
  if (months.length && months[months.length - 1] < thisMonth) months.push(thisMonth);
  return { source: h.source, collected_at: h.collected_at, meaning: h.meaning, total: h.points.length, monthly, byCommune, last_date: last,
    months, nrtMonthly, nrtByCommune, nrtSource: 'NASA FIRMS NRT (VIIRS 375 m, MODIS 1 km) – 7 ngày gần nhất', nrtCollectedAt: firmsMeta().collected_at };
}

function burnedHistory() {
  const h = readJson(P('collected', 'history', 'mcd64a1-burned-2024-now.json'));
  if (!h) return null;
  const monthly = {};
  for (const pt of h.points) { const m = pt.date.slice(0, 7); monthly[m] = (monthly[m] || 0) + pt.pixel_km2 * 100; }
  return { source: h.source, total_ha: h.points.length * 21.46, monthly, points: h.points };
}

// ---------- change candidates ----------
const CANDIDATE_STATUS = { unverified: 'Nghi vấn – chưa xác minh', verifying: 'Đang xác minh', confirmed: 'Xác nhận mất rừng', rejected: 'Không phải mất rừng', seasonal: 'Rụng lá theo mùa' };
function changeCandidates() {
  const fc = readJson(P('web', 'change-candidates.geojson'));
  if (!fc) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: fc.features.map((f) => {
      const d = store.getDecision('candidate', f.properties.id);
      const status = d ? d.status : 'unverified';
      return { ...f, properties: { ...f.properties, status, statusLabel: CANDIDATE_STATUS[status] } };
    }),
  };
}

// ---------- weather ----------
function weatherSnapshot() {
  const live = readJson(path.join(paths.storage, 'weather-live.json'));
  const snap = readJson(P('collected', 'weather', 'communes.json')) || [];
  const liveBy = live ? Object.fromEntries(live.communes.map((c) => [c.code, c.weather])) : {};
  return snap.map((c) => {
    const w = liveBy[c.commune.code] || c.weather;
    return {
      code: c.commune.code, name: c.commune.name, fullName: c.commune.fullName, lat: c.location.lat, lon: c.location.lon,
      current: w ? {
        dt: new Date(w.dt * 1000).toISOString(), temp: w.main.temp, humidity: w.main.humidity, wind_ms: w.wind.speed, wind_deg: w.wind.deg,
        description: w.weather[0] && w.weather[0].description, icon: w.weather[0] && w.weather[0].icon,
        rain1h: w.rain ? w.rain['1h'] || null : null, clouds: w.clouds ? w.clouds.all : null, live: Boolean(liveBy[c.commune.code]),
      } : null,
    };
  });
}

function openMeteo() { return readJson(P('collected', 'open-meteo', 'hourly-communes.json')); }

function dailyForecast(code) {
  const om = openMeteo();
  if (!om) return null;
  const c = om.communes.find((x) => x.commune_code === code) || om.communes[0];
  const d = c.data.daily;
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const days = d.time.map((t, i) => ({
    date: t, tmax: d.temperature_2m_max[i], tmin: d.temperature_2m_min[i], rain: d.precipitation_sum[i],
    wind_max: d.wind_speed_10m_max[i], rh_min: d.relative_humidity_2m_min[i],
  })).filter((x) => x.date >= today).slice(0, 7);
  const h = c.data.hourly;
  const hours = h.time.map((t, i) => ({ t, temp: h.temperature_2m[i], rh: h.relative_humidity_2m[i], rain: h.precipitation[i], wind: h.wind_speed_10m[i], wdir: h.wind_direction_10m[i], code: h.weather_code[i] }))
    .filter((x) => x.t >= `${today}T00:00`).slice(0, 72);
  return { code: c.commune_code, collected_at: om.collected_at_utc, source: om.source, attribution: om.attribution, days, hours };
}

function climateMonthly() {
  const rows = readCsv(P('processed', 'daily-climate-2024-2025.csv')) || [];
  const m = {};
  for (const r of rows) {
    const k = r.date.slice(0, 7);
    if (!m[k]) m[k] = { n: 0, t: 0, rainE: 0, rainC: 0, days: new Set() };
    const x = m[k]; x.n += 1; x.t += Number(r.era5_temperature_c); x.rainE += Number(r.era5_rain_mm); x.rainC += Number(r.chirps_rain_mm || 0); x.days.add(r.date);
  }
  const communesN = new Set(rows.map((r) => r.commune_code)).size || 1;
  return Object.entries(m).sort().map(([k, x]) => ({ month: k, temp_mean: x.t / x.n, rain_chirps_mm: x.rainC / communesN, rain_era5_mm: x.rainE / communesN }));
}

// ---------- Sentinel monthly series (100 m, đặc trưng cấp xã) ----------
function ndviSeries(code) {
  const rows = readCsv(P('processed', 'monthly-sentinel-commune-features.csv')) || [];
  const m = {};
  for (const r of rows) {
    if (code && r.commune_code !== code) continue;
    if (r.mean_ndvi === null) { if (!m[r.month]) m[r.month] = { w: 0, ndvi: 0, ndmi: 0, nbr: 0, aoi: 0 }; m[r.month].aoi += Number(r.aoi_pixel_count); continue; }
    const w = Number(r.valid_pixel_count);
    if (!m[r.month]) m[r.month] = { w: 0, ndvi: 0, ndmi: 0, nbr: 0, aoi: 0 };
    const x = m[r.month]; x.w += w; x.aoi += Number(r.aoi_pixel_count);
    x.ndvi += w * Number(r.mean_ndvi); x.ndmi += w * Number(r.mean_ndmi); x.nbr += w * Number(r.mean_nbr);
  }
  return Object.entries(m).sort().map(([month, x]) => ({
    month, valid_fraction: x.aoi ? x.w / x.aoi : 0,
    ndvi: x.w ? x.ndvi / x.w : null, ndmi: x.w ? x.ndmi / x.w : null, nbr: x.w ? x.nbr / x.w : null,
  }));
}

// ---------- overlays, content ----------
// classified layers also have XYZ tiles (scripts/build_tiles.py) so they stay sharp when zoomed in
function overlays() {
  return (readJson(P('web', 'overlays.json')) || []).map((o) => {
    const tj = readJson(path.join(ROOT, 'public', 'tiles', o.id, 'tilejson.json'));
    return tj ? { ...o, resolution: String(o.resolution || o.scale || '').replace(/\s*\(hiển thị[^)]*\)/, '') || o.resolution, tiles: { url: `/tiles/${o.id}/{z}/{x}/{y}.png`, minzoom: tj.minzoom, maxzoom: tj.maxzoom, bounds: tj.bounds } } : o;
  });
}
function photos() { return readJson(P('content', 'licensed-photos.json')) || []; }
function readiness() { return readJson(P('content', 'forecast-readiness.json')); }

const DOC_CATEGORIES = {
  'van-ban-phap-ly': 'Văn bản pháp lý', 'bao-cao-chuyen-nganh': 'Báo cáo chuyên ngành', 'du-lieu-chuyen-nganh': 'Dữ liệu chuyên ngành',
  'quy-hoach': 'Quy hoạch', 'ban-do-chuyen-de': 'Bản đồ chuyên đề', 'huong-dan-ky-thuat': 'Hướng dẫn kỹ thuật', khac: 'Khác',
};
function documents() {
  const base = (readJson(P('web', 'documents.json')) || []).map((d) => ({ ...d, origin: 'source', url: `/tai-lieu/tep/${d.id}` }));
  const uploaded = store.filter('documents', (d) => d.status !== 'deleted').map((d) => ({ ...d, origin: 'upload', url: `/tai-lieu/tep/${d.id}` }));
  return [...uploaded, ...base].map((d) => ({ ...d, categoryLabel: DOC_CATEGORIES[d.category] || d.category }));
}
function documentFile(id) {
  const base = (readJson(P('web', 'documents.json')) || []).find((d) => d.id === id);
  if (base) return { doc: base, file: P('collected', 'references', base.file) };
  const up = store.find('documents', (d) => d.id === id && d.status !== 'deleted');
  if (up) return { doc: up, file: path.join(paths.uploads, 'docs', up.stored_name) };
  return null;
}

// Map-ready published GeoJSON layers imported through the admin (A02).
function customLayers(includeUnpublished) {
  return store.filter('layers', (l) => includeUnpublished || l.status === 'published');
}

function dataFreshness() {
  return {
    weather: mtime(path.join(paths.storage, 'weather-live.json')) || mtime(P('collected', 'weather', 'communes.json')),
    openmeteo: openMeteo() ? openMeteo().collected_at_utc : null,
    firms: firmsMeta().collected_at,
    fireDanger: fireDanger() ? fireDanger().generated_at_utc : null,
    forestChange: forestChange() ? forestChange().generated_at_utc : null,
  };
}

function fileExists(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }

module.exports = {
  communeFeatures, province, communeAt, officialStats, communes, communeByCode, forestSummary, landcover,
  hotspots, publicHotspot, backfillHotspotSnapshots, RETENTION, firmsMeta, firmsHistory, burnedHistory, HOTSPOT_STATUS, SENSORS,
  forestChange, landcoverHistory, fieldSamples, changeCandidates, CANDIDATE_STATUS, fireDanger,
  weatherSnapshot, dailyForecast, climateMonthly, openMeteo, ndviSeries,
  overlays, photos, readiness, documents, documentFile, DOC_CATEGORIES, customLayers, dataFreshness, fileExists,
};
