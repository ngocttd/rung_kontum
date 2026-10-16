// Loads pipeline outputs (data/…) into PostGIS. Idempotent upserts; safe to re-run after each job.
// Parts: boundaries, statistics, change, hotspots, danger, history, storage (JSON → DB migration).
const fs = require('fs');
const path = require('path');
const { paths } = require('../config');
const { query, getPool } = require('./pool');

const read = (...p) => { try { return JSON.parse(fs.readFileSync(path.join(paths.data, ...p), 'utf8').replace(/^﻿/, '')); } catch { return null; } };
const toMulti = "ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(f->>'g'), 4326)), 3))";

// Bulk insert helper: rows serialised as one jsonb array per batch.
async function bulk(sql, rows, size = 2000) {
  for (let i = 0; i < rows.length; i += size) await query(sql, [JSON.stringify(rows.slice(i, i + size))]);
}

async function boundaries() {
  const prov = read('boundaries', 'kon-tum-historical-province.geojson');
  const full = read('boundaries', 'kon-tum-new-communes-full.geojson');
  const clip = read('boundaries', 'kon-tum-new-communes-clipped.geojson');
  await query(`INSERT INTO spatial.boundary_versions (id, title, source, note) VALUES
    ('kontum-2020-hdx', 'Ranh giới tỉnh Kon Tum trước sắp xếp 2025', 'Government of Viet Nam / HDX via geoBoundaries', 'Phạm vi vùng nghiên cứu'),
    ('communes-v5.2.0', 'Xã/phường hiện hành (sau sắp xếp 2025)', 'vietnamese-provinces-database v5.2.0', 'Chưa phải ranh pháp lý được nghiệm thu')
    ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, source = EXCLUDED.source, note = EXCLUDED.note`);
  const p = prov.features[0];
  await bulk(`INSERT INTO spatial.admin_units (code, version_id, level, name, full_name, clipped, geom, props)
    SELECT f->>'code', 'kontum-2020-hdx', 'province', 'Kon Tum', 'Tỉnh Kon Tum (trước 2025)', false, ${toMulti}, f->'p' FROM jsonb_array_elements($1::jsonb) f
    ON CONFLICT (code, version_id, clipped) DO UPDATE SET geom = EXCLUDED.geom, props = EXCLUDED.props`, [{ code: '62', g: JSON.stringify(p.geometry), p: p.properties }]);
  for (const [fc, clipped] of [[full, false], [clip, true]]) {
    await bulk(`INSERT INTO spatial.admin_units (code, version_id, level, name, full_name, area_km2, overlap_fraction, clipped, geom, props)
      SELECT f->>'code', 'communes-v5.2.0', 'commune', f->>'name', f->>'fullName', (f->>'areaKm2')::numeric, (f->>'overlap')::numeric, ${clipped}, ${toMulti}, f->'p'
      FROM jsonb_array_elements($1::jsonb) f
      ON CONFLICT (code, version_id, clipped) DO UPDATE SET name = EXCLUDED.name, full_name = EXCLUDED.full_name, area_km2 = EXCLUDED.area_km2,
        overlap_fraction = EXCLUDED.overlap_fraction, geom = EXCLUDED.geom, props = EXCLUDED.props`,
    fc.features.map((f) => ({ code: f.properties.code, name: f.properties.name, fullName: f.properties.fullName, areaKm2: f.properties.areaKm2, overlap: f.properties.overlapFraction, g: JSON.stringify(f.geometry), p: f.properties })), 10);
  }
  return { province: 1, communes: clip.features.length };
}

async function statistics() {
  const rows = read('processed', 'forest-statistics-2025-kon-tum-communes.json') || [];
  await bulk(`INSERT INTO spatial.forest_statistics SELECT f->>'commune_code', (f->>'as_of')::date, f->>'decision',
      (f->>'natural_area_ha')::numeric, (f->>'established_forest_ha')::numeric, (f->>'natural_forest_ha')::numeric, (f->>'established_plantation_ha')::numeric,
      (f->>'immature_plantation_ha')::numeric, (f->>'special_use_planning_ha')::numeric, (f->>'protection_planning_ha')::numeric, (f->>'production_planning_ha')::numeric,
      (f->>'forest_planning_area_ha')::numeric, (f->>'official_forest_cover_percent')::numeric, f->>'source_url', f->>'source_sheet', (f->>'source_row')::int, f->>'match_method', f->>'scope'
    FROM jsonb_array_elements($1::jsonb) f
    ON CONFLICT (commune_code, as_of) DO UPDATE SET established_forest_ha = EXCLUDED.established_forest_ha, natural_forest_ha = EXCLUDED.natural_forest_ha,
      established_plantation_ha = EXCLUDED.established_plantation_ha, cover_percent = EXCLUDED.cover_percent, decision = EXCLUDED.decision`, rows);
  return { forest_statistics: rows.length };
}

async function change() {
  const fcg = read('web', 'forest-change.json');
  if (!fcg) return { skipped: true };
  const loss = [];
  for (const [c, years] of Object.entries(fcg.history.annual_loss_by_commune)) for (const [y, ha] of Object.entries(years)) loss.push({ c, y: Number(y), ha });
  await bulk(`INSERT INTO imagery.forest_loss_annual (commune_code, year, loss_ha) SELECT f->>'c', (f->>'y')::int, (f->>'ha')::numeric FROM jsonb_array_elements($1::jsonb) f
    ON CONFLICT (commune_code, year, source) DO UPDATE SET loss_ha = EXCLUDED.loss_ha`, loss);
  const runId = `forest_loss_risk@${fcg.generated_at_utc}`;
  await query(`INSERT INTO imagery.model_runs (id, product, generated_at, horizon, model, validation, status) VALUES ($1, 'forest_loss_risk', $2, $3, $4, $5, $6)
    ON CONFLICT (id) DO NOTHING`, [runId, fcg.generated_at_utc, fcg.forecast.horizon, fcg.forecast.model, JSON.stringify(fcg.forecast.validation), fcg.forecast.status]);
  const risk = Object.entries(fcg.forecast.risk_by_commune).filter(([, r]) => r).map(([c, r]) => ({ c, ...r }));
  await bulk(`INSERT INTO imagery.loss_risk_commune SELECT $2, f->>'c', (f->>'mean_probability')::numeric, (f->>'expected_loss_ha')::numeric, (f->>'high_risk_ha')::numeric,
      (f->>'forest_cells')::int, f->'class_cells' FROM jsonb_array_elements($1::jsonb) f ON CONFLICT DO NOTHING`.replace('$2', `'${runId.replace(/'/g, "''")}'`), risk);
  const cands = read('web', 'change-candidates.geojson');
  const rows = cands.features.map((f) => ({ ...f.properties, g: JSON.stringify(f.geometry) }));
  await query('UPDATE imagery.change_candidates SET active = false');
  await bulk(`INSERT INTO imagery.change_candidates (id, run_id, window_label, area_ha, mean_dndvi, mean_dnbr, commune_code, seasonal_leaf_fall_possible, evidence, geom, centroid, active)
    SELECT f->>'id', '${runId.replace(/'/g, "''")}', f->>'window', (f->>'area_ha')::numeric, (f->>'mean_dndvi')::numeric, (f->>'mean_dnbr')::numeric, f->>'commune_code',
      (f->>'seasonal_leaf_fall_possible')::boolean, f->>'evidence', ${toMulti}, ST_SetSRID(ST_MakePoint((f->>'lon')::float8, (f->>'lat')::float8), 4326), true
    FROM jsonb_array_elements($1::jsonb) f
    ON CONFLICT (id) DO UPDATE SET run_id = EXCLUDED.run_id, area_ha = EXCLUDED.area_ha, mean_dndvi = EXCLUDED.mean_dndvi, mean_dnbr = EXCLUDED.mean_dnbr, geom = EXCLUDED.geom, active = true`, rows, 500);
  return { forest_loss_annual: loss.length, loss_risk_commune: risk.length, change_candidates: rows.length };
}

async function hotspots() {
  const ctx = read('web', 'hotspot-context.json') || {};
  const rows = [];
  for (const sensor of ['J1_VIIRS', 'J2_VIIRS', 'SUOMI_VIIRS', 'MODIS']) {
    const fc = read('collected', 'firms', `${sensor}-kon-tum-7d.geojson`);
    if (!fc) continue;
    for (const f of fc.features) {
      const p = f.properties; const hh = String(p.acq_time).padStart(4, '0');
      const id = `${sensor}-${p.acq_date}-${hh}-${Number(p.latitude).toFixed(4)}-${Number(p.longitude).toFixed(4)}`;
      const c = ctx[id] || {};
      rows.push({ id, sensor, satellite: p.satellite, utc: `${p.acq_date}T${hh.slice(0, 2)}:${hh.slice(2)}:00Z`, confidence: p.confidence, frp: p.frp || null,
        brightness: p.bright_ti4 || p.brightness || null, daynight: p.daynight, version: p.version, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
        in_forest: c.in_forest ?? null, landcover: c.landcover || null, raw: p });
    }
  }
  // commune assigned in the DB by spatial join (clipped commune polygons)
  await bulk(`INSERT INTO fire.hotspots (id, sensor, satellite, acq_utc, confidence, frp, brightness, daynight, version, in_forest, landcover, geom, raw, commune_code)
    SELECT f->>'id', f->>'sensor', f->>'satellite', (f->>'utc')::timestamptz, f->>'confidence', (f->>'frp')::numeric, (f->>'brightness')::numeric, f->>'daynight', f->>'version',
      (f->>'in_forest')::boolean, f->>'landcover', ST_SetSRID(ST_MakePoint((f->>'lon')::float8, (f->>'lat')::float8), 4326), f->'raw',
      (SELECT a.code FROM spatial.admin_units a WHERE a.level = 'commune' AND a.clipped AND ST_Contains(a.geom, ST_SetSRID(ST_MakePoint((f->>'lon')::float8, (f->>'lat')::float8), 4326)) LIMIT 1)
    FROM jsonb_array_elements($1::jsonb) f
    ON CONFLICT (id) DO UPDATE SET confidence = EXCLUDED.confidence, frp = EXCLUDED.frp, in_forest = COALESCE(EXCLUDED.in_forest, fire.hotspots.in_forest),
      landcover = COALESCE(EXCLUDED.landcover, fire.hotspots.landcover), last_seen = now()`, rows);
  return { hotspots: rows.length };
}

async function history() {
  const h = read('collected', 'history', 'firms-gee-modis-2024-now.json');
  if (!h) return { skipped: true };
  await bulk(`INSERT INTO fire.hotspot_history (date, geom, t21_k, confidence, source, commune_code)
    SELECT (f->>'date')::date, ST_SetSRID(ST_MakePoint((f->>'lon')::float8, (f->>'lat')::float8), 4326), (f->>'t21_k')::numeric, (f->>'confidence')::numeric, 'GEE FIRMS MODIS 1 km',
      (SELECT a.code FROM spatial.admin_units a WHERE a.level = 'commune' AND a.clipped AND ST_Contains(a.geom, ST_SetSRID(ST_MakePoint((f->>'lon')::float8, (f->>'lat')::float8), 4326)) LIMIT 1)
    FROM jsonb_array_elements($1::jsonb) f ON CONFLICT DO NOTHING`, h.points);
  return { hotspot_history: h.points.length };
}

async function danger() {
  const file = path.join(paths.processed, 'fire-danger-daily.csv');
  if (!fs.existsSync(file)) return { skipped: true };
  const fd = read('web', 'fire-danger.json');
  const runId = `fire_danger@${fd ? fd.generated_at_utc : new Date().toISOString()}`;
  if (fd) await query(`INSERT INTO imagery.model_runs (id, product, generated_at, horizon, model, validation, status, meta) VALUES ($1, 'fire_danger', $2, '7 ngày', 'Nesterov P + FWI', $3, $4, $5)
    ON CONFLICT (id) DO NOTHING`, [runId, fd.generated_at_utc, JSON.stringify(fd.validation), fd.method.status, JSON.stringify(fd.method)]);
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const head = lines.shift().split(',');
  const rows = lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [head[i], v === '' ? null : v])));
  await bulk(`INSERT INTO fire.danger_daily SELECT f->>'commune_code', (f->>'date_local')::date, '${runId.replace(/'/g, "''")}', f->>'input_source',
      (f->>'temperature_c')::numeric, (f->>'rh_percent')::numeric, (f->>'wind_kmh')::numeric, (f->>'rain24h_mm')::numeric, (f->>'nesterov_p')::numeric, (f->>'nesterov_class')::int,
      (f->>'ffmc')::numeric, (f->>'dmc')::numeric, (f->>'dc')::numeric, (f->>'isi')::numeric, (f->>'bui')::numeric, (f->>'fwi')::numeric
    FROM jsonb_array_elements($1::jsonb) f
    ON CONFLICT (commune_code, date_local) DO UPDATE SET run_id = EXCLUDED.run_id, input_source = EXCLUDED.input_source, nesterov_p = EXCLUDED.nesterov_p,
      nesterov_class = EXCLUDED.nesterov_class, fwi = EXCLUDED.fwi, ffmc = EXCLUDED.ffmc, dmc = EXCLUDED.dmc, dc = EXCLUDED.dc, isi = EXCLUDED.isi, bui = EXCLUDED.bui,
      temperature_c = EXCLUDED.temperature_c, rh_percent = EXCLUDED.rh_percent, wind_kmh = EXCLUDED.wind_kmh, rain24h_mm = EXCLUDED.rain24h_mm`, rows, 5000);
  return { danger_daily: rows.length };
}

async function landcover() {
  const lc = read('web', 'landcover-history.json');
  if (!lc) return { skipped: true };
  for (const [k, c] of Object.entries(lc.classes)) await query('INSERT INTO imagery.landcover_classes VALUES ($1,$2,$3) ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, color = EXCLUDED.color', [Number(k), c.label, c.color]);
  const stats = [];
  for (const [code, years] of Object.entries(lc.by_commune)) for (const y of lc.years) for (const [k, ha] of Object.entries(years[String(y)] || {})) stats.push({ code, y, k: Number(k), ha });
  await bulk(`INSERT INTO imagery.landcover_stats (commune_code, year, class_code, area_ha) SELECT f->>'code', (f->>'y')::int, (f->>'k')::int, (f->>'ha')::numeric FROM jsonb_array_elements($1::jsonb) f
    ON CONFLICT (commune_code, year, class_code, source) DO UPDATE SET area_ha = EXCLUDED.area_ha`, stats);
  const tr = [];
  for (const [period, m] of Object.entries(lc.transitions)) for (const [a, row] of Object.entries(m)) for (const [b, ha] of Object.entries(row)) tr.push({ period, a: Number(a), b: Number(b), ha });
  await bulk(`INSERT INTO imagery.landcover_transitions SELECT f->>'period', (f->>'a')::int, (f->>'b')::int, (f->>'ha')::numeric FROM jsonb_array_elements($1::jsonb) f
    ON CONFLICT (period, from_class, to_class) DO UPDATE SET area_ha = EXCLUDED.area_ha`, tr);
  const fs2 = read('web', 'field-samples.geojson');
  const rows = fs2 ? fs2.features.map((f) => ({ ...f.properties, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] })) : [];
  await bulk(`INSERT INTO spatial.field_samples (campaign, name_raw, name_vi, label_code, label, is_forest, landcover_2023, worldcover_2021, geom, x_utm, y_utm, commune_code)
    SELECT 'Mau_KON_TUM_2025', f->>'ten', f->>'ten_vi', f->>'lpr_code', f->>'lpr', (f->>'is_forest')::boolean, f->>'lc2023', (f->>'worldcover2021')::int,
      ST_SetSRID(ST_MakePoint((f->>'lon')::float8, (f->>'lat')::float8), 4326), (f->>'x_utm')::numeric, (f->>'y_utm')::numeric,
      (SELECT a.code FROM spatial.admin_units a WHERE a.level = 'commune' AND a.clipped AND ST_Contains(a.geom, ST_SetSRID(ST_MakePoint((f->>'lon')::float8, (f->>'lat')::float8), 4326)) LIMIT 1)
    FROM jsonb_array_elements($1::jsonb) f ON CONFLICT (campaign, x_utm, y_utm, name_raw) DO UPDATE SET name_vi = EXCLUDED.name_vi, label = EXCLUDED.label`, rows);
  return { landcover_stats: stats.length, transitions: tr.length, field_samples: rows.length };
}

// One-off migration of records kept in storage/*.json before the DB existed.
async function storage() {
  const pg = require('./pgstore');
  const out = {};
  for (const name of Object.keys(pg.MAP)) {
    let rows = [];
    try { rows = JSON.parse(fs.readFileSync(path.join(paths.storage, `${name}.json`), 'utf8')); } catch { continue; }
    // records from storage/ are the original history: drop DB rows that only clash on a natural key
    const uniq = { users: 'username', articles: 'slug', reports: 'code' }[name];
    if (uniq) for (const r of rows) await query(`DELETE FROM ${pg.MAP[name].table} WHERE ${uniq} = $1 AND id <> $2`, [r[uniq], r.id]);
    for (const r of rows) await pg.upsert(name, r);
    out[name] = rows.length;
  }
  return out;
}

const PARTS = { boundaries, statistics, change, hotspots, history, danger, landcover, storage };

async function run(parts = Object.keys(PARTS)) {
  const result = {};
  for (const p of parts) result[p] = await PARTS[p]();
  return result;
}

async function close() { const p = getPool(); if (p) await p.end(); }

module.exports = { run, close, PARTS };
