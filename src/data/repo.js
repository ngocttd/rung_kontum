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
const HOTSPOT_STATUS = {
  new: 'Mới phát hiện', assigned: 'Cần xác minh', verifying: 'Đang xác minh', confirmed: 'Xác nhận cháy',
  rejected: 'Không phải cháy rừng', handling: 'Đang xử lý', closed: 'Kết thúc',
};

function hotspots() {
  const dir = P('collected', 'firms');
  const ctx = readJson(P('web', 'hotspot-context.json')) || {};
  const out = [];
  for (const key of Object.keys(SENSORS)) {
    const fc = readJson(path.join(dir, `${key}-kon-tum-7d.geojson`));
    if (!fc) continue;
    for (const f of fc.features) {
      const p = f.properties;
      const [lon, lat] = f.geometry.coordinates;
      const hh = p.acq_time.padStart(4, '0');
      const utc = `${p.acq_date}T${hh.slice(0, 2)}:${hh.slice(2)}:00Z`;
      const id = `${key}-${p.acq_date}-${hh}-${Number(lat).toFixed(4)}-${Number(lon).toFixed(4)}`;
      const c = communeAt(lon, lat);
      const d = store.getDecision('hotspot', id);
      out.push({
        id, lon, lat, sensor: key, sensorLabel: SENSORS[key], satellite: p.satellite, utc,
        confidence: p.confidence, frp: p.frp ? Number(p.frp) : null, brightness: Number(p.bright_ti4 || p.brightness),
        daynight: p.daynight, version: p.version, commune: c ? c.fullName : null, communeCode: c ? c.code : null,
        context: ctx[id] || null,
        status: d ? d.status : 'new', statusLabel: HOTSPOT_STATUS[d ? d.status : 'new'], decision: d,
      });
    }
  }
  return out.sort((a, b) => b.utc.localeCompare(a.utc));
}

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
  hotspots, firmsMeta, firmsHistory, burnedHistory, HOTSPOT_STATUS, SENSORS,
  forestChange, landcoverHistory, fieldSamples, changeCandidates, CANDIDATE_STATUS, fireDanger,
  weatherSnapshot, dailyForecast, climateMonthly, openMeteo, ndviSeries,
  overlays, photos, readiness, documents, documentFile, DOC_CATEGORIES, customLayers, dataFreshness, fileExists,
};
